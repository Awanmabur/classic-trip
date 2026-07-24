'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const checks = [];
function check(name, condition) { checks.push({ name, ok: Boolean(condition) }); }

const publicRoutes = read('src/routes/web/public.js');
const companyRoutes = read('src/routes/web/company.js');
const authView = read('src/views/pages/auth/login.ejs');
const partnerController = read('src/controllers/public/partnerController.js');
const authController = read('src/controllers/auth/authController.js');
const validation = read('src/middlewares/validate.js');
const commissionPage = read('src/views/pages/partner-commission.ejs');
const footer = read('src/views/partials/site-footer.ejs');
const busBooking = read('src/modules/bus/services/busBookingService.js');
const genericBooking = read('src/services/booking/bookingService.js');
const dashboardAction = read('src/services/dashboard/actionService.js');
const promoterSales = read('src/services/promoter/offlineSalesService.js');
const hotelService = read('src/services/hotel/hotelService.js');
const hotelRepository = read('src/repositories/domain/hotelRepository.js');
const hotelProperty = read('src/models/HotelProperty.js');
const hotelReservation = read('src/models/HotelReservation.js');
const hotelGuest = read('src/models/HotelGuest.js');
const roomAssignment = read('src/models/RoomAssignment.js');
const bookingItem = read('src/models/BookingItem.js');
const migration = read('scripts/migrate-normalized-hotel-domain.js');
const dashboardController = read('src/controllers/company/dashboardController.js');
const hotelSection = read('src/views/dashboards/shared/sections/hotel-rooms.ejs');
const manifests = read('src/views/dashboards/shared/sections/manifests.ejs');
const dashboardCss = read('public/css/dashboard-workspace.css');
const dashboardJs = read('public/js/dashboard-workspace.js');
const driverEligibility = read('src/services/company/driverEligibilityService.js');

// One partner onboarding flow.
check('Legacy partner GET redirects into the one shared authentication page', publicRoutes.includes("router.get('/partner/onboarding', (req, res) => res.redirect(303, '/register?role=partner#partner'))") && !partnerController.includes('partnerOnly: true'));
check('General auth and partner onboarding reuse one visual template and one embedded partner panel', authView.includes('id="loginPanel"') && authView.includes('id="signupPanel"') && authView.includes('id="partnerPanel"') && authView.includes("include('./_partner-signup')") && !authView.includes('partnerOnly'));
check('Customer/promoter signup opens the partner panel on the same page', authView.includes('href="#partner" data-open-panel="partner"') && !authView.includes('href="/partner/onboarding"'));
check('Legacy public partner lead endpoint is retired', !publicRoutes.includes('/partner-requests') && /createOnboarding/.test(partnerController));
check('Commission page and footer use direct partner registration without plans', commissionPage.includes('/register?role=partner#partner') && footer.includes('/register?role=partner#partner') && !/planId|selectedPlan|partner\/onboarding\?plan/.test(commissionPage));
check('Partner validation errors return to the unified partner panel', validation.includes("authPath === '/partner/onboarding'") && validation.includes("res.redirect('/register?role=partner#partner')"));
check('Accidental partner registration redirects to the unified partner panel', authController.includes("return res.redirect('/register?role=partner#partner')"));

// No parallel cart/booking architecture.
check('Legacy active cart checkout is absent', !publicRoutes.includes("/cart") && !exists('src/controllers/public/cartController.js') && !exists('src/services/cart/cartService.js'));
check('Manual bus booking uses canonical bus rows', busBooking.includes('async function createTrustedManualBooking') && busBooking.includes('await buildCanonicalRows') && busBooking.includes('await persistPendingRows'));
check('Company and employee manual bus actions dispatch canonically', dashboardAction.includes('busBookingService.createTrustedManualBooking'));
check('Generic booking code rejects bus fallback', genericBooking.includes("error.code = 'canonical_bus_booking_required'"));
check('Promoter bus and hotel sales use canonical engines only', promoterSales.includes('busBookingService.createTrustedOfflineBooking') && promoterSales.includes('hotelService.createHotelBooking') && !promoterSales.includes('expectedOfflineTotal') && !promoterSales.includes('MAX_REASONABLE_PRICE_MULTIPLIER'));
check('Offline customer ownership is not assigned to the promoter', busBooking.includes("cleanText(payload.customerUserId, 180)") && hotelService.includes("clean(payload.customerUserId)"));

