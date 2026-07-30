'use strict';

const { mongoose } = require('../config/db');
const logger = require('../config/logger');

const BATCH_LIMIT = 50;
const RETENTION_DAYS = 30;

const POLICIES = Object.freeze([
  { model: 'BlogPost' },
  { model: 'CompanyPolicy' },
  { model: 'Notification' },
  {
    model: 'CompanyBranch',
    dependencies: [
      ['CompanyEmployee', (row) => ({ branchId: row.id })],
      ['Listing', (row) => ({ branchId: row.id })],
      ['RouteStop', (row) => ({ branchId: row.id })],
    ],
  },
  {
    model: 'PromoterLink',
    dependencies: [
      ['ReferralClick', (row) => ({ linkId: row.id })],
      ['CampaignConversion', (row) => ({ linkId: row.id })],
    ],
  },
  {
    model: 'ServiceAddon',
    dependencies: [
      ['Booking', (row) => ({ $or: [{ 'addons.id': row.id }, { 'pricing.addons.id': row.id }] })],
      ['BookingItem', (row) => ({ 'pricing.addons.id': row.id })],
    ],
  },
  {
    model: 'BusSegmentFare',
    dependencies: [
      ['TripSchedule', (row) => ({ 'fareSnapshot.fareIds': row.id })],
    ],
  },
  {
    model: 'FareProduct',
    dependencies: [
      ['TripSchedule', (row) => ({ fareProductId: row.id })],
      ['BusReservation', (row) => ({ fareProductId: row.id })],
    ],
  },
  {
    model: 'RouteStop',
    dependencies: [
      ['RouteSegment', (row) => ({ $or: [{ fromStopId: row.id }, { toStopId: row.id }] })],
      ['BusSegmentFare', (row) => ({ $or: [{ fromStopId: row.id }, { toStopId: row.id }] })],
      ['BusReservation', (row) => ({ $or: [{ originStopId: row.id }, { destinationStopId: row.id }] })],
    ],
  },
  {
    model: 'RouteSegment',
    dependencies: [
      ['BusSeatSegmentInventory', (row) => ({ segmentId: row.id })],
      ['BusReservation', (row) => ({ segmentIds: row.id })],
    ],
  },
  {
    model: 'SeatMapTemplate',
    dependencies: [
      ['TripSchedule', (row) => ({ seatMapTemplateId: row.id })],
    ],
  },
  {
    model: 'SeatMapVersion',
    dependencies: [
      ['TripSchedule', (row) => ({ seatMapVersionId: row.id })],
      ['BusReservation', (row) => ({ seatMapVersionId: row.id })],
    ],
  },
  {
    model: 'Vehicle',
    dependencies: [
      ['TripSchedule', (row) => ({ vehicleId: row.id })],
      ['BusReservation', (row) => ({ vehicleId: row.id })],
      ['DriverAssignment', (row) => ({ vehicleId: row.id })],
    ],
  },
  {
    model: 'Route',
    dependencies: [
      ['TripSchedule', (row) => ({ routeId: row.id })],
      ['BusReservation', (row) => ({ routeId: row.id })],
      ['ScheduleRule', (row) => ({ routeId: row.id })],
    ],
  },
  {
    model: 'TripSchedule',
    dependencies: [
      ['BusReservation', (row) => ({ scheduleId: row.id })],
      ['BusTicket', (row) => ({ scheduleId: row.id })],
      ['Booking', (row) => ({ scheduleId: row.id })],
    ],
  },
  {
    model: 'RatePlan',
    dependencies: [
      ['RoomNightInventory', (row) => ({ ratePlanId: row.id })],
      ['RoomAssignment', (row) => ({ ratePlanId: row.id })],
    ],
  },
  {
    model: 'RoomUnit',
    dependencies: [
      ['RoomNightInventory', (row) => ({ roomUnitId: row.id })],
      ['RoomAssignment', (row) => ({ roomUnitId: row.id })],
    ],
  },
  {
    model: 'RoomType',
    dependencies: [
      ['RoomNightInventory', (row) => ({ roomTypeId: row.id })],
      ['RoomAssignment', (row) => ({ roomTypeId: row.id })],
    ],
  },
  {
    model: 'HotelProperty',
    dependencies: [
      ['HotelReservation', (row) => ({ propertyId: row.id })],
      ['RoomType', (row) => ({ propertyId: row.id })],
    ],
  },
  {
    model: 'RoomNightInventory',
    dependencies: [
      ['HotelReservation', (row) => ({ $or: [
        { id: row.reservationId || '__none__' },
        { bookingRef: row.bookingRef || '__none__' },
      ] })],
    ],
  },
  {
    model: 'CompanyEmployee',
    dependencies: [
      ['TripSchedule', (row) => ({ driverEmployeeId: row.id })],
      ['DriverAssignment', (row) => ({ employeeId: row.id })],
    ],
  },
  {
    model: 'Listing',
    dependencies: [
      ['Booking', (row) => ({ listingId: row.id })],
      ['BookingItem', (row) => ({ listingId: row.id })],
      ['TripSchedule', (row) => ({ listingId: row.id })],
      ['HotelReservation', (row) => ({ listingId: row.id })],
      ['FlightOrder', (row) => ({ listingId: row.id })],
      ['TaxiRide', (row) => ({ listingId: row.id })],
    ],
  },
  {
    model: 'Room',
    dependencies: [
      ['Booking', (row) => ({ listingId: row.listingId, 'passengers.roomNumber': row.id })],
    ],
  },
  {
    model: 'Airline',
    dependencies: [
      ['Aircraft', (row) => ({ airlineId: row.id })],
      ['FlightAncillary', (row) => ({ airlineId: row.id })],
      ['FlightFareFamily', (row) => ({ airlineId: row.id })],
      ['FlightRoute', (row) => ({ airlineId: row.id })],
      ['FlightDeparture', (row) => ({ airlineId: row.id })],
      ['FlightSupplier', (row) => ({ airlineId: row.id })],
    ],
  },
  {
    model: 'Aircraft',
    dependencies: [
      ['FlightDeparture', (row) => ({ aircraftId: row.id })],
      ['FlightOffer', (row) => ({ 'segments.aircraftId': row.id })],
      ['FlightSeatInventory', (row) => ({ aircraftId: row.id })],
    ],
  },
  {
    model: 'FlightRoute',
    dependencies: [
      ['FlightDeparture', (row) => ({ routeId: row.id })],
      ['FlightFareFamily', (row) => ({ routeId: row.id })],
    ],
  },
  {
    model: 'FlightFareFamily',
    dependencies: [
      ['FlightOffer', (row) => ({ $or: [{ fareFamilyId: row.id }, { 'segments.fareFamilyId': row.id }] })],
      ['FlightSeatInventory', (row) => ({ fareFamilyIds: row.id })],
    ],
  },
  { model: 'FlightAncillary' },
  {
    model: 'VehicleClass',
    dependencies: [
      ['TaxiVehicle', (row) => ({ vehicleClassId: row.id })],
      ['TaxiFareRule', (row) => ({ vehicleClassId: row.id })],
      ['RideQuote', (row) => ({ vehicleClassId: row.id })],
      ['RideRequest', (row) => ({ vehicleClassId: row.id })],
      ['TaxiRide', (row) => ({ vehicleClassId: row.id })],
    ],
  },
  {
    model: 'TaxiServiceZone',
    dependencies: [
      ['TaxiFareRule', (row) => ({ serviceZoneId: row.id })],
      ['DriverAvailability', (row) => ({ serviceZoneIds: row.id })],
    ],
  },
  {
    model: 'TaxiFareRule',
    dependencies: [
      ['RideQuote', (row) => ({ fareRuleId: row.id })],
    ],
  },
  {
    model: 'TaxiVehicle',
    dependencies: [
      ['TaxiRide', (row) => ({ vehicleId: row.id })],
    ],
  },
  { model: 'Place' },
]);

