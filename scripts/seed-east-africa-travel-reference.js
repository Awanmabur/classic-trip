'use strict';

require('dotenv').config();
const { connectDb, mongoose } = require('../src/config/db');
const Airport = require('../src/models/Airport');
const AircraftType = require('../src/models/AircraftType');
const VehicleClass = require('../src/models/VehicleClass');
const TaxiServiceZone = require('../src/models/TaxiServiceZone');
const TaxiFareRule = require('../src/models/TaxiFareRule');
const Listing = require('../src/models/Listing');

const apply = process.argv.includes('--apply');
const PLATFORM = 'platform';

const airportRows = [
  ['EBB','HUEN','Entebbe International Airport','Entebbe','Uganda','UG','Africa/Kampala',0.0424,32.4435],
  ['JUB','HSSJ','Juba International Airport','Juba','South Sudan','SS','Africa/Juba',4.8720,31.6011],
  ['NBO','HKJK','Jomo Kenyatta International Airport','Nairobi','Kenya','KE','Africa/Nairobi',-1.3192,36.9278],
  ['WIL','HKNW','Wilson Airport','Nairobi','Kenya','KE','Africa/Nairobi',-1.3217,36.8148],
  ['KGL','HRYR','Kigali International Airport','Kigali','Rwanda','RW','Africa/Kigali',-1.9686,30.1395],
  ['DAR','HTDA','Julius Nyerere International Airport','Dar es Salaam','Tanzania','TZ','Africa/Dar_es_Salaam',-6.8781,39.2026],
  ['JRO','HTKJ','Kilimanjaro International Airport','Kilimanjaro','Tanzania','TZ','Africa/Dar_es_Salaam',-3.4294,37.0745],
  ['ZNZ','HTZA','Abeid Amani Karume International Airport','Zanzibar','Tanzania','TZ','Africa/Dar_es_Salaam',-6.2220,39.2249],
  ['MBA','HKMO','Moi International Airport','Mombasa','Kenya','KE','Africa/Nairobi',-4.0348,39.5942],
  ['BJM','HBBA','Melchior Ndadaye International Airport','Bujumbura','Burundi','BI','Africa/Bujumbura',-3.3240,29.3185],
  ['MGQ','HCMM','Aden Adde International Airport','Mogadishu','Somalia','SO','Africa/Mogadishu',2.0144,45.3047],
  ['GOM','FZNA','Goma International Airport','Goma','DR Congo','CD','Africa/Lubumbashi',-1.6708,29.2385],
  ['FIH','FZAA','N\'djili International Airport','Kinshasa','DR Congo','CD','Africa/Kinshasa',-4.3858,15.4446],
  ['ELD','HKEL','Eldoret International Airport','Eldoret','Kenya','KE','Africa/Nairobi',0.4045,35.2389],
  ['KIS','HKKI','Kisumu International Airport','Kisumu','Kenya','KE','Africa/Nairobi',-0.0861,34.7289],
  ['WUU','HSWW','Wau Airport','Wau','South Sudan','SS','Africa/Juba',7.7258,27.9750],
].map(([iataCode,icaoCode,name,city,country,countryCode,timezone,latitude,longitude]) => ({
  id:`airport-${iataCode.toLowerCase()}`,iataCode,icaoCode,name,city,country,countryCode,timezone,latitude,longitude,status:'active'
}));

const aircraftRows = [
  ['Boeing','737-800','738','B738',189],
  ['Airbus','A320-200','320','A320',180],
  ['Bombardier','CRJ900','CR9','CRJ9',90],
  ['De Havilland Canada','Dash 8-400','DH4','DH8D',78],
  ['Cessna','208B Grand Caravan','CNA','C208',14],
].map(([manufacturer,model,iataCode,icaoCode,defaultSeatCapacity]) => ({
  id:`aircraft-type-${icaoCode.toLowerCase()}`,manufacturer,model,iataCode,icaoCode,defaultSeatCapacity,status:'active'
}));

