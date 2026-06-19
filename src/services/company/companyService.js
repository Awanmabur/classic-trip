const store = require('../data/persistentStore');
const toSlug = require('../../utils/slugify');
const { ENABLED_BOOKING_TYPES, COMPANY_STATUS, LISTING_STATUS } = require('../../config/constants');
const { mongoose } = require('../../config/db');

const SERVICE_LABELS = {
  bus: 'Bus',
  hotel: 'Hotel',
  flight: 'Flight',
  train: 'Train',
  ferry: 'Ferry',
  tour: 'Tour',
  car_rental: 'Car rental',
  airport_transfer: 'Airport transfer',
  event: 'Event',
  cargo: 'Cargo',
  visa: 'Visa support',
  insurance: 'Travel insurance',
  package: 'Travel package',
};

const ROUTED_SERVICE_TYPES = ['bus', 'flight', 'train', 'ferry', 'tour', 'airport_transfer', 'package', 'cargo'];
const VEHICLE_SERVICE_TYPES = ['bus', 'flight', 'train', 'ferry', 'tour', 'airport_transfer', 'car_rental', 'cargo'];
const timelineService = require('../support/timelineService');

function mongoReady() {
  return mongoose.connection.readyState === 1;
}

async function upsertModel(modelName, row, filter = { id: row.id }) {
  if (!mongoReady()) return;
  require(`../../models/${modelName}`);
  const Model = mongoose.model(modelName);
  await Model.updateOne(filter, { $set: row }, { upsert: true, runValidators: true });
}

async function upsertMany(modelName, rows) {
  if (!mongoReady() || !rows.length) return;
  require(`../../models/${modelName}`);
  const Model = mongoose.model(modelName);
  await Model.bulkWrite(rows.map((row) => ({
    updateOne: {
      filter: { id: row.id },
      update: { $set: row },
      upsert: true,
    },
  })));
}

function normalize(value) {
  return String(value || '').toLowerCase().trim();
}

function cleanText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

function moneyValue(value, fallback = 0) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : fallback;
}

function parseList(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  return String(value || '')
    .split(',')
    .map(cleanText)
    .filter(Boolean);
}

function parseStops(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return parseList(value).map((name, index) => ({ name, stopOrder: index + 1 }));
  }
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function payloadMedia(payload = {}, label = 'Classic Trip media') {
  const asset = payload.mediaAsset || payload.uploadedMedia || payload.asset;
  if (asset && (asset.url || asset.secureUrl)) {
    const url = cleanText(asset.secureUrl || asset.url);
    return [{
      url,
      secureUrl: url,
      publicId: cleanText(asset.publicId || asset.public_id || url),
      resourceType: cleanText(asset.resourceType || asset.resource_type || 'image'),
      width: asset.width,
      height: asset.height,
      format: asset.format,
      alt: cleanText(asset.alt || label),
      label: cleanText(asset.label || label),
    }];
  }
  const url = cleanText(payload.imageUrl || payload.image || payload.mediaUrl || payload.photoUrl || '');
  if (!url) return [];
  return [{
    url,
    secureUrl: url,
    publicId: cleanText(payload.imagePublicId || payload.publicId || url),
    resourceType: 'image',
    alt: cleanText(payload.imageAlt || label),
    label: cleanText(payload.imageLabel || label),
  }];
}

function nextId(prefix, rows) {
  let index = rows.length + 1;
  let id = `${prefix}-${index}`;
  while (rows.some((row) => row.id === id)) {
    index += 1;
    id = `${prefix}-${index}`;
  }
  return id;
}

function uniqueSlug(base, rows, existingId = '') {
  const root = toSlug(base) || `item-${Date.now()}`;
  let slug = root;
  let index = 1;
  while (rows.some((row) => row.slug === slug && row.id !== existingId)) {
    index += 1;
    slug = `${root}-${index}`;
  }
  return slug;
}

function seatNumbers(totalSeats) {
  return Array.from({ length: Math.max(0, Math.round(moneyValue(totalSeats, 0))) }, (_, index) => String(index + 1));
}

function cleanSeatNumber(value, index = 0) {
  const raw = cleanText(value || '');
  const numeric = raw.match(/\d+/);
  return numeric ? String(Number(numeric[0])) : String(index + 1);
}

function layoutSeatCount(layoutName, rows, fallback = 32) {
  const safeRows = Math.max(1, Math.round(moneyValue(rows, 0)));
  if (!safeRows) return Math.max(1, Math.round(moneyValue(fallback, 32)));
  const layout = normalize(layoutName || '2x2');
  if (layout === '2x1') return safeRows * 3;
  if (layout === '2x3') return safeRows * 5;
  if (layout === 'sleeper') return safeRows * 3;
  if (layout === 'flight-3x3') return safeRows * 6;
  return safeRows * 4;
}

function generateVehicleSeats(totalSeats, cols = 4) {
  const columnCount = Math.max(1, Math.round(moneyValue(cols, 4)));
  return seatNumbers(totalSeats).map((seatNumber, index) => ({
    id: seatNumber,
    seatNumber,
    row: Math.floor(index / columnCount) + 1,
    col: (index % columnCount) + 1,
    deck: 'main',
    label: seatNumber,
    displayLabel: `Seat No ${seatNumber}`,
    seatType: index < 4 ? 'vip' : 'standard',
    seatClass: index < 4 ? 'VIP' : 'Standard',
    status: 'available',
    isAisle: false,
    isDisabled: false,
  }));
}

function buildVehicleSeatTemplate({ labels = [], totalSeats = 32, cols = 4, defaultSeatClass = 'Standard', vipSeats = [], disabledSeats = [], blockedSeats = [], vipPriceDelta = 0 } = {}) {
  const rawLabels = parseList(labels);
  const safeLabels = rawLabels.length ? rawLabels.map((label, index) => cleanSeatNumber(label, index)) : seatNumbers(Math.max(1, Math.round(moneyValue(totalSeats, 32))));
  const columnCount = Math.max(1, Math.round(moneyValue(cols, 4)));
  const vipSet = new Set(parseList(vipSeats).map((item, index) => cleanSeatNumber(item, index)));
  const disabledSet = new Set(parseList(disabledSeats).map((item, index) => cleanSeatNumber(item, index)));
  const blockedSet = new Set(parseList(blockedSeats).map((item, index) => cleanSeatNumber(item, index)));
  return safeLabels.map((label, index) => {
    const seatNumber = cleanSeatNumber(label, index);
    const isVip = vipSet.has(seatNumber);
    const isDisabled = disabledSet.has(seatNumber);
    const isBlocked = blockedSet.has(seatNumber);
    return {
      id: seatNumber,
      seatNumber,
      row: Math.floor(index / columnCount) + 1,
      col: (index % columnCount) + 1,
      deck: 'main',
      label: seatNumber,
      displayLabel: `Seat No ${seatNumber}`,
      seatType: isDisabled ? 'disabled' : isVip ? 'vip' : normalize(defaultSeatClass || 'standard'),
      seatClass: isDisabled ? 'Disabled' : isVip ? 'VIP' : cleanText(defaultSeatClass || 'Standard'),
      priceDelta: isVip ? moneyValue(vipPriceDelta, 0) : 0,
      status: isDisabled ? 'disabled' : isBlocked ? 'blocked' : 'available',
      blockedReason: isBlocked ? 'Blocked from vehicle template' : '',
      isAisle: false,
      isDisabled,
    };
  });
}

function vehicleSeatNumbers(vehicle = {}, fallbackTotalSeats = 32) {
  const templateSeats = Array.isArray(vehicle.seats) ? vehicle.seats : [];
  const numbers = templateSeats
    .filter((seat) => !seat.isAisle && !seat.isDisabled)
    .map((seat) => cleanText(seat.seatNumber || seat.id || seat.label))
    .filter(Boolean);
  if (numbers.length) return numbers;
  return seatNumbers(Math.max(1, Math.round(moneyValue(vehicle.totalSeats, fallbackTotalSeats))));
}

function ensureStateCollections() {
  if (!Array.isArray(store.state.companyEmployees)) store.state.companyEmployees = [];
  if (!Array.isArray(store.state.companyBranches)) store.state.companyBranches = [];
  if (!Array.isArray(store.state.companyPolicies)) store.state.companyPolicies = [];
  if (!Array.isArray(store.state.driverAssignments)) store.state.driverAssignments = [];
  if (!Array.isArray(store.state.driverIncidents)) store.state.driverIncidents = [];
  if (!Array.isArray(store.state.tripStatusUpdates)) store.state.tripStatusUpdates = [];
  if (!Array.isArray(store.state.vehicles)) store.state.vehicles = [];
  if (!Array.isArray(store.state.routeStops)) store.state.routeStops = [];
}

function findCompanyOrThrow(companyId) {
  const company = store.findCompany(companyId);
  if (!company) {
    const error = new Error('Company not found');
    error.status = 404;
    throw error;
  }
  return company;
}

function companyCanPublish(company) {
  return company.verificationStatus === COMPANY_STATUS.VERIFIED && company.settings?.canPublish !== false;
}

function ensureCompanyCanPublish(company) {
  if (!companyCanPublish(company)) {
    const error = new Error('Company must be verified before publishing listings or receiving bookings');
    error.status = 403;
    throw error;
  }
}

function findCompanyListing(companyId, listingId) {
  const key = normalize(listingId);
  return store.state.listings.find((listing) => listing.companyId === companyId && [listing.id, listing.slug].some((value) => normalize(value) === key));
}

function findCompanyListingOrThrow(companyId, listingId) {
  const listing = findCompanyListing(companyId, listingId);
  if (!listing) {
    const error = new Error('Listing not found for this company');
    error.status = 404;
    throw error;
  }
  return listing;
}

function findCompanyRouteOrThrow(companyId, routeId) {
  const route = store.state.routes.find((item) => item.id === routeId && item.companyId === companyId);
  if (!route) {
    const error = new Error('Route not found for this company');
    error.status = 404;
    throw error;
  }
  return route;
}

function findCompanyRouteStopOrThrow(companyId, stopId) {
  ensureStateCollections();
  const stop = store.state.routeStops.find((item) => item.id === stopId && item.companyId === companyId);
  if (!stop) {
    const error = new Error('Route stop not found for this company');
    error.status = 404;
    throw error;
  }
  return stop;
}

function refreshRouteStopsSnapshot(route) {
  ensureStateCollections();
  const stops = store.state.routeStops
    .filter((stop) => stop.routeId === route.id && stop.status !== 'archived')
    .sort((a, b) => Number(a.stopOrder || 0) - Number(b.stopOrder || 0));
  route.stops = stops.map((stop) => ({
    id: stop.id,
    name: stop.name,
    stopType: stop.stopType,
    stopOrder: stop.stopOrder,
    timeOffsetMinutes: stop.timeOffsetMinutes,
    pickupAllowed: stop.pickupAllowed,
    dropoffAllowed: stop.dropoffAllowed,
    publicInstructions: stop.publicInstructions,
    status: stop.status,
  }));
  return route;
}

function findCompanyScheduleOrThrow(companyId, scheduleId) {
  const schedule = store.state.schedules.find((item) => item.id === scheduleId && item.companyId === companyId);
  if (!schedule) {
    const error = new Error('Schedule not found for this company');
    error.status = 404;
    throw error;
  }
  return schedule;
}

function findCompanyRoomOrThrow(companyId, roomId) {
  const room = store.state.rooms.find((item) => item.id === roomId && item.companyId === companyId);
  if (!room) {
    const error = new Error('Room not found for this company');
    error.status = 404;
    throw error;
  }
  return room;
}

