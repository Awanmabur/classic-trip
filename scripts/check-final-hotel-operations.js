'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [];
const check = (name, ok) => checks.push({ name, ok: Boolean(ok) });

const companyRoutes = read('src/routes/web/company.js');
const employeeRoutes = read('src/routes/web/employee.js');
const hotelController = read('src/controllers/company/hotelController.js');
const employeeCheckin = read('src/controllers/employee/checkinController.js');
const hotelService = read('src/services/hotel/hotelService.js');
const hotelRepository = read('src/repositories/domain/hotelRepository.js');
const bookingService = read('src/services/booking/bookingService.js');
const settlement = read('src/services/booking/paymentSettlementService.js');
const release = read('src/services/commission/releaseService.js');
const financeSettlement = read('src/services/finance/settlementService.js');
const dashboardProjection = read('src/services/dashboard/dashboardProjectionEngine.js');
const dashboardJs = read('public/js/dashboard-workspace.js');
const dashboardCss = read('public/css/dashboard-workspace.css');
const manifests = read('src/views/dashboards/shared/sections/manifests.ejs');
const voucher = read('src/views/pages/hotel-voucher-detail.ejs');
const property = read('src/models/HotelProperty.js');
const reservation = read('src/models/HotelReservation.js');
const guest = read('src/models/HotelGuest.js');
const assignment = read('src/models/RoomAssignment.js');
const item = read('src/models/BookingItem.js');
const roomNight = read('src/models/RoomNightInventory.js');
const authView = read('src/views/pages/auth/login.ejs');
const publicRoutes = read('src/routes/web/public.js');

check('Company hotel vouchers are service-scoped and rate-limited', companyRoutes.includes("/company/hotels/bookings/:bookingRef/voucher") && companyRoutes.includes("requireCompanyService('hotel')") && companyRoutes.includes('ticketLimiter'));
check('Employee hotel vouchers are permission-scoped', employeeRoutes.includes("/employee/hotels/bookings/:bookingRef/voucher") && employeeRoutes.includes("requirePermission('booking.view', 'checkin.manage', 'manifest.view')"));
check('Hotel voucher controller uses canonical operational voucher data', hotelController.includes('hotelService.operationalVoucher') && hotelController.includes("render('pages/hotel-voucher-detail'"));
check('Hotel dashboard never sends hotel rows through bus or driver ticket pages', dashboardJs.includes('/company/hotels/bookings/') && dashboardJs.includes('/employee/hotels/bookings/') && !dashboardJs.includes("'/driver/tickets/' + encodeURIComponent(bookingRef)"));
check('Hotel voucher shows normalized guests, assignments, status and timeline', ['guests.forEach', 'assignments.forEach', 'timeline', 'Guest manifest', 'Rooms and rate plans'].every((token) => voucher.includes(token)));

check('Hotel no-show company route is protected', companyRoutes.includes("/company/hotels/bookings/:bookingRef/no-show") && companyRoutes.includes("requireCompanyService('hotel')"));
check('Hotel no-show employee route requires dedicated permission', employeeRoutes.includes("/employee/hotels/bookings/:bookingRef/no-show") && employeeRoutes.includes("requirePermission('checkin.no_show')"));
check('Employee controller delegates hotel no-show to canonical service', employeeCheckin.includes('hotelService.markNoShow'));
check('Hotel no-show is transactional and releases safe room nights', hotelRepository.includes('async function commitNoShow') && hotelRepository.includes("status: 'available'") && hotelRepository.includes("settlementStatus: 'reconciliation_required'"));
check('Hotel reservation, guest, assignment and booking item support no-show status', reservation.includes("'no_show'") && guest.includes("'no_show'") && assignment.includes("'no_show'") && item.includes("'no_show'"));
check('No-show sends an operational timeline and customer notification', hotelService.includes("action: 'hotel.stay.no_show'") && hotelService.includes('notificationService'));

check('Paid hotel settlement remains pending until fulfillment', settlement.includes("'pending_fulfillment'") && !settlement.includes("serviceType === 'hotel' ? 'settled'"));
check('Hotel checkout makes earnings eligible rather than settled', release.includes("serviceType === 'hotel'") && release.includes("'eligible'"));
check('Finance settlement requires completed checked-out hotel stay', financeSettlement.includes("serviceType === 'hotel'") && financeSettlement.includes('checked_out'));
check('Paid hotel cancellation enters reconciliation before refund policy is known', bookingService.includes('hotelCancellationRefundDecision') && bookingService.includes("settlementStatus = 'reconciliation_required'"));
check('Hotel cancellation does not automatically full-refund penalty-window or non-refundable rates', bookingService.includes('reviewRequired') && bookingService.includes("refundStatus = hotelRefundDecision?.reviewRequired ? 'review_required' : 'not_refundable'"));

check('Normalized hotel entities are independent and linked', reservation.includes('bookingRef') && guest.includes('reservationId') && assignment.includes('roomUnitId') && item.includes('domainReservationId'));
check('Dated room inventory links booking, reservation and assignment', roomNight.includes('bookingRef') && roomNight.includes('reservationId') && roomNight.includes('assignmentId'));
check('One property per company listing is the only property uniqueness rule', property.includes("hotelPropertySchema.index({ companyId: 1, listingId: 1 }, { unique: true })") && !property.includes('normalizedName: 1 }, { unique: true }'));
check('Hotel manifests are canonical, company/listing/date scoped', hotelService.includes('async function manifestRecords(companyId, listingId') && hotelService.includes('reservationFilter'));
check('Manifest UI includes no-show filtering and history', manifests.includes('value="no_show"') && manifests.includes('History / no-shows') && manifests.includes('companyHotelHistoryTable'));
check('Dashboard projection includes hotel history rows', dashboardProjection.includes('hotelHistoryRows') && dashboardProjection.includes('hotelManifestHistory'));
check('Manifest exports support all properties or a selected listing', manifests.includes('All hotel properties') && hotelService.includes("rawListingId.toLowerCase() === 'all'"));

check('Hotel setup has one scoped responsive visual system', dashboardCss.includes('.hotelOpsLayout') && dashboardCss.includes('.hotelOpsPane{padding:14px 16px 16px}') && dashboardCss.includes('.hotelManifestCard'));
check('Property policy wording does not advertise unsupported deposit payment', dashboardJs.includes('Security / incidental policy') && !dashboardJs.includes("label:'Deposit policy'"));
check('Partner onboarding renders once in the shared auth page', authView.includes('id="partnerPanel"') && !authView.includes('partnerOnly'));
check('Legacy partner onboarding GET redirects to the shared page', publicRoutes.includes("router.get('/partner/onboarding'") && !publicRoutes.includes("render('pages/auth/partner-onboarding'"));

const failed = checks.filter((row) => !row.ok);
if (failed.length) {
  console.error(`Final hotel operations checks failed (${checks.length - failed.length}/${checks.length}).`);
  failed.forEach((row) => console.error(`- ${row.name}`));
  process.exit(1);
}
console.log(`Final hotel operations checks passed (${checks.length}/${checks.length}).`);
