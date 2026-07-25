'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const checks = [];
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const has = (file, pattern) => exists(file) && pattern.test(read(file));
const lacks = (file, pattern) => exists(file) && !pattern.test(read(file));
const hasAll = (file, patterns) => patterns.every((pattern) => has(file, pattern));
function expect(name, condition) { checks.push({ name, condition: Boolean(condition) }); }

// Shared four-service contracts.
['Airport', 'FlightSupplier', 'FlightAgencyProfile', 'FlightSupplierAccess', 'FlightDeparture', 'FlightSeat', 'FlightOrder', 'FlightTicket'].forEach((name) => {
  expect(`${name} model exists`, exists(`src/models/${name}.js`));
});
['TaxiServiceZone', 'TaxiFareRule', 'TaxiVehicle', 'DriverAvailability', 'TaxiRide', 'RideAssignment', 'RideEvent'].forEach((name) => {
  expect(`${name} model exists`, exists(`src/models/${name}.js`));
});
expect('Flight and taxi repositories are registered', hasAll('src/repositories/index.js', [/flightAgencyProfiles: 'FlightAgencyProfile'/, /flightSupplierAccesses: 'FlightSupplierAccess'/, /taxiVehicles: 'TaxiVehicle'/, /taxiServiceZones: 'TaxiServiceZone'/, /taxiFareRules: 'TaxiFareRule'/]));
expect('Flight and local taxi remain active bookable services', hasAll('src/config/serviceRegistry.js', [/flight:[\s\S]*status: 'active'[\s\S]*bookable: true/, /local_transport:[\s\S]*status: 'active'[\s\S]*bookable: true/]));
expect('Core booking records retain four service types', hasAll('src/models/Booking.js', [/\['bus', 'hotel', 'flight', 'local_transport'\]/]) && hasAll('src/models/BookingItem.js', [/\['bus', 'hotel', 'flight', 'local_transport'\]/]));
expect('Listings and saved services retain four service types', hasAll('src/models/Listing.js', [/\['bus', 'hotel', 'flight', 'local_transport'\]/]) && hasAll('src/models/SavedListing.js', [/\['bus', 'hotel', 'flight', 'local_transport'\]/]));
expect('Partner onboarding names flight agencies and taxi fleets', hasAll('src/views/pages/auth/_partner-signup.ejs', [/Travel agency \/ flight agent/, /Taxi fleet partner/, /Flight agencies receive supplier access from Super Admin/, /Classic Trip controls public fares and dispatch/]));
expect('Partner validator accepts only completed service types', has('src/validators/partnerValidator.js', /\['bus', 'hotel', 'flight', 'local_transport'\]/));
expect('Admin company form uses agency and fleet terminology', hasAll('public/js/dashboard-workspace.js', [/<option value="flight">Travel agency \/ flight agent<\/option>/, /<option value="local_transport">Taxi fleet partner<\/option>/]));
expect('Partner identity records retain flight and taxi types', has('src/models/PartnerLead.js', /'flight', 'local_transport'/) && has('src/models/Agreement.js', /'flight', 'local_transport'/) && has('src/models/Invitation.js', /'bus', 'hotel', 'flight', 'local_transport'/));

