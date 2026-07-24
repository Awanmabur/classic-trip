const commerceRepository = require('../../repositories/domain/commerceRepository');
const contentRepository = require('../../repositories/domain/contentRepository');
const promoterRepository = require('../../repositories/domain/promoterRepository');
const { publicCatalogGroup } = require('./catalogGrouping');
const { entityId, sameId, canonicalServiceType, relatedSchedulesForListing, isPublicListing: publicListingVisible } = require('./catalogVisibility');
const { calculateCustomerFees } = require('../../utils/calculateCustomerFees');
const { getPlatformConfig } = require('../platform/platformConfigService');
const { nextId } = require('../data/idService');

const SERVICE_LABELS = { bus: 'Bus', hotel: 'Hotel' };
const TYPE_ORDER = ['bus', 'hotel'];
const PRODUCTION_SERVICE_TYPES = new Set(TYPE_ORDER);

function normalize(value) { return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_'); }
function text(value) { return String(value || '').trim(); }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function asDate(value) { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date : null; }
function active(row) { return ['active', 'published', 'verified', 'approved', 'boarding', 'delayed'].includes(normalize(row?.status)); }
function isPublicListing(row, data = {}) { return publicListingVisible(row, data && typeof data === 'object' && !Array.isArray(data) ? data : {}); }

async function snapshot() {
  const [categories, listings, companies, routes, routeStops, fareProducts, segmentFares, serviceAddons, schedules, seats, vehicles, roomTypes, roomUnits, roomNights, links, campaigns, blogs, platformConfig] = await Promise.all([
    commerceRepository.categories.list({}, { sort: { order: 1, name: 1 }, limit: 500 }),
    commerceRepository.listings.list({}, { sort: { createdAt: -1 }, limit: 5000 }),
    commerceRepository.companies.list({}, { sort: { name: 1 }, limit: 2000 }),
    commerceRepository.routes.list({}, { sort: { createdAt: -1 }, limit: 5000 }),
    commerceRepository.routeStops.list({ status: { $ne: 'archived' } }, { sort: { routeId: 1, stopOrder: 1 }, limit: 20000 }),
    commerceRepository.fareProducts.list({ status: { $ne: 'archived' } }, { sort: { createdAt: -1 }, limit: 10000 }),
    commerceRepository.segmentFares.list({ status: { $ne: 'archived' } }, { sort: { routeId: 1, fromOrder: 1, toOrder: 1 }, limit: 30000 }),
    commerceRepository.serviceAddons.list({ status: { $ne: 'archived' } }, { sort: { listingId: 1, sortOrder: 1, createdAt: 1 }, limit: 10000 }),
    commerceRepository.schedules.list({}, { sort: { departAt: 1 }, limit: 10000 }),
    commerceRepository.seats.list({}, { limit: 50000 }),
    commerceRepository.vehicles.list({}, { limit: 10000 }),
    commerceRepository.roomTypes.list({}, { limit: 10000 }),
    commerceRepository.roomUnits.list({}, { limit: 20000 }),
    commerceRepository.roomNights.list({}, { limit: 50000 }),
    promoterRepository.links.list({ status: { $ne: 'archived' } }, { sort: { createdAt: -1 }, limit: 5000 }),
    contentRepository.promotionCampaigns.list({}, { sort: { createdAt: -1 }, limit: 5000 }),
    contentRepository.blogs.list({}, { sort: { publishedAt: -1, createdAt: -1 }, limit: 500 }),
    getPlatformConfig(),
  ]);
  const productionListings = listings.filter((row) => PRODUCTION_SERVICE_TYPES.has(canonicalServiceType(row, { listings, companies })));
  const productionCategories = categories.filter((row) => PRODUCTION_SERVICE_TYPES.has(normalize(row.key || row.serviceType || row.slug || row.name)));
  return { categories: productionCategories, listings: productionListings, companies, routes, routeStops, fareProducts, segmentFares, serviceAddons, schedules, seats, vehicles, roomTypes, roomUnits, roomNights, links, campaigns, blogs, platformConfig };
}

function companyFor(data, identifier) {
  const key = normalize(identifier);
  return data.companies.find((row) => [entityId(row), row.slug, row.name].some((value) => normalize(value) === key)) || null;
}

function listingFor(data, identifier, serviceType = '') {
  const key = normalize(identifier);
  const type = normalize(serviceType);
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
      routeLabel: route.routeName || [route.origin, route.destination].filter(Boolean).join(' → '),
      currency: String(product.currency || fullRoute?.currency || '').toUpperCase(),
      refundable: Boolean(product.refundable),
      changeable: Boolean(product.changeable),
      baggageAllowanceKg: number(product.baggageAllowanceKg),
      segments,
      segmentCount: segments.length,
      fullRouteAmount: number(fullRoute?.amount),
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
    return {
      ...roomType,
      roomTypeId,
      roomType: roomType.name || roomType.title,
      inventory: units.length,
      availableUnits: units.length,
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

function catalogItem(data, listing) {
  const stableId = entityId(listing);
  const company = companyFor(data, listing.companyId || listing.companySlug);
  const schedules = listingSchedules(data, stableId).filter((row) => active(row));
  const nextSchedule = schedules.filter((row) => !asDate(row.departAt) || asDate(row.departAt) >= new Date()).sort((a, b) => (asDate(a.departAt)?.getTime() || 0) - (asDate(b.departAt)?.getTime() || 0))[0] || schedules[0];
  const seats = nextSchedule ? scheduleSeats(data, entityId(nextSchedule)) : [];
  const rooms = listingRooms(data, stableId);
  const availableSeats = seats.filter((row) => normalize(row.status) === 'available').length;
  const roomInventory = rooms.reduce((sum, row) => sum + Math.max(0, number(row.inventory || row.availableUnits || row.available)), 0);
  const serviceType = canonicalServiceType(listing, data);
  const remainingInventory = serviceType === 'bus'
    ? (seats.length ? availableSeats : number(nextSchedule?.availableSeats || listing.availableSeats || listing.inventory))
    : serviceType === 'hotel'
      ? (roomInventory || number(listing.availableRooms || listing.inventory))
      : number(listing.remainingInventory || listing.inventory || listing.availability);
  const route = listingRoutes(data, stableId)[0] || {};
  const fareCatalog = serviceType === 'bus' ? fareCatalogForListing(data, stableId) : { products: [], priceFrom: 0, fullRoutePrice: 0, currency: '' };
  const from = listing.from || route.origin || route.from || listing.city || '';
  const to = listing.to || route.destination || route.to || listing.location || '';
  const priceFrom = number(fareCatalog.priceFrom || listing.priceFrom || listing.price || nextSchedule?.basePrice || nextSchedule?.price || rooms[0]?.price);
  const bookable = PRODUCTION_SERVICE_TYPES.has(serviceType) && listing.bookable !== false && active(listing) && remainingInventory > 0;
  const policy = text(listing.policy || listing.cancellationRules || listing.cancellationPolicy || listing.refundPolicy);
  const nextDepartAt = nextSchedule?.departAt || listing.nextDepartAt || null;
  const nextDepartDate = asDate(nextDepartAt);
  const nextDepartLabel = nextDepartDate
    ? nextDepartDate.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: nextSchedule?.timezone || 'UTC' })
    : serviceType === 'hotel' ? 'Choose stay dates' : '';
  const bookableReason = bookable
    ? (serviceType === 'bus' ? 'Published departure available' : 'Live inventory available')
    : remainingInventory <= 0 ? 'No inventory available' : 'Booking unavailable';
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
    routeLabel: listing.routeLabel || [from, to].filter(Boolean).join(' → ') || listing.title,
    nextDepartAt,
    nextDepartLabel,
    time: nextDepartLabel,
    scheduleId: entityId(nextSchedule || {}),
    remainingInventory,
    availability: remainingInventory,
    availableSeats,
    availableRooms: roomInventory,
    unitsLabel: serviceType === 'bus' ? `${remainingInventory} seat${remainingInventory === 1 ? '' : 's'} available` : `${remainingInventory} room${remainingInventory === 1 ? '' : 's'} available`,
    priceFrom,
    price: priceFrom,
    fullRoutePrice: number(fareCatalog.fullRoutePrice || priceFrom),
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
    url: `/listings/${serviceType}/${listing.slug || stableId}`,
    bookingUrl: bookable ? `/book/${serviceType}/${listing.slug || stableId}` : '',
    companyUrl: `/companies/${company?.slug || entityId(company || {})}`,
    searchText: normalize([listing.title, listing.description, from, to, listing.city, listing.country, company?.name, serviceType].join(' ')),
  };
  return enriched;
}

