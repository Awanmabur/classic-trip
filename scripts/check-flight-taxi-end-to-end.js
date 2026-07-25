'use strict';
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
const exists=(file)=>fs.existsSync(path.join(root,file));
const checks=[];
const add=(name,ok)=>checks.push({name,ok:Boolean(ok)});
const has=(file,...tokens)=>{const source=read(file);return tokens.every((token)=>source.includes(token));};
const lacks=(file,...tokens)=>{const source=read(file);return tokens.every((token)=>!source.includes(token));};

[
'Airport','Airline','FlightSupplier','AircraftType','Aircraft','FlightSeatMapVersion','FlightRoute','FlightFareFamily','FlightDeparture','FlightSeatInventory','FlightOffer','FlightOrder','FlightTraveler','FlightSeatAssignment','FlightTicket','FlightAncillary','FlightScheduleChange','FlightAgentQuote','FlightChangeRequest','FlightRefundRequest',
'VehicleClass','TaxiVehicle','TaxiDriverProfile','TaxiServiceZone','TaxiFareRule','DriverAvailability','DriverLocation','RideQuote','RideRequest','TaxiRide','RideAssignment','RideEvent','TaxiIncident','DriverEarning'
].forEach((name)=>add(`model:${name}`,exists(`src/models/${name}.js`)));

add('four live service registry',has('src/config/serviceRegistry.js',"flight",'local_transport',"status: 'active'",'bookable: true'));
add('partner profile taxonomy',has('src/config/partnerProfiles.js','flight_agent','boda_rider','car_driver','fleet_owner','taxi_company'));
add('flight agent cannot manage airline supply',has('src/config/partnerProfiles.js','manageAirlines: false','manageAircraft: false','manageSeatMaps: false','manageSupplierInventory: false'));
add('ride partners cannot manage platform pricing or dispatch',has('src/config/partnerProfiles.js','manageFareRules: false','manageServiceZones: false','manualDispatch: false'));
add('company stores onboarding/capability policy',has('src/models/Company.js','partnerCategory','accountModel','onboardingProfile','capabilityPolicy','onboardingProgress'));
add('conditional onboarding validation',has('src/validators/partnerValidator.js','requiredForProfile','agencyLicenceNumber','driverLicenceExpiry','vehicleColor','insuranceExpiry'));
add('dynamic signup profiles',has('src/views/pages/auth/_partner-signup.ejs','data-profile-section="agency"','data-profile-section="driver"','data-profile-section="fleet"','Vehicle colour','Classic Trip controls ride classes'));
add('dynamic signup required switching',has('src/views/pages/auth/_partner-signup.ejs','setRequired(model)','vehicleColor','flight_agent','boda_rider'));
add('sensitive driver onboarding encryption',has('src/services/auth/authService.js','nationalIdEncrypted','licenceNumberEncrypted','vehicleColor'));
add('onboarding materializes verified partner records',has('src/services/onboarding/partnerMaterializationService.js','materializeIndividualDriver','submitted_for_platform_review','safety_review'));
add('admin approval triggers materialization',has('src/controllers/admin/companyController.js','partnerMaterializationService'));

