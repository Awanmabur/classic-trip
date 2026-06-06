const { buildSeedData } = require('../../seeds/seedAll');
const generateBookingRef = require('../../utils/generateBookingRef');
const calculateCommission = require('../../utils/calculateCommission');
const { addMinutes } = require('../../utils/dates');
const { ENABLED_BOOKING_TYPES } = require('../../config/constants');
const toSlug = require('../../utils/slugify');

const state = buildSeedData();
const DATABASE_MODELS = {
  users: 'User',
  companies: 'Company',
  categories: 'ServiceCategory',
  listings: 'Listing',
  routes: 'Route',
  vehicles: 'Vehicle',
  schedules: 'TripSchedule',
  seats: 'Seat',
  rooms: 'Room',
  companyEmployees: 'CompanyEmployee',
  bookings: 'Booking',
  payments: 'Payment',
  wallets: 'Wallet',
  walletTransactions: 'WalletTransaction',
  promoterLinks: 'PromoterLink',
  referralClicks: 'ReferralClick',
  commissions: 'Commission',
  blogs: 'BlogPost',
  supportTickets: 'SupportTicket',
  refundRequests: 'RefundRequest',
  promotionCampaigns: 'PromotionCampaign',
  reviews: 'Review',
  auditLogs: 'AuditLog',
  notifications: 'Notification',
};
const FALLBACK_MEDIA = {
  bus: 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&w=1200&q=70',
  hotel: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=70',
  flight: 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=1200&q=70',
  train: 'https://images.unsplash.com/photo-1474487548417-781cb71495f3?auto=format&fit=crop&w=1200&q=70',
  default: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1400&q=70',
};
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
const TYPE_ORDER = ['bus', 'hotel', 'flight', 'train'];
const ROUTED_SERVICE_TYPES = ['bus', 'flight', 'train', 'ferry', 'tour', 'airport_transfer', 'package', 'cargo'];
const CITY_CODES = {
  kampala: 'ug',
  entebbe: 'ug',
  jinja: 'ug',
  gulu: 'ug',
  mukono: 'ug',
  mbarara: 'ug',
  masaka: 'ug',
  uganda: 'ug',
  nairobi: 'ke',
  mombasa: 'ke',
  kisumu: 'ke',
  kenya: 'ke',
  kigali: 'rw',
  rwanda: 'rw',
  arusha: 'tz',
  zanzibar: 'tz',
  morogoro: 'tz',
  'dar es salaam': 'tz',
  tanzania: 'tz',
  bujumbura: 'bi',
  burundi: 'bi',
  juba: 'ss',
  'south sudan': 'ss',
  'addis ababa': 'et',
  ethiopia: 'et',
  djibouti: 'dj',
  mogadishu: 'so',
  somalia: 'so',
  goma: 'drc',
  'dr congo': 'drc',
  congo: 'drc',
};

function addonCatalogFor(serviceType) {
  const options = serviceType === 'hotel'
    ? [
      { name: 'Breakfast package', price: 18000 },
      { name: 'Airport pickup', price: 45000 },
      { name: 'Late checkout', price: 25000 },
    ]
    : serviceType === 'flight'
      ? [
        { name: 'Extra baggage', price: 55000 },
        { name: 'Priority boarding', price: 25000 },
        { name: 'Travel insurance', price: 18000 },
      ]
      : [
        { name: 'Extra luggage', price: 12000 },
        { name: 'Priority boarding', price: 8000 },
        { name: 'SMS and WhatsApp ticket', price: 2500 },
      ];
  return options.map((option) => ({ ...option, id: option.id || toSlug(option.name) }));
}

function requestedAddonIds(payload = {}) {
  const raw = payload.addons || payload.addonIds || payload.addon || [];
  return (Array.isArray(raw) ? raw : [raw])
    .flatMap((value) => String(value || '').split(','))
    .map((value) => toSlug(value))
    .filter(Boolean);
}

function selectedAddonsFor(serviceType, payload = {}) {
  const ids = new Set(requestedAddonIds(payload));
  if (!ids.size) return [];
  return addonCatalogFor(serviceType).filter((addon) => ids.has(addon.id));
}

function releaseExpiredSeatLocks(now = new Date()) {
  state.seats.forEach((seat) => {
    if (seat.status === 'locked' && seat.lockedUntil && new Date(seat.lockedUntil) <= now) {
      seat.status = 'available';
      seat.lockedUntil = null;
      seat.lockId = null;
    }
  });
}

function stripMongoFields(row) {
  const clean = { ...row };
  if (!clean.id && row._id) clean.id = String(row._id);
  if (clean.companyId && typeof clean.companyId !== 'string') clean.companyId = String(clean.companyId);
  if (clean.ownerId && typeof clean.ownerId !== 'string') clean.ownerId = String(clean.ownerId);
  delete clean._id;
  delete clean.__v;
  return clean;
}

function recordKey(stateKey, row) {
  if (stateKey === 'categories') return normalize(row.key || row.id || row.label);
  if (stateKey === 'companies') return normalize(row.slug || row.id || row.name);
  if (stateKey === 'listings') return normalize(row.slug || row.id || row.title);
  if (stateKey === 'bookings') return normalize(row.bookingRef || row.id);
  if (stateKey === 'promoterLinks') return normalize(row.code || row.id);
  if (stateKey === 'wallets') return normalize(row.id || `${row.ownerType}-${row.ownerId}-${row.currency}`);
  return normalize(row.id || row.slug || row.key || row.code || row.name || row.title);
}

function mergeHydratedRecords(stateKey, incomingRows) {
  const currentRows = Array.isArray(state[stateKey]) ? state[stateKey] : [];
  const rowsByKey = new Map();
  currentRows.forEach((row) => rowsByKey.set(recordKey(stateKey, row), row));
  incomingRows.forEach((row) => {
    const key = recordKey(stateKey, row);
    rowsByKey.set(key, { ...(rowsByKey.get(key) || {}), ...row });
  });
  return Array.from(rowsByKey.values());
}

function normalizeMedia(media, fallbackUrl, alt) {
  if (!media) return { url: fallbackUrl, publicId: 'classic-trip/fallback', alt };
  if (typeof media === 'string') return { url: media, publicId: media, alt };
  return {
    ...media,
    url: media.url || media.secureUrl || fallbackUrl,
    publicId: media.publicId || media.public_id || media.url || 'classic-trip/fallback',
    alt: media.alt || alt,
  };
}

