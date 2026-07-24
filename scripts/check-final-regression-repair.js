'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
let passed = 0;
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
  passed += 1;
};

const css = read('public/css/accessibility.css');
assert(!/html\[data-theme="dark"\][\s\S]{0,240}background(?:-color)?\s*:/i.test(css.replace(/::selection[\s\S]*?\}/g, '')), 'Dark-mode accessibility layer must not replace page backgrounds');
assert(!/html\[data-theme="dark"\]\s+\*/.test(css), 'Blanket dark-mode selector is forbidden');
assert(css.includes('--ct-mobile-control: 50px'), 'Accepted 50px mobile control size must be restored');
assert(css.includes('--ct-mobile-button: 48px'), 'Accepted 48px mobile button size must be restored');
assert(!css.includes('--ct-mobile-control: 54px') && !css.includes('--ct-mobile-button: 52px'), 'Oversized regression values must be absent');
assert(css.includes('color: #f8fafc') && css.includes('color: var(--muted)'), 'Dark mode must improve text contrast');

const catalog = read('src/services/marketplace/catalogService.js');
const commerce = read('src/repositories/domain/commerceRepository.js');
const home = read('src/views/pages/home.ejs');
const homeJs = read('public/js/home.js');
const listingCard = read('src/views/partials/listing-card.ejs');
const details = read('src/views/pages/listing-details.ejs');
const schedules = read('src/views/dashboards/shared/sections/schedules.ejs');
const projection = read('src/services/dashboard/dashboardProjectionEngine.js');
const busSetup = read('src/modules/bus/services/busSetupService.js');
assert(commerce.includes("fareProducts: new MongoCollection('fareProducts')"), 'Fare products must be loaded from MongoDB');
assert(commerce.includes("segmentFares: new MongoCollection('busSegmentFares')"), 'Segment fares must be loaded from MongoDB');
assert(catalog.includes('fareCatalogForListing') && catalog.includes('priceFrom'), 'Public catalog must derive fare summaries');
assert(busSetup.includes('syncListingFareSummary'), 'Fare changes must synchronize listing starting price');
assert(home.includes("include('../partials/listing-card'") && listingCard.includes('referenceBusCard') && listingCard.includes('Starting fare · choose boarding and drop-off') && !listingCard.includes('fareProductName'), 'Server-rendered marketplace pages must use the approved shared reference card without internal fare-plan names');
assert(homeJs.includes('referenceBusCard') && homeJs.includes('Starting fare · choose boarding and drop-off') && !homeJs.includes('fareProductName'), 'Dynamic homepage bus cards must use the approved reference layout without internal fare-plan names');
assert(!details.includes('Selected journey fare') && details.includes('Your ticket price is recalculated from the boarding stop') && !details.includes('Fare product</th>'), 'Listing details must omit the removed fare strip while explaining stop-based pricing');
assert(schedules.includes('Fare plans') && schedules.includes('Stop-to-stop prices'), 'Partner dashboard must retain internal fare-plan and stop-to-stop price management');
assert(projection.includes('fareProductRows') && projection.includes('segmentFareRows'), 'Dashboard projection must return saved fare records');

const workspace = read('public/js/dashboard-workspace.js');
const operations = read('src/controllers/company/operationsController.js');
assert(workspace.includes("entity === 'employee'") && workspace.includes("key === 'staff status'"), 'Partner Admin employee activation controls must exist');
assert(workspace.includes('/company/staff/') && workspace.includes('/role'), 'Employee status actions must call the Partner Admin route');
assert(operations.includes('updateStaffRole'), 'Partner Admin employee status controller must remain connected');

const booking = read('src/services/booking/bookingService.js');
const busBooking = read('src/modules/bus/services/busBookingService.js');
const webhook = read('src/services/payment/webhookService.js');
assert(booking.includes('purgeFailedBookingArtifacts'), 'Generic failed bookings must be purged');
assert(busBooking.includes('purgeFailedBookingArtifacts'), 'Bus failed bookings must be purged');
assert(webhook.includes("outcome: 'failed_without_booking'"), 'Failed webhooks must retain only a technical audit outcome');
assert(webhook.includes('processBookingGroupWebhook'), 'Historical booking-group payment reconciliation must remain available');
assert(!exists('src/services/cart/cartService.js') && !exists('src/controllers/public/cartController.js') && !exists('src/views/pages/cart-checkout.ejs'), 'Unsafe legacy cart creation and checkout implementation must remain removed');
assert(webhook.includes("status !== 'failed'"), 'Duplicate failed webhooks must not preserve stale payment rows');
assert(projection.includes('isFailedPaymentArtifact') && projection.includes('isFinanciallySuccessful'), 'Financial dashboards must exclude failed artifacts');

const marketingViews = ['services.ejs','routes.ejs','companies.ejs','promoters.ejs','blogs.ejs','blog-post.ejs','how-it-works.ejs','partner-commission.ejs','privacy.ejs','terms.ejs','support.ejs'];
marketingViews.forEach((file) => assert(exists(`src/views/pages/${file}`), `Marketing page missing: ${file}`));
['site-header.ejs','site-footer.ejs','site-head.ejs'].forEach((file) => assert(exists(`src/views/partials/${file}`), `Marketing partial missing: ${file}`));
const publicRoutes = read('src/routes/web/public.js');
const apiBookingRoutes = read('src/routes/api/bookings.js');
assert(!/["']\/cart(?:\/|["'])/.test(publicRoutes) && !/["']\/cart(?:\/|["'])/.test(apiBookingRoutes), 'Legacy cart endpoints must not be publicly reachable');
const listingController = read('src/controllers/public/listingController.js');
const blogController = read('src/controllers/public/blogController.js');
assert(publicRoutes.includes("'/support'") && publicRoutes.includes("'/how-it-works'") && publicRoutes.includes("'/terms'") && publicRoutes.includes("'/privacy'"), 'Core marketing routes must remain registered');
assert(listingController.includes("res.render('pages/services'") && listingController.includes("res.render('pages/routes'") && listingController.includes("res.render('pages/companies'"), 'Marketplace marketing controllers must remain registered');
assert(blogController.includes("res.render('pages/blogs'") && blogController.includes("res.render('pages/blog-post'"), 'Blog marketing pages must remain registered');

console.log(`Final regression repair checks passed: ${passed}/${passed}`);
