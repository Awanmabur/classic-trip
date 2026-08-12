#!/usr/bin/env node
'use strict';

require('dotenv').config();
const { connectDb, mongoose } = require('../src/config/db');

const SPECS = [
  ['BusSegmentFare', { fareProductId: 1, fromStopId: 1, toStopId: 1 }, { status: { $in: ['active', 'paused'] } }, 'uniq_live_bus_segment_fare'],
  ['SeatMapTemplate', { vehicleId: 1 }, { status: { $in: ['draft', 'active'] } }, 'uniq_live_vehicle_seat_template'],
  ['HotelProperty', { companyId: 1, listingId: 1 }, { status: { $in: ['active', 'paused'] } }, 'uniq_live_hotel_property_listing'],
  ['RoomType', { companyId: 1, propertyId: 1, normalizedName: 1 }, { status: { $in: ['active', 'paused'] } }, 'uniq_live_room_type_name'],
  ['RoomUnit', { companyId: 1, propertyId: 1, normalizedUnitNumber: 1 }, { status: { $in: ['available', 'occupied', 'maintenance', 'cleaning', 'reserved'] } }, 'uniq_live_room_unit_number'],
  ['RatePlan', { companyId: 1, roomTypeId: 1, code: 1 }, { status: { $in: ['active', 'paused'] } }, 'uniq_live_rate_plan_code'],
  ['TaxiVehicle', { companyId: 1, registrationNumber: 1 }, { operationalStatus: { $in: ['offline', 'available', 'assigned', 'on_trip', 'maintenance', 'suspended'] } }, 'uniq_live_taxi_vehicle_registration'],
  ['TaxiServiceZone', { companyId: 1, name: 1 }, { status: { $in: ['active', 'paused'] } }, 'uniq_live_taxi_zone_name'],
  ['TaxiFareRule', { companyId: 1, vehicleClassId: 1, serviceZoneId: 1, serviceType: 1 }, { status: { $in: ['active', 'paused'] } }, 'uniq_live_taxi_fare_rule'],
  ['VehicleClass', { companyId: 1, key: 1 }, { status: { $in: ['active', 'paused'] } }, 'uniq_live_vehicle_class_key'],
  ['FlightRoute', { companyId: 1, originAirportId: 1, destinationAirportId: 1, listingId: 1 }, { status: { $in: ['draft', 'active', 'paused'] } }, 'uniq_live_flight_route'],
  ['FlightFareFamily', { companyId: 1, airlineId: 1, code: 1 }, { status: { $in: ['draft', 'active', 'paused'] } }, 'uniq_live_flight_fare_code'],
  ['FlightAncillary', { companyId: 1, code: 1 }, { status: { $in: ['active', 'paused'] } }, 'uniq_live_flight_ancillary_code'],
  ['Airline', { companyId: 1, iataCode: 1 }, { status: { $in: ['draft', 'active', 'suspended'] }, iataCode: { $exists: true } }, 'uniq_live_airline_iata'],
  ['Aircraft', { companyId: 1, registration: 1 }, { status: { $in: ['draft', 'active', 'maintenance', 'grounded'] } }, 'uniq_live_aircraft_registration'],
];

function sameKey(a = {}, b = {}) {
  const ak = Object.keys(a); const bk = Object.keys(b);
  return ak.length === bk.length && ak.every((key, index) => key === bk[index] && Number(a[key]) === Number(b[key]));
}

async function repairSpec(modelName, key, partialFilterExpression, name) {
  require(`../src/models/${modelName}`);
  const Model = mongoose.model(modelName);
  const collection = Model.collection;
  let indexes = [];
  try { indexes = await collection.indexes(); } catch (error) {
    if (!/ns does not exist|namespace.*not found/i.test(String(error.message || ''))) throw error;
  }
  const desired = indexes.find((index) => index.name === name);
  if (desired) return { model: modelName, action: 'already_current', index: name };
  const conflicting = indexes.filter((index) => index.name !== '_id_' && sameKey(index.key, key));
  for (const index of conflicting) await collection.dropIndex(index.name);
  await collection.createIndex(key, { unique: true, partialFilterExpression, name });
  return { model: modelName, action: conflicting.length ? 'replaced_legacy_index' : 'created', index: name };
}

async function main() {
  process.env.CLASSIC_TRIP_PROCESS_ROLE = process.env.CLASSIC_TRIP_PROCESS_ROLE || 'archive-index-repair';
  await connectDb();
  const results = [];
  for (const spec of SPECS) {
    // Index changes are deliberately serial: production Atlas should never be
    // asked to rebuild all operational unique constraints simultaneously.
    // eslint-disable-next-line no-await-in-loop
    results.push(await repairSpec(...spec));
  }
  console.log(JSON.stringify({ repairedAt: new Date().toISOString(), indexes: results }, null, 2));
}

main().catch((error) => {
  console.error('Archive uniqueness repair failed:', error.message);
  process.exitCode = 1;
}).finally(async () => {
  await mongoose.disconnect().catch(() => {});
});
