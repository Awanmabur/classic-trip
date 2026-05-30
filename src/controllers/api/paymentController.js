const paymentService = require("../../services/payment/paymentService");
const webhookService = require('../../services/payment/webhookService');
async function initiate(req, res, next) {
  try {
    const payment = await paymentService.initiatePayment(req.body);
    res.json({ payment });
  } catch (error) {
    next(error);
  }
}
async function webhook(req, res, next) {
  try {
    const result = await webhookService.processPaymentWebhook(req.body, req.headers);
    res.json(result);
  } catch (error) {
    next(error);
  }
}
module.exports = { initiate, webhook };
