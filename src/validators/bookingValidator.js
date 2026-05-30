const { body } = require('express-validator');
const bookingRules = [body('listingId').notEmpty(), body('fullName').notEmpty().trim(), body('email').isEmail().normalizeEmail(), body('phone').notEmpty().trim()];
module.exports = { bookingRules };
