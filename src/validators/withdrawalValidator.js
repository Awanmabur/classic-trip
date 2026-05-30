const { body } = require('express-validator');
module.exports = { withdrawalRules: [body('amount').isFloat({ min: 1 }), body('method').notEmpty().trim()] };
