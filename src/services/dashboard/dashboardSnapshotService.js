const repositories = require('../../repositories');
const { env } = require('../../config/env');
const redisRuntime = require('../../config/redis');

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
    'listings', 'routes', 'vehicles', 'fareProducts', 'schedules', 'seats',
    'bookings', 'payments', 'supportTickets', 'reviews', 'notifications',
    'hotelProperties', 'roomTypes', 'roomUnits', 'roomNightInventories',
    'hotelReservations', 'housekeepingTasks',
    'aircraft', 'flightDepartures', 'flightSeatInventories', 'flightOrders',
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
    'verificationReviews', 'listings', 'routes', 'vehicles', 'hotelProperties',
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
    'schedules', 'seats', 'busSeatSegmentInventories', 'bookings', 'passengers',
    'busSeatAssignments', 'notifications',
  ]),
  schedules: new Set([
    'companyEmployees', 'invitations', 'verificationReviews', 'listings', 'routes',
    'routeStops', 'routeSegments', 'vehicles', 'seatMapTemplates',
    'seatMapVersions', 'fareProducts', 'busSegmentFares', 'serviceAddons',
    'schedules', 'scheduleRules', 'seats', 'busSeatSegmentInventories',
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
  'supportTickets', 'seats', 'auditLogs',
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

async function list(entity, filter = {}, limit = 2500) {
  const repository = repositories.readyRepository(entity);
  return repository.list(filter, { sort: { createdAt: -1 }, limit });
}

async function one(entity, filter = {}) {
  const repository = repositories.readyRepository(entity);
  return repository.findOne(filter);
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
  await mapWithConcurrency(adminEntitiesFor(context), async (entity) => {
    if (entity === 'platformSettings') {
      snapshot.platformSettings = await one('platformSettings', {}) || {};
      return;
    }
    if (!repositories[entity]) return;
    snapshot[entity] = await list(entity);
  });
  return snapshot;
}

async function companySnapshot(companyId, context = {}) {
  const snapshot = emptySnapshot();
  const [company, directUsers, platformSettings] = await Promise.all([
    one('companies', { id: companyId }),
    list('users', { companyId }, 500),
    one('platformSettings', {}),
  ]);
  snapshot.companies = [company].filter(Boolean);
  snapshot.users = directUsers;
  snapshot.platformSettings = platformSettings || {};

  const desiredEntities = desiredCompanyEntities(snapshot.companies[0], context);
  const directEntities = scopedCompanyEntities(snapshot.companies[0], context).filter((entity) => repositories[entity]);
  await mapWithConcurrency(directEntities, async (entity) => {
    if (entity === 'seats') return;
    snapshot[entity] = await list(entity, companyEntityFilter(entity, companyId));
  });

  // Membership is the authoritative tenant link. Include linked accounts even
  // when an older accepted invitation did not persist user.companyId.
  const linkedEmployeeUserIds = ids(snapshot.companyEmployees, 'userId');
  if (linkedEmployeeUserIds.length) {
    const linkedUsers = await list('users', { id: { $in: linkedEmployeeUserIds } }, 1000);
    const mergedUsers = new Map(snapshot.users.map((user) => [String(user.id || user._id || ''), user]));
    linkedUsers.forEach((user) => mergedUsers.set(String(user.id || user._id || ''), user));
    snapshot.users = [...mergedUsers.values()];
  }

  const listingIds = ids(snapshot.listings);
  const scheduleIds = ids(snapshot.schedules);
  const bookingRefs = ids(snapshot.bookings, 'bookingRef');
  const bookingIds = ids(snapshot.bookings);
  const serviceType = companyServiceType(snapshot.companies[0]);

  const relatedTasks = [
    ['categories', {}, 500],
    ['seats', scheduleIds.length ? { $or: [
      { scheduleId: { $in: scheduleIds } },
      { departureId: { $in: scheduleIds } },
      { tripScheduleId: { $in: scheduleIds } },
    ] } : { scheduleId: '__none__' }, 5000],
    ['passengers', bookingIds.length ? { bookingId: { $in: bookingIds } } : { bookingId: '__none__' }, 5000],
    ['wallets', { ownerType: 'company', ownerId: companyId }, 50],
    ['walletTransactions', { ownerType: 'company', ownerId: companyId }, 5000],
    ['commissions', { companyId }, 5000],
    ['cartCheckoutAttempts', bookingRefs.length ? { bookingRef: { $in: bookingRefs } } : { bookingRef: '__none__' }, 2000],
    ['paymentIntents', bookingRefs.length ? { bookingRef: { $in: bookingRefs } } : { bookingRef: '__none__' }, 2000],
    ['receiptInvoices', bookingRefs.length ? { bookingRef: { $in: bookingRefs } } : { bookingRef: '__none__' }, 2000],
    ['taxFeeRecords', bookingRefs.length ? { bookingRef: { $in: bookingRefs } } : { bookingRef: '__none__' }, 2000],
    ['bookingTimelineEvents', bookingRefs.length ? { bookingRef: { $in: bookingRefs } } : { bookingRef: '__none__' }, 5000],
    ['correspondenceMessages', { companyId }, 5000],
    ['notificationDeliveryAttempts', { companyId }, 5000],
    ['promoterLinks', listingIds.length ? { listingId: { $in: listingIds } } : { listingId: '__none__' }, 2000],
  ].filter(([entity]) => !context.activePage || desiredEntities.has(entity));
  await mapWithConcurrency(relatedTasks, async ([entity, filter, limit]) => {
    if (repositories[entity]) snapshot[entity] = await list(entity, filter, limit);
  });
  if (serviceType === 'flight' && (!context.activePage || desiredEntities.has('airports') || desiredEntities.has('aircraftTypes'))) {
    snapshot.airports = await list('airports', { status: 'active' }, 2000);
    snapshot.aircraftTypes = await list('aircraftTypes', { status: 'active' }, 500);
  }
  return snapshot;
}

async function customerSnapshot(context = {}) {
  const snapshot = emptySnapshot();
  const user = await one('users', { id: context.customerId });
  snapshot.users = [user].filter(Boolean);
  const ownership = [{ customerUserId: context.customerId }];
  if (user?.email) ownership.push({ 'guestSnapshot.email': String(user.email).toLowerCase() });
  if (user?.phone) ownership.push({ 'guestSnapshot.phone': user.phone });
  snapshot.bookings = await list('bookings', { $or: ownership }, 2000);
  const bookingRefs = ids(snapshot.bookings, 'bookingRef');
  const bookingIds = ids(snapshot.bookings);
  const listingIds = ids(snapshot.bookings, 'listingId');
  const companyIds = ids(snapshot.bookings, 'companyId');
  const tasks = [
    ['listings', listingIds.length ? { id: { $in: listingIds } } : { id: '__none__' }, 1000],
    ['companies', companyIds.length ? { id: { $in: companyIds } } : { id: '__none__' }, 1000],
    ['passengers', bookingIds.length ? { bookingId: { $in: bookingIds } } : { bookingId: '__none__' }, 5000],
    ['payments', bookingRefs.length ? { bookingRef: { $in: bookingRefs } } : { bookingRef: '__none__' }, 2000],
    ['refundRequests', bookingRefs.length ? { bookingRef: { $in: bookingRefs } } : { bookingRef: '__none__' }, 2000],
    ['rescheduleRequests', bookingRefs.length ? { bookingRef: { $in: bookingRefs } } : { bookingRef: '__none__' }, 2000],
    ['reviews', { customerUserId: context.customerId }, 2000],
    ['savedListings', { userId: context.customerId }, 2000],
    ['supportTickets', { $or: [{ ownerId: context.customerId }, { customerUserId: context.customerId }, ...(bookingRefs.length ? [{ bookingRef: { $in: bookingRefs } }] : [])] }, 2000],
    ['notifications', { $or: [{ customerId: context.customerId }, { userId: context.customerId }, { audience: 'customer' }] }, 2000],
    ['wallets', { ownerType: 'customer', ownerId: context.customerId }, 20],
    ['receiptInvoices', bookingRefs.length ? { bookingRef: { $in: bookingRefs } } : { bookingRef: '__none__' }, 2000],
    ['bookingTimelineEvents', bookingRefs.length ? { bookingRef: { $in: bookingRefs } } : { bookingRef: '__none__' }, 5000],
    ['correspondenceMessages', bookingRefs.length ? { bookingRef: { $in: bookingRefs } } : { bookingRef: '__none__' }, 5000],
    ['deviceSessions', { userId: context.customerId }, 200],
    ['securityEvents', { actorId: context.customerId }, 200],
  ];
  await mapWithConcurrency(tasks, async ([entity, filter, limit]) => { if (repositories[entity]) snapshot[entity] = await list(entity, filter, limit); });
  return snapshot;
}

async function promoterSnapshot(context = {}) {
  const snapshot = emptySnapshot();
  const promoterId = context.promoterId;
  snapshot.users = [await one('users', { id: promoterId })].filter(Boolean);
  const tasks = [
    ['promoterLinks', { promoterId }, 3000], ['referralClicks', { promoterId }, 5000], ['attributionSessions', { promoterId }, 5000],
    ['campaignConversions', { promoterId }, 5000], ['agentProfiles', { $or: [{ userId: promoterId }, { promoterId }] }, 50],
    ['offlineSales', { $or: [{ promoterId }, { agentId: promoterId }] }, 5000], ['fraudSignals', { $or: [{ promoterId }, { agentId: promoterId }] }, 5000],
    ['commissions', { promoterId }, 5000], ['wallets', { ownerType: 'promoter', ownerId: promoterId }, 50],
    ['walletTransactions', { ownerType: 'promoter', ownerId: promoterId }, 5000], ['payoutRequests', { ownerType: 'promoter', ownerId: promoterId }, 2000],
    ['supportTickets', { $or: [{ ownerId: promoterId }, { promoterId }] }, 2000], ['notifications', { $or: [{ promoterId }, { userId: promoterId }, { audience: 'promoter' }] }, 2000],
  ];
  await mapWithConcurrency(tasks, async ([entity, filter, limit]) => { if (repositories[entity]) snapshot[entity] = await list(entity, filter, limit); });
  const listingIds = ids(snapshot.promoterLinks, 'listingId');
  const bookingRefs = ids(snapshot.campaignConversions, 'bookingRef');
  snapshot.listings = listingIds.length ? await list('listings', { id: { $in: listingIds }, status: 'active', bookable: { $ne: false } }, 3000) : [];
  const activeListingIds = ids(snapshot.listings);
  snapshot.companies = snapshot.listings.length ? await list('companies', { id: { $in: ids(snapshot.listings, 'companyId') } }, 1000) : [];
  snapshot.bookings = bookingRefs.length ? await list('bookings', { bookingRef: { $in: bookingRefs } }, 5000) : await list('bookings', { 'promoterAttribution.promoterId': promoterId }, 5000);
  snapshot.promotionCampaigns = activeListingIds.length ? await list('promotionCampaigns', { listingId: { $in: activeListingIds } }, 2000) : [];

  // Offline sales use the same canonical inventory as public checkout. Load only
  // the operational records belonging to live listings already linked to this promoter.
  if (activeListingIds.length) {
    const related = [
      ['routes', { listingId: { $in: activeListingIds } }, 2000],
      ['schedules', { listingId: { $in: activeListingIds }, status: { $nin: ['archived', 'cancelled', 'draft'] } }, 3000],
      ['serviceAddons', { listingId: { $in: activeListingIds }, status: 'active' }, 2000],
      ['hotelProperties', { listingId: { $in: activeListingIds }, status: 'active' }, 500],
      ['roomTypes', { listingId: { $in: activeListingIds }, status: 'active' }, 2000],
      ['ratePlans', { listingId: { $in: activeListingIds }, status: 'active' }, 2000],
      ['roomUnits', { listingId: { $in: activeListingIds }, status: { $nin: ['archived', 'maintenance'] } }, 3000],
      ['roomNightInventories', { listingId: { $in: activeListingIds }, status: { $in: ['available', 'open'] } }, 5000],
    ];
    await mapWithConcurrency(related, async ([entity, filter, limit]) => {
      if (repositories[entity]) snapshot[entity] = await list(entity, filter, limit);
    });
    const routeIds = ids(snapshot.routes);
    const scheduleIds = ids(snapshot.schedules);
    if (routeIds.length && repositories.routeStops) snapshot.routeStops = await list('routeStops', { routeId: { $in: routeIds }, status: { $ne: 'archived' } }, 5000);
    if (scheduleIds.length && repositories.seats) snapshot.seats = await list('seats', { scheduleId: { $in: scheduleIds } }, 10000);
    if (scheduleIds.length && repositories.busSeatSegmentInventories) snapshot.busSeatSegmentInventories = await list('busSeatSegmentInventories', { scheduleId: { $in: scheduleIds } }, 10000);
  }
  return snapshot;
}

function cacheKey(role, context = {}) {
  if (role === 'company' || role === 'employee' || role === 'driver') return `${role}:${context.companyId || ''}:${context.activePage || 'all'}`;
  if (role === 'customer') return `${role}:${context.customerId || ''}`;
  if (role === 'promoter') return `${role}:${context.promoterId || ''}`;
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
  while (snapshotCache.size > 24) snapshotCache.delete(snapshotCache.keys().next().value);
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
    invalidateSharedSnapshots(`${sharedCacheKey('')}*`);
    return;
  }
  if (context.activePage) {
    const exactKey = cacheKey(role, context);
    snapshotCache.delete(exactKey);
    invalidateSharedSnapshots(sharedCacheKey(exactKey));
    return;
  }
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