add('flight public routes',has('src/app.js',"/api/v1/flights",'publicFlightRoutes'));
add('taxi public routes',has('src/app.js',"/api/v1/taxi",'publicTaxiRoutes'));
add('taxi driver routes',has('src/app.js',"/api/v1/taxi/driver",'driverTaxiRoutes'));
add('flight agent routes',has('src/app.js','partnerFlightRoutes'));
add('mobility partner routes',has('src/app.js','partnerTaxiRoutes'));
add('super admin flight routes',has('src/app.js','adminFlightRoutes'));
add('super admin mobility routes',has('src/app.js','adminTaxiRoutes'));
add('flight traveler page',exists('src/views/pages/flights.ejs')&&exists('public/js/flights.js'));
add('flight order page',exists('src/views/pages/flight-order.ejs')&&exists('public/js/flight-order.js'));
add('simple ride request page',exists('src/views/pages/taxi.ejs')&&exists('public/js/taxi.js'));
add('ride tracking page',exists('src/views/pages/taxi-track.ejs')&&exists('public/js/taxi-track.js'));
add('ride home/work/airport shortcuts',has('src/views/pages/taxi.ejs','Home','Work','Airport')||has('public/js/taxi.js','Home','Work','airport'));
add('taxi upfront fare and no negotiation',has('src/modules/taxi/services/taxiQuoteService.js','priceSnapshot','surgeMultiplier')&&has('scripts/seed-east-africa-travel-reference.js','surgeMin:1, surgeMax:1'));
add('taxi pickup pin',has('src/modules/taxi/services/taxiRideService.js','pickupPinHash','pickupPinEncrypted'));
add('taxi live events/tracking',has('src/modules/taxi/services/taxiDriverService.js','repo.locations.save',"nextId('driver-location')")&&has('src/modules/taxi/services/taxiRideService.js',"nextId('ride-event')",'repo.events.save'));
add('taxi safety incidents',has('src/modules/taxi/services/taxiDriverService.js','incident','safety'));
add('server quote calculation',has('src/modules/taxi/services/taxiQuoteService.js','distanceFare','timeFare','minimumFare'));
add('platform-owned mobility quote',has('src/modules/taxi/services/taxiQuoteService.js','PLATFORM_MOBILITY_OWNER','platformManaged: true'));
add('platform-owned ride transaction',has('src/modules/taxi/services/taxiRideService.js','companyId: PLATFORM_MOBILITY_OWNER','providerCompanyId'));
add('atomic automatic dispatch',has('src/modules/taxi/services/taxiDispatchService.js','rides.updateOne','ride_already_assigned','providerCompanyId'));
add('partner data scoped to assigned providers',has('src/modules/taxi/services/taxiDispatchService.js','providerCompanyId')&&has('src/services/dashboard/dashboardProjectionEngine.js','providerCompanyId'));
add('super admin driver decision lifecycle',has('src/modules/taxi/services/taxiSetupService.js',"['verified', 'rejected', 'suspended', 'expired']",'reviewNotes','suspended'));
add('super admin controls partner driver payout policy',has('src/modules/taxi/services/taxiSetupService.js','updatePartnerPayoutPolicy','driverPayoutPercent','controlledBy')&&has('src/modules/taxi/routes/adminTaxiRoutes.js','payout-policy'));
add('taxi driver cannot submit a fare or earning amount',has('src/modules/taxi/services/taxiDriverService.js','fareLocked: true','adjustmentAuthority')&&lacks('src/modules/taxi/services/taxiDriverService.js','payload.driverShare'));
add('driver earning stores admin payout percentage',has('src/models/DriverEarning.js','driverPayoutPercent')&&has('src/modules/taxi/services/taxiDriverService.js','provider.settings?.driverPayoutPercent'));
add('flight supplier wallet schema and release',has('src/models/Wallet.js','flight_supplier')&&has('src/models/WalletTransaction.js','flight_supplier_payable_pending','flight_supplier_payable_released')&&has('src/services/commission/releaseService.js','flight_supplier_payable_released'));
add('verified vehicle mandatory for driver approval',has('src/modules/taxi/services/taxiSetupService.js','Select a verified vehicle before approving this driver','Assigned vehicle must be verified first'));
add('super admin mobility controls UI',has('src/views/dashboards/shared/sections/admin-travel-supply-controls.ejs','Public ride service','Ride class','Coverage zone','Upfront fare','Rider & driver verification'));
add('partner taxi dashboard excludes pricing/dispatch configuration',has('src/config/partnerProfiles.js','manageFareRules: false','manageServiceZones: false','manualDispatch: false')&&lacks('src/views/dashboards/shared/sections/flight-taxi.ejs','Create fare rule','Create service zone','Manual dispatch'));
add('simple mobility employee roles',has('src/config/accessControl.js','mobility_fleet_manager','mobility_driver_coordinator','mobility_customer_support'));
add('no taxi dispatcher employee role',lacks('src/config/accessControl.js','taxi_dispatcher')&&lacks('public/js/dashboard-workspace.js','Taxi Dispatcher'));