function findCompanyVehicleOrThrow(companyId, vehicleId) {
  ensureStateCollections();
  const vehicle = store.state.vehicles.find((item) => item.id === vehicleId && item.companyId === companyId);
  if (!vehicle) {
    const error = new Error('Vehicle not found for this company');
    error.status = 404;
    throw error;
  }
  return vehicle;
}

function findCompanyEmployeeOrThrow(companyId, employeeId) {
  ensureStateCollections();
  const employee = store.state.companyEmployees.find((item) => item.companyId === companyId && (item.id === employeeId || item.userId === employeeId));
  if (!employee) {
    const error = new Error('Employee not found for this company');
    error.status = 404;
    throw error;
  }
  return employee;
}

function employeeUser(employee = {}) {
  return store.state.users.find((user) => user.id === employee.userId) || {};
}

function boolValue(value) {
  return value === true || value === 'true' || value === 'on' || value === '1' || value === 1;
}

function audit(actorId, action, target, meta = {}) {
  store.state.auditLogs.push({
    id: `audit-${store.state.auditLogs.length + 1}`,
    actorId,
    action,
    target,
    meta,
    createdAt: new Date().toISOString(),
  });
}

function recalculateScheduleAvailability(schedule) {
  const seats = store.seatsForSchedule(schedule.id);
  schedule.totalSeats = seats.length || Number(schedule.totalSeats || 0);
  schedule.availableSeats = seats.filter((seat) => seat.status === 'available').length;
  schedule.updatedAt = new Date().toISOString();
  return schedule;
}

function listingType(serviceType) {
  return SERVICE_LABELS[serviceType] || serviceType;
}

function listingRouteLabel(payload) {
  if (payload.from || payload.to) return [payload.from, payload.to].filter(Boolean).join(' to ');
  return payload.city || payload.country || '';
}

async function createCompany(payload = {}) {
  const name = cleanText(payload.name);
  if (!name) {
    const error = new Error('Company name is required');
    error.status = 422;
    throw error;
  }
  const company = {
    id: nextId('company', store.state.companies),
    ownerId: payload.ownerId || null,
    name,
    slug: uniqueSlug(payload.slug || name, store.state.companies),
    companyType: cleanText(payload.companyType || payload.type || 'partner'),
    country: cleanText(payload.country || 'Uganda'),
    city: cleanText(payload.city || 'Kampala'),
    description: cleanText(payload.description || 'Classic Trip partner application.'),
    verificationStatus: COMPANY_STATUS.PENDING,
    documents: [],
    supportContacts: {
      phone: cleanText(payload.phone || '+256 700 000 000'),
      email: cleanText(payload.email || 'support@classictrip.example'),
      whatsapp: cleanText(payload.whatsapp || payload.phone || '+256 700 000 999'),
    },
    ratingAverage: 0,
    reviewCount: 0,
    settings: { instantConfirmation: false, canPublish: false },
    createdAt: new Date().toISOString(),
  };
  store.state.companies.push(company);
  await upsertModel('Company', company);
  return company;
}

async function setVerificationStatus(identifier, status = COMPANY_STATUS.VERIFIED, adminId = 'admin-system', review = {}) {
  const company = findCompanyOrThrow(identifier);
  if (!Object.values(COMPANY_STATUS).includes(status)) {
    const error = new Error('Invalid company verification status');
    error.status = 422;
    throw error;
  }
  company.verificationStatus = status;
  company.settings = {
    ...(company.settings || {}),
    canPublish: status === COMPANY_STATUS.VERIFIED,
    instantConfirmation: status === COMPANY_STATUS.VERIFIED,
  };
  company.reviewedBy = adminId;
  company.reviewedAt = new Date().toISOString();
  company.reviewNotes = cleanText(review.note || review.reviewNotes || company.reviewNotes || '');
  company.documents = (Array.isArray(company.documents) ? company.documents : []).map((document) => {
    if (status === COMPANY_STATUS.VERIFIED) {
      return { ...document, status: 'approved', reviewedBy: adminId, reviewedAt: company.reviewedAt, reviewNotes: company.reviewNotes };
    }
    if (status === COMPANY_STATUS.REJECTED) {
      return { ...document, status: 'rejected', reviewedBy: adminId, reviewedAt: company.reviewedAt, reviewNotes: company.reviewNotes };
    }
    if (status === COMPANY_STATUS.SUSPENDED) {
      return { ...document, status: document.status === 'approved' ? 'suspended' : document.status || 'pending_review', reviewedBy: adminId, reviewedAt: company.reviewedAt, reviewNotes: company.reviewNotes };
    }
    return document;
  });
  if ([COMPANY_STATUS.REJECTED, COMPANY_STATUS.SUSPENDED].includes(status)) {
    store.state.listings
      .filter((listing) => listing.companyId === company.id && listing.status === LISTING_STATUS.ACTIVE)
      .forEach((listing) => {
        listing.status = LISTING_STATUS.PAUSED;
        listing.bookable = false;
      });
  }
  store.state.auditLogs.push({
    id: `audit-${store.state.auditLogs.length + 1}`,
    actorId: adminId,
    action: `company.${status}`,
    target: company.slug,
    createdAt: new Date().toISOString(),
  });
  await upsertModel('Company', company);
  await upsertMany('Listing', store.state.listings.filter((listing) => listing.companyId === company.id));
  return company;
}

async function createListing(companyId, payload = {}) {
  const company = findCompanyOrThrow(companyId);
  const serviceType = normalize(payload.serviceType || payload.group || 'bus').replace('-', '_');
  const wantsActive = payload.publish === true || payload.publish === 'true' || payload.status === LISTING_STATUS.ACTIVE;
  if (wantsActive) ensureCompanyCanPublish(company);
  const title = cleanText(payload.title || `${company.name} ${listingType(serviceType)}`);
  const status = wantsActive ? LISTING_STATUS.ACTIVE : cleanText(payload.status || LISTING_STATUS.DRAFT);
  const bookable = status === LISTING_STATUS.ACTIVE && ENABLED_BOOKING_TYPES.includes(serviceType);
  const media = payloadMedia(payload, title);
  const listing = {
    id: nextId('listing', store.state.listings),
    companyId: company.id,
    companySlug: company.slug,
    companyName: company.name,
    serviceType,
    group: serviceType,
    type: listingType(serviceType),
    title,
    slug: uniqueSlug(`${title}-${company.name}`, store.state.listings),
    sub: cleanText(payload.sub || payload.description || `${company.name} ${listingType(serviceType)} service`),
    country: cleanText(payload.country || company.country || 'Uganda'),
    city: cleanText(payload.city || company.city || ''),
    address: cleanText(payload.address || ''),
    from: cleanText(payload.from || payload.origin || ''),
    to: cleanText(payload.to || payload.destination || ''),
    corridor: cleanText(payload.corridor || listingRouteLabel(payload).toLowerCase().replace(/\s+to\s+/i, '-')),
    price: moneyValue(payload.priceFrom || payload.price),
    priceFrom: moneyValue(payload.priceFrom || payload.price),
    currency: cleanText(payload.currency || 'UGX'),
    media,
    img: media[0]?.url || '',
    amenities: parseList(payload.amenities),
    checkInTime: serviceType === 'hotel' ? cleanText(payload.checkInTime || '14:00') : '',
    checkOutTime: serviceType === 'hotel' ? cleanText(payload.checkOutTime || '11:00') : '',
    serviceNotes: cleanText(payload.serviceNotes || ''),
    contactPhone: cleanText(payload.contactPhone || company.supportContacts?.phone || ''),
    pickupInstructions: cleanText(payload.pickupInstructions || ''),
    dropoffInstructions: cleanText(payload.dropoffInstructions || ''),
    ratingAverage: 0,
    rating: '0',
    reviewCount: 0,
    isSponsored: false,
    isFeatured: false,
    isVerified: company.verificationStatus === COMPANY_STATUS.VERIFIED,
    bookable,
    releaseStatus: bookable ? 'live' : status === LISTING_STATUS.ACTIVE ? 'teaser' : 'draft',
    status,
    policy: cleanText(payload.policy || (bookable ? 'Instant booking after company verification.' : 'Draft listing pending publish.')),
    layout: cleanText(payload.layout || (serviceType === 'hotel' ? 'hotel-rooms' : 'bus-2-2')),
    taken: [],
    cancellationRules: cleanText(payload.cancellationRules || 'Refund rules follow company policy.'),
    baggageRules: cleanText(payload.baggageRules || ''),
    createdAt: new Date().toISOString(),
  };
  store.state.listings.push(listing);
  await upsertModel('Listing', listing);
  if (serviceType === 'hotel' && (payload.roomType || payload.inventory || payload.nightlyPrice)) {
    await createRoom(company.id, {
      listingId: listing.id,
      roomType: payload.roomType || 'Standard Room',
      capacity: payload.capacity || 2,
      nightlyPrice: payload.nightlyPrice || payload.priceFrom || payload.price,
      inventory: payload.inventory || 1,
      amenities: payload.roomAmenities || payload.amenities,
      imageUrl: payload.roomImageUrl || payload.imageUrl,
      status: 'active',
    });
  }
  return listing;
}

async function updateListing(companyId, listingId, payload = {}) {
  const company = findCompanyOrThrow(companyId);
  const listing = findCompanyListingOrThrow(company.id, listingId);
  if (payload.status === LISTING_STATUS.ACTIVE || payload.publish === true || payload.publish === 'true') ensureCompanyCanPublish(company);
  const fields = ['title', 'sub', 'description', 'city', 'country', 'address', 'from', 'to', 'corridor', 'currency', 'policy', 'layout', 'cancellationRules', 'baggageRules', 'checkInTime', 'checkOutTime', 'serviceNotes', 'contactPhone', 'pickupInstructions', 'dropoffInstructions'];
  fields.forEach((field) => {
    if (typeof payload[field] !== 'undefined') listing[field === 'description' ? 'sub' : field] = cleanText(payload[field]);
  });
  if (payload.amenities) listing.amenities = parseList(payload.amenities);
  const media = payloadMedia(payload, listing.title);
  if (media.length) {
    listing.media = Array.isArray(listing.media) ? listing.media : [];
    listing.media.push(media[0]);
    listing.img = listing.img || media[0].url;
  }
  if (typeof payload.priceFrom !== 'undefined' || typeof payload.price !== 'undefined') {
    listing.priceFrom = moneyValue(payload.priceFrom || payload.price, listing.priceFrom);
    listing.price = listing.priceFrom;
  }
  if (payload.status) listing.status = cleanText(payload.status);
  if (payload.title) listing.slug = uniqueSlug(`${listing.title}-${company.name}`, store.state.listings, listing.id);
  listing.isVerified = company.verificationStatus === COMPANY_STATUS.VERIFIED;
  listing.bookable = listing.status === LISTING_STATUS.ACTIVE && ENABLED_BOOKING_TYPES.includes(listing.serviceType) && companyCanPublish(company);
  listing.releaseStatus = listing.bookable ? 'live' : listing.status === LISTING_STATUS.ACTIVE ? 'teaser' : 'draft';
  listing.updatedAt = new Date().toISOString();
  await upsertModel('Listing', listing);
  return listing;
}

async function publishListing(companyId, listingId) {
  return updateListing(companyId, listingId, { status: LISTING_STATUS.ACTIVE });
}

async function archiveListing(companyId, listingId) {
  const listing = findCompanyListingOrThrow(companyId, listingId);
  listing.status = LISTING_STATUS.ARCHIVED;
  listing.bookable = false;
  listing.releaseStatus = 'archived';
  listing.updatedAt = new Date().toISOString();
  await upsertModel('Listing', listing);
  return listing;
}

