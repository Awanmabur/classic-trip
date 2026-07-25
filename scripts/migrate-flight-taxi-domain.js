'use strict';

require('dotenv').config();
const { connectDb, mongoose } = require('../src/config/db');
const Company = require('../src/models/Company');
const Listing = require('../src/models/Listing');
const Booking = require('../src/models/Booking');
const BookingItem = require('../src/models/BookingItem');
const FlightOrder = require('../src/models/FlightOrder');
const FlightTicket = require('../src/models/FlightTicket');
const FlightTraveler = require('../src/models/FlightTraveler');
const FlightSeatAssignment = require('../src/models/FlightSeatAssignment');
const TaxiRide = require('../src/models/TaxiRide');
const RideRequest = require('../src/models/RideRequest');
const RideQuote = require('../src/models/RideQuote');
const RideAssignment = require('../src/models/RideAssignment');
const RideEvent = require('../src/models/RideEvent');
const { capabilityPolicyFor } = require('../src/config/partnerProfiles');

const supplyModels = [
  require('../src/models/Airline'), require('../src/models/FlightSupplier'), require('../src/models/Aircraft'),
  require('../src/models/FlightSeatMapVersion'), require('../src/models/FlightRoute'), require('../src/models/FlightFareFamily'),
  require('../src/models/FlightDeparture'), require('../src/models/FlightSeatInventory'), require('../src/models/FlightOffer'),
  require('../src/models/FlightAncillary'), require('../src/models/FlightScheduleChange'),
];
const indexModels = [
  ...supplyModels, FlightOrder, FlightTicket, FlightTraveler, FlightSeatAssignment, Booking, BookingItem,
  require('../src/models/Wallet'), require('../src/models/WalletTransaction'), require('../src/models/Commission'),
  require('../src/models/FinanceStatement'), require('../src/models/PayoutRequest'), require('../src/models/SettlementBatch'),
  require('../src/models/Airport'), require('../src/models/AircraftType'),
  require('../src/models/VehicleClass'), require('../src/models/TaxiVehicle'), require('../src/models/TaxiDriverProfile'),
  require('../src/models/TaxiServiceZone'), require('../src/models/TaxiFareRule'), require('../src/models/DriverAvailability'),
  require('../src/models/DriverLocation'), RideQuote, RideRequest, TaxiRide, RideAssignment, RideEvent,
  require('../src/models/TaxiIncident'), require('../src/models/DriverEarning'),
].filter((value)=>value && typeof value.createIndexes==='function');

const PLATFORM = 'platform';
const apply = process.argv.includes('--apply');
const now = new Date();

function inferredMobilityCategory(company) {
  const current = String(company.partnerCategory || '').trim();
  if (current) return current;
  const model = String(company.accountModel || company.settings?.accountModel || '').toLowerCase();
  if (model === 'individual_driver') return 'car_driver';
  if (model === 'fleet') return 'fleet_owner';
  return 'taxi_company';
}

async function archiveLegacyListings() {
  return Listing.collection.updateMany(
    { serviceType:{ $in:['flight','local_transport'] }, companyId:{ $ne:PLATFORM } },
    { $set:{ status:'archived', releaseStatus:'archived', bookable:false, 'publication.public':false, 'publication.state':'archived', 'migration.platformGovernanceAt':now }, $unset:{ publishedAt:'' } }
  );
}

async function moveFlightSupply() {
  const results=[];
  for (const Model of supplyModels) {
    const rows=await Model.collection.find({ companyId:{ $ne:PLATFORM } }).project({ _id:1, companyId:1 }).toArray();
    let moved=0, conflicts=0;
    for (const row of rows) {
      try {
        await Model.collection.updateOne({ _id:row._id }, { $set:{ companyId:PLATFORM, legacyOwnerCompanyId:row.companyId, platformManaged:true, migratedAt:now } });
        moved+=1;
      } catch (error) {
        if (error && error.code===11000) {
          await Model.collection.updateOne({ _id:row._id }, { $set:{ status:'archived', legacyOwnerCompanyId:row.companyId, migrationConflict:true, migratedAt:now } });
          conflicts+=1;
        } else throw error;
      }
    }
    results.push({ collection:Model.collection.name, moved, conflicts });
  }
  return results;
}

