const { body } = require('express-validator');
module.exports = { companyRules: [body('name').notEmpty().trim(), body('companyType').notEmpty().trim()] };