async function createRoute(companyId, payload = {}) {
  const company = findCompanyOrThrow(companyId);
  const listing = findCompanyListingOrThrow(company.id, payload.listingId || payload.slug);
  if (!ROUTED_SERVICE_TYPES.includes(listing.serviceType)) {
    const error = new Error('Routes and departures can only be created for transport-style listings');
    error.status = 422;
    throw error;
  }
  const origin = cleanText(payload.origin || payload.from || listing.from);
  const destination = cleanText(payload.destination || payload.to || listing.to);
  if (!origin || !destination) {
    const error = new Error('Route origin and destination are required');
    error.status = 422;
    throw error;
  }
  const route = {
    id: nextId('route', store.state.routes),
    listingId: listing.id,
    companyId: company.id,
    routeName: cleanText(payload.routeName || payload.name || `${origin} to ${destination}`),
    origin,
    destination,
    originTerminalId: cleanText(payload.originTerminalId || ''),
    destinationTerminalId: cleanText(payload.destinationTerminalId || ''),
    distanceKm: moneyValue(payload.distanceKm, 0),
    estimatedDuration: cleanText(payload.estimatedDuration || ''),
    estimatedDurationMinutes: Math.round(moneyValue(payload.estimatedDurationMinutes, 0)),
    operatingDays: parseList(payload.operatingDays),
    corridor: cleanText(payload.corridor || `${toSlug(origin)}-${toSlug(destination)}`),
    boardingPoints: parseList(payload.boardingPoints),
    dropoffPoints: parseList(payload.dropoffPoints),
    baggageRules: cleanText(payload.baggageRules || listing.baggageRules || ''),
    cancellationRules: cleanText(payload.cancellationRules || listing.cancellationRules || ''),
    publicInstructions: cleanText(payload.publicInstructions || ''),
    policies: parseList(payload.policies || payload.policyIds),
    status: cleanText(payload.status || 'active'),
    createdAt: new Date().toISOString(),
  };
  const stops = parseStops(payload.stops).map((stop, index) => ({
    id: `route-stop-${store.state.routeStops.length + index + 1}`,
    routeId: route.id,
    listingId: listing.id,
    companyId: company.id,
    name: cleanText(stop.name || stop.stopName || stop.label),
    stopType: cleanText(stop.stopType || stop.type || 'intermediate'),
    stopOrder: Math.round(moneyValue(stop.stopOrder || stop.order, index + 1)),
    timeOffsetMinutes: Math.round(moneyValue(stop.timeOffsetMinutes || stop.offsetMinutes, 0)),
    pickupAllowed: stop.pickupAllowed !== false,
    dropoffAllowed: stop.dropoffAllowed !== false,
    publicInstructions: cleanText(stop.publicInstructions || stop.instructions || ''),
    status: cleanText(stop.status || 'active'),
    createdAt: new Date().toISOString(),
  })).filter((stop) => stop.name);
  route.stops = stops.map((stop) => ({
    id: stop.id,
    name: stop.name,
    stopType: stop.stopType,
    stopOrder: stop.stopOrder,
    timeOffsetMinutes: stop.timeOffsetMinutes,
    pickupAllowed: stop.pickupAllowed,
    dropoffAllowed: stop.dropoffAllowed,
    publicInstructions: stop.publicInstructions,
    status: stop.status,
  }));
  listing.from = origin;
  listing.to = destination;
  listing.corridor = route.corridor;
  store.state.routes.push(route);
  store.state.routeStops.push(...stops);
  await upsertModel('Route', route);
  await upsertMany('RouteStop', stops);
  await upsertModel('Listing', listing);
  return route;
}

async function updateRoute(companyId, routeId, payload = {}) {
  const company = findCompanyOrThrow(companyId);
  const route = findCompanyRouteOrThrow(company.id, routeId);
  const listing = findCompanyListingOrThrow(company.id, route.listingId);
  if (payload.routeName || payload.name) route.routeName = cleanText(payload.routeName || payload.name);
  if (payload.origin || payload.from) route.origin = cleanText(payload.origin || payload.from);
  if (payload.destination || payload.to) route.destination = cleanText(payload.destination || payload.to);
  if (payload.originTerminalId) route.originTerminalId = cleanText(payload.originTerminalId);
  if (payload.destinationTerminalId) route.destinationTerminalId = cleanText(payload.destinationTerminalId);
  if (payload.distanceKm) route.distanceKm = moneyValue(payload.distanceKm, route.distanceKm);
  if (payload.estimatedDuration) route.estimatedDuration = cleanText(payload.estimatedDuration);
  if (payload.estimatedDurationMinutes) route.estimatedDurationMinutes = Math.round(moneyValue(payload.estimatedDurationMinutes, route.estimatedDurationMinutes));
  if (payload.operatingDays) route.operatingDays = parseList(payload.operatingDays);
  if (payload.corridor) route.corridor = cleanText(payload.corridor);
  else route.corridor = `${toSlug(route.origin)}-${toSlug(route.destination)}`;
  if (payload.boardingPoints) route.boardingPoints = parseList(payload.boardingPoints);
  if (payload.dropoffPoints) route.dropoffPoints = parseList(payload.dropoffPoints);
  if (payload.baggageRules) route.baggageRules = cleanText(payload.baggageRules);
  if (payload.cancellationRules) route.cancellationRules = cleanText(payload.cancellationRules);
  if (payload.publicInstructions) route.publicInstructions = cleanText(payload.publicInstructions);
  if (payload.status) route.status = cleanText(payload.status);
  route.updatedAt = new Date().toISOString();
  listing.from = route.origin;
  listing.to = route.destination;
  listing.corridor = route.corridor;
  if (payload.stops) {
    const existingStops = store.state.routeStops.filter((stop) => stop.routeId === route.id && stop.companyId === company.id);
    existingStops.forEach((stop) => { stop.status = 'archived'; stop.updatedAt = route.updatedAt; });
    const replacements = parseStops(payload.stops).map((stop, index) => ({
      id: `route-stop-${store.state.routeStops.length + index + 1}`,
      routeId: route.id,
      listingId: listing.id,
      companyId: company.id,
      name: cleanText(stop.name || stop.stopName || stop.label),
      stopType: cleanText(stop.stopType || stop.type || 'intermediate'),
      stopOrder: Math.round(moneyValue(stop.stopOrder || stop.order, index + 1)),
      timeOffsetMinutes: Math.round(moneyValue(stop.timeOffsetMinutes || stop.offsetMinutes, 0)),
      pickupAllowed: stop.pickupAllowed !== false,
      dropoffAllowed: stop.dropoffAllowed !== false,
      publicInstructions: cleanText(stop.publicInstructions || stop.instructions || ''),
      status: cleanText(stop.status || 'active'),
      createdAt: route.updatedAt,
    })).filter((stop) => stop.name);
    store.state.routeStops.push(...replacements);
    await upsertMany('RouteStop', [...existingStops, ...replacements]);
  }
  refreshRouteStopsSnapshot(route);
  await upsertModel('Route', route);
  await upsertModel('Listing', listing);
  return route;
}

async function createRouteStop(companyId, routeId, payload = {}, actorId = 'company-admin') {
  ensureStateCollections();
  const company = findCompanyOrThrow(companyId);
  const route = findCompanyRouteOrThrow(company.id, routeId || payload.routeId);
  const listing = findCompanyListingOrThrow(company.id, route.listingId);
  const name = cleanText(payload.name || payload.stopName || payload.label);
  if (!name) {
    const error = new Error('Stop name is required');
    error.status = 422;
    throw error;
  }
  const stop = {
    id: nextId('route-stop', store.state.routeStops),
    routeId: route.id,
    listingId: listing.id,
    companyId: company.id,
    name,
    stopType: cleanText(payload.stopType || payload.type || 'intermediate'),
    stopOrder: Math.round(moneyValue(payload.stopOrder || payload.order, (store.state.routeStops.filter((item) => item.routeId === route.id).length + 1))),
    timeOffsetMinutes: Math.round(moneyValue(payload.timeOffsetMinutes || payload.offsetMinutes, 0)),
    pickupAllowed: payload.pickupAllowed !== 'false' && payload.pickupAllowed !== false,
    dropoffAllowed: payload.dropoffAllowed !== 'false' && payload.dropoffAllowed !== false,
    publicInstructions: cleanText(payload.publicInstructions || payload.instructions || ''),
    status: cleanText(payload.status || 'active'),
    createdBy: actorId,
    createdAt: new Date().toISOString(),
  };
  store.state.routeStops.push(stop);
  refreshRouteStopsSnapshot(route);
  route.updatedAt = stop.createdAt;
  audit(actorId, 'company.route_stop.created', stop.id, { companyId: company.id, routeId: route.id });
  await upsertModel('RouteStop', stop);
  await upsertModel('Route', route);
  return stop;
}

async function updateRouteStop(companyId, stopId, payload = {}, actorId = 'company-admin') {
  const stop = findCompanyRouteStopOrThrow(companyId, stopId);
  const route = findCompanyRouteOrThrow(companyId, stop.routeId);
  if (payload.name || payload.stopName || payload.label) stop.name = cleanText(payload.name || payload.stopName || payload.label);
  if (payload.stopType || payload.type) stop.stopType = cleanText(payload.stopType || payload.type);
  if (typeof payload.stopOrder !== 'undefined' || typeof payload.order !== 'undefined') stop.stopOrder = Math.round(moneyValue(payload.stopOrder || payload.order, stop.stopOrder));
  if (typeof payload.timeOffsetMinutes !== 'undefined' || typeof payload.offsetMinutes !== 'undefined') stop.timeOffsetMinutes = Math.round(moneyValue(payload.timeOffsetMinutes || payload.offsetMinutes, stop.timeOffsetMinutes));
  if (typeof payload.pickupAllowed !== 'undefined') stop.pickupAllowed = payload.pickupAllowed !== 'false' && payload.pickupAllowed !== false;
  if (typeof payload.dropoffAllowed !== 'undefined') stop.dropoffAllowed = payload.dropoffAllowed !== 'false' && payload.dropoffAllowed !== false;
  if (payload.publicInstructions || payload.instructions) stop.publicInstructions = cleanText(payload.publicInstructions || payload.instructions);
  if (payload.status) stop.status = cleanText(payload.status);
  stop.updatedBy = actorId;
  stop.updatedAt = new Date().toISOString();
  refreshRouteStopsSnapshot(route);
  route.updatedAt = stop.updatedAt;
  audit(actorId, 'company.route_stop.updated', stop.id, { companyId, routeId: route.id });
  await upsertModel('RouteStop', stop);
  await upsertModel('Route', route);
  return stop;
}

async function archiveRouteStop(companyId, stopId, actorId = 'company-admin') {
  const stop = findCompanyRouteStopOrThrow(companyId, stopId);
  const route = findCompanyRouteOrThrow(companyId, stop.routeId);
  stop.status = 'archived';
  stop.updatedBy = actorId;
  stop.updatedAt = new Date().toISOString();
  refreshRouteStopsSnapshot(route);
  route.updatedAt = stop.updatedAt;
  audit(actorId, 'company.route_stop.archived', stop.id, { companyId, routeId: route.id });
  await upsertModel('RouteStop', stop);
  await upsertModel('Route', route);
  return stop;
}

