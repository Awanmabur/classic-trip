const repositories = require('../../repositories');
const ALL_ENTITIES = [...new Set(Object.keys(repositories.entityModelMap))]
  .filter((key) => !['notificationTemplates', 'serviceCategories', 'tripSchedules', 'holds', 'inventoryHolds', 'walletLedgerEntries', 'campaigns', 'refunds', 'blogPosts'].includes(key));

const COMPANY_SCOPED = new Set([
  'companyEmployees','companyBranches','companyPolicies','listings','routes','routeStops','routeSegments','vehicles','seatMapTemplates','seatMapVersions','fareProducts','busSegmentFares','serviceAddons','schedules','seats','busSeatSegmentInventories',
  'driverAssignments','driverIncidents','tripStatusUpdates','hotelProperties','roomTypes','roomUnits','roomNightInventories','ratePlans','hotelReservations','hotelGuests','roomAssignments','housekeepingTasks','maintenanceBlocks',
  'stayRules','bookings','bookingItems','busReservations','busSeatAssignments','busTickets','bookingGroups','payments','supportTickets','refundRequests','promotionCampaigns','reviews','notifications',
  'shiftHandovers','ticketScans','financeStatements','financeRiskReviews','settlementBatches','reconciliationReports','offlineSales',
  // Staff invitations and driver verification reviews are company-scoped workflow
  // records. They must be loaded with the dashboard snapshot so pending requests
  // remain visible before a CompanyEmployee row exists.
  'invitations','verificationReviews',
]);

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

function ids(rows = [], key = 'id') {
  return [...new Set(rows.map((row) => {
    if (!row) return null;
    return key === 'id' ? (row.id || row._id) : row[key];
  }).filter(Boolean).map(String))];
}

async function adminSnapshot() {
  const snapshot = emptySnapshot();
  await Promise.all(ALL_ENTITIES.map(async (entity) => {
    if (entity === 'platformSettings') {
      snapshot.platformSettings = await one('platformSettings', {}) || {};
      return;
    }
    if (!repositories[entity]) return;
    snapshot[entity] = await list(entity);
  }));
  return snapshot;
}

async function companySnapshot(companyId) {
  const snapshot = emptySnapshot();
  snapshot.companies = [await one('companies', { id: companyId })].filter(Boolean);
  snapshot.users = await list('users', { companyId }, 500);

  const directEntities = [...COMPANY_SCOPED].filter((entity) => repositories[entity]);
  await Promise.all(directEntities.map(async (entity) => {
    if (entity === 'seats') return;
    snapshot[entity] = await list(entity, { companyId });
  }));

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
  const propertyIds = ids(snapshot.hotelProperties);
  const roomTypeIds = ids(snapshot.roomTypes);

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
    ['roomUnits', propertyIds.length ? { propertyId: { $in: propertyIds } } : { propertyId: '__none__' }, 3000],
    ['roomNightInventories', roomTypeIds.length ? { roomTypeId: { $in: roomTypeIds } } : { roomTypeId: '__none__' }, 5000],
  ];
  await Promise.all(relatedTasks.map(async ([entity, filter, limit]) => {
    if (repositories[entity]) snapshot[entity] = await list(entity, filter, limit);
  }));
  snapshot.platformSettings = await one('platformSettings', {}) || {};
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
  await Promise.all(tasks.map(async ([entity, filter, limit]) => { if (repositories[entity]) snapshot[entity] = await list(entity, filter, limit); }));
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
  await Promise.all(tasks.map(async ([entity, filter, limit]) => { if (repositories[entity]) snapshot[entity] = await list(entity, filter, limit); }));
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
    await Promise.all(related.map(async ([entity, filter, limit]) => {
      if (repositories[entity]) snapshot[entity] = await list(entity, filter, limit);
    }));
    const routeIds = ids(snapshot.routes);
    const scheduleIds = ids(snapshot.schedules);
    if (routeIds.length && repositories.routeStops) snapshot.routeStops = await list('routeStops', { routeId: { $in: routeIds }, status: { $ne: 'archived' } }, 5000);
    if (scheduleIds.length && repositories.seats) snapshot.seats = await list('seats', { scheduleId: { $in: scheduleIds } }, 10000);
    if (scheduleIds.length && repositories.busSeatSegmentInventories) snapshot.busSeatSegmentInventories = await list('busSeatSegmentInventories', { scheduleId: { $in: scheduleIds } }, 10000);
  }
  return snapshot;
}

async function load(role, context = {}) {
  if (role === 'admin' || ['support','finance','operations','content'].includes(role)) return adminSnapshot();
  if (role === 'company' || role === 'employee') return companySnapshot(context.companyId);
  if (role === 'customer') return customerSnapshot(context);
  if (role === 'promoter') return promoterSnapshot(context);
  return emptySnapshot();
}

module.exports = { load, emptySnapshot };
