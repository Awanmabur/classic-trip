const bookingPaymentService = require('../../services/payment/bookingPaymentService');
const webhookService = require('../../services/payment/webhookService');
async function initiate(req, res, next) {
  try {
    const result = await bookingPaymentService.initiate(req.body.bookingRef, req.body, {
      ...(req.session?.user || {}),
      idempotencyKey: req.headers['idempotency-key'] || req.body.idempotencyKey,
    });
    if (result?.payment && typeof result.payment === 'object') {
      const { rawPayload, ...safePayment } = result.payment;
      result.payment = safePayment;
    }
    if (result?.intent && typeof result.intent === 'object') {
      const { rawPayload, ...safeIntent } = result.intent;
      result.intent = safeIntent;
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
}
function firstValue(...values) { return values.find((value) => value !== undefined && value !== null && String(value).trim() !== ''); }
function isPesapalIpn(payload = {}) { return Boolean(firstValue(payload.OrderTrackingId, payload.order_tracking_id, payload.orderTrackingId) && firstValue(payload.OrderMerchantReference, payload.order_merchant_reference, payload.merchant_reference)); }
async function webhook(req, res, next) {
  try {
    const payload = req.method === 'GET' ? { ...req.query } : { ...req.body };
    const result = await webhookService.processPaymentWebhook(payload, { ...req.headers, __rawBody: req.rawBody || '' });
    if (isPesapalIpn(payload)) {
      return res.status(200).json({
        orderNotificationType: String(firstValue(payload.OrderNotificationType, payload.order_notification_type, 'IPNCHANGE')),
        orderTrackingId: String(firstValue(payload.OrderTrackingId, payload.order_tracking_id, payload.orderTrackingId)),
        orderMerchantReference: String(firstValue(payload.OrderMerchantReference, payload.order_merchant_reference, payload.merchant_reference)),
        status: 200,
      });
    }
    return res.json(result);
  } catch (error) {
    return next(error);
  }
}
module.exports = { initiate, webhook };