async function moveRouteStop(companyId, stopId, direction = 'up', actorId = 'company-admin') {
  const stop = findCompanyRouteStopOrThrow(companyId, stopId);
  const route = findCompanyRouteOrThrow(companyId, stop.routeId);
  const siblings = store.state.routeStops
    .filter((item) => item.routeId === route.id && item.companyId === companyId && item.status !== 'archived')
    .sort((a, b) => Number(a.stopOrder || 0) - Number(b.stopOrder || 0));
  const currentIndex = siblings.findIndex((item) => item.id === stop.id);
  const targetIndex = direction === 'down' ? currentIndex + 1 : currentIndex - 1;
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= siblings.length) return stop;
  const target = siblings[targetIndex];
  const currentOrder = stop.stopOrder;
  stop.stopOrder = target.stopOrder;
  target.stopOrder = currentOrder;
  stop.updatedBy = actorId;
  target.updatedBy = actorId;
  stop.updatedAt = target.updatedAt = new Date().toISOString();
  refreshRouteStopsSnapshot(route);
  route.updatedAt = stop.updatedAt;
  audit(actorId, 'company.route_stop.reordered', stop.id, { companyId, routeId: route.id, direction, swappedWith: target.id });
  await upsertModel('RouteStop', stop);
  await upsertModel('RouteStop', target);
  await upsertModel('Route', route);
  return stop;
}

async function archiveRoute(companyId, routeId) {
  const route = findCompanyRouteOrThrow(companyId, routeId);
  route.status = 'archived';
  route.updatedAt = new Date().toISOString();
  store.state.schedules
    .filter((schedule) => schedule.routeId === route.id && schedule.companyId === companyId)
    .forEach((schedule) => {
      schedule.status = 'archived';
      schedule.updatedAt = new Date().toISOString();
    });
  await upsertModel('Route', route);
  await upsertMany('TripSchedule', store.state.schedules.filter((schedule) => schedule.routeId === route.id));
  return route;
}

async function createVehicle(companyId, payload = {}) {
  ensureStateCollections();
  const company = findCompanyOrThrow(companyId);
  const listing = payload.listingId ? findCompanyListingOrThrow(company.id, payload.listingId) : null;
  const serviceType = normalize(payload.serviceType || listing?.serviceType || 'bus').replace('-', '_');
  if (!VEHICLE_SERVICE_TYPES.includes(serviceType)) {
    const error = new Error('Vehicles cannot be created for hotel listings. Use rooms for hotel inventory.');
    error.status = 422;
    throw error;
  }
  const layoutName = cleanText(payload.layoutName || payload.layout || listing?.layout || (serviceType === 'flight' ? 'flight-3x3' : '2x2'));
  const rows = Math.max(1, Math.round(moneyValue(payload.rows, serviceType === 'flight' ? 10 : 12)));
  const cols = layoutName === '2x1' || layoutName === 'sleeper' ? 3 : layoutName === '2x3' ? 5 : layoutName === 'flight-3x3' ? 6 : 4;
  const totalSeats = Math.max(1, Math.round(moneyValue(payload.totalSeats, layoutSeatCount(layoutName, rows, 32))));
  const vehicle = {
    id: nextId('vehicle', store.state.vehicles),
    companyId: company.id,
    listingId: listing?.id || '',
    serviceType,
    name: cleanText(payload.name || `${company.name} ${listingType(serviceType)} ${store.state.vehicles.filter((item) => item.companyId === company.id).length + 1}`),
    plateOrCode: cleanText(payload.plateOrCode || payload.code || ''),
    layoutName,
    rows,
    cols,
    totalSeats,
    seats: generateVehicleSeats(totalSeats, cols),
    amenities: parseList(payload.amenities || 'Ticket scanner'),
    media: payloadMedia(payload, cleanText(payload.name || `${company.name} vehicle`)),
    status: cleanText(payload.status || 'active'),
    createdAt: new Date().toISOString(),
  };
  store.state.vehicles.push(vehicle);
  await upsertModel('Vehicle', vehicle);
  return vehicle;
}

async function updateVehicle(companyId, vehicleId, payload = {}) {
  const company = findCompanyOrThrow(companyId);
  const vehicle = findCompanyVehicleOrThrow(company.id, vehicleId);
  if (payload.listingId) {
    const listing = findCompanyListingOrThrow(company.id, payload.listingId);
    vehicle.listingId = listing.id;
    vehicle.serviceType = listing.serviceType;
  }
  if (payload.serviceType) vehicle.serviceType = normalize(payload.serviceType).replace('-', '_');
  if (payload.name) vehicle.name = cleanText(payload.name);
  if (typeof payload.plateOrCode !== 'undefined' || typeof payload.code !== 'undefined') vehicle.plateOrCode = cleanText(payload.plateOrCode || payload.code);
  if (payload.layoutName || payload.layout) vehicle.layoutName = cleanText(payload.layoutName || payload.layout);
  if (typeof payload.rows !== 'undefined') vehicle.rows = Math.max(1, Math.round(moneyValue(payload.rows, vehicle.rows)));
  if (typeof payload.totalSeats !== 'undefined') {
    vehicle.totalSeats = Math.max(1, Math.round(moneyValue(payload.totalSeats, vehicle.totalSeats)));
    vehicle.seats = generateVehicleSeats(vehicle.totalSeats, vehicle.cols || 4);
  }
  const media = payloadMedia(payload, vehicle.name);
  if (media.length) {
    vehicle.media = Array.isArray(vehicle.media) ? vehicle.media : [];
    vehicle.media.push(media[0]);
  }
  if (payload.amenities) vehicle.amenities = parseList(payload.amenities);
  if (payload.status) vehicle.status = cleanText(payload.status);
  vehicle.updatedAt = new Date().toISOString();
  await upsertModel('Vehicle', vehicle);
  return vehicle;
}

async function archiveVehicle(companyId, vehicleId) {
  const vehicle = findCompanyVehicleOrThrow(companyId, vehicleId);
  const activeSchedules = store.state.schedules.filter((schedule) => schedule.vehicleId === vehicle.id && schedule.companyId === companyId && schedule.status === 'active');
  if (activeSchedules.length) {
    vehicle.status = 'maintenance';
  } else {
    vehicle.status = 'archived';
  }
  vehicle.updatedAt = new Date().toISOString();
  await upsertModel('Vehicle', vehicle);
  return vehicle;
}

async function updateVehicleSeatTemplate(companyId, vehicleId, payload = {}, actorId = 'company-admin') {
  const vehicle = findCompanyVehicleOrThrow(companyId, vehicleId || payload.vehicleId);
  const layoutName = cleanText(payload.layoutName || payload.layout || vehicle.layoutName || '2x2');
  const rows = Math.max(1, Math.round(moneyValue(payload.rows, vehicle.rows || 12)));
  const cols = layoutName === '2x1' || layoutName === 'sleeper' ? 3 : layoutName === '2x3' ? 5 : layoutName === 'flight-3x3' ? 6 : 4;
  const labels = parseList(payload.seatLabels || payload.labels);
  const totalSeats = labels.length || Math.max(1, Math.round(moneyValue(payload.totalSeats, layoutSeatCount(layoutName, rows, vehicle.totalSeats || 32))));
  const preserveExistingSchedules = typeof payload.preserveExistingSchedules === 'undefined' ? true : boolValue(payload.preserveExistingSchedules);
  const defaultSeatClass = cleanText(payload.defaultSeatClass || vehicle.defaultSeatClass || 'Standard');
  const vipSeats = parseList(payload.vipSeats);
  const disabledSeats = parseList(payload.disabledSeats);
  const blockedSeats = parseList(payload.blockedSeats);
  const vipPriceDelta = moneyValue(payload.vipPriceDelta, vehicle.vipPriceDelta || 0);
  vehicle.layoutName = layoutName;
  vehicle.rows = rows;
  vehicle.cols = cols;
  vehicle.totalSeats = totalSeats;
  vehicle.defaultSeatClass = defaultSeatClass;
  vehicle.vipPriceDelta = vipPriceDelta;
  vehicle.seats = buildVehicleSeatTemplate({ labels, totalSeats, cols, defaultSeatClass, vipSeats, disabledSeats, blockedSeats, vipPriceDelta });
  vehicle.updatedAt = new Date().toISOString();
  if (!preserveExistingSchedules) {
    store.state.schedules
      .filter((schedule) => schedule.companyId === companyId && schedule.vehicleId === vehicle.id && ['draft', 'active', 'published'].includes(schedule.status))
      .forEach((schedule) => {
        const oldSeats = store.seatsForSchedule(schedule.id);
        oldSeats.forEach((seat) => { seat.status = 'archived'; seat.updatedAt = vehicle.updatedAt; });
        const freshSeats = vehicle.seats.filter((seat) => !seat.isDisabled).map((templateSeat) => ({
          id: `seat-${schedule.id}-${templateSeat.seatNumber}`,
          scheduleId: schedule.id,
          seatNumber: templateSeat.seatNumber,
          seatClass: templateSeat.seatClass || defaultSeatClass,
          seatType: templateSeat.seatType || normalize(defaultSeatClass),
          priceDelta: moneyValue(templateSeat.priceDelta, 0),
          status: templateSeat.status === 'blocked' ? 'blocked' : 'available',
          blockedReason: templateSeat.blockedReason || '',
          lockedUntil: null,
          lockId: null,
          createdAt: vehicle.updatedAt,
        }));
        store.state.seats.push(...freshSeats);
        recalculateScheduleAvailability(schedule);
        schedule.seatInventorySnapshot = seatInventorySnapshot(schedule.id);
      });
  }
  audit(actorId, 'company.vehicle.seat_template_updated', vehicle.id, { companyId, layoutName, totalSeats, labels: vehicle.seats.map((seat) => seat.seatNumber) });
  await upsertModel('Vehicle', vehicle);
  await upsertMany('TripSchedule', store.state.schedules.filter((schedule) => schedule.companyId === companyId && schedule.vehicleId === vehicle.id));
  await upsertMany('Seat', store.state.seats.filter((seat) => store.state.schedules.some((schedule) => schedule.companyId === companyId && schedule.vehicleId === vehicle.id && schedule.id === seat.scheduleId)));
  return vehicle;
}

async function updateVehicleStatus(companyId, vehicleId, payload = {}, actorId = 'company-admin') {
  const vehicle = findCompanyVehicleOrThrow(companyId, vehicleId);
  vehicle.status = cleanText(payload.status || 'active');
  vehicle.maintenanceReason = cleanText(payload.maintenanceReason || payload.reason || '');
  vehicle.updatedBy = actorId;
  vehicle.updatedAt = new Date().toISOString();
  audit(actorId, 'company.vehicle.status_updated', vehicle.id, { companyId, status: vehicle.status });
  await upsertModel('Vehicle', vehicle);
  return vehicle;
}

function scheduleDriverIds(schedule = {}) {
  return Array.from(new Set([
    ...parseList(schedule.driverIds),
    schedule.driverEmployeeId,
    schedule.driverUserId,
  ].filter(Boolean)));
}

function seatInventorySnapshot(scheduleId) {
  return store.seatsForSchedule(scheduleId).map((seat) => ({
    id: seat.id,
    seatNumber: seat.seatNumber,
    seatClass: seat.seatClass,
    seatType: seat.seatType || normalize(seat.seatClass || 'standard'),
    status: seat.status,
    priceDelta: Number(seat.priceDelta || 0),
    blockedReason: seat.blockedReason || '',
  }));
}

