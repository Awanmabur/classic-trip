const repositories = require('../../repositories');
const { env } = require('../../config/env');
const redisRuntime = require('../../config/redis');
const { runMongoRead } = require('../data/mongoReadGate');

const SNAPSHOT_TTL_MS = Math.max(1000, Number(env.performance.dashboardCacheTtlMs || 60000));
const SNAPSHOT_STALE_MS = Math.max(SNAPSHOT_TTL_MS, Number(env.performance.dashboardCacheStaleMs || 300000));
const DB_READ_CONCURRENCY = Math.max(
  2,
  Math.min(
    12,
    Number(env.performance.dashboardReadConcurrency || 4),
    // Reserve connections for sessions, authentication, cache invalidation and
    // the request currently coordinating this snapshot.
    Math.max(2, Number(env.mongoPool?.max || 10) - 4),
  ),
);
const snapshotCache = new Map();
const snapshotInflight = new Map();
const dashboardHeadCache = new Map();
const DASHBOARD_HEAD_TTL_MS = 60_000;
const ALL_ENTITIES = [...new Set(Object.keys(repositories.entityModelMap))]
  .filter((key) => !['notificationTemplates', 'serviceCategories', 'tripSchedules', 'holds', 'inventoryHolds', 'walletLedgerEntries', 'campaigns', 'refunds', 'blogPosts'].includes(key));

const COMPANY_SCOPED = new Set([
  'companyEmployees','companyBranches','companyPolicies','listings','routes','routeStops','routeSegments','vehicles','seatMapTemplates','seatMapVersions','fareProducts','busSegmentFares','serviceAddons','schedules','scheduleRules','seats','busSeatSegmentInventories',
  'places','airlines','flightSuppliers','aircraft','flightSeatMapVersions','flightRoutes','flightFareFamilies','flightDepartures','flightSeatInventories','flightOffers','flightOrders','flightTravelers','flightSeatAssignments','flightTickets','flightAncillaries','flightScheduleChanges','flightAgentQuotes','flightChangeRequests','flightRefundRequests',
  'vehicleClasses','taxiVehicles','taxiDriverProfiles','taxiServiceZones','taxiFareRules','driverAvailabilities','driverLocations','rideQuotes','rideRequests','taxiRides','rideAssignments','rideEvents','taxiIncidents','driverEarnings',
  'driverAssignments','driverIncidents','tripStatusUpdates','hotelProperties','roomTypes','roomUnits','roomNightInventories','ratePlans','hotelReservations','hotelGuests','roomAssignments','housekeepingTasks','maintenanceBlocks',
  'stayRules','bookings','bookingItems','busReservations','busSeatAssignments','busTickets','bookingGroups','payments','supportTickets','refundRequests','promotionCampaigns','reviews','notifications',
  'shiftHandovers','ticketScans','financeStatements','financeRiskReviews','settlementBatches','reconciliationReports','offlineSales',
  // Staff invitations and driver verification reviews are company-scoped workflow
  // records. They must be loaded with the dashboard snapshot so pending requests
  // remain visible before a CompanyEmployee row exists.
  'invitations','verificationReviews',
]);

