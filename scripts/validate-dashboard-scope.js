const fs = require('fs');
const path = require('path');
const { buildDashboardShell } = require('../src/services/dashboard/shellConfig');
const { ROLE_DASHBOARDS } = require('../src/config/dashboardMenus');
const { readComposedDashboardSource } = require('./dashboard-source');

const SERVICE_PROFILES = {
  bus: { primaryServiceType: 'bus', primaryLabel: 'Bus', dashboardLabel: 'Bus Dashboard', consoleName: 'Bus Dashboard Console', supportsBus: true, supportsHotel: false, supportsBusOperations: true, visiblePages: ['overview','company-profile','staff','listings','routes','vehicles','seat-maps','schedules','bookings','manifests','checkins','reviews','support','revenue','settlement','reports'], pageMeta: {} },
  hotel: { primaryServiceType: 'hotel', primaryLabel: 'Hotel', dashboardLabel: 'Hotel Dashboard', consoleName: 'Hotel Dashboard Console', supportsBus: false, supportsHotel: true, supportsBusOperations: false, visiblePages: ['overview','company-profile','staff','listings','hotel-rooms','bookings','manifests','checkins','reviews','support','revenue','settlement','reports'], pageMeta: {} },
};

function labels(shell) {
  return (shell.groups || []).flatMap((group) => [group.label, ...(group.items || []).map((item) => item.label)]).join(' | ');
}
function pages(shell) {
  return new Set((shell.groups || []).flatMap((group) => (group.items || []).map((item) => item.page)));
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function sectionsFromDashboard() {
  const root = path.join(__dirname, '..');
  const { html: dashboardHtml, combined: combinedSource } = readComposedDashboardSource(root);
  const staticIds = new Set([...dashboardHtml.matchAll(/<section[^>]+id="([^"]+)"/g)].map((match) => match[1]).filter((id) => !id.includes('<%')));
  const dynamicServiceIds = ['bus-dashboard','hotel-dashboard'];
  dynamicServiceIds.forEach((id) => staticIds.add(id));
  const hasDynamicFallback = combinedSource.includes('dynamicDashboardItems.forEach');
  return { ids: staticIds, html: combinedSource, hasDynamicFallback };
}

const busShell = buildDashboardShell('company', { user: { role: 'company_admin', companyId: 'bus-co' }, company: { name: 'Bus Co', companyType: 'bus', verificationStatus: 'verified' }, serviceProfile: SERVICE_PROFILES.bus });
const hotelShell = buildDashboardShell('company', { user: { role: 'company_admin', companyId: 'hotel-co' }, company: { name: 'Hotel Co', companyType: 'hotel', verificationStatus: 'verified' }, serviceProfile: SERVICE_PROFILES.hotel });

const busText = labels(busShell).toLowerCase();
const hotelText = labels(hotelShell).toLowerCase();

assert(!busText.includes('hotel'), 'Bus company sidebar must not contain hotel wording.');
assert(!busText.includes('room'), 'Bus company sidebar must not contain room wording.');
assert(!pages(busShell).has('hotel-rooms'), 'Bus company sidebar must not include hotel-rooms page.');

assert(!hotelText.includes('bus'), 'Hotel company sidebar must not contain bus wording.');
assert(!hotelText.includes('route'), 'Hotel company sidebar must not contain route wording.');
assert(!hotelText.includes('vehicle'), 'Hotel company sidebar must not contain vehicle wording.');
assert(!pages(hotelShell).has('routes'), 'Hotel company sidebar must not include routes page.');
assert(!pages(hotelShell).has('vehicles'), 'Hotel company sidebar must not include vehicles page.');
assert(!pages(hotelShell).has('seat-maps'), 'Hotel company sidebar must not include seat-maps page.');


Object.entries(SERVICE_PROFILES).forEach(([serviceType, profile]) => {
  const shell = buildDashboardShell('company', { user: { role: 'company_admin', companyId: `${serviceType}-co` }, company: { name: `${serviceType} Co`, companyType: serviceType, verificationStatus: 'verified' }, serviceProfile: profile });
  const shellPages = pages(shell);
  (profile.visiblePages || []).forEach((page) => assert(shellPages.has(page), `${serviceType} company sidebar is missing required page: ${page}`));
});

const { ids, html, hasDynamicFallback } = sectionsFromDashboard();
Object.keys(ROLE_DASHBOARDS).forEach((role) => {
  const shell = buildDashboardShell(role, { serviceProfile: SERVICE_PROFILES.bus });
  (shell.groups || []).forEach((group) => (group.items || []).forEach((item) => {
    assert(ids.has(item.page) || hasDynamicFallback, `Dashboard menu page has no renderable section: ${role}.${item.page}`);
  }));
});


assert(html.includes('tr.clickableRow'), 'Dashboard table rows must be visibly clickable.');
assert(html.includes('function rowOpenAttrs'), 'Dashboard rows must open view modals from the row click area.');
assert(html.includes('function curatedDetailGroups'), 'View modals must use curated necessary detail fields.');
assert(html.includes('detailActionBar'), 'View modals must include action buttons such as edit/archive/export/close.');
assert(html.includes('width:min(1180px,98vw)') || html.includes('width:min(1120px,98vw)'), 'Dashboard modals must use a wide modal width.');

assert(html.includes('method="POST" action="/logout"'), 'Logout must be a POST form action.');
assert(!html.includes('href="/logout"'), 'Logout must not be rendered as a GET link/page.');

const roleDashboardEntries = ['admin', 'support', 'finance', 'operations', 'content', 'company', 'employee', 'driver', 'customer', 'promoter']
  .map((role) => path.join(__dirname, '..', 'src', 'views', 'dashboards', role, 'index.ejs'));
roleDashboardEntries.forEach((file) => {
  assert(fs.existsSync(file), `Role dashboard entry is missing: ${file}`);
  assert(fs.readFileSync(file, 'utf8').includes("include('../shared/workspace')"), `Role dashboard must compose the shared workspace: ${file}`);
});



// Company dashboards must submit company-owned records to company endpoints,
// not Super Admin endpoints. This keeps bus/hotel/provider work scoped to the
// authenticated company account while Super Admin remains the global controller.
assert(html.includes("isCompanyRole && key === 'booking'"), 'Company booking modal must have a role-scoped form configuration.');
assert(html.includes("action: '/company/bookings'"), 'Company booking form must post to /company/bookings.');
assert(html.includes("action: '/company/listings'"), 'Company listing/property forms must post to /company/listings.');
assert(html.includes("action: '/company/routes'"), 'Company route form must post to /company/routes.');
assert(html.includes("action: '/company/vehicles'"), 'Company vehicle form must post to /company/vehicles.');
assert(html.includes("action: '/company/schedules'"), 'Company schedule form must post to /company/schedules.');
assert(html.includes("'/company/hotels/room-types'") && html.includes("'/company/hotels/room-units'"), 'Hotel room modals must post to hotel room-type/unit endpoints.');

const companyRoutesPath = path.join(__dirname, '..', 'src', 'routes', 'web', 'company.js');
const companyRoutes = fs.readFileSync(companyRoutesPath, 'utf8');
assert(companyRoutes.includes('requireCompanyOwnService'), 'Company listing routes must enforce company-owned service type.');
assert(/router\.post\('\/company\/listings',[\s\S]*?upload\.single\('imageFile'\)[\s\S]*?requireCsrfToken[\s\S]*?requireCompanyOwnService\('serviceType'\)[\s\S]*?listingController\.create\);/.test(companyRoutes), 'Company create listing route must parse upload, verify CSRF, then enforce company service type.');


assert(html.includes("action: '/company/driver-requests'"), 'Company driver request modal must post to /company/driver-requests.');
assert(html.includes("action: '/company/employees/invite'"), 'Company staff modal must post to /company/employees/invite.');
assert(html.includes("action: '/company/branches'"), 'Company branch modal must post to /company/branches.');
assert(html.includes("action: '/company/policies'"), 'Company policy modal must post to /company/policies.');
assert(html.includes("action: '/company/seats/status'"), 'Company seat map modal must post to /company/seats/status.');
assert(html.includes("action: '/company/payouts'"), 'Company payout modal must post to /company/payouts.');
assert(html.includes("isCompanyDashboard ? '/company/support/notices'") && html.includes("isSupportDashboard ? '/support/notices' : '/admin/notices'"), 'Support notice forms must use company, support-admin, and Super Admin namespaces correctly.');
assert(html.includes("isEmployeeDashboard ? '/employee/reports/reschedules.csv'") && html.includes("isCompanyDashboard ? '/company/reports/reschedules.csv'") && html.includes("isSupportDashboard ? '/support/reports/reschedules.csv'"), 'Reschedule report links must remain inside each dashboard role namespace.');
assert(companyRoutes.includes("router.post('/company/driver-requests'"), 'Company driver request POST route must exist.');


assert(companyRoutes.includes("router.post('/company/routes/:id/stops'"), 'Company route stop create route must exist.');
assert(companyRoutes.includes("router.post('/company/route-stops/:stopId'"), 'Company route stop update route must exist.');
assert(companyRoutes.includes("router.post('/company/vehicles/:id/seats'"), 'Company vehicle seat template route must exist.');
assert(companyRoutes.includes("router.post('/company/vehicles/:id/status'"), 'Company vehicle status route must exist.');
assert(companyRoutes.includes("router.post('/company/schedules/:id/status'"), 'Company schedule status route must exist.');
assert(companyRoutes.includes("router.post('/company/schedules/:id/duplicate'"), 'Company schedule duplicate route must exist.');
assert(html.includes("key === 'route stop'"), 'Company dashboard must expose route stop form config.');
assert(html.includes("key === 'vehicle seat template'"), 'Company dashboard must expose vehicle seat template form config.');
assert(html.includes("key === 'vehicle status'"), 'Company dashboard must expose vehicle status form config.');
assert(html.includes("key === 'schedule status'"), 'Company dashboard must expose schedule status form config.');
assert(html.includes("key === 'duplicate schedule'"), 'Company dashboard must expose duplicate schedule form config.');
const adminRoutesPath = path.join(__dirname, '..', 'src', 'routes', 'web', 'admin.js');
const adminRoutes = fs.readFileSync(adminRoutesPath, 'utf8');
assert(!adminRoutes.includes("driver-requests/:id/approve"), 'Super Admin must not approve partner employees or drivers.');
assert(!adminRoutes.includes("driver-requests/:id/reject"), 'Super Admin must not reject partner employees or drivers.');
assert(companyRoutes.includes("router.post('/company/drivers/:id/activate'"), 'Partner Admin driver status route must exist.');


assert(companyRoutes.includes("router.get('/company/schedules/:scheduleId/manifest'"), 'Company schedule printable manifest route must exist.');
assert(companyRoutes.includes("router.get('/company/schedules/:scheduleId/manifest.pdf'"), 'Company schedule manifest PDF route must exist.');
assert(companyRoutes.includes("router.get('/company/tickets/:bookingRef'"), 'Company operational ticket detail route must exist.');
assert(companyRoutes.includes("router.post('/company/schedules/:id/complete'"), 'Company schedule completion route must exist.');
assert(html.includes('/company/scanner/validate'), 'Company dashboard must expose manual check-in action.');
assert(html.includes('/company/scanner/no-show'), 'Company dashboard must expose no-show action.');
assert(html.includes('/company/schedules/${id}/manifest.pdf'), 'Company dashboard must expose schedule manifest PDF action.');
assert(html.includes('/company/schedules/${id}/complete'), 'Company dashboard must expose trip completion action.');


const bookingServicePath = path.join(__dirname, '..', 'src', 'services', 'booking', 'bookingService.js');
const bookingServiceSource = fs.readFileSync(bookingServicePath, 'utf8');
const busOperationsPath = path.join(__dirname, '..', 'src', 'modules', 'bus', 'services', 'busOperationsService.js');
const busOperationsSource = fs.readFileSync(busOperationsPath, 'utf8');
const manifestServicePath = path.join(__dirname, '..', 'src', 'services', 'operations', 'manifestService.js');
const manifestServiceSource = fs.readFileSync(manifestServicePath, 'utf8');
const ticketDetailPath = path.join(__dirname, '..', 'src', 'views', 'pages', 'driver-ticket-detail.ejs');
const ticketDetailSource = fs.readFileSync(ticketDetailPath, 'utf8');
assert(bookingServiceSource.includes("recordBookingTimeline"), 'Booking service must record booking timeline events.');
assert(bookingServiceSource.includes("booking.created"), 'Booking creation must write a timeline event.');
assert(bookingServiceSource.includes("payment.succeeded"), 'Payment success must write a timeline event.');
assert(bookingServiceSource.includes("ticket.issued"), 'Ticket issuance must write a timeline event.');
assert(bookingServiceSource.includes("ticket.checked_in") || busOperationsSource.includes("ticket.checked_in"), 'Check-in must write a ticket timeline event.');
assert(bookingServiceSource.includes("ticket.no_show") || busOperationsSource.includes("ticket.no_show"), 'No-show must write a ticket timeline event.');
assert(manifestServiceSource.includes("timelineService.bookingTimeline"), 'Operational ticket detail must include booking timeline data.');
assert(ticketDetailSource.includes("Booking timeline"), 'Operational ticket page must render the booking timeline.');


assert(html.includes('v18: compact organized aside') || html.includes('v17: restore organized sidebar') || html.includes('v16: keep long sidebar labels readable'), 'Dashboard sidebar must include long-label readability fix.');
assert(html.includes('white-space:normal !important'), 'Sidebar labels must wrap instead of being cut off.');
assert(html.includes('balancedSupplementGroups'), 'View modals must add balanced supplemental detail fields.');
assert(html.includes('balancedFallbackMarkup'), 'View modals must avoid raw overlong detail dumps.');
assert(html.includes("type:'multiselect'"), 'Forms must support selectable multi-value fields for stops, amenities, days, and seats.');
assert(html.includes('foldSelect') && html.includes('data-fold-select'), 'Multi-option fields must use collapsible checkbox fold selectors.');


assert(html.includes('v19: sidebar active state matches hover pill rounding'), 'Sidebar active state must use the same rounded pill shape as hover.');
assert(html.includes('.navBtn.is-active:hover'), 'Sidebar active state must include a stable hover-active style.');
assert(html.includes('companyBusPassengerManifestTable'), 'Bus manifests must include passenger-level boarding table.');
assert(html.includes('manifest_passenger'), 'Passenger manifest rows must have operational detail/action metadata.');
assert(html.includes('data-type="seat status"') || html.includes('data-type="seat status"'), 'Seat maps must expose a seat status modal action.');
assert(html.includes('seatOpsPanel'), 'Seat maps must include the organized seat operations panel.');
assert(companyRoutes.includes("router.post('/company/seats/status'"), 'Company seat status POST route must exist.');
assert(html.includes('Vehicle seat templates'), 'Seat maps must include vehicle seat-template workbench.');
assert(html.includes('Template builder'), 'Seat maps must expose the reusable seat template builder action.');
assert(html.includes('seatLabels'), 'Seat template modal must support custom seat labels.');
assert(html.includes('vipSeats'), 'Seat template modal must support VIP/premium seat selection.');
assert(html.includes('disabledSeats'), 'Seat template modal must support disabled/non-passenger space selection.');
assert(companyRoutes.includes("router.post('/company/vehicles/seat-template'"), 'Company vehicle seat-template POST route must exist before /:id routes.');

console.log('Dashboard scope validation passed.');

// Row-level View/Edit/Delete modals must exist for company-owned bus/hotel records.
assert(html.includes('data-modal="view"'), 'Dashboard rows must expose view modal buttons.');
assert(html.includes('data-modal="edit"'), 'Dashboard rows must expose edit modal buttons.');
assert(html.includes('data-modal="delete"'), 'Dashboard rows must expose delete/archive modal buttons.');
assert(html.includes('function archiveActionFor'), 'Dashboard must map delete/archive modal actions to company-scoped routes.');
assert(html.includes('function addModeButtons'), 'Dashboard must inject row-level edit/delete modal buttons.');
assert(html.includes("mode === 'edit' && key === 'listing'"), 'Listing edit modal config must exist.');
assert(html.includes("mode === 'edit' && key === 'route'"), 'Route edit modal config must exist.');
assert(html.includes("mode === 'edit' && key === 'vehicle'"), 'Vehicle edit modal config must exist.');
assert(html.includes("mode === 'edit' && key === 'schedule'"), 'Schedule edit modal config must exist.');
assert(html.includes("mode === 'edit' && key === 'room_type'"), 'Room type edit modal config must exist.');
assert(html.includes("mode === 'edit' && key === 'hotel_property'"), 'Hotel property edit modal config must exist.');
assert(companyRoutes.includes("router.post('/company/listings/:id'"), 'Listing update route must exist.');
assert(companyRoutes.includes("router.post('/company/routes/:id'"), 'Route update route must exist.');
assert(companyRoutes.includes("router.post('/company/vehicles/:id'"), 'Vehicle update route must exist.');
assert(companyRoutes.includes("router.post('/company/schedules/:id'"), 'Schedule update route must exist.');
assert(companyRoutes.includes("router.post('/company/hotels/room-types/:id/inventory'"), 'Canonical room-type inventory update route must exist.');
assert(companyRoutes.includes("router.post('/company/hotels/properties/:id'"), 'Hotel property update route must exist.');
assert(companyRoutes.includes("router.post('/company/hotels/room-types/:id'"), 'Room type update route must exist.');
assert(companyRoutes.includes("router.post('/company/hotels/room-units/:id'"), 'Room unit update route must exist.');

// Hotel booking/date-range/check-in timeline integration must stay wired.
const hotelServicePath = path.join(__dirname, '..', 'src', 'services', 'hotel', 'hotelService.js');
const hotelServiceSource = fs.readFileSync(hotelServicePath, 'utf8');
const hotelRepositoryPath = path.join(__dirname, '..', 'src', 'repositories', 'domain', 'hotelRepository.js');
const hotelRepositorySource = fs.readFileSync(hotelRepositoryPath, 'utf8');
const actionServicePath = path.join(__dirname, '..', 'src', 'services', 'dashboard', 'actionService.js');
const actionServiceSource = fs.readFileSync(actionServicePath, 'utf8');
assert(companyRoutes.includes("router.post('/company/hotels/bookings'"), 'Company hotel booking POST route must exist.');
assert(html.includes("action: '/company/hotels/bookings'"), 'Hotel company booking modal must post to /company/hotels/bookings.');
assert(html.includes("name:'checkInDate'") && html.includes("name:'checkOutDate'"), 'Hotel booking form must collect check-in/check-out date range.');
assert(html.includes("name:'roomTypeId'") && html.includes("name:'roomUnitIds'"), 'Hotel booking form must allow room type and optional room-unit selection.');
assert(html.includes("name:'adults'") && html.includes("name:'children'"), 'Hotel booking form must collect guest counts.');
assert(hotelServiceSource.includes('availableNightGroups') && hotelServiceSource.includes('Not enough room-night inventory'), 'Hotel booking service must validate room-night availability.');
assert(hotelServiceSource.includes('selectedRoomUnitIds'), 'Hotel booking service must respect selected room units when provided.');
assert(hotelServiceSource.includes("hotel.booking.created") && hotelServiceSource.includes("hotel.inventory.booked") && hotelServiceSource.includes("hotel.voucher.issued"), 'Hotel booking service must write booking, inventory, and voucher timeline events.');
assert(hotelServiceSource.includes("hotel.stay.${normalized}"), 'Hotel check-in/check-out must write stay timeline events.');
assert(actionServiceSource.includes('hotelService.createHotelBooking'), 'Company dashboard manual booking must dispatch hotel bookings to hotelService.');
assert(html.includes('hotel_booking'), 'Hotel booking view modals must have curated hotel stay details.');
console.log('Hotel operations validation passed.');

// Seat labeling must stay clean and numeric across the app. Legacy A1/B2/F3 style
// values caused payment/ticket pages to show labels such as "Seat F3".
const seatLabelFiles = [
  'src',
  'public',
  'tests',
].flatMap((dir) => {
  const base = path.join(__dirname, '..', dir);
  const out = [];
  function walk(current) {
    if (!fs.existsSync(current)) return;
    fs.readdirSync(current, { withFileTypes: true }).forEach((entry) => {
      if (entry.name === 'node_modules') return;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) return walk(full);
      if (/\.(js|ejs|css)$/.test(entry.name)) out.push(full);
    });
  }
  walk(base);
  return out;
});
seatLabelFiles.forEach((file) => {
  const source = fs.readFileSync(file, 'utf8');
  assert(!source.includes('Seat Number'), `Use Seat No wording instead of Seat Number in ${file}`);
  const strippedPdfA4 = source.replace(/size:\s*['"]A4['"]/g, '');
  assert(!/\bSeat\s+[A-Za-z]\d+\b/.test(strippedPdfA4), `Legacy Seat A1/B2 style label found in ${file}`);
});


// Bus production hardening: schedule publish guard, route-stop ordering,
// seat hold safety, and manifest print polish must remain wired.
const busSetupServicePath = path.join(__dirname, '..', 'src', 'modules', 'bus', 'services', 'busSetupService.js');
const busDepartureServicePath = path.join(__dirname, '..', 'src', 'modules', 'bus', 'services', 'busDepartureService.js');
const busSetupServiceSource = fs.readFileSync(busSetupServicePath, 'utf8');
const busDepartureServiceSource = fs.readFileSync(busDepartureServicePath, 'utf8');
const companyServiceSource = `${busSetupServiceSource}\n${busDepartureServiceSource}`;
const seatLockServicePath = path.join(__dirname, '..', 'src', 'services', 'booking', 'seatLockService.js');
const seatLockServiceSource = fs.readFileSync(seatLockServicePath, 'utf8');
const driverManifestPath = path.join(__dirname, '..', 'src', 'views', 'pages', 'driver-manifest-print.ejs');
const companyManifestPath = path.join(__dirname, '..', 'src', 'views', 'pages', 'company-customer-manifest.ejs');
const driverManifestSource = fs.readFileSync(driverManifestPath, 'utf8');
const companyManifestSource = fs.readFileSync(companyManifestPath, 'utf8');
assert(companyServiceSource.includes('company_not_active_and_verified'), 'Schedule publish validation must block inactive or unverified companies.');
assert(companyServiceSource.includes('vehicle_time_conflict'), 'Schedule publish validation must block vehicle time conflicts.');
assert(companyServiceSource.includes('departure_must_be_future'), 'Schedule publish validation must require future departure.');
assert(companyServiceSource.includes('cancellation_policy_not_configured') || companyServiceSource.includes('Add the cancellation policy'), 'Bus publication readiness must require a cancellation policy.');
assert(busSetupServiceSource.includes('async function moveRouteStop'), 'Route stops must support move up/down ordering.');
assert(companyRoutes.includes("router.post('/company/route-stops/:stopId/move'"), 'Company route-stop move endpoint must exist.');
assert(html.includes('Move stop up') && html.includes('Move stop down'), 'Dashboard route-stop row actions must include move up/down buttons.');
assert(seatLockServiceSource.includes('assertSeatCanBeHeld'), 'Seat holds must run a central availability guard.');
assert(seatLockServiceSource.includes('existingActiveHold'), 'Seat holds must check active holds before locking.');
assert(seatLockServiceSource.includes('Seat is already booked'), 'Seat holds must block already booked seats.');
assert(driverManifestSource.includes('@page{size:A4 landscape') && companyManifestSource.includes('@page{size:A4 landscape'), 'Manifest print pages must include landscape print CSS.');
assert(driverManifestSource.includes('signatureGrid') && companyManifestSource.includes('signatureGrid'), 'Manifest print pages must include signature boxes.');
console.log('Bus production hardening validation passed.');

// Hotel calendar/stay operations hardening must remain wired.
assert(html.includes('hotelRoomCalendarGrid'), 'Hotel dashboard must render the visual room calendar grid.');
assert(html.includes('renderHotelRoomCalendar'), 'Hotel dashboard must initialize the room calendar renderer.');
assert(html.includes('hotelCalendarControls'), 'Hotel dashboard must include room calendar controls.');
assert(html.includes('hotelCalLegend'), 'Hotel room calendar must include a status legend.');
assert(hotelServiceSource.includes('affectedNights'), 'Hotel check-in/out must update affected room-night inventory rows.');
assert(hotelRepositorySource.includes("housekeepingStatus: 'dirty'") && hotelRepositorySource.includes("status: 'cleaning'"), 'Hotel check-out must move room units into dirty housekeeping state.');

// Hotel housekeeping task board and stay-settlement release must remain wired.
assert(html.includes('companyHousekeepingTable'), 'Hotel dashboard must include a housekeeping task board table.');
assert(html.includes('hkOpenCount') && html.includes('hkCleaningCount') && html.includes('hkMaintenanceCount'), 'Hotel housekeeping board must include operational summary cards.');
assert(companyRoutes.includes("router.post('/company/hotels/housekeeping/:unitId'"), 'Company hotel housekeeping update route must exist.');
assert(hotelServiceSource.includes('async function updateHousekeeping'), 'Hotel service must expose updateHousekeeping workflow.');
assert(hotelServiceSource.includes("hotel.housekeeping.updated"), 'Hotel housekeeping updates must be audit logged.');
assert(hotelServiceSource.includes('releaseService.releaseCompletedBooking'), 'Hotel check-out must release eligible settlement earnings.');
assert(hotelServiceSource.includes("hotel.settlement.eligible"), 'Hotel check-out must write settlement timeline event.');
assert(hotelServiceSource.includes('settleSuccessfulBooking'), 'Hotel successful payment must create pending settlement/commission entries.');
console.log('Hotel housekeeping and settlement validation passed.');
