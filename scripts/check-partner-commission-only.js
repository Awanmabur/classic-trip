'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [];
const check = (name, ok) => checks.push({ name, ok: Boolean(ok) });

const commercial = read('src/services/commission/commercialTermsService.js');
const companyService = read('src/services/company/companyService.js');
const platformModel = read('src/models/PlatformSetting.js');
const companyModel = read('src/models/Company.js');
const listingModel = read('src/models/Listing.js');
const fareProductModel = read('src/models/FareProduct.js');
const roomTypeModel = read('src/models/RoomType.js');
const bookingModel = read('src/models/Booking.js');
const commissionModel = read('src/models/Commission.js');
const busBooking = read('src/modules/bus/services/busBookingService.js');
const busInventory = read('src/modules/bus/services/busInventoryService.js');
const hotel = read('src/services/hotel/hotelService.js');
const genericBooking = read('src/services/booking/bookingBuilderService.js');
const settlement = read('src/services/booking/paymentSettlementService.js');
const workspace = read('public/js/dashboard-workspace.js');
const paymentsView = read('src/views/dashboards/shared/sections/payments.ejs');
const busPricing = read('src/utils/busCustomerPricing.js');
const listingDetails = read('src/views/pages/listing-details.ejs');
const bookingForm = read('src/views/pages/booking-form.ejs');
const packageJson = JSON.parse(read('package.json'));

check('commercial engine supports percentage and fixed-per-unit agreements', /percentage_commission/.test(commercial) && /fixed_per_unit/.test(commercial));
check('fixed agreements support ticket, room and room-night units', /per_ticket/.test(commercial) && /per_room/.test(commercial) && /per_room_night/.test(commercial));
check('promoter reward supports fixed amount or percentage of Classic Trip share', /fixed_amount/.test(commercial) && /percentage_of_platform/.test(commercial) && /promoterAmount/.test(commercial));
check('customer discount is capped inside Classic Trip gross commission', /customerDiscountModel/.test(commercial) && /Math\.max\(0, platformGross - discountAmount\)/.test(commercial));
check('partner payout is calculated before promoter and discount allocations', /companyAmount\s*=\s*money\(Math\.max\(0, gross - platformGross\)\)/.test(commercial));
check('partner model stores flexible commercial terms', /fixedAmount/.test(companyModel) && /unitBasis/.test(companyModel) && /customerDiscountModel/.test(companyModel));
check('listing, bus fare plan and hotel room type support overrides', /commercialTermsOverride/.test(listingModel) && /commercialTermsOverride/.test(fareProductModel) && /commercialTermsOverride/.test(roomTypeModel));
check('Super Admin service writes partner and scoped overrides', /updateCommercialTerms/.test(companyService) && /updateCommercialOverride/.test(companyService));
check('global settings store flexible fallback rather than a fixed promoter policy', /commercialModel/.test(platformModel) && /fixedPlatformAmount/.test(platformModel) && /customerDiscountModel/.test(platformModel));
check('new platform bootstrap has no non-zero commercial amount hard-coded', /partnerCommissionPercent:\s*\{[^}]*default:\s*0/.test(platformModel));
check('bus availability resolves fare-plan-specific terms', /fareProduct:\s*context\.fareProduct/.test(busInventory) && /TRUSTED_COMMERCIAL_CONTEXT/.test(busInventory));
check('bus booking freezes components and internal split', /commercialTermsSnapshot/.test(busBooking) && /commercialComponents/.test(busBooking) && /pricing,/.test(busBooking));
check('hotel booking resolves room-type commercial terms', /roomType:\s*roomTypes\[0\]/.test(hotel) && /snapshotTerms\(commercialTerms\)/.test(hotel));
check('other marketplace bookings resolve listing/partner commercial terms', /resolveTerms\(\{ company, listing \}\)/.test(genericBooking));
check('settlement uses frozen booking split or frozen snapshot fallback', /booking\.pricing\?\.split/.test(settlement) && /fallbackSplitForBooking/.test(settlement));
check('commission records preserve commercial model, fixed amount, discounts and version', ['commercialModel','fixedPlatformAmount','unitBasis','discountAmount','termsVersion'].every((field) => commissionModel.includes(field)));
check('Super Admin UI exposes partner/listing/fare-plan/room-type rules', /commercial rule/.test(workspace) && /fare_product/.test(workspace) && /room_type/.test(workspace));
check('Payments page explains the most-specific commercial agreement controls', /Commercial agreements/.test(paymentsView) && /fare plan/.test(paymentsView) && /room-type/.test(paymentsView));
check('bus customer pricing contains no UGX 3000 acquisition discount or tiered fee constants', !/3000/.test(busPricing) && !/30000/.test(busPricing) && !/150000/.test(busPricing));
check('browser booking summaries use authoritative seat customer fares rather than hard-coded discounts', !/Math\.min\(3000/.test(listingDetails) && !/Math\.min\(3000/.test(bookingForm) && /customerFare/.test(listingDetails) && /customerFare/.test(bookingForm));
check('package retains the commercial agreement regression command', Boolean(packageJson.scripts['check:commission-only']));

const failed = checks.filter((row) => !row.ok);
if (failed.length) {
  console.error(`Commercial agreement checks failed (${checks.length - failed.length}/${checks.length}).`);
  failed.forEach((row) => console.error(`- ${row.name}`));
  process.exit(1);
}
console.log(`Commercial agreement checks passed (${checks.length}/${checks.length}).`);