const COMPANY_SHARED_ENTITIES = new Set([
  'companyEmployees','companyBranches','companyPolicies','listings','places',
  'bookings','bookingItems','bookingGroups','payments','supportTickets','refundRequests',
  'promotionCampaigns','reviews','notifications','shiftHandovers','ticketScans',
  'financeStatements','financeRiskReviews','settlementBatches','reconciliationReports',
  'offlineSales','invitations','verificationReviews',
]);
const COMPANY_SERVICE_ENTITIES = Object.freeze({
  bus: new Set([
    'routes','routeStops','routeSegments','vehicles','seatMapTemplates','seatMapVersions',
    'fareProducts','busSegmentFares','serviceAddons','schedules','scheduleRules','seats',
    'busSeatSegmentInventories','driverAssignments','driverIncidents','tripStatusUpdates',
    'busReservations','busSeatAssignments','busTickets',
  ]),
  hotel: new Set([
    'hotelProperties','roomTypes','roomUnits','roomNightInventories','ratePlans',
    'hotelReservations','hotelGuests','roomAssignments','housekeepingTasks','maintenanceBlocks',
    'stayRules','serviceAddons',
  ]),
  flight: new Set([
    'airlines','flightSuppliers','aircraft','flightSeatMapVersions','flightRoutes',
    'flightFareFamilies','flightDepartures','flightSeatInventories','flightOffers','flightOrders',
    'flightTravelers','flightSeatAssignments','flightTickets','flightAncillaries',
    'flightScheduleChanges','flightAgentQuotes','flightChangeRequests','flightRefundRequests',
  ]),
  local_transport: new Set([
    'vehicleClasses','taxiVehicles','taxiDriverProfiles','taxiServiceZones','taxiFareRules',
    'driverAvailabilities','driverLocations','rideQuotes','rideRequests','taxiRides',
    'rideAssignments','rideEvents','taxiIncidents','driverEarnings',
  ]),
});
const COMPANY_PAGE_ENTITIES = Object.freeze({
  archive: new Set(['notifications']),
  overview: new Set([
    'companyEmployees', 'companyBranches', 'invitations', 'verificationReviews',
    'listings', 'routes', 'vehicles', 'fareProducts', 'schedules',
    'bookings', 'payments', 'supportTickets', 'reviews', 'notifications',
    'hotelProperties', 'roomTypes', 'roomUnits',
    'hotelReservations', 'housekeepingTasks',
    'aircraft', 'flightDepartures', 'flightOrders',
    'taxiVehicles', 'taxiDriverProfiles', 'driverAvailabilities', 'taxiRides',
    'wallets', 'walletTransactions', 'commissions',
  ]),
  'company-profile': new Set([
    'companyBranches', 'companyPolicies', 'listings', 'notifications',
  ]),
  staff: new Set([
    'companyEmployees', 'invitations', 'verificationReviews', 'notifications',
  ]),
  listings: new Set([
    'categories', 'companyBranches', 'companyEmployees', 'invitations',
    'verificationReviews', 'listings', 'routes', 'vehicles', 'schedules', 'hotelProperties',
    'roomTypes', 'airlines', 'aircraft', 'flightRoutes', 'vehicleClasses',
    'taxiVehicles', 'taxiDriverProfiles', 'notifications',
  ]),
  routes: new Set([
    'companyBranches', 'listings', 'routes', 'routeStops', 'routeSegments',
    'places', 'fareProducts', 'busSegmentFares', 'notifications',
  ]),
  vehicles: new Set([
    'companyEmployees', 'listings', 'vehicles', 'seatMapTemplates',
    'seatMapVersions', 'notifications',
  ]),
  'seat-maps': new Set([
    'listings', 'routes', 'vehicles', 'seatMapTemplates', 'seatMapVersions',
    'schedules', 'seats', 'bookings', 'notifications',
  ]),
  schedules: new Set([
    'companyEmployees', 'invitations', 'verificationReviews', 'listings', 'routes',
    'routeStops', 'routeSegments', 'vehicles', 'seatMapTemplates',
    'seatMapVersions', 'fareProducts', 'busSegmentFares', 'serviceAddons',
    'schedules', 'scheduleRules',
    'driverAssignments', 'driverIncidents', 'tripStatusUpdates', 'notifications',
  ]),
  'hotel-rooms': new Set([
    'companyBranches', 'listings', 'hotelProperties', 'roomTypes', 'roomUnits',
    'roomNightInventories', 'ratePlans', 'stayRules', 'hotelReservations',
    'hotelGuests', 'roomAssignments', 'housekeepingTasks', 'maintenanceBlocks',
    'notifications',
  ]),
  bookings: new Set([
    'listings', 'routes', 'routeStops', 'vehicles', 'fareProducts',
    'busSegmentFares', 'serviceAddons', 'schedules', 'seats',
    'busSeatSegmentInventories', 'bookings', 'bookingItems', 'bookingGroups',
    'payments', 'passengers', 'busReservations', 'busSeatAssignments',
    'busTickets', 'hotelProperties', 'roomTypes', 'roomUnits',
    'roomNightInventories', 'ratePlans', 'hotelReservations', 'hotelGuests',
    'roomAssignments', 'flightDepartures', 'flightFareFamilies',
    'flightSeatInventories', 'flightOrders', 'flightTravelers', 'flightTickets',
    'taxiRides', 'receiptInvoices', 'bookingTimelineEvents', 'notifications',
  ]),
  manifests: new Set([
    'companyEmployees', 'listings', 'routes', 'routeStops', 'vehicles',
    'bookings', 'passengers', 'schedules', 'seats', 'ticketScans',
    'busReservations', 'busSeatAssignments', 'busTickets', 'hotelReservations',
    'hotelGuests', 'roomAssignments', 'roomTypes', 'roomUnits', 'notifications',
  ]),
  checkins: new Set([
    'companyEmployees', 'listings', 'routes', 'routeStops', 'vehicles',
    'bookings', 'passengers', 'schedules', 'seats', 'ticketScans',
    'busReservations', 'busSeatAssignments', 'busTickets', 'hotelReservations',
    'hotelGuests', 'roomAssignments', 'notifications',
  ]),
  support: new Set([
    'listings', 'routes', 'schedules', 'hotelReservations', 'flightOrders',
    'taxiRides', 'bookings', 'payments', 'passengers', 'supportTickets',
    'refundRequests', 'rescheduleRequests', 'correspondenceMessages',
    'bookingTimelineEvents', 'notificationDeliveryAttempts', 'notifications',
  ]),
  reviews: new Set(['listings', 'reviews', 'notifications']),
  ads: new Set(['listings', 'promotionCampaigns', 'promoterLinks', 'notifications']),
  finance: new Set([
    'listings', 'bookings', 'payments', 'refundRequests', 'wallets',
    'walletTransactions', 'commissions', 'paymentIntents', 'receiptInvoices',
    'taxFeeRecords', 'financeStatements', 'financeRiskReviews', 'settlementBatches',
    'reconciliationReports', 'offlineSales', 'notifications',
  ]),
  flight: new Set([
    'listings', 'bookings', 'payments', 'supportTickets', 'notifications',
    'airports', 'aircraftTypes',
    ...COMPANY_SERVICE_ENTITIES.flight,
  ]),
  mobility: new Set([
    'companyEmployees', 'invitations', 'verificationReviews', 'listings',
    'bookings', 'payments', 'supportTickets', 'reviews', 'notifications',
    ...COMPANY_SERVICE_ENTITIES.local_transport,
  ]),
  employee: new Set([
    'companyEmployees', 'listings', 'bookings', 'payments', 'supportTickets',
    'refundRequests', 'notifications', 'shiftHandovers',
  ]),
});
const COMPANY_PAGE_ALIASES = Object.freeze({
  revenue: 'finance', settlement: 'finance', payouts: 'finance', reports: 'finance',
  'flight-search': 'flight', 'flight-quotes': 'flight', 'flight-travelers': 'flight',
  'flight-tickets': 'flight', 'flight-changes': 'flight', 'flight-refunds': 'flight',
  'taxi-fleet': 'mobility', 'taxi-drivers': 'mobility', 'taxi-availability': 'mobility',
  'taxi-operations': 'mobility', 'taxi-incidents': 'mobility',
  schedule: 'schedules', inventory: 'seat-maps', checkin: 'checkins',
  'driver-manifest': 'manifests', 'driver-ops': 'schedules',
  'driver-incidents': 'schedules', customers: 'bookings', payments: 'finance',
  refunds: 'support', handover: 'employee', profile: 'company-profile',
});

