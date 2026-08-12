'use strict';

const { safeRedirectPath } = require('../utils/safeRedirect');
const dashboardSnapshotService = require('../services/dashboard/dashboardSnapshotService');

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const DASHBOARD_PREFIX = /^\/(?:company|employee|driver|promoter|admin|operations|support|finance|content|account)(?:\/|$)/;

function returnPathFromReferer(req) {
  const referer = String(req.get('referer') || '').trim();
  if (!referer) return '';
  try {
    const base = `${req.protocol}://${req.get('host')}`;
    const url = new URL(referer, base);
    const requestHost = String(req.get('host') || '').split(':')[0].toLowerCase();
    if (String(url.hostname || '').toLowerCase() !== requestHost) return '';
    return `${url.pathname}${url.search || ''}${url.hash || ''}`;
  } catch (_) {
    return '';
  }
}

function dashboardReturnPath(req) {
  const explicit = safeRedirectPath(req.body?._returnTo, '');
  if (explicit && DASHBOARD_PREFIX.test(explicit.split('?')[0].split('#')[0])) return explicit;
  const refererPath = safeRedirectPath(returnPathFromReferer(req), '');
  return DASHBOARD_PREFIX.test(refererPath.split('?')[0].split('#')[0]) ? refererPath : '';
}

function invalidateReadModels(req) {
  try {
    // Mutations are much rarer than reads. Clearing dashboard snapshots here is
    // intentionally broad so a create/edit/archive made on one dashboard page
    // cannot leave another page showing a stale count or stale relationship.
    dashboardSnapshotService.invalidate();
  } catch (_) {}

  try {
    // Load lazily to avoid coupling application bootstrap to the marketplace's
    // relatively large projection module.
    const catalogService = require('../services/marketplace/catalogService');
    catalogService.invalidateMarketplaceCache?.();
  } catch (_) {}
}

function dashboardMutationState(req, res, next) {
  if (!MUTATION_METHODS.has(String(req.method || '').toUpperCase()) || !DASHBOARD_PREFIX.test(String(req.path || req.originalUrl || ''))) {
    return next();
  }

  const returnTo = dashboardReturnPath(req);
  if (returnTo && String(req.body?._allowCrossPageRedirect || '') !== '1') {
    const originalRedirect = res.redirect.bind(res);
    res.redirect = function preserveDashboardPage(statusOrPath, maybePath) {
      if (typeof statusOrPath === 'number') return originalRedirect(statusOrPath, returnTo);
      return originalRedirect(returnTo);
    };
  }

  let invalidated = false;
  res.once('finish', () => {
    if (invalidated || res.statusCode >= 400) return;
    invalidated = true;
    invalidateReadModels(req);
  });
  return next();
}

module.exports = dashboardMutationState;
module.exports.dashboardReturnPath = dashboardReturnPath;
