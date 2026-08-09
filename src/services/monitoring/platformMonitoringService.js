'use strict';

const PlatformActivity = require('../../models/PlatformActivity');

const CACHE_TTL_MS = 15_000;
let overviewCache = null;
let overviewCacheAt = 0;
let overviewInflight = null;

function startOfHours(hours) {
  return new Date(Date.now() - Number(hours || 24) * 60 * 60 * 1000);
}

function rowLabel(row = {}) {
  return {
    label: row._id ?? 'Unknown',
    count: Number(row.count || 0),
    uniqueVisitors: Number(row.uniqueVisitors || 0),
  };
}

async function buildOverview(hours) {
  const since = startOfHours(hours);
  const match = { occurredAt: { $gte: since } };
  const [result] = await PlatformActivity.aggregate([
    { $match: match },
    { $facet: {
      totals: [
        { $group: {
          _id: null,
          pageViews: { $sum: { $cond: [{ $eq: ['$eventType', 'page_view'] }, 1, 0] } },
          actions: { $sum: { $cond: [{ $eq: ['$eventType', 'action'] }, 1, 0] } },
          signedInActivity: { $sum: { $cond: ['$authenticated', 1, 0] } },
          errors4xx: { $sum: { $cond: [{ $and: [{ $gte: ['$statusCode', 400] }, { $lt: ['$statusCode', 500] }] }, 1, 0] } },
          errors5xx: { $sum: { $cond: [{ $gte: ['$statusCode', 500] }, 1, 0] } },
          visitors: { $addToSet: '$visitorId' },
          bookings: { $sum: { $cond: [{ $eq: ['$actionName', 'booking'] }, 1, 0] } },
          paymentActions: { $sum: { $cond: [{ $eq: ['$actionName', 'payment'] }, 1, 0] } },
          pageDurationTotal: { $sum: { $cond: [{ $eq: ['$eventType', 'page_view'] }, '$durationMs', 0] } },
          pageDurationCount: { $sum: { $cond: [{ $eq: ['$eventType', 'page_view'] }, 1, 0] } },
        } },
        { $project: {
          _id: 0,
          pageViews: 1,
          actions: 1,
          signedInActivity: 1,
          errors4xx: 1,
          errors5xx: 1,
          bookings: 1,
          paymentActions: 1,
          pageDurationTotal: 1,
          pageDurationCount: 1,
          uniqueVisitors: { $size: '$visitors' },
        } },
      ],
      topPages: [
        { $match: { eventType: 'page_view' } },
        { $group: { _id: '$path', count: { $sum: 1 }, visitors: { $addToSet: '$visitorId' } } },
        { $project: { count: 1, uniqueVisitors: { $size: '$visitors' } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ],
      topActions: [
        { $match: { eventType: 'action' } },
        { $group: { _id: '$actionName', count: { $sum: 1 }, visitors: { $addToSet: '$visitorId' } } },
        { $project: { count: 1, uniqueVisitors: { $size: '$visitors' } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ],
      devices: [
        { $group: { _id: '$deviceType', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 6 },
      ],
      slowPages: [
        { $match: { eventType: 'page_view' } },
        { $group: { _id: '$path', views: { $sum: 1 }, avgDurationMs: { $avg: '$durationMs' }, maxDurationMs: { $max: '$durationMs' } } },
        { $match: { views: { $gte: 2 } } },
        { $sort: { avgDurationMs: -1 } },
        { $limit: 10 },
      ],
      referrers: [
        { $match: { referrerHost: { $nin: ['', null] } } },
        { $group: { _id: '$referrerHost', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 8 },
      ],
      recent: [
        { $sort: { occurredAt: -1 } },
        { $limit: 50 },
        { $project: {
          _id: 0,
          visitorId: 1,
          userId: 1,
          userRole: 1,
          authenticated: 1,
          eventType: 1,
          method: 1,
          path: 1,
          pageGroup: 1,
          actionName: 1,
          statusCode: 1,
          durationMs: 1,
          referrerHost: 1,
          deviceType: 1,
          browserHint: 1,
          occurredAt: 1,
        } },
      ],
    } },
  ]).allowDiskUse(false);

  const stats = result?.totals?.[0] || {};
  const avgPageMs = Number(stats.pageDurationCount || 0) > 0
    ? Math.round(Number(stats.pageDurationTotal || 0) / Number(stats.pageDurationCount || 1))
    : 0;
  return {
    windowHours: hours,
    since,
    stats: {
      uniqueVisitors: Number(stats.uniqueVisitors || 0),
      pageViews: Number(stats.pageViews || 0),
      actions: Number(stats.actions || 0),
      signedInActivity: Number(stats.signedInActivity || 0),
      bookings: Number(stats.bookings || 0),
      paymentActions: Number(stats.paymentActions || 0),
      errors4xx: Number(stats.errors4xx || 0),
      errors5xx: Number(stats.errors5xx || 0),
      avgPageMs,
    },
    topPages: (result?.topPages || []).map(rowLabel),
    topActions: (result?.topActions || []).map(rowLabel),
    devices: (result?.devices || []).map(rowLabel),
    slowPages: (result?.slowPages || []).map((row) => ({
      label: row._id || 'Unknown',
      views: Number(row.views || 0),
      avgDurationMs: Math.round(Number(row.avgDurationMs || 0)),
      maxDurationMs: Math.round(Number(row.maxDurationMs || 0)),
    })),
    referrers: (result?.referrers || []).map(rowLabel),
    recent: result?.recent || [],
  };
}

async function overview({ hours = 24, fresh = false } = {}) {
  const normalizedHours = Math.max(1, Math.min(168, Number(hours || 24)));
  const cacheValid = !fresh && overviewCache && overviewCache.hours === normalizedHours && (Date.now() - overviewCacheAt) < CACHE_TTL_MS;
  if (cacheValid) return overviewCache.data;
  if (!fresh && overviewInflight?.hours === normalizedHours) return overviewInflight.promise;

  const promise = buildOverview(normalizedHours)
    .then((data) => {
      overviewCache = { hours: normalizedHours, data };
      overviewCacheAt = Date.now();
      return data;
    })
    .finally(() => {
      if (overviewInflight?.promise === promise) overviewInflight = null;
    });
  overviewInflight = { hours: normalizedHours, promise };
  return promise;
}

function invalidateCache() {
  overviewCache = null;
  overviewCacheAt = 0;
}

module.exports = { overview, invalidateCache };
