const commerceRepository = require('../../repositories/domain/commerceRepository');
const contentRepository = require('../../repositories/domain/contentRepository');
const promoterRepository = require('../../repositories/domain/promoterRepository');
const { publicCatalogGroup } = require('./catalogGrouping');
const { entityId, sameId, canonicalServiceType, relatedSchedulesForListing, isPublicListing: publicListingVisible } = require('./catalogVisibility');
const { calculateCustomerFees } = require('../../utils/calculateCustomerFees');
const { formatRouteLabel } = require('../../utils/routeLabel');
const { priceBusTicket } = require('../../utils/busCustomerPricing');
const { getPlatformConfig } = require('../platform/platformConfigService');
const { nextId } = require('../data/idService');
const { env } = require('../../config/env');
const { runMongoRead } = require('../data/mongoReadGate');
const redisRuntime = require('../../config/redis');
const flightSearchService = require('../../modules/flight/services/flightSearchService');

const { SERVICE_REGISTRY } = require('../../config/serviceRegistry');
const SERVICE_LABELS = Object.freeze(Object.fromEntries(Object.entries(SERVICE_REGISTRY).map(([key, value]) => [key, value.singular])));
const TYPE_ORDER = ['bus', 'hotel', 'flight', 'local_transport', 'tour', 'car_rental', 'cargo'];
const PRODUCTION_SERVICE_TYPES = new Set(TYPE_ORDER);

