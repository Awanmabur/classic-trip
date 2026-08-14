'use strict';

const fs = require('fs');
const path = require('path');
const { handlers, requireSuccessfulDelivery } = require('../../src/services/shared/outboxHandlers');
const { safeName } = require('../../src/services/shared/jobLeaseService');
const { toCsv } = require('../../src/services/hotel/hotelService');

const root = path.join(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

describe('backend end-to-end integration contracts', () => {
  test('every emitted durable domain topic has an outbox handler', () => {
    const requiredTopics = [
      'ScheduleRuleMaterializationRequested',
      'BusListingPublished', 'BusDeparturePublished', 'BusDepartureActive',
      'BusDepartureBoarding', 'BusDepartureDelayed', 'BusDepartureDeparted',
      'BusDepartureArrived', 'BusDepartureCompleted', 'BusDepartureCancelled', 'BusDepartureArchived',
      'BusBookingCreated', 'BusBookingConfirmed', 'BusBookingCancelled', 'BusBookingRefunded',
      'BusInventoryHeld', 'BusInventoryBooked', 'BusInventoryHoldExpired', 'BusInventoryReleased',
      'BusPassengerCheckedIn', 'BusIncidentReported',
      'FlightTicketIssued', 'FlightOrderRefunded', 'FlightScheduleChanged', 'FlightSeatHoldExpired',
      'TaxiRidePaymentConfirmed', 'TaxiRideRefunded', 'TaxiCustomerIncidentReported',
      'PaymentIntentExpired',
      'notification.secure_requested', 'notification.requested', 'audit.write',
    ];
    requiredTopics.forEach((topic) => expect(typeof handlers[topic]).toBe('function'));
  });

  test('outbox claims reclaim expired processing locks', () => {
    const source = read('src/services/shared/outboxService.js');
    expect(source).toContain("{ status: 'processing', lockedAt: { $lte: lockExpiredAt } }");
  });

  test('expired locks release canonical segment inventory and domain cleanup is durable', () => {
    const cleanup = read('src/jobs/cleanupExpiredLocks.js');
    const expiry = read('src/jobs/expirePaymentIntents.js');
    expect(cleanup).toContain('busInventoryService.expireStaleHolds()');
    expect(expiry).toContain("topic: 'PaymentIntentExpired'");
    expect(expiry).toContain('outboxService.persistInSession(event, session)');
  });

  test('worker notification credentials are sourced from declared web variables', () => {
    const render = read('render.yaml');
    const smsUrlDeclarations = (render.match(/- key: SMS_API_URL/g) || []).length;
    const smsTokenDeclarations = (render.match(/- key: SMS_API_TOKEN/g) || []).length;
    expect(smsUrlDeclarations).toBe(2);
    expect(smsTokenDeclarations).toBe(2);
  });

  test('scheduler uses a distributed renewable lease for every job run', () => {
    const source = read('src/jobs/scheduler.js');
    expect(source).toContain('jobLeaseService.acquire(name, definition.leaseTtlMs)');
    expect(source).toContain('jobLeaseService.keepAlive(lease, definition.leaseTtlMs)');
    expect(source).toContain('await lease.release()');
    expect(safeName('materialize schedules/../../')).toBe('materialize_schedules_______');
  });

  test('dashboard payment and delay actions dispatch through canonical domain services', () => {
    const source = read('src/services/dashboard/actionService.js');
    expect(source).toContain('companyService.transitionSchedule(companyId, payload.scheduleId');
    expect(source).toContain('busBookingService.confirmPayment(booking.bookingRef');
    expect(source).toContain('flightBookingService.confirmPayment(booking.bookingRef');
    expect(source).toContain('taxiRideService.confirmPayment(booking.bookingRef');
  });

  test('versioned marketplace API paths used by the browser are mounted', () => {
    const app = read('src/app.js');
    const listingPage = read('src/views/pages/listing-details.ejs');
    expect(listingPage).toContain('/api/v1/listings/');
    expect(app).toContain("app.use('/api/v1/listings', require('./routes/api/listings'))");
    expect(app).toContain("app.use('/api/v1/bus', require('./modules/bus/routes/publicBusRoutes'))");
    expect(app).toContain("app.use('/api/v1/flights', require('./modules/flight/routes/publicFlightRoutes'))");
    expect(app).toContain("app.use('/api/v1/taxi', require('./modules/taxi/routes/publicTaxiRoutes'))");
  });

  test('notification contracts are extensible and retries use durable deduplication', () => {
    const model = read('src/models/Notification.js');
    const service = read('src/services/notification/notificationService.js');
    expect(model).toContain('dedupeKey: { type: String, unique: true, sparse: true');
    expect(model).not.toContain("referenceType: { type: String, enum:");
    expect(service).toContain('claimNotificationDelivery');
    expect(service).toContain('dispatchLeaseUntil');
    const reminders = read('src/jobs/bookingReminders.js');
    expect(reminders).toContain('notificationService.enqueueNotification');
    expect(reminders).toContain('reminderQueuedAt');
    expect(() => requireSuccessfulDelivery([{ channel: 'email', deliveryStatus: 'sent' }])).not.toThrow();
    expect(() => requireSuccessfulDelivery([{ channel: 'sms', deliveryStatus: 'failed' }])).toThrow();
  });

  test('blank payment provider references do not collide in unique indexes', () => {
    const payment = read('src/models/Payment.js');
    const intent = read('src/models/PaymentIntent.js');
    expect(payment).toContain("partialFilterExpression: { providerReference: { $gt: '' } }");
    expect(intent).toContain("partialFilterExpression: { providerReference: { $gt: '' } }");
  });

  test('public payment retry is protected and provider outages preserve retryable inventory', () => {
    const routes = read('src/routes/web/public.js');
    const controller = read('src/controllers/public/bookingPaymentController.js');
    const generic = read('src/services/booking/bookingService.js');
    const bus = read('src/modules/bus/services/busBookingService.js');
    const hotel = read('src/services/hotel/hotelService.js');
    expect(routes).toContain("router.post('/bookings/:bookingRef/payment/retry', paymentLimiter, rejectPublicFieldTampering, bookingPaymentController.retry)");
    expect(controller).toContain('ticketAccessService.canAccessBooking(req, booking)');
    expect(controller).toContain('accessGranted: true');
    expect(generic.indexOf('persistBooking(booking, payload, 0, { claimInventory: true })')
      < generic.indexOf('payment = await paymentService.initiatePayment')).toBe(true);
    expect(hotel.indexOf('commitHotelBooking({ selectedRows, booking, paymentRow, paymentIntentRow, canonical })')
      < hotel.indexOf('payment = await paymentService.initiatePayment')).toBe(true);
    expect(generic).toContain("paymentInitiationStatus: 'retry_required'");
    expect(bus).toContain("status: 'initiation_error'");
    expect(bus).toContain("bookingStatus: providerSucceeded ? 'payment_processing'");
  });

  test('flight supplier side effects are outside retryable Mongo transactions', () => {
    const flight = read('src/modules/flight/services/flightBookingService.js');
    const model = read('src/models/FlightOrder.js');
    const expiry = read('src/jobs/expireFlightHolds.js');
    const fulfillmentCall = flight.indexOf('const supplierResult = await orderAdapter.order');
    const fulfillmentTransaction = flight.indexOf('const confirmed = await repo.withTransaction');
    const cancellationCall = flight.indexOf('supplierResult=await adapter.refund');
    const cancellationTransaction = flight.indexOf('return repo.withTransaction(async(session)=>{', cancellationCall);
    expect(fulfillmentCall > 0 && fulfillmentCall < fulfillmentTransaction).toBe(true);
    expect(cancellationCall > 0 && cancellationCall < cancellationTransaction).toBe(true);
    expect(flight).toContain('idempotencyKey: `${fulfillmentKey}:ticket:${traveler.id}`');
    expect(flight).toContain('idempotencyKey:`${cancellationKey}:refund`');
    expect(model).toContain('supplierFulfillmentStatus');
    expect(model).toContain('supplierCancellationStatus');
    expect(expiry).toContain('reconcileStaleFulfillment');
    expect(expiry).toContain('reconcileStaleCancellation');
  });

  test('refund approval uses the provider rail without duplicate customer compensation', () => {
    const workflow = read('src/services/support/workflowService.js');
    const webhooks = read('src/services/payment/webhookService.js');
    const refundModel = read('src/models/RefundRequest.js');
    const flight = read('src/modules/flight/services/flightBookingService.js');
    const taxi = read('src/modules/taxi/services/taxiRideService.js');
    expect(workflow).toContain('paymentService.initiateRefund');
    expect(workflow).toContain('remainingRefundable');
    expect(workflow).not.toContain("creditAvailable('customer'");
    expect(webhooks).toContain('processProviderRefundWebhook');
    expect(webhooks).toContain("payload.refundLifecycleStatus || (status === 'refunded' && matchingRefund)");
    expect(refundModel).toContain('providerRefundStatus');
    expect(refundModel).toContain("partialFilterExpression: { providerRefundReference: { $gt: '' } }");
    expect(flight).toContain('async function confirmRefund');
    expect(taxi).toContain('async function confirmRefund');
  });

  test('CSV exports neutralize spreadsheet formulas', () => {
    const csv = toCsv([{ key: 'name', label: 'Name' }], [
      { name: '=HYPERLINK("https://example.invalid")' },
      { name: '+cmd' },
      { name: '@SUM(1,2)' },
    ]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+cmd");
    expect(csv).toContain("'@SUM");
    const reports = read('src/services/report/reportService.js');
    expect(reports).toContain("/^[a-zA-Z0-9_-]{1,80}$/");
    expect(reports).toContain('if (!HEADERS[key])');
  });
});
