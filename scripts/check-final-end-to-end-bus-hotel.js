'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [];

function check(name, condition) {
  checks.push({ name, ok: Boolean(condition) });
}

const busDomain = read('src/modules/bus/domain/busDomain.js');
const busDraft = read('src/modules/bus/services/busBookingDraftService.js');
const listingDetails = read('src/views/pages/listing-details.ejs');
const bookingForm = read('src/views/pages/booking-form.ejs');
const bookingValidator = read('src/validators/bookingValidator.js');
const hotelService = read('src/services/hotel/hotelService.js');
const hotelRepository = read('src/repositories/domain/hotelRepository.js');
const dashboardAction = read('src/services/dashboard/actionService.js');
const dashboardRepository = read('src/repositories/domain/dashboardActionRepository.js');
const webhookService = read('src/services/payment/webhookService.js');
const notificationService = read('src/services/notification/notificationService.js');
const listingController = read('src/controllers/public/listingController.js');
const ticketPdf = read('src/services/pdf/ticketPdfService.js');
const companyRoutes = read('src/routes/web/company.js');
const employeeRoutes = read('src/routes/web/employee.js');
const employeeCheckin = read('src/controllers/employee/checkinController.js');
const publicApiListings = read('src/routes/api/listings.js');
const dashboardJs = read('public/js/dashboard-workspace.js');
const projection = read('src/services/dashboard/dashboardProjectionEngine.js');
const setupService = read('src/modules/bus/services/busSetupService.js');
const hotelSection = read('src/views/dashboards/shared/sections/hotel-rooms.ejs');
const ticketView = read('src/views/pages/ticket.ejs');
const successView = read('src/views/pages/booking-success.ejs');
const hotelInventory = read('src/services/hotel/hotelInventoryService.js');
const roomReservation = read('src/services/booking/roomReservationService.js');

// Bus stop-to-stop pricing and route stop selection.
check('Exact stop-pair fare has first priority', busDomain.includes("source: 'exact'"));
check('Connected configured fares are supported', busDomain.includes("source: adjacentOnly ? 'segment_sum' : 'configured_fare_path'"));
check('Full-route fare is a fallback', busDomain.includes("source: 'direct_route_fare_fallback'"));
check('Schedule base fare is the final fallback', busDomain.includes("source: 'schedule_base_fare_fallback'"));
check('Boarding stop labels are rendered from route stops', listingDetails.includes('Board at: <%= stop.name %>'));
check('Drop-off stop labels are rendered from route stops', listingDetails.includes('Drop at: <%= stop.name %>'));
check('Dynamic route-stop choices preserve stop order', listingDetails.includes('data-stop-order'));
check('Invalid reverse stop order is blocked in the UI', listingDetails.includes('option.disabled = Number(option.dataset.stopOrder || -1) <= originOrder'));
check('Proceed to payment uses checkout preparation', listingDetails.includes("fetch('/book/bus/<%= listing.slug %>/prepare'"));
check('No visible Hold ticket action remains', !listingDetails.includes('Hold ticket') && !listingDetails.includes('data-listing-action="hold"'));
check('No old hold-preview function remains', !listingDetails.includes('holdPreviewInventory'));
check('Checkout creates internal bus inventory protection', busDraft.includes('await inventoryService.holdSeats(') && busDraft.includes('createdInternally = true'));
check('Expired checkout inventory is transparently reacquired', busDraft.includes('resolveOrReacquireLeg') && busDraft.includes('checkout_reacquire_'));
check('Return checkout protects both journey legs', busDraft.includes("resolveOrReacquireLeg(req, draft, 'return'"));
check('Return preparation releases outbound inventory after failure', busDraft.includes('return_checkout_prepare_failed'));

// Hotel booking, availability, pricing, and payment lifecycle.
check('Hotel booking validates a bounded stay window', hotelService.includes('assertHotelStayWindow') && hotelService.includes('Hotel stays must be between 1 and 90 nights'));
check('Hotel room count is bounded server-side', hotelService.includes('Room count must be between 1 and 10'));
check('Hotel guest capacity is checked server-side', hotelService.includes('can accommodate at most'));
check('Hotel room-night availability is queried for every date', hotelService.includes('availableNightGroups') && hotelService.includes('selectedRows = groups.flat()'));
check('Hotel add-ons are priced on the server', hotelService.includes('priceHotelAddons({') && hotelService.includes('addonPricing.total'));
check('Hotel room, occupancy, add-on, tax and property fees are recomputed server-side', hotelService.includes('const taxableRoomTotal = roomSubtotal + occupancySurcharge') && hotelService.includes('const subtotal = taxableRoomTotal + addonPricing.total + propertyTax + propertyServiceFee'));
check('Untrusted clients cannot set manual hotel payment status', hotelService.includes("error.code = 'untrusted_manual_payment'"));
check('Pending hotel bookings create payment intents', hotelService.includes('paymentIntentRow') && hotelService.includes("idempotencyKey: `hotel-intent:${bookingRef}`"));
check('Room-night claims are committed transactionally', hotelRepository.includes('async function commitHotelBooking') && hotelRepository.includes('return transaction(async (session) =>'));
check('Paid hotel room nights become booked', hotelRepository.includes("const inventoryStatus = booking.paymentStatus === 'successful' ? 'booked' : 'reserved'"));
check('Payment webhooks update hotel room-night lifecycle', webhookService.includes('persistHotelNightLifecycle') && webhookService.includes("status: 'booked'"));
check('Webhook amount and currency are verified', /amount mismatch|amount_mismatch/i.test(webhookService) && /currency mismatch|currency_mismatch/i.test(webhookService));
check('Paid-only hotel check-in is enforced', hotelService.includes('Payment must be confirmed before a hotel guest can check in or check out'));
check('Hotel stay transitions are transactional', hotelRepository.includes('async function commitStayTransition') && hotelRepository.includes("normalized === 'checked_in'"));
check('Hotel checkout creates housekeeping work', hotelRepository.includes("housekeepingStatus: 'dirty'") && hotelRepository.includes("housekeepingTaskStatus: 'open'"));
check('Hotel earnings are released only after checkout', /normalized === 'checked_out'[\s\S]*release/i.test(hotelService));
check('Expired pending hotel bookings release room-night inventory', hotelInventory.includes('releaseExpiredPendingBookings') && hotelInventory.includes("status: 'available'") && hotelInventory.includes("paymentStatus: 'expired'"));
check('Expired hotel checkout records are voided without issuing value', hotelInventory.includes("bookingStatus: 'voided'") && hotelInventory.includes("'hotelStay.status': 'expired'"));
check('Scheduled room cleanup includes pending hotel checkout expiry', roomReservation.includes('hotelInventoryService.releaseExpiredPendingBookings(at)'));