function normalize(value) { return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_'); }
function canonicalPublicServiceType(value) { const key = normalize(value); return ['stay','stays','home','homes','accommodation','accommodations'].includes(key) ? 'hotel' : key; }
function publicServiceSlug(value) { return canonicalPublicServiceType(value) === 'hotel' ? 'stays' : canonicalPublicServiceType(value); }
function text(value) { return String(value || '').trim(); }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function asDate(value) { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date : null; }
function active(row) { return ['active', 'published', 'verified', 'approved', 'boarding', 'delayed'].includes(normalize(row?.status)); }
function isPublicListing(row, data = {}) { return publicListingVisible(row, data && typeof data === 'object' && !Array.isArray(data) ? data : {}); }

let snapshotCache = null;
let snapshotCachedAt = 0;
let snapshotInflight = null;
let homeBootstrapCache = null;
let homeBootstrapCachedAt = 0;
let homeBootstrapInflight = null;
const listingSnapshotCache = new Map();
const listingSnapshotInflight = new Map();
const LISTING_SNAPSHOT_TTL_MS = env.performance.listingCacheTtlMs;
const LISTING_SNAPSHOT_STALE_MS = env.performance.listingCacheStaleMs;
const LISTING_SNAPSHOT_CACHE_LIMIT = 240;

async function runCatalogTasks(tasks = []) {
  const values = new Array(tasks.length);
  const concurrency = Math.max(2, Math.min(4, Number(env.mongoPool?.max || 5) - 1));
  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      values[index] = await runMongoRead(tasks[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return values;
}

async function loadSnapshotFresh() {
  const [categories, listingRows, blogs, platformConfig] = await runCatalogTasks([
    () => commerceRepository.categories.list({ status: { $ne: 'archived' } }, { sort: { order: 1, name: 1 }, limit: 500 }),
    () => commerceRepository.listings.list({ status: 'active', releaseStatus: 'published', serviceType: { $in: TYPE_ORDER } }, { sort: { isFeatured: -1, createdAt: -1 }, limit: 5000 }),
    () => contentRepository.blogs.list({ status: 'published' }, { sort: { publishedAt: -1, createdAt: -1 }, limit: 500 }),
    () => getPlatformConfig(),
  ]);
  const initialCompanyIds = unique(listingRows.map((row) => row.companyId).map(text));
  const companies = initialCompanyIds.length
    ? await runMongoRead(() => commerceRepository.companies.list({ id: { $in: initialCompanyIds } }, { sort: { name: 1 }, limit: 5000 }))
    : [];
  const productionListings = listingRows.filter((row) => PRODUCTION_SERVICE_TYPES.has(canonicalServiceType(row, { listings: listingRows, companies })));
  const listingIds = unique(productionListings.map(entityId));
  const currentTime = new Date();
  const today = currentTime.toISOString().slice(0, 10);
  const none = { id: '__no_public_inventory__' };
  const listingFilter = listingIds.length ? { listingId: { $in: listingIds } } : none;
  const [routes, serviceAddons, schedules, roomTypes, roomUnits, links, campaigns] = await runCatalogTasks([
    () => commerceRepository.routes.list({ ...listingFilter, status: { $ne: 'archived' } }, { sort: { createdAt: -1 }, limit: 10000 }),
    () => commerceRepository.serviceAddons.list({ ...listingFilter, status: 'active' }, { sort: { listingId: 1, sortOrder: 1, createdAt: 1 }, limit: 10000 }),
    () => commerceRepository.schedules.list({
      ...listingFilter,
      status: { $in: ['published', 'boarding', 'delayed'] },
      $or: [
        { departAt: { $gte: currentTime } },
        { status: 'boarding' },
        { status: 'delayed', arriveAt: { $gte: currentTime } },
      ],
    }, { sort: { departAt: 1 }, limit: 10000 }),
    () => commerceRepository.roomTypes.list({ ...listingFilter, status: 'active' }, { limit: 10000 }),
    () => commerceRepository.roomUnits.list({ ...listingFilter, status: { $nin: ['archived', 'maintenance'] } }, { limit: 20000 }),
    () => promoterRepository.links.list({ ...listingFilter, status: 'active' }, { sort: { createdAt: -1 }, limit: 5000 }),
    () => contentRepository.promotionCampaigns.list({ ...listingFilter, status: 'active' }, { sort: { createdAt: -1 }, limit: 5000 }),
  ]);
  const routeIds = unique(routes.map(entityId));
  const scheduleIds = unique(schedules.map(entityId));
  const vehicleIds = unique(schedules.map((row) => row.vehicleId).map(text));
  const roomTypeIds = unique(roomTypes.map(entityId));
  const [routeStops, fareProducts, segmentFares, seats, vehicles, roomNights] = await runCatalogTasks([
    () => routeIds.length
      ? commerceRepository.routeStops.list({ routeId: { $in: routeIds }, status: { $ne: 'archived' } }, { sort: { routeId: 1, stopOrder: 1 }, limit: 20000 })
      : [],
    () => routeIds.length
      ? commerceRepository.fareProducts.list({ routeId: { $in: routeIds }, status: 'active' }, { sort: { createdAt: -1 }, limit: 10000 })
      : [],
    () => routeIds.length
      ? commerceRepository.segmentFares.list({ routeId: { $in: routeIds }, status: 'active' }, { sort: { routeId: 1, fromOrder: 1, toOrder: 1 }, limit: 30000 })
      : [],
    () => scheduleIds.length
      ? commerceRepository.seats.list({ scheduleId: { $in: scheduleIds } }, { limit: 50000 })
      : [],
    () => vehicleIds.length
      ? commerceRepository.vehicles.list({ id: { $in: vehicleIds }, status: { $ne: 'archived' } }, { limit: 10000 })
      : [],
    () => roomTypeIds.length
      ? commerceRepository.roomNights.list({ roomTypeId: { $in: roomTypeIds }, date: { $gte: today }, status: { $in: ['available', 'open'] } }, { limit: 50000 })
      : [],
  ]);
  const productionCategories = categories.filter((row) => PRODUCTION_SERVICE_TYPES.has(normalize(row.key || row.serviceType || row.slug || row.name)));
  return { categories: productionCategories, listings: productionListings, companies, routes, routeStops, fareProducts, segmentFares, serviceAddons, schedules, seats, vehicles, roomTypes, roomUnits, roomNights, links, campaigns, blogs, platformConfig };
}


function listingSnapshotKey(identifier, serviceType = '') {
  return `${canonicalPublicServiceType(serviceType)}:${normalize(identifier)}`;
}

function rememberListingSnapshot(key, value) {
  if (listingSnapshotCache.size >= LISTING_SNAPSHOT_CACHE_LIMIT) {
    const oldest = listingSnapshotCache.keys().next().value;
    if (oldest) listingSnapshotCache.delete(oldest);
  }
  listingSnapshotCache.set(key, { value, createdAt: Date.now() });
  return value;
}

async function loadListingSnapshotFresh(identifier, serviceType = '') {
  const key = text(identifier);
  const type = canonicalPublicServiceType(serviceType);
  if (!key) return null;
  const identity = [{ id: key }, { slug: key }];
  const listing = await runMongoRead(() => commerceRepository.listings.findOne({
    $and: [
      { status: 'active', releaseStatus: 'published' },
      type ? { serviceType: type } : {},
      { $or: identity },
    ],
  }));
  if (!listing) return null;
  const listingId = entityId(listing);
  const listingType = canonicalPublicServiceType(listing.serviceType || listing.type || '');
  const isBus = listingType === 'bus';
  const isHotel = listingType === 'hotel';
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const [company, routes, serviceAddons, schedules, roomTypes, platformConfig] = await runCatalogTasks([
    () => commerceRepository.companies.findOne({ id: listing.companyId }),
    () => isBus ? commerceRepository.routes.list({ listingId, status: { $ne: 'archived' } }, { sort: { createdAt: -1 }, limit: 80 }) : [],
    () => commerceRepository.serviceAddons.list({ listingId, status: 'active' }, { sort: { sortOrder: 1, createdAt: 1 }, limit: 80 }),
    () => isBus ? commerceRepository.schedules.list({
      listingId,
      status: { $in: ['published', 'boarding', 'delayed'] },
      $or: [
        { departAt: { $gte: now } },
        { status: 'boarding' },
        { status: 'delayed', arriveAt: { $gte: now } },
      ],
    }, { sort: { departAt: 1 }, limit: 90 }) : [],
    () => isHotel ? commerceRepository.roomTypes.list({ listingId, status: 'active' }, { sort: { createdAt: -1 }, limit: 80 }) : [],
    () => getPlatformConfig(),
  ]);
  const routeIds = unique(routes.map(entityId));
  const roomTypeIds = unique(roomTypes.map(entityId));

  // New departures already carry immutable route, seat-map and compact fare
  // snapshots. Reusing them removes the largest listing/payment cold reads:
  // every compatibility Seat row plus the full fare tables for all 30 dates.
  const snapshotStops = [];
  const snapshotFareProducts = new Map();
  const snapshotSegmentFares = new Map();
  for (const schedule of schedules) {
    const routeId = text(schedule.routeId || schedule.routeSnapshot?.routeId);
    for (const stop of (schedule.routeSnapshot?.stops || [])) {
      const stopId = entityId(stop);
      if (!stopId) continue;
      const keyValue = `${routeId}:${stopId}`;
      if (!snapshotStops.some((row) => `${text(row.routeId)}:${entityId(row)}` === keyValue)) {
        snapshotStops.push({ ...stop, id: stopId, routeId, status: stop.status || 'active' });
      }
    }
    const fareSnapshot = schedule.fareSnapshot || {};
    const fareProductId = text(fareSnapshot.fareProductId || schedule.fareProductId);
    if (fareProductId && !snapshotFareProducts.has(fareProductId)) {
      snapshotFareProducts.set(fareProductId, {
        id: fareProductId,
        listingId,
        companyId: listing.companyId,
        routeId,
        name: fareSnapshot.name || schedule.fareClass || 'Standard fare',
        fareClass: fareSnapshot.fareClass || schedule.fareClass || 'standard',
        currency: fareSnapshot.currency || schedule.currency,
        refundable: !!fareSnapshot.refundable,
        changeable: !!fareSnapshot.changeable,
        baggageAllowanceKg: number(fareSnapshot.baggageAllowanceKg),
        status: 'active',
      });
    }
    for (const fare of (fareSnapshot.fares || [])) {
      const fareId = entityId(fare) || `${fareProductId}:${fare.fromStopId}:${fare.toStopId}`;
      if (!fareId || snapshotSegmentFares.has(fareId)) continue;
      snapshotSegmentFares.set(fareId, {
        ...fare,
        id: fareId,
        listingId,
        companyId: listing.companyId,
        routeId,
        fareProductId,
        currency: fare.currency || fareSnapshot.currency || schedule.currency,
        status: fare.status || 'active',
      });
    }
  }
  const snapshotStopRouteIds = new Set(snapshotStops.map((row) => text(row.routeId)).filter(Boolean));
  const snapshotFareRouteIds = new Set([...snapshotFareProducts.values()].map((row) => text(row.routeId)).filter(Boolean));
  const snapshotsCoverRoutes = routeIds.length > 0 && routeIds.every((routeId) => snapshotStopRouteIds.has(String(routeId)));
  const fareSnapshotsCoverRoutes = routeIds.length > 0 && routeIds.every((routeId) => snapshotFareRouteIds.has(String(routeId)));
  const [routeStops, fareProducts, segmentFares, roomUnits, roomNights] = await runCatalogTasks([
    () => !isBus || !routeIds.length ? [] : (snapshotsCoverRoutes ? snapshotStops : commerceRepository.routeStops.list({ routeId: { $in: routeIds }, status: { $ne: 'archived' } }, { sort: { routeId: 1, stopOrder: 1 }, limit: 400 })),
    () => !isBus || !routeIds.length ? [] : (fareSnapshotsCoverRoutes ? [...snapshotFareProducts.values()] : commerceRepository.fareProducts.list({ routeId: { $in: routeIds }, status: 'active' }, { sort: { createdAt: -1 }, limit: 160 })),
    () => !isBus || !routeIds.length ? [] : (fareSnapshotsCoverRoutes && snapshotSegmentFares.size ? [...snapshotSegmentFares.values()] : commerceRepository.segmentFares.list({ routeId: { $in: routeIds }, status: 'active' }, { sort: { routeId: 1, fromOrder: 1, toOrder: 1 }, limit: 1200 })),
    () => roomTypeIds.length ? commerceRepository.roomUnits.list({ listingId, roomTypeId: { $in: roomTypeIds }, status: { $nin: ['archived', 'maintenance'] } }, { limit: 300 }) : [],
    () => roomTypeIds.length ? commerceRepository.roomNights.list({ listingId, roomTypeId: { $in: roomTypeIds }, date: { $gte: today }, status: { $in: ['available', 'open'] } }, { limit: 1500 }) : [],
  ]);
  const seats = [];
  const vehicles = [];
  return {
    categories: [],
    listings: [listing],
    companies: [company].filter(Boolean),
    routes,
    routeStops,
    fareProducts,
    segmentFares,
    serviceAddons,
    schedules,
    seats,
    vehicles,
    roomTypes,
    roomUnits,
    roomNights,
    links: [],
    campaigns: [],
    blogs: [],
    platformConfig,
  };
}

function sharedListingSnapshotKey(key) {
  return redisRuntime.key('listing-snapshot', key);
}

async function readSharedListingSnapshot(key) {
  const client = redisRuntime.activeClient();
  if (!client) return null;
  try {
    const encoded = await client.get(sharedListingSnapshotKey(key));
    if (!encoded) return null;
    const parsed = JSON.parse(encoded);
    if (!parsed?.value || !Number(parsed.createdAt)) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

async function writeSharedListingSnapshot(key, value, createdAt = Date.now()) {
  const client = redisRuntime.activeClient();
  if (!client || !value) return;
  try {
    await client.set(sharedListingSnapshotKey(key), JSON.stringify({ createdAt, value }), { PX: LISTING_SNAPSHOT_STALE_MS });
  } catch (_) {}
}

async function snapshotForListing(identifier, serviceType = '', options = {}) {
  const key = listingSnapshotKey(identifier, serviceType);
  let cached = listingSnapshotCache.get(key);
  if (!options.force && !cached) {
    const shared = await readSharedListingSnapshot(key);
    if (shared) {
      listingSnapshotCache.set(key, { value: shared.value, createdAt: shared.createdAt });
      cached = listingSnapshotCache.get(key);
    }
  }
  const age = cached ? Date.now() - cached.createdAt : Infinity;
  if (!options.force && cached && age <= LISTING_SNAPSHOT_TTL_MS) return cached.value;
  if (!options.force && cached && age <= LISTING_SNAPSHOT_STALE_MS) {
    if (!listingSnapshotInflight.has(key)) {
      const refresh = loadListingSnapshotFresh(identifier, serviceType)
        .then(async (value) => {
          if (!value) return null;
          const remembered = rememberListingSnapshot(key, value);
          await writeSharedListingSnapshot(key, remembered);
          return remembered;
        })
        .finally(() => listingSnapshotInflight.delete(key));
      listingSnapshotInflight.set(key, refresh);
      refresh.catch(() => {});
    }
    return cached.value;
  }
  let inflight = listingSnapshotInflight.get(key);
  if (!inflight) {
    inflight = loadListingSnapshotFresh(identifier, serviceType)
      .then(async (value) => {
        if (!value) return null;
        const remembered = rememberListingSnapshot(key, value);
        await writeSharedListingSnapshot(key, remembered);
        return remembered;
      })
      .finally(() => listingSnapshotInflight.delete(key));
    listingSnapshotInflight.set(key, inflight);
  }
  try {
    return await inflight;
  } catch (error) {
    if (cached) return cached.value;
    throw error;
  }
}

async function refreshSnapshot() {
  if (snapshotInflight) return snapshotInflight;
  snapshotInflight = loadSnapshotFresh()
    .then((value) => {
      snapshotCache = value;
      snapshotCachedAt = Date.now();
      return value;
    })
    .finally(() => { snapshotInflight = null; });
  return snapshotInflight;
}

async function snapshot(options = {}) {
  const age = snapshotCache ? Date.now() - snapshotCachedAt : Infinity;
  if (!options.force && snapshotCache && age <= env.performance.homeCacheTtlMs) return snapshotCache;
  if (!options.force && snapshotCache && age <= env.performance.homeCacheStaleMs) {
    refreshSnapshot().catch(() => {});
    return snapshotCache;
  }
  try {
    return await refreshSnapshot();
  } catch (error) {
    // A previously completed catalog is safer than replacing the marketplace
    // with a 500 page during a brief Atlas pool/network incident.
    if (snapshotCache) return snapshotCache;
    throw error;
  }
}

function invalidateMarketplaceCache() {
  // Keep the last known-good global catalog as an emergency fallback while
  // forcing a refresh. Listing-scoped snapshots are small enough to clear and
  // must not retain an unpublished schedule/listing after an operator change.
  snapshotCachedAt = 0;
  homeBootstrapCache = null;
  homeBootstrapCachedAt = 0;
  listingSnapshotCache.clear();
}

async function prewarmHome() {
  await snapshot({ force: true });
  return homeBootstrap({ force: true });
}

function companyFor(data, identifier) {
  const key = normalize(identifier);
  return data.companies.find((row) => [entityId(row), row.slug, row.name].some((value) => normalize(value) === key)) || null;
}

function listingFor(data, identifier, serviceType = '') {
  const key = normalize(identifier);
  const type = canonicalPublicServiceType(serviceType);
  return data.listings.find((row) => (!type || canonicalServiceType(row, data) === type)
    && [entityId(row), row.slug, row.title].some((value) => normalize(value) === key)) || null;
}

function listingSchedules(data, listingId) {
  const listing = data.listings.find((row) => sameId(row, listingId)) || { id: listingId };
  return relatedSchedulesForListing(listing, data);
}
function listingRoutes(data, listingId) { return data.routes.filter((row) => sameId(row.listingId, listingId)); }
function routeStopsFor(data, routeId) {
  return (data.routeStops || []).filter((row) => sameId(row.routeId, routeId) && normalize(row.status) !== 'archived').sort((a, b) => number(a.stopOrder) - number(b.stopOrder));
}
function fareCatalogForListing(data, listingId) {
  const routes = listingRoutes(data, listingId).filter((row) => normalize(row.status) !== 'archived');
  const routeIds = new Set(routes.map((row) => entityId(row)));
  const products = (data.fareProducts || []).filter((row) => sameId(row.listingId, listingId) && routeIds.has(String(row.routeId || '')) && normalize(row.status) === 'active');
  const rows = products.map((product) => {
    const route = routes.find((item) => sameId(item, product.routeId)) || {};
    const stops = routeStopsFor(data, entityId(route));
    const stopIndex = new Map(stops.map((stop) => [String(entityId(stop)), stop]));
    const segments = (data.segmentFares || [])
      .filter((fare) => sameId(fare.fareProductId, product) && normalize(fare.status) === 'active' && number(fare.amount) > 0)
      .sort((a, b) => number(a.fromOrder) - number(b.fromOrder) || number(a.toOrder) - number(b.toOrder))
      .map((fare) => ({
        id: entityId(fare),
        fromStopId: fare.fromStopId || '',
        toStopId: fare.toStopId || '',
        from: stopIndex.get(String(fare.fromStopId || ''))?.name || route.origin || '',
        to: stopIndex.get(String(fare.toStopId || ''))?.name || route.destination || '',
        fromOrder: number(fare.fromOrder),
        toOrder: number(fare.toOrder),
        amount: number(fare.amount),
        currency: String(fare.currency || product.currency || '').toUpperCase(),
      }));
    const fullRoute = segments.find((fare) => sameId(fare.fromStopId, route.originStopId) && sameId(fare.toStopId, route.destinationStopId))
      || segments.slice().sort((a, b) => (b.toOrder - b.fromOrder) - (a.toOrder - a.fromOrder))[0]
      || null;
    const amounts = segments.map((fare) => fare.amount).filter((amount) => amount > 0);
    return {
      id: entityId(product),
      name: product.name || product.fareClass || 'Fare',
      fareClass: product.fareClass || 'standard',
      routeId: product.routeId || '',
      routeLabel: formatRouteLabel(route.origin, route.destination, route.routeName),
      currency: String(product.currency || fullRoute?.currency || '').toUpperCase(),
      refundable: Boolean(product.refundable),
      changeable: Boolean(product.changeable),
      baggageAllowanceKg: number(product.baggageAllowanceKg),
      segments,
      segmentCount: segments.length,
      fullRouteAmount: number(fullRoute?.amount),
      fullRouteCustomerAmount: priceBusTicket({ partnerFare: number(fullRoute?.amount), isMainRoute: true, currency: String(product.currency || fullRoute?.currency || '').toUpperCase() }).customerFare,
      priceFrom: amounts.length ? Math.min(...amounts) : 0,
    };
  });
  const amounts = rows.flatMap((row) => row.segments.map((segment) => segment.amount)).filter((amount) => amount > 0);
  const fullRouteAmounts = rows.map((row) => row.fullRouteAmount).filter((amount) => amount > 0);
  return {
    products: rows,
    priceFrom: amounts.length ? Math.min(...amounts) : 0,
    fullRoutePrice: fullRouteAmounts.length ? Math.min(...fullRouteAmounts) : 0,
    currency: rows.find((row) => row.currency)?.currency || '',
  };
}
function scheduleSeats(data, scheduleId) { return data.seats.filter((row) => sameId(row.scheduleId, scheduleId)); }
function listingRooms(data, listingId) {
  const types = data.roomTypes.filter((row) => sameId(row.listingId, listingId) && active(row));
  return types.map((roomType) => {
    const roomTypeId = entityId(roomType);
    const units = data.roomUnits.filter((unit) => sameId(unit.roomTypeId, roomTypeId) && !['archived', 'maintenance'].includes(normalize(unit.status)));
    const unitIds = new Set(units.map((unit) => entityId(unit)));
    const nights = data.roomNights.filter((night) => unitIds.has(String(night.roomUnitId || '')));
    const availableNights = nights.filter((night) => ['available', 'open'].includes(normalize(night.status)) && !night.bookingRef && number(night.availableInventory ?? 1) > 0).length;
    const availableUnits = units.filter((unit) => normalize(unit.status) === 'available' && ['clean', 'inspected', 'ready'].includes(normalize(unit.housekeepingStatus || 'clean'))).length;
    return {
      ...roomType,
      roomTypeId,
      roomType: roomType.name || roomType.title,
      inventory: units.length,
      availableUnits,
      availableNights,
      nightlyPrice: number(roomType.basePrice),
      price: number(roomType.basePrice),
    };
  });
}

function liveCampaignFor(data, listingId, now = new Date()) {
  return data.campaigns.find((campaign) => sameId(campaign.listingId, listingId) && normalize(campaign.status) === 'active'
    && (!campaign.startsAt || new Date(campaign.startsAt) <= now)
    && (!campaign.endsAt || new Date(campaign.endsAt) >= now));
}

function catalogItem(data, listing, preferredRoute = null) {
  const stableId = entityId(listing);
  const company = companyFor(data, listing.companyId || listing.companySlug);
  const schedules = listingSchedules(data, stableId).filter((row) => active(row));
  const now = new Date();
  const nextSchedule = schedules.filter((row) => {
    const status = normalize(row.status);
    if (status === 'boarding' || status === 'delayed') return !asDate(row.arriveAt || row.departAt) || asDate(row.arriveAt || row.departAt) >= now;
    return asDate(row.departAt) && asDate(row.departAt) >= now;
  }).sort((a, b) => (asDate(a.departAt)?.getTime() || 0) - (asDate(b.departAt)?.getTime() || 0))[0] || null;
  const seats = nextSchedule ? scheduleSeats(data, entityId(nextSchedule)) : [];
  const rooms = listingRooms(data, stableId);
  const availableSeats = seats.filter((row) => normalize(row.status) === 'available').length;
  const roomInventory = rooms.reduce((sum, row) => sum + Math.max(0, number(row.availableUnits ?? row.inventory ?? row.available)), 0);
  const serviceType = canonicalServiceType(listing, data);
  const remainingInventory = serviceType === 'bus'
    ? (seats.length ? availableSeats : number(nextSchedule?.availableSeats || listing.availableSeats || listing.inventory))
    : serviceType === 'hotel'
      ? (roomInventory || number(listing.availableRooms || listing.inventory))
      : number(listing.remainingInventory || listing.inventory || listing.availability);
  const activeRoutes = listingRoutes(data, stableId)
    .filter((row) => normalize(row.status) !== 'archived');
  const preferredRouteId = entityId(preferredRoute || {});
  const route = (preferredRouteId && activeRoutes.find((row) => sameId(row, preferredRouteId))) || activeRoutes[0] || {};
  const fareCatalog = serviceType === 'bus' ? fareCatalogForListing(data, stableId) : { products: [], priceFrom: 0, fullRoutePrice: 0, currency: '' };
  const routeSummaries = serviceType === 'bus' ? activeRoutes.map((routeRow) => {
    const routeId = entityId(routeRow);
    const routeSchedules = schedules
      .filter((schedule) => sameId(schedule.routeId || schedule.routeSnapshot?.routeId, routeId))
      .sort((a, b) => (asDate(a.departAt)?.getTime() || 0) - (asDate(b.departAt)?.getTime() || 0));
    const routeProducts = fareCatalog.products.filter((product) => sameId(product.routeId, routeId));
    const routeFullRouteCustomerAmounts = routeProducts
      .map((product) => number(product.fullRouteCustomerAmount))
      .filter((amount) => amount > 0);
    const routeAmounts = routeProducts
      .flatMap((product) => [product.priceFrom, product.fullRouteCustomerAmount || product.fullRouteAmount])
      .map(number)
      .filter((amount) => amount > 0);
    const routeNext = routeSchedules[0] || null;
    const label = formatRouteLabel(routeRow.origin || routeRow.from, routeRow.destination || routeRow.to, routeRow.routeName) || 'Bus route';
    return {
      id: routeId,
      routeId,
      label,
      routeName: routeRow.routeName || label,
      origin: routeRow.origin || routeRow.from || '',
      destination: routeRow.destination || routeRow.to || '',
      corridor: routeRow.corridor || normalize(`${routeRow.origin || routeRow.from || ''}-${routeRow.destination || routeRow.to || ''}`),
      timezone: routeRow.timezone || routeNext?.timezone || 'Africa/Kampala',
      scheduleCount: routeSchedules.length,
      availableSeats: routeSchedules.reduce((sum, schedule) => sum + Math.max(0, number(schedule.availableSeats)), 0),
      nextDepartAt: routeNext?.departAt || null,
      departures: routeSchedules.slice(0, 90).map((schedule) => ({
        id: entityId(schedule),
        departAt: schedule.departAt || null,
        arriveAt: schedule.arriveAt || null,
        availableSeats: Math.max(0, number(schedule.availableSeats)),
        status: schedule.status || '',
      })),
      priceFrom: routeFullRouteCustomerAmounts.length ? Math.min(...routeFullRouteCustomerAmounts) : (routeAmounts.length ? Math.min(...routeAmounts) : priceBusTicket({ partnerFare: number(routeNext?.basePrice || listing.priceFrom || listing.price), isMainRoute: true, currency: routeNext?.currency || listing.currency || '' }).customerFare),
      currency: String(routeProducts.find((product) => product.currency)?.currency || routeNext?.currency || listing.currency || '').toUpperCase(),
    };
  }).sort((a, b) => {
    const aTime = asDate(a.nextDepartAt)?.getTime() || Number.MAX_SAFE_INTEGER;
    const bTime = asDate(b.nextDepartAt)?.getTime() || Number.MAX_SAFE_INTEGER;
    return aTime - bTime || a.label.localeCompare(b.label);
  }) : [];
  const from = listing.from || route.origin || route.from || listing.city || '';
  const to = listing.to || route.destination || route.to || listing.location || '';
  const priceFrom = number(fareCatalog.priceFrom || listing.priceFrom || listing.price || nextSchedule?.basePrice || nextSchedule?.price || rooms[0]?.price);
  const inventoryRequired = ['bus', 'hotel', 'flight', 'tour', 'car_rental'].includes(serviceType);
  const hasRequiredDatedInventory = serviceType !== 'bus' || Boolean(nextSchedule);
  // A published bus departure with live inventory is the source of truth for
  // bus bookability. Older listing rows can retain bookable=false from before
  // the departure was published, which must not turn a real live service into
  // a misleading 'Coming soon' state. Other service types keep their explicit
  // listing-level bookable switch.
  const listingBookableGate = serviceType === 'bus' ? Boolean(nextSchedule) : listing.bookable !== false;
  const bookable = PRODUCTION_SERVICE_TYPES.has(serviceType) && listingBookableGate && active(listing) && hasRequiredDatedInventory && (!inventoryRequired || remainingInventory > 0);
  const policy = text(listing.policy || listing.cancellationRules || listing.cancellationPolicy || listing.refundPolicy);
  const nextDepartAt = nextSchedule?.departAt || listing.nextDepartAt || null;
  const nextDepartDate = asDate(nextDepartAt);
  const nextDepartLabel = nextDepartDate
    ? nextDepartDate.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: nextSchedule?.timezone || 'UTC' })
    : serviceType === 'hotel' ? 'Choose stay dates' : serviceType === 'local_transport' ? 'Request now or schedule' : serviceType === 'tour' ? 'Choose an activity date' : serviceType === 'car_rental' ? 'Choose pickup and return dates' : serviceType === 'cargo' ? 'Choose pickup details' : '';
  const bookableReason = bookable
    ? (serviceType === 'bus' ? 'Published departure available' : serviceType === 'local_transport' ? 'Verified dispatch available' : serviceType === 'tour' ? 'Tour capacity available' : serviceType === 'car_rental' ? 'Vehicle available' : serviceType === 'cargo' ? 'Cargo booking available' : 'Live inventory available')
    : serviceType === 'bus' && !nextSchedule ? 'No upcoming departure' : remainingInventory <= 0 ? 'No inventory available' : 'Booking unavailable';
  const enriched = {
    id: stableId,
    slug: listing.slug || stableId,
    companyId: listing.companyId || '',
    title: listing.title || listing.name || '',
    name: listing.name || listing.title || '',
    shortDescription: listing.shortDescription || listing.description || '',
    description: listing.shortDescription || listing.description || '',
    sub: listing.sub || listing.shortDescription || listing.description || '',
    policy,
    cancellationRules: listing.cancellationRules || policy,
    serviceNotes: listing.serviceNotes || '',
    stayType: listing.stayType || listing.propertyType || '',
    pricingUnit: listing.pricingUnit || 'per_booking',
    inventory: number(listing.inventory),
    durationMinutes: number(listing.durationMinutes),
    maxGuests: number(listing.maxGuests),
    vehicleCategory: listing.vehicleCategory || '',
    transmission: listing.transmission || '',
    fuelType: listing.fuelType || '',
    seatsCount: number(listing.seatsCount),
    cargoTypes: Array.isArray(listing.cargoTypes) ? listing.cargoTypes : [],
    weightLimitKg: number(listing.weightLimitKg),
    packageLimit: number(listing.packageLimit),
    serviceDetails: listing.serviceDetails || {},
    amenities: Array.isArray(listing.amenities) ? listing.amenities : [],
    salesChannels: Array.isArray(listing.salesChannels) ? listing.salesChannels : [],
    baggageRules: listing.baggageRules || '',
    contactPhone: listing.contactPhone || '',
    branchName: listing.branchName || '',
    address: listing.address || '',
    location: listing.location || listing.address || '',
    media: Array.isArray(listing.media) ? listing.media.map((item) => ({
      url: item.url || item.secureUrl || '',
      secureUrl: item.secureUrl || item.url || '',
      alt: item.alt || item.label || listing.title || '',
      label: item.label || item.alt || '',
      resourceType: item.resourceType || 'image',
    })) : [],
    serviceType,
    type: listing.type || serviceType,
    internalGroup: listing.group || '',
    group: publicCatalogGroup(serviceType, listing.group),
    typeLabel: SERVICE_LABELS[serviceType] || serviceType,
    companyName: company?.name || listing.companyName || listing.partner || '',
    companySlug: company?.slug || listing.companySlug || entityId(company || {}),
    partner: listing.partner || company?.name || '',
    isVerified: listing.isVerified === true || ['verified', 'approved'].includes(normalize(company?.verificationStatus)),
    isSponsored: Boolean(liveCampaignFor(data, stableId)),
    from, to,
    city: listing.city || from || to,
    country: listing.country || company?.country || '',
    corridor: listing.corridor || route.corridor || normalize(`${from}-${to}`),
    routeLabel: formatRouteLabel(from, to, listing.routeLabel) || listing.title,
    routes: routeSummaries,
    routeCount: routeSummaries.length,
    nextDepartAt,
    nextDepartLabel,
    time: nextDepartLabel,
    scheduleId: entityId(nextSchedule || {}),
    remainingInventory,
    availability: remainingInventory,
    availableSeats,
    availableRooms: roomInventory,
    unitsLabel: serviceType === 'bus' ? `${remainingInventory} seat${remainingInventory === 1 ? '' : 's'} available` : serviceType === 'hotel' ? `${remainingInventory} room${remainingInventory === 1 ? '' : 's'} available` : serviceType === 'flight' ? `${remainingInventory} seat${remainingInventory === 1 ? '' : 's'} available` : serviceType === 'tour' ? `${remainingInventory} place${remainingInventory === 1 ? '' : 's'} available` : serviceType === 'car_rental' ? `${remainingInventory} vehicle${remainingInventory === 1 ? '' : 's'} available` : serviceType === 'cargo' ? 'Pickup and delivery capacity available' : 'On-demand and scheduled rides',
    priceFrom,
    price: priceFrom,
    fullRoutePrice: serviceType === 'bus' ? priceBusTicket({ partnerFare: number(fareCatalog.fullRoutePrice || priceFrom), isMainRoute: true, currency: String(fareCatalog.currency || listing.currency || nextSchedule?.currency || '').toUpperCase() }).customerFare : number(fareCatalog.fullRoutePrice || priceFrom),
    fareProducts: fareCatalog.products,
    fareProductName: fareCatalog.products[0]?.name || '',
    fareClass: fareCatalog.products[0]?.fareClass || '',
    fareSegmentCount: fareCatalog.products.reduce((sum, product) => sum + product.segmentCount, 0),
    currency: String(fareCatalog.currency || listing.currency || nextSchedule?.currency || rooms[0]?.currency || data.platformConfig?.defaultCurrency || '').toUpperCase(),
    ratingAverage: number(listing.ratingAverage || listing.rating),
    rating: String(listing.ratingAverage || listing.rating || ''),
    reviewCount: number(listing.reviewCount || listing.reviewsCount),
    img: listing.img || listing.image || listing.coverImage || listing.media?.[0]?.url || '',
    bookable,
    bookableReason,
    instantConfirmation: listing.instantConfirmation !== false && bookable,
    refundable: /refund|cancellation/.test(normalize(policy)),
    url: serviceType === 'flight' ? '/flights' : serviceType === 'local_transport' ? '/taxi' : `/listings/${publicServiceSlug(serviceType)}/${listing.slug || stableId}`,
    bookingUrl: bookable ? (serviceType === 'flight' ? '/flights' : serviceType === 'local_transport' ? '/taxi' : `/book/${publicServiceSlug(serviceType)}/${listing.slug || stableId}`) : '',
    companyUrl: `/companies/${company?.slug || entityId(company || {})}`,
    searchText: normalize([listing.title, listing.description, from, to, listing.city, listing.country, company?.name, serviceType, ...routeSummaries.map((item) => item.label)].join(' ')),
  };
  return enriched;
}

function score(item) {
  return (item.isSponsored ? 15 : 0) + (item.isVerified ? 10 : 0) + (item.bookable ? 8 : 0)
    + number(item.ratingAverage) * 10 + Math.min(number(item.reviewCount), 500) / 20
    + Math.min(number(item.remainingInventory), 60) / 6;
}

function isoDateInTimeZone(value, timeZone = 'Africa/Kampala') {
  const date = asDate(value);
  if (!date) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return map.year && map.month && map.day ? `${map.year}-${map.month}-${map.day}` : '';
  } catch (_) { return date.toISOString().slice(0, 10); }
}

function matchingBusRoute(item = {}, query = {}) {
  if (normalize(item.serviceType) !== 'bus') return null;
  const origin = normalize(query.origin || query.from);
  const destination = normalize(query.destination || query.to);
  const requestedDate = String(query.date || query.departureDate || '').trim().slice(0, 10);
  const routes = Array.isArray(item.routes) ? item.routes : [];
  return routes.find((route) => {
    if (origin && normalize(route.origin) !== origin) return false;
    if (destination && normalize(route.destination) !== destination) return false;
    if (!requestedDate) return true;
    return (route.departures || []).some((departure) => isoDateInTimeZone(departure.departAt, route.timezone || 'Africa/Kampala') === requestedDate);
  }) || null;
}

function withMatchedBusRoute(item = {}, query = {}) {
  const wantsRouteMatch = normalize(item.serviceType) === 'bus' && (query.origin || query.from || query.destination || query.to || query.date || query.departureDate);
  if (!wantsRouteMatch) return item;
  const route = matchingBusRoute(item, query);
  if (!route) return item;
  const requestedDate = String(query.date || query.departureDate || '').trim().slice(0, 10);
  const departure = requestedDate
    ? (route.departures || []).find((row) => isoDateInTimeZone(row.departAt, route.timezone || 'Africa/Kampala') === requestedDate)
    : (route.departures || [])[0];
  const params = new URLSearchParams();
  if (route.id) params.set('routeId', route.id);
  if (departure?.id) params.set('scheduleId', departure.id);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return {
    ...item,
    from: route.origin || item.from,
    to: route.destination || item.to,
    routeLabel: route.label || item.routeLabel,
    corridor: route.corridor || item.corridor,
    nextDepartAt: departure?.departAt || route.nextDepartAt || item.nextDepartAt,
    nextDepartLabel: departure?.departAt ? new Date(departure.departAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: route.timezone || 'Africa/Kampala' }) : item.nextDepartLabel,
    remainingInventory: departure ? Math.max(0, number(departure.availableSeats)) : Math.max(0, number(route.availableSeats || item.remainingInventory)),
    availableSeats: departure ? Math.max(0, number(departure.availableSeats)) : Math.max(0, number(route.availableSeats || item.availableSeats)),
    priceFrom: number(route.priceFrom || item.priceFrom),
    price: number(route.priceFrom || item.price),
    url: `${String(item.url || '').split('?')[0]}${suffix}`,
    bookingUrl: item.bookingUrl ? `${String(item.bookingUrl).split('?')[0]}${suffix}` : '',
  };
}

function applySearch(items, query = {}) {
  const q = normalize(query.q || query.search);
  const serviceType = canonicalPublicServiceType(query.serviceType || query.type || '');
  const city = normalize(query.city);
  const country = normalize(query.country);
  const origin = normalize(query.origin || query.from);
  const destination = normalize(query.destination || query.to);
  const partner = normalize(query.partner || query.company);
  const stayType = normalize(query.stayType || query.propertyType || '');
  const tourCategory = normalize(query.category || query.tourType || '');
  const vehicleType = normalize(query.vehicleType || query.vehicleCategory || '');
  const cargoType = normalize(query.cargoType || '');
  const requestedWeightKg = number(query.weightKg || query.weight);
  const min = number(query.minPrice || query.min);
  const max = number(query.maxPrice || query.max);
  const minRating = number(query.minRating || query.rating);
  let rows = items.filter((item) => {
    if (q && !item.searchText.includes(q)) return false;
    if (serviceType && serviceType !== 'all' && normalize(item.serviceType) !== serviceType && normalize(item.group) !== serviceType) return false;
    if (city && !normalize(`${item.city} ${item.from} ${item.to}`).includes(city)) return false;
    if (country && !normalize(item.country).includes(country)) return false;
    if (normalize(item.serviceType) === 'bus' && (origin || destination || query.date || query.departureDate)) {
      if (!matchingBusRoute(item, query)) return false;
    } else {
      if (origin && !normalize(item.from).includes(origin)) return false;
      if (destination && !normalize(item.to).includes(destination)) return false;
    }
    if (partner && !normalize(`${item.partner} ${item.companyName}`).includes(partner)) return false;
    if (stayType) {
      const itemStayType = normalize(item.stayType);
      const staySearchText = normalize(`${item.stayType} ${item.type} ${item.sub} ${item.amenities?.join(' ')} ${item.title} ${item.description}`);
      const airbnbTypes = new Set(['airbnb', 'entire_home', 'entire_place', 'home', 'apartment', 'villa', 'cottage', 'cabin', 'homestay', 'private_room', 'shared_room']);
      const matchesAirbnb = stayType === 'airbnb' && (airbnbTypes.has(itemStayType) || /airbnb|entire home|private room|shared room|holiday home|vacation home/.test(staySearchText));
      if (!matchesAirbnb && itemStayType !== stayType && !staySearchText.includes(stayType)) return false;
    }
    if (tourCategory) {
      const tourText = normalize(`${item.serviceDetails?.category || ''} ${item.serviceDetails?.tourType || ''} ${item.title} ${item.description}`);
      if (!tourText.includes(tourCategory)) return false;
    }
    if (vehicleType) {
      const vehicleText = normalize(`${item.vehicleCategory || ''} ${item.serviceDetails?.vehicleType || ''} ${item.title} ${item.description}`);
      if (!vehicleText.includes(vehicleType)) return false;
    }
    if (cargoType) {
      const cargoText = normalize(`${(item.cargoTypes || []).join(' ')} ${item.serviceDetails?.cargoType || ''} ${item.title} ${item.description}`);
      if (!cargoText.includes(cargoType)) return false;
    }
    if (requestedWeightKg && item.weightLimitKg > 0 && requestedWeightKg > item.weightLimitKg) return false;
    if (min && item.priceFrom < min) return false;
    if (max && item.priceFrom > max) return false;
    if (minRating && item.ratingAverage < minRating) return false;
    if ((query.verified === 'true' || query.verified === true) && !item.isVerified) return false;
    if ((query.bookable === 'true' || query.bookable === true) && !item.bookable) return false;
    if ((query.sponsored === 'true' || query.sponsored === true) && !item.isSponsored) return false;
    if ((query.available === 'true' || query.availableOnly === 'true' || query.availableOnly === true) && item.remainingInventory <= 0) return false;
    return true;
  });
  rows = rows.map((item) => withMatchedBusRoute(item, query));
  const sort = normalize(query.sort || 'recommended');
  rows = rows.sort((a, b) => {
    if (sort === 'cheapest') return a.priceFrom - b.priceFrom;
    if (sort === 'top_rated') return b.ratingAverage - a.ratingAverage;
    if (sort === 'availability') return b.remainingInventory - a.remainingInventory;
    if (sort === 'soonest') return (asDate(a.nextDepartAt)?.getTime() || Number.MAX_SAFE_INTEGER) - (asDate(b.nextDepartAt)?.getTime() || Number.MAX_SAFE_INTEGER);
    return score(b) - score(a);
  });
  return rows;
}

function routeHighlights(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.corridor || item.routeLabel || item.id;
    const row = groups.get(key) || { key, corridor: key, type: item.serviceType, label: item.routeLabel, count: 0, remainingSeats: 0, minPrice: null, currency: item.currency, nextDeparture: '' };
    row.count += 1;
    row.remainingSeats += number(item.remainingInventory);
    row.minPrice = row.minPrice == null ? item.priceFrom : Math.min(row.minPrice, item.priceFrom);
    const next = asDate(item.nextDepartAt);
    if (next && (!row.nextDeparture || next < new Date(row.nextDeparture))) row.nextDeparture = next.toISOString();
    groups.set(key, row);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.remainingSeats - a.remainingSeats).slice(0, 12);
}