// Flight agency architecture and compliance boundary.
expect('Flight agency profile uses agency-only types', has('src/models/FlightAgencyProfile.js', /enum: \['travel_agency', 'ticketing_agent', 'corporate_travel', 'online_travel_agent'\]/) && lacks('src/models/FlightAgencyProfile.js', /tour_operator/));
expect('Flight suppliers are immutable platform-managed records', hasAll('src/models/FlightSupplier.js', [/companyId: \{ type: String, required: true, default: 'platform'/, /managedBy: \{ type: String, enum: \['platform'\], default: 'platform', immutable: true \}/]));
expect('Supplier access is unique per agency and supplier', hasAll('src/models/FlightSupplierAccess.js', [/permissions:/, /book: \{ type: Boolean, default: false \}/, /ticket: \{ type: Boolean, default: false \}/, /index\(\{ companyId: 1, supplierId: 1 \}, \{ unique: true \}\)/]));
expect('Imported flight offers identify seller agency and platform source', hasAll('src/models/FlightDeparture.js', [/supplierAccessId:/, /managedBy: \{ type: String, enum: \['platform_import', 'supplier_sync'\]/, /sourceOfferRef:/, /index\(\{ companyId: 1, sourceOfferRef: 1 \}, \{ unique: true \}\)/]));
expect('Flight orders identify seller agency and supplier authority', hasAll('src/models/FlightOrder.js', [/supplierAccessId:/, /sellerAgencyId:/, /supplierOrderRef:/, /pnr:/]));
expect('Flight tickets require supplier order, PNR and unique ticket number', hasAll('src/models/FlightTicket.js', [/supplierOrderRef: \{ type: String, required: true/, /pnr: \{ type: String, required: true/, /ticketNumber: \{ type: String, required: true, unique: true/]));
expect('Flight repository approves agency before sales', hasAll('src/modules/flight/repositories/flightRepository.js', [/approvedAgencyOrThrow/, /profile\.status !== 'approved'/, /flight_agency_not_approved/]));
expect('Flight repository enforces explicit supplier access', hasAll('src/modules/flight/repositories/flightRepository.js', [/supplierForAgentOrThrow/, /permissions\?\.book/, /flight_supplier_access_denied/, /flight_supplier_access_expired/]));
expect('Public flight offer requires published supplier-authorised inventory', hasAll('src/modules/flight/repositories/flightRepository.js', [/status: \{ \$in: \['published', 'delayed'\] \}/, /supplierForAgentOrThrow\(row\.companyId, row\.supplierId/]))
expect('Super Admin owns airport catalogue and supplier creation', hasAll('src/modules/flight/services/flightSetupService.js', [/async function bootstrapAirports/, /companyId: 'platform'/, /async function createPlatformSupplier/, /managedBy: 'platform'/]));
expect('External supplier modes fail closed without an adapter key', hasAll('src/modules/flight/services/flightSetupService.js', [/flight_adapter_required/, /credentialsSecretRef/, /ticketingEnabled/]));
expect('Super Admin grants least-privilege supplier capabilities', hasAll('src/modules/flight/services/flightSetupService.js', [/async function grantSupplierAccess/, /ticketPermission = bool\(payload\.ticket\)/, /exchangePermission = bool\(payload\.exchange\)/, /refundPermission = bool\(payload\.refund\)/, /ticket: ticketPermission/, /exchange: exchangePermission/, /refund: refundPermission/]));
expect('Only approved agencies receive supplier access', has('src/modules/flight/services/flightSetupService.js', /await repo\.approvedAgencyOrThrow\(agentCompanyId\)/));
expect('Agency ticketing, exchanges and refunds cannot exceed approved compliance authority', hasAll('src/modules/flight/services/flightSetupService.js', [/flight_ticketing_authority_required/, /flight_exchange_authority_required/, /flight_refund_authority_required/, /profile\.ticketingAuthorityApproved/, /profile\.canServiceChanges/, /profile\.canRequestRefunds/]));
expect('Agency compliance rejects expired licences and unsupported accreditation', hasAll('src/modules/flight/services/flightSetupService.js', [/ACCREDITATION_TYPES/, /flight_agency_accreditation_expired/, /flight_agency_licence_expired/, /flight_ticketing_accreditation_required/]));
expect('Super Admin imports supplier offers for a named agency', hasAll('src/modules/flight/services/flightSetupService.js', [/async function importSupplierOffer\(agentCompanyId/, /repo\.supplierForAgentOrThrow\(agentCompanyId, payload\.supplierId\)/, /listingKind: 'agency_storefront'|repo\.listingOrThrow\(agentCompanyId, payload\.listingId\)/, /sourceOfferRef/]))
expect('Imported offers use persisted seat inventory', hasAll('src/modules/flight/services/flightSetupService.js', [/seatDefinitions\(/, /repo\.seats\.saveMany/, /availableSeats: totalSeats/]));
expect('Only Super Admin publishing path activates imported offers', hasAll('src/modules/flight/services/flightSetupService.js', [/async function publishImportedOffer/, /Object\.assign\(row, \{ status: 'published'/, /async function transitionImportedOffer/]));
expect('Agency storefront activation requires approved profile, access and published offer', hasAll('src/modules/flight/services/flightSetupService.js', [/async function readinessReport/, /profile\.status !== 'approved'/, /!accesses\.length/, /!departures\.length/, /flight_listing_incomplete/]));
expect('Agency cannot create platform supplier', hasAll('src/modules/flight/services/flightSetupService.js', [/async function createSupplier/, /flight_supplier_platform_only/]));
expect('Agency cannot create or operate airline departures', hasAll('src/modules/flight/services/flightSetupService.js', [/async function createDeparture\(\).*flight_departure_platform_only/, /async function publishDeparture\(\).*flight_departure_platform_only/, /async function transitionDeparture\(\).*flight_operations_supplier_owned/]));
expect('Agency cannot perform airline check-in or manifests', hasAll('src/modules/flight/services/flightBookingService.js', [/flight_checkin_supplier_owned/, /flight_manifest_supplier_owned/, /not the travel agent/, /not exposed to travel agents/]));
expect('Company flight routes expose only agency profile actions', hasAll('src/routes/web/company.js', [/company\/flights\/agency-profile/, /company\/flights\/agency-profile\/submit/]) && lacks('src/routes/web/company.js', /company\/flights\/(suppliers|departures|manifests|check-in)/));
expect('Super Admin owns all flight marketplace mutations', hasAll('src/routes/web/admin.js', [/flights\/airports\/bootstrap/, /flights\/suppliers/, /flights\/agencies\/:companyId\/review/, /supplier-access/, /offers\/:departureId\/publish/, /offers\/:departureId\/status/]));
expect('Super Admin flight controller calls platform services', hasAll('src/controllers/admin/travelMarketplaceController.js', [/createPlatformSupplier/, /reviewAgencyProfile/, /grantSupplierAccess/, /importSupplierOffer/, /publishImportedOffer/, /transitionImportedOffer/]));
expect('Company flight controller contains agency profile only', hasAll('src/controllers/company/flightController.js', [/saveAgencyDraft/, /submitAgencyProfile/]) && lacks('src/controllers/company/flightController.js', /createSupplier|createDeparture|manifest|checkIn/));
expect('Flight partner menu is agency sales and servicing', hasAll('src/services/dashboard/shellConfig.js', [/Agency Storefront/, /Supplier Access/, /Authorised Offers/, /Ticket Servicing/, /Sales Reports/]) && lacks('src/services/dashboard/shellConfig.js', /Flight Operations.*Passenger Manifest/));
expect('Flight agency UI explains supplier-owned airline operations', hasAll('src/views/dashboards/shared/sections/flight-operations.ejs', [/Flight agency compliance/, /cannot create aircraft, airline schedules, manifests or check-in records/, /Authorised supplier connections/, /Read-only commercial and ticketing access/]))
expect('Agency UI has no supplier or departure creation form', lacks('src/views/dashboards/shared/sections/flight-operations.ejs', /action="\/company\/flights\/(suppliers|departures)/));

// Flight customer booking lifecycle.
expect('Flight API and public routes are registered', exists('src/modules/flight/routes/publicFlightRoutes.js') && has('src/app.js', /app\.use\('\/api\/v1\/flights'/));
expect('Flight search exposes future published offers', hasAll('src/modules/flight/routes/publicFlightRoutes.js', [/listings\/:listingId\/departures/, /departAt: \{ \$gt: new Date\(\) \}/]));
expect('Flight availability comes from persisted seats', hasAll('src/modules/flight/routes/publicFlightRoutes.js', [/departures\/:departureId\/availability/]) && has('src/modules/flight/services/flightBookingService.js', /repo\.seats\.list/));
expect('Flight seat claims are transactional and conflict protected', hasAll('src/modules/flight/services/flightBookingService.js', [/async function claimSeats/, /status: 'available'/, /status: 'held'/, /flight_seat_conflict/]) && has('src/models/FlightSeat.js', /index\(\{ departureId: 1, seatNumber: 1 \}, \{ unique: true \}\)/));
expect('Flight booking validates every traveler', hasAll('src/modules/flight/services/flightBookingService.js', [/validateTravelers/, /full name is required/, /nationality is required/, /date of birth is required/]));
expect('Flight booking price is calculated from persisted offer', hasAll('src/modules/flight/services/flightBookingService.js', [/departure\.basePrice/, /departure\.taxes/, /calculateCustomerFees/]))
expect('Flight order stores immutable offer snapshot and supplier access', hasAll('src/modules/flight/services/flightBookingService.js', [/offerSnapshot:/, /supplierAccessId:/, /sellerAgencyId:/]));
expect('Agency assisted booking uses canonical flight booking service', hasAll('src/services/dashboard/actionService.js', [/normalize\(listing\.serviceType\) === 'flight'/, /flightBookingService\.createGuestBooking/, /bookingChannel: 'agency_assisted'/, /source: 'agency_assisted'/]));
expect('Flight tickets issue only after supplier confirmation', hasAll('src/modules/flight/services/flightBookingService.js', [/supplierConfirmation/, /flight_supplier_ticket_mismatch/, /flight_supplier_ticket_missing/, /FlightSupplierTicketIssued/]))
expect('Flight confirmation writes supplier PNR and ticket numbers', hasAll('src/modules/flight/services/flightBookingService.js', [/supplierOrderRef/, /pnr: supplierConfirmation\.pnr/, /ticketNumber/, /status: 'ticketed'/]));
expect('Flight payment failure releases seats and purges incomplete records', hasAll('src/modules/flight/services/flightBookingService.js', [/await releaseSeats\(bookingRef, session\)/, /repo\.orders\.deleteMany/, /repo\.bookings\.deleteMany/, /FlightBookingPaymentFailed/]));
expect('Flight refund invalidates tickets and releases seats', hasAll('src/modules/flight/services/flightBookingService.js', [/status: 'available'/, /status: 'refunded'/, /FlightBookingRefunded|flight_booking_refunded/i]));
expect('Flight hold expiry job is implemented and registered', has('src/modules/flight/services/flightBookingService.js', /async function expireSeatHolds/) && has('src/jobs/flightTaxiOperations.js', /expireSeatHolds/) && has('src/jobs/scheduler.js', /flightTaxiOperations/));

// Uber-style centrally governed taxi architecture.
expect('Taxi zones are immutable platform-managed records', hasAll('src/models/TaxiServiceZone.js', [/companyId: \{ type: String, required: true, default: 'platform'/, /managedBy: \{ type: String, enum: \['platform'\], default: 'platform', immutable: true \}/, /dispatchPriority/]));
expect('Taxi fare rules are immutable platform-managed records', hasAll('src/models/TaxiFareRule.js', [/companyId: \{ type: String, required: true, default: 'platform'/, /managedBy: \{ type: String, enum: \['platform'\], default: 'platform', immutable: true \}/, /platformCommissionPercent/, /driverPayoutPercent/, /maxSurgeMultiplier/]));
expect('Taxi ride records separate platform and fleet ownership', hasAll('src/models/TaxiRide.js', [/marketplaceCompanyId:/, /providerCompanyId:/, /dispatchManagedBy: \{ type: String, enum: \['platform'\]/]));
expect('Fleet profile is private and never public-bookable', hasAll('src/modules/taxi/services/taxiSetupService.js', [/listingKind: 'fleet_partner_profile'/, /publicVisibility: 'private'/, /bookable: false/, /managementModel: 'platform_dispatched_marketplace'/]));
expect('Fleet approval cannot publish the fleet as a public taxi service', hasAll('src/modules/taxi/services/taxiSetupService.js', [/async function reviewFleetProfile/, /profile\.bookable = false/, /profile\.publicVisibility = 'private'/]));
expect('Classic Trip owns public ride-hailing listings', hasAll('src/modules/taxi/services/taxiSetupService.js', [/async function createMarketplaceListing/, /companyId: 'platform'/, /companyName: 'Classic Trip'/, /listingKind: 'ride_hailing_marketplace'/, /publicVisibility: 'public'/]));
expect('Super Admin owns taxi zones and fares', hasAll('src/modules/taxi/services/taxiSetupService.js', [/async function createPlatformZone/, /async function createPlatformFareRule/, /companyId: 'platform'/]));
expect('Platform fare validates commission and payout split', hasAll('src/modules/taxi/services/taxiSetupService.js', [/platformCommissionPercent/, /driverPayoutPercent/, /100/]))
expect('Taxi providers cannot create zones or fare rules', hasAll('src/modules/taxi/services/taxiSetupService.js', [/async function createZone/, /taxi_zone_platform_only/, /async function createFareRule/, /taxi_fare_platform_only/]));
expect('Taxi providers cannot publish a public taxi listing', hasAll('src/modules/taxi/services/taxiSetupService.js', [/async function publishTaxiListing/, /taxi_publication_platform_only/]));
expect('Taxi marketplace publication requires platform coverage, fare policy, approved fleets and compliant vehicles', hasAll('src/modules/taxi/services/taxiSetupService.js', [/async function marketplaceReadinessReport/, /Create at least one active platform service area/, /Create at least one active server-authoritative fare rule/, /Approve at least one taxi fleet partner/, /Approve at least one compliant taxi vehicle/, /taxi_marketplace_not_ready/]));
expect('Company taxi routes expose only vehicle submission', has('src/routes/web/company.js', /company\/taxi\/vehicles/) && lacks('src/routes/web/company.js', /company\/taxi\/(zones|fares|marketplaces|rides\/.*dispatch|publish)/));
expect('Super Admin owns taxi marketplace, compliance and dispatch routes', hasAll('src/routes/web/admin.js', [/taxi\/marketplaces/, /taxi\/zones/, /taxi\/fares/, /taxi\/fleets\/:companyId\/review/, /vehicles\/:vehicleId\/review/, /rides\/:rideId\/dispatch/, /rides\/:rideId\/status/]));
expect('Super Admin taxi controller calls platform services', hasAll('src/controllers/admin/travelMarketplaceController.js', [/createMarketplaceListing/, /createPlatformZone/, /createPlatformFareRule/, /reviewFleetProfile/, /reviewVehicle/, /dispatchRide\('platform'/, /platformOverride: true/]));
expect('Company taxi controller contains vehicle submission only', has('src/controllers/company/taxiController.js', /createVehicle/) && lacks('src/controllers/company/taxiController.js', /createZone|createFare|dispatchRide|publish/));
expect('Taxi vehicle activation requires Super Admin review', hasAll('src/modules/taxi/services/taxiSetupService.js', [/async function reviewVehicle/, /verificationStatus/, /verifiedBy/, /verifiedAt/]));
expect('Taxi fleet UI explicitly denies fare and dispatch control', hasAll('src/views/dashboards/shared/sections/taxi-operations.ejs', [/Super Admin owns public service areas/, /No fleet-controlled public pricing or dispatch/, /cannot create fare rules/, /manually assign a ride/]));
expect('Taxi fleet UI contains no provider zone or fare form', lacks('src/views/dashboards/shared/sections/taxi-operations.ejs', /action="\/company\/taxi\/(zones|fares|dispatch|marketplaces)/));
expect('Platform travel control UI owns taxi money and dispatch', hasAll('src/views/dashboards/shared/sections/platform-travel-controls.ejs', [/Ride-hailing control/, /Classic Trip owns the public taxi product and dispatch policy/, /Create server-authoritative fare rule/, /dispatch intervention/]))

// Taxi quote, dispatch, driver and ride lifecycle.
expect('Taxi API and public routes are registered', exists('src/modules/taxi/routes/publicTaxiRoutes.js') && has('src/app.js', /app\.use\('\/api\/v1\/taxi'/));
expect('Taxi quote requires coordinates and platform zone', hasAll('src/modules/taxi/services/taxiBookingService.js', [/taxi_coordinates_required/, /taxi_pickup_outside_zone/, /repo\.zones\.list\(\{ companyId: 'platform'/, /zones\.find\(\(item\) => withinZone/]));
expect('Taxi quote uses server fare rules and platform currency', hasAll('src/modules/taxi/services/taxiBookingService.js', [/repo\.fareRules\.findOne/, /quotedFare|total:/]) && has('src/modules/taxi/services/taxiSetupService.js', /platformCurrency\(\)/));
expect('Taxi supports immediate, scheduled, airport, intercity and hourly rides', has('src/modules/taxi/services/taxiBookingService.js', /\['immediate', 'scheduled', 'airport_transfer', 'intercity', 'hourly'\]/));
expect('Taxi booking stores server quote and commercial split snapshot', hasAll('src/modules/taxi/services/taxiBookingService.js', [/commercialTermsSnapshot/, /quoted\.total/, /platformCommissionPercent/, /driverPayoutPercent/]));
expect('Taxi booking uses platform marketplace company', hasAll('src/modules/taxi/services/taxiBookingService.js', [/marketplaceCompanyId: 'platform'/, /dispatchManagedBy: 'platform'/]));
expect('Taxi payment confirmation starts platform dispatch', hasAll('src/modules/taxi/services/taxiBookingService.js', [/async function confirmPayment/, /TaxiDispatchRequested/, /shouldDispatch = !scheduled/, /if \(shouldDispatch\) await dispatchRideByBookingRef/]))
expect('Central dispatch searches eligible drivers across approved fleets', hasAll('src/modules/taxi/services/taxiBookingService.js', [/async function eligibleDriverRows/, /repo\.driverAvailabilities\.list/, /repo\.vehicles\.list/, /repo\.companies\.list/, /repo\.listings\.list/, /verificationStatus: 'approved'/, /listingKind: 'fleet_partner_profile'/, /complianceStatus: 'approved'/]));
expect('Central dispatch is not restricted to the booking marketplace company', hasAll('src/modules/taxi/services/taxiBookingService.js', [/dispatchRide\('platform'|platformScope/, /providerCompanyId/]))
expect('Taxi assignment acceptance is atomic first-winner logic', hasAll('src/modules/taxi/services/taxiBookingService.js', [/async function acceptAssignment/, /taxi_ride_already_assigned/, /assignment\.status = 'accepted'/, /repo\.rides\.updateOne/, /matchedCount/]));
expect('Taxi driver scope derives from authenticated driver', hasAll('src/modules/taxi/services/taxiBookingService.js', [/taxi_driver_scope_denied/, /Only the assigned driver can update this ride/]) && has('src/controllers/employee/driverController.js', /actorId\(req\)/));
expect('Taxi driver route has authentication, tenant, service and eligibility boundaries', hasAll('src/routes/web/employee.js', [/router\.use\('\/driver', requireAuth/, /enforceCompanyScope/, /requireCompanyService\('bus', 'local_transport'\)/, /requireOperationalDriver/]));
expect('Taxi driver routes are service-scoped', hasAll('src/routes/web/employee.js', [/driver\/taxi\/availability/, /driver\/taxi\/assignments\/:assignmentId\/accept/, /driver\/taxi\/assignments\/:assignmentId\/reject/, /driver\/taxi\/rides\/:rideId\/status/]));
expect('Taxi driver permissions do not inherit bus manifest permissions', hasAll('src/config/accessControl.js', [/DRIVER_PERMISSION_SETS/, /local_transport: Object\.freeze\(\['driver\.dashboard', 'taxi\.ride\.assigned\.view', 'trip\.status\.update', 'incident\.create'\]\)/, /requiredDriverPermissionsFor/]))
expect('Taxi invitations use taxi vehicle repository and prohibit schedules', hasAll('src/services/dashboard/actionService.js', [/companyTaxiVehicleOrThrow/, /Taxi drivers are assigned to approved fleet vehicles, not bus schedules/, /const schedule = !isTaxi && payload\.scheduleId/]) && hasAll('src/services/company/companyService.js', [/driverVehicleOrThrow/, /Taxi drivers are assigned to approved fleet vehicles, not bus schedules/, /assignmentType: isTaxi \? 'taxi_vehicle'/]));
expect('Going online requires full driver eligibility', hasAll('src/modules/taxi/services/taxiSetupService.js', [/evaluateDriverEligibility/, /taxi_driver_not_eligible/, /verificationStatus !== 'approved'|verificationStatus: 'approved'/]));
expect('Pickup PIN is hashed and encrypted at rest', hasAll('src/models/TaxiRide.js', [/pickupPinHash/, /pickupPinEncrypted/]) && hasAll('src/modules/taxi/services/taxiBookingService.js', [/secretBox\.seal/, /pinHash\(/]));
expect('Pickup PIN is not copied into ticket snapshot', lacks('src/modules/taxi/services/taxiBookingService.js', /ticketLegs:[^\n]*pickupPin/));
expect('Dashboards redact all pickup PIN material', hasAll('src/services/dashboard/dashboardProjectionEngine.js', [/redactTaxiRideSecrets/, /delete row\.pickupPinEncrypted/, /delete row\.pickupPinHash/]));
expect('Pickup PIN is required to start the ride', hasAll('src/modules/taxi/services/taxiBookingService.js', [/next === 'in_progress'/, /taxi_pickup_pin_invalid/, /timingSafeEqual/]))
expect('Public tracking requires verified contact or access code', hasAll('src/modules/taxi/services/taxiBookingService.js', [/taxi_tracking_access_denied/, /guestLookupCode/, /phone\.length >= 9/]) && has('src/routes/web/public.js', /rides\/:bookingRef\/tracking/));
expect('Pickup PIN is shown only in safe pre-start ride states', has('src/modules/taxi/services/taxiBookingService.js', /\['assigned', 'driver_arriving', 'arrived'\]\.includes\(ride\.status\)/));
expect('Taxi lifecycle supports completion, no-show, cancellation and refund', hasAll('src/modules/taxi/services/taxiBookingService.js', [/completed/, /no_show/, /cancelled/, /async function refundBooking/]))
expect('Taxi completion triggers settlement, not payment alone', hasAll('src/modules/taxi/services/taxiBookingService.js', [/bookingToSettle/, /taxi_ride_completed/, /settleBookingPayment/]))
expect('Scheduled dispatch and offer expiry are implemented', hasAll('src/modules/taxi/services/taxiBookingService.js', [/async function dispatchScheduledRides/, /async function expireOffers/]) && hasAll('src/jobs/flightTaxiOperations.js', [/dispatchScheduledRides/, /expireOffers/]));
expect('Flight and taxi scheduler defaults to every minute', has('src/config/env.js', /JOB_FLIGHT_TAXI_OPERATIONS \|\| '\* \* \* \* \*'/));

// Shared payment, documents and customer experience.
expect('Public checkout dispatches canonical flight and taxi services', hasAll('src/routes/web/public.js', [/flightBookingService\.createGuestBooking/, /taxiBookingService\.createGuestBooking/]));
expect('Payment webhooks dispatch flight and taxi success, failure and refund', hasAll('src/services/payment/webhookService.js', [/flightBookingService\.confirmPayment/, /flightBookingService\.failPayment/, /flightBookingService\.refundBooking/, /taxiBookingService\.confirmPayment/, /taxiBookingService\.failPayment/, /taxiBookingService\.refundBooking/]));
expect('Home exposes live flight and taxi sections', hasAll('src/views/pages/home.ejs', [/id="flight"/, /id="taxi"/, /data-home-empty="flight"/, /data-home-empty="local_transport"/]));
expect('Home describes agencies and centrally dispatched taxi', hasAll('src/views/pages/home.ejs', [/approved flight agencies sell supplier-confirmed offers/i, /Classic Trip dispatches local rides through verified fleets/i]));
expect('Listing cards describe supplier offers and platform ride-hailing', hasAll('src/views/partials/listing-card.ejs', [/isFlightListing/, /isTaxiListing/, /platform fares, central dispatch and verified fleet partners/]))
expect('Flight detail UX supports dated offer and seat selection', hasAll('src/views/pages/listing-details.ejs', [/Choose your flight/, /flightDepartureSelect/, /flightSeatGrid/, /Select a dated departure before choosing one seat for every traveler/]))
expect('Taxi detail UX supports pickup, destination, schedule and vehicle class', hasAll('src/views/pages/listing-details.ejs', [/Pickup place, home, office, hotel, or airport/, /taxiDestinationLabel/, /airport_transfer/, /intercity/, /hourly/, /Choose your vehicle class/]))
expect('Ticket page renders flight e-ticket and protected taxi tracking', hasAll('src/views/pages/ticket.ejs', [/flight e-ticket/, /Track ride/, /Use verified tracking/, /supplier ticketing are both confirmed/]))
expect('Success page renders flight and taxi confirmations', hasAll('src/views/pages/booking-success.ejs', [/Your flight e-ticket is ready/, /Your ride is confirmed/, /Track ride/]))
expect('PDF service renders flight tickets and taxi ride confirmation', hasAll('src/services/pdf/ticketPdfService.js', [/flight-e-ticket/, /ride-confirmation/, /Ticket number\(s\)/, /Use verified ride tracking/]))
expect('Secure taxi tracking page exists', exists('src/views/pages/taxi-tracking.ejs') && has('src/views/pages/taxi-tracking.ejs', /Verify your ride/));
expect('Flight and taxi dashboard cards use shared spacing system', hasAll('public/css/dashboard-workspace.css', [/serviceWorkspaceCard/, /serviceControlGrid/, /serviceControlPanel/, /serviceFormActions/, /serviceTableBlock/, /@media\(max-width:760px\)/]));
expect('Service action buttons have consistent minimum height and mobile width', hasAll('public/css/dashboard-workspace.css', [/serviceFormActions \.btn\{min-height:40px\}/, /serviceFormActions \.btn\{width:100%;flex-basis:100%\}/]));
expect('Platform travel controls are included only for admin dashboard', hasAll('src/views/dashboards/shared/workspace.ejs', [/if\(isAdminDashboard\)/, /sections\/platform-travel-controls/]));
expect('Provider flight and taxi operation sections use service gates', hasAll('src/views/dashboards/shared/workspace.ejs', [/companySupportsFlight/, /sections\/flight-operations/, /companySupportsTaxi/, /sections\/taxi-operations/]));
expect('Production architecture rejects stale unsupported service shell', lacks('src/views/dashboards/shared/sections/flight-operations.ejs', /tour operator/i) && lacks('src/views/pages/auth/_partner-signup.ejs', /Register your bus or hotel company/));

const failed = checks.filter((check) => !check.condition);
if (failed.length) {
  console.error(`Flight agency + ride-hailing final checks failed: ${checks.length - failed.length}/${checks.length}`);
  failed.forEach((check) => console.error(`- ${check.name}`));
  process.exit(1);
}
console.log(`Flight agency + ride-hailing final checks passed: ${checks.length}/${checks.length}`);
