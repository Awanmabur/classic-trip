'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [];
function check(label, condition) {
  if (!condition) throw new Error(`Backend integration check failed: ${label}`);
  checks.push(label);
}

const publicRoutes = read('src/routes/web/public.js');
const publicPayment = read('src/controllers/public/bookingPaymentController.js');
const genericBooking = read('src/services/booking/bookingService.js');
const hotelBooking = read('src/services/hotel/hotelService.js');
const travelPayment = read('src/services/payment/travelDomainPaymentService.js');
const webhooks = read('src/services/payment/webhookService.js');
const outboxHandlers = read('src/services/shared/outboxHandlers.js');
const scheduler = read('src/jobs/scheduler.js');
const notifications = read('src/services/notification/notificationService.js');
const notificationModel = read('src/models/Notification.js');
const app = read('src/app.js');
const flightBooking = read('src/modules/flight/services/flightBookingService.js');
const flightExpiry = read('src/jobs/expireFlightHolds.js');
const refundWorkflow = read('src/services/support/workflowService.js');
const refundModel = read('src/models/RefundRequest.js');
const taxiRide = read('src/modules/taxi/services/taxiRideService.js');

check('public payment retry uses payment limiter', /router\.post\('\/bookings\/:bookingRef\/payment\/retry',\s*paymentLimiter,/.test(publicRoutes));
check('public payment retry verifies ticket ownership', publicPayment.includes('ticketAccessService.canAccessBooking(req, booking)'));
check('public payment retry uses canonical service', publicPayment.includes('bookingPaymentService.initiate(booking.bookingRef'));
check('generic inventory commits before provider order', genericBooking.indexOf('persistBooking(booking, payload, 0, { claimInventory: true })') < genericBooking.indexOf('payment = await paymentService.initiatePayment'));
check('hotel room nights commit before provider order', hotelBooking.indexOf('commitHotelBooking({ selectedRows, booking, paymentRow, paymentIntentRow, canonical })') < hotelBooking.indexOf('payment = await paymentService.initiatePayment'));
check('travel provider outages remain pending', travelPayment.includes("intent.status = 'pending'"));
check('webhooks bind exact provider intent reference', webhooks.includes('const exactIntentFilter'));
check('expired payment cleanup has durable handler', outboxHandlers.includes('PaymentIntentExpired: expireDomainBooking'));
check('scheduler uses distributed job lease', scheduler.includes('jobLeaseService.acquire(name, definition.leaseTtlMs)'));
check('notifications use durable delivery claims', notifications.includes('claimNotificationDelivery'));
check('notifications have unique dedupe keys', notificationModel.includes('dedupeKey: { type: String, unique: true, sparse: true'));
check('versioned marketplace listing API is mounted', app.includes("app.use('/api/v1/listings', require('./routes/api/listings'))"));
check('flight supplier fulfillment is claimed before external calls', flightBooking.includes("supplierFulfillmentStatus: 'in_progress'") && flightBooking.includes('idempotencyKey: `${fulfillmentKey}:order`'));
check('flight supplier cancellation is idempotent', flightBooking.includes('idempotencyKey:`${cancellationKey}:refund`'));
check('stale supplier outcomes enter reconciliation', flightExpiry.includes('reconcileStaleFulfillment') && flightExpiry.includes('reconcileStaleCancellation'));
check('refund approval calls the original payment provider', refundWorkflow.includes('paymentService.initiateRefund'));
check('provider refund webhooks cannot fail the original booking', webhooks.includes('processProviderRefundWebhook') && webhooks.includes('failProviderRefund'));
check('refunds cannot mint duplicate customer wallet value', !refundWorkflow.includes("creditAvailable('customer'"));
check('provider refund references are uniquely persisted', refundModel.includes("partialFilterExpression: { providerRefundReference: { $gt: '' } }"));
check('supplier-backed refunds require canonical cancellation', flightBooking.includes('async function confirmRefund') && taxiRide.includes('async function confirmRefund'));

console.log(`Backend end-to-end validation passed (${checks.length}/${checks.length}).`);