async function migrateFlightOrders(flightAgentIds) {
  const rows=await FlightOrder.find({ companyId:{ $ne:PLATFORM } }).select('id companyId agentCompanyId supplierId bookingId bookingRef').lean();
  let migrated=0;
  for (const order of rows) {
    const legacyCompanyId=String(order.companyId || '');
    const agentCompanyId=order.agentCompanyId || (flightAgentIds.has(legacyCompanyId) ? legacyCompanyId : '');
    await FlightOrder.updateOne({ id:order.id }, { $set:{ companyId:PLATFORM, agentCompanyId, migratedAt:now } });
    await FlightTicket.updateMany({ orderId:order.id }, { $set:{ companyId:PLATFORM, agentCompanyId, bookingId:order.bookingId, bookingRef:order.bookingRef } });
    await FlightTraveler.updateMany({ orderId:order.id }, { $set:{ companyId:PLATFORM, agentCompanyId, bookingId:order.bookingId, bookingRef:order.bookingRef } });
    await FlightSeatAssignment.updateMany({ orderId:order.id }, { $set:{ companyId:PLATFORM } });
    const supplierId=String(order.supplierId || 'platform-flight-supply');
    await Booking.updateOne({ id:order.bookingId }, { $set:{ companyId:PLATFORM, tenantId:PLATFORM, agentCompanyId, supplierId, 'agentSale.agentCompanyId':agentCompanyId, 'agentSale.supplierId':supplierId, 'agentSale.migratedAt':now } });
    await BookingItem.updateMany({ bookingId:order.bookingId, serviceType:'flight' }, { $set:{ companyId:PLATFORM, agentCompanyId, supplierId } });
    migrated+=1;
  }
  return migrated;
}

async function migrateTaxiRides(mobilityPartnerIds) {
  const rows=await TaxiRide.find({ companyId:{ $ne:PLATFORM } }).select('id companyId providerCompanyId requestId quoteId bookingId').lean();
  let migrated=0;
  for (const ride of rows) {
    const legacyCompanyId=String(ride.companyId || '');
    const providerCompanyId=ride.providerCompanyId || (mobilityPartnerIds.has(legacyCompanyId) ? legacyCompanyId : '');
    await TaxiRide.updateOne({ id:ride.id }, { $set:{ companyId:PLATFORM, providerCompanyId, platformManaged:true, migratedAt:now } });
    await RideRequest.updateOne({ id:ride.requestId }, { $set:{ companyId:PLATFORM, providerCompanyId, platformManaged:true } });
    await RideQuote.updateOne({ id:ride.quoteId }, { $set:{ companyId:PLATFORM, platformManaged:true } });
    await RideAssignment.updateMany({ rideId:ride.id }, { $set:{ companyId:PLATFORM, providerCompanyId } });
    await RideEvent.updateMany({ rideId:ride.id }, { $set:{ companyId:PLATFORM } });
    await Booking.updateOne({ id:ride.bookingId }, { $set:{ companyId:PLATFORM, tenantId:PLATFORM, providerCompanyId, 'agentSale.providerCompanyId':providerCompanyId, 'agentSale.migratedAt':now } });
    await BookingItem.updateMany({ bookingId:ride.bookingId, serviceType:'local_transport' }, { $set:{ companyId:PLATFORM, providerCompanyId } });
    migrated+=1;
  }
  return migrated;
}

async function archivePartnerMobilityConfiguration() {
  const models=[require('../src/models/VehicleClass'),require('../src/models/TaxiServiceZone'),require('../src/models/TaxiFareRule')];
  const result=[];
  for (const Model of models) {
    const update=await Model.collection.updateMany(
      { companyId:{ $ne:PLATFORM } },
      { $set:{ status:'archived', platformReplaced:true, migratedAt:now } }
    );
    result.push({ collection:Model.collection.name, archived:update.modifiedCount || 0 });
  }
  return result;
}

