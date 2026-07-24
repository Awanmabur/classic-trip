const { MongoCollection } = require('./mongoCollection');
const repositories = require('..');
const { runMongoUnitOfWork } = require('../../services/shared/mongoUnitOfWork');

const repository = {
  users: new MongoCollection('users'),
  companies: new MongoCollection('companies'),
  profiles: new MongoCollection('agentProfiles'),
  links: new MongoCollection('promoterLinks'),
  clicks: new MongoCollection('referralClicks'),
  attributionSessions: new MongoCollection('attributionSessions'),
  conversions: new MongoCollection('campaignConversions'),
  fraudSignals: new MongoCollection('fraudSignals'),
  offlineSales: new MongoCollection('offlineSales'),
  bookings: new MongoCollection('bookings'),
  listings: new MongoCollection('listings'),
  schedules: new MongoCollection('schedules'),
  seats: new MongoCollection('seats'),
  payments: new MongoCollection('payments'),
  wallets: new MongoCollection('wallets'),
  transactions: new MongoCollection('walletTransactions'),
  commissions: new MongoCollection('commissions'),
  campaigns: new MongoCollection('promotionCampaigns'),
  auditLogs: new MongoCollection('auditLogs'),

};

async function withTransaction(work) {
  return runMongoUnitOfWork(work);
}

module.exports = { ...repository, withTransaction };