// Canonical hotel domain.
check('Hotel reservation is independently normalized', hotelReservation.includes('bookingRef') && hotelReservation.includes('settlementStatus') && hotelReservation.includes('checkInDate'));
check('Hotel guests and room assignments are independent records', hotelGuest.includes('reservationId') && roomAssignment.includes('reservationId') && roomAssignment.includes('roomUnitId'));
check('Generic booking items link to domain reservations', bookingItem.includes('domainReservationId'));
check('Hotel booking persists normalized records transactionally', hotelService.includes('buildCanonicalHotelRecords') && hotelRepository.includes('commitHotelBooking'));
check('Hotel payments keep settlement pending until fulfillment', hotelService.includes("settlementStatus: successful ? 'pending_fulfillment' : 'pending_payment'"));
check('Hotel check-in requires confirmed payment', hotelService.includes('Payment must be confirmed before a hotel guest can check in or check out'));
check('Hotel checkout creates housekeeping work', hotelRepository.includes("housekeepingStatus: 'dirty'") && hotelRepository.includes("housekeepingTaskStatus: 'open'"));
check('Hotel manifests use company/listing/date scoped canonical records', hotelService.includes('async function manifestRecords(companyId, listingId') && hotelService.includes('row.checkInDate === targetDate') && hotelService.includes('row.checkOutDate === targetDate'));
check('Hotel manifest includes identity, occupancy, payment and actual stay times', hotelService.includes('maskedIdentity') && hotelService.includes('actualCheckIn') && hotelService.includes('settlementStatus') && hotelService.includes('emergencyContact'));

// Safe setup lifecycle and migration.
check('One property is enforced per company listing', hotelProperty.includes("hotelPropertySchema.index({ companyId: 1, listingId: 1 }, { unique: true })"));
check('Existing duplicate properties are safely consolidated before normalization', migration.includes('async function consolidateDuplicateProperties') && migration.includes('RoomType.updateOne') && migration.includes('RoomUnit.updateOne') && migration.includes('HotelProperty.deleteOne'));
check('Duplicate migration rewires all dependent hotel records', ['RatePlan.updateMany', 'RoomNightInventory.updateMany', 'HotelReservation.updateMany', 'RoomAssignment.updateMany', 'HousekeepingTask.updateMany', 'MaintenanceBlock.updateMany'].every((token) => migration.includes(token)));
check('Hotel property, room type, rate plan and unit have dedicated safe archive routes', ['/properties/:id/archive', '/room-types/:id/archive', '/rate-plans/:id/archive', '/room-units/:id/archive'].every((token) => companyRoutes.includes(token)));
check('Hotel setup has explicit subviews for every operational entity', ['properties', 'room-types', 'rate-plans', 'room-units', 'room-calendar', 'housekeeping'].every((token) => dashboardController.includes(`'${token}'`)));
check('Hotel manifests have arrivals, in-house and departures subviews', ['arrivals', 'departures', 'in-house'].every((token) => dashboardController.includes(`'${token}'`)));

// UI consistency and duplicate editor cleanup.
check('Hotel operations use shared scoped padding and responsive layout', hotelSection.includes('hotelOpsLayout') && dashboardCss.includes('.hotelOpsPane{padding:14px 16px 16px}') && dashboardCss.includes('@media(max-width:760px)'));
check('Bus and hotel manifests use scoped classes instead of inline one-off spacing', manifests.includes('busManifestCard') && manifests.includes('hotelManifestCard') && !manifests.includes('style="padding:16px') && !manifests.includes('<div style="height:16px">'));
check('Manifest tables and filters have responsive scoped spacing', dashboardCss.includes('.busManifestTableWrap') && dashboardCss.includes('.hotelManifestFilters') && dashboardCss.includes('.busManifestFilters'));
check('Only one canonical room-type edit configuration remains', (dashboardJs.match(/mode === 'edit' && key === 'room_type'/g) || []).length === 1);
check('Rate plan create and edit forms are both present', dashboardJs.includes("key === 'rate plan'") && dashboardJs.includes("editActionFor('rate_plan')"));
check('Partner auth role cards use two-column layout', authView.includes('.roleGrid{display:grid;grid-template-columns:repeat(2,1fr)'));

// Bus operational safety remains strict.
check('Driver assignment requires operational eligibility', driverEligibility.includes('isDriverAccountOperational') && driverEligibility.includes("normalize(employee.safetyStatus) !== 'cleared'") && driverEligibility.includes('REQUIRED_DRIVER_PERMISSIONS'));
const busDeparture = read('src/modules/bus/services/busDepartureService.js');
check('Bus publication checks strict driver eligibility', busBooking.includes('createTrustedManualBooking') && busDeparture.includes('validateSchedulePublish') && busDeparture.includes('evaluateDriverEligibility') && busDeparture.includes("failures.push('verified_operational_driver_missing')"));
check('Segment-aware seat inventory remains authoritative', read('src/modules/bus/services/busInventoryService.js').includes('bus_segment_seat') && read('src/models/BusSeatSegmentInventory.js').includes('segmentId'));

const failed = checks.filter((row) => !row.ok);
if (failed.length) {
  console.error(`Final bus + hotel conclusion checks failed (${checks.length - failed.length}/${checks.length}).`);
  failed.forEach((row) => console.error(`- ${row.name}`));
  process.exit(1);
}
console.log(`Final bus + hotel conclusion checks passed (${checks.length}/${checks.length}).`);
