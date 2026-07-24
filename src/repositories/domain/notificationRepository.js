const { MongoCollection } = require('./mongoCollection');

module.exports = {
  notifications: new MongoCollection('notifications'),
  deliveryAttempts: new MongoCollection('notificationDeliveryAttempts'),
  pushSubscriptions: new MongoCollection('pushSubscriptions'),
  users: new MongoCollection('users'),
  companyEmployees: new MongoCollection('companyEmployees'),
  auditLogs: new MongoCollection('auditLogs'),
};
