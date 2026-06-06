const { body } = require('express-validator');
module.exports = {
  withdrawalRules: [
    body('amount').isFloat({ min: 1 }),
    body('method').optional().trim(),
    body('currency').optional().trim(),
  ],
};
