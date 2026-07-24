'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [];
function expect(name, condition) {
  checks.push({ name, condition: Boolean(condition) });
}
function has(file, pattern) {
  return pattern.test(read(file));
}

expect('ServiceAddon model exists', fs.existsSync(path.join(root, 'src/models/ServiceAddon.js')));
expect('Partner add-on controller exists', fs.existsSync(path.join(root, 'src/controllers/company/addonController.js')));
expect('Partner add-on create route exists', has('src/routes/web/company.js', /post\('\/company\/addons'/));
expect('Partner add-on update route exists', has('src/routes/web/company.js', /post\('\/company\/addons\/:id'/));
expect('Partner add-on archive route exists', has('src/routes/web/company.js', /post\('\/company\/addons\/:id\/archive'/));
expect('Extra luggage starter exists', has('src/modules/bus/services/busSetupService.js', /Extra luggage/));
expect('Priority boarding starter exists', has('src/modules/bus/services/busSetupService.js', /Priority boarding/));
expect('SMS and WhatsApp starter exists', has('src/modules/bus/services/busSetupService.js', /SMS and WhatsApp ticket/));
expect('Server prices selected add-ons', has('src/modules/bus/services/busBookingService.js', /selectedAddonPricing/));
expect('Server supports per traveler per leg', has('src/modules/bus/services/busBookingService.js', /per_passenger_per_leg/));
expect('Booking stores add-on snapshots', has('src/modules/bus/services/busBookingService.js', /addons:\s*addonPricing\.addons/));
expect('Preview exposes add-ons', has('src/services/marketplace/catalogService.js', /addons:/));
expect('Checkout shows add-ons total', has('src/views/pages/booking-form.ejs', /Add-ons total/));
expect('Ticket shows optional extras', has('src/views/pages/ticket.ejs', /Optional extras/));
expect('Success page shows optional extras', has('src/views/pages/booking-success.ejs', /Optional extras/));
expect('PDF ticket shows optional extras', has('src/services/pdf/ticketPdfService.js', /Optional extras/));
expect('Communication add-on controls SMS and WhatsApp', has('src/services/notification/notificationService.js', /hasCommunicationTicketAddon/) && has('src/services/notification/notificationService.js', /channels\.push\('sms', 'whatsapp'\)/));
expect('Bus confirmation outbox handler exists', has('src/services/shared/outboxHandlers.js', /BusBookingConfirmed:/));
expect('Return departure validates outbound arrival', has('src/modules/bus/services/busBookingService.js', /outbound journey arrives/));
expect('Return seat selection resets after outbound change', has('src/views/pages/listing-details.ejs', /Reset the return seats whenever outbound seats/));
expect('Return ticket explanation exists', has('src/views/pages/listing-details.ejs', /separate ticket\/QR for every traveler on each leg/));
expect('2x3 layout option exists', has('public/js/dashboard-workspace.js', /'2x3'/));
expect('3x3 layout option exists', has('public/js/dashboard-workspace.js', /'3x3'/));
expect('Public seat rows are dynamic', has('src/views/pages/listing-details.ejs', /seatGroup/) && has('public/css/pages/home.css', /\.seatGroup/));
expect('Dashboard seat rows are dynamic', has('src/views/dashboards/shared/sections/seat-maps.ejs', /busSeatGroup/) && has('public/css/dashboard-workspace.css', /\.busSeatGroup/));
expect('Public preview removes selected journey fare strip', !has('src/views/pages/listing-details.ejs', /Selected journey fare/) && has('src/views/pages/listing-details.ejs', /price is recalculated from the boarding stop/));
expect('Public preview hides technical fare product label', !/Fare product/.test(read('src/views/pages/listing-details.ejs')));
expect('Public preview hides technical journey segment label', !/Journey segment/.test(read('src/views/pages/listing-details.ejs')));
expect('Marketplace cards use approved shared reference layout', has('src/views/pages/home.ejs', /partials\/listing-card/) && has('src/views/partials/listing-card.ejs', /referenceBusCard/) && has('public/js/home.js', /referenceBusCard/));
expect('Implementation guide exists', fs.existsSync(path.join(root, 'FINAL-END-TO-END-BUS-HOTEL-2026-07-24.md')));

const failed = checks.filter((row) => !row.condition);
if (failed.length) {
  console.error(`Add-on/return/seat checks failed: ${checks.length - failed.length}/${checks.length}`);
  failed.forEach((row) => console.error(`- ${row.name}`));
  process.exit(1);
}
console.log(`Add-on/return/seat checks passed: ${checks.length}/${checks.length}`);
