const { MongoCollection } = require('./mongoCollection');
const repositories = require('..');
const { runMongoUnitOfWork } = require('../../services/shared/mongoUnitOfWork');

const commerceRepository = {
  users: new MongoCollection('users'),
  companies: new MongoCollection('companies'),
  employees: new MongoCollection('companyEmployees'),
  categories: new MongoCollection('categories'),
  listings: new MongoCollection('listings'),
  routes: new MongoCollection('routes'),
  routeStops: new MongoCollection('routeStops'),
  fareProducts: new MongoCollection('fareProducts'),
  segmentFares: new MongoCollection('busSegmentFares'),
  serviceAddons: new MongoCollection('serviceAddons'),
  vehicles: new MongoCollection('vehicles'),
  schedules: new MongoCollection('schedules'),
  seats: new MongoCollection('seats'),
  hotelProperties: new MongoCollection('hotelProperties'),
  roomTypes: new MongoCollection('roomTypes'),
  roomUnits: new MongoCollection('roomUnits'),
  roomNights: new MongoCollection('roomNightInventories'),
  carts: new MongoCollection('carts'),
  holds: new MongoCollection('inventoryHolds'),
  holdItems: new MongoCollection('inventoryHoldItems'),
  bookings: new MongoCollection('bookings'),
  bookingGroups: new MongoCollection('bookingGroups'),
  passengers: new MongoCollection('passengers'),
  payments: new MongoCollection('payments'),
  paymentIntents: new MongoCollection('paymentIntents'),
  webhookEvents: new MongoCollection('paymentWebhookEvents'),
  checkoutAttempts: new MongoCollection('cartCheckoutAttempts'),
  refunds: new MongoCollection('refundRequests'),
  reschedules: new MongoCollection('rescheduleRequests'),
  commissions: new MongoCollection('commissions'),
  wallets: new MongoCollection('wallets'),
  transactions: new MongoCollection('walletTransactions'),
  promoterLinks: new MongoCollection('promoterLinks'),
  attributionSessions: new MongoCollection('attributionSessions'),
  conversions: new MongoCollection('campaignConversions'),
  timelineEvents: new MongoCollection('bookingTimelineEvents'),
  correspondence: new MongoCollection('correspondenceMessages'),
  notifications: new MongoCollection('notifications'),
  outboxEvents: new MongoCollection('outboxEvents'),
  auditLogs: new MongoCollection('auditLogs'),
};

async function withTransaction(work) {
  return runMongoUnitOfWork(work);
}

module.exports = { ...commerceRepository, withTransaction };