// Admin pages used to read every collection in the application before rendering,
// even when the open page only needed bookings or support records. Keep the small
// shell data available everywhere, then add only the domain used by the active page.
const ADMIN_SHELL_ENTITIES = new Set([
  'companies', 'notifications', 'platformSettings',
]);
const ADMIN_OVERVIEW_ENTITIES = new Set([
  'users', 'listings', 'routes', 'schedules', 'bookings', 'walletTransactions',
  'supportTickets', 'auditLogs',
]);
const ADMIN_ENTITY_GROUPS = Object.freeze({
  archive: new Set([]),
  identity: new Set([
    'users', 'companies', 'companyEmployees', 'companyBranches', 'companyPolicies',
    'invitations', 'verificationReviews', 'partnerLeads', 'discoverySessions',
    'agreements', 'securityEvents', 'loginAudits', 'deviceSessions', 'auditLogs',
  ]),
  booking: new Set([
    'users', 'companies', 'listings', 'bookings', 'bookingGroups', 'bookingItems',
    'passengers', 'payments', 'refundRequests', 'rescheduleRequests', 'supportTickets',
    'correspondenceMessages', 'bookingTimelineEvents', 'notificationDeliveryAttempts',
    'ticketScans', 'busReservations', 'busSeatAssignments', 'busTickets',
  ]),
  inventory: new Set([
    'companies', 'categories', 'listings', 'routes', 'routeStops', 'routeSegments',
    'vehicles', 'seatMapTemplates', 'seatMapVersions', 'fareProducts', 'busSegmentFares',
    'serviceAddons', 'schedules', 'scheduleRules', 'seats', 'busSeatSegmentInventories',
    'hotelProperties', 'roomTypes', 'roomUnits', 'roomNightInventories', 'ratePlans',
    'maintenanceBlocks',
  ]),
  finance: new Set([
    'users', 'companies', 'listings', 'bookings', 'payments', 'paymentWebhookEvents',
    'refundRequests', 'wallets', 'walletTransactions', 'paymentIntents', 'receiptInvoices',
    'taxFeeRecords', 'financeStatements', 'financeRiskReviews', 'settlementBatches',
    'payoutRequests', 'payoutBatches', 'reconciliationReports', 'commissions',
  ]),
  support: new Set([
    'users', 'companies', 'listings', 'bookings', 'payments', 'supportTickets',
    'refundRequests', 'rescheduleRequests', 'correspondenceMessages',
    'bookingTimelineEvents', 'notificationDeliveryAttempts', 'shiftHandovers',
  ]),
  content: new Set([
    'companies', 'categories', 'listings', 'promotionCampaigns', 'blogs', 'reviews',
    'auditLogs',
  ]),
  promoter: new Set([
    'users', 'companies', 'listings', 'bookings', 'promoterLinks', 'referralClicks',
    'attributionSessions', 'campaignConversions', 'agentProfiles', 'offlineSales',
    'fraudSignals', 'commissions', 'wallets', 'walletTransactions', 'payoutRequests',
    'payoutBatches', 'supportTickets',
  ]),
  flight: new Set([
    'users', 'companies', 'companyEmployees', 'listings', 'bookings', 'places',
    'airports', 'airlines', 'flightSuppliers', 'aircraftTypes', 'aircraft',
    'flightSeatMapVersions', 'flightRoutes', 'flightFareFamilies', 'flightDepartures',
    'flightSeatInventories', 'flightOffers', 'flightOrders', 'flightTravelers',
    'flightSeatAssignments', 'flightTickets', 'flightAncillaries',
    'flightScheduleChanges', 'flightAgentQuotes', 'flightChangeRequests',
    'flightRefundRequests',
  ]),
  mobility: new Set([
    'users', 'companies', 'companyEmployees', 'listings', 'bookings', 'vehicleClasses',
    'taxiVehicles', 'taxiDriverProfiles', 'taxiServiceZones', 'taxiFareRules',
    'driverAvailabilities', 'driverLocations', 'rideQuotes', 'rideRequests',
    'taxiRides', 'rideAssignments', 'rideEvents', 'taxiIncidents', 'driverEarnings',
    'verificationReviews',
  ]),
  system: new Set([
    'users', 'companies', 'bookings', 'payments', 'notifications', 'supportTickets',
    'auditLogs', 'securityEvents', 'loginAudits', 'deviceSessions',
    'idempotencyKeyRecords', 'outboxEvents', 'rateLimitCounters',
  ]),
});
const ADMIN_PAGE_GROUP = Object.freeze({
  archive: 'archive',
  partners: 'identity', admins: 'identity', kyc: 'identity',
  bookings: 'booking', customers: 'booking', refunds: 'booking',
  support: 'support', notifications: 'support', handover: 'support',
  listings: 'inventory', routes: 'inventory', vehicles: 'inventory',
  schedules: 'inventory', schedule: 'inventory', inventory: 'inventory',
  'seat-maps': 'inventory', 'hotel-rooms': 'inventory',
  'bus-dashboard': 'inventory', 'hotel-dashboard': 'inventory',
  'tour-dashboard': 'inventory', 'rental-dashboard': 'inventory',
  'cargo-dashboard': 'inventory',
  payments: 'finance', audit: 'finance', reports: 'finance',
  revenue: 'finance', settlement: 'finance', payouts: 'finance',
  promoters: 'promoter',
  ads: 'content', blogs: 'content', reviews: 'content',
  'flight-dashboard': 'flight', 'flight-agents': 'flight',
  'taxi-dashboard': 'mobility', 'boda-riders': 'mobility', 'car-drivers': 'mobility',
  'fleet-owners': 'mobility', 'mobility-companies': 'mobility',
  'mobility-drivers': 'mobility', 'mobility-vehicles': 'mobility',
  'mobility-dispatch': 'mobility', 'mobility-safety': 'mobility',
  system: 'system', settings: 'system',
  'driver-ops': 'inventory', 'driver-manifest': 'booking',
  'driver-incidents': 'inventory', checkin: 'booking',
});

function adminEntitiesFor(context = {}) {
  const page = String(context.activePage || 'overview').trim().toLowerCase();
  const pageEntities = ['overview', 'analytics'].includes(page)
    ? ADMIN_OVERVIEW_ENTITIES
    : (ADMIN_ENTITY_GROUPS[ADMIN_PAGE_GROUP[page]] || ADMIN_OVERVIEW_ENTITIES);
  return [...new Set([...ADMIN_SHELL_ENTITIES, ...pageEntities])]
    .filter((entity) => ALL_ENTITIES.includes(entity) && repositories[entity]);
}

