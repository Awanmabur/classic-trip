const notificationService = require('../../services/notification/notificationService');
const pushService = require('../../services/notification/pushService');

function currentUser(req) {
  return req.session?.user || {};
}

function notificationPageForUser(user = {}) {
  const role = String(user.role || '').toLowerCase();
  if (role === 'customer') return '/account/notifications';
  if (role === 'company_admin') return '/company/notifications';
  if (role === 'company_employee') return '/employee/dashboard/notifications';
  if (role === 'driver') return '/driver/dashboard/notifications';
  if (role === 'promoter') return '/promoter/notifications';
  if (role === 'support_admin' || role === 'support_agent') return '/support/dashboard/notifications';
  if (role === 'finance_admin' || role === 'finance_agent') return '/finance/dashboard/notifications';
  if (role === 'operations_admin' || role === 'operations_agent') return '/operations/dashboard/notifications';
  if (role === 'content_admin') return '/content/dashboard/notifications';
  if (role === 'super_admin' || role === 'admin') return '/admin/notifications';
  return '/account/notifications';
}

async function config(req, res, next) {
  try {
    const user = currentUser(req);
    const activeSubscriptions = await pushService.activeSubscriptionCount(user);
    return res.json({
      ok: true,
      push: {
        enabled: pushService.configured(),
        publicKey: pushService.publicKey(),
        activeSubscriptions,
      },
    });
  } catch (error) { return next(error); }
}

async function list(req, res, next) {
  try {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 30)));
  const notifications = await notificationService.notificationsForUserLive(currentUser(req), { limit });
  return res.json({ ok: true, notifications, unreadCount: notifications.filter((note) => !note.readAt).length });
  } catch (error) { return next(error); }
}

async function markRead(req, res, next) {
  try {
    const note = await notificationService.markRead(req.params.id, currentUser(req));
    if (!note) return res.status(404).json({ ok: false, message: 'Notification not found' });
    return res.json({ ok: true, notification: { id: note.id, readAt: note.readAt, status: note.status } });
  } catch (error) {
    return next(error);
  }
}

async function subscribe(req, res, next) {
  try {
    const result = await pushService.saveSubscription(req.body.subscription || req.body, currentUser(req), req);
    return res.status(201).json({ ok: true, subscription: result });
  } catch (error) {
    return next(error);
  }
}

async function unsubscribe(req, res, next) {
  try {
    const result = await pushService.removeSubscription(req.body.endpoint || req.body.subscription?.endpoint || '', currentUser(req));
    return res.json({ ok: true, ...result });
  } catch (error) {
    return next(error);
  }
}


async function markAllRead(req, res, next) {
  try {
    const result = await notificationService.markAllRead(currentUser(req));
    return res.json({ ok: true, ...result });
  } catch (error) { return next(error); }
}

async function testPush(req, res, next) {
  try {
    const user = currentUser(req);
    const result = await pushService.sendPush({
      userId: user.id || '',
      audience: user.role === 'customer' ? 'customers' : '',
      title: 'Classic Trip push test',
      message: 'Push notifications are connected and working on this device.',
      referenceType: 'push_test',
      referenceId: `push-test-${Date.now()}`,
      meta: { url: notificationPageForUser(user) },
    });
    const ok = result.status === 'sent';
    return res.status(ok ? 200 : 409).json({ ok, push: result });
  } catch (error) { return next(error); }
}

module.exports = { config, list, markRead, markAllRead, testPush, subscribe, unsubscribe };
