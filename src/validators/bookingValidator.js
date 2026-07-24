const { body } = require('express-validator');

function validateAddonIds(value) {
  const values = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
  if (values.length > 20) throw new Error('No more than 20 add-ons may be selected');
  if (values.some((id) => !/^[A-Za-z0-9._:-]{1,180}$/.test(String(id || '').trim()))) throw new Error('An invalid add-on was selected');
  return true;
}

const bookingRules = [
  body('listingId').notEmpty().trim().isLength({ max: 180 }),
  body('fullName').notEmpty().trim().isLength({ max: 180 }),
  body('email').isEmail().normalizeEmail().isLength({ max: 254 }),
  body('phone').notEmpty().trim().isLength({ max: 80 }),
  body('addons').optional({ nullable: true }).custom(validateAddonIds),
];

const hotelBookingRules = [
  ...bookingRules,
  body('roomTypeId').notEmpty().trim().isLength({ max: 180 }),
  body('checkIn').isISO8601({ strict: true }).withMessage('A valid check-in date is required'),
  body('checkOut').isISO8601({ strict: true }).withMessage('A valid check-out date is required'),
  body('roomCount').optional({ checkFalsy: true }).isInt({ min: 1, max: 10 }),
  body('adults').optional({ checkFalsy: true }).isInt({ min: 1, max: 40 }),
  body('children').optional({ checkFalsy: true }).isInt({ min: 0, max: 40 }),
  body('specialRequests').optional({ checkFalsy: true }).trim().isLength({ max: 1200 }),
];

module.exports = { bookingRules, hotelBookingRules };
