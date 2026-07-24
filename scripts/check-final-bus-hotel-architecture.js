'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const checks = [];
function check(name, ok) { checks.push({ name, ok: Boolean(ok) }); }

const login = read('src/views/pages/auth/login.ejs');
const partnerController = read('src/controllers/public/partnerController.js');
const publicRoutes = read('src/routes/web/public.js');
const companyRoutes = read('src/routes/web/company.js');
const employeeRoutes = read('src/routes/web/employee.js');
const accessControl = read('src/config/accessControl.js');
const dashboardJs = read('public/js/dashboard-workspace.js');
const dashboardController = read('src/controllers/company/dashboardController.js');
const dashboardCss = read('public/css/dashboard-workspace.css');
const hotelSection = read('src/views/dashboards/shared/sections/hotel-rooms.ejs');
const manifestSection = read('src/views/dashboards/shared/sections/manifests.ejs');
const hotelService = read('src/services/hotel/hotelService.js');
const hotelInventory = read('src/services/hotel/hotelInventoryService.js');
const hotelRepository = read('src/repositories/domain/hotelRepository.js');
const bookingBuilder = read('src/services/booking/bookingBuilderService.js');
const bookingService = read('src/services/booking/bookingService.js');
const roomReservation = read('src/services/booking/roomReservationService.js');
const paymentWebhook = read('src/services/payment/webhookService.js');
const busOperations = read('src/modules/bus/services/busOperationsService.js');
const busBooking = read('src/modules/bus/services/busBookingService.js');
const busInventory = read('src/modules/bus/services/busInventoryService.js');
const busDeparture = read('src/modules/bus/services/busDepartureService.js');
const packageJson = JSON.parse(read('package.json'));