function companyServiceType(company = {}) {
  const type = String(company.companyType || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return COMPANY_SERVICE_ENTITIES[type] ? type : '';
}

function desiredCompanyEntities(company = {}, context = {}) {
  const type = companyServiceType(company);
  const available = type
    ? new Set([...COMPANY_SHARED_ENTITIES, ...COMPANY_SERVICE_ENTITIES[type]])
    : COMPANY_SCOPED;
  if (!context.activePage) return new Set(available);
  const page = String(context.activePage || 'overview').trim().toLowerCase();
  const pageKey = COMPANY_PAGE_ALIASES[page] || page;
  const requested = new Set(COMPANY_PAGE_ENTITIES[pageKey] || COMPANY_PAGE_ENTITIES.overview);
  if (['employee', 'driver'].includes(context.dashboardRole)) {
    COMPANY_PAGE_ENTITIES.employee.forEach((entity) => requested.add(entity));
  }
  return new Set([...requested].filter((entity) => available.has(entity) || !COMPANY_SCOPED.has(entity)));
}

function scopedCompanyEntities(company = {}, context = {}) {
  const desired = desiredCompanyEntities(company, context);
  return [...desired].filter((entity) => COMPANY_SCOPED.has(entity));
}

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function emptySnapshot() {
  const snapshot = {};
  for (const key of ALL_ENTITIES) snapshot[key] = key === 'platformSettings' ? {} : [];
  snapshot.platformSettings = {};
  return snapshot;
}

const DASHBOARD_SAFE_SELECT = Object.freeze({
  users: '-passwordHash -passwordResetTokenHash -emailVerificationTokenHash -mfaSecretEncrypted -mfaRecoveryCodeHashes -refreshTokenHash',
  payments: '-rawPayload -providerPayload -providerResponse -webhookPayload',
  bookings: '-qrCodeDataUrl -ticketPdfBuffer -voucherPdfBuffer -rawPaymentPayload',
  notifications: '-providerPayload -deliveryPayload',
  auditLogs: '-requestBody -responseBody',
});

async function list(entity, filter = {}, limitOrOptions = 2500) {
  const options = typeof limitOrOptions === 'number'
    ? { limit: limitOrOptions }
    : (limitOrOptions || {});
  const limit = Math.max(1, Number(options.limit || 2500));
  const sort = options.sort || { createdAt: -1 };
  const select = options.select || DASHBOARD_SAFE_SELECT[entity] || '';
  const repository = repositories.readyRepository(entity);
  return runMongoRead(() => repository.list(filter, { sort, limit, ...(select ? { select } : {}) }));
}

async function one(entity, filter = {}) {
  const repository = repositories.readyRepository(entity);
  return runMongoRead(() => repository.findOne(filter));
}

async function cachedHeadOne(cacheKeyValue, entity, filter = {}) {
  const cached = dashboardHeadCache.get(cacheKeyValue);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) dashboardHeadCache.delete(cacheKeyValue);
  const value = await one(entity, filter);
  dashboardHeadCache.set(cacheKeyValue, { value, expiresAt: Date.now() + DASHBOARD_HEAD_TTL_MS });
  while (dashboardHeadCache.size > 120) dashboardHeadCache.delete(dashboardHeadCache.keys().next().value);
  return value;
}

function companyEntityFilter(entity, companyId) {
  if (entity === 'bookings') {
    return { $or: [
      { companyId },
      { agentCompanyId: companyId },
      { providerCompanyId: companyId },
      { supplierId: companyId },
    ] };
  }
  if (entity === 'notifications') {
    return { $or: [
      { ownerType: 'company', ownerId: companyId },
      { audience: 'partners', ownerId: companyId },
    ] };
  }
  if (['flightAgentQuotes', 'flightChangeRequests', 'flightRefundRequests'].includes(entity)) {
    return { agentCompanyId: companyId };
  }
  if (entity === 'flightOrders') {
    return { $or: [{ companyId }, { agentCompanyId: companyId }] };
  }
  return { companyId };
}

function normalizedCompanyPage(context = {}) {
  const page = String(context.activePage || 'overview').trim().toLowerCase();
  return COMPANY_PAGE_ALIASES[page] || page;
}

function companyEntityQuery(entity, companyId, context = {}) {
  const base = companyEntityFilter(entity, companyId);
  const page = normalizedCompanyPage(context);
  const now = new Date();
  const recentCutoff = new Date(now.getTime() - (45 * 24 * 60 * 60 * 1000));
  const activePageLimit = context.activePage ? 80 : 300;
  const options = { limit: activePageLimit, sort: { createdAt: -1 } };
  let filter = base;

  if (entity === 'schedules') {
    if (page === 'seat-maps') {
      filter = { $and: [base, {
        departAt: { $gte: new Date(now.getTime() - (24 * 60 * 60 * 1000)) },
        status: { $in: ['active', 'published', 'boarding', 'delayed'] },
      }] };
      options.limit = 40;
      options.sort = { departAt: 1 };
    } else if (page === 'schedules') {
      filter = { $and: [base, {
        departAt: { $gte: recentCutoff },
        status: { $ne: 'archived' },
      }] };
      options.limit = 80;
      options.sort = { departAt: 1 };
    } else if (page === 'listings') {
      filter = { $and: [base, {
        departAt: { $gte: recentCutoff },
        status: { $ne: 'archived' },
      }] };
      options.limit = 160;
      options.sort = { departAt: 1 };
    } else if (page === 'overview') {
      filter = { $and: [base, { status: { $ne: 'archived' } }] };
      options.limit = 80;
      options.sort = { departAt: 1 };
    }
  } else if (entity === 'scheduleRules') {
    options.limit = page === 'schedules' ? 80 : 40;
    options.sort = { updatedAt: -1 };
  } else if (entity === 'notifications') {
    options.limit = 35;
  } else if (['companyEmployees', 'invitations', 'verificationReviews'].includes(entity)) {
    options.limit = ['staff', 'schedules', 'manifests', 'checkins', 'mobility'].includes(page) ? 100 : 40;
  } else if (['listings', 'routes', 'vehicles', 'fareProducts', 'busSegmentFares', 'serviceAddons'].includes(entity)) {
    options.limit = ['schedules', 'routes', 'vehicles', 'listings'].includes(page) ? 120 : 50;
  }
  return { filter, options };
}