function validateSchedulePublish(companyId, schedule = {}) {
  ensureStateCollections();
  const company = store.findCompany(companyId) || {};
  const route = store.state.routes.find((item) => item.id === schedule.routeId && item.companyId === companyId);
  const listing = route ? store.state.listings.find((item) => item.id === route.listingId && item.companyId === companyId) : null;
  const vehicle = store.state.vehicles.find((item) => item.id === schedule.vehicleId && item.companyId === companyId);
  const seats = store.seatsForSchedule(schedule.id);
  const assignments = store.state.driverAssignments.filter((assignment) => assignment.companyId === companyId && assignment.scheduleId === schedule.id && assignment.status !== 'archived');
  const failures = [];
  const warnings = [];
  const departAt = schedule.departAt ? new Date(schedule.departAt) : null;
  const activeSchedulesForVehicle = (store.state.schedules || []).filter((item) => item.companyId === companyId
    && item.id !== schedule.id
    && item.vehicleId === schedule.vehicleId
    && ['active', 'published', 'boarding', 'departed'].includes(String(item.status || '').toLowerCase())
    && item.departAt
    && schedule.departAt
    && Math.abs(new Date(item.departAt).getTime() - new Date(schedule.departAt).getTime()) < 4 * 60 * 60 * 1000);

  if (!companyCanPublish(company)) failures.push('company_not_verified');
  if (!listing || String(listing.status || '').toLowerCase() === 'archived') failures.push('listing_missing_or_archived');
  if (!route || ['archived', 'paused', 'inactive'].includes(String(route?.status || '').toLowerCase())) failures.push('route_not_active');
  if (!route?.origin || !route?.destination) failures.push('route_origin_destination_missing');
  if (!route?.cancellationRules && !listing?.cancellationRules) failures.push('cancellation_policy_missing');
  if (!vehicle || ['archived', 'maintenance', 'paused', 'inactive'].includes(String(vehicle?.status || '').toLowerCase())) failures.push('vehicle_not_active');
  if (vehicle?.listingId && listing && vehicle.listingId !== listing.id) failures.push('vehicle_listing_mismatch');
  if (!seats.length) failures.push('seat_map_missing');
  if (seats.length && !seats.some((seat) => ['available', 'held', 'booked', 'locked', 'taken'].includes(String(seat.status || '').toLowerCase()))) failures.push('seat_inventory_invalid');
  if (!Number(schedule.basePrice || 0)) failures.push('fare_missing');
  if (!schedule.currency) failures.push('currency_missing');
  if (!departAt || Number.isNaN(departAt.getTime())) failures.push('departure_time_missing');
  else if (departAt.getTime() <= Date.now()) failures.push('departure_must_be_future');
  if (schedule.arriveAt && departAt && new Date(schedule.arriveAt).getTime() <= departAt.getTime()) failures.push('arrival_must_be_after_departure');
  if (!assignments.length && !scheduleDriverIds(schedule).length) failures.push('driver_assignment_missing');
  if (activeSchedulesForVehicle.length) failures.push('vehicle_time_conflict');
  if (!route?.boardingPoints?.length && !route?.stops?.some((stop) => stop.pickupAllowed)) warnings.push('no_pickup_points_configured');
  if (!route?.dropoffPoints?.length && !route?.stops?.some((stop) => stop.dropoffAllowed)) warnings.push('no_dropoff_points_configured');
  return {
    ok: failures.length === 0,
    failures,
    warnings,
    checkedAt: new Date().toISOString(),
    summary: {
      companyVerified: companyCanPublish(company),
      routeActive: !!route && !['archived', 'paused', 'inactive'].includes(String(route.status || '').toLowerCase()),
      vehicleActive: !!vehicle && !['archived', 'maintenance', 'paused', 'inactive'].includes(String(vehicle.status || '').toLowerCase()),
      seatCount: seats.length,
      driverAssigned: !!assignments.length || !!scheduleDriverIds(schedule).length,
      hasFare: Number(schedule.basePrice || 0) > 0,
      hasCancellationPolicy: !!(route?.cancellationRules || listing?.cancellationRules),
    },
  };
}

async function createSchedule(companyId, payload = {}) {
  const company = findCompanyOrThrow(companyId);
  const route = findCompanyRouteOrThrow(company.id, payload.routeId);
  const listing = findCompanyListingOrThrow(company.id, route.listingId);
  if (!ROUTED_SERVICE_TYPES.includes(listing.serviceType)) {
    const error = new Error('Departures cannot be created for this listing type');
    error.status = 422;
    throw error;
  }
  const vehicle = payload.vehicleId ? findCompanyVehicleOrThrow(company.id, payload.vehicleId) : store.state.vehicles?.find((item) => item.companyId === company.id && item.listingId === listing.id && item.status !== 'archived');
  if (!vehicle) {
    const error = new Error('Select a vehicle before creating a departure');
    error.status = 422;
    throw error;
  }
  if (vehicle.listingId && vehicle.listingId !== listing.id) {
    const error = new Error('Selected vehicle is linked to a different listing');
    error.status = 422;
    throw error;
  }
  const seatList = vehicleSeatNumbers(vehicle, moneyValue(payload.totalSeats, 32));
  const totalSeats = Math.max(1, Math.round(moneyValue(payload.totalSeats, vehicle?.totalSeats || seatList.length || 32)));
  const blockedSeats = new Set(parseList(payload.blockedSeats));
  const schedule = {
    id: nextId('schedule', store.state.schedules),
    routeId: route.id,
    listingId: listing.id,
    companyId: company.id,
    vehicleId: vehicle?.id || '',
    vehicleName: vehicle?.name || cleanText(payload.vehicleName || ''),
    driverName: cleanText(payload.driverName || ''),
    driverIds: parseList(payload.driverIds),
    departAt: payload.departAt ? new Date(payload.departAt).toISOString() : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    arriveAt: payload.arriveAt ? new Date(payload.arriveAt).toISOString() : null,
    boardingStartAt: parseDate(payload.boardingStartAt),
    basePrice: moneyValue(payload.basePrice || payload.priceFrom, listing.priceFrom),
    currency: cleanText(payload.currency || listing.currency || 'UGX'),
    fareClass: cleanText(payload.fareClass || 'standard'),
    gate: cleanText(payload.gate || ''),
    platform: cleanText(payload.platform || ''),
    notes: cleanText(payload.notes || ''),
    totalSeats,
    availableSeats: 0,
    status: cleanText(payload.status || 'active'),
    createdAt: new Date().toISOString(),
  };
  const seats = seatList.slice(0, totalSeats).map((seatNumber, index) => ({
    id: `seat-${schedule.id}-${seatNumber}`,
    scheduleId: schedule.id,
    seatNumber,
    seatClass: index < 4 ? 'VIP' : 'Standard',
    seatType: index < 4 ? 'vip' : 'standard',
    priceDelta: index < 4 ? moneyValue(payload.vipPriceDelta, 12000) : 0,
    status: blockedSeats.has(seatNumber) ? 'blocked' : 'available',
    blockedReason: blockedSeats.has(seatNumber) ? cleanText(payload.blockedReason || 'Blocked during schedule setup') : '',
    lockedUntil: null,
    lockId: null,
    createdAt: new Date().toISOString(),
  }));
  schedule.availableSeats = seats.filter((seat) => seat.status === 'available').length;
  store.state.schedules.push(schedule);
  store.state.seats.push(...seats);
  schedule.seatInventorySnapshot = seatInventorySnapshot(schedule.id);
  schedule.publishValidation = validateSchedulePublish(company.id, schedule);
  if (schedule.status === 'published' && !schedule.publishValidation.ok) schedule.status = 'draft';
  await upsertModel('TripSchedule', schedule);
  await upsertMany('Seat', seats);
  return { schedule, seats };
}

async function updateSchedule(companyId, scheduleId, payload = {}) {
  const company = findCompanyOrThrow(companyId);
  const schedule = findCompanyScheduleOrThrow(company.id, scheduleId);
  if (payload.routeId) {
    const route = findCompanyRouteOrThrow(company.id, payload.routeId);
    schedule.routeId = route.id;
    schedule.listingId = route.listingId;
  }
  if (payload.vehicleId) {
    const vehicle = findCompanyVehicleOrThrow(company.id, payload.vehicleId);
    schedule.vehicleId = vehicle.id;
    schedule.vehicleName = vehicle.name;
  }
  if (typeof payload.driverName !== 'undefined') schedule.driverName = cleanText(payload.driverName);
  if (typeof payload.driverIds !== 'undefined') schedule.driverIds = parseList(payload.driverIds);
  if (payload.departAt) schedule.departAt = new Date(payload.departAt).toISOString();
  if (payload.arriveAt) schedule.arriveAt = new Date(payload.arriveAt).toISOString();
  if (payload.boardingStartAt) schedule.boardingStartAt = new Date(payload.boardingStartAt).toISOString();
  if (typeof payload.basePrice !== 'undefined') schedule.basePrice = moneyValue(payload.basePrice, schedule.basePrice);
  if (payload.currency) schedule.currency = cleanText(payload.currency);
  if (payload.fareClass) schedule.fareClass = cleanText(payload.fareClass);
  if (payload.gate) schedule.gate = cleanText(payload.gate);
  if (payload.platform) schedule.platform = cleanText(payload.platform);
  if (payload.notes) schedule.notes = cleanText(payload.notes);
  if (payload.status) schedule.status = cleanText(payload.status);
  schedule.publishValidation = validateSchedulePublish(company.id, schedule);
  schedule.updatedAt = new Date().toISOString();
  await upsertModel('TripSchedule', schedule);
  return schedule;
}

async function publishSchedule(companyId, scheduleId) {
  const company = findCompanyOrThrow(companyId);
  const schedule = findCompanyScheduleOrThrow(company.id, scheduleId);
  schedule.publishValidation = validateSchedulePublish(company.id, schedule);
  if (!schedule.publishValidation.ok) {
    const error = new Error(`Schedule cannot be published: ${schedule.publishValidation.failures.join(', ')}`);
    error.status = 422;
    error.validation = schedule.publishValidation;
    throw error;
  }
  schedule.status = 'published';
  schedule.seatInventorySnapshot = seatInventorySnapshot(schedule.id);
  schedule.publishedAt = new Date().toISOString();
  schedule.updatedAt = schedule.publishedAt;
  await upsertModel('TripSchedule', schedule);
  return schedule;
}

async function archiveSchedule(companyId, scheduleId) {
  const schedule = findCompanyScheduleOrThrow(companyId, scheduleId);
  schedule.status = 'archived';
  schedule.updatedAt = new Date().toISOString();
  await upsertModel('TripSchedule', schedule);
  return schedule;
}

async function transitionSchedule(companyId, scheduleId, payload = {}, actorId = 'company-admin') {
  const allowed = ['draft', 'active', 'published', 'boarding', 'departed', 'arrived', 'completed', 'cancelled', 'delayed', 'archived'];
  const schedule = findCompanyScheduleOrThrow(companyId, scheduleId);
  const status = normalize(payload.status || payload.nextStatus || '');
  if (!allowed.includes(status)) {
    const error = new Error('Invalid schedule status');
    error.status = 422;
    throw error;
  }
  if (status === 'published') {
    return publishSchedule(companyId, scheduleId);
  }
  schedule.status = status;
  schedule.statusReason = cleanText(payload.reason || payload.note || '');
  schedule.updatedBy = actorId;
  schedule.updatedAt = new Date().toISOString();
  schedule.seatInventorySnapshot = seatInventorySnapshot(schedule.id);
  audit(actorId, 'company.schedule.status_updated', schedule.id, { companyId, status });
  await upsertModel('TripSchedule', schedule);
  return schedule;
}


function bookingMatchesCompanySchedule(booking = {}, scheduleId = '') {
  if (!booking || !scheduleId) return false;
  if (booking.scheduleId === scheduleId) return true;
  if ((booking.bookingItems || []).some((item) => item.scheduleId === scheduleId)) return true;
  if ((booking.bookingLegs || []).some((leg) => leg.scheduleId === scheduleId)) return true;
  if ((booking.ticketLegs || []).some((leg) => leg.scheduleId === scheduleId)) return true;
  return false;
}

