const { MongoCollection } = require('./mongoCollection');

module.exports = {
  users: new MongoCollection('users'),
  companies: new MongoCollection('companies'),
  employees: new MongoCollection('companyEmployees'),
  securityEvents: new MongoCollection('securityEvents'),
  loginAudits: new MongoCollection('loginAudits'),
  deviceSessions: new MongoCollection('deviceSessions'),
  idempotencyKeys: new MongoCollection('idempotencyKeyRecords'),
  auditLogs: new MongoCollection('auditLogs'),
  verificationReviews: new MongoCollection('verificationReviews'),
};
