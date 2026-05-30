const express = require('express');
const paymentController = require('../../controllers/api/paymentController');
const router = express.Router();
router.post('/payments', paymentController.webhook);
module.exports = router;
