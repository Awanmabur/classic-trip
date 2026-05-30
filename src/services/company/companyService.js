const store = require('../data/demoStore');
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
  const seats = [];
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let index = 0; index < totalSeats; index += 1) {
    const row = letters[Math.floor(index / 4)] || `R${Math.floor(index / 4) + 1}`;
    seats.push(`${row}${(index % 4) + 1}`);
  }
  return seats;
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
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const columnCount = Math.max(1, Math.round(moneyValue(cols, 4)));
  return seatNumbers(totalSeats).map((seatNumber, index) => ({
    id: seatNumber,
    seatNumber,
    row: Math.floor(index / columnCount) + 1,
    col: (index % columnCount) + 1,
    label: seatNumber,
    isAisle: false,
    isDisabled: false,
  })).map((seat, index) => {
    if (index >= 26 * columnCount) return { ...seat, seatNumber: `R${Math.floor(index / columnCount) + 1}-${(index % columnCount) + 1}`, id: `R${Math.floor(index / columnCount) + 1}-${(index % columnCount) + 1}` };
    return { ...seat, seatNumber: `${letters[Math.floor(index / columnCount)]}${(index % columnCount) + 1}`, id: `${letters[Math.floor(index / columnCount)]}${(index % columnCount) + 1}` };
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
  if (!Array.isArray(store.state.vehicles)) store.state.vehicles = [];
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

async function setVerificationStatus(identifier, status = COMPANY_STATUS.VERIFIED, adminId = 'admin-system') {
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
    origin,
    destination,
    corridor: cleanText(payload.corridor || `${toSlug(origin)}-${toSlug(destination)}`),
    boardingPoints: parseList(payload.boardingPoints),
    dropoffPoints: parseList(payload.dropoffPoints),
    baggageRules: cleanText(payload.baggageRules || listing.baggageRules || ''),
    cancellationRules: cleanText(payload.cancellationRules || listing.cancellationRules || ''),
    status: cleanText(payload.status || 'active'),
    createdAt: new Date().toISOString(),
  };
  listing.from = origin;
  listing.to = destination;
  listing.corridor = route.corridor;
  store.state.routes.push(route);
  await upsertModel('Route', route);
  await upsertModel('Listing', listing);
  return route;
}

async function updateRoute(companyId, routeId, payload = {}) {
  const company = findCompanyOrThrow(companyId);
  const route = findCompanyRouteOrThrow(company.id, routeId);
  const listing = findCompanyListingOrThrow(company.id, route.listingId);
  if (payload.origin || payload.from) route.origin = cleanText(payload.origin || payload.from);
  if (payload.destination || payload.to) route.destination = cleanText(payload.destination || payload.to);
  if (payload.corridor) route.corridor = cleanText(payload.corridor);
  else route.corridor = `${toSlug(route.origin)}-${toSlug(route.destination)}`;
  if (payload.boardingPoints) route.boardingPoints = parseList(payload.boardingPoints);
  if (payload.dropoffPoints) route.dropoffPoints = parseList(payload.dropoffPoints);
  if (payload.baggageRules) route.baggageRules = cleanText(payload.baggageRules);
  if (payload.cancellationRules) route.cancellationRules = cleanText(payload.cancellationRules);
  if (payload.status) route.status = cleanText(payload.status);
  route.updatedAt = new Date().toISOString();
  listing.from = route.origin;
  listing.to = route.destination;
  listing.corridor = route.corridor;
  await upsertModel('Route', route);
  await upsertModel('Listing', listing);
  return route;
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
    departAt: payload.departAt ? new Date(payload.departAt).toISOString() : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    arriveAt: payload.arriveAt ? new Date(payload.arriveAt).toISOString() : null,
    basePrice: moneyValue(payload.basePrice || payload.priceFrom, listing.priceFrom),
    currency: cleanText(payload.currency || listing.currency || 'UGX'),
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
    priceDelta: index < 4 ? moneyValue(payload.vipPriceDelta, 12000) : 0,
    status: blockedSeats.has(seatNumber) ? 'blocked' : 'available',
    lockedUntil: null,
    lockId: null,
    createdAt: new Date().toISOString(),
  }));
  schedule.availableSeats = seats.filter((seat) => seat.status === 'available').length;
  store.state.schedules.push(schedule);
  store.state.seats.push(...seats);
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
  if (payload.departAt) schedule.departAt = new Date(payload.departAt).toISOString();
  if (payload.arriveAt) schedule.arriveAt = new Date(payload.arriveAt).toISOString();
  if (typeof payload.basePrice !== 'undefined') schedule.basePrice = moneyValue(payload.basePrice, schedule.basePrice);
  if (payload.currency) schedule.currency = cleanText(payload.currency);
  if (payload.status) schedule.status = cleanText(payload.status);
  schedule.updatedAt = new Date().toISOString();
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

async function updateSeatStatus(companyId, payload = {}) {
  const company = findCompanyOrThrow(companyId);
  const schedule = findCompanyScheduleOrThrow(company.id, payload.scheduleId);
  const seat = store.seatsForSchedule(schedule.id).find((item) => item.seatNumber === payload.seatNumber || item.id === payload.seatId);
  if (!seat) {
    const error = new Error('Seat not found for this schedule');
    error.status = 404;
    throw error;
  }
  const allowedStatuses = ['available', 'locked', 'taken', 'blocked'];
  if (payload.status && !allowedStatuses.includes(payload.status)) {
    const error = new Error('Invalid seat status');
    error.status = 422;
    throw error;
  }
  if (payload.status) seat.status = payload.status;
  if (payload.seatClass) seat.seatClass = cleanText(payload.seatClass);
  if (typeof payload.priceDelta !== 'undefined') seat.priceDelta = moneyValue(payload.priceDelta, seat.priceDelta);
  if (payload.status !== 'locked') {
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

async function attachMedia({ companyId, target, targetId, asset }) {
  const company = findCompanyOrThrow(companyId);
  const media = {
    url: asset.url || asset.secureUrl,
    secureUrl: asset.secureUrl || asset.url,
    publicId: asset.publicId || asset.public_id || asset.url,
    alt: cleanText(asset.alt || ''),
    width: asset.width,
    height: asset.height,
    format: asset.format,
    resourceType: asset.resourceType,
  };
  if (target === 'companyLogo') {
    company.logo = media;
    await upsertModel('Company', company);
    return { target: 'company', company, media };
  }
  if (target === 'companyCover') {
    company.coverImage = media;
    await upsertModel('Company', company);
    return { target: 'company', company, media };
  }
  if (target === 'companyDocument') {
    company.documents = Array.isArray(company.documents) ? company.documents : [];
    company.documents.push(media);
    await upsertModel('Company', company);
    return { target: 'company', company, media };
  }
  if (['listingMedia', 'busListing', 'hotelListing'].includes(target)) {
    const listing = findCompanyListingOrThrow(company.id, targetId);
    listing.media = Array.isArray(listing.media) ? listing.media : [];
    listing.media.push(media);
    listing.img = listing.img || media.url;
    await upsertModel('Listing', listing);
    return { target: 'listing', listing, media };
  }
  return { target: 'unattached', media };
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
  createVehicle,
  updateVehicle,
  archiveVehicle,
  createSchedule,
  updateSchedule,
  archiveSchedule,
  updateSeatStatus,
  createRoom,
  updateRoomInventory,
  archiveRoom,
  inviteEmployee,
  attachMedia,
  companyCanPublish,
};
