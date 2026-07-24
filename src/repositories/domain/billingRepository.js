const { MongoCollection } = require('./mongoCollection');
const repositories = require('..');
const { runMongoUnitOfWork } = require('../../services/shared/mongoUnitOfWork');

const repository = {
  orders: new MongoCollection('subscriptionOrders'),
  subscriptions: new MongoCollection('subscriptions'),
  payments: new MongoCollection('payments'),
  companies: new MongoCollection('companies'),
  users: new MongoCollection('users'),
  supportTickets: new MongoCollection('supportTickets'),
  auditLogs: new MongoCollection('auditLogs'),
};
async function withTransaction(work) {
  return runMongoUnitOfWork(work);
}
module.exports = { ...repository, withTransaction };
