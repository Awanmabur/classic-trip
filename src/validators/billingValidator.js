const { body } = require('express-validator');

const planIds = ['starter', 'growth', 'scale'];

const planRule = () => body('planId')
  .trim()
  .isIn(planIds)
  .withMessage('Choose a valid Classic Trip plan');

const onboardingRules = [
  planRule(),
  body('name').trim().notEmpty().withMessage('Company name is required'),
  body('companyType').trim().notEmpty().withMessage('Company type is required'),
  body('contactName').trim().notEmpty().withMessage('Contact name is required'),
  body('email').trim().isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('phone').trim().notEmpty().withMessage('Phone number is required'),
  body('country').optional().trim(),
  body('city').optional().trim(),
  body('description').optional().trim(),
];

const upgradeRules = [planRule()];

const checkoutRules = [
  body('provider').optional().trim(),
  body('paymentMethod').optional().trim(),
  body('paymentReference').optional().trim(),
];

module.exports = { onboardingRules, upgradeRules, checkoutRules };
