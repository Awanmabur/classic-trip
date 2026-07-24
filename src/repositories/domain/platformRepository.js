const { MongoCollection } = require('./mongoCollection');

module.exports = {
  outboxEvents: new MongoCollection('outboxEvents'),
  notifications: new MongoCollection('notifications'),
  deliveryAttempts: new MongoCollection('notificationDeliveryAttempts'),
  auditLogs: new MongoCollection('auditLogs'),
  platformSettings: new MongoCollection('platformSettings'),
  paymentIntents: new MongoCollection('paymentIntents'),
  promotionCampaigns: new MongoCollection('promotionCampaigns'),
  bookings: new MongoCollection('bookings'),
  commissions: new MongoCollection('commissions'),
};
