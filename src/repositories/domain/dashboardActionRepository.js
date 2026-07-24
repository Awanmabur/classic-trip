const { MongoCollection } = require('./mongoCollection');
const repositories = require('..');
const { runMongoUnitOfWork } = require('../../services/shared/mongoUnitOfWork');

const dashboardActionRepository = {
  users: new MongoCollection('users'),
  companies: new MongoCollection('companies'),
  employees: new MongoCollection('companyEmployees'),
  invitations: new MongoCollection('invitations'),
  listings: new MongoCollection('listings'),
  bookings: new MongoCollection('bookings'),
  payments: new MongoCollection('payments'),
  roomNights: new MongoCollection('roomNightInventories'),
  tickets: new MongoCollection('supportTickets'),
  refunds: new MongoCollection('refundRequests'),
  reviews: new MongoCollection('reviews'),
  handovers: new MongoCollection('shiftHandovers'),
  schedules: new MongoCollection('schedules'),
  vehicles: new MongoCollection('vehicles'),
  auditLogs: new MongoCollection('auditLogs'),
  timelineEvents: new MongoCollection('bookingTimelineEvents'),
};

async function withTransaction(work) {
  return runMongoUnitOfWork(work);
}

module.exports = { ...dashboardActionRepository, withTransaction };