async function completeSchedule(companyId, scheduleId, payload = {}, actorId = 'company-admin') {
  const schedule = findCompanyScheduleOrThrow(companyId, scheduleId);
  const now = new Date().toISOString();
  const releaseService = require('../commission/releaseService');
  schedule.status = 'completed';
  schedule.completedAt = now;
  schedule.statusReason = cleanText(payload.reason || payload.note || 'Completed from company dashboard');
  schedule.updatedBy = actorId;
  schedule.updatedAt = now;
  schedule.seatInventorySnapshot = seatInventorySnapshot(schedule.id);

  const eligibleBookings = store.state.bookings.filter((booking) => (
    booking.companyId === companyId
    && bookingMatchesCompanySchedule(booking, schedule.id)
    && ['successful', 'paid', 'completed'].includes(normalize(booking.paymentStatus))
    && ['checked_in', 'completed'].includes(normalize(booking.bookingStatus))
  ));

  const releasedCommissions = [];
  for (const booking of eligibleBookings) {
    booking.bookingStatus = 'completed';
    booking.completedAt = booking.completedAt || now;
    booking.completedBy = actorId;
    const released = releaseService.releaseCompletedBooking(booking.bookingRef) || [];
    releasedCommissions.push(...released);
    await timelineService.recordEvent({
      bookingRef: booking.bookingRef,
      bookingId: booking.id,
      companyId: booking.companyId,
      customerUserId: booking.customerUserId || '',
      entityType: 'trip_schedule',
      entityId: schedule.id,
      action: 'trip.completed',
      title: `Trip completed for ${booking.bookingRef}`,
      message: schedule.statusReason || 'Trip completed and eligible earnings were released.',
      status: 'completed',
      actorType: 'company_admin',
      actorId,
      visibility: 'shared',
      metadata: { scheduleId: schedule.id, releasedCommissions: released.length },
    });
  }

  const update = {
    id: nextId('trip-status', store.state.tripStatusUpdates || []),
    companyId,
    scheduleId: schedule.id,
    status: 'completed',
    location: cleanText(payload.location || ''),
    note: schedule.statusReason,
    createdBy: actorId,
    createdAt: now,
  };
  ensureStateCollections();
  store.state.tripStatusUpdates.push(update);
  audit(actorId, 'company.schedule.completed', schedule.id, { companyId, releasedBookings: eligibleBookings.length, releasedCommissions: releasedCommissions.length });

  await upsertModel('TripSchedule', schedule);
  await upsertModel('TripStatusUpdate', update);
  await upsertMany('Booking', eligibleBookings);
  await upsertMany('Commission', releasedCommissions);
  await upsertMany('Wallet', store.state.wallets.filter((wallet) => wallet.ownerId === companyId || releasedCommissions.some((commission) => commission.promoterId && wallet.ownerId === commission.promoterId)));
  await upsertMany('WalletTransaction', store.state.walletTransactions.filter((txn) => eligibleBookings.some((booking) => txn.referenceType === 'booking' && txn.referenceId === booking.id)));
  return { schedule, releasedBookings: eligibleBookings, releasedCommissions };
}

async function duplicateSchedule(companyId, scheduleId, payload = {}, actorId = 'company-admin') {
  const original = findCompanyScheduleOrThrow(companyId, scheduleId);
  const copyPayload = {
    routeId: original.routeId,
    vehicleId: payload.vehicleId || original.vehicleId,
    driverName: payload.driverName || original.driverName,
    driverIds: payload.driverIds || original.driverIds,
    departAt: payload.departAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    arriveAt: payload.arriveAt || '',
    boardingStartAt: payload.boardingStartAt || '',
    basePrice: payload.basePrice || original.basePrice,
    currency: payload.currency || original.currency,
    fareClass: payload.fareClass || original.fareClass,
    gate: payload.gate || original.gate,
    platform: payload.platform || original.platform,
    notes: payload.notes || `Duplicated from ${original.id}`,
    totalSeats: payload.totalSeats || original.totalSeats,
    status: payload.status || 'draft',
  };
  const result = await createSchedule(companyId, copyPayload);
  audit(actorId, 'company.schedule.duplicated', result.schedule.id, { companyId, sourceScheduleId: original.id });
  return result.schedule;
}

async function updateSeatStatus(companyId, payload = {}) {
  const company = findCompanyOrThrow(companyId);
  const schedule = findCompanyScheduleOrThrow(company.id, payload.scheduleId);
  const seat = store.seatsForSchedule(schedule.id).find((item) => item.seatNumber === payload.seatNumber || item.id === payload.seatId);
  if (!seat) {
    const error = new Error('Seat not found for this schedule');
    error.status = 404;
    throw error;
  }
  const statusAliases = { held: 'locked', hold: 'locked', booked: 'taken', checked_in: 'checked-in', no_show: 'no-show' };
  const nextStatus = payload.status ? (statusAliases[normalize(payload.status)] || normalize(payload.status)) : '';
  const allowedStatuses = ['available', 'selected', 'locked', 'held', 'taken', 'booked', 'checked-in', 'no-show', 'cancelled', 'refunded', 'blocked', 'maintenance', 'reserved', 'disabled'];
  if (nextStatus && !allowedStatuses.includes(nextStatus)) {
    const error = new Error('Invalid seat status');
    error.status = 422;
    throw error;
  }
  if (nextStatus) seat.status = nextStatus;
  if (payload.seatClass || payload.seatType) {
    seat.seatClass = cleanText(payload.seatClass || payload.seatType);
    seat.seatType = normalize(payload.seatType || payload.seatClass || seat.seatType || seat.seatClass);
  }
  if (typeof payload.blockedReason !== 'undefined') seat.blockedReason = cleanText(payload.blockedReason);
  if (typeof payload.priceDelta !== 'undefined') seat.priceDelta = moneyValue(payload.priceDelta, seat.priceDelta);
  if (seat.status !== 'locked') {
    seat.lockedUntil = null;
    seat.lockId = null;
  }
  seat.updatedAt = new Date().toISOString();
  recalculateScheduleAvailability(schedule);
  await upsertModel('Seat', seat);
  await upsertModel('TripSchedule', schedule);
  return { seat, schedule };
}

async function createRoom(companyId, payload = {}) {
  const company = findCompanyOrThrow(companyId);
  const listing = findCompanyListingOrThrow(company.id, payload.listingId || payload.slug);
  if (listing.serviceType !== 'hotel') {
    const error = new Error('Rooms can only be added to hotel listings');
    error.status = 422;
    throw error;
  }
  const room = {
    id: nextId('room', store.state.rooms),
    listingId: listing.id,
    companyId: company.id,
    roomType: cleanText(payload.roomType || payload.name || 'Standard Room'),
    capacity: Math.max(1, Math.round(moneyValue(payload.capacity, 2))),
    nightlyPrice: moneyValue(payload.nightlyPrice || payload.priceFrom, listing.priceFrom),
    inventory: Math.max(0, Math.round(moneyValue(payload.inventory, 1))),
    amenities: parseList(payload.amenities),
    media: payloadMedia(payload, cleanText(payload.roomType || payload.name || listing.title)),
    status: cleanText(payload.status || 'active'),
    createdAt: new Date().toISOString(),
  };
  store.state.rooms.push(room);
  const prices = store.roomsForListing(listing.id).map((item) => Number(item.nightlyPrice || 0)).filter(Boolean);
  listing.priceFrom = prices.length ? Math.min(...prices) : listing.priceFrom;
  listing.price = listing.priceFrom;
  await upsertModel('Room', room);
  await upsertModel('Listing', listing);
  return room;
}

async function updateRoomInventory(companyId, roomId, changes = {}) {
  const company = findCompanyOrThrow(companyId);
  const room = findCompanyRoomOrThrow(company.id, roomId);
  if (changes.roomType || changes.name) room.roomType = cleanText(changes.roomType || changes.name);
  if (typeof changes.capacity !== 'undefined') room.capacity = Math.max(1, Math.round(moneyValue(changes.capacity, room.capacity)));
  if (typeof changes.inventory !== 'undefined') room.inventory = Math.max(0, Math.round(moneyValue(changes.inventory, room.inventory)));
  if (changes.status) room.status = cleanText(changes.status);
  if (typeof changes.nightlyPrice !== 'undefined') room.nightlyPrice = moneyValue(changes.nightlyPrice, room.nightlyPrice);
  if (changes.amenities) room.amenities = parseList(changes.amenities);
  const media = payloadMedia(changes, room.roomType);
  if (media.length) {
    room.media = Array.isArray(room.media) ? room.media : [];
    room.media.push(media[0]);
  }
  room.updatedAt = new Date().toISOString();
  await upsertModel('Room', room);
  return room;
}

async function archiveRoom(companyId, roomId) {
  const room = findCompanyRoomOrThrow(companyId, roomId);
  room.status = 'archived';
  room.updatedAt = new Date().toISOString();
  await upsertModel('Room', room);
  return room;
}

async function createBranch(companyId, payload = {}, actorId = 'company-admin') {
  ensureStateCollections();
  const company = findCompanyOrThrow(companyId);
  const name = cleanText(payload.name || payload.branchName);
  if (!name) {
    const error = new Error('Branch or terminal name is required');
    error.status = 422;
    throw error;
  }
  const branch = {
    id: nextId('branch', store.state.companyBranches),
    companyId: company.id,
    name,
    branchType: cleanText(payload.branchType || 'terminal'),
    terminalCode: cleanText(payload.terminalCode || payload.code || ''),
    city: cleanText(payload.city || company.city || ''),
    country: cleanText(payload.country || company.country || ''),
    address: cleanText(payload.address || ''),
    contactName: cleanText(payload.contactName || ''),
    contactPhone: cleanText(payload.contactPhone || ''),
    contactEmail: cleanText(payload.contactEmail || ''),
    operatingHours: cleanText(payload.operatingHours || ''),
    serviceCategories: parseList(payload.serviceCategories || payload.categories || company.companyType || ''),
    amenities: parseList(payload.amenities),
    status: cleanText(payload.status || 'active'),
    createdBy: actorId,
    createdAt: new Date().toISOString(),
  };
  store.state.companyBranches.push(branch);
  audit(actorId, 'company.branch.created', branch.id, { companyId: company.id });
  await upsertModel('CompanyBranch', branch);
  return branch;
}

async function createPolicy(companyId, payload = {}, actorId = 'company-admin') {
  ensureStateCollections();
  const company = findCompanyOrThrow(companyId);
  const title = cleanText(payload.title || payload.policyTitle);
  if (!title) {
    const error = new Error('Policy title is required');
    error.status = 422;
    throw error;
  }
  const policy = {
    id: nextId('policy', store.state.companyPolicies),
    companyId: company.id,
    title,
    policyType: cleanText(payload.policyType || 'operations'),
    serviceCategory: cleanText(payload.serviceCategory || payload.serviceType || company.companyType || ''),
    summary: cleanText(payload.summary || payload.description || ''),
    customerVisible: boolValue(payload.customerVisible),
    appliesToBranches: parseList(payload.appliesToBranches || payload.branchIds),
    status: cleanText(payload.status || 'active'),
    createdBy: actorId,
    createdAt: new Date().toISOString(),
  };
  store.state.companyPolicies.push(policy);
  audit(actorId, 'company.policy.created', policy.id, { companyId: company.id, policyType: policy.policyType });
  await upsertModel('CompanyPolicy', policy);
  return policy;
}

async function updateEmployeeRole(companyId, employeeId, payload = {}, actorId = 'company-admin') {
  ensureStateCollections();
  const employee = findCompanyEmployeeOrThrow(companyId, employeeId);
  const user = employeeUser(employee);
  if (payload.roleTitle) employee.roleTitle = cleanText(payload.roleTitle);
  if (payload.branch) employee.branch = cleanText(payload.branch);
  if (payload.permissions) employee.permissions = parseList(payload.permissions);
  if (payload.serviceCategories) employee.serviceCategories = parseList(payload.serviceCategories);
  if (payload.status) {
    employee.status = cleanText(payload.status);
    if (user.id) user.status = employee.status;
  }
  employee.updatedBy = actorId;
  employee.updatedAt = new Date().toISOString();
  audit(actorId, 'company.employee.role_updated', employee.id, { companyId, roleTitle: employee.roleTitle });
  await upsertModel('CompanyEmployee', employee);
  if (user.id) await upsertModel('User', user);
  return { employee, user };
}

