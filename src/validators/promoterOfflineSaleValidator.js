'use strict';

const { body } = require('express-validator');

function validateIdList(value) {
  const values = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
  if (values.length > 80) throw new Error('Too many selections were submitted');
  if (values.some((item) => !/^[A-Za-z0-9._:-]{1,180}$/.test(String(item || '').trim()))) throw new Error('An invalid inventory selection was submitted');
  return true;
}

const offlineSaleRules = [
  body('listingId').notEmpty().trim().isLength({ max: 180 }),
  body('fullName').notEmpty().trim().isLength({ max: 180 }),
  body('email').isEmail().normalizeEmail().isLength({ max: 254 }),
  body('phone').notEmpty().trim().isLength({ max: 80 }),
  body('amountCollected').isFloat({ min: 0.01, max: 1_000_000_000_000 }),
  body('currency').notEmpty().trim().isLength({ min: 3, max: 8 }),
  body('paymentMethod').equals('cash'),
  body('paymentReference').notEmpty().trim().isLength({ min: 2, max: 120 }),
  body('scheduleId').optional({ checkFalsy: true }).trim().isLength({ max: 180 }),
  body('returnScheduleId').optional({ checkFalsy: true }).trim().isLength({ max: 180 }),
  body('originStopId').optional({ checkFalsy: true }).trim().isLength({ max: 180 }),
  body('destinationStopId').optional({ checkFalsy: true }).trim().isLength({ max: 180 }),
  body('returnOriginStopId').optional({ checkFalsy: true }).trim().isLength({ max: 180 }),
  body('returnDestinationStopId').optional({ checkFalsy: true }).trim().isLength({ max: 180 }),
  body('selectedSeats').optional({ nullable: true }).custom(validateIdList),
  body('returnSeats').optional({ nullable: true }).custom(validateIdList),
  body('roomTypeId').optional({ checkFalsy: true }).trim().isLength({ max: 180 }),
  body('ratePlanId').optional({ checkFalsy: true }).trim().isLength({ max: 180 }),
  body('roomUnitIds').optional({ nullable: true }).custom(validateIdList),
  body('addons').optional({ nullable: true }).custom(validateIdList),
  body('roomCount').optional({ checkFalsy: true }).isInt({ min: 1, max: 10 }),
  body('adults').optional({ checkFalsy: true }).isInt({ min: 1, max: 40 }),
  body('children').optional({ checkFalsy: true }).isInt({ min: 0, max: 40 }),
  body('infants').optional({ checkFalsy: true }).isInt({ min: 0, max: 40 }),
  body('notes').optional({ checkFalsy: true }).trim().isLength({ max: 1200 }),
  body('specialRequests').optional({ checkFalsy: true }).trim().isLength({ max: 1200 }),
];

module.exports = { offlineSaleRules };
