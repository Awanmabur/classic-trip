const { MongoCollection } = require('./mongoCollection');

module.exports = {
  users: new MongoCollection('users'),
  companies: new MongoCollection('companies'),
  employees: new MongoCollection('companyEmployees'),
  invitations: new MongoCollection('invitations'),
  verificationReviews: new MongoCollection('verificationReviews'),
  securityEvents: new MongoCollection('securityEvents'),
  loginAudits: new MongoCollection('loginAudits'),
  deviceSessions: new MongoCollection('deviceSessions'),
  idempotencyKeys: new MongoCollection('idempotencyKeyRecords'),
  auditLogs: new MongoCollection('auditLogs'),
};
