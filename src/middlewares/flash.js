function takeFlash(session = {}) {
  const messages = Array.isArray(session.flashMessages) ? session.flashMessages : [];
  session.flashMessages = [];
  return messages.filter((message) => message && message.text).map((message) => ({
    type: ['success', 'error', 'warning', 'info'].includes(message.type) ? message.type : 'info',
    text: String(message.text || '').slice(0, 700),
  }));
}

function pushFlash(req, type, text) {
  if (!req.session || !text) return;
  const message = {
    type: ['success', 'error', 'warning', 'info'].includes(type) ? type : 'info',
    text: String(text).replace(/\s+/g, ' ').trim().slice(0, 700),
  };
  if (!message.text) return;
  req.session.flashMessages = Array.isArray(req.session.flashMessages) ? req.session.flashMessages : [];
  req.session.flashMessages.push(message);
  req._ctHasFlash = true;
}

function actionName(req) {
  const path = String(req.originalUrl || req.path || '').split('?')[0];
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'GET') return '';
  if (/\/publish$/.test(path)) return 'Published successfully.';
  if (/\/archive$/.test(path)) return 'Archived successfully.';
  if (/\/complete$/.test(path)) return 'Completed successfully.';
  if (/\/duplicate$/.test(path)) return 'Duplicated successfully.';
  if (/\/check-in$/.test(path) || /\/checkins?$/.test(path)) return 'Check-in saved successfully.';
  if (/\/check-out$/.test(path)) return 'Check-out saved successfully.';
  if (/\/no-show$/.test(path)) return 'No-show saved successfully.';
  if (/\/status$/.test(path)) return 'Status updated successfully.';
  if (/\/move$/.test(path)) return 'Order updated successfully.';
  if (/\/housekeeping\//.test(path)) return 'Housekeeping updated successfully.';
  if (/\/payouts$/.test(path)) return 'Payout request submitted successfully.';
  if (/\/support\//.test(path) || /\/support\/notices$/.test(path)) return 'Support update saved successfully.';
  if (/\/bookings/.test(path)) return 'Booking update saved successfully.';
  return 'Saved successfully.';
}

function isAuthAction(req) {
  const path = String(req.originalUrl || req.path || '').split('?')[0];
  return ['/login', '/register', '/forgot-password', '/reset-password', '/logout'].includes(path)
    || path.startsWith('/auth/');
}


function companyDashboardPagesForMutation(path = '') {
  if (/\/(?:schedules|schedule-rules)(?:\/|$)/.test(path)) return ['overview', 'schedules', 'seat-maps'];
  if (/\/(?:vehicles|seat-map)(?:\/|$)/.test(path)) return ['overview', 'vehicles', 'seat-maps', 'schedules'];
  if (/\/(?:routes|route-stops|fares|fare-segments|addons)(?:\/|$)/.test(path)) return ['overview', 'routes', 'schedules'];
  if (/\/(?:bookings|checkins|manifests)(?:\/|$)/.test(path)) return ['overview', 'bookings', 'checkins', 'manifests', 'seat-maps'];
  if (/\/(?:hotels|rooms|room-types|rate-plans|housekeeping)(?:\/|$)/.test(path)) return ['overview', 'hotel-rooms', 'bookings', 'manifests'];
  if (/\/(?:staff|drivers|invitations|verification)(?:\/|$)/.test(path)) return ['overview', 'staff', 'schedules', 'mobility'];
  if (/\/(?:support|refunds|reschedules)(?:\/|$)/.test(path)) return ['overview', 'support'];
  if (/\/(?:payments|finance|settlements|payouts)(?:\/|$)/.test(path)) return ['overview', 'finance'];
  if (/\/(?:listings|bus-services|media|promotions)(?:\/|$)/.test(path)) return ['overview', 'listings'];
  return ['overview'];
}

function invalidateDashboardMutation(req, mutationPath) {
  const snapshotService = require('../services/dashboard/dashboardSnapshotService');
  if (mutationPath.startsWith('/company/')) {
    const companyId = String(req.session?.user?.companyId || '').trim();
    if (!companyId) return;
    const pages = companyDashboardPagesForMutation(mutationPath);
    ['company', 'employee', 'driver'].forEach((role) => {
      pages.forEach((activePage) => snapshotService.invalidate(role, {
        companyId,
        activePage,
        invalidateHead: /\/(?:profile|company-profile|onboarding)(?:\/|$)/.test(mutationPath),
      }));
    });
    return;
  }
  if (mutationPath.startsWith('/admin/')) {
    const segment = mutationPath.split('/').filter(Boolean)[1] || 'overview';
    snapshotService.invalidate('admin', { activePage: segment });
    snapshotService.invalidate('admin', { activePage: 'overview' });
  }
}

function flashMiddleware(req, res, next) {
  req.flash = (type, text) => pushFlash(req, type, text);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || '').toUpperCase())) {
    const mutationPath = String(req.originalUrl || req.path || '').split('?')[0];
    const skipDashboardInvalidation = mutationPath === '/login'
      || mutationPath === '/logout'
      || mutationPath.startsWith('/auth/mfa');
    res.once('finish', () => {
      if (!skipDashboardInvalidation && res.statusCode < 500) {
        // Do not clear every dashboard snapshot for every POST (including
        // checkout holds and unrelated public forms). Invalidate only the
        // tenant/page families touched by this mutation.
        try { invalidateDashboardMutation(req, mutationPath); } catch (_) {}
        const affectsPublicCatalog = /\/(?:company|admin)\/(?:bus-services|listings|routes|route-stops|vehicles|fares|fare-segments|addons|schedules|schedule-rules|hotels|media|promotions|blogs|categories)(?:\/|$)/.test(mutationPath);
        if (affectsPublicCatalog) {
          try { require('../services/marketplace/catalogService').invalidateMarketplaceCache(); } catch (_) {}
        }
      }
    });
  }
  res.locals.flashMessages = takeFlash(req.session || {});
  res.locals.flash = res.locals.flashMessages;

  const originalRedirect = res.redirect.bind(res);
  res.redirect = function patchedRedirect(...args) {
    const statusOrUrl = args[0];
    const url = typeof statusOrUrl === 'number' ? args[1] : statusOrUrl;
    const isBackToLogin = String(url || '').startsWith('/login');
    if (req.method !== 'GET' && !req._ctHasFlash && !isBackToLogin && !isAuthAction(req)) {
      pushFlash(req, 'success', actionName(req));
    }
    return originalRedirect(...args);
  };

  next();
}

module.exports = flashMiddleware;
module.exports.pushFlash = pushFlash;
