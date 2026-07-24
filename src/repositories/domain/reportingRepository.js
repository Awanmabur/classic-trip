const { MongoCollection } = require('./mongoCollection');

const entities = [
  'users', 'companies', 'companyEmployees', 'listings', 'routes', 'routeStops', 'vehicles',
  'schedules', 'seats', 'hotelProperties', 'roomTypes', 'roomUnits', 'roomNightInventories',
  'bookings', 'bookingGroups', 'payments', 'wallets', 'walletTransactions', 'commissions',
  'settlementBatches', 'payoutRequests', 'supportTickets', 'refundRequests', 'reviews',
  'notifications', 'promoterLinks', 'promotionCampaigns', 'campaignConversions', 'agentProfiles', 'offlineSales',
  'fraudSignals', 'auditLogs', 'savedListings', 'shiftHandovers', 'ticketScans',
];

module.exports = Object.fromEntries(entities.map((entity) => [entity, new MongoCollection(entity)]));
