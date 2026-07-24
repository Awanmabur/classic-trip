const { MongoCollection } = require('./mongoCollection');

module.exports = {
  users: new MongoCollection('users'),
  verificationReviews: new MongoCollection('verificationReviews'),
  agentProfiles: new MongoCollection('agentProfiles'),
  savedListings: new MongoCollection('savedListings'),
  listings: new MongoCollection('listings'),
  bookings: new MongoCollection('bookings'),
  wallets: new MongoCollection('wallets'),
  transactions: new MongoCollection('walletTransactions'),
  reviews: new MongoCollection('reviews'),
  refunds: new MongoCollection('refundRequests'),
  reschedules: new MongoCollection('rescheduleRequests'),
  supportTickets: new MongoCollection('supportTickets'),
  auditLogs: new MongoCollection('auditLogs'),
};
