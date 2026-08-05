const bookingPaymentService = require('../../services/payment/bookingPaymentService');
const webhookService = require('../../services/payment/webhookService');
async function initiate(req, res, next) {
  try {
    const result = await bookingPaymentService.initiate(req.body.bookingRef, req.body, {
      ...(req.session?.user || {}),
      idempotencyKey: req.headers['idempotency-key'] || req.body.idempotencyKey,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}
async function webhook(req, res, next) {
  try {
    const result = await webhookService.processPaymentWebhook(req.body, { ...req.headers, __rawBody: req.rawBody || '' });
    res.json(result);
  } catch (error) {
    next(error);
  }
}
module.exports = { initiate, webhook };