function score(item) {
  return (item.isSponsored ? 15 : 0) + (item.isVerified ? 10 : 0) + (item.bookable ? 8 : 0)
    + number(item.ratingAverage) * 10 + Math.min(number(item.reviewCount), 500) / 20
    + Math.min(number(item.remainingInventory), 60) / 6;
}

function applySearch(items, query = {}) {
  const q = normalize(query.q || query.search);
  const serviceType = normalize(query.serviceType || query.type || '');
  const city = normalize(query.city);
  const country = normalize(query.country);
  const origin = normalize(query.origin || query.from);
  const destination = normalize(query.destination || query.to);
  const partner = normalize(query.partner || query.company);
  const min = number(query.minPrice || query.min);
  const max = number(query.maxPrice || query.max);
  const minRating = number(query.minRating || query.rating);
  let rows = items.filter((item) => {
    if (q && !item.searchText.includes(q)) return false;
    if (serviceType && serviceType !== 'all' && normalize(item.serviceType) !== serviceType && normalize(item.group) !== serviceType) return false;
    if (city && !normalize(`${item.city} ${item.from} ${item.to}`).includes(city)) return false;
    if (country && !normalize(item.country).includes(country)) return false;
    if (origin && !normalize(item.from).includes(origin)) return false;
    if (destination && !normalize(item.to).includes(destination)) return false;
    if (partner && !normalize(`${item.partner} ${item.companyName}`).includes(partner)) return false;
    if (min && item.priceFrom < min) return false;
    if (max && item.priceFrom > max) return false;
    if (minRating && item.ratingAverage < minRating) return false;
    if ((query.verified === 'true' || query.verified === true) && !item.isVerified) return false;
    if ((query.bookable === 'true' || query.bookable === true) && !item.bookable) return false;
    if ((query.sponsored === 'true' || query.sponsored === true) && !item.isSponsored) return false;
    if ((query.available === 'true' || query.availableOnly === 'true' || query.availableOnly === true) && item.remainingInventory <= 0) return false;
    return true;
  });
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
    bookableListingsCount: listings.filter((row) => row.bookable !== false).length,
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
    serviceIcon: ({ hotel: 'fa-hotel', bus: 'fa-bus' })[listing.serviceType] || 'fa-ticket',
    previewSeats: seats, previewRooms: rooms.slice(0, 12),
    firstSeat: seats.find((row) => normalize(row.status) === 'available')?.seatNumber || seats[0]?.seatNumber || '',
    firstRoom: entityId(rooms.find((row) => number(row.inventory) > 0) || rooms[0] || {}),
    selectedPreview: listing.serviceType === 'hotel' ? (rooms[0]?.roomType || rooms[0]?.name || '') : (seats[0]?.seatNumber || ''),
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

async function homeBootstrap() {
  const data = await snapshot();
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
  };
}

async function recordReferralClick(code, listingId, request = {}) {
  const key = normalize(code);
  const link = await promoterRepository.links.findOne({ status: { $ne: 'archived' }, $or: [{ code }, { code: key }] });
  const click = { id: await nextId('referral-click'), linkId: link?.id || null, promoterId: link?.promoterId || null, listingId: listingId || link?.listingId || null, code: text(code), ip: request.ip || '', userAgent: request.headers?.['user-agent'] || '', createdAt: new Date().toISOString() };
  await promoterRepository.clicks.save(click, { id: click.id });
  if (link) { link.clicks = number(link.clicks) + 1; link.updatedAt = new Date().toISOString(); await promoterRepository.links.save(link, { id: link.id }); }
  return click;
}

module.exports = { snapshot, companyFor, listingFor, isPublicListing, catalogItem, publicCompany, publicRoute, availability, listingPreview, marketplaceInfo, routeHighlights, applySearch, search, searchWithMeta, homeBootstrap, recordReferralClick, fareCatalogForListing, entityId, sameId, canonicalServiceType, relatedSchedulesForListing };
