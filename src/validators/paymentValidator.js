const { body } = require('express-validator');
module.exports = { paymentRules: [body('bookingRef').notEmpty(), body('amount').optional().isNumeric()] };