const classRows = [
  { id:'vehicle-class-boda-standard', key:'boda_standard', name:'Boda', description:'Affordable motorcycle ride for one passenger.', passengerCapacity:1, luggageCapacity:1, serviceTypes:['instant','scheduled','airport','intercity'], icon:'fa-motorcycle', sortOrder:10 },
  { id:'vehicle-class-boda-plus', key:'boda_plus', name:'Boda Plus', description:'Verified premium motorcycle and rider with additional service standards.', passengerCapacity:1, luggageCapacity:1, serviceTypes:['instant','scheduled','airport','intercity'], icon:'fa-motorcycle', sortOrder:20 },
  { id:'vehicle-class-car-standard', key:'car_standard', name:'Car', description:'Everyday private car for up to four passengers.', passengerCapacity:4, luggageCapacity:2, serviceTypes:['instant','scheduled','airport','intercity','corporate'], icon:'fa-car-side', sortOrder:30 },
  { id:'vehicle-class-car-comfort', key:'car_comfort', name:'Comfort', description:'Newer private car with more comfort and luggage room.', passengerCapacity:4, luggageCapacity:3, serviceTypes:['instant','scheduled','airport','intercity','hourly','corporate'], icon:'fa-car', sortOrder:40 },
  { id:'vehicle-class-car-xl', key:'car_xl', name:'XL', description:'Larger vehicle for families, airport bags and office teams.', passengerCapacity:6, luggageCapacity:5, serviceTypes:['scheduled','airport','intercity','hourly','corporate'], icon:'fa-van-shuttle', sortOrder:50 },
].map((row) => ({ ...row, companyId:PLATFORM, status:'active' }));

const zoneRows = [
  { id:'taxi-zone-kampala', name:'Kampala city', country:'Uganda', countryCode:'UG', city:'Kampala', zoneType:'city', center:{ latitude:0.347596, longitude:32.582520 }, radiusKm:40, supportedServiceTypes:['instant','scheduled','airport','corporate'], status:'active' },
  { id:'taxi-zone-entebbe-airport', name:'Entebbe airport', country:'Uganda', countryCode:'UG', city:'Entebbe', zoneType:'airport', center:{ latitude:0.042386, longitude:32.443503 }, radiusKm:20, airportId:'airport-ebb', supportedServiceTypes:['airport','scheduled'], status:'active' },
  { id:'taxi-zone-uganda-national', name:'Uganda national', country:'Uganda', countryCode:'UG', zoneType:'national', center:{ latitude:1.373333, longitude:32.290275 }, radiusKm:900, supportedServiceTypes:['intercity','scheduled','corporate'], status:'active' },
  { id:'taxi-zone-juba', name:'Juba city', country:'South Sudan', countryCode:'SS', city:'Juba', zoneType:'city', center:{ latitude:4.859363, longitude:31.571251 }, radiusKm:45, supportedServiceTypes:['instant','scheduled','airport','corporate'], status:'active' },
  { id:'taxi-zone-juba-airport', name:'Juba airport', country:'South Sudan', countryCode:'SS', city:'Juba', zoneType:'airport', center:{ latitude:4.872006, longitude:31.601117 }, radiusKm:20, airportId:'airport-jub', supportedServiceTypes:['airport','scheduled'], status:'active' },
  { id:'taxi-zone-south-sudan-national', name:'South Sudan national', country:'South Sudan', countryCode:'SS', zoneType:'national', center:{ latitude:6.876992, longitude:31.306979 }, radiusKm:1800, supportedServiceTypes:['intercity','scheduled','corporate'], status:'active' },
].map((row) => ({ ...row, companyId:PLATFORM }));

// These are editable launch defaults, not market guarantees. Super Admin must review them before production launch.
const fareRows = [
  ['ug-boda-instant','vehicle-class-boda-standard','taxi-zone-kampala','instant','UGX',1500,650,70,2500,0,0,0],
  ['ug-boda-scheduled','vehicle-class-boda-standard','taxi-zone-kampala','scheduled','UGX',1500,650,70,3000,0,0,500],
  ['ug-boda-plus','vehicle-class-boda-plus','taxi-zone-kampala','instant','UGX',2200,850,90,3500,0,0,0],
  ['ug-car-instant','vehicle-class-car-standard','taxi-zone-kampala','instant','UGX',4000,1500,250,7000,0,0,0],
  ['ug-car-scheduled','vehicle-class-car-standard','taxi-zone-kampala','scheduled','UGX',4000,1500,250,8000,0,0,1000],
  ['ug-comfort','vehicle-class-car-comfort','taxi-zone-kampala','instant','UGX',6500,2000,300,10000,0,0,0],
  ['ug-airport-car','vehicle-class-car-standard','taxi-zone-entebbe-airport','airport','UGX',5000,1600,250,30000,0,5000,1000],
  ['ug-airport-comfort','vehicle-class-car-comfort','taxi-zone-entebbe-airport','airport','UGX',7500,2200,300,45000,0,7000,1000],
  ['ug-intercity-car','vehicle-class-car-standard','taxi-zone-uganda-national','intercity','UGX',5000,1700,200,25000,0,0,1000],
  ['ug-intercity-xl','vehicle-class-car-xl','taxi-zone-uganda-national','intercity','UGX',10000,2800,350,50000,0,0,2000],
  ['ss-boda-instant','vehicle-class-boda-standard','taxi-zone-juba','instant','USD',1.50,0.75,0.08,2.50,0,0,0],
  ['ss-car-instant','vehicle-class-car-standard','taxi-zone-juba','instant','USD',4.00,1.60,0.25,7.00,0,0,0],
  ['ss-car-scheduled','vehicle-class-car-standard','taxi-zone-juba','scheduled','USD',4.00,1.60,0.25,8.00,0,0,1.00],
  ['ss-airport-car','vehicle-class-car-standard','taxi-zone-juba-airport','airport','USD',5.00,1.80,0.25,12.00,0,3.00,1.00],
  ['ss-intercity-car','vehicle-class-car-standard','taxi-zone-south-sudan-national','intercity','USD',6.00,1.80,0.20,25.00,0,0,2.00],
  ['ss-intercity-xl','vehicle-class-car-xl','taxi-zone-south-sudan-national','intercity','USD',10.00,2.80,0.30,45.00,0,0,3.00],
].map(([id,vehicleClassId,serviceZoneId,serviceType,currency,baseFare,perKilometer,perMinute,minimumFare,bookingFee,airportFee,scheduledFee]) => ({
  id:`taxi-fare-${id}`, companyId:PLATFORM, vehicleClassId, serviceZoneId, serviceType, currency,
  baseFare, perKilometer, perMinute, minimumFare, bookingFee, airportFee, scheduledFee,
  intercityMinimumKm:30, waitingPerMinute:currency==='UGX'?250:0.20, cancellationFee:currency==='UGX'?2000:2,
  noShowFee:currency==='UGX'?3000:3, nightMultiplier:1, surgeMin:1, surgeMax:1, taxPercent:0, status:'active'
}));