async function updateDriverProfile(companyId, employeeId, payload = {}, actorId = 'company-admin') {
  ensureStateCollections();
  const { employee, user } = await updateEmployeeRole(companyId, employeeId, payload, actorId);
  employee.licenseNumber = cleanText(payload.licenseNumber || employee.licenseNumber || '');
  employee.licenseClass = cleanText(payload.licenseClass || employee.licenseClass || '');
  employee.licenseExpiresAt = payload.licenseExpiresAt ? new Date(payload.licenseExpiresAt).toISOString() : employee.licenseExpiresAt;
  employee.safetyStatus = cleanText(payload.safetyStatus || employee.safetyStatus || 'pending_review');
  employee.assignedFleetId = cleanText(payload.assignedFleetId || employee.assignedFleetId || '');
  employee.driverProfileUpdatedAt = new Date().toISOString();
  employee.documents = Array.isArray(employee.documents) ? employee.documents : [];
  if (payload.documentReference || payload.documentUrl || payload.documentType) {
    employee.documents.push({
      documentType: cleanText(payload.documentType || 'driver_license'),
      documentReference: cleanText(payload.documentReference || payload.licenseNumber || ''),
      documentUrl: cleanText(payload.documentUrl || ''),
      status: cleanText(payload.documentStatus || 'submitted'),
      uploadedBy: actorId,
      uploadedAt: new Date().toISOString(),
    });
  }
  audit(actorId, 'company.driver.profile_updated', employee.id, { companyId, safetyStatus: employee.safetyStatus });
  await upsertModel('CompanyEmployee', employee);
  return { employee, user };
}

async function assignDriver(companyId, employeeId, payload = {}, actorId = 'company-admin') {
  ensureStateCollections();
  const employee = findCompanyEmployeeOrThrow(companyId, employeeId);
  const user = employeeUser(employee);
  const vehicle = payload.vehicleId ? findCompanyVehicleOrThrow(companyId, payload.vehicleId) : null;
  const schedule = payload.scheduleId ? findCompanyScheduleOrThrow(companyId, payload.scheduleId) : null;
  if (!vehicle && !schedule) {
    const error = new Error('Select a vehicle or schedule for the driver assignment');
    error.status = 422;
    throw error;
  }
  const assignment = {
    id: nextId('driver-assignment', store.state.driverAssignments),
    companyId,
    employeeId: employee.id,
    driverUserId: employee.userId,
    vehicleId: vehicle?.id || cleanText(payload.vehicleId || ''),
    scheduleId: schedule?.id || cleanText(payload.scheduleId || ''),
    routeId: schedule?.routeId || cleanText(payload.routeId || ''),
    listingId: schedule?.listingId || vehicle?.listingId || cleanText(payload.listingId || ''),
    assignmentType: cleanText(payload.assignmentType || (schedule ? 'schedule' : 'vehicle')),
    startsAt: payload.startsAt ? new Date(payload.startsAt).toISOString() : schedule?.departAt || '',
    endsAt: payload.endsAt ? new Date(payload.endsAt).toISOString() : '',
    safetyStatus: cleanText(payload.safetyStatus || employee.safetyStatus || 'pending_review'),
    status: cleanText(payload.status || 'active'),
    note: cleanText(payload.note || ''),
    assignedBy: actorId,
    createdAt: new Date().toISOString(),
  };
  store.state.driverAssignments.push(assignment);
  employee.assignedFleetId = vehicle?.id || employee.assignedFleetId || '';
  employee.lastAssignedAt = assignment.createdAt;
  if (vehicle) {
    vehicle.assignedDriverId = employee.id;
    vehicle.assignedDriverUserId = employee.userId;
    vehicle.assignedDriverName = user.fullName || user.email || employee.id;
    vehicle.updatedAt = new Date().toISOString();
  }
  if (schedule) {
    schedule.driverEmployeeId = employee.id;
    schedule.driverUserId = employee.userId;
    schedule.driverIds = Array.from(new Set([...(Array.isArray(schedule.driverIds) ? schedule.driverIds : parseList(schedule.driverIds)), employee.id, employee.userId].filter(Boolean)));
    schedule.driverName = user.fullName || user.email || schedule.driverName || employee.id;
    schedule.assignmentStatus = assignment.status;
    schedule.updatedAt = new Date().toISOString();
  }
  audit(actorId, 'company.driver.assigned', assignment.id, { companyId, employeeId: employee.id, scheduleId: assignment.scheduleId, vehicleId: assignment.vehicleId });
  await upsertModel('DriverAssignment', assignment);
  await upsertModel('CompanyEmployee', employee);
  if (vehicle) await upsertModel('Vehicle', vehicle);
  if (schedule) await upsertModel('TripSchedule', schedule);
  return assignment;
}

async function updateTripStatus(companyId, scheduleId, payload = {}, actorId = 'driver') {
  ensureStateCollections();
  const schedule = findCompanyScheduleOrThrow(companyId, scheduleId);
  const status = cleanText(payload.status || 'updated');
  if (!status) {
    const error = new Error('Trip status is required');
    error.status = 422;
    throw error;
  }
  const update = {
    id: nextId('trip-status', store.state.tripStatusUpdates),
    companyId,
    scheduleId: schedule.id,
    vehicleId: schedule.vehicleId || '',
    driverUserId: actorId,
    status,
    location: cleanText(payload.location || ''),
    note: cleanText(payload.note || ''),
    passengerCount: Number(payload.passengerCount || 0),
    checkedInCount: Number(payload.checkedInCount || 0),
    noShowCount: Number(payload.noShowCount || 0),
    createdBy: actorId,
    createdAt: new Date().toISOString(),
  };
  store.state.tripStatusUpdates.push(update);
  schedule.tripStatus = status;
  schedule.tripStatusLocation = update.location;
  schedule.tripStatusNote = update.note;
  schedule.tripStatusUpdatedAt = update.createdAt;
  schedule.updatedAt = update.createdAt;
  audit(actorId, 'driver.trip_status.updated', schedule.id, { companyId, status });
  await upsertModel('TripStatusUpdate', update);
  await upsertModel('TripSchedule', schedule);
  return { schedule, update };
}

async function createDriverIncident(companyId, payload = {}, actorId = 'driver') {
  ensureStateCollections();
  const schedule = payload.scheduleId ? findCompanyScheduleOrThrow(companyId, payload.scheduleId) : null;
  const title = cleanText(payload.title || payload.description || 'Driver incident');
  if (!title) {
    const error = new Error('Incident title or description is required');
    error.status = 422;
    throw error;
  }
  const incident = {
    id: nextId('driver-incident', store.state.driverIncidents),
    companyId,
    scheduleId: schedule?.id || cleanText(payload.scheduleId || ''),
    bookingRef: cleanText(payload.bookingRef || ''),
    vehicleId: cleanText(payload.vehicleId || schedule?.vehicleId || ''),
    driverUserId: actorId,
    category: cleanText(payload.category || 'general'),
    severity: cleanText(payload.severity || 'normal'),
    title,
    description: cleanText(payload.description || payload.note || title),
    location: cleanText(payload.location || ''),
    status: cleanText(payload.status || 'open'),
    auditTrail: [{ actorId, action: 'created', at: new Date().toISOString() }],
    createdAt: new Date().toISOString(),
  };
  store.state.driverIncidents.push(incident);
  audit(actorId, 'driver.incident.created', incident.id, { companyId, scheduleId: incident.scheduleId, severity: incident.severity });
  await upsertModel('DriverIncident', incident);
  return incident;
}

