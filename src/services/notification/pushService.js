const crypto = require('crypto');
const { mongoose } = require('../../config/db');
const { env } = require('../../config/env');
const store = require('../data/persistentStore');

let webpush = null;
try { webpush = require('web-push'); } catch (error) { webpush = null; }

function ensureCollection() {
  if (!Array.isArray(store.state.pushSubscriptions)) store.state.pushSubscriptions = [];
}

function mongoReady() {
  return mongoose.connection.readyState === 1;
}

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
    endpoint: subscription.endpoint || '',
    expirationTime: subscription.expirationTime || null,
    keys: {
      p256dh: subscription.keys?.p256dh || '',
      auth: subscription.keys?.auth || '',
    },
  };
}

async function persistSubscription(row) {
  if (!mongoReady()) return;
  const PushSubscription = require('../../models/PushSubscription');
  await PushSubscription.updateOne({ id: row.id }, { $set: row }, { upsert: true, runValidators: true });
}

async function saveSubscription(subscription = {}, user = {}, req = {}) {
  ensureCollection();
  if (!subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    const error = new Error('A valid browser push subscription is required');
    error.status = 422;
    throw error;
  }
  const id = `push-${hashEndpoint(subscription.endpoint)}`;
  const row = {
    id,
    userId: user.id || '',
    userRole: user.role || '',
    companyId: user.companyId || '',
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime || null,
    keys: safeSubscription(subscription).keys,
    status: 'active',
    userAgent: req.headers?.['user-agent'] || '',
    lastSeenAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  const existingIndex = store.state.pushSubscriptions.findIndex((item) => item.id === id || item.endpoint === row.endpoint);
  if (existingIndex >= 0) {
    row.createdAt = store.state.pushSubscriptions[existingIndex].createdAt || row.createdAt;
    store.state.pushSubscriptions[existingIndex] = { ...store.state.pushSubscriptions[existingIndex], ...row };
  } else {
    store.state.pushSubscriptions.unshift(row);
  }
  await persistSubscription(existingIndex >= 0 ? store.state.pushSubscriptions[existingIndex] : row);
  return { id, enabled: configured(), publicKey: env.push.vapidPublicKey || '' };
}

async function removeSubscription(endpoint = '', user = {}) {
  ensureCollection();
  const key = String(endpoint || '');
  const rows = store.state.pushSubscriptions.filter((item) => item.endpoint === key && (!user.id || item.userId === user.id));
  rows.forEach((row) => {
    row.status = 'revoked';
    row.revokedAt = new Date().toISOString();
  });
  if (mongoReady() && rows.length) {
    const PushSubscription = require('../../models/PushSubscription');
    await PushSubscription.updateMany({ id: { $in: rows.map((row) => row.id) } }, { $set: { status: 'revoked', revokedAt: new Date() } });
  }
  return { revoked: rows.length };
}

function subscriptionsFor(message = {}) {
  ensureCollection();
  const userId = message.userId || message.recipient?.userId || '';
  const companyId = message.meta?.companyId || '';
  return store.state.pushSubscriptions.filter((sub) => {
    if (sub.status && sub.status !== 'active') return false;
    if (userId) return sub.userId === userId;
    if (companyId && ['company_admin', 'company_employee', 'driver'].includes(sub.userRole)) return sub.companyId === companyId;
    if (message.audience === 'admins') return ['super_admin', 'admin'].includes(sub.userRole);
    if (message.audience === 'promoters') return sub.userRole === 'promoter';
    if (message.audience === 'customers') return sub.userRole === 'customer';
    return false;
  });
}

async function markExpired(subscription) {
  subscription.status = 'expired';
  subscription.expiredAt = new Date().toISOString();
  await persistSubscription(subscription).catch(() => {});
}

async function sendPush(message = {}) {
  const recipients = subscriptionsFor(message);
  if (!recipients.length) {
    return { status: 'queued', channel: 'push', provider: 'web-push', reason: 'No active browser push subscription for recipient' };
  }
  if (!configureWebPush()) {
    return { status: 'queued', channel: 'push', provider: 'web-push', reason: 'Web Push VAPID keys are not configured' };
  }
  const payload = JSON.stringify({
    title: message.title || 'Classic Trip update',
    message: message.message || '',
    url: message.meta?.url || message.meta?.ticketUrl || '/account',
    referenceType: message.referenceType || '',
    referenceId: message.referenceId || '',
  });
  const results = await Promise.allSettled(recipients.map((subscription) => webpush.sendNotification(safeSubscription(subscription), payload)));
  let sent = 0;
  let failed = 0;
  await Promise.all(results.map(async (result, index) => {
    const subscription = recipients[index];
    if (result.status === 'fulfilled') {
      sent += 1;
      subscription.lastSentAt = new Date().toISOString();
      await persistSubscription(subscription).catch(() => {});
      return;
    }
    failed += 1;
    const statusCode = result.reason?.statusCode;
    if (statusCode === 404 || statusCode === 410) await markExpired(subscription);
  }));
  return {
    status: sent ? 'sent' : 'failed',
    channel: 'push',
    provider: 'web-push',
    sentCount: sent,
    failedCount: failed,
    response: { attempted: recipients.length, sent, failed },
  };
}

module.exports = {
  configured,
  publicKey: () => env.push.vapidPublicKey || '',
  saveSubscription,
  removeSubscription,
  sendPush,
};
