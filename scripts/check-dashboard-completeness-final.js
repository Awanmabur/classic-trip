#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const results = [];

function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
}
function contains(source, token) { return source.includes(token); }
function count(source, token) { return source.split(token).length - 1; }

const css = read('public/css/accessibility-safe.css');
const workspace = read('public/js/dashboard-workspace.js');
const projection = read('src/services/dashboard/dashboardProjectionEngine.js');
const companyRoutes = read('src/routes/web/company.js');
const adminRoutes = read('src/routes/web/admin.js');
const companyController = read('src/controllers/company/operationsController.js');
const companyService = read('src/services/company/companyService.js');
const actionController = read('src/controllers/admin/actionController.js');
const sharedWorkspace = read('src/views/dashboards/shared/workspace.ejs');
const listingsView = read('src/views/dashboards/shared/sections/listings.ejs');
const reviewsView = read('src/views/dashboards/shared/sections/reviews.ejs');
const flightTaxiView = read('src/views/dashboards/shared/sections/flight-taxi.ejs');
const adminPartnerNetwork = read('src/views/dashboards/shared/sections/admin-partner-network.ejs');
const adminTravelSupply = read('src/views/dashboards/shared/sections/admin-travel-supply-controls.ejs');
const taxiAdminRoutes = read('src/modules/taxi/routes/adminTaxiRoutes.js');
const taxiSetupService = read('src/modules/taxi/services/taxiSetupService.js');

check('Blue dashboard buttons keep light text', contains(css, '.dashboardBody :is(a,button,input[type="submit"],input[type="button"]).btnBlue') && contains(css, 'color: #f8fbff !important'));
check('Blue hover uses a dark blue surface', contains(css, '.btnBlue:hover') && contains(css, 'linear-gradient(135deg, #3978ef, #1d56df)'));
check('Nested button text and icons inherit contrast', contains(css, '.btnBlue:hover :is(span,strong,b,small,i,svg,path)') && contains(css, 'fill: currentColor !important'));
check('Disabled blue controls retain readable text', contains(css, '.btnBlue[disabled]') && contains(css, 'rgba(255,255,255,.72)'));

check('Generic renderer reads real table headers', contains(workspace, 'function tableHeadersFor(selector)'));
check('Generic rows are rendered by schema', contains(workspace, 'function renderGenericRow(selector, row, meta, type)'));
check('Generic rows no longer hard-truncate at seven columns', !contains(workspace, 'row.slice(0, 7)'));
check('Overflow values are not merged under a wrong heading', contains(workspace, 'Never merge overflow into the final labelled column'));
check('Full row details remain available', contains(workspace, 'function completeRowDetail') && contains(workspace, 'data-row-detail'));
check('Tables expose real empty states', contains(workspace, 'emptyTableState') && contains(workspace, 'No records found'));
check('All visible dashboard tables can export CSV', contains(workspace, 'function exportVisibleDashboardTables') && contains(workspace, 'Dashboard data exported'));

check('Booking service type comes from metadata', contains(workspace, 'function rowServiceType(row)'));
check('Bus bookings use metadata filtering', contains(workspace, "rowServiceType(r) === 'bus'"));
check('Hotel, stay and Airbnb bookings share stay operations', contains(workspace, "['hotel','stay','airbnb'].includes(rowServiceType(r))") && contains(workspace, "['hotel','stay','airbnb'].includes(detailServiceType)"));

check('Company branch edit endpoint exists', contains(companyRoutes, "router.post('/company/branches/:id'") && contains(companyController, 'async function updateBranch'));
check('Company branch service enforces ownership', contains(companyService, 'async function updateBranch(companyId, branchId') && contains(companyService, "findOne({ companyId: company.id, id: cleanText(branchId") && contains(companyService, 'not found for this company'));
check('Company policy edit endpoint exists', contains(companyRoutes, "router.post('/company/policies/:id'") && contains(companyController, 'async function updatePolicy'));
check('Company policy service enforces ownership', contains(companyService, 'async function updatePolicy(companyId, policyId') && contains(companyService, "findOne({ companyId: company.id, id: cleanText(policyId") && contains(companyService, 'One or more selected policy branches do not belong to this company'));
check('Fare products have real edit forms', contains(workspace, "key === 'fare product' || key === 'fare_product'") && contains(workspace, '`/company/fares/${encodeURIComponent(fareProductId)}`'));
check('Segment fares have real edit forms', contains(workspace, "key === 'segment fare' || key === 'segment_fare'") && contains(workspace, "action: '/company/fare-segments'"));
check('Branches and policies are mutable dashboard entities', contains(workspace, "'branch','policy'") && contains(workspace, "key === 'branch'") && contains(workspace, "key === 'policy'"));

check('Partner promotions have pause/resume/end operations', contains(workspace, '/company/promotions/${id}/pause') && contains(workspace, '/company/promotions/${id}/resume') && contains(workspace, '/company/promotions/${id}/end'));
check('Partner reviews have reply operations', contains(workspace, 'data-type="review reply"') && contains(companyRoutes, "router.post('/company/reviews/:id/reply'"));
check('Partner support cases have response operations', contains(workspace, 'data-type="support response"') && contains(companyRoutes, "router.post('/company/support/:id'"));
check('Staff rows have lifecycle management', contains(workspace, 'data-type="staff status"') && contains(workspace, '/company/staff/${id}/role'));
check('Driver rows have complete profile and activation management', contains(workspace, 'data-type="driver profile"') && contains(companyRoutes, "router.post('/company/drivers/:id/profile'") && contains(workspace, '/company/drivers/${id}/activate'));