// Dashboard/admin hotel completion.
check('Partner-managed hotel add-on templates exist', setupService.includes('hotel: Object.freeze({'));
check('Hotel add-on prices remain manually entered', dashboardJs.includes('enter the unit price yourself') && dashboardJs.includes('Templates never choose or copy a price'));
check('Hotel add-ons are shown in hotel setup', hotelSection.includes('Optional hotel extras'));
check('Company hotel check-in and check-out routes are service-scoped', companyRoutes.includes("requireCompanyService('hotel'), hotelController.checkIn") && companyRoutes.includes("requireCompanyService('hotel'), hotelController.checkOut"));
check('Employee hotel check-in and check-out routes are permission-scoped', employeeRoutes.includes("/employee/hotels/bookings/:bookingRef/check-in") && employeeRoutes.includes("requirePermission('checkin.manage')") && employeeRoutes.includes("/employee/hotels/bookings/:bookingRef/check-out"));
check('Employee hotel manifests are permission-scoped', employeeRoutes.includes("/employee/hotels/manifest") && employeeRoutes.includes("requirePermission('manifest.view')"));
check('Employee hotel operations call the canonical stay service', employeeCheckin.includes("hotelService.markStay") && employeeCheckin.includes("'checked_out'"));
check('Dashboard actions distinguish hotels from bus tickets', dashboardJs.includes('isHotelBooking') && dashboardJs.includes('/employee/hotels/bookings/'));
check('Dashboard hides hotel check-in until payment succeeds', dashboardJs.includes("paymentStatusKey === 'successful'"));
check('Manual successful hotel payment uses canonical hotel lifecycle transactionally', dashboardAction.includes('hotelRepository.applyPaymentLifecycle') && dashboardAction.includes('Hotel booking has no canonical reservation') && dashboardAction.includes('repository.withTransaction'));
check('Manual paid hotel booking sends confirmation voucher', dashboardAction.includes('notificationService.bookingConfirmed(booking)'));
check('Manual dashboard payments cannot record failed money', dashboardAction.includes("Dashboard payments may only be pending or successful"));
check('Pending manual payments can transition idempotently to successful', dashboardAction.includes('A pending payment may be confirmed only with its original amount and currency') && dashboardAction.includes("['pending', 'created', 'processing'].includes(normalize(existing.status))"));
check('Dashboard repository exposes room-night inventory', dashboardRepository.includes("roomNights: new MongoCollection('roomNightInventories')"));
check('Hotel stay detail is available for role-aware actions', projection.includes('hotelStay: booking.hotelStay || null'));

// Public voucher/payment safety and no separate hotel hold.
check('Hotel public API does not require a separate pre-hold', publicApiListings.includes('A separate hotel hold is not required') && !publicApiListings.includes('roomReservationService.reserveRoom'));
check('Tickets require successful payment before QR/PDF readiness', listingController.includes('ticketIsReady') && listingController.includes("paymentStatus") && ticketPdf.includes("paymentStatus"));
check('Hotel ticket view has stay-specific details', ticketView.includes('Check-in') && ticketView.includes('Check-out'));
check('Hotel success page distinguishes voucher readiness', successView.includes('voucher'));
check('Payment updates do not send WhatsApp by default', notificationService.includes("channels: ['in_app', 'push', 'email']") || notificationService.includes("channels: ['in-app', 'push', 'email']"));
check('Communication add-ons control ticket messaging', notificationService.includes('bookingConfirmationChannels'));
check('Booking add-on IDs are validated and bounded', bookingValidator.includes('values.length > 20') && bookingValidator.includes('validateAddonIds'));
check('Hotel multi-room estimate is represented in checkout', listingDetails.includes('roomCount') && bookingForm.includes('requestedRoomCount'));

const failed = checks.filter((item) => !item.ok);
if (failed.length) {
  console.error(`Final bus + hotel end-to-end checks failed (${checks.length - failed.length}/${checks.length}).`);
  for (const item of failed) console.error(`- ${item.name}`);
  process.exit(1);
}

console.log(`Final bus + hotel end-to-end checks passed (${checks.length}/${checks.length}).`);
