const logger = require('../config/logger');
const { pushFlash } = require('./flash');

function wantsJson(req) {
  return req.originalUrl.startsWith('/api/') || req.xhr || String(req.headers.accept || '').includes('application/json');
}

function safeBack(req) {
  const referer = req.get('referer') || '';
  if (!referer) return req.session?.user?.role === 'company_admin' ? '/company/dashboard' : '/';
  try {
    const url = new URL(referer, `${req.protocol}://${req.get('host')}`);
    return `${url.pathname}${url.search || ''}`;
  } catch (error) {
    return '/';
  }
}

function errorHandler(error, req, res, next) {
  logger.error(error.message, { stack: error.stack, path: req.originalUrl });
  const status = error.status || 500;
  const message = error.message || 'Something went wrong.';

  if (wantsJson(req)) return res.status(status).json({ error: message });

  if (req.method !== 'GET' && status < 500) {
    pushFlash(req, 'error', message);
    return res.redirect(safeBack(req));
  }

  if (req.method !== 'GET' && status >= 500) {
    pushFlash(req, 'error', 'We could not save this action. Please review the form and try again.');
    return res.redirect(safeBack(req));
  }

  return res.status(status).render('pages/error', {
    seo: { title: 'Classic Trip error' },
    status,
    message,
  });
}

module.exports = errorHandler;
