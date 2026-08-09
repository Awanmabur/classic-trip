'use strict';

const crypto = require('crypto');
const PlatformActivity = require('../models/PlatformActivity');

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const STATIC_EXT = /\.(?:css|js|mjs|map|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|webmanifest|xml|txt|pdf)$/i;
const EXCLUDED_PREFIXES = ['/health', '/ready', '/sw.js', '/site.webmanifest', '/robots.txt', '/sitemap', '/sitemaps/', '/llms', '/ai-index.json', '/api/webhooks'];
const QUIET_API_PREFIXES = ['/api/notifications', '/api/v1/places', '/api/v1/listings'];

const WRITE_BATCH_SIZE = Math.max(10, Math.min(200, Number(process.env.MONITORING_BATCH_SIZE || 50)));
const WRITE_FLUSH_MS = Math.max(250, Math.min(5000, Number(process.env.MONITORING_FLUSH_MS || 1200)));
const MAX_QUEUE_SIZE = Math.max(WRITE_BATCH_SIZE * 4, Math.min(10000, Number(process.env.MONITORING_MAX_QUEUE || 3000)));
const activityQueue = [];
let flushTimer = null;
let flushing = false;

function scheduleFlush(delay = WRITE_FLUSH_MS) {
  if (flushTimer || !activityQueue.length) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushActivityQueue().catch(() => {});
  }, delay);
  flushTimer.unref?.();
}

async function flushActivityQueue() {
  if (flushing || !activityQueue.length) return;
  flushing = true;
  const batch = activityQueue.splice(0, WRITE_BATCH_SIZE);
  try {
    await PlatformActivity.insertMany(batch, { ordered: false });
  } catch (_) {
    // Monitoring is best-effort and must never compete with booking/payment traffic.
  } finally {
    flushing = false;
    if (activityQueue.length) scheduleFlush(activityQueue.length >= WRITE_BATCH_SIZE ? 25 : WRITE_FLUSH_MS);
  }
}

function enqueueActivity(record) {
  if (activityQueue.length >= MAX_QUEUE_SIZE) activityQueue.splice(0, activityQueue.length - MAX_QUEUE_SIZE + 1);
  activityQueue.push(record);
  scheduleFlush(activityQueue.length >= WRITE_BATCH_SIZE ? 25 : WRITE_FLUSH_MS);
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 24);
}

function deviceType(userAgent = '') {
  const ua = String(userAgent || '').toLowerCase();
  if (/bot|crawler|spider|slurp|bingpreview|facebookexternalhit/.test(ua)) return 'bot';
  if (/ipad|tablet|kindle/.test(ua)) return 'tablet';
  if (/android|iphone|ipod|mobile/.test(ua)) return 'mobile';
  if (ua) return 'desktop';
  return 'unknown';
}

function browserHint(userAgent = '') {
  const ua = String(userAgent || '');
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'Safari';
  return deviceType(ua) === 'bot' ? 'Bot' : 'Other';
}

function referrerHost(value = '') {
  try { return value ? new URL(String(value)).hostname.slice(0, 180) : ''; } catch (_) { return ''; }
}

function pageGroup(path = '') {
  const clean = String(path || '/').split('?')[0];
  if (clean === '/') return 'home';
  if (clean.startsWith('/search') || clean.startsWith('/routes')) return 'search';
  if (clean.startsWith('/listings/')) return 'listing';
  if (clean.startsWith('/book/') || clean.startsWith('/bookings/')) return 'checkout';
  if (clean.startsWith('/booking/success')) return 'conversion';
  if (clean.startsWith('/tickets')) return 'ticket';
  if (clean.startsWith('/login') || clean.startsWith('/register') || clean.startsWith('/auth/')) return 'auth';
  if (clean.startsWith('/admin')) return 'admin';
  if (clean.startsWith('/company')) return 'company';
  if (clean.startsWith('/account')) return 'customer';
  if (clean.startsWith('/employee')) return 'employee';
  if (clean.startsWith('/driver')) return 'driver';
  if (clean.startsWith('/promoter')) return 'promoter';
  if (clean.startsWith('/api/')) return 'api';
  return clean.split('/').filter(Boolean)[0] || 'other';
}

function actionName(req) {
  const path = String(req.path || '');
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'GET') return 'view';
  if (/bookings/.test(path)) return 'booking';
  if (/payment/.test(path)) return 'payment';
  if (/login/.test(path)) return 'login';
  if (/register/.test(path)) return 'register';
  if (/archive/.test(path) && /restore/.test(path)) return 'restore';
  if (/notification/.test(path)) return 'notification';
  return `${method.toLowerCase()}_${pageGroup(path)}`;
}

function shouldTrack(req) {
  if (String(req.get?.('X-Classic-Trip-Prefetch') || '') === '1') return false;
  if (String(process.env.MONITORING_ENABLED || 'true').toLowerCase() === 'false') return false;
  const path = String(req.path || '');
  if (!path || STATIC_EXT.test(path) || EXCLUDED_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix))) return false;
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'GET') {
    if (path.startsWith('/api/')) return false;
    return true;
  }
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return false;
  if (QUIET_API_PREFIXES.some((prefix) => path.startsWith(prefix))) return false;
  return true;
}

function platformMonitoring(req, res, next) {
  if (!shouldTrack(req)) return next();
  const started = process.hrtime.bigint();
  res.once('finish', () => {
    const user = req.session?.user || {};
    const persistedSessionCookie = req.cookies?.['ct.sid'] || '';
    // Guests on saveUninitialized=false sessions may not receive a session cookie.
    // In that case use an irreversible, approximate 24h fingerprint; raw IP/UA are
    // never persisted and the daily component prevents long-term cross-day tracking.
    const dayKey = new Date().toISOString().slice(0, 10);
    const sessionSource = persistedSessionCookie
      ? `session:${persistedSessionCookie}`
      : `guest:${req.ip || ''}:${req.headers['user-agent'] || ''}:${req.headers['accept-language'] || ''}:${dayKey}`;
    const visitorId = hash(sessionSource);
    const occurredAt = new Date();
    const record = {
      id: `activity-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`,
      visitorId,
      sessionKey: visitorId,
      userId: String(user.id || ''),
      userRole: String(user.role || 'guest'),
      authenticated: Boolean(user.id),
      eventType: String(req.method || 'GET').toUpperCase() === 'GET' ? 'page_view' : 'action',
      method: String(req.method || 'GET').toUpperCase(),
      path: String(req.path || '/').slice(0, 300),
      pageGroup: pageGroup(req.path),
      actionName: actionName(req),
      statusCode: Number(res.statusCode || 0),
      durationMs: Math.round(Number(process.hrtime.bigint() - started) / 1e6),
      referrerHost: referrerHost(req.get('referer') || req.get('referrer') || ''),
      deviceType: deviceType(req.get('user-agent') || ''),
      browserHint: browserHint(req.get('user-agent') || ''),
      requestId: String(req.id || ''),
      occurredAt,
      expiresAt: new Date(occurredAt.getTime() + RETENTION_MS),
    };
    // Queue analytics in small insertMany batches. One Mongo write per page view
    // can saturate a small Atlas connection pool even though it happens after the
    // HTTP response. Batching keeps monitoring independent from booking traffic.
    enqueueActivity(record);
  });
  return next();
}

module.exports = platformMonitoring;
module.exports.flushActivityQueue = flushActivityQueue;
module.exports.enqueueActivity = enqueueActivity;
