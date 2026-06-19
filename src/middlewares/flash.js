function takeFlash(session = {}) {
  const messages = Array.isArray(session.flashMessages) ? session.flashMessages : [];
  session.flashMessages = [];
  return messages.filter((message) => message && message.text).map((message) => ({
    type: ['success', 'error', 'warning', 'info'].includes(message.type) ? message.type : 'info',
    text: String(message.text || '').slice(0, 280),
  }));
}

function pushFlash(req, type, text) {
  if (!req.session || !text) return;
  const message = {
    type: ['success', 'error', 'warning', 'info'].includes(type) ? type : 'info',
    text: String(text).replace(/\s+/g, ' ').trim().slice(0, 280),
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

function flashMiddleware(req, res, next) {
  req.flash = (type, text) => pushFlash(req, type, text);
  res.locals.flashMessages = takeFlash(req.session || {});
  res.locals.flash = res.locals.flashMessages;

  const originalRedirect = res.redirect.bind(res);
  res.redirect = function patchedRedirect(...args) {
    const statusOrUrl = args[0];
    const url = typeof statusOrUrl === 'number' ? args[1] : statusOrUrl;
    const isBackToLogin = String(url || '').startsWith('/login');
    if (req.method !== 'GET' && !req._ctHasFlash && !isBackToLogin) {
      pushFlash(req, 'success', actionName(req));
    }
    return originalRedirect(...args);
  };

  next();
}

module.exports = flashMiddleware;
module.exports.pushFlash = pushFlash;
