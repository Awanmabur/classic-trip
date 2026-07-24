const crypto = require('crypto');
const { env } = require('../../config/env');
const notificationRepository = require('../../repositories/domain/notificationRepository');

let webpush = null;
try { webpush = require('web-push'); } catch (error) { webpush = null; }

function configured() {
  return Boolean(env.push.enabled && webpush && env.push.vapidPublicKey && env.push.vapidPrivateKey && env.push.subject);
}
function configureWebPush() {
  if (!configured()) return false;
  webpush.setVapidDetails(env.push.subject, env.push.vapidPublicKey, env.push.vapidPrivateKey);
  return true;
}
function hashEndpoint(endpoint = '') {
  return crypto.createHash('sha256').update(String(endpoint || '')).digest('hex').slice(0, 32);
}
function safeSubscription(subscription = {}) {
  return {
    endpoint: subscription.endpoint || '', expirationTime: subscription.expirationTime || null,
    keys: { p256dh: subscription.keys?.p256dh || '', auth: subscription.keys?.auth || '' },
  };
}
async function persistSubscription(row) {
  return notificationRepository.pushSubscriptions.save(row, { id: row.id });
}

async function saveSubscription(subscription = {}, user = {}, req = {}) {
  if (!subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    const error = new Error('A valid browser push subscription is required'); error.status = 422; throw error;
  }
  const id = `push-${hashEndpoint(subscription.endpoint)}`;
  const existing = await notificationRepository.pushSubscriptions.findOne({ $or: [{ id }, { endpoint: subscription.endpoint }] });
  const row = {
    ...(existing || {}), id, userId: user.id || '', userRole: user.role || '', companyId: user.companyId || '',
    endpoint: subscription.endpoint, expirationTime: subscription.expirationTime || null, keys: safeSubscription(subscription).keys,
    status: 'active', userAgent: req.headers?.['user-agent'] || '', lastSeenAt: new Date().toISOString(),
    createdAt: existing?.createdAt || new Date().toISOString(), revokedAt: null, expiredAt: null,
  };
  await persistSubscription(row);
  return { id, enabled: configured(), publicKey: env.push.vapidPublicKey || '' };
}

async function removeSubscription(endpoint = '', user = {}) {
  const key = String(endpoint || '');
  const rows = await notificationRepository.pushSubscriptions.list({ endpoint: key, ...(user.id ? { userId: user.id } : {}) });
  const now = new Date().toISOString();
  for (const row of rows) {
    Object.assign(row, { status: 'revoked', revokedAt: now });
    await persistSubscription(row);
  }
  return { revoked: rows.length };
}

async function subscriptionsFor(message = {}) {
  const userId = message.userId || message.recipient?.userId || '';
  const companyId = message.meta?.companyId || '';
  return (await notificationRepository.pushSubscriptions.list({})).filter((sub) => {
    if (sub.status && sub.status !== 'active') return false;
    if (userId) return sub.userId === userId;
    if (companyId && ['company_admin', 'company_employee', 'driver'].includes(sub.userRole)) return sub.companyId === companyId;
    if (message.audience === 'admins') return ['super_admin', 'admin', 'finance_admin', 'support_admin', 'operations_admin'].includes(sub.userRole);
    if (message.audience === 'promoters') return sub.userRole === 'promoter';
    if (message.audience === 'customers') return sub.userRole === 'customer';
    return false;
  });
}
async function markExpired(subscription) {
  Object.assign(subscription, { status: 'expired', expiredAt: new Date().toISOString() });
  await persistSubscription(subscription).catch(() => {});
}
async function sendPush(message = {}) {
  const recipients = await subscriptionsFor(message);
  if (!recipients.length) return { status: 'queued', channel: 'push', provider: 'web-push', reason: 'No active browser push subscription for recipient' };
  if (!configureWebPush()) return { status: 'queued', channel: 'push', provider: 'web-push', reason: 'Web Push VAPID keys are not configured' };
  const payload = JSON.stringify({ title: message.title || 'Classic Trip update', message: message.message || '', url: message.meta?.url || message.meta?.ticketUrl || '/account', referenceType: message.referenceType || '', referenceId: message.referenceId || '' });
  const results = await Promise.allSettled(recipients.map((subscription) => webpush.sendNotification(safeSubscription(subscription), payload)));
  let sent = 0; let failed = 0;
  await Promise.all(results.map(async (result, index) => {
    const subscription = recipients[index];
    if (result.status === 'fulfilled') {
      sent += 1; subscription.lastSentAt = new Date().toISOString(); await persistSubscription(subscription).catch(() => {}); return;
    }
    failed += 1;
    if ([404, 410].includes(result.reason?.statusCode)) await markExpired(subscription);
  }));
  return { status: sent ? 'sent' : 'failed', channel: 'push', provider: 'web-push', sentCount: sent, failedCount: failed, response: { attempted: recipients.length, sent, failed } };
}

module.exports = { configured, publicKey: () => env.push.vapidPublicKey || '', saveSubscription, removeSubscription, sendPush };
