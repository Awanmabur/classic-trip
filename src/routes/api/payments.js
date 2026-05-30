const express = require('express');
const paymentController = require('../../controllers/api/paymentController');
const { paymentLimiter } = require('../../middlewares/rateLimit');
const router = express.Router();
router.get('/providers', (req, res) => res.json({ providers: ['mock', 'mtn_momo', 'airtel_money', 'flutterwave', 'paystack', 'dpo'], active: 'mock' }));
router.post('/initiate', paymentLimiter, paymentController.initiate);
router.post('/mock/checkout', paymentLimiter, paymentController.initiate);
module.exports = router;
