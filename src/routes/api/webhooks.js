const express = require('express');
const paymentController = require('../../controllers/api/paymentController');
const { webhookLimiter } = require('../../middlewares/rateLimit');
const router = express.Router();
router.post('/payments', webhookLimiter, paymentController.webhook);
module.exports = router;
