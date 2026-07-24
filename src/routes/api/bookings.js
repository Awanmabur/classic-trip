const express = require('express');
const bookingController = require('../../controllers/api/bookingController');
const { bookingRules } = require('../../validators/bookingValidator');
const { validateRequest } = require('../../middlewares/validate');
const { paymentLimiter, ticketLimiter } = require('../../middlewares/rateLimit');
const router = express.Router();
router.post('/', paymentLimiter, bookingRules, validateRequest, bookingController.create);
router.get('/:bookingRef', ticketLimiter, bookingController.show);
module.exports = router;