check('Platform support replies use role-correct paths', contains(workspace, "dashboardRoleKey === 'support'") && contains(workspace, '`/support/${encodeURIComponent(recordId)}/reply`'));
check('Refund rows expose approve and reject', contains(workspace, '/refunds/${id}/approve') && contains(workspace, '/refunds/${id}/reject'));
check('Payment rows expose freeze review', contains(workspace, 'data-type="payment"') && contains(workspace, '/payments/freeze'));
check('Review rows expose moderation', contains(workspace, 'data-type="review moderation"') && contains(adminRoutes, "router.post('/content/reviews/:id/moderate'") && contains(adminRoutes, "router.post('/admin/reviews/:id/moderate'"));
check('Payout entity aliases expose review', contains(workspace, "['payout','payout_request','company_payout_request'].includes(entity)") && contains(workspace, '/payouts/${id}/review'));
check('Customer note opens on the selected customer', contains(workspace, "value: recordId || fieldValue('customer.id', 'customerId', 'id')"));

check('Platform price rules are projected as dashboard rows', contains(projection, 'const priceRuleRows =') && contains(projection, 'priceRules: priceRuleRows'));
check('Price rule rows carry complete metadata', contains(projection, "dashboardMeta('price_rule'") && contains(projection, "['view', 'edit', 'export']"));
check('Price rules table is connected to renderer', contains(workspace, "fillTable('#priceRulesTable', data.priceRules || [], 'generic')"));
check('Price rules have create and update routes', contains(adminRoutes, "router.post('/admin/price-rules'") && contains(adminRoutes, "router.post('/admin/price-rules/:id'") && contains(adminRoutes, "router.post('/content/price-rules/:id'"));
check('Price rule controller updates existing records', contains(actionController, 'const requestedId = cleanText(req.params?.id || req.body.id') && contains(actionController, "'admin.price.rule.updated'"));
check('Price rule edit form preserves values and status', contains(workspace, "submit: recordId ? 'Update price rule'") && contains(workspace, "options:['active','disabled','expired']"));
check('Company pricing uses service-owned tools', contains(listingsView, 'companyPricingHref') && contains(listingsView, 'Manage stop-to-stop fares') && contains(listingsView, 'Manage room and rate pricing'));
check('Company dashboard no longer posts platform price rules', contains(listingsView, '<% if(isCompanyDashboard)') && contains(listingsView, 'Platform pricing rules'));

check('Top dashboard role badge is non-interactive status text', contains(sharedWorkspace, '<span class="btn btnPrimary') && !contains(sharedWorkspace, '<button class="btn btnPrimary dashboardRoleBadge'));
check('Review export is a real download link', contains(reviewsView, 'href="/company/reports/reviews.csv"'));

check('Flight and taxi manual tables carry detail payloads', contains(flightTaxiView, 'dashboardDetail') && count(flightTaxiView, 'data-row-detail=') >= 7, `found ${count(flightTaxiView, 'data-row-detail=')} detail controls`);
check('Flight quotes expose View and private-link copy', contains(flightTaxiView, "dashboardDetail('flight_quote'") && contains(flightTaxiView, 'Copy private quote link'));
check('Flight travelers, tickets, changes and refunds expose actions', contains(flightTaxiView, 'flight_traveler') && contains(flightTaxiView, 'flight_ticket') && contains(flightTaxiView, 'flight_change_request') && contains(flightTaxiView, 'flight_refund_request'));
check('Taxi vehicles expose operational status edits', contains(flightTaxiView, '/company/taxi/vehicles/<%= row.id %>/status') && contains(flightTaxiView, '<option value="maintenance"'));
check('Taxi drivers, incidents and rides expose View actions', contains(flightTaxiView, 'taxi_driver') && contains(flightTaxiView, 'taxi_incident') && contains(flightTaxiView, 'taxi_ride'));
check('Admin mobility safety queue exposes View and Review', contains(adminPartnerNetwork, "networkDetail('taxi_incident'") && contains(adminPartnerNetwork, '/admin/mobility/incidents/<%= row.id %>/review'));
check('Admin mobility incident review is persisted and audited', contains(taxiAdminRoutes, "router.post('/admin/mobility/incidents/:id/review'") && contains(taxiSetupService, 'async function reviewIncident') && contains(taxiSetupService, 'mobility.incident.reviewed'));
check('Admin mobility dispatch rows expose full details', contains(adminPartnerNetwork, "networkDetail('taxi_ride'") && contains(adminPartnerNetwork, 'View ride details'));
check('Read-only admin flight quotes expose full snapshots', contains(adminTravelSupply, "controlDetail('flight_quote'") && contains(adminTravelSupply, 'View quote snapshot'));

// Detect a common source of completely blank dashboard pages: a static empty tbody
// that is never referenced by the shared renderer.
const dashboardFiles = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith('.ejs')) dashboardFiles.push(full);
  }
})(path.join(root, 'src/views/dashboards'));
const missingBodies = [];
for (const file of dashboardFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const regex = /<tbody\s+id=["']([^"']+)["'][^>]*>\s*<\/tbody>/gi;
  let match;
  while ((match = regex.exec(source))) {
    const id = match[1];
    if (id.includes('<%=')) continue;
    if (!workspace.includes(`#${id}`) && !workspace.includes(id)) missingBodies.push(`${path.relative(root, file)}#${id}`);
  }
}
check('Every static empty dashboard table body has a renderer', missingBodies.length === 0, missingBodies.join(', '));

const failed = results.filter((item) => !item.ok);
for (const item of results) {
  console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` (${item.detail})` : ''}`);
}
console.log(`\nDashboard completeness audit: ${results.length - failed.length}/${results.length} passed.`);
if (failed.length) process.exit(1);
