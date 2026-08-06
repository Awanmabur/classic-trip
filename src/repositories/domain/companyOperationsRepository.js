const { MongoCollection } = require('./mongoCollection');
const repositories = require('..');
const { runMongoUnitOfWork } = require('../../services/shared/mongoUnitOfWork');

const companyOperationsRepository = {
  users: new MongoCollection('users'),
  companies: new MongoCollection('companies'),
  employees: new MongoCollection('companyEmployees'),
  branches: new MongoCollection('companyBranches'),
  policies: new MongoCollection('companyPolicies'),
  listings: new MongoCollection('listings'),
  routes: new MongoCollection('routes'),
  routeStops: new MongoCollection('routeStops'),
  vehicles: new MongoCollection('vehicles'),
  schedules: new MongoCollection('schedules'),
  seats: new MongoCollection('seats'),
  busSeatSegmentInventories: new MongoCollection('busSeatSegmentInventories'),
  driverAssignments: new MongoCollection('driverAssignments'),
  driverIncidents: new MongoCollection('driverIncidents'),
  tripStatusUpdates: new MongoCollection('tripStatusUpdates'),
  verificationReviews: new MongoCollection('verificationReviews'),
  hotelProperties: new MongoCollection('hotelProperties'),
  roomTypes: new MongoCollection('roomTypes'),
  roomUnits: new MongoCollection('roomUnits'),
  auditLogs: new MongoCollection('auditLogs'),
};

async function withTransaction(work) {
  return runMongoUnitOfWork(work);
}

module.exports = { ...companyOperationsRepository, withTransaction };