function marketplaceInfo(items) {
  const stats = {
    liveListings: items.length,
    availableNow: items.reduce((sum, item) => sum + number(item.remainingInventory), 0),
    countries: unique(items.map((item) => item.country)).length,
    types: unique(items.map((item) => item.serviceType)).length,
    partners: unique(items.map((item) => item.partner || item.companyName)).length,
    departuresNext24h: items.filter((item) => { const d = asDate(item.nextDepartAt); const diff = d ? d - new Date() : -1; return diff >= 0 && diff <= 86400000; }).length,
  };
  const typeStats = TYPE_ORDER.map((type) => {
    const rows = items.filter((item) => item.serviceType === type);
    return { type, label: SERVICE_LABELS[type] || type, count: rows.length, partners: unique(rows.map((item) => item.partner)).length, remainingSeats: rows.reduce((sum, item) => sum + number(item.remainingInventory), 0) };
  });
  return {
    generatedAt: new Date().toISOString(), stats, typeStats, routeHighlights: routeHighlights(items),
    hero: { badges: [{ icon: 'fa-solid fa-shield-halved', label: 'Secure checkout' }, { icon: 'fa-solid fa-database', label: 'Live database inventory' }], stats: [{ value: String(stats.liveListings), label: 'Live listings' }, { value: String(stats.availableNow), label: 'Seats / rooms open' }, { value: String(stats.countries), label: 'Countries covered' }, { value: String(stats.types), label: 'Active categories' }] },
    featured: Object.fromEntries(TYPE_ORDER.map((type) => [type, items.filter((item) => item.serviceType === type).slice(0, 12)])),
  };
}