// One authentication service and one canonical partner-onboarding POST service, rendered in the approved auth visual system.
check('Shared auth template renders login panel for customer/promoter access', /id="loginPanel"/.test(login));
check('Shared auth template renders customer/promoter signup panel', /id="signupPanel"/.test(login));
check('Shared auth template renders one embedded partner panel', /id="partnerPanel"/.test(login) && /data-open-panel="partner"/.test(login) && !/partnerOnly/.test(login));
check('Unified auth has one partner panel instance', (login.match(/id="partnerPanel"/g) || []).length === 1);
check('Partner entry stays on the unified authentication page', /href="#partner"[^>]*data-open-panel="partner"/.test(login) && !/href="\/partner\/onboarding/.test(login));
check('Legacy partner GET redirects to the unified partner panel', publicRoutes.includes("router.get('/partner/onboarding', (req, res) => res.redirect(303, '/register?role=partner#partner'))") && !/partnerOnly/.test(partnerController));
check('Partner POST remains one canonical onboarding endpoint', publicRoutes.includes("router.post('/partner/onboarding'"));

// Canonical hotel domain records.
for (const model of ['HotelProperty','RoomType','RoomUnit','RatePlan','RoomNightInventory','HotelReservation','HotelGuest','RoomAssignment','BookingItem','HousekeepingTask','MaintenanceBlock']) {
  check(`${model} model exists`, exists(`src/models/${model}.js`));
}
check('One active property belongs to one public listing', read('src/models/HotelProperty.js').includes('hotelPropertySchema.index({ companyId: 1, listingId: 1 }, { unique: true })'));
check('Room type uniqueness is property scoped', read('src/models/RoomType.js').includes('propertyId: 1, normalizedName: 1'));
check('Room number uniqueness is property scoped', read('src/models/RoomUnit.js').includes('propertyId: 1, normalizedUnitNumber: 1'));
check('Room-night uniqueness is unit and date scoped', read('src/models/RoomNightInventory.js').includes('roomUnitId: 1, date: 1'));
check('Hotel reservations have independent lifecycle', /settlementStatus/.test(read('src/models/HotelReservation.js')) && /refundStatus/.test(read('src/models/HotelReservation.js')));
check('Guests have independent check-in status', /checkInStatus/.test(read('src/models/HotelGuest.js')));
check('Assignments connect reservation, room, nights and guests', /reservationId/.test(read('src/models/RoomAssignment.js')) && /nightIds/.test(read('src/models/RoomAssignment.js')) && /guestIds/.test(read('src/models/RoomAssignment.js')));

// Hotel inventory and booking authority.
check('Hotel selection never creates inventory implicitly', !/ensureNightInventoryForUnit/.test(hotelInventory));
check('Hotel selection requires every explicit night', /orderedRows\.length !== range\.nights\.length/.test(hotelInventory));
check('Hotel selection requires physically ready room', /unitIsReady\(unit\)/.test(hotelInventory));
check('Room readiness requires active status and housekeeping', /READY_HOUSEKEEPING_STATUSES/.test(hotelInventory) && /ACTIVE_UNIT_STATUSES/.test(hotelInventory));
check('Legacy room hold creation fails closed', /CANONICAL_HOTEL_ENGINE_REQUIRED/.test(roomReservation));
check('Shared booking builder rejects hotel', /CANONICAL_HOTEL_ENGINE_REQUIRED/.test(bookingBuilder));
check('Public generic booking dispatches hotel canonically', /createHotelBooking\(payload, req\)/.test(bookingService));
check('Manual booking dispatches hotel canonically', /createHotelBooking\([\s\S]*trustedManual: true/.test(bookingService));
check('Hotel booking transaction persists normalized records', /commitHotelBooking/.test(hotelService) && /HotelReservation/.test(hotelRepository));
check('Hotel booking enforces named guest manifest', /requires a full name|full name is required/.test(hotelService) && /normalizeHotelGuests/.test(hotelService));
check('Hotel booking validates room occupancy', /hotel_room_occupancy_exceeded/.test(hotelService));
check('Hotel booking prices occupancy surcharge', /occupancySurcharge/.test(hotelService));
check('Hotel booking prices property taxes and service fee', /propertyTax/.test(hotelService) && /propertyServiceFee/.test(hotelService));
check('Hotel booking validates add-ons server-side', /priceHotelAddons/.test(hotelService));
check('Hotel rate plans expose only completed pay-now flow', /options:\['pay_now'\]/.test(dashboardJs));
check('Untrusted hotel clients cannot set payment state', /untrusted_manual_payment/.test(hotelService));

// Hotel payment, fulfillment, cancellation and settlement.
check('Payment webhook updates canonical hotel lifecycle', /persistHotelNightLifecycle/.test(paymentWebhook));
check('Successful hotel payment books room nights', /paymentStatus === 'successful' \? 'booked' : 'reserved'/.test(hotelRepository));
check('Hotel check-in requires successful payment', /hotel_payment_not_confirmed/.test(hotelService));
check('Stay transition updates booking, reservation, guest, assignment and item', /HotelReservation\.updateOne/.test(hotelRepository) && /HotelGuest\.updateMany/.test(hotelRepository) && /RoomAssignment\.updateMany/.test(hotelRepository) && /BookingItem\.updateMany/.test(hotelRepository));
check('Checkout creates housekeeping tasks', /checkout_clean/.test(hotelRepository));
check('Checkout makes settlement eligible, not settled', /settlementStatus = 'eligible'/.test(hotelService) && !/settlementStatus = 'settled'/.test(hotelService));
check('Hotel cancellation uses canonical reservation lifecycle', /cancelReservation/.test(hotelRepository));
check('Expired pending stays release inventory', /releaseExpiredPendingBookings/.test(hotelInventory));

// Hotel publishing and operations.
check('Hotel publish requires verified company', /company_not_active_and_verified/.test(hotelService));
check('Hotel publish requires property contact', /property_contact_missing/.test(hotelService) && /failures\.push\('property_contact_missing'\)/.test(hotelService));
check('Hotel publish requires ready units', /ready_unit_missing/.test(hotelService));
check('Hotel publish requires future sellable inventory', /future_sellable_inventory_missing/.test(hotelService));
check('Hotel publish rejects unsupported payment timing', /unsupported_payment_timing/.test(hotelService));
check('Housekeeping changes are room-unit scoped', /roomUnitId: unit\.id/.test(hotelService));
check('Maintenance blocks reject committed nights', /Move or cancel affected reservations/.test(hotelService));
check('Hotel manifest is canonical first', /hotelReservations\.list/.test(hotelService));
check('Hotel manifest supports all properties and one listing', /requestedListingId/.test(hotelService) && /listingId: \{ \$in: listingIds \}/.test(hotelService));
check('Hotel manifest strictly filters arrivals', /row\.checkInDate === targetDate/.test(hotelService));
check('Hotel manifest strictly filters departures', /row\.checkOutDate === targetDate/.test(hotelService));
check('Hotel manifest includes identity and emergency contact', /maskedIdentity/.test(hotelService) && /emergencyContact/.test(hotelService));
check('Hotel manifest includes actual stay timestamps', /actualCheckIn/.test(hotelService) && /actualCheckOut/.test(hotelService));
check('Company hotel manifest routes exist', companyRoutes.includes("/company/hotels/manifest"));
check('Employee hotel manifests require manifest permission', employeeRoutes.includes("/employee/hotels/manifest") && employeeRoutes.includes("requirePermission('manifest.view')"));
check('Front desk default includes manifest permission', /front_desk:[^\n]*manifest\.view/.test(accessControl));
check('Hotel manager default includes manifest permission', /hotel_manager:[^\n]*manifest\.view/.test(accessControl));

// Hotel UI consistency and complete forms.
for (const subview of ['properties','room-types','rate-plans','room-units','room-calendar','housekeeping','arrivals','in-house','departures']) {
  check(`Hotel workspace exposes ${subview}`, dashboardController.includes(`'${subview}'`));
}
check('Hotel room-unit form captures operational attributes', /viewType/.test(dashboardJs) && /accessible/.test(dashboardJs) && /smokingAllowed/.test(dashboardJs) && /connectingRoom/.test(dashboardJs));
check('Hotel room-unit form supports ready housekeeping state', /options:\['clean','dirty','cleaning','inspected','ready','maintenance'\]/.test(dashboardJs));
check('Hotel staff form exposes manifest permission', /View hotel manifests/.test(dashboardJs));
check('Hotel pages use scoped operation padding', /hotelOpsSectionPad/.test(dashboardCss) && /hotelOpsPane/.test(dashboardCss));
check('Hotel manifest pages use scoped padding', /hotelManifestHeader/.test(dashboardCss) && /hotelManifestPane/.test(dashboardCss));
check('Manifest links are role aware', /manifestRouteBase/.test(manifestSection));
check('No global print rule leaks into dashboard layout', !/@media\s+print[\s\S]*\.app\s*\{[^}]*padding/.test(dashboardCss));

// Canonical bus regressions.
check('Bus booking uses segment-aware inventory', /segmentInventory/.test(busInventory));
check('Bus booking creates normalized reservations and tickets', /reservations/.test(busBooking) && /tickets/.test(busBooking));
check('Bus departure publication is guarded', /publish/.test(busDeparture) && /readiness/.test(busDeparture));
check('Bus scanner wrapper is defined', /async function validateTicket\(/.test(bookingService));
check('Canonical bus check-in updates timeline', /ticket\.checked_in/.test(busOperations) && /recordOperationalTimeline/.test(busOperations));
check('Canonical bus no-show updates timeline', /ticket\.no_show/.test(busOperations));
check('Bus scanner validates successful payment', /booking\.paymentStatus !== 'successful'/.test(busOperations));
check('Bus check-in updates segment inventory', /row\.status = 'checked_in'/.test(busOperations));
check('Bus no-show updates segment inventory', /row\.status = 'no_show'/.test(busOperations));

// Migration and release gates.
check('Hotel normalization migration exists', exists('scripts/migrate-normalized-hotel-domain.js'));
check('Hotel migration has dry-run and apply modes', /process\.argv\.includes\('--apply'\)/.test(read('scripts/migrate-normalized-hotel-domain.js')));
check('Package exposes final architecture gate', packageJson.scripts['check:bus-hotel-final'] === 'node scripts/check-final-bus-hotel-architecture.js');
check('Package exposes hotel migration commands', Boolean(packageJson.scripts['migrate:hotel-domain:dry']) && Boolean(packageJson.scripts['migrate:hotel-domain']));

const failed = checks.filter((row) => !row.ok);
if (failed.length) {
  console.error(`Final bus + hotel architecture gate failed (${checks.length - failed.length}/${checks.length}).`);
  failed.forEach((row) => console.error(`- ${row.name}`));
  process.exit(1);
}
console.log(`Final bus + hotel architecture gate passed (${checks.length}/${checks.length}).`);