function normalizeMediaList(row, serviceType) {
  const fallbackUrl = FALLBACK_MEDIA[serviceType] || FALLBACK_MEDIA.default;
  const rawMedia = Array.isArray(row.media) && row.media.length
    ? row.media
    : Array.isArray(row.images) && row.images.length
      ? row.images
      : [row.image || row.img].filter(Boolean);
  const media = rawMedia.map((item) => normalizeMedia(item, fallbackUrl, row.title || row.name || 'Classic Trip listing'));
  return media.length ? media : [normalizeMedia(null, fallbackUrl, row.title || row.name || 'Classic Trip listing')];
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

function ensureBookableInventory() {
  if (!Array.isArray(state.vehicles)) state.vehicles = [];
  state.listings.forEach((listing) => {
    if (!listing.bookable) return;
    if (listing.serviceType === 'bus' && !state.schedules.some((schedule) => schedule.listingId === listing.id)) {
      const routeId = `auto-route-${toSlug(listing.id)}`;
      const vehicleId = `auto-vehicle-${toSlug(listing.id)}`;
      const scheduleId = `auto-schedule-${toSlug(listing.id)}`;
      const totalSeats = Math.max(Number(listing.availability || listing.availableUnits || 28), 12);
      const takenSeats = Array.isArray(listing.taken) ? listing.taken : [];
      if (!state.routes.some((route) => route.listingId === listing.id)) {
        state.routes.push({
          id: routeId,
          listingId: listing.id,
          companyId: listing.companyId,
          origin: listing.from,
          destination: listing.to,
          corridor: listing.corridor || `${toSlug(listing.from)}-${toSlug(listing.to)}`,
          status: 'active',
        });
      }
      if (!state.vehicles.some((vehicle) => vehicle.companyId === listing.companyId && vehicle.listingId === listing.id && vehicle.status !== 'archived')) {
        state.vehicles.push({
          id: vehicleId,
          companyId: listing.companyId,
          listingId: listing.id,
          serviceType: listing.serviceType,
          name: `${listing.companyName || listing.partner || 'Partner'} ${listing.type || 'Coach'}`,
          plateOrCode: vehicleId.replace('auto-vehicle-', 'CT-').slice(0, 16).toUpperCase(),
          layoutName: listing.layout || '2x2',
          rows: Math.ceil(totalSeats / 4),
          cols: 4,
          totalSeats,
          seats: seatNumbers(totalSeats).map((seatNumber, index) => ({
            id: seatNumber,
            seatNumber,
            row: Math.floor(index / 4) + 1,
            col: (index % 4) + 1,
            label: seatNumber,
            isAisle: false,
            isDisabled: false,
          })),
          amenities: ['Ticket scanner'],
          media: listing.media,
          status: 'active',
        });
      }
      const assignedVehicle = state.vehicles.find((vehicle) => vehicle.companyId === listing.companyId && vehicle.listingId === listing.id && vehicle.status !== 'archived')
        || state.vehicles.find((vehicle) => vehicle.id === vehicleId);
      state.schedules.push({
        id: scheduleId,
        routeId,
        listingId: listing.id,
        companyId: listing.companyId,
        vehicleId: assignedVehicle?.id || vehicleId,
        vehicleName: assignedVehicle?.name || '',
        departAt: addMinutes(new Date(), 1440).toISOString(),
        arriveAt: addMinutes(new Date(), 1560).toISOString(),
        basePrice: listing.priceFrom,
        currency: listing.currency,
        totalSeats,
        availableSeats: Math.max(0, totalSeats - takenSeats.length),
        status: 'active',
      });
      seatNumbers(totalSeats).forEach((seatNumber, index) => {
        state.seats.push({
          id: `auto-seat-${toSlug(listing.id)}-${seatNumber}`,
          scheduleId,
          seatNumber,
          seatClass: index < 4 ? 'VIP' : 'Standard',
          priceDelta: index < 4 ? 12000 : 0,
          status: takenSeats.includes(seatNumber) ? 'taken' : 'available',
          lockedUntil: null,
        });
      });
    }
    if (listing.serviceType === 'hotel' && !state.rooms.some((room) => room.listingId === listing.id)) {
      state.rooms.push({
        id: `auto-room-${toSlug(listing.id)}`,
        listingId: listing.id,
        companyId: listing.companyId,
        roomType: 'Standard Room',
        capacity: 2,
        nightlyPrice: listing.priceFrom,
        inventory: Math.max(Number(listing.availability || listing.availableUnits || 6), 1),
        amenities: ['Wi-Fi', 'Receipt', 'Support'],
        media: listing.media,
        status: 'active',
      });
    }
  });
}

function normalizeHydratedState() {
  state.companies = state.companies.map((company) => {
    const slug = company.slug || toSlug(company.name || company.id || 'partner');
    return {
      ...company,
      id: company.id || slug,
      slug,
      companyType: company.companyType || company.type || 'partner',
      country: company.country || 'Uganda',
      city: company.city || 'Kampala',
      description: company.description || 'Verified Classic Trip partner.',
      logo: normalizeMedia(company.logo || company.logoUrl, `https://ui-avatars.com/api/?name=${encodeURIComponent(company.name || 'Classic Trip')}&background=4f8cff&color=fff&bold=true`, company.name || 'Classic Trip partner'),
      coverImage: normalizeMedia(company.coverImage || company.coverUrl, FALLBACK_MEDIA.default, company.name || 'Classic Trip partner'),
      verificationStatus: company.verificationStatus || (company.isVerified ? 'verified' : 'pending'),
      supportContacts: company.supportContacts || { phone: '+256 700 000 000', email: 'support@classictrip.example', whatsapp: '+256 700 000 999' },
      ratingAverage: Number(company.ratingAverage || company.rating || 4.5),
      reviewCount: Number(company.reviewCount || 0),
      settings: company.settings || { instantConfirmation: true, canPublish: true },
    };
  });

  state.listings = state.listings.map((listing) => {
    const serviceType = listing.serviceType || listing.group || 'bus';
    const company = state.companies.find((item) => normalize(item.id) === normalize(listing.companyId) || normalize(item.slug) === normalize(listing.companySlug));
    const title = listing.title || `${listing.origin || listing.from || listing.city || 'Classic'} to ${listing.destination || listing.to || 'Trip'} ${SERVICE_LABELS[serviceType] || 'Service'}`;
    const slug = listing.slug || toSlug(`${title}-${company?.name || listing.companyName || 'classic-trip'}`);
    const media = normalizeMediaList(listing, serviceType);
    return {
      ...listing,
      id: listing.id || slug,
      serviceType,
      group: listing.group || serviceType,
      type: listing.type || SERVICE_LABELS[serviceType] || serviceType,
      title,
      slug,
      sub: listing.sub || listing.description || listing.policy || `${company?.name || listing.companyName || 'Classic Trip'} service`,
      companyId: listing.companyId || company?.id || '',
      companySlug: listing.companySlug || company?.slug || 'classic-trip',
      companyName: listing.companyName || company?.name || listing.partner || 'Classic Trip Partner',
      partner: listing.partner || listing.companyName || company?.name || 'Classic Trip Partner',
      from: listing.from || listing.origin || listing.city || '',
      to: listing.to || listing.destination || listing.city || '',
      time: listing.time || listing.timeLabel || 'On schedule',
      duration: listing.duration || listing.durationLabel || 'Scheduled service',
      price: listing.price || listing.priceFrom || 0,
      priceFrom: Number(listing.priceFrom || listing.price || 0),
      currency: listing.currency || 'UGX',
      media,
      img: listing.img || media[0]?.url,
      amenities: Array.isArray(listing.amenities) ? listing.amenities : [],
      checkInTime: listing.checkInTime || '',
      checkOutTime: listing.checkOutTime || '',
      serviceNotes: listing.serviceNotes || '',
      contactPhone: listing.contactPhone || '',
      pickupInstructions: listing.pickupInstructions || '',
      dropoffInstructions: listing.dropoffInstructions || '',
      ratingAverage: Number(listing.ratingAverage || listing.rating || 4.5),
      rating: String(listing.rating || listing.ratingAverage || '4.5'),
      reviewCount: Number(listing.reviewCount || 0),
      bookable: typeof listing.bookable === 'boolean' ? listing.bookable : ENABLED_BOOKING_TYPES.includes(serviceType),
      releaseStatus: listing.releaseStatus || (ENABLED_BOOKING_TYPES.includes(serviceType) ? 'live' : 'teaser'),
      status: listing.status || 'active',
      policy: listing.policy || (ENABLED_BOOKING_TYPES.includes(serviceType) ? 'Instant - refundable rules apply' : 'Integration preview'),
      layout: listing.layout || (serviceType === 'hotel' ? 'hotel-rooms' : 'bus-2-2'),
      taken: Array.isArray(listing.taken) ? listing.taken : [],
      availability: Number(listing.availability || listing.availableUnits || 0),
      cancellationRules: listing.cancellationRules || 'Free cancellation before operator cutoff. Refund rules vary by partner.',
      baggageRules: listing.baggageRules || (serviceType === 'bus' ? 'One main bag + one cabin bag included.' : ''),
    };
  });

  state.vehicles = (Array.isArray(state.vehicles) ? state.vehicles : []).map((vehicle) => {
    const listing = state.listings.find((item) => item.id === vehicle.listingId);
    const company = state.companies.find((item) => item.id === vehicle.companyId) || state.companies.find((item) => item.id === listing?.companyId);
    const totalSeats = Number(vehicle.totalSeats || vehicle.capacity || 0) || Math.max(12, Number(listing?.availability || 48));
    return {
      ...vehicle,
      id: vehicle.id || toSlug(`${vehicle.name || 'vehicle'}-${vehicle.plateOrCode || totalSeats}`),
      companyId: vehicle.companyId || company?.id || listing?.companyId || '',
      listingId: vehicle.listingId || listing?.id || '',
      serviceType: vehicle.serviceType || listing?.serviceType || vehicle.type || 'bus',
      name: vehicle.name || `${company?.name || 'Partner'} vehicle`,
      plateOrCode: vehicle.plateOrCode || vehicle.code || '',
      layoutName: vehicle.layoutName || vehicle.layout || listing?.layout || '2x2',
      rows: Number(vehicle.rows || Math.ceil(totalSeats / 4)),
      cols: Number(vehicle.cols || 4),
      totalSeats,
      seats: Array.isArray(vehicle.seats) ? vehicle.seats : seatNumbers(totalSeats).map((seatNumber, index) => ({
        id: seatNumber,
        seatNumber,
        row: Math.floor(index / 4) + 1,
        col: (index % 4) + 1,
        label: seatNumber,
        isAisle: false,
        isDisabled: false,
      })),
      amenities: Array.isArray(vehicle.amenities) ? vehicle.amenities : [],
      media: Array.isArray(vehicle.media) ? vehicle.media : [],
      status: vehicle.status || 'active',
    };
  });

  state.schedules = state.schedules.map((schedule) => {
    const vehicle = state.vehicles.find((item) => item.id === schedule.vehicleId)
      || state.vehicles.find((item) => item.companyId === schedule.companyId && item.listingId === schedule.listingId && item.status !== 'archived');
    return {
      ...schedule,
      vehicleId: schedule.vehicleId || vehicle?.id || '',
      vehicleName: schedule.vehicleName || vehicle?.name || '',
      totalSeats: Number(schedule.totalSeats || vehicle?.totalSeats || 0),
      availableSeats: Number(schedule.availableSeats || 0),
      currency: schedule.currency || 'UGX',
      status: schedule.status || 'active',
    };
  });

  state.categories = state.categories.map((category) => ({
    ...category,
    key: category.key || toSlug(category.label || category.name || 'service'),
    label: category.label || category.name || SERVICE_LABELS[category.key] || 'Service',
    icon: category.icon || 'fa-ticket',
    bookable: typeof category.bookable === 'boolean' ? category.bookable : ENABLED_BOOKING_TYPES.includes(category.key),
    release: category.release || (ENABLED_BOOKING_TYPES.includes(category.key) ? 'v1' : 'architecture-ready'),
  }));

  ensureBookableInventory();
}

async function hydrateFromDatabase({ mongoose, logger } = {}) {
  if (!mongoose || mongoose.connection.readyState !== 1) {
    return { source: 'memory', loadedCollections: 0, loadedRecords: 0 };
  }

  const nextState = {};
  let loadedCollections = 0;
  let loadedRecords = 0;

  for (const [stateKey, modelName] of Object.entries(DATABASE_MODELS)) {
    try {
      require(`../../models/${modelName}`);
      const Model = mongoose.model(modelName);
      const rows = await Model.find({}).lean();
      if (rows.length) {
        nextState[stateKey] = rows.map(stripMongoFields);
        loadedCollections += 1;
        loadedRecords += rows.length;
      }
    } catch (error) {
      logger?.warn?.('Database hydration skipped collection', { modelName, stateKey, error: error.message });
    }
  }

  if (!loadedRecords) {
    logger?.info?.('Database hydration found no records; using in-memory seed data');
    return { source: 'memory', loadedCollections: 0, loadedRecords: 0 };
  }

  Object.entries(nextState).forEach(([stateKey, rows]) => {
    state[stateKey] = mergeHydratedRecords(stateKey, rows);
  });
  normalizeHydratedState();
  logger?.info?.('Database hydration completed', { loadedCollections, loadedRecords });
  return { source: 'database', loadedCollections, loadedRecords };
}

function normalize(value) {
  return String(value || '').toLowerCase().trim();
}

function isActivePromoterLink(link = {}) {
  return !['archived', 'deleted', 'disabled'].includes(normalize(link.status));
}

function cleanNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function placeCode(value) {
  const raw = normalize(value);
  return CITY_CODES[raw] || '';
}

function listingCorridorCode(listing = {}) {
  const fromCode = placeCode(listing.from || listing.city || listing.country);
  const toCode = placeCode(listing.to || listing.city || listing.country);
  if (!fromCode && !toCode) return listing.corridor || 'regional';
  if (fromCode && toCode && fromCode === toCode) return `${fromCode}-local`;
  if (fromCode && toCode) return [fromCode, toCode].sort().join('-');
  return `${fromCode || toCode}-local`;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function routeLabelForListing(listing = {}) {
  if (listing.from && listing.to) return `${listing.from} to ${listing.to}`;
  if (listing.city && listing.country) return `${listing.city}, ${listing.country}`;
  return listing.city || listing.country || 'Live listing';
}

function scheduleSeatStats(schedule) {
  const seats = seatsForSchedule(schedule.id);
  const total = seats.length || cleanNumber(schedule.totalSeats);
  const booked = seats.filter((seat) => seat.status === 'taken').length;
  const held = seats.filter((seat) => seat.status === 'locked').length;
  const blocked = seats.filter((seat) => seat.status === 'blocked').length;
  const available = seats.length ? seats.filter((seat) => seat.status === 'available').length : cleanNumber(schedule.availableSeats);
  return { total, booked, held, blocked, available };
}

function listingAvailabilitySnapshot(listing = {}) {
  if (listing.serviceType === 'bus' || listing.serviceType === 'train' || listing.serviceType === 'flight') {
    const schedules = schedulesForListing(listing.id).filter((schedule) => schedule.status !== 'archived' && schedule.status !== 'cancelled');
    const totals = schedules.reduce((acc, schedule) => {
      const stats = scheduleSeatStats(schedule);
      acc.total += stats.total;
      acc.booked += stats.booked;
      acc.held += stats.held;
      acc.blocked += stats.blocked;
      acc.available += stats.available;
      return acc;
    }, { total: 0, booked: 0, held: 0, blocked: 0, available: 0 });
    const nextSchedule = schedules
      .map((schedule) => ({ schedule, departAt: asDate(schedule.departAt) }))
      .filter((item) => item.departAt)
      .sort((a, b) => a.departAt - b.departAt)[0]?.schedule || schedules[0] || null;
    return {
      ...totals,
      remaining: totals.available,
      unitsLabel: totals.total ? `${totals.available}/${totals.total} seats open` : 'Schedule pending',
      nextDepartAt: nextSchedule?.departAt || '',
      scheduleId: nextSchedule?.id || '',
      inventoryType: 'seats',
    };
  }

  if (listing.serviceType === 'hotel') {
    const rooms = roomsForListing(listing.id).filter((room) => room.status !== 'archived');
    const available = rooms.filter((room) => room.status === 'active').reduce((total, room) => total + cleanNumber(room.inventory), 0);
    const capacity = rooms.reduce((total, room) => total + (cleanNumber(room.inventory) * cleanNumber(room.capacity, 1)), 0);
    return {
      total: capacity || available,
      booked: 0,
      held: 0,
      blocked: rooms.filter((room) => room.status !== 'active').reduce((total, room) => total + cleanNumber(room.inventory), 0),
      available,
      remaining: available,
      unitsLabel: rooms.length ? `${available} rooms across ${rooms.length} room types` : 'Room inventory pending',
      nextDepartAt: '',
      roomTypes: rooms.length,
      inventoryType: 'rooms',
    };
  }

  const available = cleanNumber(listing.availability || listing.availableUnits || 0);
  return {
    total: available,
    booked: 0,
    held: 0,
    blocked: 0,
    available,
    remaining: available,
    unitsLabel: available ? `${available} slots open` : 'Provider integration pending',
    nextDepartAt: '',
    inventoryType: 'slots',
  };
}

function listingSearchText(listing = {}) {
  return [
    listing.title,
    listing.sub,
    listing.description,
    listing.partner,
    listing.companyName,
    listing.from,
    listing.to,
    listing.city,
    listing.country,
    listing.corridor,
    listing.type,
    listing.serviceType,
    listing.policy,
    listing.baggageRules,
    listing.cancellationRules,
  ].map(normalize).join(' ');
}

function listingCatalogItem(listing = {}) {
  const availability = listingAvailabilitySnapshot(listing);
  const company = findCompany(listing.companyId || listing.companySlug);
  const nextDate = asDate(availability.nextDepartAt);
  const serviceType = listing.serviceType || listing.group || 'bus';
  const price = cleanNumber(listing.priceFrom || listing.price);
  const corridor = listingCorridorCode(listing);
  const bookable = Boolean(listing.bookable && listing.status === 'active' && availability.remaining > 0);
  const policyText = normalize(`${listing.policy || ''} ${listing.cancellationRules || ''}`);
  return {
    ...frontendListing(listing),
    serviceType,
    group: ['bus', 'hotel', 'flight', 'train'].includes(serviceType) ? serviceType : 'more',
    catalogType: serviceType,
    typeLabel: SERVICE_LABELS[serviceType] || listing.type || serviceType,
    routeLabel: routeLabelForListing(listing),
    corridor,
    searchText: listingSearchText(listing),
    price,
    priceFrom: price,
    basePrice: price,
    remainingInventory: availability.remaining,
    availability: availability.remaining,
    availableUnits: availability.remaining,
    totalUnits: availability.total,
    bookedUnits: availability.booked,
    heldUnits: availability.held,
    blockedUnits: availability.blocked,
    unitsLabel: availability.unitsLabel,
    inventoryType: availability.inventoryType,
    nextDepartAt: availability.nextDepartAt,
    scheduleId: availability.scheduleId || '',
    nextDepartLabel: nextDate ? nextDate.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : listing.time || 'Flexible schedule',
    bookable,
    instantConfirmation: Boolean(company?.settings?.instantConfirmation !== false && bookable),
    refundable: /refund|free cancellation|cancellation/.test(policyText),
    bookingUrl: bookable ? `/listings/${serviceType}/${listing.slug}` : '',
    bookableReason: bookable ? 'Instant checkout' : availability.remaining <= 0 ? 'Sold out or pending inventory' : 'Provider preview',
  };
}

function buildListingCatalog({ includeTeasers = true } = {}) {
  return state.listings
    .filter((listing) => listing.status === 'active' && (includeTeasers || listing.bookable))
    .map(listingCatalogItem);
}

function moneyMetric(items = []) {
  const priced = items.filter((item) => cleanNumber(item.priceFrom || item.price) > 0);
  if (!priced.length) return null;
  const currencies = unique(priced.map((item) => String(item.currency || 'UGX').toUpperCase()));
  if (currencies.length !== 1) return null;
  const prices = priced.map((item) => cleanNumber(item.priceFrom || item.price));
  return {
    currency: currencies[0],
    average: Math.round(prices.reduce((total, price) => total + price, 0) / prices.length),
    lowest: Math.min(...prices),
    highest: Math.max(...prices),
  };
}

function catalogTypeStats(listings = buildListingCatalog()) {
  return TYPE_ORDER.map((type) => {
    const items = listings.filter((listing) => listing.serviceType === type);
    const nextDeparture = items
      .map((listing) => asDate(listing.nextDepartAt))
      .filter(Boolean)
      .sort((a, b) => a - b)[0] || null;
    return {
      type,
      label: SERVICE_LABELS[type] || type,
      count: items.length,
      partners: unique(items.map((listing) => listing.partner || listing.companyName)).length,
      remainingSeats: items.reduce((total, listing) => total + cleanNumber(listing.remainingInventory), 0),
      nextDeparture: nextDeparture ? nextDeparture.toISOString() : '',
      price: moneyMetric(items),
    };
  });
}

function catalogRouteHighlights(listings = buildListingCatalog()) {
  const groups = new Map();
  listings.forEach((listing) => {
    const key = listing.corridor || 'regional';
    const current = groups.get(key) || {
      key,
      corridor: key,
      type: listing.serviceType || 'bus',
      label: routeLabelForListing(listing),
      count: 0,
      remainingSeats: 0,
      minPrice: null,
      currency: listing.currency || 'UGX',
      nextDeparture: '',
    };
    const nextDate = asDate(listing.nextDepartAt);
    const currentDate = asDate(current.nextDeparture);
    current.count += 1;
    current.remainingSeats += cleanNumber(listing.remainingInventory);
    current.minPrice = current.minPrice === null ? cleanNumber(listing.priceFrom) : Math.min(current.minPrice, cleanNumber(listing.priceFrom));
    if (nextDate && (!currentDate || nextDate < currentDate)) current.nextDeparture = nextDate.toISOString();
    groups.set(key, current);
  });
  return Array.from(groups.values())
    .sort((a, b) => b.count - a.count || b.remainingSeats - a.remainingSeats)
    .slice(0, 12);
}

function catalogStats(listings = buildListingCatalog()) {
  const countries = unique(listings.map((listing) => listing.country)).filter(Boolean);
  const departuresNext24h = listings.filter((listing) => {
    const departAt = asDate(listing.nextDepartAt);
    if (!departAt) return false;
    const diff = departAt.getTime() - Date.now();
    return diff >= 0 && diff <= 24 * 60 * 60 * 1000;
  }).length;
  return {
    liveListings: listings.length,
    availableNow: listings.reduce((total, listing) => total + cleanNumber(listing.remainingInventory), 0),
    countries: countries.length,
    types: unique(listings.map((listing) => listing.serviceType)).length,
    partners: unique(listings.map((listing) => listing.partner || listing.companyName)).length,
    departuresNext24h,
  };
}

function catalogGuideCards(listings = buildListingCatalog()) {
  return listings
    .slice()
    .sort((a, b) => recommendedScore(b) - recommendedScore(a))
    .slice(0, 4)
    .map((listing) => ({
      id: `guide-${listing.id}`,
      listingId: listing.id,
      title: `${listing.routeLabel}: what to know before you book`,
      tag: listing.serviceType === 'hotel' ? 'Stay guide' : listing.serviceType === 'flight' ? 'Flight tips' : listing.serviceType === 'train' ? 'Rail guide' : 'Route guide',
      image: listing.img || listing.media?.[0]?.url,
      excerpt: listing.sub || listing.policy || `${listing.unitsLabel} from ${listing.partner || listing.companyName}.`,
      location: listing.routeLabel,
      partner: listing.partner || listing.companyName,
      price: { amount: listing.priceFrom || 0, currency: listing.currency || 'UGX' },
      url: listing.url,
    }));
}

function marketplaceInfo(listings = buildListingCatalog()) {
  const stats = catalogStats(listings);
  const typeStats = catalogTypeStats(listings);
  const routeHighlights = catalogRouteHighlights(listings);
  return {
    generatedAt: new Date().toISOString(),
    stats,
    hero: {
      badges: [
        { icon: 'fa-solid fa-shield-halved', label: 'Secure checkout' },
        { icon: 'fa-solid fa-clock', label: `${stats.departuresNext24h} departures in the next 24h` },
        { icon: 'fa-solid fa-users', label: `${stats.partners} partner operations live` },
        { icon: 'fa-solid fa-headset', label: 'Booking support ready' },
      ],
      stats: [
        { value: String(stats.liveListings), label: 'Live listings' },
        { value: String(stats.availableNow), label: 'Seats / rooms open' },
        { value: String(stats.countries), label: 'Countries covered' },
        { value: String(stats.types), label: 'Active categories' },
      ],
    },
    typeStats,
    routeHighlights,
    guides: catalogGuideCards(listings),
    featured: TYPE_ORDER.reduce((acc, type) => {
      acc[type] = listings.filter((listing) => listing.serviceType === type).slice(0, 12);
      return acc;
    }, {}),
  };
}

function homeBootstrap() {
  const listings = buildListingCatalog();
  const marketplace = marketplaceInfo(listings);
  return {
    generatedAt: new Date().toISOString(),
    listings,
    categories: state.categories,
    companies: state.companies.map(publicCompany),
    routes: state.routes.map(publicRoute),
    bookings: state.bookings.slice(0, 8).map(frontendBooking),
    promoterLinks: state.promoterLinks.slice(0, 12).map(publicPromoterLink),
    campaigns: state.promotionCampaigns.map(publicCampaign),
    serviceStats: serviceStats(),
    corridorStats: corridorStats(),
    marketplace,
    heroStats: {
      liveRoutes: marketplace.routeHighlights.length || state.routes.length,
      verifiedPartners: marketplace.stats.partners,
      bookableInventory: listings.filter((listing) => listing.bookable).length,
      totalServices: marketplace.stats.liveListings,
      availableNow: marketplace.stats.availableNow,
      departuresNext24h: marketplace.stats.departuresNext24h,
    },
  };
}

function frontendListing(listing) {
  return {
    ...listing,
    img: listing.img || listing.media?.[0]?.url,
    rating: String(listing.rating || listing.ratingAverage || '4.5'),
    price: listing.price || listing.priceFrom,
    partner: listing.partner || listing.companyName,
    group: listing.group,
    type: listing.type,
    url: `/listings/${listing.serviceType}/${listing.slug}`,
    bookingUrl: listing.bookable ? `/listings/${listing.serviceType}/${listing.slug}` : '',
    companyUrl: `/companies/${listing.companySlug}`,
  };
}

function publicCompany(company) {
  const listings = state.listings.filter((item) => item.companyId === company.id);
  const campaigns = state.promotionCampaigns.filter((campaign) => campaign.companyId === company.id);
  return {
    ...company,
    listingsCount: listings.length,
    activeListingsCount: listings.filter((item) => item.status === 'active').length,
    bookableListingsCount: listings.filter((item) => item.bookable).length,
    sponsoredListingsCount: listings.filter((item) => item.isSponsored).length,
    campaignCount: campaigns.length,
  };
}

function publicRoute(route) {
  const listing = findListing(route.listingId);
  const schedules = listing ? schedulesForListing(listing.id) : [];
  const nextSchedule = schedules.find((schedule) => schedule.status === 'active') || schedules[0];
  return {
    ...route,
    listing,
    scheduleCount: schedules.length,
    availableSeats: schedules.reduce((total, schedule) => total + (Number(schedule.availableSeats) || 0), 0),
    nextDepartAt: nextSchedule?.departAt || null,
    bookingUrl: listing?.bookable ? `/listings/${listing.serviceType}/${listing.slug}` : '',
    listingUrl: listing ? `/listings/${listing.serviceType}/${listing.slug}` : '',
  };
}

function frontendBooking(booking) {
  const listing = findListing(booking.listingId);
  const passenger = booking.passengers?.[0] || {};
  return {
    code: booking.bookingRef,
    title: listing?.title || booking.serviceType,
    type: listing?.type || booking.serviceType,
    selected: passenger.seatOrRoom || 'Selected inventory',
    total: `${booking.pricing.currency} ${Math.round(booking.pricing.total).toLocaleString()}`,
    customer: booking.guestSnapshot?.fullName || 'Guest customer',
    date: booking.createdAt ? new Date(booking.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Recent',
    channel: 'Backend ticket',
    status: booking.bookingStatus,
    ticketUrl: `/tickets/${booking.bookingRef}`,
    lookupUrl: `/tickets?bookingRef=${encodeURIComponent(booking.bookingRef)}`,
  };
}

function publicPromoterLink(link) {
  const listing = findListing(link.listingId);
  return {
    ...link,
    listing,
    shareUrl: link.url,
    conversionRate: link.clicks ? Math.round((link.conversions / link.clicks) * 1000) / 10 : 0,
  };
}

function publicCampaign(campaign) {
  return {
    ...campaign,
    listing: findListing(campaign.listingId),
    company: findCompany(campaign.companyId),
  };
}

function listingPreview(listing, availability = null, company = null) {
  const safeAvailability = availability || getAvailability(listing.id) || {};
  const partner = company || findCompany(listing.companyId || listing.companySlug);
  const currency = listing.currency || 'UGX';
  const subtotal = Number(listing.priceFrom || 0);
  const serviceFee = Math.round(subtotal * 0.045 + 3500);
  const schedules = safeAvailability.schedules || schedulesForListing(listing.id);
  const rooms = safeAvailability.rooms || roomsForListing(listing.id);
  const seats = safeAvailability.seats || [];
  const previewSeats = seats.slice(0, 32);
  const previewRooms = rooms.slice(0, 12);
  const firstSeat = (previewSeats.find((seat) => seat.status === 'available') || previewSeats[0] || {}).seatNumber || '';
  const firstRoom = (previewRooms.find((room) => room.inventory > 0) || previewRooms[0] || {}).id || '';
  const selectedPreview = listing.serviceType === 'hotel' ? (previewRooms[0]?.roomType || 'Room pending') : (firstSeat || 'Slot S1');
  const serviceIcon = {
    hotel: 'fa-hotel',
    bus: 'fa-bus',
    flight: 'fa-plane',
    train: 'fa-train',
    ferry: 'fa-ship',
    car_rental: 'fa-car',
    tour: 'fa-map-location-dot',
  }[listing.serviceType] || 'fa-ticket';
  const addons = addonCatalogFor(listing.serviceType);

  return {
    currency,
    subtotal,
    serviceFee,
    totalEstimate: subtotal + serviceFee,
    serviceIcon,
    previewSeats,
    previewRooms,
    firstSeat,
    firstRoom,
    selectedPreview,
    addons,
    partnerName: listing.partner || partner?.name || 'Classic Trip partner',
    supportPhone: partner?.supportPhone || partner?.phone || '+256 700 000 000',
    scheduleLabel: schedules[0]?.departureTime || listing.time || 'Flexible schedule',
    ticketAccess: 'Email, SMS, WhatsApp',
    policy: listing.bookable ? 'Instant checkout' : 'Provider teaser',
    paymentMethods: ['Mobile Money', 'Card', 'Wallet', 'Pay at office'],
  };
}

function moneyValue(amount, currency = 'UGX') {
  return `${currency} ${Math.round(Number(amount) || 0).toLocaleString()}`;
}

function dateValue(value) {
  if (!value) return 'Recent';
  return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function bookingTitle(booking) {
  const listing = findListing(booking.listingId);
  return listing ? listing.title : booking.serviceType;
}

function bookingCompany(booking) {
  const company = findCompany(booking.companyId);
  return company ? company.name : 'Classic Trip partner';
}

function bookingCustomer(booking) {
  return booking.guestSnapshot?.fullName || booking.passengers?.[0]?.fullName || 'Guest customer';
}

function bookingTotal(booking) {
  return moneyValue(booking.pricing?.total, booking.pricing?.currency || 'UGX');
}

function dashboardData(role = 'admin', context = {}) {
  const companyId = context.companyId || 'company-01';
  const promoterId = context.promoterId || 'user-promoter-001';
  const customerId = context.customerId || 'user-customer-001';
  const bookings = state.bookings.slice();
  const companyBookings = bookings.filter((booking) => booking.companyId === companyId);
  const customerBookings = bookings.filter((booking) => booking.customerUserId === customerId || booking.guestSnapshot?.email === 'customer@classictrip.test');
  const promoterLinks = state.promoterLinks.filter((link) => link.promoterId === promoterId && isActivePromoterLink(link));
  const promoterBookings = bookings.filter((booking) => booking.promoterAttribution?.promoterId === promoterId);
  const companyListings = state.listings.filter((listing) => listing.companyId === companyId);

  if (role === 'admin') return adminDashboardData(bookings);
  if (role === 'company') return enrichCompanyDashboard(companyDashboardData(companyId, companyListings, companyBookings), companyId, companyBookings);
  if (role === 'employee') return employeeDashboardData(companyId, companyBookings, context);
  if (role === 'customer') return customerDashboardData(customerBookings, customerId);
  if (role === 'promoter') return promoterDashboardData(promoterLinks, promoterBookings, promoterId);
  return {};
}

function adminDashboardData(bookings) {
  const activeUsers = state.users.filter((user) => user.status !== 'suspended');
  const suspendedUsers = state.users.filter((user) => user.status === 'suspended');
  const partnerCompanies = state.companies;
  const activePartners = partnerCompanies.filter((company) => ['verified', 'active', 'approved'].includes(normalize(company.verificationStatus || company.status)));
  const suspendedPartners = partnerCompanies.filter((company) => normalize(company.status) === 'suspended' || normalize(company.verificationStatus) === 'suspended');
  const activeListings = state.listings.filter((listing) => listing.status === 'active');
  const closedListings = state.listings.filter((listing) => ['cancelled', 'closed', 'archived', 'inactive'].includes(normalize(listing.status)));
  const confirmedBookings = bookings.filter((booking) => ['confirmed', 'checked_in', 'completed'].includes(booking.bookingStatus));
  const pendingPaymentBookings = bookings.filter((booking) => !['successful', 'paid', 'completed'].includes(normalize(booking.paymentStatus)));
  const cancelledRefundedBookings = bookings.filter((booking) => /cancel|refund/.test(normalize(booking.bookingStatus)) || /refund/.test(normalize(booking.paymentStatus)));
  const guestBookings = bookings.filter((booking) => !booking.customerUserId);
  const referredBookings = bookings.filter((booking) => booking.promoterAttribution?.promoterId || booking.promoterAttribution?.code);
  const grossRevenue = bookings.reduce((total, booking) => total + Number(booking.pricing?.total || 0), 0);
  const platformCommission = bookings.reduce((total, booking) => total + Number(booking.pricing?.split?.platformFee || 0), 0);
  const partnerEarnings = bookings.reduce((total, booking) => total + Number(booking.pricing?.split?.companyAmount || 0), 0);
  const promoterCommission = bookings.reduce((total, booking) => total + Number(booking.pricing?.split?.promoterAmount || 0), 0);
  const pendingSettlements = state.walletTransactions.filter((txn) => /pending|hold|review/.test(normalize(txn.status))).reduce((total, txn) => total + Number(txn.amount || 0), 0);
  const walletWithdrawals = state.walletTransactions.filter((txn) => /withdraw|payout/.test(normalize(txn.transactionType || txn.referenceType))).reduce((total, txn) => total + Number(txn.amount || 0), 0);
  const openSupport = state.supportTickets.filter((ticket) => !['closed', 'resolved'].includes(normalize(ticket.status)));

  const overviewStats = [
    { label: 'Total users', value: state.users.length.toLocaleString(), icon: 'fa-users', hint: `${activeUsers.length} active / ${suspendedUsers.length} suspended` },
    { label: 'Customers', value: state.users.filter((user) => user.role === 'customer').length.toLocaleString(), icon: 'fa-user', hint: 'Registered customer accounts' },
    { label: 'Promoters', value: state.users.filter((user) => user.role === 'promoter').length.toLocaleString(), icon: 'fa-bullhorn', hint: 'Referral sellers' },
    { label: 'Company admins / employees', value: `${state.users.filter((user) => ['partner', 'company_admin'].includes(user.role)).length}/${state.users.filter((user) => user.role === 'company_employee').length}`, icon: 'fa-user-tie', hint: 'Admins / employees' },
    { label: 'Partner companies', value: partnerCompanies.length.toLocaleString(), icon: 'fa-building', hint: `${activePartners.length} active / ${suspendedPartners.length} suspended` },
    { label: 'Listings / routes / trips', value: `${state.listings.length}/${state.routes.length}/${state.schedules.length}`, icon: 'fa-route', hint: `${activeListings.length} active, ${closedListings.length} closed` },
    { label: 'Total bookings', value: bookings.length.toLocaleString(), icon: 'fa-ticket', hint: `${confirmedBookings.length} confirmed, ${pendingPaymentBookings.length} pending payment` },
    { label: 'Cancelled / refunded', value: cancelledRefundedBookings.length.toLocaleString(), icon: 'fa-rotate-left', hint: 'Bookings requiring refund/cancellation review' },
    { label: 'Guest / referred bookings', value: `${guestBookings.length}/${referredBookings.length}`, icon: 'fa-link', hint: 'Guest checkout / promoter referral' },
    { label: 'Gross revenue', value: moneyValue(grossRevenue), icon: 'fa-money-bill-wave', hint: 'All booking value' },
    { label: 'Platform commission', value: moneyValue(platformCommission), icon: 'fa-percent', hint: 'Platform fee total' },
    { label: 'Partner earnings', value: moneyValue(partnerEarnings), icon: 'fa-building-columns', hint: 'Owner/company share' },
    { label: 'Promoter commission', value: moneyValue(promoterCommission), icon: 'fa-hand-holding-dollar', hint: 'Referral commission' },
    { label: 'Pending settlements', value: moneyValue(pendingSettlements), icon: 'fa-clock', hint: 'Wallet/payout items on hold' },
    { label: 'Wallet withdrawals', value: moneyValue(walletWithdrawals), icon: 'fa-wallet', hint: 'Payout/withdrawal requests' },
    { label: 'Support cases', value: openSupport.length.toLocaleString(), icon: 'fa-headset', hint: 'Open support/dispute queue' },
  ];

  const bookingRows = bookings.slice(0, 80).map((booking) => {
    const detail = bookingDetail(booking);
    const hold = booking.lockedUntil ? `${Math.max(0, Math.ceil((new Date(booking.lockedUntil).getTime() - Date.now()) / 60000))} min left` : 'None';
    return [
      booking.bookingRef,
      detail.service.name || bookingTitle(booking),
      `${detail.customer.name} / ${detail.customer.email || detail.customer.phone || detail.customer.type}`,
      dateValue(booking.createdAt),
      hold,
      booking.bookingStatus,
      bookingTotal(booking),
      dashboardMeta('booking', booking.bookingRef, booking.bookingRef, booking.bookingStatus, detail, ['view', 'copy', 'customer', 'company', 'payment', 'refund', 'export']),
    ];
  });

  const companyRows = state.companies.map((company) => {
    const detail = companyDetail(company);
    return [
      company.name,
      company.companyType || company.type || 'partner',
      company.country || '-',
      String(detail.performance.totalListings),
      company.verificationStatus || company.status || 'pending',
      detail.performance.revenue,
      dashboardMeta('partner', company.id, company.name, company.verificationStatus || company.status, detail, ['view', 'portal', 'suspend', 'invite', 'bookings', 'listings', 'payouts']),
    ];
  });

  const listingRows = state.listings.map((listing) => {
    const detail = listingDetail(listing);
    return [
      listing.title,
      SERVICE_LABELS[listing.serviceType] || listing.serviceType || listing.type,
      detail.owner.companyName,
      listing.serviceType === 'hotel' ? `${detail.inventory.roomInventory} rooms` : `${detail.inventory.remainingSeats}/${detail.inventory.totalSeats} seats`,
      listing.serviceType === 'hotel' ? [listing.city, listing.country].filter(Boolean).join(', ') : `${listing.from || '-'} to ${listing.to || '-'}`,
      listing.isSponsored ? 'Sponsored' : listing.bookable ? 'Available' : (listing.releaseStatus || 'Teaser'),
      moneyValue(listing.priceFrom, listing.currency),
      dashboardMeta('listing', listing.id, listing.title, listing.status, detail, ['view', 'bookings', 'occupancy', 'open']),
    ];
  });

  const paymentRows = bookings.slice(0, 80).map((booking, index) => {
    const payment = state.payments.find((item) => item.bookingRef === booking.bookingRef || item.bookingId === booking.id) || {};
    const detail = paymentDetail(booking, payment);
    return [
      payment.id || `TX-${78000 + index}`,
      booking.bookingRef,
      moneyValue(detail.payment.amount, detail.payment.currency),
      moneyValue(booking.pricing?.split?.companyAmount || 0, booking.pricing?.currency),
      moneyValue(booking.pricing?.split?.platformFee || 0, booking.pricing?.currency),
      moneyValue(booking.pricing?.split?.promoterAmount || 0, booking.pricing?.currency),
      detail.payment.status || booking.paymentStatus,
      dashboardMeta('payment', payment.id || booking.bookingRef, payment.id || booking.bookingRef, detail.payment.status || booking.paymentStatus, detail, ['view', 'booking', 'settlement', 'export']),
    ];
  });

  const promoterRows = state.users.filter((user) => user.role === 'promoter').map((user) => {
    const detail = promoterDetail(user);
    const links = state.promoterLinks.filter((link) => link.promoterId === user.id);
    return [
      user.fullName,
      String(links.reduce((total, link) => total + Number(link.clicks || 0), 0)),
      String(links.reduce((total, link) => total + Number(link.conversions || 0), 0)),
      detail.performance.commissionEarned,
      detail.wallet.availableBalance,
      user.status || 'active',
      dashboardMeta('promoter', user.id, user.fullName, user.status || 'active', detail, ['view', 'bookings', 'wallet', 'suspend']),
    ];
  });

  const customerRows = state.users.filter((user) => user.role === 'customer').map((user) => {
    const detail = customerDetail(user);
    return [
      user.fullName,
      user.email || user.phone || '-',
      String(detail.bookingSummary.totalBookings),
      detail.bookingSummary.totalSpend,
      detail.bookingSummary.lastTravelDate ? dateValue(detail.bookingSummary.lastTravelDate) : 'No bookings',
      user.status || 'active',
      dashboardMeta('customer', user.id, user.fullName, user.status || 'active', detail, ['view', 'bookings', 'payments', 'note']),
    ];
  });

  const supportRows = state.supportTickets.map((ticket) => [
    ticket.id,
    ticket.audience || ticket.ownerType || ticket.ownerId || 'Customer',
    ticket.subject,
    ticket.priority || 'normal',
    ticket.status || 'open',
    ticket.updatedAt ? dateValue(ticket.updatedAt) : dateValue(ticket.createdAt),
    dashboardMeta('support', ticket.id, ticket.id, ticket.status, employeeSupportDetail(ticket), ['view', 'assign', 'progress', 'resolve', 'reopen']),
  ]);

  const campaignRows = state.promotionCampaigns.map((campaign) => [
    campaign.name || campaign.title,
    findCompany(campaign.companyId)?.name || campaign.companyId || 'Partner',
    campaign.placement || campaign.type || 'Campaign',
    moneyValue(campaign.budget || 0),
    String(campaign.clicks || 0),
    String(campaign.bookings || campaign.conversions || 0),
    campaign.status || 'draft',
    dashboardMeta('promotion', campaign.id, campaign.name || campaign.title, campaign.status, campaignDetail(campaign), ['view', 'approve', 'reject', 'pause']),
  ]);

  const routeInventoryRows = state.routes.slice(0, 80).map((route) => {
    const listing = findListing(route.listingId) || {};
    const schedules = schedulesForListing(route.listingId);
    const detail = listingDetail(listing);
    return [
      `${route.origin || detail.service.from || '-'} to ${route.destination || detail.service.to || '-'}`,
      detail.service.vehicleDetails || listing.type || 'Inventory',
      detail.owner.companyName || 'Partner',
      `${detail.inventory.remainingSeats}/${detail.inventory.totalSeats}`,
      `${schedules.length} schedules`,
      route.status || listing.status || 'active',
      moneyValue(listing.priceFrom || 0, listing.currency),
      dashboardMeta('route', route.id, `${route.origin} to ${route.destination}`, route.status, { route, listing: detail }, ['view', 'bookings', 'occupancy', 'open']),
    ];
  });

  const stayInventoryRows = state.rooms.slice(0, 80).map((room) => {
    const listing = findListing(room.listingId) || {};
    return [
      listing.title || 'Hotel',
      room.roomType,
      findCompany(room.companyId)?.name || listing.partner || 'Partner',
      `${room.inventory} rooms`,
      listing.city || listing.country || '-',
      room.status,
      moneyValue(room.nightlyPrice || listing.priceFrom || 0, listing.currency),
      dashboardMeta('room', room.id, room.roomType, room.status, { room, listing: listingDetail(listing) }, ['view', 'bookings', 'occupancy']),
    ];
  });

  const auditRows = state.auditLogs.map((log) => [dateValue(log.createdAt), log.actorId, log.action, log.target || log.entityId || '-', 'Backend store', log.status || 'Success', dashboardMeta('audit', log.id, log.action, log.status || 'Success', auditDetail(log), ['view', 'export'])]);
  const adminRows = state.users.filter((user) => ['super_admin', 'admin', 'finance_admin', 'support_admin', 'content_admin'].includes(user.role)).map((user) => [user.fullName, user.role, user.permissionsLabel || 'Role based', user.twoFactorEnabled ? 'Enabled' : 'Required', user.lastLoginAt ? dateValue(user.lastLoginAt) : 'No login', user.status || 'active', dashboardMeta('admin', user.id, user.fullName, user.status || 'active', adminUserDetail(user), ['view', 'invite', 'suspend'])]);
  const kycRows = state.companies.map((company) => [company.name, Array.isArray(company.documents) && company.documents.length ? `${company.documents.length} documents` : 'Business profile', company.country || '-', company.payoutAccount || company.walletId || 'Payout pending', company.verificationStatus === 'verified' ? 'Low' : 'Medium', company.verificationStatus || 'pending', dashboardMeta('kyc', company.id, company.name, company.verificationStatus, companyDetail(company), ['view', 'approve', 'reject', 'changes'])]);
  const refundRows = state.refundRequests.map((refund) => [refund.id, refund.bookingRef, bookingCustomer(findBooking(refund.bookingRef) || {}) || refund.requesterId || 'Customer', refund.reason, moneyValue(refund.amount), refund.status, dashboardMeta('refund', refund.id, refund.id, refund.status, employeeRefundDetail(refund), ['view', 'approve', 'reject', 'booking', 'payment'])]);
  const notificationRows = (state.notifications || []).map((note) => [note.title || note.subject, Array.isArray(note.channels) ? note.channels.join(', ') : note.channel || 'Email', note.audience || note.ownerType || 'Users', String(note.sentCount || note.deliveredCount || 0), note.deliveryStatus || note.status || 'Pending', note.status || 'queued', dashboardMeta('notification', note.id, note.title || note.subject, note.status, notificationDetail(note), ['view', 'send'])]);
  const fallbackNotifications = supportRows.map((row) => [`Support update: ${row[2]}`, 'Email/SMS', row[1], '1', 'Pending', row[4], dashboardMeta('notification', row[0], row[2], row[4], { support: row[row.length - 1].detail }, ['view', 'send'])]);

  return {
    overviewStats,
    liveActivity: [
      ['Bookings today', bookings.length.toLocaleString()],
      ['Seats / rooms on hold', state.seats.filter((seat) => seat.status === 'locked').length.toLocaleString()],
      ['Pending partner approvals', partnerCompanies.filter((company) => /pending|review/.test(normalize(company.verificationStatus))).length.toLocaleString()],
      ['Open disputes', openSupport.length.toLocaleString()],
    ],
    recentActivity: [
      ...bookings.slice(0, 4).map((booking) => ({ type: 'booking', label: booking.bookingRef, message: `${bookingCustomer(booking)} booked ${bookingTitle(booking)}`, at: booking.createdAt })),
      ...state.auditLogs.slice(0, 4).map((log) => ({ type: 'audit', label: log.action, message: `${log.actorId} ${log.action}`, at: log.createdAt })),
    ],
    systemHealth: {
      appStatus: 'Online',
      databaseStatus: 'Uses MongoDB when connected, otherwise in-memory demo store',
      environment: process.env.NODE_ENV || 'development',
      nodeEnv: process.env.NODE_ENV || 'development',
      uptimeSeconds: Math.floor(process.uptime ? process.uptime() : 0),
      recentFailedPayments: bookings.filter((booking) => /fail|cancel|refund/.test(normalize(booking.paymentStatus))).length,
      recentFailedOperations: state.auditLogs.filter((log) => /fail|error/.test(normalize(log.status))).length,
      queueJobs: state.notifications?.length || state.supportTickets.length,
    },
    platformSettings: {
      platformName: 'Classic Trip',
      defaultCurrency: 'UGX',
      platformFeePercent: '7',
      promoterDefaultPercent: '3',
      supportEmail: 'support@classictrip.example',
      maintenanceMode: false,
      termsUrl: '/terms',
      privacyUrl: '/privacy',
    },
    recentBookings: bookingRows.slice(0, 8).map((row) => [row[0], row[row.length - 1].detail.booking.serviceType || row[1], row[row.length - 1].detail.customer.name, row[row.length - 1].detail.company.name, row[row.length - 1].detail.booking.paymentStatus, row[6], row[row.length - 1]]),
    bookings: bookingRows,
    partners: companyRows,
    listings: listingRows,
    payments: paymentRows,
    promoters: promoterRows,
    customers: customerRows,
    support: supportRows,
    ads: campaignRows,
    routeInventory: routeInventoryRows,
    stayInventory: stayInventoryRows,
    reviewInventory: state.listings.filter((listing) => listing.releaseStatus !== 'live' || listing.status !== 'active').slice(0, 20).map((listing) => [listing.title, findCompany(listing.companyId)?.name || listing.partner || 'Partner', listing.releaseStatus || 'Needs content review', listing.status === 'active' ? 'Medium' : 'High', listing.updatedAt ? dateValue(listing.updatedAt) : 'Recent', listing.status || 'Needs review', dashboardMeta('listing_review', listing.id, listing.title, listing.status, listingDetail(listing), ['view', 'approve', 'reject'])]),
    audit: auditRows,
    financeAudit: paymentRows.slice(0, 20).map((row) => [dateValue(row[row.length - 1].detail.timestamps.createdAt), 'Finance/system', 'Revenue split', row[2], row[6] === 'successful' ? 'Low' : 'Review', row[6], row[row.length - 1]]),
    securityAudit: auditRows.slice(0, 20),
    admins: adminRows.length ? adminRows : [['Awan Mabur', 'super_admin', 'Full access', 'Enabled', 'Current', 'active', dashboardMeta('admin', 'super-admin', 'Awan Mabur', 'active', { admin: { name: 'Awan Mabur', role: 'super_admin', permissionsLabel: 'Full access' } }, ['view'])]],
    kyc: kycRows,
    refunds: refundRows,
    notifications: notificationRows.length ? notificationRows : fallbackNotifications,
  };
}

function companyDashboardData(companyId, listings, bookings) {
  const company = findCompany(companyId) || {};
  const companyRoutes = state.routes.filter((route) => route.companyId === companyId);
  const vehicles = (state.vehicles || []).filter((vehicle) => vehicle.companyId === companyId);
  const schedules = state.schedules.filter((schedule) => schedule.companyId === companyId);
  const rooms = state.rooms.filter((room) => room.companyId === companyId);
  const reviews = state.reviews.filter((review) => review.companyId === companyId);
  const companyEmployees = Array.isArray(state.companyEmployees) ? state.companyEmployees.filter((employee) => employee.companyId === companyId) : [];
  const supportTickets = state.supportTickets.filter((ticket) => ticket.companyId === companyId || (ticket.ownerType === 'company' && (!ticket.ownerId || ticket.ownerId === companyId)));
  const grossRevenue = bookings.reduce((total, booking) => total + Number(booking.pricing?.total || 0), 0);
  const companyEarnings = bookings.reduce((total, booking) => total + Number(booking.pricing?.split?.companyAmount || 0), 0);
  const seats = schedules.flatMap((schedule) => seatsForSchedule(schedule.id));
  const bookedSeats = seats.filter((seat) => seat.status === 'taken').length;
  const heldSeats = seats.filter((seat) => seat.status === 'locked').length;
  const blockedSeats = seats.filter((seat) => seat.status === 'blocked').length;
  const fillRate = seats.length ? Math.round((bookedSeats / seats.length) * 100) : 0;
  const activeListings = listings.filter((listing) => listing.status === 'active');
  const activeSchedules = schedules.filter((schedule) => schedule.status === 'active');
  const checkedInBookings = bookings.filter((booking) => booking.bookingStatus === 'checked_in');
  const scheduleLabel = (schedule) => {
    const departAt = schedule.departAt ? new Date(schedule.departAt) : null;
    const time = departAt && !Number.isNaN(departAt.getTime()) ? departAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
    return `${dateValue(schedule.departAt)}${time ? ` ${time}` : ''}`;
  };
  const listingOption = (listing) => ({
    id: listing.id,
    value: listing.id,
    label: listing.title,
    serviceType: listing.serviceType,
    status: listing.status,
  });
  const routeOption = (route) => {
    const listing = findListing(route.listingId);
    return {
      id: route.id,
      value: route.id,
      label: `${route.origin} to ${route.destination}${listing ? ` - ${listing.title}` : ''}`,
      listingId: route.listingId,
      status: route.status,
    };
  };
  const scheduleOption = (schedule) => ({
    id: schedule.id,
    value: schedule.id,
    label: `${scheduleLabel(schedule)} - ${bookingTitle({ listingId: schedule.listingId })}`,
    routeId: schedule.routeId,
    listingId: schedule.listingId,
    status: schedule.status,
  });
  const roomOption = (room) => ({
    id: room.id,
    value: room.id,
    label: `${room.roomType} - ${bookingTitle({ listingId: room.listingId })}`,
    listingId: room.listingId,
    status: room.status,
  });
  const vehicleOption = (vehicle) => ({
    id: vehicle.id,
    value: vehicle.id,
    label: `${vehicle.name}${vehicle.plateOrCode ? ` - ${vehicle.plateOrCode}` : ''} (${vehicle.totalSeats || 0} seats)`,
    serviceType: vehicle.serviceType,
    listingId: vehicle.listingId,
    status: vehicle.status,
  });
  const seatInventoryRows = schedules.map((schedule) => {
    const scheduleSeats = seatsForSchedule(schedule.id);
    const totalSeats = scheduleSeats.length || Number(schedule.totalSeats || 0);
    const sold = scheduleSeats.filter((seat) => seat.status === 'taken').length;
    const held = scheduleSeats.filter((seat) => seat.status === 'locked').length;
    const blocked = scheduleSeats.filter((seat) => seat.status === 'blocked').length;
    return [
      `Seat map ${schedule.id}`,
      bookingTitle({ listingId: schedule.listingId }),
      String(totalSeats),
      String(sold),
      String(held),
      String(blocked),
      schedule.status,
      { entity: 'schedule', id: schedule.id, label: `Seat map ${schedule.id}`, status: schedule.status },
    ];
  });
  const roomInventoryRows = rooms.map((room) => {
    const roomBookings = bookings.filter((booking) => booking.listingId === room.listingId && booking.passengers?.some((passenger) => passenger.seatOrRoom === room.roomType)).length;
    return [
      room.roomType,
      bookingTitle({ listingId: room.listingId }),
      String(room.inventory + roomBookings),
      String(roomBookings),
      '0',
      room.status === 'active' ? '0' : String(room.inventory),
      room.status,
      { entity: 'room', id: room.id, label: room.roomType, status: room.status },
    ];
  });
  return {
    company: {
      id: company.id || companyId,
      name: company.name || 'Company partner',
      slug: company.slug || companyId,
      type: company.companyType || company.type || 'partner',
      city: company.city || '',
      country: company.country || '',
      verificationStatus: company.verificationStatus || 'pending',
      supportEmail: company.supportContacts?.email || '',
      supportPhone: company.supportContacts?.phone || '',
      supportWhatsapp: company.supportContacts?.whatsapp || '',
      payoutAccount: company.payoutAccount || company.settings?.payoutAccount || '',
      defaultCurrency: company.settings?.defaultCurrency || 'UGX',
      supportMessage: company.settings?.supportMessage || '',
      ratingAverage: Number(company.ratingAverage || 0),
      reviewCount: Number(company.reviewCount || reviews.length),
    },
    stats: {
      earnings: moneyValue(companyEarnings),
      grossRevenue: moneyValue(grossRevenue),
      confirmedBookings: bookings.length.toLocaleString(),
      activeListings: activeListings.length.toLocaleString(),
      seatsOnHold: heldSeats.toLocaleString(),
      upcomingTrips: activeSchedules.length.toLocaleString(),
      openSupportCases: supportTickets.filter((ticket) => !['closed', 'resolved'].includes(normalize(ticket.status))).length.toLocaleString(),
      fillRate: `${fillRate}%`,
      rating: `${Number(company.ratingAverage || 0).toFixed(1)}/5`,
      routeCount: companyRoutes.length.toLocaleString(),
      vehicleCount: vehicles.filter((vehicle) => vehicle.status !== 'archived').length.toLocaleString(),
      roomTypes: rooms.length.toLocaleString(),
      blockedSeats: blockedSeats.toLocaleString(),
      checkedIn: checkedInBookings.length.toLocaleString(),
    },
    options: {
      listings: listings.map(listingOption),
      busListings: listings.filter((listing) => listing.serviceType === 'bus').map(listingOption),
      hotelListings: listings.filter((listing) => listing.serviceType === 'hotel').map(listingOption),
      transportListings: listings.filter((listing) => ROUTED_SERVICE_TYPES.includes(listing.serviceType)).map(listingOption),
      routes: companyRoutes.filter((route) => route.status !== 'archived').map(routeOption),
      vehicles: vehicles.filter((vehicle) => vehicle.status !== 'archived').map(vehicleOption),
      schedules: schedules.filter((schedule) => schedule.status !== 'archived').map(scheduleOption),
      rooms: rooms.filter((room) => room.status !== 'archived').map(roomOption),
    },
    recentBookings: bookings.slice(0, 8).map((booking) => [booking.bookingRef, bookingTitle(booking), bookingCustomer(booking), booking.passengers?.[0]?.seatOrRoom || 'Selected', booking.bookingStatus, bookingTotal(booking)]),
    listings: listings.map((listing) => [
      listing.title,
      listing.type,
      listing.serviceType === 'hotel' ? [listing.city, listing.country].filter(Boolean).join(', ') : `${listing.from} to ${listing.to}`,
      listing.serviceType === 'hotel' ? `${roomsForListing(listing.id).length} room types` : `${schedulesForListing(listing.id).length} schedules`,
      moneyValue(listing.priceFrom),
      listing.status,
      { entity: 'listing', id: listing.id, label: listing.title, status: listing.status },
    ]),
    routes: companyRoutes.map((route) => [
      `${route.origin} to ${route.destination}`,
      bookingTitle({ listingId: route.listingId }),
      `${route.boardingPoints?.length || 0} boarding`,
      `${route.dropoffPoints?.length || 0} dropoffs`,
      route.corridor || '',
      route.status,
      { entity: 'route', id: route.id, label: `${route.origin} to ${route.destination}`, status: route.status },
    ]),
    schedules: schedules.slice(0, 24).map((schedule) => {
      const totalSeats = Number(schedule.totalSeats || 0);
      const sold = Math.max(0, totalSeats - Number(schedule.availableSeats || 0) - seatsForSchedule(schedule.id).filter((seat) => ['locked', 'blocked'].includes(seat.status)).length);
      const vehicle = vehicles.find((item) => item.id === schedule.vehicleId);
      return [
        schedule.id,
        bookingTitle({ listingId: schedule.listingId }),
        scheduleLabel(schedule),
        vehicle?.name || schedule.vehicleName || 'Vehicle pending',
        `${sold}/${totalSeats}`,
        schedule.status,
        { entity: 'schedule', id: schedule.id, label: schedule.id, status: schedule.status },
      ];
    }),
    vehicles: vehicles.map((vehicle) => [
      vehicle.name,
      SERVICE_LABELS[vehicle.serviceType] || vehicle.serviceType || 'Vehicle',
      vehicle.plateOrCode || '-',
      `${vehicle.totalSeats || 0} seats`,
      vehicle.layoutName || 'Layout pending',
      vehicle.status,
      { entity: 'vehicle', id: vehicle.id, label: vehicle.name, status: vehicle.status },
    ]),
    bookings: bookings.map((booking) => [booking.bookingRef, bookingTitle(booking), bookingCustomer(booking), booking.passengers?.[0]?.seatOrRoom || 'Selected', dateValue(booking.createdAt), booking.bookingStatus, bookingTotal(booking)]),
    checkins: bookings.slice(0, 24).map((booking) => [
      booking.bookingRef,
      bookingCustomer(booking),
      bookingTitle(booking),
      booking.passengers?.[0]?.seatOrRoom || 'Selected',
      booking.checkedInAt ? dateValue(booking.checkedInAt) : 'Pending',
      booking.bookingStatus === 'checked_in' ? 'Checked in' : booking.bookingStatus,
      { entity: 'checkin', id: booking.bookingRef, label: booking.bookingRef, status: booking.bookingStatus, detail: bookingDetail(booking) },
    ]),
    inventory: [...seatInventoryRows, ...roomInventoryRows],
    payouts: [
      ...state.walletTransactions.filter((txn) => txn.ownerType === 'company' && txn.ownerId === companyId).map((txn) => [
        txn.id,
        txn.transactionType || txn.referenceType || 'Wallet transaction',
        moneyValue(txn.amount, txn.currency),
        txn.direction === 'debit' ? moneyValue(txn.amount, txn.currency) : '-',
        '-',
        '-',
        txn.status,
        { entity: 'payout', id: txn.id, label: txn.id, status: txn.status },
      ]),
      ...bookings.slice(0, 10).map((booking, index) => [`TX-${9000 + index}`, booking.bookingRef, bookingTotal(booking), moneyValue(booking.pricing?.split?.companyAmount || 0), moneyValue(booking.pricing?.split?.platformFee || 0), moneyValue(booking.pricing?.split?.promoterAmount || 0), booking.paymentStatus]),
    ],
    promotions: state.promotionCampaigns.filter((campaign) => campaign.companyId === companyId).map((campaign) => [campaign.name, findListing(campaign.listingId)?.title || 'Listing', campaign.placement, moneyValue(campaign.budget), String(campaign.clicks), String(campaign.bookings), campaign.status, { entity: 'promotion', id: campaign.id, label: campaign.name, status: campaign.status }]),
    reviews: reviews.map((review) => {
      const booking = state.bookings.find((item) => item.id === review.bookingId);
      return [
        bookingCustomer(booking || {}) || review.customerUserId || 'Customer',
        bookingTitle({ listingId: review.listingId }),
        String(review.rating || '-'),
        review.comment || '',
        review.companyReply?.message ? `Replied: ${review.companyReply.message}` : dateValue(review.createdAt),
        review.status,
        { entity: 'review', id: review.id, label: booking?.bookingRef || review.id, status: review.status },
      ];
    }),
    staff: companyEmployees.map((employee) => {
      const user = state.users.find((item) => item.id === employee.userId) || {};
      return [user.fullName || user.email || employee.userId, employee.roleTitle || 'Staff', employee.branch || 'Main branch', (employee.permissions || []).join(', '), user.lastLoginAt ? dateValue(user.lastLoginAt) : 'Invited', employee.status || user.status || 'active', { entity: 'employee', id: employee.id, label: user.fullName || user.email || employee.userId, status: employee.status || user.status || 'active' }];
    }),
    support: supportTickets.map((ticket) => [
      ticket.id,
      ticket.audience || ticket.ownerType,
      ticket.subject,
      ticket.priority,
      ticket.status,
      ticket.updatedAt ? dateValue(ticket.updatedAt) : dateValue(ticket.createdAt),
      { entity: 'support', id: ticket.id, label: ticket.id, status: ticket.status },
    ]),
  };
}


function enrichCompanyDashboard(data, companyId, bookings) {
  const withMeta = (row, meta) => {
    if (!Array.isArray(row)) return row;
    const existing = rowMetaLike(row);
    if (existing) return [...row.slice(0, -1), { ...existing, detail: existing.detail || meta.detail, actions: existing.actions || meta.actions || [] }];
    return [...row, meta];
  };
  const bookingMeta = (booking) => dashboardMeta('booking', booking.bookingRef, booking.bookingRef, booking.bookingStatus, bookingDetail(booking), ['view', 'check_in', 'no_show', 'note', 'refund', 'export']);
  const listingByTitle = (title) => state.listings.find((listing) => listing.companyId === companyId && listing.title === title) || {};
  const scheduleById = (id) => state.schedules.find((schedule) => schedule.id === id) || {};
  const employeeDetail = (employee = {}) => {
    const user = state.users.find((item) => item.id === employee.userId) || {};
    return { staff: { staffId: employee.id, userId: user.id, name: user.fullName, email: user.email, phone: user.phone, role: user.role, jobTitle: employee.roleTitle, permissionsLabel: (employee.permissions || []).join(', '), status: employee.status || user.status, invitedBy: employee.invitedBy, invitedAt: employee.invitedAt, onboardedAt: employee.onboardedAt }, company: companyDetail(findCompany(companyId)), timestamps: { createdAt: employee.createdAt, updatedAt: employee.updatedAt } };
  };
  const rowBooking = (ref) => state.bookings.find((booking) => booking.bookingRef === ref) || {};
  const rowSupport = (id) => state.supportTickets.find((ticket) => ticket.id === id) || {};
  const rowReview = (id) => state.reviews.find((review) => review.id === id) || {};
  return {
    ...data,
    recentBookings: (data.recentBookings || []).map((row) => withMeta(row, bookingMeta(rowBooking(row[0])))),
    bookings: (data.bookings || []).map((row) => withMeta(row, bookingMeta(rowBooking(row[0])))),
    checkins: (data.checkins || []).map((row) => withMeta(row, bookingMeta(rowBooking(row[0])))),
    listings: (data.listings || []).map((row) => {
      const listing = listingByTitle(row[0]);
      return withMeta(row, dashboardMeta('listing', listing.id || row[0], row[0], row[5], listingDetail(listing), ['view', 'edit', 'close', 'bookings', 'occupancy']));
    }),
    routes: (data.routes || []).map((row) => {
      const route = state.routes.find((item) => `${item.origin} to ${item.destination}` === row[0] && item.companyId === companyId) || {};
      const listing = findListing(route.listingId) || {};
      return withMeta(row, dashboardMeta('route', route.id || row[0], row[0], row[5], { route, listing: listingDetail(listing) }, ['view', 'edit', 'close']));
    }),
    schedules: (data.schedules || []).map((row) => {
      const schedule = scheduleById(row[0]);
      const listing = findListing(schedule.listingId) || {};
      const seats = seatsForSchedule(schedule.id);
      return withMeta(row, dashboardMeta('schedule', schedule.id || row[0], row[0], row[5], { schedule, listing: listingDetail(listing), seats: { total: seats.length || schedule.totalSeats, booked: seats.filter((seat) => seat.status === 'taken').length, held: seats.filter((seat) => seat.status === 'locked').length, remaining: schedule.availableSeats } }, ['view', 'edit', 'cancel', 'manifest', 'seat_map']));
    }),
    vehicles: (data.vehicles || []).map((row) => {
      const vehicle = state.vehicles.find((item) => item.companyId === companyId && item.name === row[0]) || {};
      return withMeta(row, dashboardMeta('vehicle', vehicle.id || row[0], row[0], row[5], { vehicle, listing: listingDetail(findListing(vehicle.listingId) || {}) }, ['view', 'edit', 'archive']));
    }),
    inventory: (data.inventory || []).map((row) => withMeta(row, dashboardMeta('inventory', row[0], row[0], row[6], { inventory: { item: row[0], service: row[1], total: row[2], booked: row[3], held: row[4], blocked: row[5], status: row[6] } }, ['view', 'move_seat', 'release_holds']))),
    staff: (data.staff || []).map((row) => {
      const employee = state.companyEmployees.find((item) => item.companyId === companyId && (state.users.find((user) => user.id === item.userId)?.fullName === row[0] || item.id === row[0])) || {};
      return withMeta(row, dashboardMeta('employee', employee.id || row[0], row[0], row[5], employeeDetail(employee), ['view', 'invite', 'resend', 'suspend']));
    }),
    payouts: (data.payouts || []).map((row) => withMeta(row, dashboardMeta('payout', row[0], row[0], row[6], { payout: { transactionId: row[0], bookingRef: row[1], gross: row[2], ownerEarnings: row[3], platformFee: row[4], promoterCommission: row[5], status: row[6] }, company: companyDetail(findCompany(companyId)) }, ['view', 'request_payout']))),
    promotions: (data.promotions || []).map((row) => {
      const campaign = state.promotionCampaigns.find((item) => item.companyId === companyId && item.name === row[0]) || {};
      return withMeta(row, dashboardMeta('promotion', campaign.id || row[0], row[0], row[6], campaignDetail(campaign), ['view', 'edit', 'pause']));
    }),
    reviews: (data.reviews || []).map((row) => {
      const review = rowReview(row[row.length - 1]?.id) || state.reviews.find((item) => item.companyId === companyId && item.comment === row[3]) || {};
      return withMeta(row, dashboardMeta('review', review.id || row[0], row[0], row[5], { review, booking: bookingDetail(state.bookings.find((booking) => booking.id === review.bookingId) || {}) }, ['view', 'reply', 'flag']));
    }),
    support: (data.support || []).map((row) => withMeta(row, dashboardMeta('support', row[0], row[0], row[4], supportDetail(rowSupport(row[0])), ['view', 'respond', 'resolve']))),
  };
}

function rowMetaLike(row) {
  const last = Array.isArray(row) ? row[row.length - 1] : null;
  return last && typeof last === 'object' && !Array.isArray(last) ? last : null;
}

function employeeDashboardData(companyId, bookings, context = {}) {
  const withMeta = (row, meta) => [...row, meta];
  const employeeId = context.employeeId || 'user-employee-001';
  const company = findCompany(companyId) || {};
  const employeeUser = state.users.find((user) => user.id === employeeId) || state.users.find((user) => user.companyId === companyId && user.role === 'company_employee') || {};
  const employeeProfile = (Array.isArray(state.companyEmployees) ? state.companyEmployees : []).find((employee) => employee.companyId === companyId && employee.userId === employeeUser.id) || {};
  const listings = state.listings.filter((listing) => listing.companyId === companyId);
  const schedules = state.schedules.filter((schedule) => schedule.companyId === companyId).slice(0, 50);
  const rooms = state.rooms.filter((room) => room.companyId === companyId);
  const supportTickets = state.supportTickets.filter((ticket) => ticket.companyId === companyId || (ticket.ownerType === 'company' && (!ticket.ownerId || ticket.ownerId === companyId)));
  const companyDashboard = companyDashboardData(companyId, listings, bookings);
  const todayKey = new Date().toISOString().slice(0, 10);
  const isToday = (value) => value && new Date(value).toISOString().slice(0, 10) === todayKey;

  const bookingRow = (booking) => withMeta([
    booking.bookingRef,
    bookingTitle(booking),
    bookingCustomer(booking),
    booking.passengers?.[0]?.seatOrRoom || booking.passengers?.[0]?.seatNumber || 'Selected',
    booking.serviceDate ? dateValue(booking.serviceDate) : dateValue(booking.createdAt),
    booking.bookingStatus,
    bookingTotal(booking),
  ], dashboardMeta('booking', booking.bookingRef, booking.bookingRef, booking.bookingStatus, bookingDetail(booking), ['view', 'check_in', 'no_show', 'record_payment', 'refund_request', 'customer_note', 'export']));

  const rows = bookings.slice(0, 50).map(bookingRow);
  const checkinRows = bookings.slice(0, 50).map((booking) => withMeta([
    booking.bookingRef,
    bookingCustomer(booking),
    bookingTitle(booking),
    booking.passengers?.[0]?.seatOrRoom || booking.passengers?.[0]?.seatNumber || 'Selected',
    booking.checkedInAt ? dateValue(booking.checkedInAt) : booking.noShowAt ? dateValue(booking.noShowAt) : 'Pending',
    booking.bookingStatus === 'checked_in' ? 'Checked in' : booking.bookingStatus === 'no_show' ? 'No-show' : 'Not checked',
  ], dashboardMeta('checkin', booking.bookingRef, booking.bookingRef, booking.bookingStatus, bookingDetail(booking), ['view', 'check_in', 'no_show', 'note', 'export'])));

  const paymentRows = [
    ...state.payments.filter((payment) => {
      const booking = findBooking(payment.bookingRef || payment.bookingId);
      return booking?.companyId === companyId;
    }).map((payment) => {
      const booking = findBooking(payment.bookingRef || payment.bookingId) || {};
      return withMeta([
        payment.id,
        payment.bookingRef,
        bookingCustomer(booking),
        payment.provider || 'Desk',
        moneyValue(payment.amount, payment.currency),
        payment.status,
      ], dashboardMeta('payment', payment.id, payment.id, payment.status, paymentRecordDetail(payment), ['view', 'record_payment', 'export']));
    }),
    ...bookings.slice(0, 8).map((booking, index) => withMeta([
      `PAY-${8000 + index}`,
      booking.bookingRef,
      bookingCustomer(booking),
      booking.paymentProvider || 'Classic Trip Payments',
      bookingTotal(booking),
      booking.paymentStatus,
    ], dashboardMeta('payment', booking.bookingRef, booking.bookingRef, booking.paymentStatus, bookingDetail(booking), ['view', 'record_payment', 'export']))),
  ];

  const handovers = (Array.isArray(state.shiftHandovers) ? state.shiftHandovers : [])
    .filter((handover) => handover.companyId === companyId)
    .slice(0, 20);

  const checkedInCount = bookings.filter((booking) => booking.bookingStatus === 'checked_in' || booking.checkInStatus === 'checked_in').length;
  const manualBookings = bookings.filter((booking) => booking.source === 'employee_manual').length;
  const deskSales = bookings.reduce((total, booking) => total + Number(booking.pricing?.total || 0), 0);
  const paymentsRecorded = state.payments.filter((payment) => {
    const booking = findBooking(payment.bookingRef || payment.bookingId);
    return booking?.companyId === companyId && payment.rawPayload?.source === 'employee_dashboard';
  }).length;
  const refundRequestsHandled = state.refundRequests.filter((refund) => refund.companyId === companyId && refund.createdBy === employeeId).length;
  const notesAdded = supportTickets.filter((ticket) => ticket.createdBy === employeeId || ticket.assignedTo === employeeId).length;

  const supportRows = supportTickets.map((ticket) => withMeta([
    ticket.id,
    ticket.audience || ticket.ownerType || 'Customer',
    ticket.subject,
    ticket.priority,
    ticket.status,
    ticket.updatedAt ? dateValue(ticket.updatedAt) : dateValue(ticket.createdAt),
  ], dashboardMeta('support', ticket.id, ticket.id, ticket.status, employeeSupportDetail(ticket), ['view', 'resolve', 'update_status', 'export'])));

  const enrichedInventory = [];
  schedules.forEach((schedule) => {
    const seats = seatsForSchedule(schedule.id).slice(0, 12);
    seats.forEach((seat) => {
      const booking = bookings.find((item) => item.scheduleId === schedule.id && (item.passengers || []).some((pax) => [pax.seatOrRoom, pax.seatNumber].includes(seat.seatNumber || seat.label || seat.id)));
      enrichedInventory.push(withMeta([
        schedule.id,
        seat.seatNumber || seat.label || seat.id,
        bookingTitle({ listingId: schedule.listingId }),
        moneyValue(schedule.basePrice || findListing(schedule.listingId)?.priceFrom || 0, schedule.currency || findListing(schedule.listingId)?.currency || 'UGX'),
        booking ? bookingCustomer(booking) : 'Available',
        seat.lockedUntil ? dateValue(seat.lockedUntil) : '-',
        booking ? 'booked' : (seat.status || 'available'),
      ], dashboardMeta('inventory', `${schedule.id}:${seat.seatNumber || seat.id}`, seat.seatNumber || seat.id, booking ? 'booked' : seat.status, inventoryDetail({ ...seat, scheduleId: schedule.id, listingId: schedule.listingId, bookingRef: booking?.bookingRef, companyId }, companyId), ['view', 'move_seat', 'release_hold', 'export'])));
    });
  });
  rooms.slice(0, 20).forEach((room) => {
    enrichedInventory.push(withMeta([
      room.listingId || 'Room listing',
      room.roomType || room.id,
      bookingTitle({ listingId: room.listingId }),
      moneyValue(room.nightlyPrice || room.price || 0, room.currency || 'UGX'),
      `${room.inventory || room.available || 0} available`,
      '-',
      room.status || 'available',
    ], dashboardMeta('inventory', room.id, room.roomType || room.id, room.status, inventoryDetail({ ...room, companyId }, companyId), ['view', 'release_hold', 'export'])));
  });

  const customerRows = bookings.slice(0, 30).map((booking) => {
    const customerDetail = customerOpsDetail(booking);
    return withMeta([
      bookingCustomer(booking),
      booking.guestSnapshot?.phone || booking.guestSnapshot?.email || 'Contact',
      String(customerDetail.metrics?.bookingsCount || 1),
      bookingTitle(booking),
      customerDetail.metrics?.totalSpend || bookingTotal(booking),
      booking.bookingStatus,
    ], dashboardMeta('customer', booking.customerUserId || booking.bookingRef, bookingCustomer(booking), booking.bookingStatus, customerDetail, ['view', 'customer_note', 'bookings', 'export']));
  });

  const refundRows = state.refundRequests
    .filter((refund) => !refund.companyId || refund.companyId === companyId || bookings.some((booking) => booking.bookingRef === refund.bookingRef))
    .map((refund) => withMeta([
      refund.id,
      refund.bookingRef,
      bookingCustomer(findBooking(refund.bookingRef) || {}),
      refund.reason,
      moneyValue(refund.amount, refund.currency || findBooking(refund.bookingRef)?.pricing?.currency || 'UGX'),
      refund.status,
    ], dashboardMeta('refund', refund.id, refund.id, refund.status, employeeRefundDetail(refund), ['view', 'refund_request', 'export'])));

  const scheduleRows = schedules.map((schedule) => withMeta([
    schedule.id,
    bookingTitle({ listingId: schedule.listingId }),
    dateValue(schedule.departAt),
    schedule.vehicleName || state.vehicles.find((vehicle) => vehicle.id === schedule.vehicleId)?.name || 'Assigned inventory',
    `${Math.max(0, Number(schedule.totalSeats || 0) - Number(schedule.availableSeats || 0))}/${schedule.totalSeats || '0'}`,
    schedule.status,
  ], dashboardMeta('schedule', schedule.id, schedule.id, schedule.status, scheduleDetail(schedule), ['view', 'manifest', 'seat_map', 'delay_notice', 'export'])));

  const handoverRows = handovers.length ? handovers.map((handover) => withMeta([
    handover.shift,
    handover.nextStaff || handover.employeeId,
    handover.note,
    handover.status,
  ], dashboardMeta('handover', handover.id, handover.shift, handover.status, handoverDetail(handover, companyId), ['view', 'export']))) : [withMeta([
    'Current shift', employeeUser.fullName || 'Team', 'No handover submitted yet. Use the form to record cash, bookings, check-ins, and issues.', 'Open',
  ], dashboardMeta('handover', 'handover-current', 'Current shift', 'open', handoverDetail({ id: 'handover-current', companyId, employeeId, shift: 'Current shift', nextStaff: employeeUser.fullName, note: 'No handover submitted yet', status: 'open' }, companyId), ['view']))];

  return {
    company: {
      id: company.id || companyId,
      name: company.name || 'Company partner',
      slug: company.slug || companyId,
    },
    profile: {
      id: employeeUser.id || employeeId,
      fullName: employeeUser.fullName || 'Company employee',
      email: employeeUser.email || '',
      phone: employeeUser.phone || '',
      status: employeeUser.status || 'active',
      role: employeeUser.role || 'company_employee',
      roleTitle: employeeProfile.roleTitle || 'Ticket Checker',
      permissionsLabel: (employeeProfile.permissions || ['check_in', 'view_bookings']).join(', '),
      branch: employeeProfile.branch || company.city || 'Main branch',
      shift: employeeProfile.shift || 'Morning shift',
      notes: employeeProfile.notes || 'Can create bookings, check in passengers, view payments, and create support tasks.',
      permissions: employeeProfile.permissions || ['check_in', 'view_bookings'],
      company: company.name || companyId,
      createdAt: employeeUser.createdAt || employeeProfile.createdAt,
      updatedAt: employeeUser.updatedAt || employeeProfile.updatedAt,
    },
    stats: {
      checkedIn: checkedInCount.toLocaleString(),
      manualBookings: manualBookings.toLocaleString(),
      openTasks: supportTickets.filter((ticket) => !['closed', 'resolved', 'completed'].includes(normalize(ticket.status))).length.toLocaleString(),
      deskSales: moneyValue(deskSales),
      shiftEnds: employeeProfile.shiftEnds || '6:00 PM',
      paymentsRecorded: paymentsRecorded.toLocaleString(),
      notesAdded: notesAdded.toLocaleString(),
      refundRequestsHandled: refundRequestsHandled.toLocaleString(),
    },
    options: {
      listings: listings.filter((listing) => listing.bookable && listing.status === 'active').map((listing) => ({ id: listing.id, value: listing.id, slug: listing.slug, label: listing.title, serviceType: listing.serviceType })),
      schedules: schedules.filter((schedule) => schedule.status !== 'archived').map((schedule) => ({ id: schedule.id, value: schedule.id, label: `${schedule.id} - ${bookingTitle({ listingId: schedule.listingId })}`, listingId: schedule.listingId, status: schedule.status })),
      rooms: rooms.filter((room) => room.status !== 'archived').map((room) => ({ id: room.id, value: room.id, label: `${room.roomType} - ${bookingTitle({ listingId: room.listingId })}`, listingId: room.listingId, status: room.status })),
    },
    tasks: supportRows,
    checkins: checkinRows,
    bookings: rows,
    schedules: scheduleRows,
    inventory: enrichedInventory.length ? enrichedInventory : companyDashboard.inventory,
    customers: customerRows,
    payments: paymentRows,
    refunds: refundRows,
    support: supportRows,
    handovers: handoverRows,
    reports: [
      ['Check-ins done', checkedInCount.toLocaleString(), 'Today / active company scope', 'Ready'],
      ['Payments recorded', paymentsRecorded.toLocaleString(), 'Cashier / desk entries', 'Ready'],
      ['Notes added', notesAdded.toLocaleString(), 'Customer notes and support replies', 'Ready'],
      ['Bookings handled', manualBookings.toLocaleString(), 'Manual desk bookings', 'Ready'],
      ['Refund requests handled', refundRequestsHandled.toLocaleString(), 'Employee-created requests', 'Review'],
    ],
  };
}

function scheduleDetail(schedule = {}) {
  if (!schedule) return null;
  const listing = findListing(schedule.listingId) || {};
  const company = findCompany(schedule.companyId) || {};
  const route = state.routes.find((item) => item.id === schedule.routeId || item.listingId === schedule.listingId) || {};
  const vehicle = state.vehicles.find((item) => item.id === schedule.vehicleId) || {};
  const scheduleBookings = state.bookings.filter((booking) => booking.scheduleId === schedule.id || booking.listingId === schedule.listingId);
  const seatRows = seatsForSchedule(schedule.id);
  const bookedSeats = seatRows.filter((seat) => ['taken', 'booked'].includes(normalize(seat.status))).length || Number(schedule.bookedSeats || 0);
  const heldSeats = seatRows.filter((seat) => ['locked', 'held', 'hold'].includes(normalize(seat.status))).length || Number(schedule.heldSeats || 0);
  const totalSeats = seatRows.length || Number(schedule.totalSeats || vehicle.totalSeats || listing.availability || 0);
  return {
    schedule: {
      id: schedule.id, routeId: schedule.routeId, listingId: schedule.listingId, companyId: schedule.companyId, status: schedule.status,
      departure: schedule.departAt, arrival: schedule.arriveAt, basePrice: schedule.basePrice || listing.priceFrom, currency: schedule.currency || listing.currency || 'UGX',
      totalSeats, bookedSeats, heldSeats, remainingSeats: Math.max(0, totalSeats - bookedSeats - heldSeats), occupancy: totalSeats ? `${Math.round((bookedSeats / totalSeats) * 100)}%` : '0%',
      driverName: schedule.driverName || '', gate: schedule.gate || '', platform: schedule.platform || '', notes: schedule.notes || '',
    },
    route: { origin: route.origin || listing.from, destination: route.destination || listing.to, corridor: route.corridor || listing.corridor, status: route.status },
    vehicle: { id: vehicle.id, name: vehicle.name || schedule.vehicleName, plateOrCode: vehicle.plateOrCode, layoutName: vehicle.layoutName, totalSeats: vehicle.totalSeats, status: vehicle.status },
    service: { listingId: listing.id, title: listing.title, serviceType: listing.serviceType, address: listing.address || listing.location, status: listing.status },
    company: companyDetail(company),
    operations: { manifestCount: scheduleBookings.length, checkedIn: scheduleBookings.filter((booking) => booking.bookingStatus === 'checked_in').length, noShows: scheduleBookings.filter((booking) => booking.bookingStatus === 'no_show').length },
    timestamps: { createdAt: schedule.createdAt, updatedAt: schedule.updatedAt },
  };
}

function inventoryDetail(record = {}, companyId = '') {
  if (!record) return null;
  const schedule = state.schedules.find((item) => item.id === record.scheduleId) || {};
  const listing = findListing(record.listingId || schedule.listingId) || {};
  const booking = record.bookingRef ? findBooking(record.bookingRef) : null;
  const company = findCompany(companyId || record.companyId || listing.companyId || schedule.companyId) || {};
  return {
    inventory: {
      id: record.id || record.seatNumber || record.roomNumber || record.roomType, scheduleId: record.scheduleId, listingId: listing.id,
      type: record.roomType ? 'room' : 'seat', seatNumber: record.seatNumber || record.label || '', roomType: record.roomType || '',
      price: record.price || record.priceDelta || listing.priceFrom || 0, currency: record.currency || listing.currency || 'UGX',
      status: record.status, lockedUntil: record.lockedUntil, holdId: record.lockId || record.holdId, bookingRef: record.bookingRef || booking?.bookingRef || '',
    },
    currentBooking: booking ? bookingDetail(booking) : {},
    service: { listingId: listing.id, title: listing.title, serviceType: listing.serviceType, from: listing.from, to: listing.to, address: listing.address || listing.location },
    schedule: { id: schedule.id, departure: schedule.departAt, arrival: schedule.arriveAt, vehicleName: schedule.vehicleName, status: schedule.status },
    company: companyDetail(company),
    timestamps: { createdAt: record.createdAt, updatedAt: record.updatedAt },
  };
}

function employeeSupportDetail(ticket = {}) {
  if (!ticket) return null;
  const booking = ticket.bookingRef ? findBooking(ticket.bookingRef) : null;
  const company = findCompany(ticket.companyId || booking?.companyId || ticket.ownerId) || {};
  return {
    case: { id: ticket.id, subject: ticket.subject, category: ticket.category || ticket.type || 'support', message: ticket.message, priority: ticket.priority, status: ticket.status, audience: ticket.audience, assignedTo: ticket.assignedTo, createdBy: ticket.createdBy },
    customer: { ownerType: ticket.ownerType, ownerId: ticket.ownerId, email: ticket.email || booking?.guestSnapshot?.email, phone: ticket.phone || booking?.guestSnapshot?.phone },
    booking: booking ? bookingDetail(booking).booking : { bookingRef: ticket.bookingRef || '' },
    company: companyDetail(company),
    resolution: { lastResponse: ticket.lastResponse, resolutionNotes: ticket.resolutionNotes, respondedBy: ticket.respondedBy, respondedAt: ticket.respondedAt, resolvedAt: ticket.resolvedAt },
    timestamps: { createdAt: ticket.createdAt, updatedAt: ticket.updatedAt },
  };
}

function employeeRefundDetail(refund = {}) {
  if (!refund) return null;
  const booking = findBooking(refund.bookingRef) || {};
  return {
    refund: { id: refund.id, bookingRef: refund.bookingRef, amount: refund.amount, currency: refund.currency || booking.pricing?.currency || 'UGX', reason: refund.reason, status: refund.status, requestedBy: refund.requesterId || refund.createdBy, reviewedBy: refund.reviewedBy, reviewedAt: refund.reviewedAt, rejectionReason: refund.rejectionReason },
    booking: bookingDetail(booking),
    timestamps: { createdAt: refund.createdAt, updatedAt: refund.updatedAt },
  };
}

function paymentRecordDetail(payment = {}) {
  if (!payment) return null;
  const booking = findBooking(payment.bookingRef || payment.bookingId) || {};
  return {
    payment: { id: payment.id, bookingId: payment.bookingId, bookingRef: payment.bookingRef, provider: payment.provider, providerReference: payment.providerReference, amount: payment.amount, currency: payment.currency, status: payment.status, paidAt: payment.paidAt, failureReason: payment.failureReason, checkoutUrl: payment.checkoutUrl, methodNote: payment.methodNote || payment.paymentMethodNote, metadata: payment.rawPayload || payment.metadata },
    booking: bookingDetail(booking),
    timestamps: { createdAt: payment.createdAt, updatedAt: payment.updatedAt },
  };
}

function customerOpsDetail(booking = {}) {
  const detail = bookingDetail(booking) || {};
  const customerKey = normalize(booking.guestSnapshot?.email || booking.guestSnapshot?.phone || booking.customerUserId || booking.bookingRef);
  const customerBookings = state.bookings.filter((item) => normalize(item.customerUserId || item.guestSnapshot?.email || item.guestSnapshot?.phone || item.bookingRef) === customerKey);
  return {
    customer: detail.customer || {},
    latestBooking: detail.booking || {},
    company: detail.company || {},
    metrics: { bookingsCount: customerBookings.length, confirmedBookings: customerBookings.filter((item) => ['confirmed','checked_in','completed'].includes(item.bookingStatus)).length, totalSpend: moneyValue(customerBookings.reduce((total, item) => total + Number(item.pricing?.total || 0), 0)), notesCount: state.supportTickets.filter((ticket) => normalize(ticket.ownerId) === customerKey || normalize(ticket.audience) === customerKey).length },
    bookings: customerBookings.slice(0, 8).map((item) => ({ bookingRef: item.bookingRef, service: bookingTitle(item), status: item.bookingStatus, paymentStatus: item.paymentStatus, amount: moneyValue(item.pricing?.total || 0, item.pricing?.currency) })),
  };
}

function handoverDetail(handover = {}, companyId = '') {
  const company = findCompany(companyId || handover.companyId) || {};
  const employee = state.users.find((user) => user.id === handover.employeeId) || {};
  return {
    handover: { id: handover.id, companyId: handover.companyId, employeeId: handover.employeeId, employeeName: employee.fullName || handover.employeeId, shift: handover.shift, nextStaff: handover.nextStaff, note: handover.note, issues: handover.issues, cashCollected: handover.cashCollected, bookingsHandled: handover.bookingsHandled, checkInsHandled: handover.checkInsHandled, status: handover.status },
    company: companyDetail(company),
    timestamps: { createdAt: handover.createdAt, updatedAt: handover.updatedAt },
  };
}

function customerDashboardData(bookings, customerId = 'user-customer-001') {
  const customerUser = state.users.find((user) => user.id === customerId)
    || state.users.find((user) => user.id === 'user-customer-001' || user.role === 'customer')
    || {};
  const customerWallets = state.wallets.filter((wallet) => wallet.ownerType === 'customer' && (!wallet.ownerId || wallet.ownerId === customerUser.id));
  const wallet = customerWallets[0] || {};
  const activeBookings = bookings.filter((booking) => ['confirmed', 'pending', 'ticketed', 'checked_in'].includes(normalize(booking.bookingStatus)) && !/refund|cancel/.test(normalize(booking.bookingStatus)));
  const pastBookings = bookings.filter((booking) => ['completed', 'checked_in'].includes(normalize(booking.bookingStatus)));
  const savedListings = state.savedListings?.filter((item) => item.userId === customerUser.id).map((item) => findListing(item.listingId)).filter(Boolean)
    || state.listings.filter((listing) => listing.isFeatured || listing.bookable).slice(0, 8);
  const bookingMeta = (booking, actions = ['view', 'ticket', 'receipt', 'refund', 'support', 'review', 'export']) => dashboardMeta('booking', booking.bookingRef, booking.bookingRef, booking.bookingStatus, bookingDetail(booking), actions);
  const bookingRows = bookings.map((booking) => [
    booking.bookingRef,
    bookingTitle(booking),
    bookingCompany(booking),
    dateValue(booking.createdAt || booking.travelDate || booking.departAt),
    bookingCustomer(booking),
    booking.bookingStatus,
    bookingTotal(booking),
    bookingMeta(booking),
  ]);
  const savedRows = savedListings.map((listing) => [
    listing.title,
    listing.type || listing.serviceType,
    listing.partner || findCompany(listing.companyId)?.name || 'Classic Trip partner',
    `${listing.from || listing.city || listing.location || '-'}${listing.to ? ` to ${listing.to}` : ''}`,
    moneyValue(listing.priceFrom || listing.price || 0, listing.currency || 'UGX'),
    listing.bookable ? 'Available' : listing.status || 'Saved',
    dashboardMeta('saved_listing', listing.id, listing.title, listing.status || 'saved', listingDetail(listing), ['view', 'book', 'remove', 'export']),
  ]);
  const receiptRows = bookings.map((booking, index) => {
    const payment = state.payments.find((item) => item.bookingRef === booking.bookingRef || item.bookingId === booking.id) || {};
    const receiptId = payment.receiptNumber || `RCT-${9000 + index}`;
    return [
      receiptId,
      booking.bookingRef,
      payment.provider || booking.paymentProvider || 'Classic Trip Payments',
      dateValue(payment.paidAt || payment.createdAt || booking.createdAt),
      moneyValue(payment.amount || booking.pricing?.total || 0, payment.currency || booking.pricing?.currency || 'UGX'),
      payment.status || booking.paymentStatus,
      dashboardMeta('receipt', receiptId, receiptId, payment.status || booking.paymentStatus, paymentDetail(booking, payment), ['view', 'download', 'booking', 'export']),
    ];
  });
  const refundRows = state.refundRequests.filter((refund) => !refund.bookingRef || bookings.some((booking) => booking.bookingRef === refund.bookingRef)).map((refund) => [
    refund.id,
    refund.bookingRef,
    refund.reason,
    moneyValue(refund.amount || 0, refund.currency || 'UGX'),
    refund.status,
    refund.reviewedAt ? dateValue(refund.reviewedAt) : dateValue(refund.createdAt || new Date()),
    dashboardMeta('refund', refund.id, refund.id, refund.status, refundDetail(refund), ['view', 'booking', 'support', 'export']),
  ]);
  const supportRows = state.supportTickets.filter((ticket) => ticket.ownerType === 'customer' || ticket.ownerId === customerUser.id || bookings.some((booking) => booking.bookingRef === ticket.bookingRef)).map((ticket) => [
    ticket.id,
    ticket.bookingRef || ticket.relatedBookingRef || 'General',
    ticket.subject,
    ticket.priority || 'Normal',
    ticket.status,
    dateValue(ticket.createdAt || ticket.updatedAt || new Date()),
    dashboardMeta('support', ticket.id, ticket.id, ticket.status, supportDetail(ticket), ['view', 'reply', 'reopen', 'export']),
  ]);
  const reviewRows = bookings.map((booking) => {
    const review = state.reviews.find((item) => item.bookingId === booking.id || item.bookingRef === booking.bookingRef);
    const canReview = ['checked_in', 'completed'].includes(normalize(booking.bookingStatus));
    return [
      booking.bookingRef,
      bookingTitle(booking),
      bookingCompany(booking),
      review ? String(review.rating) : '-',
      review ? review.comment : canReview ? 'Eligible for review' : 'Trip not completed yet',
      review ? (review.status === 'published' ? 'Submitted' : review.status) : canReview ? 'Pending' : 'Not eligible',
      dashboardMeta('review', review?.id || booking.bookingRef, booking.bookingRef, review?.status || (canReview ? 'pending' : 'not eligible'), { review: review || {}, booking: bookingDetail(booking) }, ['view', canReview ? 'write_review' : 'disabled', 'export']),
    ];
  });
  const walletRows = state.walletTransactions
    .filter((txn) => txn.ownerType === 'customer' || txn.ownerId === customerUser.id || txn.customerId === customerUser.id)
    .map((txn) => [
      txn.id,
      txn.transactionType || txn.type,
      txn.method || txn.reference || txn.source || 'Wallet',
      dateValue(txn.createdAt || new Date()),
      moneyValue(txn.amount || 0, txn.currency || wallet.currency || 'UGX'),
      txn.status || 'completed',
      dashboardMeta('wallet_transaction', txn.id, txn.id, txn.status, { transaction: txn, wallet }, ['view', 'export']),
    ]);
  const fallbackWalletRows = customerWallets.map((item) => [
    item.id,
    'Wallet balance',
    item.currency || 'UGX',
    'Current',
    moneyValue(item.availableBalance || 0, item.currency || 'UGX'),
    item.status || 'Active',
    dashboardMeta('wallet', item.id, item.id, item.status || 'active', { wallet: item, owner: customerDetail(customerUser) }, ['view', 'export']),
  ]);
  const notificationRows = (state.notifications || []).filter((note) => !note.ownerType || note.ownerType === 'customer' || note.audience === 'customers').slice(0, 12).map((note) => [
    note.title || note.subject || note.id,
    note.type || note.channel || (Array.isArray(note.channels) ? note.channels.join(', ') : 'Notification'),
    note.message || note.body || '',
    dateValue(note.createdAt || note.updatedAt || new Date()),
    note.status || note.deliveryStatus || 'Unread',
    dashboardMeta('notification', note.id, note.title || note.subject, note.status, notificationDetail(note), ['view', 'mark_read', 'export']),
  ]);
  const generatedNotifications = bookings.slice(0, 5).map((booking) => [
    `N-${booking.bookingRef}`,
    'Booking',
    `${bookingTitle(booking)} is ${booking.bookingStatus}.`,
    dateValue(booking.updatedAt || booking.createdAt),
    'Unread',
    dashboardMeta('notification', `N-${booking.bookingRef}`, booking.bookingRef, 'Unread', { notification: { title: 'Booking update', body: `${bookingTitle(booking)} is ${booking.bookingStatus}.`, audience: 'customer' }, booking: bookingDetail(booking) }, ['view', 'mark_read', 'export']),
  ]);
  const currentTicket = activeBookings[0] || bookings[0] || {};
  const totalSpend = bookings.reduce((total, booking) => total + Number(booking.pricing?.total || 0), 0);
  const refundsTotal = refundRows.reduce((total, row) => total + Number(String(row[3]).replace(/[^0-9.-]/g, '') || 0), 0);
  return {
    overviewStats: [
      { label: 'Active booking', value: activeBookings[0]?.bookingRef || 'None', icon: 'fa-ticket', hint: activeBookings.length ? 'Ready' : 'No active ticket' },
      { label: 'Upcoming trips', value: String(activeBookings.length), icon: 'fa-calendar-days', hint: 'Customer scoped' },
      { label: 'Past bookings', value: String(pastBookings.length), icon: 'fa-clock-rotate-left', hint: 'Completed travel' },
      { label: 'Wallet balance', value: moneyValue(wallet.availableBalance || 0, wallet.currency || 'UGX'), icon: 'fa-wallet', hint: wallet.currency || 'UGX' },
      { label: 'Refunds tracked', value: moneyValue(refundsTotal || 0, wallet.currency || 'UGX'), icon: 'fa-rotate-left', hint: `${refundRows.length} requests` },
      { label: 'Support cases', value: String(supportRows.length), icon: 'fa-headset', hint: supportRows.filter((row) => !/resolved|closed/i.test(row[4])).length + ' open' },
      { label: 'Reviews', value: String(reviewRows.filter((row) => row[5] === 'Submitted').length), icon: 'fa-star', hint: 'Submitted' },
      { label: 'Total spend', value: moneyValue(totalSpend, wallet.currency || 'UGX'), icon: 'fa-coins', hint: 'All bookings' },
    ],
    liveActivity: currentTicket.bookingRef ? [
      ['Service', bookingTitle(currentTicket)],
      ['Departure', dateValue(currentTicket.travelDate || currentTicket.departAt || currentTicket.createdAt)],
      ['Seat / room', (currentTicket.passengers || []).map((pax) => pax.seatOrRoom || pax.seatNumber).filter(Boolean).join(', ') || 'Assigned at check-in'],
      ['Booking', currentTicket.bookingRef],
    ] : [],
    profile: {
      fullName: customerUser.fullName || bookingCustomer(currentTicket),
      email: customerUser.email || currentTicket.guestSnapshot?.email || '',
      phone: customerUser.phone || currentTicket.guestSnapshot?.phone || '',
      city: customerUser.city || 'Kampala',
      status: customerUser.status || 'active',
      createdAt: customerUser.createdAt || '',
      passengerNote: customerUser.passengerNote || `${bookingCustomer(currentTicket)} • ${currentTicket.guestSnapshot?.phone || customerUser.phone || 'No phone'} • ${currentTicket.guestSnapshot?.email || customerUser.email || 'No email'}`,
      preferences: { preferredSeat: customerUser.preferredSeat || 'Window', defaultCurrency: wallet.currency || 'UGX', notifications: 'Enabled', receiptEmail: customerUser.email ? 'Enabled' : 'Add email' },
    },
    currentTicket: currentTicket.bookingRef ? bookingDetail(currentTicket) : null,
    bookings: bookingRows,
    saved: savedRows,
    receipts: receiptRows,
    refunds: refundRows,
    support: supportRows,
    reviews: reviewRows,
    wallet: walletRows.length ? walletRows : (fallbackWalletRows.length ? fallbackWalletRows : [['wallet-customer-live', 'Wallet balance', 'UGX', 'Current', moneyValue(0, 'UGX'), 'Active', dashboardMeta('wallet', 'wallet-customer-live', 'Customer wallet', 'Active', { wallet: { availableBalance: 0, currency: 'UGX' }, owner: customerDetail(customerUser) }, ['view'])]]),
    notifications: notificationRows.length ? notificationRows : generatedNotifications,
    security: [
      ['Current session', 'Dashboard browser', dateValue(new Date()), 'Current', dashboardMeta('security_session', 'current-session', 'Current session', 'Current', { session: { device: 'Dashboard browser', location: 'Current location', current: true }, customer: customerDetail(customerUser) }, ['view'])],
      ['Password', 'Account credentials', customerUser.passwordChangedAt ? dateValue(customerUser.passwordChangedAt) : 'Not recorded', 'Change available', dashboardMeta('security_password', 'password', 'Password', 'Change available', { security: { passwordChangeForm: 'Available from customer security panel', twoFactorEnabled: Boolean(customerUser.twoFactorEnabled) }, customer: customerDetail(customerUser) }, ['view'])],
      ['Email verification', customerUser.email || 'No email', customerUser.emailVerifiedAt ? dateValue(customerUser.emailVerifiedAt) : 'Pending', customerUser.emailVerifiedAt ? 'Verified' : 'Recommended', dashboardMeta('security_email', 'email', 'Email verification', customerUser.emailVerifiedAt ? 'Verified' : 'Recommended', { security: { email: customerUser.email, verifiedAt: customerUser.emailVerifiedAt || '' } }, ['view'])],
    ],
  };
}

function promoterDashboardData(links, bookings, promoterId = 'user-promoter-001') {
  const promoterUser = state.users.find((user) => user.id === promoterId) || state.users.find((user) => user.role === 'promoter') || {};
  const promoter = promoterDetail(promoterUser) || {};
  const wallet = state.wallets.find((item) => item.ownerType === 'promoter' && item.ownerId === promoterId) || {};
  const shareListings = state.listings.filter((listing) => listing.bookable || listing.isSponsored).slice(0, 12);
  const allClicks = links.reduce((total, link) => total + Number(link.clicks || 0), 0);
  const allConversions = links.reduce((total, link) => total + Number(link.conversions || 0), 0);
  const paidBookings = bookings.filter((booking) => ['successful', 'paid', 'completed'].includes(normalize(booking.paymentStatus)));
  const cancelledRefundedBookings = bookings.filter((booking) => /cancel|refund/.test(normalize(booking.bookingStatus)) || /refund/.test(normalize(booking.paymentStatus)));
  const grossRevenue = bookings.reduce((total, booking) => total + Number(booking.pricing?.total || 0), 0);
  const commissionEarned = bookings.reduce((total, booking) => total + Number(booking.pricing?.split?.promoterAmount || 0), 0);
  const withdrawalTransactions = state.walletTransactions.filter((txn) => txn.ownerType === 'promoter' && (!txn.ownerId || txn.ownerId === promoterId));
  const paidWithdrawals = withdrawalTransactions.filter((txn) => ['paid', 'completed', 'released'].includes(normalize(txn.status))).reduce((total, txn) => total + Number(txn.amount || 0), 0);
  const pendingWithdrawals = withdrawalTransactions.filter((txn) => !['paid', 'completed', 'released'].includes(normalize(txn.status))).reduce((total, txn) => total + Number(txn.amount || 0), 0);
  const mainLink = links[0] || {};

  const linkDetail = (link = {}) => {
    const listing = findListing(link.listingId) || {};
    const company = findCompany(listing.companyId) || {};
    const referralBookings = bookings.filter((booking) => booking.promoterAttribution?.linkId === link.id || normalize(booking.promoterAttribution?.code) === normalize(link.code));
    const conversionRate = Number(link.clicks || 0) ? `${Math.round((Number(link.conversions || 0) / Number(link.clicks || 0)) * 1000) / 10}%` : '0%';
    return {
      referralLink: {
        id: link.id,
        code: link.code,
        referralCode: link.referralCode || link.code,
        marketplaceReferralUrl: link.url,
        listingReferralUrl: link.url,
        whatsappShare: `https://wa.me/?text=${encodeURIComponent(link.url || link.code || '')}`,
        emailShare: `mailto:?subject=Classic Trip referral&body=${encodeURIComponent(link.url || link.code || '')}`,
        qrCodePayload: link.url || link.code,
        clicks: link.clicks || 0,
        views: link.views || link.clicks || 0,
        conversions: link.conversions || 0,
        conversionRate,
        status: link.status || 'active',
      },
      listing: listingDetail(listing)?.listing || { listingId: link.listingId },
      service: listingDetail(listing)?.service || {},
      company: { companyId: company.id || listing.companyId || '', name: company.name || listing.partner || '', slug: company.slug || '', phone: company.phone || company.supportContacts?.phone || '' },
      finance: {
        referredBookings: referralBookings.length,
        grossReferredRevenue: moneyValue(referralBookings.reduce((total, booking) => total + Number(booking.pricing?.total || 0), 0)),
        commissionEarned: moneyValue(referralBookings.reduce((total, booking) => total + Number(booking.pricing?.split?.promoterAmount || 0), 0)),
      },
      promoter: promoter.promoter,
      timestamps: { createdAt: link.createdAt, updatedAt: link.updatedAt },
    };
  };

  const shareDetail = (listing = {}) => {
    const detail = listingDetail(listing) || {};
    const company = findCompany(listing.companyId) || {};
    const referralUrl = `/listings/${listing.serviceType}/${listing.slug}?ref=${encodeURIComponent(mainLink.code || promoterUser.referralCode || '')}`;
    return {
      ...detail,
      referral: {
        promoterCode: mainLink.code || promoterUser.referralCode || '',
        referralUrl,
        copyUrl: referralUrl,
        whatsappShare: `https://wa.me/?text=${encodeURIComponent(referralUrl)}`,
        emailShare: `mailto:?subject=Classic Trip listing&body=${encodeURIComponent(referralUrl)}`,
        qrCodePayload: referralUrl,
      },
      company: { companyId: company.id || listing.companyId || '', name: company.name || listing.partner || '', email: company.email || company.supportContacts?.email || '', phone: company.phone || company.supportContacts?.phone || '' },
    };
  };

  const commissionDetail = (booking = {}, index = 0) => {
    const commission = state.commissions.find((item) => item.bookingId === booking.id && item.promoterId === promoterId) || {};
    const detail = bookingDetail(booking) || {};
    return {
      commission: {
        commissionId: commission.id || `COM-${700 + index}`,
        bookingId: booking.id,
        bookingRef: booking.bookingRef,
        referralCode: booking.promoterAttribution?.code || mainLink.code || '',
        referralPercent: booking.pricing?.split?.promoterPercent || '3%',
        grossAmount: moneyValue(booking.pricing?.total || 0, booking.pricing?.currency),
        commissionAmount: moneyValue(booking.pricing?.split?.promoterAmount || 0, booking.pricing?.currency),
        commissionStatus: commission.status || (['successful', 'paid'].includes(normalize(booking.paymentStatus)) ? 'earned' : 'pending'),
        settlementStatus: booking.settlementStatus || commission.settlementStatus || 'pending',
        paidAt: commission.paidAt || '',
      },
      booking: detail.booking,
      customer: detail.customer,
      company: detail.company,
      service: detail.service,
      payment: detail.payment,
      split: detail.split,
      timestamps: { createdAt: commission.createdAt || booking.createdAt, updatedAt: commission.updatedAt || booking.updatedAt },
    };
  };

  const withdrawalDetail = (row = {}, fallbackWallet = null) => ({
    withdrawal: {
      transactionId: row.id || fallbackWallet?.id || '',
      type: row.transactionType || row.type || 'Promoter withdrawal',
      method: row.method || promoterUser.payoutAccount?.method || 'Mobile Money',
      account: row.account || promoterUser.payoutAccount?.account || promoterUser.phone || '',
      amount: moneyValue(row.amount ?? fallbackWallet?.availableBalance ?? 0, row.currency || fallbackWallet?.currency || 'UGX'),
      currency: row.currency || fallbackWallet?.currency || 'UGX',
      status: row.status || (fallbackWallet?.pendingBalance > 0 ? 'pending' : 'available'),
      reference: row.reference || row.referenceId || '',
      createdAt: row.createdAt || '',
      reviewedAt: row.reviewedAt || '',
    },
    promoter: promoter.promoter,
    wallet: promoter.wallet,
    payoutAccount: promoterUser.payoutAccount || { method: 'Not configured', account: promoterUser.phone || '' },
  });

  const supportRows = state.supportTickets.filter((ticket) => ticket.ownerType === 'promoter' && (!ticket.ownerId || ticket.ownerId === promoterId));
  const trafficRows = [
    ['Cancelled referred bookings', 'All referral links', String(cancelledRefundedBookings.length), cancelledRefundedBookings.length > 2 ? 'Medium' : 'Low', cancelledRefundedBookings.length ? 'Review' : 'Approved', dashboardMeta('traffic_quality', 'cancelled-referred', 'Cancelled referred bookings', cancelledRefundedBookings.length ? 'Review' : 'Approved', { traffic: { cancelledOrRefunded: cancelledRefundedBookings.length, bookingRefs: cancelledRefundedBookings.map((booking) => booking.bookingRef), risk: cancelledRefundedBookings.length > 2 ? 'medium' : 'low' }, promoter: promoter.promoter }, ['view', 'export'])],
    ['Failed payments', 'Referral bookings', String(bookings.filter((booking) => !['successful', 'paid', 'completed'].includes(normalize(booking.paymentStatus))).length), 'Low', 'Approved', dashboardMeta('traffic_quality', 'failed-payments', 'Failed payments', 'Approved', { traffic: { failedPayments: bookings.filter((booking) => !['successful', 'paid', 'completed'].includes(normalize(booking.paymentStatus))).map((booking) => booking.bookingRef), reason: 'Track failed referrals for quality review' }, promoter: promoter.promoter }, ['view', 'export'])],
    ['Duplicate customer contacts', 'Recent referrals', String(new Set(bookings.map((booking) => normalize(booking.guestSnapshot?.phone || booking.guestSnapshot?.email))).size), 'Low', 'Approved', dashboardMeta('traffic_quality', 'duplicate-contacts', 'Duplicate customer contacts', 'Approved', { traffic: { uniqueContacts: new Set(bookings.map((booking) => normalize(booking.guestSnapshot?.phone || booking.guestSnapshot?.email))).size, totalBookings: bookings.length }, promoter: promoter.promoter }, ['view', 'export'])],
    ['Cancellation rate', 'All sources', bookings.length ? `${Math.round((cancelledRefundedBookings.length / bookings.length) * 100)}%` : '0%', cancelledRefundedBookings.length > 2 ? 'Medium' : 'Low', cancelledRefundedBookings.length > 2 ? 'Review' : 'Approved', dashboardMeta('traffic_quality', 'cancellation-rate', 'Cancellation rate', cancelledRefundedBookings.length > 2 ? 'Review' : 'Approved', { traffic: { totalBookings: bookings.length, cancelledOrRefunded: cancelledRefundedBookings.length, rate: bookings.length ? `${Math.round((cancelledRefundedBookings.length / bookings.length) * 100)}%` : '0%' }, promoter: promoter.promoter }, ['view', 'export'])],
  ];

  return {
    profile: {
      ...(promoter.promoter || {}),
      payoutAccount: promoterUser.payoutAccount || { method: 'Mobile Money', account: promoterUser.phone || '' },
      mainReferralCode: mainLink.code || promoterUser.referralCode || '',
      mainReferralUrl: mainLink.url || `/marketplace?ref=${encodeURIComponent(promoterUser.referralCode || '')}`,
      verificationStatus: promoterUser.verificationStatus || promoterUser.status || 'active',
    },
    overviewStats: [
      { label: 'Referral code', value: mainLink.code || promoterUser.referralCode || '-', icon: 'fa-link', hint: 'Primary tracking code' },
      { label: 'Total bookings', value: String(bookings.length), icon: 'fa-ticket', hint: `${paidBookings.length} confirmed / ${cancelledRefundedBookings.length} cancelled-refunded` },
      { label: 'Gross referred revenue', value: moneyValue(grossRevenue), icon: 'fa-chart-line', hint: 'Total ticket value from referrals' },
      { label: 'Commission earned', value: moneyValue(commissionEarned), icon: 'fa-coins', hint: 'Promoter commission from referred bookings' },
    ],
    liveActivity: [
      ['Withdrawable', moneyValue(wallet.availableBalance || 0, wallet.currency || 'UGX')],
      ['Pending withdrawals', moneyValue(pendingWithdrawals || wallet.pendingBalance || 0, wallet.currency || 'UGX')],
      ['Paid withdrawals', moneyValue(paidWithdrawals, wallet.currency || 'UGX')],
      ['Conversion rate', allClicks ? `${Math.round((allConversions / allClicks) * 100)}%` : '0%'],
    ],
    links: links.map((link) => {
      const listing = findListing(link.listingId) || {};
      const detail = linkDetail(link);
      return [link.code, listing.title || 'Listing', listing.type || listing.serviceType || 'Service', String(link.clicks || 0), String(link.conversions || 0), link.status || 'Active', dashboardMeta('referral_link', link.id, link.code, link.status || 'active', detail, ['view', 'copy', 'share', 'export'])];
    }),
    share: shareListings.map((listing) => {
      const detail = shareDetail(listing);
      const company = findCompany(listing.companyId) || {};
      return [listing.title, listing.type || listing.serviceType, company.name || listing.partner, `${listing.from || listing.city || ''}${listing.to ? ` to ${listing.to}` : ''}`, moneyValue(listing.priceFrom, listing.currency), listing.isSponsored ? 'Promotion' : listing.bookable ? 'Available' : 'Review', dashboardMeta('share_listing', listing.id, listing.title, listing.isSponsored ? 'promotion' : 'available', detail, ['view', 'copy', 'share', 'export'])];
    }),
    commissions: bookings.map((booking, index) => {
      const detail = commissionDetail(booking, index);
      const status = detail.commission.commissionStatus === 'released' ? 'Earned' : detail.commission.commissionStatus === 'hold' ? 'Hold' : detail.commission.commissionStatus;
      return [detail.commission.commissionId, booking.bookingRef, detail.commission.grossAmount, detail.commission.referralPercent, detail.commission.commissionAmount, status, dashboardMeta('commission', detail.commission.commissionId, detail.commission.commissionId, status, detail, ['view', 'booking', 'export'])];
    }),
    withdrawals: (withdrawalTransactions.length ? withdrawalTransactions.map((txn) => [txn.id, txn.transactionType || 'Withdrawal', txn.account || promoterUser.phone || promoterId, dateValue(txn.createdAt), moneyValue(txn.amount, txn.currency), txn.status, dashboardMeta('withdrawal', txn.id, txn.id, txn.status, withdrawalDetail(txn), ['view', 'export'])]) : [[wallet.id || 'promoter-wallet', 'available_balance', promoterId, 'Current', moneyValue(wallet.availableBalance || 0, wallet.currency || 'UGX'), wallet.pendingBalance > 0 ? 'Pending payout' : 'Available', dashboardMeta('withdrawal', wallet.id || 'promoter-wallet', wallet.id || 'promoter-wallet', wallet.pendingBalance > 0 ? 'pending' : 'available', withdrawalDetail({}, wallet), ['view', 'export'])]]),
    bookings: bookings.map((booking) => {
      const detail = bookingDetail(booking) || {};
      return [booking.bookingRef, bookingTitle(booking), bookingCustomer(booking), bookingTotal(booking), moneyValue(booking.pricing?.split?.promoterAmount || 0, booking.pricing?.currency), booking.paymentStatus, dashboardMeta('referral_booking', booking.id, booking.bookingRef, booking.paymentStatus, detail, ['view', 'copy', 'export'])];
    }),
    campaigns: state.promotionCampaigns.map((campaign) => {
      const detail = campaignDetail(campaign);
      const relatedLinks = links.filter((link) => link.listingId === campaign.listingId).length;
      return [campaign.name || campaign.title, campaign.placement || campaign.type, String(relatedLinks), String(campaign.clicks || 0), String(campaign.bookings || campaign.conversions || 0), moneyValue(campaign.budget || 0), campaign.status, dashboardMeta('campaign', campaign.id, campaign.name || campaign.title, campaign.status, detail, ['view', 'export'])];
    }),
    payouts: [
      [wallet.id || 'promoter-wallet', 'Current balance', wallet.currency || 'UGX', moneyValue(wallet.availableBalance || 0, wallet.currency || 'UGX'), promoterUser.payoutAccount?.method || 'Wallet', wallet.pendingBalance > 0 ? 'Pending' : 'Available', dashboardMeta('payout', wallet.id || 'promoter-wallet', wallet.id || 'promoter-wallet', wallet.pendingBalance > 0 ? 'pending' : 'available', withdrawalDetail({}, wallet), ['view', 'export'])],
      ...withdrawalTransactions.map((txn) => [txn.id, dateValue(txn.createdAt), txn.currency || wallet.currency || 'UGX', moneyValue(txn.amount || 0, txn.currency || wallet.currency || 'UGX'), txn.reference || txn.transactionType || 'Withdrawal', txn.status, dashboardMeta('payout', txn.id, txn.id, txn.status, withdrawalDetail(txn), ['view', 'export'])]),
    ],
    fraud: trafficRows,
    support: supportRows.map((ticket) => [ticket.id, ticket.subject, ticket.priority, ticket.status, dateValue(ticket.createdAt || ticket.updatedAt), dashboardMeta('support_case', ticket.id, ticket.id, ticket.status, supportDetail(ticket), ['view', 'export'])]),
    performance: {
      bars: [['Mon', 44], ['Tue', 58], ['Wed', 70], ['Thu', 62], ['Fri', 84], ['Sat', 92], ['Sun', 76]],
      bestListings: shareListings.slice(0, 5).map((listing) => listing.title),
      bestCompanies: Array.from(new Set(shareListings.map((listing) => findCompany(listing.companyId)?.name || listing.partner).filter(Boolean))).slice(0, 5),
      bookingsOverTime: bookings.map((booking) => ({ date: dateValue(booking.createdAt), bookingRef: booking.bookingRef, amount: booking.pricing?.total || 0, commission: booking.pricing?.split?.promoterAmount || 0 })),
    },
  };
}

function serviceStats() {
  return state.categories.map((category) => {
    const listings = state.listings.filter((listing) => listing.serviceType === category.key);
    return {
      ...category,
      listingsCount: listings.length,
      activeListingsCount: listings.filter((listing) => listing.status === 'active').length,
      bookableListingsCount: listings.filter((listing) => listing.bookable).length,
      sponsoredListingsCount: listings.filter((listing) => listing.isSponsored).length,
    };
  });
}

function corridorStats() {
  return catalogRouteHighlights().map((item) => ({
    corridor: item.corridor,
    label: item.label,
    routes: item.count,
    seats: item.remainingSeats,
    minPrice: item.minPrice,
    currency: item.currency,
    nextDeparture: item.nextDeparture,
  }));
}

function searchListings(query = {}) {
  const q = normalize(query.q || query.search || '');
  const serviceType = normalize(query.serviceType || query.type || query.group || '');
  const route = normalize(query.route || '');
  const corridor = normalize(query.corridor || '');
  const city = normalize(query.city || '');
  const country = normalize(query.country || '');
  const origin = normalize(query.origin || query.from || '');
  const destination = normalize(query.destination || query.to || '');
  const partner = normalize(query.partner || '');
  const min = Number(query.min || query.priceMin || 0);
  const max = Number(query.max || query.priceMax || 0);
  const minRating = Number(query.rating || query.minRating || 0);
  const date = query.date ? new Date(query.date) : null;
  const verified = query.verified === 'true' || query.verified === true;
  const bookable = query.bookable === 'true' || query.bookable === true;
  const sponsored = query.sponsored === 'true' || query.sponsored === true;
  const availableOnly = query.available === 'true' || query.availableOnly === 'true' || query.availableOnly === true;
  const instant = query.instant === 'true' || query.instantConfirmation === 'true' || query.instant === true || query.instantConfirmation === true;
  const refundable = query.refundable === 'true' || query.refundable === true;
  const sort = normalize(query.sort || 'recommended');

  let results = buildListingCatalog();
  if (q) {
    results = results.filter((item) => item.searchText.includes(q));
  }
  if (serviceType && serviceType !== 'all') {
    results = results.filter((item) => normalize(item.serviceType) === serviceType || normalize(item.group) === serviceType || normalize(item.typeLabel) === serviceType.replace('_', ' '));
  }
  if (route) results = results.filter((item) => normalize(`${item.from} ${item.to} ${item.corridor} ${item.routeLabel}`).includes(route));
  if (corridor) results = results.filter((item) => normalize(item.corridor) === corridor);
  if (city) results = results.filter((item) => normalize(`${item.city} ${item.from} ${item.to}`).includes(city));
  if (country) results = results.filter((item) => normalize(item.country).includes(country));
  if (origin) results = results.filter((item) => normalize(item.from).includes(origin));
  if (destination) results = results.filter((item) => normalize(item.to).includes(destination));
  if (partner) results = results.filter((item) => normalize(`${item.partner} ${item.companyName}`).includes(partner));
  if (min) results = results.filter((item) => item.priceFrom >= min);
  if (max) results = results.filter((item) => item.priceFrom <= max);
  if (minRating) results = results.filter((item) => Number(item.ratingAverage || item.rating || 0) >= minRating);
  if (date && !Number.isNaN(date.getTime())) {
    const target = date.toISOString().slice(0, 10);
    results = results.filter((item) => !item.nextDepartAt || new Date(item.nextDepartAt).toISOString().slice(0, 10) === target);
  }
  if (verified) results = results.filter((item) => item.isVerified);
  if (bookable) results = results.filter((item) => item.bookable);
  if (sponsored) results = results.filter((item) => item.isSponsored);
  if (availableOnly) results = results.filter((item) => item.remainingInventory > 0);
  if (instant) results = results.filter((item) => item.instantConfirmation);
  if (refundable) results = results.filter((item) => item.refundable);

  results = results.slice().sort((a, b) => {
    if (sort === 'cheapest') return a.priceFrom - b.priceFrom;
    if (sort === 'top-rated') return b.ratingAverage - a.ratingAverage;
    if (sort === 'most-booked') return b.reviewCount - a.reviewCount;
    if (sort === 'sponsored') return Number(b.isSponsored) - Number(a.isSponsored) || b.ratingAverage - a.ratingAverage;
    if (sort === 'best-value') return bestValueScore(b) - bestValueScore(a);
    if (sort === 'soonest') return (asDate(a.nextDepartAt)?.getTime() || Number.MAX_SAFE_INTEGER) - (asDate(b.nextDepartAt)?.getTime() || Number.MAX_SAFE_INTEGER);
    if (sort === 'availability') return b.remainingInventory - a.remainingInventory;
    if (sort === 'fastest') return String(a.duration).localeCompare(String(b.duration));
    return recommendedScore(b) - recommendedScore(a);
  });
  return results;
}

function bestValueScore(item) {
  const rating = (Number(item.ratingAverage || item.rating || 0)) * 16;
  const availability = Math.min(cleanNumber(item.remainingInventory || item.availability), 50) / 2;
  const price = item.priceFrom ? Math.max(0, 80 - item.priceFrom / 10000) : 0;
  const trust = (item.isVerified ? 12 : 0) + (item.instantConfirmation ? 8 : 0) + (item.refundable ? 6 : 0);
  return rating + availability + price + trust;
}

function recommendedScore(item) {
  const sponsored = item.isSponsored ? 12 : 0;
  const verified = item.isVerified ? 8 : 0;
  const bookable = item.bookable ? 6 : 0;
  const rating = (item.ratingAverage || 0) * 10;
  const popularity = Math.min(item.reviewCount || 0, 500) / 20;
  const price = item.priceFrom ? Math.max(0, 20 - item.priceFrom / 50000) : 0;
  const availability = Math.min(cleanNumber(item.remainingInventory || item.availability), 60) / 6;
  const nextDepartAt = asDate(item.nextDepartAt);
  const soon = nextDepartAt ? Math.max(0, 8 - Math.max(0, nextDepartAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)) : 0;
  return sponsored + verified + bookable + rating + popularity + price + availability + soon;
}

function findListing(identifier, serviceType) {
  const id = normalize(identifier);
  const type = normalize(serviceType || '');
  return state.listings.find((item) => normalize(item.id) === id || normalize(item.slug) === id || normalize(item.title) === id && (!type || normalize(item.serviceType) === type));
}

function findCompany(slug) {
  const key = normalize(slug);
  return state.companies.find((company) => normalize(company.slug) === key || normalize(company.id) === key);
}

function listingsForCompany(companyId) {
  return state.listings.filter((item) => item.companyId === companyId);
}

function routesForListing(listingId) {
  return state.routes.filter((route) => route.listingId === listingId);
}

function schedulesForListing(listingId) {
  return state.schedules.filter((schedule) => schedule.listingId === listingId);
}

function roomsForListing(listingId) {
  return state.rooms.filter((room) => room.listingId === listingId);
}

function seatsForSchedule(scheduleId) {
  return state.seats.filter((seat) => seat.scheduleId === scheduleId);
}

function getAvailability(listingId) {
  const listing = findListing(listingId);
  if (!listing) return null;
  if (listing.serviceType === 'bus') {
    releaseExpiredSeatLocks();
    const schedules = schedulesForListing(listing.id);
    const firstSchedule = schedules[0];
    return { listing, schedules, seats: firstSchedule ? seatsForSchedule(firstSchedule.id) : [] };
  }
  if (listing.serviceType === 'hotel') {
    return { listing, rooms: roomsForListing(listing.id) };
  }
  return { listing, message: 'Provider integration planned; read-only listing for now.' };
}

function findUserByIdentity(identity) {
  const key = normalize(identity);
  return state.users.find((user) => normalize(user.email) === key || normalize(user.phone) === key);
}

function upsertUser(user) {
  const existing = findUserByIdentity(user.email || user.phone);
  if (existing) Object.assign(existing, user, { lastLoginAt: new Date().toISOString() });
  else state.users.push({ id: `user-${state.users.length + 1}`, status: 'active', isVerified: false, ...user, createdAt: new Date().toISOString() });
  return findUserByIdentity(user.email || user.phone);
}

function recordReferralClick(code, listingId, req) {
  if (!code) return null;
  const link = state.promoterLinks.find((item) => isActivePromoterLink(item) && (normalize(item.code) === normalize(code) || normalize(item.code.split('-').slice(0, -1).join('-')) === normalize(code)));
  const click = {
    id: `ref-click-${state.referralClicks.length + 1}`,
    linkId: link?.id || null,
    promoterId: link?.promoterId || null,
    listingId: listingId || link?.listingId || null,
    code,
    ip: req?.ip || '',
    userAgent: req?.headers?.['user-agent'] || '',
    createdAt: new Date().toISOString(),
  };
  state.referralClicks.push(click);
  if (link) link.clicks += 1;
  return click;
}

function settleBookingPayment(bookingRef) {
  const booking = findBooking(bookingRef);
  if (!booking || booking.settlementStatus === 'settled') return booking;
  if (booking.paymentStatus !== 'successful') return booking;
  const listing = findListing(booking.listingId);
  const promoterLink = booking.promoterAttribution?.linkId
    ? state.promoterLinks.find((link) => link.id === booking.promoterAttribution.linkId)
    : null;
  const split = booking.pricing?.split || calculateCommission(booking.pricing?.total || 0, Boolean(booking.promoterAttribution));
  const walletService = require('../wallet/walletService');
  const commissionService = require('../commission/commissionService');

  commissionService.createCommission(booking, Boolean(booking.promoterAttribution), split);
  walletService.creditAvailable('platform', 'platform', split.platformFee, {
    currency: booking.pricing.currency,
    transactionType: 'platform_fee',
    referenceType: 'booking',
    referenceId: booking.id,
  });
  walletService.creditPending('company', booking.companyId, split.companyAmount, {
    currency: booking.pricing.currency,
    transactionType: 'company_earning_pending',
    referenceType: 'booking',
    referenceId: booking.id,
  });
  if (booking.promoterAttribution?.promoterId) {
    walletService.creditPending('promoter', booking.promoterAttribution.promoterId, split.promoterAmount, {
      currency: booking.pricing.currency,
      transactionType: 'promoter_commission_pending',
      referenceType: 'booking',
      referenceId: booking.id,
    });
    if (promoterLink) promoterLink.conversions = Number(promoterLink.conversions || 0) + 1;
  }
  const activeCampaign = listing ? state.promotionCampaigns.find((campaign) => campaign.listingId === listing.id && campaign.status === 'active') : null;
  if (activeCampaign) activeCampaign.bookings = Number(activeCampaign.bookings || 0) + 1;
  booking.settlementStatus = 'settled';
  booking.settledAt = new Date().toISOString();
  return booking;
}

function createBooking(payload = {}, req = null) {
  const listing = findListing(payload.listingId || payload.slug);
  if (!listing) {
    const error = new Error('Listing not found');
    error.status = 404;
    throw error;
  }
  const company = findCompany(listing.companyId || listing.companySlug);
  if (listing.status !== 'active' || listing.bookable === false) {
    const error = new Error('This listing is not currently open for booking');
    error.status = 409;
    throw error;
  }
  if (company && (company.verificationStatus !== 'verified' || company.settings?.canPublish === false)) {
    const error = new Error('Company must be verified before it can receive bookings');
    error.status = 403;
    throw error;
  }
  if (!ENABLED_BOOKING_TYPES.includes(listing.serviceType)) {
    const error = new Error('This service is visible on the marketplace but is not fully bookable until provider integration is enabled.');
    error.status = 409;
    throw error;
  }
  const refCode = payload.ref || req?.cookies?.ct_ref || req?.session?.referralCode || '';
  const promoterLink = refCode ? state.promoterLinks.find((link) => isActivePromoterLink(link) && (normalize(link.code) === normalize(refCode) || normalize(link.code.split('-').slice(0, -1).join('-')) === normalize(refCode))) : null;
  const isSelfReferral = promoterLink && req?.session?.user?.id === promoterLink.promoterId;
  const hasValidReferral = Boolean(promoterLink && !isSelfReferral);
  let scheduleId = payload.scheduleId || schedulesForListing(listing.id)[0]?.id || null;
  let selected = payload.selected || payload.seatNumber || payload.roomId || (listing.serviceType === 'bus' ? 'A1' : 'Room 201');
  let subtotal = Number(listing.priceFrom) || 0;

  if (listing.serviceType === 'bus') {
    const schedule = state.schedules.find((item) => item.id === scheduleId) || schedulesForListing(listing.id)[0];
    scheduleId = schedule?.id || null;
    const seats = schedule ? seatsForSchedule(schedule.id) : [];
    const requestedSeat = payload.selected || payload.seatNumber;
    const seat = requestedSeat ? seats.find((item) => item.seatNumber === requestedSeat) : seats.find((item) => item.status === 'available');
    if (seat?.status === 'locked' && seat.lockedUntil && new Date(seat.lockedUntil) <= new Date()) {
      seat.status = 'available';
      seat.lockedUntil = null;
      seat.lockId = null;
    }
    const lockedByAnotherCheckout = seat?.status === 'locked' && (!payload.holdId || seat.lockId !== payload.holdId);
    if (!schedule || !seat || seat.status === 'taken' || lockedByAnotherCheckout) {
      const error = new Error('Selected seat is no longer available');
      error.status = 409;
      throw error;
    }
    seat.status = 'taken';
    seat.lockedUntil = null;
    seat.lockId = null;
    schedule.availableSeats = Math.max(0, Number(schedule.availableSeats || 0) - 1);
    selected = seat.seatNumber;
    subtotal = Number(schedule.basePrice || listing.priceFrom || 0) + Number(seat.priceDelta || 0);
  }

  if (listing.serviceType === 'hotel') {
    const rooms = roomsForListing(listing.id);
    const room = payload.roomId ? rooms.find((item) => item.id === payload.roomId) : rooms.find((item) => item.status === 'active' && item.inventory > 0);
    if (!room || room.inventory <= 0) {
      const error = new Error('Selected room is no longer available');
      error.status = 409;
      throw error;
    }
    if (payload.holdId) {
      const roomReservationService = require('../booking/roomReservationService');
      const reservation = roomReservationService.consumeReservation(payload.holdId, room.id);
      if (!reservation) {
        const error = new Error('Room hold expired or does not match this room');
        error.status = 409;
        throw error;
      }
    }
    room.inventory -= 1;
    selected = room.roomType;
    subtotal = Number(room.nightlyPrice || listing.priceFrom || 0);
  }

  const selectedAddons = selectedAddonsFor(listing.serviceType, payload);
  const addonTotal = selectedAddons.reduce((total, addon) => total + Number(addon.price || 0), 0);
  const fees = Math.round(subtotal * 0.045 + 3500);
  const computedTotal = subtotal + fees + addonTotal;
  const clientTotal = Number(payload.total || 0);
  const total = clientTotal > computedTotal ? clientTotal : computedTotal;
  const split = calculateCommission(total, hasValidReferral);
  const bookingRef = generateBookingRef(listing.serviceType);
  const initialPaymentStatus = payload.paymentStatus || (payload.deferPayment ? 'pending' : 'successful');
  const booking = {
    id: `booking-${state.bookings.length + 1}`,
    bookingRef,
    serviceType: listing.serviceType,
    guestSnapshot: {
      fullName: payload.fullName || payload.customerName || 'Guest Customer',
      email: payload.email || 'guest@example.com',
      phone: payload.phone || '+256700000000',
    },
    customerUserId: req?.session?.user?.id || null,
    companyId: listing.companyId,
    listingId: listing.id,
    scheduleId,
    passengers: [{ fullName: payload.passengerName || payload.fullName || 'Guest Customer', seatOrRoom: selected }],
    addons: selectedAddons,
    pricing: { subtotal, fees, addonTotal, total, currency: listing.currency || 'UGX', split, addons: selectedAddons },
    promoterAttribution: hasValidReferral ? { promoterId: promoterLink.promoterId, linkId: promoterLink.id, code: promoterLink.code } : null,
    paymentStatus: initialPaymentStatus,
    bookingStatus: initialPaymentStatus === 'successful' ? 'confirmed' : 'pending',
    qrCodeValue: `CLASSIC-TRIP:${bookingRef}:${listing.id}:${Date.now()}`,
    lockedUntil: addMinutes(new Date(), 10).toISOString(),
    createdAt: new Date().toISOString(),
  };
  state.bookings.unshift(booking);
  const fraudService = require('../fraud/fraudService');
  booking.risk = fraudService.scoreBookingRisk(booking);
  if (fraudService.needsManualReview(booking.risk)) {
    state.supportTickets.unshift({
      id: `support-${state.supportTickets.length + 1}`,
      ownerType: 'platform',
      ownerId: 'fraud',
      companyId: booking.companyId,
      bookingRef: booking.bookingRef,
      category: 'Fraud review',
      subject: `Fraud review ${booking.bookingRef}`,
      message: `Risk score ${booking.risk.score}: ${booking.risk.reasons.join(', ') || 'manual review required'}`,
      priority: 'high',
      status: 'open',
      assignedTo: 'fraud-review',
      createdBy: 'fraud-service',
      createdAt: new Date().toISOString(),
      meta: { bookingId: booking.id, risk: booking.risk },
    });
  }
  if (booking.paymentStatus === 'successful') settleBookingPayment(booking.bookingRef);
  return booking;
}

function bookingSearchValues(booking = {}) {
  const passengerValues = (booking.passengers || []).flatMap((passenger) => [
    passenger.id,
    passenger.fullName,
    passenger.email,
    passenger.phone,
    passenger.seatOrRoom,
    passenger.seatNumber,
  ]);
  return [
    booking.id,
    booking._id,
    booking.bookingRef,
    booking.guestLookupCode,
    booking.qrCodeValue,
    booking.paymentRef,
    booking.providerReference,
    booking.paymentReference,
    booking.payment?.reference,
    booking.payment?.providerReference,
    booking.guestSnapshot?.fullName,
    booking.guestSnapshot?.email,
    booking.guestSnapshot?.phone,
    booking.customer?.email,
    booking.customer?.phone,
    ...passengerValues,
  ].filter(Boolean).map((value) => String(value));
}

function findBooking(ref) {
  const key = normalize(ref);
  if (!key) return null;
  return state.bookings.find((booking) => bookingSearchValues(booking).some((value) => normalize(value) === key)) || null;
}

function searchBooking(value, companyId = '') {
  const key = normalize(value);
  if (!key) return null;
  return state.bookings.find((booking) => {
    if (companyId && booking.companyId !== companyId) return false;
    return bookingSearchValues(booking).some((field) => normalize(field).includes(key));
  }) || null;
}

function bookingDetail(booking = {}) {
  if (!booking) return null;
  const listing = findListing(booking.listingId) || {};
  const company = findCompany(booking.companyId) || {};
  const schedule = state.schedules.find((item) => item.id === booking.scheduleId) || {};
  const vehicle = state.vehicles.find((item) => item.id === schedule.vehicleId || item.id === booking.vehicleId) || {};
  const payment = state.payments.find((item) => item.bookingRef === booking.bookingRef || item.bookingId === booking.id) || {};
  const promoter = booking.promoterAttribution?.promoterId ? state.users.find((user) => user.id === booking.promoterAttribution.promoterId) : null;
  return {
    booking: {
      id: booking.id,
      bookingRef: booking.bookingRef,
      guestLookupCode: booking.guestLookupCode || booking.lookupCode || booking.bookingRef,
      qrCodeValue: booking.qrCodeValue,
      serviceType: booking.serviceType,
      bookingStatus: booking.bookingStatus,
      paymentStatus: booking.paymentStatus,
      paymentProvider: booking.paymentProvider || payment.provider || 'Classic Trip Payments',
      paymentRef: booking.paymentRef || payment.providerReference || payment.id || '',
      paymentMethodNote: booking.paymentMethodNote || payment.methodNote || '',
      settlementStatus: booking.settlementStatus || 'pending',
      walletUsed: booking.walletUsed || 0,
      quantity: booking.quantity || booking.passengers?.length || 1,
      passengers: booking.passengers || [],
      seats: (booking.passengers || []).map((pax) => pax.seatOrRoom || pax.seatNumber).filter(Boolean),
      notes: booking.notes || booking.customerNote || '',
      createdAt: booking.createdAt,
      updatedAt: booking.updatedAt,
      cancelledAt: booking.cancelledAt,
      cancelReason: booking.cancelReason || booking.cancellationReason,
      completedAt: booking.completedAt,
    },
    customer: {
      userId: booking.customerUserId || '',
      type: booking.customerUserId ? 'Registered customer' : 'Guest customer',
      name: booking.guestSnapshot?.fullName || booking.passengers?.[0]?.fullName || 'Guest customer',
      email: booking.guestSnapshot?.email || '',
      phone: booking.guestSnapshot?.phone || '',
    },
    company: {
      id: company.id || booking.companyId,
      name: company.name || 'Company partner',
      slug: company.slug || '',
      email: company.email || company.supportEmail || '',
      phone: company.phone || company.supportPhone || '',
      status: company.status || company.verificationStatus || '',
    },
    service: {
      listingId: listing.id || booking.listingId,
      catalogId: listing.catalogId || listing.id || '',
      name: listing.title || booking.serviceType || '',
      type: listing.serviceType || booking.serviceType || '',
      from: listing.from || schedule.origin || '',
      to: listing.to || schedule.destination || '',
      address: listing.address || listing.location || '',
      vehicleName: vehicle.name || schedule.vehicleName || '',
      tripId: schedule.id || booking.scheduleId || '',
      departure: schedule.departAt || listing.departure || '',
      arrival: schedule.arriveAt || listing.arrival || '',
    },
    payment: {
      id: payment.id || booking.paymentRef || '',
      provider: payment.provider || booking.paymentProvider || 'Classic Trip Payments',
      reference: payment.providerReference || booking.paymentRef || '',
      amount: payment.amount || booking.pricing?.total || 0,
      currency: payment.currency || booking.pricing?.currency || 'UGX',
      status: payment.status || booking.paymentStatus || '',
      paidAt: payment.paidAt || booking.paidAt || '',
      failureReason: payment.failureReason || '',
      checkoutUrl: payment.checkoutUrl || '',
    },
    split: {
      referralCode: booking.promoterAttribution?.code || '',
      promoterName: promoter?.fullName || '',
      promoterEmail: promoter?.email || '',
      referralPercent: booking.pricing?.split?.promoterPercent || booking.referralPercent || '',
      grossAmount: booking.pricing?.total || 0,
      subtotal: booking.pricing?.subtotal || 0,
      platformAmount: booking.pricing?.split?.platformFee || 0,
      promoterAmount: booking.pricing?.split?.promoterAmount || 0,
      ownerAmount: booking.pricing?.split?.companyAmount || 0,
      currency: booking.pricing?.currency || 'UGX',
      settlementStatus: booking.settlementStatus || 'pending',
    },
    checkIn: {
      status: booking.checkInStatus || (booking.bookingStatus === 'checked_in' ? 'checked_in' : 'not_checked'),
      checkedInAt: booking.checkedInAt || '',
      checkedInBy: booking.checkedInBy || booking.checkedInByUserId || '',
      note: booking.checkInNote || '',
      noShowAt: booking.noShowAt || '',
      noShowBy: booking.noShowBy || '',
    },
  };
}


function valueOrDash(value) {
  if (value === undefined || value === null || value === '') return '-';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '-';
  return value;
}

function dashboardMeta(entity, id, label, status, detail = {}, actions = []) {
  return { entity, id: id || label || entity, label: label || id || entity, status: status || '', detail, actions };
}

function companyDetail(company = {}) {
  if (!company) return null;
  const listings = listingsForCompany(company.id || '');
  const companyBookings = state.bookings.filter((booking) => booking.companyId === company.id);
  const grossRevenue = companyBookings.reduce((total, booking) => total + Number(booking.pricing?.total || 0), 0);
  const ownerEarnings = companyBookings.reduce((total, booking) => total + Number(booking.pricing?.split?.companyAmount || 0), 0);
  const pendingPayout = state.wallets.find((wallet) => wallet.ownerType === 'company' && wallet.ownerId === company.id)?.pendingBalance || 0;
  const adminUser = state.users.find((user) => user.companyId === company.id && ['company_admin', 'partner'].includes(user.role)) || {};
  return {
    main: {
      companyId: company.id,
      name: company.name,
      slug: company.slug,
      businessType: company.companyType || company.type,
      status: company.status || company.verificationStatus,
      verificationStatus: company.verificationStatus,
      country: company.country,
      city: company.city,
      currency: company.settings?.defaultCurrency || company.currency || 'UGX',
    },
    admin: {
      userId: adminUser.id || company.adminUserId || '',
      name: adminUser.fullName || company.adminName || '',
      email: adminUser.email || company.email || company.supportContacts?.email || '',
      phone: adminUser.phone || company.phone || company.supportContacts?.phone || '',
      role: adminUser.role || 'company_admin',
    },
    contact: {
      supportEmail: company.supportContacts?.email || company.email || '',
      supportPhone: company.supportContacts?.phone || company.phone || '',
      whatsapp: company.supportContacts?.whatsapp || '',
      supportMessage: company.settings?.supportMessage || company.supportMessage || '',
    },
    onboarding: {
      source: company.onboardingSource || 'dashboard',
      invitedBy: company.invitedBy || '',
      invitedAt: company.invitedAt || '',
      onboardedAt: company.onboardedAt || company.createdAt || '',
      reviewedBy: company.reviewedBy || '',
      reviewedAt: company.reviewedAt || '',
      reviewNotes: company.reviewNotes || '',
    },
    performance: {
      totalListings: listings.length,
      activeListings: listings.filter((listing) => listing.status === 'active').length,
      totalBookings: companyBookings.length,
      confirmedBookings: companyBookings.filter((booking) => ['confirmed', 'checked_in', 'completed'].includes(booking.bookingStatus)).length,
      revenue: moneyValue(grossRevenue),
      ownerEarnings: moneyValue(ownerEarnings),
      pendingPayout: moneyValue(pendingPayout),
    },
    payout: {
      payoutAccount: company.payoutAccount || company.settings?.payoutAccount || '',
      walletId: company.walletId || '',
    },
    timestamps: {
      createdAt: company.createdAt,
      updatedAt: company.updatedAt,
    },
  };
}

function listingDetail(listing = {}) {
  if (!listing) return null;
  const company = findCompany(listing.companyId) || {};
  const routes = routesForListing(listing.id);
  const schedules = schedulesForListing(listing.id);
  const rooms = roomsForListing(listing.id);
  const scheduleSeats = schedules.flatMap((schedule) => seatsForSchedule(schedule.id));
  const bookedSeats = scheduleSeats.filter((seat) => seat.status === 'taken').length;
  const heldSeats = scheduleSeats.filter((seat) => seat.status === 'locked').length;
  const totalSeats = scheduleSeats.length || schedules.reduce((total, schedule) => total + Number(schedule.totalSeats || 0), 0);
  return {
    listing: {
      catalogId: listing.catalogId || listing.id,
      listingId: listing.id,
      slug: listing.slug,
      title: listing.title,
      serviceType: listing.serviceType,
      type: listing.type,
      status: listing.status,
      releaseStatus: listing.releaseStatus || '',
      isSponsored: Boolean(listing.isSponsored),
      bookable: Boolean(listing.bookable),
    },
    owner: {
      companyId: company.id || listing.companyId,
      companyName: company.name || listing.partner,
      tenantSlug: company.slug || listing.tenantSlug || '',
      country: company.country || listing.country,
      currency: listing.currency || company.settings?.defaultCurrency || 'UGX',
    },
    service: {
      from: listing.from || '',
      to: listing.to || '',
      address: listing.address || listing.location || '',
      city: listing.city || '',
      country: listing.country || '',
      routeDetails: routes.map((route) => `${route.origin} to ${route.destination}`).join('; '),
      vehicleDetails: state.vehicles.filter((vehicle) => vehicle.listingId === listing.id).map((vehicle) => `${vehicle.name} (${vehicle.plateOrCode || 'no plate'})`).join('; '),
      departure: schedules[0]?.departAt || listing.departure || '',
      arrival: schedules[0]?.arriveAt || listing.arrival || '',
    },
    inventory: {
      basePrice: listing.priceFrom,
      price: moneyValue(listing.priceFrom, listing.currency),
      currency: listing.currency,
      totalSeats,
      bookedSeats,
      heldSeats,
      remainingSeats: Math.max(0, totalSeats - bookedSeats - heldSeats),
      roomTypes: rooms.length,
      roomInventory: rooms.reduce((total, room) => total + Number(room.inventory || 0), 0),
      schedules: schedules.length,
    },
    timestamps: { createdAt: listing.createdAt, updatedAt: listing.updatedAt },
  };
}

function paymentDetail(booking = {}, payment = {}) {
  const detail = bookingDetail(booking) || {};
  return {
    payment: {
      paymentId: payment.id || booking.paymentRef || booking.bookingRef,
      bookingId: booking.id,
      bookingRef: booking.bookingRef,
      provider: payment.provider || booking.paymentProvider || 'Classic Trip Payments',
      providerReference: payment.providerReference || booking.paymentRef || '',
      amount: payment.amount || booking.pricing?.total || 0,
      formattedAmount: moneyValue(payment.amount || booking.pricing?.total || 0, payment.currency || booking.pricing?.currency || 'UGX'),
      currency: payment.currency || booking.pricing?.currency || 'UGX',
      status: payment.status || booking.paymentStatus,
      paidAt: payment.paidAt || booking.paidAt || '',
      failureReason: payment.failureReason || '',
      checkoutUrl: payment.checkoutUrl || '',
      methodNote: payment.methodNote || booking.paymentMethodNote || '',
      metadata: payment.rawPayload || payment.metadata || {},
    },
    booking: detail.booking,
    customer: detail.customer,
    company: detail.company,
    split: detail.split,
    timestamps: { createdAt: payment.createdAt || booking.createdAt, updatedAt: payment.updatedAt || booking.updatedAt },
  };
}

function promoterDetail(user = {}) {
  const links = state.promoterLinks.filter((link) => link.promoterId === user.id);
  const referred = state.bookings.filter((booking) => booking.promoterAttribution?.promoterId === user.id);
  const gross = referred.reduce((total, booking) => total + Number(booking.pricing?.total || 0), 0);
  const commission = referred.reduce((total, booking) => total + Number(booking.pricing?.split?.promoterAmount || 0), 0);
  const wallet = state.wallets.find((item) => item.ownerType === 'promoter' && item.ownerId === user.id) || {};
  return {
    promoter: {
      userId: user.id,
      name: user.fullName,
      email: user.email,
      phone: user.phone,
      referralCode: links[0]?.code || user.referralCode || '',
      status: user.status || 'active',
    },
    performance: {
      totalReferredBookings: referred.length,
      confirmedReferredBookings: referred.filter((booking) => ['confirmed', 'checked_in', 'completed'].includes(booking.bookingStatus)).length,
      cancelledOrRefunded: referred.filter((booking) => /cancel|refund/.test(normalize(booking.bookingStatus))).length,
      grossReferredRevenue: moneyValue(gross),
      commissionEarned: moneyValue(commission),
      conversionRate: links.reduce((total, link) => total + Number(link.clicks || 0), 0) ? `${Math.round((links.reduce((total, link) => total + Number(link.conversions || 0), 0) / links.reduce((total, link) => total + Number(link.clicks || 0), 0)) * 100)}%` : '0%',
    },
    wallet: {
      availableBalance: moneyValue(wallet.availableBalance || 0, wallet.currency || 'UGX'),
      pendingBalance: moneyValue(wallet.pendingBalance || 0, wallet.currency || 'UGX'),
      paidWithdrawals: moneyValue(state.walletTransactions.filter((txn) => txn.ownerType === 'promoter' && txn.ownerId === user.id && txn.status === 'paid').reduce((total, txn) => total + Number(txn.amount || 0), 0), wallet.currency || 'UGX'),
      pendingWithdrawals: moneyValue(state.walletTransactions.filter((txn) => txn.ownerType === 'promoter' && txn.ownerId === user.id && txn.status !== 'paid').reduce((total, txn) => total + Number(txn.amount || 0), 0), wallet.currency || 'UGX'),
    },
    recentBookings: referred.slice(0, 5).map((booking) => booking.bookingRef),
    timestamps: { createdAt: user.createdAt, updatedAt: user.updatedAt },
  };
}

function customerDetail(user = {}) {
  const userBookings = state.bookings.filter((booking) => booking.customerUserId === user.id || normalize(booking.guestSnapshot?.email) === normalize(user.email) || normalize(booking.guestSnapshot?.phone) === normalize(user.phone));
  const totalSpend = userBookings.reduce((total, booking) => total + Number(booking.pricing?.total || 0), 0);
  const wallet = state.wallets.find((item) => item.ownerType === 'customer' && item.ownerId === user.id) || {};
  const lastBooking = userBookings[0] || {};
  return {
    customer: { userId: user.id, name: user.fullName, email: user.email, phone: user.phone, status: user.status || 'active', role: user.role },
    bookingSummary: {
      totalBookings: userBookings.length,
      confirmedBookings: userBookings.filter((booking) => ['confirmed', 'checked_in', 'completed'].includes(booking.bookingStatus)).length,
      cancelledOrRefunded: userBookings.filter((booking) => /cancel|refund/.test(normalize(booking.bookingStatus))).length,
      totalSpend: moneyValue(totalSpend),
      lastBooking: lastBooking.bookingRef || '',
      lastTravelDate: lastBooking.createdAt || '',
      guestBookingsMatched: userBookings.filter((booking) => !booking.customerUserId).length,
    },
    wallet: { balance: moneyValue(wallet.availableBalance || 0, wallet.currency || 'UGX'), walletId: wallet.id || '' },
    notes: { adminNote: user.adminNote || user.note || '' },
    timestamps: { createdAt: user.createdAt, updatedAt: user.updatedAt },
  };
}

function supportDetail(ticket = {}) {
  const booking = ticket.bookingRef ? findBooking(ticket.bookingRef) : null;
  return {
    case: {
      supportCaseId: ticket.id,
      subject: ticket.subject,
      category: ticket.category || ticket.ownerType,
      message: ticket.message,
      priority: ticket.priority,
      status: ticket.status,
      assignedAdmin: ticket.assignedTo || '',
      resolutionNotes: ticket.resolutionNotes || ticket.lastResponse || '',
    },
    requester: { ownerType: ticket.ownerType, ownerId: ticket.ownerId, email: ticket.email || '', phone: ticket.phone || '', audience: ticket.audience || '' },
    related: { bookingRef: booking?.bookingRef || ticket.bookingRef || '', paymentStatus: booking?.paymentStatus || '', company: booking ? bookingCompany(booking) : ticket.companyId || '' },
    timestamps: { createdAt: ticket.createdAt, updatedAt: ticket.updatedAt, respondedAt: ticket.respondedAt },
  };
}

function campaignDetail(campaign = {}) {
  const listing = findListing(campaign.listingId) || {};
  const company = findCompany(campaign.companyId) || {};
  return {
    campaign: {
      promotionId: campaign.id,
      title: campaign.name || campaign.title,
      type: campaign.placement || campaign.type,
      status: campaign.status,
      startDate: campaign.startDate,
      endDate: campaign.endDate,
      budget: moneyValue(campaign.budget || 0),
      spend: moneyValue(campaign.spend || 0),
      clicks: campaign.clicks || 0,
      views: campaign.views || 0,
      conversions: campaign.bookings || campaign.conversions || 0,
    },
    owner: { companyId: company.id || campaign.companyId, companyName: company.name || '', promoterId: campaign.promoterId || '' },
    target: { listingId: listing.id || campaign.listingId, listingTitle: listing.title || '' },
    timestamps: { createdAt: campaign.createdAt, updatedAt: campaign.updatedAt },
  };
}

function refundDetail(refund = {}) {
  const booking = findBooking(refund.bookingRef) || {};
  const detail = bookingDetail(booking) || {};
  return {
    refund: {
      id: refund.id,
      bookingRef: refund.bookingRef,
      reason: refund.reason,
      amount: moneyValue(refund.amount || detail.payment?.amount || 0, detail.payment?.currency || 'UGX'),
      status: refund.status,
      requestedAt: refund.createdAt,
      reviewedBy: refund.reviewedBy || '',
      reviewedAt: refund.reviewedAt || '',
      rejectionReason: refund.rejectionReason || '',
    },
    booking: detail.booking,
    customer: detail.customer,
    company: detail.company,
    payment: detail.payment,
  };
}

function notificationDetail(row = {}) {
  return {
    notification: {
      id: row.id,
      title: row.title || row.subject,
      body: row.message || row.body,
      channel: row.channel || (Array.isArray(row.channels) ? row.channels.join(', ') : ''),
      audience: row.audience || row.ownerType,
      deliveryStatus: row.deliveryStatus || row.status,
      createdBy: row.createdBy || row.actorId || '',
    },
    timestamps: { createdAt: row.createdAt, updatedAt: row.updatedAt },
  };
}

function auditDetail(log = {}) {
  return {
    audit: {
      auditId: log.id,
      actorUserId: log.actorId,
      actorName: log.actorName || '',
      actorEmail: log.actorEmail || '',
      actorRole: log.actorRole || '',
      action: log.action,
      entityType: log.entityType || log.targetType || '',
      entityId: log.entityId || log.target || '',
      beforeSummary: log.beforeSummary || log.before || '',
      afterSummary: log.afterSummary || log.after || '',
      ip: log.ip || log.ipAddress || '',
      userAgent: log.userAgent || '',
      status: log.status || 'success',
    },
    timestamps: { createdAt: log.createdAt, updatedAt: log.updatedAt },
  };
}

function adminUserDetail(user = {}) {
  return {
    admin: {
      adminId: user.id,
      name: user.fullName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status || 'active',
      permissionsLabel: user.permissionsLabel || (Array.isArray(user.permissions) ? user.permissions.join(', ') : 'Role based'),
      lastActivity: user.lastLoginAt || user.updatedAt || '',
    },
    timestamps: { createdAt: user.createdAt, updatedAt: user.updatedAt },
  };
}

function checkInBlockReason(booking = {}) {
  if (!booking) return 'Booking was not found';
  if (booking.paymentStatus !== 'successful') return 'Ticket payment is not confirmed';
  if (['cancelled', 'refunded', 'voided'].includes(booking.bookingStatus)) return `Ticket is ${booking.bookingStatus}`;
  if (booking.bookingStatus === 'checked_in' || booking.checkInStatus === 'checked_in') return 'Ticket is already checked in';
  if (booking.bookingStatus === 'completed') return 'Trip or service is already completed';
  if (booking.bookingStatus === 'no_show') return 'Ticket is marked as no-show';
  return '';
}

function lookupTicket(value, companyId = '', context = {}) {
  const booking = searchBooking(value, companyId);
  if (!booking) return { ok: false, result: 'not_found', message: 'Ticket not found' };
  const reason = checkInBlockReason(booking);
  return {
    ok: !reason,
    result: reason ? 'blocked' : 'ready',
    message: reason || 'Ticket found and ready for check-in',
    canCheckIn: !reason,
    disabledReason: reason,
    booking,
    listing: findListing(booking.listingId),
    detail: bookingDetail(booking),
  };
}

function validateTicket(qrCodeValue, employeeId = 'employee-system', companyId = '', context = {}) {
  const booking = searchBooking(qrCodeValue, companyId);
  if (!booking) return { ok: false, result: 'not_found', message: 'Ticket not found' };
  const reason = checkInBlockReason(booking);
  if (reason) {
    let result = 'not_valid_for_checkin';
    if (booking.paymentStatus !== 'successful') result = 'payment_not_successful';
    if (booking.bookingStatus === 'checked_in' || booking.checkInStatus === 'checked_in' || booking.bookingStatus === 'completed') result = 'already_used';
    return { ok: false, result, booking, listing: findListing(booking.listingId), detail: bookingDetail(booking), message: reason, canCheckIn: false, disabledReason: reason };
  }
  booking.bookingStatus = 'checked_in';
  booking.checkInStatus = 'checked_in';
  booking.checkedInAt = new Date().toISOString();
  booking.checkedInBy = employeeId;
  booking.checkedInByUserId = employeeId;
  state.auditLogs.push({
    id: `audit-${state.auditLogs.length + 1}`,
    actorId: employeeId,
    actorRole: context.actorRole || 'company_employee',
    actorName: context.actorName || '',
    actorEmail: context.actorEmail || '',
    action: 'ticket.checked_in',
    target: booking.bookingRef,
    entityType: 'booking',
    entityId: booking.id,
    beforeSummary: 'Ticket was eligible for check-in',
    afterSummary: 'Ticket marked checked_in and earnings release triggered',
    ip: context.ip || '',
    userAgent: context.userAgent || '',
    status: 'success',
    createdAt: new Date().toISOString()
  });
  return { ok: true, result: 'validated', booking, listing: findListing(booking.listingId), detail: bookingDetail(booking), message: 'Ticket validated and checked in', canCheckIn: false, disabledReason: 'Ticket is already checked in' };
}

function markNoShow(value, employeeId = 'employee-system', companyId = '', note = '', context = {}) {
  const booking = searchBooking(value, companyId);
  if (!booking) return { ok: false, result: 'not_found', message: 'Ticket not found' };
  if (['cancelled', 'refunded', 'voided', 'checked_in', 'completed'].includes(booking.bookingStatus)) {
    return { ok: false, result: 'not_valid_for_no_show', booking, detail: bookingDetail(booking), message: `Cannot mark ${booking.bookingStatus} booking as no-show` };
  }
  booking.bookingStatus = 'no_show';
  booking.checkInStatus = 'no_show';
  booking.noShowAt = new Date().toISOString();
  booking.noShowBy = employeeId;
  booking.noShowByUserId = employeeId;
  booking.checkInNote = note || booking.checkInNote || 'Marked no-show from employee dashboard';
  state.auditLogs.push({
    id: `audit-${state.auditLogs.length + 1}`,
    actorId: employeeId,
    actorRole: context.actorRole || 'company_employee',
    actorName: context.actorName || '',
    actorEmail: context.actorEmail || '',
    action: 'ticket.no_show',
    target: booking.bookingRef,
    entityType: 'booking',
    entityId: booking.id,
    beforeSummary: 'Ticket was not checked in',
    afterSummary: `Ticket marked no_show${note ? `: ${note}` : ''}`,
    ip: context.ip || '',
    userAgent: context.userAgent || '',
    status: 'success',
    createdAt: new Date().toISOString()
  });
  return { ok: true, result: 'no_show', booking, listing: findListing(booking.listingId), detail: bookingDetail(booking), message: 'Booking marked as no-show' };
}

module.exports = {
  state,
  hydrateFromDatabase,
  homeBootstrap,
  frontendListing,
  publicCompany,
  publicRoute,
  frontendBooking,
  publicPromoterLink,
  publicCampaign,
  buildListingCatalog,
  marketplaceInfo,
  listingPreview,
  dashboardData,
  serviceStats,
  corridorStats,
  searchListings,
  findListing,
  findCompany,
  listingsForCompany,
  routesForListing,
  schedulesForListing,
  roomsForListing,
  seatsForSchedule,
  getAvailability,
  findUserByIdentity,
  upsertUser,
  recordReferralClick,
  settleBookingPayment,
  createBooking,
  findBooking,
  searchBooking,
  lookupTicket,
  bookingDetail,
  validateTicket,
  markNoShow,
};