function publicCompany(data, company) {
  const companyId = entityId(company);
  const listings = data.listings.filter((row) => sameId(row.companyId, companyId) && isPublicListing(row, data));
  const enrichedListings = listings.map((row) => catalogItem(data, row));
  return {
    id: companyId,
    slug: company.slug || companyId,
    name: company.name || '',
    companyType: normalize(company.companyType),
    country: company.country || '',
    city: company.city || '',
    description: company.description || '',
    logo: { url: company.logo?.url || company.logo?.secureUrl || '' },
    coverImage: { url: company.coverImage?.url || company.coverImage?.secureUrl || '' },
    supportContacts: {
      phone: company.supportContacts?.phone || '',
      email: company.supportContacts?.email || '',
      whatsapp: company.supportContacts?.whatsapp || '',
    },
    verificationStatus: company.verificationStatus || 'pending',
    ratingAverage: number(company.ratingAverage),
    reviewCount: number(company.reviewCount),
    activeListingsCount: listings.length,
    bookableListingsCount: enrichedListings.filter((row) => row.bookable).length,
    sponsoredListingsCount: listings.filter((row) => liveCampaignFor(data, entityId(row))).length,
    campaignCount: listings.filter((row) => liveCampaignFor(data, entityId(row))).length,
  };
}

