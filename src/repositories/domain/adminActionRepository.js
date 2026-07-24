const { MongoCollection } = require('./mongoCollection');
const repositories = require('..');
const { runMongoUnitOfWork } = require('../../services/shared/mongoUnitOfWork');

const adminActionRepository = {
  users: new MongoCollection('users'),
  companies: new MongoCollection('companies'),
  employees: new MongoCollection('companyEmployees'),
  listings: new MongoCollection('listings'),
  campaigns: new MongoCollection('promotionCampaigns'),
  bookings: new MongoCollection('bookings'),
  payments: new MongoCollection('payments'),
  walletTransactions: new MongoCollection('walletTransactions'),
  tickets: new MongoCollection('supportTickets'),
  refunds: new MongoCollection('refundRequests'),
  auditLogs: new MongoCollection('auditLogs'),
  driverAssignments: new MongoCollection('driverAssignments'),
  vehicles: new MongoCollection('vehicles'),
  schedules: new MongoCollection('schedules'),
  invitations: new MongoCollection('invitations'),
};

async function withTransaction(work) {
  return runMongoUnitOfWork(work);
}

module.exports = { ...adminActionRepository, withTransaction };