async function mapWithConcurrency(items, worker, concurrency = DB_READ_CONCURRENCY) {
  const rows = [...items];
  const results = new Array(rows.length);
  let cursor = 0;
  async function run() {
    while (cursor < rows.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(rows[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, run));
  return results;
}

function ids(rows = [], key = 'id') {
  return [...new Set(rows.map((row) => {
    if (!row) return null;
    return key === 'id' ? (row.id || row._id) : row[key];
  }).filter(Boolean).map(String))];
}

async function adminSnapshot(context = {}) {
  const snapshot = emptySnapshot();
  const page = String(context.activePage || 'overview').trim().toLowerCase();
  const overview = ['overview', 'analytics'].includes(page);
  await mapWithConcurrency(adminEntitiesFor(context), async (entity) => {
    if (entity === 'platformSettings') {
      snapshot.platformSettings = await one('platformSettings', {}) || {};
      return;
    }
    if (!repositories[entity]) return;
    const options = { limit: overview ? 60 : 120, sort: { createdAt: -1 } };
    let filter = {};
    if (entity === 'notifications') options.limit = 40;
    if (entity === 'companies') options.limit = overview ? 80 : 160;
    if (entity === 'users') options.limit = ['partners', 'admins', 'kyc', 'customers', 'promoters'].includes(page) ? 160 : 80;
    if (entity === 'bookings') options.limit = overview ? 70 : 160;
    if (entity === 'payments') options.limit = page === 'payments' ? 160 : 80;
    if (entity === 'auditLogs') options.limit = page === 'audit' ? 160 : 60;
    if (entity === 'schedules') {
      filter = {
        status: { $ne: 'archived' },
        departAt: { $gte: new Date(Date.now() - (45 * 24 * 60 * 60 * 1000)) },
      };
      options.limit = overview ? 60 : 120;
      options.sort = { departAt: 1 };
    }
    if (entity === 'seats') options.limit = ['seat-maps', 'inventory'].includes(page) ? 1800 : 400;
    snapshot[entity] = await list(entity, filter, options);
  });
  return snapshot;
}

async function companySnapshot(companyId, context = {}) {
  const snapshot = emptySnapshot();
  const [company, platformSettings] = await Promise.all([
    cachedHeadOne(`company:${companyId}`, 'companies', { id: companyId }),
    cachedHeadOne('platform-settings', 'platformSettings', {}),
  ]);
  snapshot.companies = [company].filter(Boolean);
  snapshot.platformSettings = platformSettings || {};

  const desiredEntities = desiredCompanyEntities(snapshot.companies[0], context);
  const page = normalizedCompanyPage(context);
  const needsPeople = ['overview', 'staff', 'schedules', 'manifests', 'checkins', 'mobility', 'employee'].includes(page)
    || desiredEntities.has('companyEmployees')
    || desiredEntities.has('invitations')
    || desiredEntities.has('verificationReviews');
  const directEntities = scopedCompanyEntities(snapshot.companies[0], context).filter((entity) => repositories[entity]);
  const directTasks = [...directEntities];
  if (needsPeople) directTasks.push('__company_users__');
  await mapWithConcurrency(directTasks, async (entity) => {
    if (entity === '__company_users__') {
      snapshot.users = await list('users', { companyId }, { limit: 80, sort: { updatedAt: -1 } });
      return;
    }
    if (entity === 'seats') return;
    // Live seat maps need only bookings attached to the already-scoped dated
    // departures. Loading the company's entire booking history was one of the
    // largest causes of multi-minute page renders.
    if (normalizedCompanyPage(context) === 'seat-maps' && entity === 'bookings') return;
    const query = companyEntityQuery(entity, companyId, context);
    snapshot[entity] = await list(entity, query.filter, query.options);
  });

  // Membership is the authoritative tenant link. Include linked accounts even
  // when an older accepted invitation did not persist user.companyId.
  const linkedEmployeeUserIds = ids(snapshot.companyEmployees, 'userId');
  const linkedUsersPromise = linkedEmployeeUserIds.length
    ? list('users', { id: { $in: linkedEmployeeUserIds } }, 120)
    : Promise.resolve([]);

  const scheduleIds = ids(snapshot.schedules);
  if (normalizedCompanyPage(context) === 'seat-maps') {
    snapshot.bookings = scheduleIds.length ? await list('bookings', {
      $and: [
        companyEntityFilter('bookings', companyId),
        { $or: [
          { scheduleId: { $in: scheduleIds } },
          { 'ticketLegs.scheduleId': { $in: scheduleIds } },
          { 'bookingLegs.scheduleId': { $in: scheduleIds } },
          { 'bookingItems.scheduleId': { $in: scheduleIds } },
        ] },
      ],
    }, { sort: { createdAt: -1 }, limit: 240 }) : [];
  }

  const listingIds = ids(snapshot.listings);
  const bookingRefs = ids(snapshot.bookings, 'bookingRef');
  const bookingIds = ids(snapshot.bookings);
  const serviceType = companyServiceType(snapshot.companies[0]);

  const seatLimit = page === 'seat-maps'
    ? Math.max(1800, Math.min(6000, Math.max(1, scheduleIds.length) * 120))
    : page === 'bookings' ? 900 : 400;
  const relatedTasks = [
    ['categories', {}, 250],
    ['seats', scheduleIds.length ? { $or: [
      { scheduleId: { $in: scheduleIds } },
      { departureId: { $in: scheduleIds } },
      { tripScheduleId: { $in: scheduleIds } },
    ] } : { scheduleId: '__none__' }, seatLimit],
    ['passengers', bookingIds.length ? { bookingId: { $in: bookingIds } } : { bookingId: '__none__' }, page === 'bookings' ? 400 : 160],
    ['wallets', { ownerType: 'company', ownerId: companyId }, 30],
    ['walletTransactions', { ownerType: 'company', ownerId: companyId }, 180],
    ['commissions', { companyId }, 180],
    ['cartCheckoutAttempts', bookingRefs.length ? { bookingRef: { $in: bookingRefs } } : { bookingRef: '__none__' }, 240],
    ['paymentIntents', bookingRefs.length ? { bookingRef: { $in: bookingRefs } } : { bookingRef: '__none__' }, 240],
    ['receiptInvoices', bookingRefs.length ? { bookingRef: { $in: bookingRefs } } : { bookingRef: '__none__' }, 240],
    ['taxFeeRecords', bookingRefs.length ? { bookingRef: { $in: bookingRefs } } : { bookingRef: '__none__' }, 240],
    ['bookingTimelineEvents', bookingRefs.length ? { bookingRef: { $in: bookingRefs } } : { bookingRef: '__none__' }, 160],
    ['correspondenceMessages', { companyId }, 180],
    ['notificationDeliveryAttempts', { companyId }, 180],
    ['promoterLinks', listingIds.length ? { listingId: { $in: listingIds } } : { listingId: '__none__' }, 180],
  ].filter(([entity]) => !context.activePage || desiredEntities.has(entity));
  const relatedPromise = mapWithConcurrency(relatedTasks, async ([entity, filter, limit]) => {
    if (repositories[entity]) snapshot[entity] = await list(entity, filter, limit);
  });
  const linkedUsers = await linkedUsersPromise;
  if (linkedUsers.length) {
    const mergedUsers = new Map(snapshot.users.map((user) => [String(user.id || user._id || ''), user]));
    linkedUsers.forEach((user) => mergedUsers.set(String(user.id || user._id || ''), user));
    snapshot.users = [...mergedUsers.values()];
  }
  await relatedPromise;
  if (serviceType === 'flight' && (!context.activePage || desiredEntities.has('airports') || desiredEntities.has('aircraftTypes'))) {
    snapshot.airports = await list('airports', { status: 'active' }, 2000);
    snapshot.aircraftTypes = await list('aircraftTypes', { status: 'active' }, 300);
  }
  return snapshot;
}

async function customerSnapshot(context = {}) {
  const snapshot = emptySnapshot();
  const page = String(context.activePage || 'overview').trim().toLowerCase();
  const customerId = context.customerId;
  const user = await one('users', { id: customerId });
  snapshot.users = [user].filter(Boolean);

  snapshot.notifications = await list('notifications', {
    $or: [{ customerId }, { userId: customerId }, { audience: 'customer' }],
  }, { limit: 40, sort: { createdAt: -1 } });

  const bookingPages = new Set(['overview', 'bookings', 'ticket', 'passengers', 'receipts', 'refunds', 'support', 'reviews', 'wallet']);
  const ownership = [{ customerUserId: customerId }];
  if (user?.email) ownership.push({ 'guestSnapshot.email': String(user.email).toLowerCase() });
  if (user?.phone) ownership.push({ 'guestSnapshot.phone': user.phone });
  snapshot.bookings = bookingPages.has(page)
    ? await list('bookings', { $or: ownership }, { limit: page === 'overview' ? 80 : 160, sort: { createdAt: -1 } })
    : [];

  const bookingRefs = ids(snapshot.bookings, 'bookingRef');
  const bookingIds = ids(snapshot.bookings);
  const listingIds = ids(snapshot.bookings, 'listingId');
  const companyIds = ids(snapshot.bookings, 'companyId');
  const tasks = [];
  if (bookingPages.has(page)) {
    tasks.push(
      ['listings', listingIds.length ? { id: { $in: listingIds } } : { id: '__none__' }, 160],
      ['companies', companyIds.length ? { id: { $in: companyIds } } : { id: '__none__' }, 120],
    );
  }
  if (['overview', 'bookings', 'ticket', 'passengers'].includes(page)) {
    tasks.push(['passengers', bookingIds.length ? { bookingId: { $in: bookingIds } } : { bookingId: '__none__' }, 160]);
  }
  if (['overview', 'bookings', 'ticket', 'receipts', 'wallet'].includes(page)) {
    tasks.push(['payments', bookingRefs.length ? { bookingRef: { $in: bookingRefs } } : { bookingRef: '__none__' }, 120]);
  }
  if (['overview', 'refunds'].includes(page)) {
    tasks.push(
      ['refundRequests', bookingRefs.length ? { bookingRef: { $in: bookingRefs } } : { bookingRef: '__none__' }, 160],
      ['rescheduleRequests', bookingRefs.length ? { bookingRef: { $in: bookingRefs } } : { bookingRef: '__none__' }, 160],
    );
  }
  if (['overview', 'reviews'].includes(page)) tasks.push(['reviews', { customerUserId: customerId }, 120]);
  if (['overview', 'saved'].includes(page)) tasks.push(['savedListings', { userId: customerId }, 160]);
  if (['overview', 'support'].includes(page)) {
    tasks.push(['supportTickets', {
      $or: [{ ownerId: customerId }, { customerUserId: customerId }, ...(bookingRefs.length ? [{ bookingRef: { $in: bookingRefs } }] : [])],
    }, 220]);
  }
  if (['overview', 'wallet'].includes(page)) tasks.push(['wallets', { ownerType: 'customer', ownerId: customerId }, 20]);
  if (['bookings', 'ticket', 'receipts'].includes(page)) {
    tasks.push(['receiptInvoices', bookingRefs.length ? { bookingRef: { $in: bookingRefs } } : { bookingRef: '__none__' }, 120]);
  }
  if (['bookings', 'ticket', 'support'].includes(page)) {
    tasks.push(['bookingTimelineEvents', bookingRefs.length ? { bookingRef: { $in: bookingRefs } } : { bookingRef: '__none__' }, 220]);
  }
  if (page === 'support') tasks.push(['correspondenceMessages', bookingRefs.length ? { bookingRef: { $in: bookingRefs } } : { bookingRef: '__none__' }, 120]);
  if (page === 'security') {
    tasks.push(
      ['deviceSessions', { userId: customerId }, 80],
      ['securityEvents', { actorId: customerId }, 120],
    );
  }
  await mapWithConcurrency(tasks, async ([entity, filter, limit]) => {
    if (repositories[entity]) snapshot[entity] = await list(entity, filter, limit);
  });

  // Saved trips may not be part of a booking yet, so resolve their listing cards separately.
  if (page === 'saved') {
    const savedListingIds = ids(snapshot.savedListings, 'listingId');
    snapshot.listings = savedListingIds.length
      ? await list('listings', { id: { $in: savedListingIds }, status: { $ne: 'archived' } }, 160)
      : [];
  }
  return snapshot;
}

async function promoterSnapshot(context = {}) {
  const snapshot = emptySnapshot();
  const promoterId = context.promoterId;
  const page = String(context.activePage || 'overview').trim().toLowerCase();
  snapshot.users = [await one('users', { id: promoterId })].filter(Boolean);
  snapshot.notifications = await list('notifications', {
    $or: [{ promoterId }, { userId: promoterId }, { audience: 'promoter' }],
  }, { limit: 40, sort: { createdAt: -1 } });

  const campaignPages = new Set(['overview', 'links', 'share', 'campaigns', 'bus-dashboard', 'hotel-dashboard', 'tour-dashboard', 'rental-dashboard', 'cargo-dashboard', 'offline-sales']);
  const performancePages = new Set(['overview', 'performance', 'fraud']);
  const moneyPages = new Set(['overview', 'commissions', 'withdrawals', 'payouts']);
  const tasks = [];
  if (campaignPages.has(page)) tasks.push(['promoterLinks', { promoterId }, page === 'overview' ? 120 : 300]);
  if (performancePages.has(page)) {
    tasks.push(
      ['referralClicks', { promoterId }, page === 'overview' ? 160 : 400],
      ['attributionSessions', { promoterId }, page === 'overview' ? 160 : 400],
      ['campaignConversions', { promoterId }, page === 'overview' ? 160 : 400],
    );
  }
  if (['overview', 'offline-sales'].includes(page)) tasks.push(['agentProfiles', { $or: [{ userId: promoterId }, { promoterId }] }, 20]);
  if (page === 'offline-sales') tasks.push(['offlineSales', { $or: [{ promoterId }, { agentId: promoterId }] }, 300]);
  if (page === 'fraud') tasks.push(['fraudSignals', { $or: [{ promoterId }, { agentId: promoterId }] }, 300]);
  if (moneyPages.has(page)) {
    tasks.push(
      ['commissions', { promoterId }, page === 'overview' ? 160 : 360],
      ['wallets', { ownerType: 'promoter', ownerId: promoterId }, 20],
      ['walletTransactions', { ownerType: 'promoter', ownerId: promoterId }, page === 'overview' ? 120 : 300],
      ['payoutRequests', { ownerType: 'promoter', ownerId: promoterId }, page === 'overview' ? 80 : 240],
    );
  }
  if (page === 'support') tasks.push(['supportTickets', { $or: [{ ownerId: promoterId }, { promoterId }] }, 120]);
  await mapWithConcurrency(tasks, async ([entity, filter, limit]) => {
    if (repositories[entity]) snapshot[entity] = await list(entity, filter, limit);
  });

  const listingIds = ids(snapshot.promoterLinks, 'listingId');
  if (campaignPages.has(page)) {
    snapshot.listings = listingIds.length
      ? await list('listings', {
        id: { $in: listingIds },
        status: 'active',
        releaseStatus: 'published',
        $or: [{ serviceType: 'bus' }, { bookable: { $ne: false } }],
      }, page === 'overview' ? 120 : 300)
      : [];
    snapshot.companies = snapshot.listings.length
      ? await list('companies', { id: { $in: ids(snapshot.listings, 'companyId') } }, 160)
      : [];
    const activeListingIds = ids(snapshot.listings);
    snapshot.promotionCampaigns = activeListingIds.length
      ? await list('promotionCampaigns', { listingId: { $in: activeListingIds } }, 300)
      : [];
  }

  if (['overview', 'bookings'].includes(page)) {
    const bookingRefs = ids(snapshot.campaignConversions, 'bookingRef');
    snapshot.bookings = bookingRefs.length
      ? await list('bookings', { bookingRef: { $in: bookingRefs } }, page === 'overview' ? 120 : 300)
      : await list('bookings', { 'promoterAttribution.promoterId': promoterId }, page === 'overview' ? 120 : 300);
  }

  // Offline sale creation alone needs live operational inventory. Other promoter
  // pages no longer hydrate every route, schedule, room night and seat row.
  if (page === 'offline-sales' && snapshot.listings.length) {
    const activeListingIds = ids(snapshot.listings);
    const now = new Date();
    const related = [
      ['routes', { listingId: { $in: activeListingIds } }, 500],
      ['schedules', { listingId: { $in: activeListingIds }, departAt: { $gte: now }, status: { $nin: ['archived', 'cancelled', 'draft'] } }, 240],
      ['serviceAddons', { listingId: { $in: activeListingIds }, status: 'active' }, 160],
      ['hotelProperties', { listingId: { $in: activeListingIds }, status: 'active' }, 160],
      ['roomTypes', { listingId: { $in: activeListingIds }, status: 'active' }, 160],
      ['ratePlans', { listingId: { $in: activeListingIds }, status: 'active' }, 160],
      ['roomUnits', { listingId: { $in: activeListingIds }, status: { $nin: ['archived', 'maintenance'] } }, 500],
      ['roomNightInventories', { listingId: { $in: activeListingIds }, date: { $gte: now }, status: { $in: ['available', 'open'] } }, 900],
    ];
    await mapWithConcurrency(related, async ([entity, filter, limit]) => {
      if (repositories[entity]) snapshot[entity] = await list(entity, filter, limit);
    });
    const routeIds = ids(snapshot.routes);
    const scheduleIds = ids(snapshot.schedules);
    if (routeIds.length && repositories.routeStops) snapshot.routeStops = await list('routeStops', { routeId: { $in: routeIds }, status: { $ne: 'archived' } }, 1000);
    if (scheduleIds.length && repositories.seats) snapshot.seats = await list('seats', { scheduleId: { $in: scheduleIds } }, 3500);
    if (scheduleIds.length && repositories.busSeatSegmentInventories) snapshot.busSeatSegmentInventories = await list('busSeatSegmentInventories', { scheduleId: { $in: scheduleIds } }, 3500);
  }
  return snapshot;
}

function cacheKey(role, context = {}) {
  if (role === 'company' || role === 'employee' || role === 'driver') return `${role}:${context.companyId || ''}:${context.activePage || 'all'}`;
  if (role === 'customer') return `${role}:${context.customerId || ''}:${context.activePage || 'overview'}`;
  if (role === 'promoter') return `${role}:${context.promoterId || ''}:${context.activePage || 'overview'}`;
  return `${role}:${context.activePage || 'overview'}`;
}

async function loadFresh(role, context = {}) {
  if (role === 'admin' || ['support','finance','operations','content'].includes(role)) return adminSnapshot(context);
  if (role === 'company' || role === 'employee' || role === 'driver') return companySnapshot(context.companyId, { ...context, dashboardRole: role });
  if (role === 'customer') return customerSnapshot(context);
  if (role === 'promoter') return promoterSnapshot(context);
  return emptySnapshot();
}

function remember(key, value, createdAt = Date.now()) {
  // Repository rows are plain read models. Dashboard projections treat them as
  // immutable, so retaining the snapshot avoids cloning tens of thousands of
  // records on every navigation request.
  snapshotCache.set(key, { value, createdAt });
  while (snapshotCache.size > 96) snapshotCache.delete(snapshotCache.keys().next().value);
}

function sharedCacheKey(key) {
  return redisRuntime.key('dashboard-snapshot', key);
}

async function readSharedSnapshot(key) {
  const client = redisRuntime.activeClient();
  if (!client) return null;
  try {
    const encoded = await client.get(sharedCacheKey(key));
    if (!encoded) return null;
    const parsed = JSON.parse(encoded);
    if (!parsed || !parsed.value || !Number(parsed.createdAt)) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

async function writeSharedSnapshot(key, value, createdAt) {
  const client = redisRuntime.activeClient();
  if (!client) return;
  try {
    await client.set(
      sharedCacheKey(key),
      JSON.stringify({ createdAt, value }),
      { PX: SNAPSHOT_STALE_MS },
    );
  } catch (_) {}
}

async function refreshKey(key, role, context) {
  if (snapshotInflight.has(key)) return snapshotInflight.get(key);
  const promise = loadFresh(role, context)
    .then(async (value) => {
      const createdAt = Date.now();
      remember(key, value, createdAt);
      await writeSharedSnapshot(key, value, createdAt);
      return value;
    })
    .finally(() => snapshotInflight.delete(key));
  snapshotInflight.set(key, promise);
  return promise;
}

async function load(role, context = {}, options = {}) {
  const key = cacheKey(role, context);
  let cached = snapshotCache.get(key);
  if (!options.force && !cached) {
    const shared = await readSharedSnapshot(key);
    if (shared) {
      remember(key, shared.value, shared.createdAt);
      cached = snapshotCache.get(key);
    }
  }
  const age = cached ? Date.now() - cached.createdAt : Infinity;
  if (!options.force && cached && age <= SNAPSHOT_TTL_MS) return cached.value;
  // Stale-while-revalidate keeps dashboard navigation responsive while a short-lived
  // snapshot refresh runs in the background. Writes remain authoritative in MongoDB.
  if (!options.force && cached && age <= SNAPSHOT_STALE_MS) {
    refreshKey(key, role, context).catch(() => {});
    return cached.value;
  }
  try {
    return await refreshKey(key, role, context);
  } catch (error) {
    if (cached) return cached.value;
    throw error;
  }
}

async function invalidateSharedSnapshots(pattern) {
  const client = redisRuntime.activeClient();
  if (!client) return;
  try {
    const keys = [];
    for await (const found of client.scanIterator({ MATCH: pattern, COUNT: 100 })) {
      if (Array.isArray(found)) keys.push(...found);
      else keys.push(found);
      if (keys.length >= 100) {
        await client.sendCommand(['UNLINK', ...keys.splice(0, keys.length)]);
      }
    }
    if (keys.length) await client.sendCommand(['UNLINK', ...keys]);
  } catch (_) {}
}

function invalidate(role = '', context = {}) {
  if (!role) {
    snapshotCache.clear();
    dashboardHeadCache.clear();
    invalidateSharedSnapshots(`${sharedCacheKey('')}*`);
    return;
  }
  if (context.activePage) {
    // Page-scoped data writes must not evict the company/platform head records.
    // Those documents change only on profile/onboarding actions and otherwise
    // add two needless Atlas reads to every cold dashboard navigation.
    if (context.invalidateHead === true && context.companyId) dashboardHeadCache.delete(`company:${context.companyId}`);
    const exactKey = cacheKey(role, context);
    snapshotCache.delete(exactKey);
    invalidateSharedSnapshots(sharedCacheKey(exactKey));
    return;
  }
  if (context.companyId) dashboardHeadCache.delete(`company:${context.companyId}`);
  const prefix = role === 'company' || role === 'employee' || role === 'driver'
    ? `${role}:${context.companyId || ''}:`
    : `${role}:`;
  for (const key of snapshotCache.keys()) {
    if (key.startsWith(prefix)) snapshotCache.delete(key);
  }
  invalidateSharedSnapshots(`${sharedCacheKey(prefix)}*`);
}

async function prewarm(role = 'admin', context = {}) {
  return load(role, context, { force: true });
}

module.exports = { load, emptySnapshot, invalidate, prewarm, cacheKey };