const platformListings = [
  {
    id:'listing-platform-local-rides', companyId:PLATFORM, companySlug:'classic-trip', companyName:'Classic Trip', serviceType:'local_transport', group:'local_transport', type:'local_transport', listingKind:'platform_ride_marketplace',
    title:'Boda and car rides', slug:'local-rides', shortDescription:'Verified boda and car rides with upfront pricing, pickup PIN and platform dispatch.', country:'East Africa', city:'', priceFrom:2500, currency:'UGX',
    amenities:['Verified drivers','Upfront fare','Pickup PIN','Ride status'], bookable:true, releaseStatus:'published', status:'active', publication:{ public:true, state:'published', lastStatusChangeAt:new Date() }
  },
  {
    id:'listing-platform-flights', companyId:PLATFORM, companySlug:'classic-trip', companyName:'Classic Trip', serviceType:'flight', group:'flight', type:'flight', listingKind:'flight_supplier_marketplace',
    title:'Flights', slug:'flights', shortDescription:'Search approved airline offers and book with verified travel-agent support.', country:'East Africa', city:'', priceFrom:0, currency:'USD',
    amenities:['Approved suppliers','Agent support','Fare rules','E-ticket'], bookable:true, releaseStatus:'published', status:'active', publication:{ public:true, state:'published', lastStatusChangeAt:new Date() }
  },
];

async function upsertRows(Model, rows, filterFor) {
  for (const row of rows) await Model.updateOne(filterFor(row), { $set:row }, { upsert:true, runValidators:true });
}

async function main() {
  await connectDb();
  const summary = {
    mode:apply?'apply':'dry-run', database:mongoose.connection.name,
    airports:airportRows.length, aircraftTypes:aircraftRows.length, platformRideClasses:classRows.length,
    platformRideZones:zoneRows.length, platformFareRules:fareRows.length, platformListings:platformListings.length,
    note:'Launch fare defaults are editable and must be reviewed by Super Admin before production.'
  };
  console.log(JSON.stringify(summary,null,2));
  if (!apply) return;
  await upsertRows(Airport, airportRows, (row)=>({ iataCode:row.iataCode }));
  await upsertRows(AircraftType, aircraftRows, (row)=>({ icaoCode:row.icaoCode }));
  await upsertRows(VehicleClass, classRows, (row)=>({ companyId:PLATFORM, key:row.key }));
  await upsertRows(TaxiServiceZone, zoneRows, (row)=>({ companyId:PLATFORM, id:row.id }));
  await upsertRows(TaxiFareRule, fareRows, (row)=>({ companyId:PLATFORM, vehicleClassId:row.vehicleClassId, serviceZoneId:row.serviceZoneId, serviceType:row.serviceType }));
  await upsertRows(Listing, platformListings, (row)=>({ companyId:PLATFORM, serviceType:row.serviceType }));
  console.log('Platform flight references and SafeBoda-style mobility defaults seeded.');
}

main().catch((error)=>{console.error(error);process.exitCode=1;}).finally(async()=>{await mongoose.disconnect().catch(()=>{});});
