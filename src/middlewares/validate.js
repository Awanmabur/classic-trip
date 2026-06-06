const { validationResult } = require('express-validator');

function validateRequest(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  const details = errors.array();
  if (req.originalUrl.startsWith('/api/') || String(req.headers.accept || '').includes('application/json')) {
    return res.status(422).json({ error: 'validation_failed', details });
  }
  return res.status(422).render('pages/error', {
    seo: { title: 'Validation failed | Classic Trip' },
    status: 422,
    message: details.map((item) => item.msg).join(', ') || 'Please check the form and try again.',
  });
}

module.exports = { validateRequest };