function publicRoute(data, route) {
  const listing = listingFor(data, route.listingId);
  const schedules = listing ? listingSchedules(data, entityId(listing)).filter(active) : [];
  const nextSchedule = schedules[0] || null;
  const item = listing ? catalogItem(data, listing) : null;
  return {
    id: entityId(route),
    listingId: route.listingId || '',
    routeName: route.routeName || '',
    origin: route.origin || '',
    destination: route.destination || '',
    corridor: route.corridor || '',
    boardingPoints: Array.isArray(route.boardingPoints) ? route.boardingPoints : [],
    scheduleCount: schedules.length,
    availableSeats: schedules.reduce((sum, row) => sum + number(row.availableSeats), 0),
    nextDepartAt: nextSchedule?.departAt || null,
    bookingUrl: item?.bookingUrl || '',
    listingUrl: item?.url || '',
    listing: item,
  };
}

function availability(data, listing) {
  if (!listing) return null;
  const listingId = entityId(listing);
  const serviceType = canonicalServiceType(listing, data);
  const schedules = listingSchedules(data, listingId).filter(active).sort((a, b) => (asDate(a.departAt)?.getTime() || 0) - (asDate(b.departAt)?.getTime() || 0));
  const selected = schedules[0];
  if (serviceType === 'bus') return { listing, schedules, scheduleId: entityId(selected), seats: selected ? scheduleSeats(data, entityId(selected)) : [] };
  if (serviceType === 'hotel') return { listing, rooms: listingRooms(data, listingId) };
  if (['tour', 'car_rental', 'cargo'].includes(serviceType)) return { listing, remainingInventory: number(listing.remainingInventory || listing.inventory), serviceType };
  return null;
}

