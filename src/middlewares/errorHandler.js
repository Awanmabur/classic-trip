const logger = require('../config/logger');

function errorHandler(error, req, res, next) {
  logger.error(error.message, { stack: error.stack, path: req.originalUrl });
  const status = error.status || 500;
  if (req.originalUrl.startsWith('/api/')) return res.status(status).json({ error: error.message || 'server_error' });
  return res.status(status).render('pages/error', {
    seo: { title: 'Classic Trip error' },
    status,
    message: error.message || 'Something went wrong.',
  });
}

module.exports = errorHandler;
