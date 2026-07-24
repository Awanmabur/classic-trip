const { mongoose } = require('../../config/db');
const { runMongoUnitOfWork } = require('../../services/shared/mongoUnitOfWork');
const { clean } = require('../mongoRepository');
const { nextId } = require('../../services/data/idService');
const { MongoCollection } = require('./mongoCollection');

const collections = {
  companies: new MongoCollection('companies'),
  users: new MongoCollection('users'),
  employees: new MongoCollection('companyEmployees'),
  branches: new MongoCollection('companyBranches'),
  listings: new MongoCollection('listings'),
  routes: new MongoCollection('routes'),
  routeStops: new MongoCollection('routeStops'),
  vehicles: new MongoCollection('vehicles'),
  schedules: new MongoCollection('schedules'),
  seats: new MongoCollection('seats'),
  scheduleRules: new MongoCollection('scheduleRules'),
  driverAssignments: new MongoCollection('driverAssignments'),
  bookings: new MongoCollection('bookings'),
  tripStatusUpdates: new MongoCollection('tripStatusUpdates'),
  auditLogs: new MongoCollection('auditLogs'),
  commissions: new MongoCollection('commissions'),
  wallets: new MongoCollection('wallets'),
  walletTransactions: new MongoCollection('walletTransactions'),
};

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  throw error;
}

async function companyOrThrow(companyId) {
  return (await collections.companies.findOne({ id: companyId })) || notFound('Company not found');
}

async function listingOrThrow(companyId, identifier) {
  return (await collections.listings.findOne({ companyId, $or: [{ id: identifier }, { slug: identifier }] })) || notFound('Listing not found for this company');
}

async function routeOrThrow(companyId, routeId) {
  return (await collections.routes.findOne({ id: routeId, companyId })) || notFound('Route not found for this company');
}

async function routeStopOrThrow(companyId, stopId) {
  return (await collections.routeStops.findOne({ id: stopId, companyId })) || notFound('Route stop not found for this company');
}

async function vehicleOrThrow(companyId, vehicleId) {
  return (await collections.vehicles.findOne({ id: vehicleId, companyId })) || notFound('Vehicle not found for this company');
}

async function scheduleOrThrow(companyId, scheduleId) {
  return (await collections.schedules.findOne({ id: scheduleId, companyId })) || notFound('Schedule not found for this company');
}

async function scheduleRuleOrThrow(companyId, ruleId) {
  return (await collections.scheduleRules.findOne({ id: ruleId, companyId })) || notFound('Recurring schedule rule not found for this company');
}

async function audit({ actorId, action, targetId, meta = {} }) {
  const row = {
    id: await nextId('audit'),
    actorId,
    action,
    targetType: 'bus',
    targetId,
    target: targetId,
    meta,
    status: 'success',
    createdAt: new Date().toISOString(),
  };
  await collections.auditLogs.save(row);
  return row;
}

function model(name) {
  require(`../../models/${name}`);
  return mongoose.model(name);
}

async function transaction(work) {
  return runMongoUnitOfWork(work);
}

async function commitSchedule({ schedule, seats }) {
  return transaction(async (session) => {
    const TripSchedule = model('TripSchedule');
    const Seat = model('Seat');
    await TripSchedule.updateOne(
      { id: schedule.id },
      { $set: schedule },
      { upsert: true, runValidators: true, session }
    );
    if (seats.length) {
      await Seat.bulkWrite(seats.map((seat) => ({
        updateOne: {
          filter: { scheduleId: seat.scheduleId, seatNumber: seat.seatNumber },
          update: { $set: seat },
          upsert: true,
        },
      })), { session });
    }
    return { schedule, seats };
  });
}

async function replaceScheduleSeats({ schedule, seats }) {
  return transaction(async (session) => {
    const TripSchedule = model('TripSchedule');
    const Seat = model('Seat');
    await Seat.deleteMany({ scheduleId: schedule.id }).session(session);
    if (seats.length) await Seat.insertMany(seats, { session, ordered: true });
    await TripSchedule.updateOne(
      { id: schedule.id },
      { $set: schedule },
      { upsert: true, runValidators: true, session },
    );
    return { schedule: clean(schedule), seats };
  });
}

module.exports = {
  ...collections,
  nextId,
  companyOrThrow,
  listingOrThrow,
  routeOrThrow,
  routeStopOrThrow,
  vehicleOrThrow,
  scheduleOrThrow,
  scheduleRuleOrThrow,
  audit,
  transaction,
  commitSchedule,
  replaceScheduleSeats,
};
