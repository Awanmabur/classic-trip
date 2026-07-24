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

const isProduction = process.env.NODE_ENV === 'production';


function cleanFieldName(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9_. -]/g, '')
    .replace(/[_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function normalizeOperationalError(error) {
  if (!error || error.status) return error;

  if (error.name === 'ValidationError' || error.name === 'ValidatorError') {
    const details = Object.values(error.errors || {})
      .map((entry) => String(entry?.message || '').trim())
      .filter(Boolean)
      .slice(0, 6);
    error.status = 422;
    error.code = error.code || 'database_validation_error';
    error.publicMessage = details.length
      ? `Please correct the form: ${details.join('; ')}`
      : 'Please correct the invalid form values and try again.';
    return error;
  }

  if (error.name === 'CastError') {
    const field = cleanFieldName(error.path) || 'selected field';
    error.status = 422;
    error.code = error.code || 'invalid_field_value';
    error.publicMessage = `${field} has an invalid value.`;
    return error;
  }

  if (Number(error.code) === 11000) {
    const fields = Object.keys(error.keyValue || error.keyPattern || {})
      .map(cleanFieldName)
      .filter(Boolean);
    error.status = 409;
    error.code = 'duplicate_record';
    error.publicMessage = fields.length
      ? `A record with the same ${fields.join(', ')} already exists.`
      : 'This record already exists.';
  }

  return error;
}

function publicMessage(status, message, safeMessage = '') {
  if (safeMessage) return safeMessage;
  if (!isProduction) return message;
  if (status >= 500) return 'An unexpected error occurred. Please try again.';
  return message;
}

function errorHandler(error, req, res, next) {
  normalizeOperationalError(error);
  const status = error.status || 500;
  if (status >= 500) {
    logger.error(error.message, { stack: error.stack, path: req.originalUrl, status });
  } else {
    logger.warn(error.message, { path: req.originalUrl, status });
  }

  const message = publicMessage(status, error.message || 'Something went wrong.', error.publicMessage);

  if (wantsJson(req)) return res.status(status).json({ error: message });

  if (req.method !== 'GET' && status === 415) {
    return res.status(status).send(message);
  }

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
module.exports.normalizeOperationalError = normalizeOperationalError;
