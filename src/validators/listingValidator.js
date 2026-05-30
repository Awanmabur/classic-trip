const { body } = require('express-validator');
module.exports = { listingRules: [body('title').notEmpty().trim(), body('serviceType').notEmpty().trim(), body('priceFrom').isNumeric()] };
