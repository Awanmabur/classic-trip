const { body } = require('express-validator');
const billingService = require('../services/billing/billingService');
const { supportedCurrencies } = require('../utils/currency');

const planRule = () => body('planId').trim().custom((value) => {
  if (!billingService.findPlan(value)) throw new Error('Choose a valid active Classic Trip plan');
  return true;
});

const onboardingRules = [
  planRule(),
  body('name').trim().notEmpty().withMessage('Company name is required'),
  body('companyType').trim().isIn(['bus', 'hotel']).withMessage('Choose Bus or Hotel as the company type'),
  body('contactName').trim().notEmpty().withMessage('Contact name is required'),
  body('email').trim().isEmail().withMessage('Valid email is required'),
  body('phone').trim().notEmpty().withMessage('Phone number is required'),
  body('password').custom((value, { req }) => {
    const signedInOwner = req.session?.user?.role === 'company_admin';
    if (signedInOwner && !value) return true;
    const password = String(value || '');
    if (password.length < 8 || password.length > 72) throw new Error('Password must be between 8 and 72 characters');
    if (!/[A-Za-z]/.test(password)) throw new Error('Password must contain a letter');
    if (!/[0-9]/.test(password)) throw new Error('Password must contain a number');
    return true;
  }),
  body('confirmPassword').custom((value, { req }) => {
    const signedInOwner = req.session?.user?.role === 'company_admin';
    if (signedInOwner && !req.body.password && !value) return true;
    if (String(value || '') !== String(req.body.password || '')) throw new Error('Passwords do not match');
    return true;
  }),
  body('termsAccepted').custom((value) => {
    if (value === true || value === 'true' || value === 'on' || value === '1') return true;
    throw new Error('You must accept the partner terms and privacy rules');
  }),
  body('country').optional().trim(),
  body('operatingCurrency').trim().custom((value) => {
    if (!supportedCurrencies().includes(String(value || '').toUpperCase())) throw new Error('Choose a currency enabled in Platform Settings');
    return true;
  }),
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