function listingPreview(data, listing, currentAvailability, company) {
  const current = currentAvailability || availability(data, listing) || {};
  const rooms = current.rooms || [];
  const seats = current.seats || [];
  const fareCatalog = listing.serviceType === 'bus' ? fareCatalogForListing(data, entityId(listing)) : { products: [], priceFrom: 0, fullRoutePrice: 0, currency: '' };
  const subtotal = number(current.fare?.baseAmountPerSeat || fareCatalog.priceFrom || listing.priceFrom || listing.price);
  const customerFees = calculateCustomerFees(subtotal);
  return {
    currency: fareCatalog.currency || listing.currency || data.platformConfig?.defaultCurrency || '', subtotal, serviceFee: customerFees.totalFees, totalEstimate: customerFees.total,
    fareProducts: fareCatalog.products, fullRoutePrice: fareCatalog.fullRoutePrice,
    serviceIcon: ({ hotel: 'fa-hotel', bus: 'fa-bus', tour: 'fa-map-location-dot', car_rental: 'fa-car-side', cargo: 'fa-box' })[listing.serviceType] || 'fa-ticket',
    previewSeats: seats, previewRooms: rooms.slice(0, 12),
    firstSeat: seats.find((row) => normalize(row.status) === 'available')?.seatNumber || seats[0]?.seatNumber || '',
    firstRoom: entityId(rooms.find((row) => number(row.availableUnits ?? row.inventory) > 0) || rooms[0] || {}),
    selectedPreview: listing.serviceType === 'hotel' ? (rooms[0]?.roomType || rooms[0]?.name || '') : listing.serviceType === 'bus' ? (seats[0]?.seatNumber || '') : listing.serviceType === 'tour' ? 'Tour date and participants' : listing.serviceType === 'car_rental' ? 'Pickup and return dates' : listing.serviceType === 'cargo' ? 'Pickup and delivery details' : '',
    addons: (data.serviceAddons || [])
      .filter((row) => sameId(row.listingId, listing) && normalize(row.serviceType || listing.serviceType) === normalize(listing.serviceType) && normalize(row.status) === 'active' && number(row.price) >= 0)
      .sort((a, b) => number(a.sortOrder) - number(b.sortOrder) || String(a.name || '').localeCompare(String(b.name || '')))
      .map((row) => ({
        id: entityId(row), name: row.name || 'Optional extra', description: row.description || '', category: row.category || 'other', icon: row.icon || 'fa-circle-plus',
        price: number(row.price), currency: String(row.currency || listing.currency || '').toUpperCase(), chargeBasis: row.chargeBasis || 'per_booking', availableFor: row.availableFor || 'all', maxQuantity: Math.max(1, number(row.maxQuantity) || 1),
      })), partnerName: listing.partner || company?.name || '', supportPhone: company?.supportContacts?.phone || company?.supportPhone || company?.phone || '',
    scheduleLabel: current.schedules?.[0]?.departureLabel || current.schedules?.[0]?.departureTime || listing.time || '', ticketAccess: 'Issued after confirmed payment', policy: listing.bookable ? 'Booking available' : 'Booking unavailable', paymentMethods: [],
  };
}

