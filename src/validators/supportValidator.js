const { body } = require('express-validator');

const supportRules = [
  body('message').notEmpty().trim(),
  body('category').optional().trim(),
  body('bookingRef').optional().trim(),
  body('priority').optional().trim(),
  body('contact').optional().trim(),
  body('email').optional().isEmail().normalizeEmail(),
  body('phone').optional().trim(),
];

module.exports = { supportRules };
