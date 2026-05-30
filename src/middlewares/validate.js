const { validationResult } = require('express-validator');

function validateRequest(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  return res.status(422).json({ error: 'validation_failed', details: errors.array() });
}

module.exports = { validateRequest };