async function inviteEmployee(companyId, payload = {}) {
  ensureStateCollections();
  const company = findCompanyOrThrow(companyId);
  const email = cleanText(payload.email).toLowerCase();
  if (!email) {
    const error = new Error('Employee email is required');
    error.status = 422;
    throw error;
  }
  const user = store.upsertUser({
    fullName: cleanText(payload.fullName || payload.name || email.split('@')[0]),
    email,
    phone: cleanText(payload.phone || ''),
    role: 'company_employee',
    companyId: company.id,
    status: payload.status === 'active' ? 'active' : 'pending',
    isVerified: false,
  });
  let employee = store.state.companyEmployees.find((item) => item.companyId === company.id && item.userId === user.id);
  if (!employee) {
    employee = {
      id: nextId('company-employee', store.state.companyEmployees),
      companyId: company.id,
      userId: user.id,
      roleTitle: cleanText(payload.roleTitle || 'Ticket Checker'),
      branch: cleanText(payload.branch || company.city || 'Main branch'),
      permissions: parseList(payload.permissions || 'check_in'),
      status: payload.status || 'invited',
      invitedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    store.state.companyEmployees.push(employee);
  } else {
    employee.roleTitle = cleanText(payload.roleTitle || employee.roleTitle);
    employee.branch = cleanText(payload.branch || employee.branch);
    employee.permissions = parseList(payload.permissions || employee.permissions);
    employee.status = payload.status || employee.status;
    employee.updatedAt = new Date().toISOString();
  }
  await upsertModel('User', user);
  await upsertModel('CompanyEmployee', employee);
  const notificationService = require('../notification/notificationService');
  await notificationService.employeeInvited(user, employee);
  return { user, employee };
}

function normalizeMediaAsset(asset = {}, target = '', metadata = {}) {
  const url = cleanText(asset.secureUrl || asset.url || '');
  return {
    id: cleanText(metadata.id || asset.id || asset.publicId || asset.public_id || `media-${Date.now()}`),
    url,
    secureUrl: url,
    publicId: cleanText(asset.publicId || asset.public_id || url),
    alt: cleanText(metadata.alt || asset.alt || ''),
    label: cleanText(metadata.label || asset.label || ''),
    width: asset.width,
    height: asset.height,
    format: asset.format,
    resourceType: cleanText(asset.resourceType || asset.resource_type || 'image'),
    target,
    uploadedBy: cleanText(metadata.uploadedBy || ''),
    uploadedAt: metadata.uploadedAt || new Date().toISOString(),
  };
}

function mediaMatches(media = {}, publicId = '') {
  const key = cleanText(publicId);
  if (!key) return false;
  return [media.publicId, media.public_id, media.url, media.secureUrl, media.id].some((value) => cleanText(value) === key);
}

async function attachMedia({ companyId, target, targetId, asset, metadata = {} }) {
  const company = findCompanyOrThrow(companyId);
  const media = normalizeMediaAsset(asset, target, metadata);
  if (target === 'companyLogo') {
    media.label = media.label || `${company.name} logo`;
    company.logo = media;
    audit(metadata.uploadedBy || 'system', 'company.media.attached', company.id, { target, publicId: media.publicId });
    await upsertModel('Company', company);
    return { target: 'company', company, media };
  }
  if (target === 'companyCover') {
    media.label = media.label || `${company.name} cover image`;
    company.coverImage = media;
    audit(metadata.uploadedBy || 'system', 'company.media.attached', company.id, { target, publicId: media.publicId });
    await upsertModel('Company', company);
    return { target: 'company', company, media };
  }
  if (target === 'companyDocument' || target === 'companyVerificationDocument') {
    company.documents = Array.isArray(company.documents) ? company.documents : [];
    const documentMedia = decorateDocumentMedia(media, metadata, target === 'companyVerificationDocument' ? 'verification_document' : 'business_license');
    company.documents.push(documentMedia);
    company.verificationStatus = company.verificationStatus === 'verified' ? 'pending' : (company.verificationStatus || 'pending');
    company.settings = { ...(company.settings || {}), canPublish: company.verificationStatus === 'verified' };
    audit(metadata.uploadedBy || 'system', 'company.document.uploaded', company.id, { publicId: documentMedia.publicId, documentType: documentMedia.documentType });
    await upsertModel('Company', company);
    try {
      const verificationService = require('../onboarding/verificationService');
      const review = verificationService.getReview('company', company.id);
      review.documents = Array.isArray(review.documents) ? review.documents : [];
      review.documents.unshift(documentMedia);
      await verificationService.submitCompanyChecklist(company.id, { documentReference: documentMedia.documentReference, supportPhone: company.supportContacts?.phone, supportEmail: company.supportContacts?.email }, metadata.uploadedBy || 'company-system');
    } catch (error) { /* non-blocking verification sync */ }
    return { target: 'company', company, media: documentMedia };
  }
  if (['listingMedia', 'busListing', 'hotelListing'].includes(target)) {
    const listing = findCompanyListingOrThrow(company.id, targetId);
    listing.media = Array.isArray(listing.media) ? listing.media : [];
    media.label = media.label || listing.title;
    listing.media.push(media);
    listing.img = listing.img || media.url;
    audit(metadata.uploadedBy || 'system', 'listing.media.attached', listing.id, { target, publicId: media.publicId });
    await upsertModel('Listing', listing);
    return { target: 'listing', listing, media };
  }
  if (target === 'vehiclePhoto' || target === 'vehicleDocument') {
    const vehicle = findCompanyVehicleOrThrow(company.id, targetId || metadata.targetId);
    vehicle.media = Array.isArray(vehicle.media) ? vehicle.media : [];
    const vehicleMedia = target === 'vehicleDocument' ? decorateDocumentMedia(media, metadata, 'vehicle_document') : { ...media, label: media.label || vehicle.name || 'Vehicle photo' };
    vehicle.media.push(vehicleMedia);
    audit(metadata.uploadedBy || 'system', target === 'vehicleDocument' ? 'vehicle.document.uploaded' : 'vehicle.media.uploaded', vehicle.id, { companyId: company.id, publicId: vehicleMedia.publicId });
    await upsertModel('Vehicle', vehicle);
    return { target: 'vehicle', vehicle, media: vehicleMedia };
  }
  if (target === 'driverDocument') {
    const driver = findCompanyDriverOrThrow(company.id, targetId || metadata.targetId);
    driver.documents = Array.isArray(driver.documents) ? driver.documents : [];
    const driverMedia = decorateDocumentMedia(media, metadata, 'driver_license');
    driver.documents.unshift(driverMedia);
    driver.safetyStatus = 'pending_review';
    audit(metadata.uploadedBy || 'system', 'driver.document.uploaded', driver.id, { companyId: company.id, publicId: driverMedia.publicId });
    await upsertModel('CompanyEmployee', driver);
    try {
      const verificationService = require('../onboarding/verificationService');
      const review = verificationService.getReview('driver', driver.id);
      review.documents = Array.isArray(review.documents) ? review.documents : [];
      review.documents.unshift(driverMedia);
      await verificationService.submitDriverChecklist(driver.id, { documentType: driverMedia.documentType, documentReference: driverMedia.documentReference, licenseNumber: driver.licenseNumber }, metadata.uploadedBy || 'company-system');
    } catch (error) { /* non-blocking verification sync */ }
    return { target: 'driver', driver, media: driverMedia };
  }
  if (target === 'hotelPropertyMedia') {
    const property = findHotelPropertyOrThrow(company.id, targetId || metadata.targetId);
    property.media = Array.isArray(property.media) ? property.media : [];
    const propertyMedia = /document|license|permit/i.test(metadata.documentType || '') ? decorateDocumentMedia(media, metadata, 'hotel_property_document') : { ...media, label: media.label || property.propertyName || 'Hotel property media' };
    property.media.push(propertyMedia);
    audit(metadata.uploadedBy || 'system', 'hotel.property.media.uploaded', property.id, { companyId: company.id, publicId: propertyMedia.publicId });
    await upsertModel('HotelProperty', property);
    return { target: 'hotelProperty', property, media: propertyMedia };
  }
  if (target === 'roomTypeMedia') {
    const roomType = findRoomTypeOrThrow(company.id, targetId || metadata.targetId);
    roomType.images = Array.isArray(roomType.images) ? roomType.images : [];
    const roomTypeMedia = { ...media, label: media.label || roomType.name || 'Room type media' };
    roomType.images.push(roomTypeMedia);
    audit(metadata.uploadedBy || 'system', 'hotel.room_type.media.uploaded', roomType.id, { companyId: company.id, publicId: roomTypeMedia.publicId });
    await upsertModel('RoomType', roomType);
    return { target: 'roomType', roomType, media: roomTypeMedia };
  }
  if (target === 'roomUnitMedia' || target === 'guestDocument') {
    const roomUnit = findRoomUnitOrThrow(company.id, targetId || metadata.targetId);
    roomUnit.media = Array.isArray(roomUnit.media) ? roomUnit.media : [];
    roomUnit.documents = Array.isArray(roomUnit.documents) ? roomUnit.documents : [];
    const unitMedia = target === 'guestDocument' ? decorateDocumentMedia(media, metadata, 'guest_identity_document') : { ...media, label: media.label || roomUnit.unitNumber || 'Room unit media' };
    if (target === 'guestDocument') roomUnit.documents.unshift(unitMedia); else roomUnit.media.push(unitMedia);
    audit(metadata.uploadedBy || 'system', target === 'guestDocument' ? 'hotel.guest.document.uploaded' : 'hotel.room_unit.media.uploaded', roomUnit.id, { companyId: company.id, publicId: unitMedia.publicId });
    await upsertModel('RoomUnit', roomUnit);
    return { target: 'roomUnit', roomUnit, media: unitMedia };
  }
  return { target: 'unattached', media };
}

async function removeMedia({ companyId, target, targetId, publicId, actorId = 'system' }) {
  const company = findCompanyOrThrow(companyId);
  let removedMedia = null;
  if (target === 'companyLogo') {
    if (company.logo && (!publicId || mediaMatches(company.logo, publicId))) {
      removedMedia = company.logo;
      company.logo = null;
    }
    await upsertModel('Company', company);
    audit(actorId, 'company.media.deleted', company.id, { target, publicId: removedMedia?.publicId || publicId });
    return { target: 'company', company, media: removedMedia };
  }
  if (target === 'companyCover') {
    if (company.coverImage && (!publicId || mediaMatches(company.coverImage, publicId))) {
      removedMedia = company.coverImage;
      company.coverImage = null;
    }
    await upsertModel('Company', company);
    audit(actorId, 'company.media.deleted', company.id, { target, publicId: removedMedia?.publicId || publicId });
    return { target: 'company', company, media: removedMedia };
  }
  if (target === 'companyDocument' || target === 'companyVerificationDocument') {
    const documents = Array.isArray(company.documents) ? company.documents : [];
    const nextDocuments = documents.filter((document) => {
      const match = mediaMatches(document, publicId);
      if (match) removedMedia = document;
      return !match;
    });
    company.documents = nextDocuments;
    await upsertModel('Company', company);
    audit(actorId, 'company.document.deleted', company.id, { publicId: removedMedia?.publicId || publicId });
    return { target: 'company', company, media: removedMedia };
  }
  if (['listingMedia', 'busListing', 'hotelListing'].includes(target)) {
    const listing = findCompanyListingOrThrow(company.id, targetId);
    const mediaList = Array.isArray(listing.media) ? listing.media : [];
    listing.media = mediaList.filter((media) => {
      const match = mediaMatches(media, publicId);
      if (match) removedMedia = media;
      return !match;
    });
    if (removedMedia && listing.img === removedMedia.url) listing.img = listing.media[0]?.url || '';
    await upsertModel('Listing', listing);
    audit(actorId, 'listing.media.deleted', listing.id, { target, publicId: removedMedia?.publicId || publicId });
    return { target: 'listing', listing, media: removedMedia };
  }
  if (target === 'vehiclePhoto' || target === 'vehicleDocument') {
    const vehicle = findCompanyVehicleOrThrow(company.id, targetId);
    vehicle.media = (vehicle.media || []).filter((media) => { const match = mediaMatches(media, publicId); if (match) removedMedia = media; return !match; });
    await upsertModel('Vehicle', vehicle);
    audit(actorId, 'vehicle.media.deleted', vehicle.id, { target, publicId: removedMedia?.publicId || publicId });
    return { target: 'vehicle', vehicle, media: removedMedia };
  }
  if (target === 'driverDocument') {
    const driver = findCompanyDriverOrThrow(company.id, targetId);
    driver.documents = (driver.documents || []).filter((media) => { const match = mediaMatches(media, publicId); if (match) removedMedia = media; return !match; });
    await upsertModel('CompanyEmployee', driver);
    audit(actorId, 'driver.document.deleted', driver.id, { publicId: removedMedia?.publicId || publicId });
    return { target: 'driver', driver, media: removedMedia };
  }
  if (target === 'hotelPropertyMedia') {
    const property = findHotelPropertyOrThrow(company.id, targetId);
    property.media = (property.media || []).filter((media) => { const match = mediaMatches(media, publicId); if (match) removedMedia = media; return !match; });
    await upsertModel('HotelProperty', property);
    audit(actorId, 'hotel.property.media.deleted', property.id, { publicId: removedMedia?.publicId || publicId });
    return { target: 'hotelProperty', property, media: removedMedia };
  }
  if (target === 'roomTypeMedia') {
    const roomType = findRoomTypeOrThrow(company.id, targetId);
    roomType.images = (roomType.images || []).filter((media) => { const match = mediaMatches(media, publicId); if (match) removedMedia = media; return !match; });
    await upsertModel('RoomType', roomType);
    audit(actorId, 'hotel.room_type.media.deleted', roomType.id, { publicId: removedMedia?.publicId || publicId });
    return { target: 'roomType', roomType, media: removedMedia };
  }
  if (target === 'roomUnitMedia' || target === 'guestDocument') {
    const roomUnit = findRoomUnitOrThrow(company.id, targetId);
    const collection = target === 'guestDocument' ? 'documents' : 'media';
    roomUnit[collection] = (roomUnit[collection] || []).filter((media) => { const match = mediaMatches(media, publicId); if (match) removedMedia = media; return !match; });
    await upsertModel('RoomUnit', roomUnit);
    audit(actorId, 'hotel.room_unit.media.deleted', roomUnit.id, { target, publicId: removedMedia?.publicId || publicId });
    return { target: 'roomUnit', roomUnit, media: removedMedia };
  }
  return { target: 'unattached', media: null };
}

module.exports = {
  createCompany,
  setVerificationStatus,
  createListing,
  updateListing,
  publishListing,
  archiveListing,
  createRoute,
  updateRoute,
  archiveRoute,
  createRouteStop,
  updateRouteStop,
  archiveRouteStop,
  moveRouteStop,
  createVehicle,
  updateVehicle,
  archiveVehicle,
  updateVehicleSeatTemplate,
  updateVehicleStatus,
  createSchedule,
  updateSchedule,
  publishSchedule,
  archiveSchedule,
  transitionSchedule,
  completeSchedule,
  duplicateSchedule,
  updateSeatStatus,
  createRoom,
  updateRoomInventory,
  archiveRoom,
  createBranch,
  createPolicy,
  inviteEmployee,
  updateEmployeeRole,
  updateDriverProfile,
  assignDriver,
  updateTripStatus,
  createDriverIncident,
  attachMedia,
  removeMedia,
  companyCanPublish,
};