function loadModel(name) {
  require(`../models/${name}`);
  return mongoose.model(name);
}

async function dependencyReason(row, dependencies = []) {
  for (const [modelName, filterFor] of dependencies) {
    const filter = filterFor(row);
    if (!filter) continue;
    const exists = await loadModel(modelName).exists(filter);
    if (exists) return `${modelName} still references this record`;
  }
  return '';
}

async function backfillRetention(Model, now) {
  const purgeAfter = new Date(now.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000);
  return Model.updateMany({
    $or: [{ status: 'archived' }, { operationalStatus: 'archived' }],
    $and: [{ $or: [{ archivedAt: { $exists: false } }, { archivedAt: null }] }],
  }, {
    $set: { archivedAt: now, purgeAfter, retentionHold: false, retentionHoldReason: '' },
  });
}

async function purgePolicy(policy, now) {
  const Model = loadModel(policy.model);
  await backfillRetention(Model, now);
  const rows = await Model.find({
    $or: [{ status: 'archived' }, { operationalStatus: 'archived' }],
    purgeAfter: { $lte: now },
    retentionHold: { $ne: true },
  }).sort({ purgeAfter: 1 }).limit(BATCH_LIMIT).lean();

  let purged = 0;
  let held = 0;
  for (const row of rows) {
    // Historical bookings, tickets and financial relationships always win over
    // physical deletion. Such records remain invisible but keep their IDs.
    // eslint-disable-next-line no-await-in-loop
    const reason = await dependencyReason(row, policy.dependencies);
    if (reason) {
      // eslint-disable-next-line no-await-in-loop
      await Model.updateOne({ _id: row._id }, {
        $set: { retentionHold: true, retentionHoldReason: reason },
        $unset: { purgeAfter: '' },
      });
      held += 1;
    } else {
      // eslint-disable-next-line no-await-in-loop
      await Model.deleteOne({ _id: row._id });
      purged += 1;
    }
  }
  return { model: policy.model, considered: rows.length, purged, held };
}

async function run(now = new Date()) {
  const results = [];
  for (const policy of POLICIES) {
    try {
      // Sequential collections keep cleanup from competing with web traffic for
      // the MongoDB pool.
      // eslint-disable-next-line no-await-in-loop
      results.push(await purgePolicy(policy, now));
    } catch (error) {
      logger.error('Archived record cleanup failed for one collection', {
        model: policy.model,
        error: error.message,
      });
      results.push({ model: policy.model, error: error.message });
    }
  }
  return {
    retentionDays: RETENTION_DAYS,
    purged: results.reduce((sum, row) => sum + Number(row.purged || 0), 0),
    heldForIntegrity: results.reduce((sum, row) => sum + Number(row.held || 0), 0),
    results,
  };
}

module.exports = { run, POLICIES, RETENTION_DAYS, BATCH_LIMIT };
