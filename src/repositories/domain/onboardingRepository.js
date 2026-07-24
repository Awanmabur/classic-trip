const { MongoCollection } = require('./mongoCollection');
const repositories = require('..');
const { runMongoUnitOfWork } = require('../../services/shared/mongoUnitOfWork');

const onboardingRepository = {
  users: new MongoCollection('users'),
  companies: new MongoCollection('companies'),
  employees: new MongoCollection('companyEmployees'),
  driverAssignments: new MongoCollection('driverAssignments'),
  branches: new MongoCollection('companyBranches'),
  policies: new MongoCollection('companyPolicies'),
  invitations: new MongoCollection('invitations'),
  verificationReviews: new MongoCollection('verificationReviews'),
  partnerLeads: new MongoCollection('partnerLeads'),
  discoverySessions: new MongoCollection('discoverySessions'),
  agreements: new MongoCollection('agreements'),
  agentProfiles: new MongoCollection('agentProfiles'),
  listings: new MongoCollection('listings'),
  routes: new MongoCollection('routes'),
  vehicles: new MongoCollection('vehicles'),
  schedules: new MongoCollection('schedules'),
  hotelProperties: new MongoCollection('hotelProperties'),
  roomTypes: new MongoCollection('roomTypes'),
  roomUnits: new MongoCollection('roomUnits'),
  auditLogs: new MongoCollection('auditLogs'),
  notifications: new MongoCollection('notifications'),
};

async function withTransaction(work) {
  return runMongoUnitOfWork(work);
}

module.exports = { ...onboardingRepository, withTransaction };
