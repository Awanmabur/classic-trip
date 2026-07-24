const { body } = require('express-validator');
const { supportedCurrencies } = require('../utils/currency');

const partnerOnboardingRules = [
  body('name').trim().notEmpty().withMessage('Company name is required'),
  body('legalName').trim().notEmpty().withMessage('Registered legal name is required'),
  body('companyType').trim().isIn(['bus', 'hotel']).withMessage('Choose Bus or Hotel as the company type'),
  body('contactName').trim().notEmpty().withMessage('Contact name is required'),
  body('email').trim().isEmail().withMessage('Valid email is required'),
  body('phone').trim().notEmpty().withMessage('Phone number is required'),
  body('password').custom((value) => {
    const password = String(value || '');
    if (password.length < 8 || password.length > 72) throw new Error('Password must be between 8 and 72 characters');
    if (!/[A-Za-z]/.test(password)) throw new Error('Password must contain a letter');
    if (!/[0-9]/.test(password)) throw new Error('Password must contain a number');
    return true;
  }),
  body('confirmPassword').custom((value, { req }) => {
    if (String(value || '') !== String(req.body.password || '')) throw new Error('Passwords do not match');
    return true;
  }),
  body('termsAccepted').custom((value) => {
    if (value === true || value === 'true' || value === 'on' || value === '1') return true;
    throw new Error('You must accept the partner commission terms, verification rules and privacy policy');
  }),
  body('country').trim().notEmpty().withMessage('Country is required'),
  body('city').trim().notEmpty().withMessage('Head-office city is required'),
  body('operatingCurrency').trim().custom((value) => {
    if (!supportedCurrencies().includes(String(value || '').toUpperCase())) throw new Error('Choose a currency enabled in Platform Settings');
    return true;
  }),
  body('registrationNumber').optional({ checkFalsy: true }).trim(),
  body('taxNumber').optional({ checkFalsy: true }).trim(),
  body('headOfficeAddress').optional({ checkFalsy: true }).trim(),
  body('website').optional({ checkFalsy: true }).trim().isURL({ require_protocol: true }).withMessage('Website must include http:// or https://'),
  body('description').optional({ checkFalsy: true }).trim(),
];

module.exports = { partnerOnboardingRules };
