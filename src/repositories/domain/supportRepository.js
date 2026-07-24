const { MongoCollection } = require('./mongoCollection');
const repositories = require('..');
const { runMongoUnitOfWork } = require('../../services/shared/mongoUnitOfWork');

async function withTransaction(work) {
  return runMongoUnitOfWork(work);
}

module.exports = {
  withTransaction,
  tickets: new MongoCollection('supportTickets'),
  refunds: new MongoCollection('refundRequests'),
  reviews: new MongoCollection('reviews'),
  timelineEvents: new MongoCollection('bookingTimelineEvents'),
  rescheduleRequests: new MongoCollection('rescheduleRequests'),
  messages: new MongoCollection('correspondenceMessages'),
  deliveryAttempts: new MongoCollection('notificationDeliveryAttempts'),
  notifications: new MongoCollection('notifications'),
  auditLogs: new MongoCollection('auditLogs'),
  agreements: new MongoCollection('agreements'),
  verificationReviews: new MongoCollection('verificationReviews'),
  companyEmployees: new MongoCollection('companyEmployees'),
  users: new MongoCollection('users'),
  bookings: new MongoCollection('bookings'),
  payments: new MongoCollection('payments'),
  listings: new MongoCollection('listings'),
  schedules: new MongoCollection('schedules'),
  commissions: new MongoCollection('commissions'),
  seats: new MongoCollection('seats'),
  roomNights: new MongoCollection('roomNightInventories'),
};
