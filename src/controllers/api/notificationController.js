const notificationService = require('../../services/notification/notificationService');
const pushService = require('../../services/notification/pushService');

function currentUser(req) {
  return req.session?.user || {};
}

function config(req, res) {
  res.json({
    ok: true,
    push: {
      enabled: pushService.configured(),
      publicKey: pushService.publicKey(),
    },
  });
}

function list(req, res) {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 30)));
  const notifications = notificationService.notificationsForUser(currentUser(req), { limit });
  res.json({ ok: true, notifications, unreadCount: notifications.filter((note) => !note.readAt).length });
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

module.exports = { config, list, markRead, subscribe, unsubscribe };