async function updateCompanyProfiles(companies) {
  let changed=0;
  for (const company of companies) {
    if (company.companyType==='flight') {
      const partnerCategory='flight_agent';
      await Company.updateOne({ _id:company._id }, { $set:{ partnerCategory, accountModel:'agency', capabilityPolicy:capabilityPolicyFor(partnerCategory), 'settings.partnerCategory':partnerCategory, 'settings.accountModel':'agency', 'settings.supplierManagedInventory':true, 'settings.platformManagedSupply':true, 'onboardingProgress.currentStep':company.verificationStatus==='verified'?'agent_ready':'verification' } });
      changed+=1;
    }
    if (company.companyType==='local_transport') {
      const partnerCategory=inferredMobilityCategory(company);
      const accountModel=['boda_rider','car_driver'].includes(partnerCategory)?'individual_driver':['fleet_owner'].includes(partnerCategory)?'fleet':'organization';
      const defaultDriverPayoutPercent=['boda_rider','car_driver'].includes(partnerCategory)?100:80;
      const driverPayoutPercent=Number.isFinite(Number(company.settings?.driverPayoutPercent))
        ? Math.max(0,Math.min(100,Number(company.settings.driverPayoutPercent)))
        : defaultDriverPayoutPercent;
      await Company.updateOne({ _id:company._id }, { $set:{ partnerCategory, accountModel, capabilityPolicy:capabilityPolicyFor(partnerCategory), 'settings.partnerCategory':partnerCategory, 'settings.accountModel':accountModel, 'settings.platformManagedPricing':true, 'settings.platformManagedDispatch':true, 'settings.platformManagedSupply':true, 'settings.driverPayoutPercent':driverPayoutPercent } });
      changed+=1;
    }
  }
  return changed;
}

async function main() {
  await connectDb();
  const companies=await Company.find({ companyType:{ $in:['flight','local_transport'] } }).lean();
  const flightAgentIds=new Set(companies.filter((row)=>row.companyType==='flight').map((row)=>String(row.id || '')));
  const mobilityPartnerIds=new Set(companies.filter((row)=>row.companyType==='local_transport').map((row)=>String(row.id || '')));
  const counts={
    companiesToNormalize:companies.length,
    legacyFlightListings:await Listing.countDocuments({ serviceType:'flight', companyId:{ $ne:PLATFORM } }),
    legacyMobilityListings:await Listing.countDocuments({ serviceType:'local_transport', companyId:{ $ne:PLATFORM } }),
    flightOrdersToRescope:await FlightOrder.countDocuments({ companyId:{ $ne:PLATFORM } }),
    taxiRidesToRescope:await TaxiRide.countDocuments({ companyId:{ $ne:PLATFORM } }),
    partnerVehicleClassesToArchive:await require('../src/models/VehicleClass').countDocuments({ companyId:{ $ne:PLATFORM } }),
    partnerZonesToArchive:await require('../src/models/TaxiServiceZone').countDocuments({ companyId:{ $ne:PLATFORM } }),
    partnerFareRulesToArchive:await require('../src/models/TaxiFareRule').countDocuments({ companyId:{ $ne:PLATFORM } }),
  };
  console.log(JSON.stringify({ mode:apply?'apply':'dry-run', database:mongoose.connection.name, ...counts, next:'Run npm run seed:travel-reference after applying this migration.' },null,2));
  if (!apply) return;

  const companyUpdates=await updateCompanyProfiles(companies);
  const archivedListings=await archiveLegacyListings();
  const supplyMoves=await moveFlightSupply();
  const flightOrders=await migrateFlightOrders(flightAgentIds);
  const taxiRides=await migrateTaxiRides(mobilityPartnerIds);
  const mobilityConfig=await archivePartnerMobilityConfiguration();
  for (const Model of indexModels) await Model.createIndexes();
  console.log(JSON.stringify({ applied:true, companyUpdates, archivedListings:archivedListings.modifiedCount || 0, supplyMoves, flightOrders, taxiRides, mobilityConfig, indexesEnsured:indexModels.length },null,2));
}

main().catch((error)=>{console.error(error);process.exitCode=1;}).finally(async()=>{await mongoose.disconnect().catch(()=>{});});
