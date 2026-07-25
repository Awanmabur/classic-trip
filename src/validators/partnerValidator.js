'use strict';
const { body } = require('express-validator');
const { supportedCurrencies } = require('../utils/currency');
const { PARTNER_PROFILE_KEYS, partnerProfile } = require('../config/partnerProfiles');

function text(value) { return String(value || '').trim(); }
function accepted(value) { return value === true || value === 'true' || value === 'on' || value === '1'; }

function requiredForProfile(field, message) {
  return body(field).custom((value, { req }) => {
    const profile = partnerProfile(req.body.partnerCategory);
    if (profile?.requiredFields.includes(field) && !text(value)) throw new Error(message);
    return true;
  });
}

const partnerOnboardingRules = [
  body('partnerCategory').trim().isIn(PARTNER_PROFILE_KEYS).withMessage('Choose the partner type that best describes how you will work on Classic Trip'),
  body('companyType').custom((value, { req }) => {
    const profile = partnerProfile(req.body.partnerCategory);
    if (!profile) throw new Error('Choose a valid partner type');
    if (text(value) && text(value) !== profile.companyType) throw new Error('Partner service and partner type do not match');
    req.body.companyType = profile.companyType;
    return true;
  }),
  body('name').trim().notEmpty().withMessage('Business or public profile name is required'),
  body('contactName').trim().notEmpty().withMessage('Account holder name is required'),
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
    if (accepted(value)) return true;
    throw new Error('You must accept the partner commission terms, verification rules and privacy policy');
  }),
  body('country').trim().notEmpty().withMessage('Country is required'),
  body('city').trim().notEmpty().withMessage('Operating city is required'),
  body('operatingCurrency').trim().custom((value) => {
    if (!supportedCurrencies().includes(String(value || '').toUpperCase())) throw new Error('Choose a currency enabled in Platform Settings');
    return true;
  }),
  requiredForProfile('legalName', 'Registered legal name is required for this partner type'),
  requiredForProfile('registrationNumber', 'Business registration number is required for this partner type'),
  requiredForProfile('agencyLicenceNumber', 'Travel agency licence or accreditation reference is required'),
  requiredForProfile('nationalIdNumber', 'National ID or passport number is required for drivers'),
  requiredForProfile('driverLicenceNumber', 'Valid driving licence number is required for drivers'),
  requiredForProfile('vehicleRegistrationNumber', 'Vehicle registration number is required for drivers'),
  requiredForProfile('driverLicenceExpiry', 'Driving licence expiry date is required for drivers'),
  requiredForProfile('vehicleType', 'Choose the vehicle type used for trips'),
  requiredForProfile('vehicleMake', 'Vehicle make is required for drivers'),
  requiredForProfile('vehicleModel', 'Vehicle model is required for drivers'),
  requiredForProfile('vehicleYear', 'Vehicle year is required for drivers'),
  requiredForProfile('vehicleColor', 'Vehicle colour is required for drivers'),
  requiredForProfile('insuranceExpiry', 'Insurance expiry date is required for drivers'),
  requiredForProfile('fleetSize', 'Fleet size is required for fleet partners'),
  requiredForProfile('vehicleTypes', 'Choose at least one vehicle type'),
  body('fleetSize').optional({ checkFalsy: true }).isInt({ min: 1, max: 100000 }).withMessage('Fleet size must be between 1 and 100,000'),
  body('taxNumber').optional({ checkFalsy: true }).trim(),
  body('headOfficeAddress').optional({ checkFalsy: true }).trim(),
  body('website').optional({ checkFalsy: true }).trim().isURL({ require_protocol: true }).withMessage('Website must include http:// or https://'),
  body('description').optional({ checkFalsy: true }).trim(),
  body('nationalIdNumber').optional({ checkFalsy: true }).trim().isLength({ min: 4, max: 80 }).withMessage('National ID or passport number is invalid'),
  body('driverLicenceNumber').optional({ checkFalsy: true }).trim().isLength({ min: 3, max: 80 }).withMessage('Driving licence number is invalid'),
  body('vehicleRegistrationNumber').optional({ checkFalsy: true }).trim().isLength({ min: 2, max: 32 }).withMessage('Vehicle registration number is invalid'),
  body('agencyLicenceNumber').optional({ checkFalsy: true }).trim().isLength({ min: 3, max: 120 }).withMessage('Agency licence or accreditation reference is invalid'),
  body('iataTidsNumber').optional({ checkFalsy: true }).trim().isLength({ max: 120 }),
  body('driverLicenceExpiry').optional({ checkFalsy: true }).isISO8601().withMessage('Driving licence expiry date is invalid'),
  body('insuranceExpiry').optional({ checkFalsy: true }).isISO8601().withMessage('Insurance expiry date is invalid'),
  body('vehicleYear').optional({ checkFalsy: true }).isInt({ min: 1980, max: new Date().getFullYear() + 1 }).withMessage('Vehicle year is invalid'),
  body('vehicleColor').optional({ checkFalsy: true }).trim().isLength({ min: 2, max: 40 }).withMessage('Vehicle colour is invalid'),
  body('inspectionExpiry').optional({ checkFalsy: true }).isISO8601().withMessage('Inspection expiry date is invalid'),
];

module.exports = { partnerOnboardingRules };
