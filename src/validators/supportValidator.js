const { body } = require('express-validator');

const allowedCategories = [
  'Booking issue', 'Bus journey', 'Hotel stay', 'Flight booking', 'Local ride or boda',
  'Refund request', 'Ticket not received', 'Payment issue', 'Safety concern',
  'Partner inquiry', 'Promoter inquiry', 'Other',
];

const supportRules = [
  body('fullName').trim().isLength({ min: 2, max: 120 }).withMessage('Enter your full name'),
  body('contact').trim().isLength({ min: 5, max: 180 }).withMessage('Enter a valid email address or phone number'),
  body('message').trim().isLength({ min: 10, max: 3000 }).withMessage('Describe the issue in 10 to 3000 characters'),
  body('category').trim().isIn(allowedCategories).withMessage('Choose a valid support topic'),
  body('bookingRef').optional({ checkFalsy: true }).trim().isLength({ max: 120 }),
  body('priority').optional({ checkFalsy: true }).trim().isIn(['low', 'normal', 'high', 'urgent']),
  body('accessCode').optional({ checkFalsy: true }).trim().isLength({ max: 180 }),
  body('email').optional({ checkFalsy: true }).isEmail().normalizeEmail(),
  body('phone').optional({ checkFalsy: true }).trim().isLength({ max: 60 }),
];

module.exports = { supportRules, allowedCategories };