async function search(query = {}) {
  const data = await snapshot();
  const items = data.listings.filter((row) => isPublicListing(row, data)).map((row) => catalogItem(data, row));
  return { data, results: applySearch(items, query) };
}

async function searchWithMeta(query = {}) {
  const { data, results } = await search(query);
  const marketplace = marketplaceInfo(results);
  return { data, results, meta: { total: results.length, marketplace, typeStats: marketplace.typeStats, routeHighlights: marketplace.routeHighlights, query } };
}

function searchOptionValues(values = []) {
  return unique(values.map(text)).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

function searchOptions(data, prebuiltListings = null, airports = []) {
  const listings = Array.isArray(prebuiltListings)
    ? prebuiltListings
    : data.listings.filter((row) => isPublicListing(row, data)).map((row) => catalogItem(data, row));
  const publicListingIds = new Set(listings.map((row) => String(row.id || '')));
  const now = new Date();
  const liveBusRouteIds = new Set((data.schedules || []).filter((schedule) => {
    const status = normalize(schedule.status);
    if (!['published', 'boarding', 'delayed'].includes(status)) return false;
    const liveUntil = asDate(schedule.arriveAt || schedule.departAt);
    return liveUntil && liveUntil >= now;
  }).map((schedule) => String(schedule.routeId || schedule.routeSnapshot?.routeId || '')).filter(Boolean));
  const busRoutes = (data.routes || []).filter((row) => (!row.status || ['active', 'published'].includes(normalize(row.status)))
    && publicListingIds.has(String(row.listingId || ''))
    && liveBusRouteIds.has(String(entityId(row) || row.id || '')));
  const byType = (type) => listings.filter((item) => item.serviceType === type);
  const locations = (items, fields) => searchOptionValues(items.flatMap((item) => fields.map((field) => item[field]).filter(Boolean)));
  const busOrigins = searchOptionValues(busRoutes.map((row) => row.origin || row.from));
  const busDestinations = searchOptionValues(busRoutes.map((row) => row.destination || row.to));
  const hotelItems = byType('hotel');
  const taxiItems = byType('local_transport');
  const tourItems = byType('tour');
  const rentalItems = byType('car_rental');
  const cargoItems = byType('cargo');
  const hotelDestinations = locations(hotelItems, ['city', 'location', 'address']);
  const taxiOrigins = locations(taxiItems, ['from', 'city']);
  const taxiDestinations = locations(taxiItems, ['to', 'city', 'location']);
  const tourDestinations = locations(tourItems, ['city', 'to', 'location']);
  const rentalOrigins = locations(rentalItems, ['from', 'city', 'location', 'branchName']);
  const rentalDestinations = locations(rentalItems, ['to', 'city', 'location', 'branchName']);
  const cargoOrigins = locations(cargoItems, ['from', 'city', 'location']);
  const cargoDestinations = locations(cargoItems, ['to', 'city', 'location']);
  const airportOptions = (airports || []).map((airport) => ({
    value: text(airport.iataCode || airport.id),
    label: [airport.iataCode, airport.city, airport.name, airport.country].map(text).filter(Boolean).join(' · '),
  })).filter((row) => row.value && row.label);
  const generalOrigins = searchOptionValues([
    ...busOrigins,
    ...listings.map((item) => item.from || item.city || ''),
  ]);
  const generalDestinations = searchOptionValues([
    ...busDestinations,
    ...listings.map((item) => item.to || item.city || item.location || ''),
  ]);
  return {
    all: { origins: generalOrigins, destinations: generalDestinations },
    bus: {
      origins: busOrigins,
      destinations: busDestinations,
      pairs: busRoutes.map((row) => ({ origin: text(row.origin || row.from), destination: text(row.destination || row.to), routeId: entityId(row) })).filter((row) => row.origin && row.destination),
    },
    hotel: { destinations: hotelDestinations },
    flight: { airports: airportOptions },
    local_transport: { origins: taxiOrigins, destinations: taxiDestinations },
    tour: { destinations: tourDestinations },
    car_rental: { origins: rentalOrigins, destinations: rentalDestinations.length ? rentalDestinations : rentalOrigins },
    cargo: { origins: cargoOrigins, destinations: cargoDestinations },
  };
}

function buildHomeBootstrap(data, airports = []) {
  const listings = data.listings.filter((row) => isPublicListing(row, data)).map((row) => catalogItem(data, row));
  const marketplace = marketplaceInfo(listings);
  const campaigns = data.campaigns
    .filter((campaign) => normalize(campaign.status) === 'active' && listings.some((listing) => sameId(listing.id, campaign.listingId)))
    .map((campaign) => ({ id: entityId(campaign), name: campaign.name || '', listingId: campaign.listingId || '', companyId: campaign.companyId || '', placement: campaign.placement || '', startsAt: campaign.startsAt || null, endsAt: campaign.endsAt || null }));
  return {
    generatedAt: new Date().toISOString(),
    listings,
    categories: data.categories,
    companies: data.companies.map((row) => publicCompany(data, row)).filter((row) => row.verificationStatus === 'verified' && row.activeListingsCount > 0),
    routes: data.routes.filter((row) => active(row) && listings.some((listing) => sameId(listing.id, row.listingId))).map((row) => publicRoute(data, row)),
    campaigns,
    blogs: data.blogs.filter((row) => normalize(row.status) === 'published').slice(0, 4).map((row) => ({ id: entityId(row), slug: row.slug || entityId(row), title: row.title || '', excerpt: row.excerpt || '', image: row.image || row.coverImage || '', tag: row.tag || '', publishedAt: row.publishedAt || row.createdAt || null, url: `/blogs/${row.slug || entityId(row)}` })),
    serviceStats: data.categories.map((category) => { const rows = listings.filter((item) => item.serviceType === category.key); return { ...category, count: rows.length, available: rows.reduce((sum, row) => sum + row.remainingInventory, 0) }; }),
    corridorStats: routeHighlights(listings),
    marketplace,
    heroStats: { liveRoutes: marketplace.routeHighlights.length, verifiedPartners: marketplace.stats.partners, bookableInventory: listings.filter((row) => row.bookable).length, totalServices: marketplace.stats.liveListings, availableNow: marketplace.stats.availableNow, departuresNext24h: marketplace.stats.departuresNext24h },
    searchOptions: searchOptions(data, listings, airports),
  };
}

async function refreshHomeBootstrap() {
  if (homeBootstrapInflight) return homeBootstrapInflight;
  homeBootstrapInflight = Promise.all([
    snapshot(),
    flightSearchService.listAirports().catch(() => []),
  ])
    .then(([data, airports]) => buildHomeBootstrap(data, airports))
    .then((value) => {
      homeBootstrapCache = value;
      homeBootstrapCachedAt = Date.now();
      return value;
    })
    .finally(() => { homeBootstrapInflight = null; });
  return homeBootstrapInflight;
}

async function homeBootstrap(options = {}) {
  const age = homeBootstrapCache ? Date.now() - homeBootstrapCachedAt : Infinity;
  if (!options.force && homeBootstrapCache && age <= env.performance.homeViewCacheTtlMs) return homeBootstrapCache;
  if (!options.force && homeBootstrapCache && age <= env.performance.homeViewCacheStaleMs) {
    refreshHomeBootstrap().catch(() => {});
    return homeBootstrapCache;
  }
  try {
    return await refreshHomeBootstrap();
  } catch (error) {
    if (homeBootstrapCache) return homeBootstrapCache;
    throw error;
  }
}

async function recordReferralClick(code, listingId, request = {}) {
  const key = normalize(code);
  const link = await promoterRepository.links.findOne({ status: { $ne: 'archived' }, $or: [{ code }, { code: key }] });
  const click = { id: await nextId('referral-click'), linkId: link?.id || null, promoterId: link?.promoterId || null, listingId: listingId || link?.listingId || null, code: text(code), ip: request.ip || '', userAgent: request.headers?.['user-agent'] || '', createdAt: new Date().toISOString() };
  await promoterRepository.clicks.save(click, { id: click.id });
  if (link) { link.clicks = number(link.clicks) + 1; link.updatedAt = new Date().toISOString(); await promoterRepository.links.save(link, { id: link.id }); }
  return click;
}

module.exports = { snapshot, snapshotForListing, prewarmHome, invalidateMarketplaceCache, companyFor, listingFor, isPublicListing, catalogItem, publicCompany, publicRoute, availability, listingPreview, marketplaceInfo, routeHighlights, searchOptions, applySearch, search, searchWithMeta, homeBootstrap, recordReferralClick, fareCatalogForListing, entityId, sameId, canonicalServiceType, relatedSchedulesForListing };
