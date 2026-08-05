const { body } = require('express-validator');

const providers = ['pesapal', 'mtn_momo', 'airtel_money', 'flutterwave', 'paystack', 'dpo'];

module.exports = {
  paymentRules: [
    body('bookingRef').trim().notEmpty().isLength({ max: 180 }),
    body('provider').optional().isIn(providers),
    body('paymentProvider').optional().isIn(providers),
    body('idempotencyKey').optional().trim().isLength({ min: 8, max: 240 }),
    // Amount, currency and customer identity are intentionally not accepted as
    // authority here. The canonical payment service derives them from Booking.
    body('amount').optional().custom(() => { throw new Error('Payment amount is calculated from the booking'); }),
    body('currency').optional().custom(() => { throw new Error('Payment currency is calculated from the booking'); }),
  ],
};