add('flight round trip',has('src/modules/flight/services/flightSearchService.js','roundTrips','returnDeparture','segments'));
add('flight repricing',has('src/modules/flight/services/flightSearchService.js','reprice','offerToken'));
add('flight seat inventory compare-and-set',has('src/modules/flight/services/flightBookingService.js','seatInventory.updateOne','version: Number'));
add('flight idempotency',has('src/models/FlightOrder.js','idempotencyKey','unique: true'));
add('flight encrypted documents',has('src/modules/flight/services/flightBookingService.js','documentNumberEncrypted','documentNumberLast4'));
add('external supplier fail closed',has('src/modules/flight/services/flightSupplierRegistry.js','supplier_adapter_unavailable','Certified flight supplier adapter is unavailable'));
add('platform owns flight supply',has('src/modules/flight/services/flightSetupService.js','PLATFORM_FLIGHT_OWNER','requireSuperAdmin'));
add('flight agent quote model',has('src/models/FlightAgentQuote.js','agentCompanyId','publicTokenEncrypted','customerName','customerPhone','customerEmail'));
add('agent quote private share link',has('src/modules/flight/services/flightAgentService.js','publicTokenEncrypted','sharePath'));
add('agent orders scoped to agency',has('src/models/FlightOrder.js','agentCompanyId','agentUserId','agentQuoteId'));
add('agent ticket attribution',has('src/models/FlightTicket.js','agentCompanyId'));
add('agent traveler attribution',has('src/models/FlightTraveler.js','agentCompanyId'));
add('agent change/refund workflows',exists('src/models/FlightChangeRequest.js')&&exists('src/models/FlightRefundRequest.js')&&has('src/modules/flight/services/flightAgentService.js','createChangeRequest','createRefundRequest'));
add('flight agents cannot create airline operations in dashboard',lacks('src/services/dashboard/shellConfig.js','Passenger Check-in','Assigned Departures','Seat Inventory','Boarding & Departure'));
add('flight agency employee roles',has('src/config/accessControl.js','flight_sales_agent','flight_ticketing_agent','flight_customer_support','agency_finance'));
add('no airline operations employee roles',lacks('src/config/accessControl.js','airline_operations_manager','flight_dispatcher','flight_inventory_manager')&&lacks('public/js/dashboard-workspace.js','Airline Operations Manager','Flight Dispatcher'));
add('flight agent dashboard UX',has('src/views/dashboards/shared/sections/flight-taxi.ejs','Search live supplier flights','Customer quotes','Request a flight change','Request a refund'));
add('super admin flight supply controls UI',has('src/views/dashboards/shared/sections/admin-travel-supply-controls.ejs','Public flight marketplace','Airline reference','Certified supplier adapter','Aircraft and seat-map reference','Dated departure'));
add('private flight lookup',has('src/modules/flight/services/flightBookingService.js','guestLookupCode','customerUserId'));
add('private taxi lookup',has('src/modules/taxi/services/taxiRideService.js','guestLookupCode','customerUserId'));
add('flight tenant tickets',has('src/models/FlightTicket.js','companyId','bookingRef'));
add('flight payment failure releases inventory',has('src/modules/flight/services/flightBookingService.js','failPayment','seatInventory.updateMany',"status:'available'","booking.bookingStatus='failed'"));
add('flight settlement separates agent attribution',has('src/models/Booking.js','agentCompanyId','providerCompanyId','supplierId')&&has('src/models/BookingItem.js','agentCompanyId','providerCompanyId')&&has('src/services/commission/commissionService.js','settlementCompanyId',"serviceType === 'flight'","serviceType === 'local_transport'")&&has('src/services/finance/settlementService.js','commissionService.settlementCompanyId','supplierPayable'));

add('scheduled dispatch job',exists('src/jobs/dispatchTaxiRides.js')&&has('src/config/env.js','JOB_DISPATCH_TAXI_RIDES'));
add('flight hold expiry job',exists('src/jobs/expireFlightHolds.js')&&has('src/config/env.js','JOB_EXPIRE_FLIGHT_HOLDS'));
add('job env examples',has('.env.example','JOB_DISPATCH_TAXI_RIDES','JOB_EXPIRE_FLIGHT_HOLDS'));
add('payment providers on flight',has('src/views/pages/flights.ejs','mtn_momo','airtel_money','flutterwave','paystack','dpo'));
add('payment providers on taxi',has('public/js/taxi.js','mtn_momo','airtel_money','flutterwave','paystack','dpo'));
add('rounded dashboard controls',has('public/css/dashboard-workspace.css','.adminSupplyControl','.inlineReviewForm','.btn,.tinyBtn,.iconBtn','border-radius:18px'));
add('rounded public ride controls',has('public/css/pages/travel-booking.css','border-radius'));
add('home four-service navigation',has('src/views/pages/home.ejs','/flights','/taxi'));
add('footer four-service navigation',has('src/views/partials/site-footer.ejs','Flights','Local taxi'));
add('platform reference seed',has('scripts/seed-east-africa-travel-reference.js','PLATFORM','Boda Plus','Kampala city','Juba city','platformListings'));
add('governance migration',has('scripts/migrate-flight-taxi-domain.js','archiveLegacyListings','moveFlightSupply','migrateFlightOrders','migrateTaxiRides','updateCompanyProfiles'));

const failed=checks.filter((row)=>!row.ok);
if(failed.length){console.error(`Safe mobility / flight-agent validation failed (${failed.length}/${checks.length}):`);failed.forEach((row)=>console.error(`- ${row.name}`));process.exit(1);}
console.log(`Safe mobility / flight-agent end-to-end static validation passed (${checks.length}/${checks.length}).`);
