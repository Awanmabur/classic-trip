const crypto = require('crypto');
const generateBookingRef = require('../../utils/generateBookingRef');
const calculateCommission = require('../../utils/calculateCommission');
const { addMinutes } = require('../../utils/dates');
const { ENABLED_BOOKING_TYPES } = require('../../config/constants');
const toSlug = require('../../utils/slugify');
const repositories = require('../../repositories');

function emptyProductionState() {
  return {
    categories: [],
    users: [],
    companies: [],
    listings: [],
    partnerLeads: [],
    discoverySessions: [],
    agreements: [],
    invitations: [],
    verificationReviews: [],
    routes: [],
    vehicles: [],
    schedules: [],
    seats: [],
    rooms: [],
    hotelProperties: [],
    roomTypes: [],
    roomUnits: [],
    roomNightInventories: [],
    stayRules: [],
    companyEmployees: [],
    companyBranches: [],
    companyPolicies: [],
    driverAssignments: [],
    driverIncidents: [],
    tripStatusUpdates: [],
    routeStops: [],
    carts: [],
    cartCheckoutAttempts: [],
    bookings: [],
    passengers: [],
    payments: [],
    correspondenceMessages: [],
    bookingTimelineEvents: [],
    notificationDeliveryAttempts: [],
    rescheduleRequests: [],
    wallets: [],
    walletTransactions: [],
    paymentIntents: [],
    paymentWebhookEvents: [],
    receiptInvoices: [],
    taxFeeRecords: [],
    financeStatements: [],
    financeRiskReviews: [],
    settlementBatches: [],
    payoutRequests: [],
    payoutBatches: [],
    reconciliationReports: [],
    promoterLinks: [],
    referralClicks: [],
    attributionSessions: [],
    campaignConversions: [],
    agentProfiles: [],
    offlineSales: [],
    fraudSignals: [],
    commissions: [],
    blogs: [],
    reviews: [],
    notifications: [],
    supportTickets: [],
    refundRequests: [],
    promotionCampaigns: [],
    auditLogs: [],
    securityEvents: [],
    loginAudits: [],
    deviceSessions: [],
    idempotencyKeyRecords: [],
    savedListings: [],
    shiftHandovers: [],
    subscriptionOrders: [],
    subscriptions: [],
    inventoryHolds: [],
    ticketScans: [],
    futureServiceModules: [],
    flightOffers: [],
    trainInventories: [],
    tourPackageInventories: [],
    carRentalUnits: [],
    eventTicketInventories: [],
    cargoShipments: [],
    insurancePolicyRecords: [],
    corporateTravelAccounts: [],
    loyaltyAccounts: [],
    settings: [],
    platformSettings: {},
    notificationTemplates: [],
  };
}

const state = emptyProductionState();

function isPersistentArray(value) {
  return Array.isArray(value) && value.__persistentArray === true;
}

function wrapPersistentArray(stateKey) {
  const current = state[stateKey];
  if (!Array.isArray(current) || isPersistentArray(current)) return;
  const repoName = stateKey;
  const proxy = new Proxy(current, {
    get(target, prop, receiver) {
      if (prop === '__persistentArray') return true;
      if (['push', 'unshift'].includes(prop)) {
        return (...items) => {
          const result = Array.prototype[prop].apply(target, items);
          persistRows(repoName, items);
          return result;
        };
      }
      if (prop === 'splice') {
        return (start, deleteCount, ...items) => {
          const result = Array.prototype.splice.call(target, start, deleteCount, ...items);
          persistRows(repoName, items);
          return result;
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  state[stateKey] = proxy;
}

function enableAutoPersistence() {
  Object.keys(state).forEach(wrapPersistentArray);
}

enableAutoPersistence();

function loadSeedReadModel({ force = false } = {}) {
  if (!force && Array.isArray(state.listings) && state.listings.length && Array.isArray(state.users) && state.users.length) {
    return { loaded: false, reason: 'already_loaded' };
  }
  let seedData = null;
  try {
    ({ buildSeedData: seedData } = require('../../seeds/seedAll'));
  } catch (error) {
    return { loaded: false, reason: error.message };
  }
  const data = typeof seedData === 'function' ? seedData() : null;
  if (!data || typeof data !== 'object') return { loaded: false, reason: 'seed_data_unavailable' };
  Object.keys(emptyProductionState()).forEach((key) => {
    if (Array.isArray(data[key])) {
      state[key] = data[key].map((row) => ({ ...row }));
    } else if (key === 'platformSettings' && data.platformSettings) {
      state[key] = { ...data.platformSettings };
    } else if (force) {
      state[key] = Array.isArray(state[key]) ? [] : {};
    }
  });
  normalizeHydratedState();
  enableAutoPersistence();
  return {
    loaded: true,
    records: Object.values(data).reduce((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0),
  };
}

const DATABASE_MODELS = {
  users: 'User',
  companies: 'Company',
  categories: 'ServiceCategory',
  listings: 'Listing',
  partnerLeads: 'PartnerLead',
  discoverySessions: 'DiscoverySession',
  agreements: 'Agreement',
  invitations: 'Invitation',
  verificationReviews: 'VerificationReview',
  routes: 'Route',
  vehicles: 'Vehicle',
  schedules: 'TripSchedule',
  seats: 'Seat',
  rooms: 'Room',
  hotelProperties: 'HotelProperty',
  roomTypes: 'RoomType',
  roomUnits: 'RoomUnit',
  roomNightInventories: 'RoomNightInventory',
  stayRules: 'StayRule',
  companyEmployees: 'CompanyEmployee',
  companyBranches: 'CompanyBranch',
  companyPolicies: 'CompanyPolicy',
  driverAssignments: 'DriverAssignment',
  driverIncidents: 'DriverIncident',
  tripStatusUpdates: 'TripStatusUpdate',
  routeStops: 'RouteStop',
  carts: 'Cart',
  cartCheckoutAttempts: 'CartCheckoutAttempt',
  bookings: 'Booking',
  passengers: 'Passenger',
  payments: 'Payment',
  correspondenceMessages: 'CorrespondenceMessage',
  bookingTimelineEvents: 'BookingTimelineEvent',
  notificationDeliveryAttempts: 'NotificationDeliveryAttempt',
  rescheduleRequests: 'RescheduleRequest',
  wallets: 'Wallet',
  walletTransactions: 'WalletTransaction',
  paymentIntents: 'PaymentIntent',
  paymentWebhookEvents: 'PaymentWebhookEvent',
  receiptInvoices: 'ReceiptInvoice',
  taxFeeRecords: 'TaxFeeRecord',
  financeStatements: 'FinanceStatement',
  financeRiskReviews: 'FinanceRiskReview',
  settlementBatches: 'SettlementBatch',
  payoutRequests: 'PayoutRequest',
  payoutBatches: 'PayoutBatch',
  reconciliationReports: 'ReconciliationReport',
  promoterLinks: 'PromoterLink',
  referralClicks: 'ReferralClick',
  attributionSessions: 'AttributionSession',
  campaignConversions: 'CampaignConversion',
  agentProfiles: 'AgentProfile',
  offlineSales: 'OfflineSale',
  fraudSignals: 'FraudSignal',
  commissions: 'Commission',
  blogs: 'BlogPost',
  supportTickets: 'SupportTicket',
  refundRequests: 'RefundRequest',
  promotionCampaigns: 'PromotionCampaign',
  reviews: 'Review',
  auditLogs: 'AuditLog',
  securityEvents: 'SecurityEvent',
  loginAudits: 'LoginAudit',
  deviceSessions: 'DeviceSession',
  idempotencyKeyRecords: 'IdempotencyKeyRecord',
  notifications: 'Notification',
  savedListings: 'SavedListing',
  shiftHandovers: 'ShiftHandover',
  subscriptionOrders: 'SubscriptionOrder',
  subscriptions: 'Subscription',
  inventoryHolds: 'InventoryHold',
  ticketScans: 'TicketScan',
  futureServiceModules: 'FutureServiceModule',
  flightOffers: 'FlightOffer',
  trainInventories: 'TrainInventory',
  tourPackageInventories: 'TourPackageInventory',
  carRentalUnits: 'CarRentalUnit',
  eventTicketInventories: 'EventTicketInventory',
  cargoShipments: 'CargoShipment',
  insurancePolicyRecords: 'InsurancePolicyRecord',
  corporateTravelAccounts: 'CorporateTravelAccount',
  loyaltyAccounts: 'LoyaltyAccount',
  settings: 'Setting',
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

if (process.env.NODE_ENV === 'test' || ['true', '1', 'yes'].includes(String(process.env.SEED_READ_MODEL || '').toLowerCase())) {
  loadSeedReadModel({ force: true });
}
const ROUTED_SERVICE_TYPES = ['bus', 'flight', 'train', 'ferry', 'tour', 'airport_transfer', 'package', 'cargo'];
const COMPANY_COMMON_DASHBOARD_PAGES = ['overview', 'company-profile', 'staff', 'listings', 'bookings', 'reviews', 'support', 'revenue', 'settlement', 'reports'];

const COMPANY_SERVICE_PAGE_MAP = {
  bus: ['overview', 'company-profile', 'staff', 'listings', 'routes', 'vehicles', 'seat-maps', 'schedules', 'bookings', 'manifests', 'checkins', 'reviews', 'support', 'revenue', 'settlement', 'reports'],
  hotel: ['overview', 'company-profile', 'staff', 'listings', 'hotel-rooms', 'bookings', 'manifests', 'checkins', 'reviews', 'support', 'revenue', 'settlement', 'reports'],
  flight: ['overview', 'company-profile', 'staff', 'listings', 'routes', 'vehicles', 'seat-maps', 'schedules', 'bookings', 'manifests', 'checkins', 'reviews', 'support', 'revenue', 'settlement', 'reports'],
  train: ['overview', 'company-profile', 'staff', 'listings', 'routes', 'vehicles', 'seat-maps', 'schedules', 'bookings', 'manifests', 'checkins', 'reviews', 'support', 'revenue', 'settlement', 'reports'],
  tour: ['overview', 'company-profile', 'staff', 'listings', 'schedules', 'bookings', 'manifests', 'checkins', 'reviews', 'support', 'revenue', 'settlement', 'reports'],
  car_rental: ['overview', 'company-profile', 'staff', 'listings', 'vehicles', 'schedules', 'bookings', 'manifests', 'checkins', 'reviews', 'support', 'revenue', 'settlement', 'reports'],
  event: ['overview', 'company-profile', 'staff', 'listings', 'seat-maps', 'schedules', 'bookings', 'manifests', 'checkins', 'reviews', 'support', 'revenue', 'settlement', 'reports'],
  cargo: ['overview', 'company-profile', 'staff', 'listings', 'routes', 'vehicles', 'schedules', 'bookings', 'manifests', 'checkins', 'support', 'revenue', 'settlement', 'reports'],
  insurance: ['overview', 'company-profile', 'staff', 'listings', 'bookings', 'reviews', 'support', 'revenue', 'settlement', 'reports'],
  corporate: ['overview', 'company-profile', 'staff', 'listings', 'bookings', 'support', 'revenue', 'settlement', 'reports'],
  loyalty: ['overview', 'company-profile', 'staff', 'listings', 'bookings', 'support', 'revenue', 'settlement', 'reports'],
  partner: COMPANY_COMMON_DASHBOARD_PAGES,
};

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
  return Array.from({ length: Math.max(0, Math.round(Number(totalSeats || 0))) }, (_, index) => String(index + 1));
}

function ensureBookableInventory() {
  if (!Array.isArray(state.vehicles)) state.vehicles = [];
  if (!Array.isArray(state.routes)) state.routes = [];
  if (!Array.isArray(state.schedules)) state.schedules = [];
  if (!Array.isArray(state.seats)) state.seats = [];
  state.listings.forEach((listing) => {
    if (!listing.bookable) return;
    if (listing.serviceType === 'bus') {
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
          boardingPoints: [`${listing.from || 'Origin'} Central`, `${listing.from || 'Origin'} Office`],
          dropoffPoints: [`${listing.to || 'Destination'} Central`, `${listing.to || 'Destination'} Office`],
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
      state.schedules
        .filter((schedule) => schedule.listingId === listing.id && (!schedule.vehicleId || !schedule.vehicleName))
        .forEach((schedule) => {
          schedule.vehicleId = schedule.vehicleId || assignedVehicle?.id || vehicleId;
          schedule.vehicleName = schedule.vehicleName || assignedVehicle?.name || '';
          schedule.totalSeats = Number(schedule.totalSeats || assignedVehicle?.totalSeats || totalSeats);
          if (!Number.isFinite(Number(schedule.availableSeats))) schedule.availableSeats = schedule.totalSeats;
        });
      if (!state.schedules.some((schedule) => schedule.listingId === listing.id)) {
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
      }
      state.schedules.filter((schedule) => schedule.listingId === listing.id).forEach((schedule) => {
        if (state.seats.some((seat) => seat.scheduleId === schedule.id)) return;
        seatNumbers(Number(schedule.totalSeats || totalSeats)).forEach((seatNumber, index) => {
          state.seats.push({
            id: `auto-seat-${toSlug(schedule.id)}-${seatNumber}`,
            scheduleId: schedule.id,
            seatNumber,
            seatClass: index < 4 ? 'VIP' : 'Standard',
            priceDelta: index < 4 ? 12000 : 0,
            status: takenSeats.includes(seatNumber) ? 'taken' : 'available',
            lockedUntil: null,
          });
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
      documents: Array.isArray(company.documents)
        ? company.documents.map((document) => normalizeMedia(document, document.url || document.secureUrl || '', document.label || document.documentType || 'Company verification document')).filter((document) => document.url || document.publicId)
        : [],
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
      const repository = repositories.repositoryFor(stateKey);
      const rows = await repository.list({});
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
    if (process.env.NODE_ENV === 'test' || ['true', '1', 'yes'].includes(String(process.env.SEED_READ_MODEL || '').toLowerCase())) {
      const seeded = loadSeedReadModel({ force: true });
      logger?.info?.('Database hydration found no records; using seeded test read model', seeded);
      return { source: 'seed_read_model', loadedCollections: 0, loadedRecords: seeded.records || 0 };
    }
    logger?.info?.('Database hydration found no records; using empty Mongo-backed production state');
    return { source: 'empty', loadedCollections: 0, loadedRecords: 0 };
  }

  Object.entries(nextState).forEach(([stateKey, rows]) => {
    state[stateKey] = mergeHydratedRecords(stateKey, rows);
  });
  normalizeHydratedState();
  enableAutoPersistence();
  logger?.info?.('Database hydration completed', { loadedCollections, loadedRecords });
  return { source: 'database', loadedCollections, loadedRecords };
}

let lastRefreshAt = 0;
async function refreshFromDatabase({ mongoose, logger, force = false, minIntervalMs = 5000 } = {}) {
  const now = Date.now();
  if (!force && now - lastRefreshAt < minIntervalMs) {
    return { source: 'cache', loadedCollections: 0, loadedRecords: 0 };
  }
  lastRefreshAt = now;
  return hydrateFromDatabase({ mongoose, logger });
}


function persistRow(entity, row) {
  if (!row || !repositories.mongoReady || !repositories.mongoReady()) return;
  const repo = repositories[entity];
  if (!repo || typeof repo.upsert !== 'function') return;
  repo.upsert(row).catch(() => {});
}

function persistRows(entity, rows = []) {
  if (!Array.isArray(rows) || !rows.length || !repositories.mongoReady || !repositories.mongoReady()) return;
  const repo = repositories[entity];
  if (!repo || typeof repo.upsertMany !== 'function') return;
  repo.upsertMany(rows).catch(() => {});
}

function persistBookingGraph(booking = {}) {
  persistRow('bookings', booking);
  if (booking.passengers?.length) {
    persistRows('passengers', booking.passengers.map((passenger, index) => ({
      ...passenger,
      id: passenger.id || `${booking.id}-passenger-${index + 1}`,
      bookingId: booking.id,
      bookingRef: booking.bookingRef,
      companyId: booking.companyId,
      listingId: booking.listingId,
      scheduleId: booking.scheduleId,
      passengerIndex: index,
    })));
  }
  persistRows('seats', (booking.bookingItems || [])
    .filter((item) => item.scheduleId && item.seatNumber)
    .map((item) => ({ scheduleId: item.scheduleId, seatNumber: item.seatNumber, status: 'taken', lockedUntil: null, lockId: null })));
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
  if (role === 'driver') return employeeDashboardData(companyId, companyBookings, { ...context, driverMode: true });
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
  const leadRows = (state.partnerLeads || []).map((lead) => [
    lead.businessName || lead.name || '-',
    lead.leadType || lead.companyType || 'company',
    lead.contactName || '-',
    lead.email || lead.phone || '-',
    lead.sourceChannel || 'manual',
    lead.status || 'new',
    dashboardMeta('partner_lead', lead.id, lead.businessName || lead.id, lead.status || 'new', { lead }, ['view', 'session', 'agreement', 'invite']),
  ]);
  const sessionRows = (state.discoverySessions || []).map((session) => {
    const lead = (state.partnerLeads || []).find((row) => row.id === session.leadId) || {};
    return [
      session.providerName || lead.businessName || session.leadId || '-',
      session.sessionType || 'Discovery call',
      session.scheduledAt ? dateValue(session.scheduledAt) : '-',
      Array.isArray(session.attendees) ? session.attendees.join(', ') : (session.attendees || '-'),
      session.agreedNextAction || session.notes || '-',
      session.status || 'scheduled',
      dashboardMeta('discovery_session', session.id, session.providerName || lead.businessName || session.id, session.status || 'scheduled', { session, lead }, ['view', 'agreement', 'lead']),
    ];
  });
  const agreementRows = (state.agreements || []).map((agreement) => {
    const lead = (state.partnerLeads || []).find((row) => row.id === agreement.leadId) || {};
    return [
      agreement.partnerName || lead.businessName || '-',
      agreement.agreementType || lead.leadType || 'company',
      agreement.commissionModel || '-',
      agreement.subscriptionPlan || '-',
      agreement.startDate ? dateValue(agreement.startDate) : '-',
      agreement.status || 'draft',
      dashboardMeta('agreement', agreement.id, agreement.partnerName || lead.businessName || agreement.id, agreement.status || 'draft', { agreement, lead }, ['view', 'approve', 'reject', 'invite']),
    ];
  });

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

  const routeRows = state.routes.slice(0, 120).map((route) => {
    const listing = findListing(route.listingId) || {};
    const company = findCompany(route.companyId || listing.companyId) || {};
    const schedules = state.schedules.filter((schedule) => schedule.routeId === route.id || schedule.listingId === route.listingId);
    const stops = [route.boardingPoints, route.dropoffPoints].flat().filter(Boolean).length
      || (Array.isArray(state.routeStops) ? state.routeStops.filter((stop) => stop.routeId === route.id).length : 0);
    const label = route.routeName || `${route.origin || listing.from || '-'} to ${route.destination || listing.to || '-'}`;
    return [
      label,
      listing.title || route.listingId || '-',
      company.name || listing.partner || '-',
      `${stops} stops`,
      `${schedules.length} schedules`,
      route.status || listing.status || 'active',
      dashboardMeta('route', route.id, label, route.status || listing.status || 'active', { route, listing: listingDetail(listing), company: companyDetail(company) }, ['view', 'listings', 'schedules', 'open']),
    ];
  });

  const vehicleRows = (state.vehicles || []).slice(0, 120).map((vehicle) => {
    const company = findCompany(vehicle.companyId) || {};
    const listing = findListing(vehicle.listingId) || {};
    return [
      vehicle.name || vehicle.vehicleName || vehicle.id,
      company.name || listing.partner || vehicle.companyId || '-',
      SERVICE_LABELS[vehicle.serviceType] || vehicle.serviceType || listing.serviceType || 'Vehicle',
      vehicle.plateOrCode || vehicle.registrationNumber || vehicle.code || '-',
      `${vehicle.totalSeats || vehicle.capacity || 0} seats`,
      vehicle.status || 'active',
      dashboardMeta('vehicle', vehicle.id, vehicle.name || vehicle.id, vehicle.status || 'active', { vehicle, listing: listingDetail(listing), company: companyDetail(company) }, ['view', 'schedules', 'open']),
    ];
  });

  const scheduleRows = (state.schedules || []).slice(0, 160).map((schedule) => {
    const listing = findListing(schedule.listingId) || {};
    const company = findCompany(schedule.companyId || listing.companyId) || {};
    const vehicle = (state.vehicles || []).find((item) => item.id === schedule.vehicleId) || {};
    const label = schedule.id || [dateValue(schedule.departAt), listing.title].filter(Boolean).join(' - ');
    return [
      label,
      listing.title || schedule.routeId || schedule.listingId || '-',
      company.name || listing.partner || '-',
      vehicle.name || schedule.vehicleName || schedule.vehicleId || '-',
      `${schedule.availableSeats ?? '-'} / ${schedule.totalSeats ?? '-'}`,
      schedule.status || 'active',
      dashboardMeta('schedule', schedule.id, label, schedule.status || 'active', scheduleDetail(schedule), ['view', 'manifest', 'seat_map', 'open']),
    ];
  });

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
  const kycRows = state.companies.map((company) => {
    const documents = Array.isArray(company.documents) ? company.documents : [];
    const pendingDocuments = documents.filter((document) => /pending|review/i.test(document.status || 'pending_review')).length;
    const documentLabel = documents.length ? `${documents.length} documents${pendingDocuments ? `, ${pendingDocuments} pending` : ''}` : 'Business profile';
    return [company.name, documentLabel, company.country || '-', company.payoutAccount || company.walletId || 'Payout pending', company.verificationStatus === 'verified' && !pendingDocuments ? 'Low' : 'Medium', company.verificationStatus || 'pending', dashboardMeta('kyc', company.id, company.name, company.verificationStatus, companyDetail(company), ['view', 'approve', 'reject', 'changes'])];
  });
  const refundRows = state.refundRequests.map((refund) => [refund.id, refund.bookingRef, bookingCustomer(findBooking(refund.bookingRef) || {}) || refund.requesterId || 'Customer', refund.reason, moneyValue(refund.amount), refund.status, dashboardMeta('refund', refund.id, refund.id, refund.status, employeeRefundDetail(refund), ['view', 'approve', 'reject', 'booking', 'payment'])]);
  const notificationRows = (state.notifications || []).map((note) => [note.title || note.subject, Array.isArray(note.channels) ? note.channels.join(', ') : note.channel || 'Email', note.audience || note.ownerType || 'Users', String(note.sentCount || note.deliveredCount || 0), note.deliveryStatus || note.status || 'Pending', note.status || 'queued', dashboardMeta('notification', note.id, note.title || note.subject, note.status, notificationDetail(note), ['view', 'send'])]);
  const fallbackNotifications = supportRows.map((row) => [`Support update: ${row[2]}`, 'Email/SMS', row[1], '1', 'Pending', row[4], dashboardMeta('notification', row[0], row[2], row[4], { support: row[row.length - 1].detail }, ['view', 'send'])]);
  const cartRows = (state.carts || []).map((cart) => [
    cart.cartRef,
    String(cart.items?.length || 0),
    cart.customer?.fullName || 'Guest customer',
    moneyValue(cart.pricing?.total || 0, cart.pricing?.currency || 'UGX'),
    cart.bookingRef || '-',
    cart.status || 'draft',
    dashboardMeta('cart', cart.cartRef, cart.cartRef, cart.status || 'draft', { cart, booking: cart.bookingRef ? bookingDetail(findBooking(cart.bookingRef)) : null }, ['view', 'recover', 'booking', 'export']),
  ]);
  const cartCheckoutRows = (state.cartCheckoutAttempts || []).map((attempt) => [
    attempt.id,
    attempt.cartRef,
    attempt.bookingRef || '-',
    attempt.providerReference || attempt.paymentId || '-',
    attempt.failureType || attempt.paymentId || '-',
    attempt.status || 'started',
    dashboardMeta('cart_checkout', attempt.id, attempt.cartRef || attempt.id, attempt.status || 'started', { attempt, cart: (state.carts || []).find((cart) => cart.cartRef === attempt.cartRef) || null }, ['view', 'cart', 'payment', 'export']),
  ]);
  const ticketScanRows = (state.ticketScans || []).map((scan) => [
    scan.id,
    scan.bookingRef || '-',
    scan.ticketNumber || '-',
    scan.scheduleId || '-',
    scan.scanType || '-',
    scan.result || '-',
    scan.meta?.checkInStatus || scan.message || '-',
    scan.scannedAt ? dateValue(scan.scannedAt) : '-',
    scan.actorName || scan.employeeId || scan.actorEmail || '-',
    scan.location || scan.source || '-',
    dashboardMeta('ticket_scan', scan.id, scan.ticketNumber || scan.bookingRef || scan.id, scan.result || 'scan', { scan, booking: scan.bookingRef ? bookingDetail(findBooking(scan.bookingRef)) : null }, ['view', 'booking', 'export']),
  ]);
  const ticketLegRows = bookings.flatMap((booking) => (booking.ticketLegs || []).map((ticket, index) => [
    ticket.ticketNumber,
    booking.bookingRef,
    ticket.passengerName || (booking.passengers || [])[Number(ticket.passengerIndex || index)]?.fullName || bookingCustomer(booking),
    ticket.legType || 'primary',
    ticket.scheduleId || booking.scheduleId || '-',
    ticket.seatNumber || ticket.roomNumber || (booking.passengers || [])[Number(ticket.passengerIndex || index)]?.seatOrRoom || '-',
    ticket.status || booking.bookingStatus,
    ticket.checkInStatus || booking.checkInStatus || 'boarding',
    ticket.qrTokenPreview || '-',
    ticket.usedAt || ticket.checkedInAt ? dateValue(ticket.usedAt || ticket.checkedInAt) : '-',
    dashboardMeta('ticket_leg', ticket.id || ticket.ticketNumber, ticket.ticketNumber, ticket.checkInStatus || ticket.status || 'valid', { ticket, booking: bookingDetail(booking) }, ['view', 'booking', 'scan_history', 'export']),
  ]));
  const correspondenceRows = (state.correspondenceMessages || []).map((message) => [
    message.id,
    message.bookingRef || message.supportTicketId || message.refundId || message.agreementId || message.verificationId || message.driverId || message.customerId || '-',
    message.subject || '-',
    message.visibility || 'shared',
    Array.isArray(message.channels) ? message.channels.join(', ') : (message.channels || '-'),
    message.status || 'open',
    message.createdAt ? dateValue(message.createdAt) : '-',
    dashboardMeta('correspondence', message.id, message.subject || message.id, message.status || 'open', { message, booking: message.bookingRef ? bookingDetail(findBooking(message.bookingRef)) : null }, ['view', 'booking', 'support', 'export']),
  ]);
  const deliveryAttemptRows = (state.notificationDeliveryAttempts || []).map((attempt) => [
    attempt.id,
    attempt.correspondenceMessageId || attempt.notificationId || '-',
    attempt.bookingRef || attempt.referenceId || '-',
    attempt.channel || '-',
    attempt.status || 'queued',
    attempt.provider || '-',
    attempt.attemptedAt ? dateValue(attempt.attemptedAt) : '-',
    dashboardMeta('delivery_attempt', attempt.id, attempt.channel || attempt.id, attempt.status || 'queued', { attempt }, ['view', 'message', 'export']),
  ]);
  const timelineRows = (state.bookingTimelineEvents || []).map((event) => [
    event.bookingRef || '-',
    event.entityType || '-',
    event.action || event.title || '-',
    event.actorName || event.actorId || event.actorType || '-',
    event.status || '-',
    event.createdAt ? dateValue(event.createdAt) : '-',
    dashboardMeta('booking_timeline', event.id, event.action || event.title || event.id, event.status || 'open', { event, booking: event.bookingRef ? bookingDetail(findBooking(event.bookingRef)) : null }, ['view', 'booking', 'export']),
  ]);
  const rescheduleRows = (state.rescheduleRequests || []).map((request) => [
    request.id,
    request.bookingRef,
    request.requestedScheduleId || [request.preferredDate ? dateValue(request.preferredDate) : '', request.preferredTime || ''].filter(Boolean).join(' ') || request.currentScheduleId || '-',
    request.reason || '-',
    request.status || 'pending',
    request.updatedAt || request.reviewedAt || request.createdAt ? dateValue(request.updatedAt || request.reviewedAt || request.createdAt) : '-',
    dashboardMeta('reschedule_request', request.id, request.bookingRef || request.id, request.status || 'pending', { request, booking: request.bookingRef ? bookingDetail(findBooking(request.bookingRef)) : null }, ['view', 'approve', 'reject', 'booking', 'export']),
  ]);
  const financeOwnerLabel = (ownerType, ownerId) => {
    if (ownerType === 'company') return findCompany(ownerId)?.name || ownerId || 'Company';
    if (ownerType === 'promoter') return state.users.find((user) => user.id === ownerId)?.fullName || ownerId || 'Promoter';
    if (ownerType === 'customer') return state.users.find((user) => user.id === ownerId)?.fullName || ownerId || 'Customer';
    return [ownerType, ownerId].filter(Boolean).join(':') || 'Platform';
  };
  const paymentIntentRows = (state.paymentIntents || []).map((intent) => [
    intent.intentRef || intent.id,
    intent.bookingRef || intent.cartRef || intent.bookingId || '-',
    intent.provider || '-',
    moneyValue(intent.amount || 0, intent.currency || 'UGX'),
    intent.status || 'created',
    intent.providerReference || '-',
    intent.createdAt ? dateValue(intent.createdAt) : '-',
    dashboardMeta('payment_intent', intent.id, intent.intentRef || intent.id, intent.status || 'created', { intent }, ['view', 'booking', 'export']),
  ]);
  const receiptInvoiceRows = (state.receiptInvoices || []).map((document) => [
    document.documentRef || document.id,
    document.documentType || 'receipt',
    document.bookingRef || '-',
    document.customerName || document.customerEmail || '-',
    moneyValue(document.total || 0, document.currency || 'UGX'),
    document.status || 'pending',
    document.issuedAt ? dateValue(document.issuedAt) : '-',
    dashboardMeta('receipt_invoice', document.id, document.documentRef || document.id, document.status || 'pending', { document, booking: document.bookingRef ? bookingDetail(findBooking(document.bookingRef)) : null }, ['view', 'booking', 'export']),
  ]);
  const taxFeeRows = (state.taxFeeRecords || []).map((record) => [
    record.id,
    record.bookingRef || '-',
    moneyValue(record.subtotal || 0, record.currency || 'UGX'),
    moneyValue(record.serviceFee || 0, record.currency || 'UGX'),
    moneyValue(record.taxAmount || 0, record.currency || 'UGX'),
    moneyValue(record.providerFee || 0, record.currency || 'UGX'),
    moneyValue(record.totalFees || 0, record.currency || 'UGX'),
    record.status || 'recorded',
    dashboardMeta('tax_fee', record.id, record.bookingRef || record.id, record.status || 'recorded', { record, booking: record.bookingRef ? bookingDetail(findBooking(record.bookingRef)) : null }, ['view', 'booking', 'export']),
  ]);
  const financeStatementRows = (state.financeStatements || []).map((statement) => [
    statement.statementRef || statement.id,
    financeOwnerLabel(statement.ownerType, statement.ownerId),
    statement.periodStart ? dateValue(statement.periodStart) : '-',
    statement.periodEnd ? dateValue(statement.periodEnd) : '-',
    moneyValue(statement.gross || 0, statement.currency || 'UGX'),
    moneyValue(statement.closingBalance || 0, statement.currency || 'UGX'),
    statement.status || 'issued',
    dashboardMeta('finance_statement', statement.id, statement.statementRef || statement.id, statement.status || 'issued', { statement }, ['view', 'owner', 'export']),
  ]);
  const financeRiskRows = (state.financeRiskReviews || []).map((review) => [
    review.id,
    [review.targetType, review.targetId].filter(Boolean).join(':') || '-',
    financeOwnerLabel(review.ownerType, review.ownerId),
    moneyValue(review.amount || 0, review.currency || 'UGX'),
    String(review.riskScore || 0),
    review.status || 'clear',
    Array.isArray(review.flags) && review.flags.length ? review.flags.join(', ') : 'No flags',
    dashboardMeta('finance_risk', review.id, review.targetId || review.id, review.status || 'clear', { review }, ['view', 'target', 'export']),
  ]);
  const settlementRows = (state.settlementBatches || []).map((batch) => [
    batch.batchNumber || batch.id,
    batch.periodStart ? dateValue(batch.periodStart) : '-',
    batch.periodEnd ? dateValue(batch.periodEnd) : '-',
    moneyValue(batch.totalGross || 0, batch.currency || 'UGX'),
    moneyValue(batch.totalPayable || 0, batch.currency || 'UGX'),
    batch.status || 'draft',
    dashboardMeta('settlement_batch', batch.id, batch.batchNumber || batch.id, batch.status || 'draft', { batch }, ['view', 'statements', 'payouts', 'export']),
  ]);
  const payoutRequestRows = (state.payoutRequests || []).map((request) => [
    request.id,
    request.transactionId || '-',
    financeOwnerLabel(request.ownerType, request.ownerId),
    moneyValue(request.amount || 0, request.currency || 'UGX'),
    request.payoutMethod || '-',
    request.payoutBatchId || '-',
    request.riskStatus || request.status || 'requested',
    request.status || 'requested',
    dashboardMeta('payout_request', request.id, request.transactionId || request.id, request.status || 'requested', { request }, ['view', 'review', 'batch', 'export']),
  ]);
  const payoutBatchRows = (state.payoutBatches || []).map((batch) => [
    batch.batchNumber || batch.id,
    batch.providerReference || '-',
    String((batch.requestIds || []).length),
    moneyValue(batch.totalAmount || 0, batch.currency || 'UGX'),
    batch.status || 'exported',
    batch.createdAt ? dateValue(batch.createdAt) : '-',
    dashboardMeta('payout_batch', batch.id, batch.batchNumber || batch.id, batch.status || 'exported', { batch }, ['view', 'requests', 'export']),
  ]);
  const reconciliationRows = (state.reconciliationReports || []).map((report) => [
    report.id,
    report.settlementBatchId || '-',
    report.periodStart ? dateValue(report.periodStart) : '-',
    report.periodEnd ? dateValue(report.periodEnd) : '-',
    moneyValue(report.grossPayments || 0, 'UGX'),
    moneyValue(report.variance || 0, 'UGX'),
    report.status || 'variance_review',
    dashboardMeta('reconciliation', report.id, report.settlementBatchId || report.id, report.status || 'variance_review', { report }, ['view', 'settlement', 'export']),
  ]);
  const ledgerRows = (state.walletTransactions || []).map((transaction) => [
    transaction.id,
    financeOwnerLabel(transaction.ownerType, transaction.ownerId),
    transaction.transactionType || transaction.referenceType || 'wallet',
    transaction.direction || '-',
    moneyValue(transaction.amount || 0, transaction.currency || 'UGX'),
    transaction.status || 'completed',
    dashboardMeta('ledger_transaction', transaction.id, transaction.id, transaction.status || 'completed', { transaction }, ['view', 'owner', 'export']),
  ]);
  const referralClickRows = (state.referralClicks || []).map((click) => [
    click.id,
    click.code || '-',
    financeOwnerLabel('promoter', click.promoterId),
    findListing(click.listingId)?.title || click.listingId || '-',
    click.ip || '-',
    click.createdAt ? dateValue(click.createdAt) : '-',
    dashboardMeta('referral_click', click.id, click.code || click.id, 'tracked', { click }, ['view', 'promoter', 'listing', 'export']),
  ]);
  const attributionSessionRows = (state.attributionSessions || []).map((session) => [
    session.id,
    session.referralCode || '-',
    financeOwnerLabel('promoter', session.promoterId),
    findListing(session.listingId)?.title || session.listingId || '-',
    session.status || 'active',
    session.bookingRef || '-',
    session.createdAt ? dateValue(session.createdAt) : '-',
    dashboardMeta('attribution_session', session.id, session.referralCode || session.id, session.status || 'active', { session }, ['view', 'click', 'booking', 'export']),
  ]);
  const campaignConversionRows = (state.campaignConversions || []).map((conversion) => [
    conversion.id,
    conversion.campaignId || conversion.linkId || '-',
    financeOwnerLabel('promoter', conversion.promoterId),
    conversion.bookingRef || '-',
    moneyValue(conversion.amount || 0, conversion.currency || 'UGX'),
    moneyValue(conversion.commissionAmount || 0, conversion.currency || 'UGX'),
    conversion.status || 'converted',
    dashboardMeta('campaign_conversion', conversion.id, conversion.bookingRef || conversion.id, conversion.status || 'converted', { conversion, booking: conversion.bookingRef ? bookingDetail(findBooking(conversion.bookingRef)) : null }, ['view', 'booking', 'export']),
  ]);
  const agentProfileRows = (state.agentProfiles || []).map((profile) => [
    profile.id,
    financeOwnerLabel('promoter', profile.userId || profile.promoterId),
    profile.agentCode || '-',
    profile.officeName || '-',
    profile.location || '-',
    profile.offlineSalesEnabled ? 'Enabled' : 'Disabled',
    profile.status || 'active',
    dashboardMeta('agent_profile', profile.id, profile.agentCode || profile.id, profile.status || 'active', { profile }, ['view', 'agent', 'export']),
  ]);
  const fraudSignalRows = (state.fraudSignals || []).map((signal) => [
    signal.id,
    financeOwnerLabel('promoter', signal.promoterId || signal.agentId),
    signal.bookingRef || '-',
    signal.signalType || 'booking_risk',
    signal.severity || '-',
    String(signal.score || 0),
    signal.status || 'open',
    dashboardMeta('fraud_signal', signal.id, signal.bookingRef || signal.id, signal.status || 'open', { signal, booking: signal.bookingRef ? bookingDetail(findBooking(signal.bookingRef)) : null }, ['view', 'review', 'booking', 'export']),
  ]);
  const referralCardRows = (state.promoterLinks || []).map((link) => [
    link.id,
    financeOwnerLabel('promoter', link.promoterId),
    link.code || link.referralCode || '-',
    findListing(link.listingId)?.title || link.listingId || '-',
    link.qrCardUrl || `/promoter/links/${link.id}/qr-card`,
    link.status || 'active',
    dashboardMeta('referral_card', link.id, link.code || link.id, link.status || 'active', { link, listing: listingDetail(findListing(link.listingId)) }, ['view', 'qr', 'export']),
  ]);
  const agentSaleRows = (state.offlineSales || []).map((sale) => [
    sale.saleRef || sale.id,
    sale.bookingRef || '-',
    sale.customerName || sale.passengerName || '-',
    findListing(sale.listingId)?.title || sale.listingId || '-',
    sale.paymentMethod || '-',
    moneyValue(sale.amountCollected || 0, sale.currency || 'UGX'),
    sale.status || 'completed',
    dashboardMeta('agent_sale', sale.id, sale.saleRef || sale.id, sale.status || 'completed', { sale, booking: sale.bookingRef ? bookingDetail(findBooking(sale.bookingRef)) : null }, ['view', 'booking', 'receipt', 'export']),
  ]);

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
      databaseStatus: 'Uses MongoDB when connected, otherwise MongoDB-backed persistent store',
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
    routes: routeRows,
    vehicles: vehicleRows,
    schedules: scheduleRows,
    payments: paymentRows,
    promoters: promoterRows,
    customers: customerRows,
    support: supportRows,
    leads: leadRows,
    sessions: sessionRows,
    agreements: agreementRows,
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
    carts: cartRows,
    cartCheckouts: cartCheckoutRows,
    ticketScans: ticketScanRows,
    ticketLegs: ticketLegRows,
    correspondence: correspondenceRows,
    deliveryAttempts: deliveryAttemptRows,
    timeline: timelineRows,
    reschedules: rescheduleRows,
    paymentIntents: paymentIntentRows,
    receiptInvoices: receiptInvoiceRows,
    taxFees: taxFeeRows,
    financeStatements: financeStatementRows,
    financeRisk: financeRiskRows,
    settlements: settlementRows,
    payoutRequests: payoutRequestRows,
    payoutBatches: payoutBatchRows,
    reconciliation: reconciliationRows,
    ledger: ledgerRows,
    referralClicks: referralClickRows,
    attributionSessions: attributionSessionRows,
    campaignConversions: campaignConversionRows,
    agentProfiles: agentProfileRows,
    fraudSignals: fraudSignalRows,
    referralCards: referralCardRows,
    agentSales: agentSaleRows,
    offlineSales: agentSaleRows,
  };
}

function buildCompanyServiceProfile(company = {}, listings = [], assets = {}) {
  // Business rule: one company account belongs to one primary service category.
  // Super Admin can see all service dashboards, but a company admin must never
  // receive a combined Bus + Hotel (or any multi-service) dashboard.
  const companyType = normalize(company.companyType || company.type || company.serviceType);
  const listingTypes = Array.from(new Set((listings || []).map((listing) => normalize(listing.serviceType || listing.type)).filter(Boolean)));
  const fallbackType = listingTypes[0]
    || ((assets.hotelProperties || []).length || (assets.roomTypes || []).length || (assets.roomUnits || []).length || (assets.rooms || []).length ? 'hotel' : '')
    || ((assets.vehicles || []).length || (assets.schedules || []).length ? 'bus' : '')
    || 'partner';
  const primaryServiceType = companyType && companyType !== 'partner' ? companyType : fallbackType;
  const serviceTypes = primaryServiceType && primaryServiceType !== 'partner' ? [primaryServiceType] : [];
  const supportsHotel = primaryServiceType === 'hotel';
  const supportsBus = primaryServiceType === 'bus';
  const supportsFlight = primaryServiceType === 'flight';
  const supportsTrain = primaryServiceType === 'train';
  const supportsTransport = ROUTED_SERVICE_TYPES.includes(primaryServiceType);
  const primaryLabel = SERVICE_LABELS[primaryServiceType] || (primaryServiceType === 'partner' ? 'Partner' : primaryServiceType);
  const inventoryLabel = supportsBus ? 'Seat maps' : supportsHotel ? 'Rooms' : `${primaryLabel} inventory`;
  const dashboardLabel = primaryServiceType && primaryServiceType !== 'partner' ? `${primaryLabel} Dashboard` : 'Company Dashboard';
  const visiblePages = new Set(COMPANY_SERVICE_PAGE_MAP[primaryServiceType] || COMPANY_SERVICE_PAGE_MAP.partner);

  const pageMeta = {
    overview: [`${dashboardLabel}`, `Manage only this company's ${primaryLabel.toLowerCase()} operations, bookings, inventory, team work, support, revenue, and settlement.`],
    listings: [`${primaryLabel} Listings`, `Manage only ${primaryLabel.toLowerCase()} services connected to this company.`],
    routes: [supportsFlight ? 'Flight Routes' : supportsTrain ? 'Train Routes' : 'Routes', supportsFlight ? 'Manage airline corridors and route readiness.' : supportsTrain ? 'Manage train corridors, stations, and route readiness.' : 'Manage transport routes before scheduling departures.'],
    vehicles: [supportsFlight ? 'Aircraft and Fleet' : supportsTrain ? 'Coaches and Fleet' : 'Vehicles', supportsFlight ? 'Manage aircraft or fleet records linked to schedules.' : supportsTrain ? 'Manage train coaches and fleet records linked to schedules.' : 'Manage vehicles and seat layouts for departures.'],
    schedules: [supportsFlight ? 'Flight Schedules' : supportsTrain ? 'Train Schedules' : 'Schedules and Availability', supportsFlight ? 'Manage flight schedules and availability.' : supportsTrain ? 'Manage train schedules and availability.' : 'Manage departure dates, vehicles, prices, and availability.'],
    checkins: [supportsHotel ? 'Guest Check-ins' : 'Check-ins', supportsHotel ? 'Validate arriving guests and monitor stay status.' : 'Validate tickets and monitor boarding progress.'],
    seatrooms: [inventoryLabel, supportsBus ? 'Control visual bus seat maps, holds, bookings, and blocked seats.' : supportsHotel ? 'Control visual room maps, room-night inventory, housekeeping, and booked stays.' : `Control ${primaryLabel.toLowerCase()} inventory.`],
    'seat-maps': ['Seat Maps', supportsBus ? 'Control visual bus seat maps, holds, bookings, and blocked seats.' : 'Control seat maps and inventory status.'],
    'hotel-rooms': ['Rooms & Inventory', 'Control hotel properties, room types, room units, room-night inventory, housekeeping, and booked stays.'],
    manifests: ['Manifests', supportsHotel ? 'Print hotel arrival, departure, and in-house lists.' : 'Print customer manifests and operational lists.'],
    revenue: ['Revenue', 'View company revenue, booking splits, pending earnings, and refunds.'],
    settlement: ['Settlement', 'Request payout and track pending/available/paid-out earnings.'],
  };
  return {
    serviceTypes,
    primaryServiceType,
    primaryLabel,
    dashboardLabel,
    consoleName: `${dashboardLabel} Console`,
    inventoryLabel,
    supportsBus,
    supportsHotel,
    supportsFlight,
    supportsTransport,
    supportsMultiple: false,
    visiblePages: Array.from(visiblePages),
    pageMeta,
  };
}


function amountNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function companyRefundAmountForBooking(booking = {}) {
  return (state.refundRequests || [])
    .filter((refund) => refund.bookingRef === booking.bookingRef || refund.bookingId === booking.id)
    .filter((refund) => !['rejected', 'cancelled', 'closed'].includes(normalize(refund.status)))
    .reduce((total, refund) => total + amountNumber(refund.amount || booking.pricing?.total), 0);
}

function bookingSettlementLabel(booking = {}) {
  const raw = normalize(booking.settlementStatus || booking.financeStatus || booking.bookingStatus || booking.paymentStatus);
  if (['released', 'paid', 'settled', 'completed'].includes(raw)) return raw === 'paid' ? 'paid' : raw === 'settled' ? 'settled' : 'released';
  if (/refund|cancel/.test(raw)) return 'refund review';
  if (['checked_in', 'checked-in', 'completed'].includes(normalize(booking.bookingStatus))) return 'release ready';
  if (['successful', 'paid'].includes(normalize(booking.paymentStatus))) return 'pending release';
  return raw || 'pending payment';
}

function buildCompanyFinanceDrilldown(companyId, bookings = []) {
  const bookingRefs = new Set(bookings.map((booking) => booking.bookingRef).filter(Boolean));
  const companyWallet = (state.wallets || []).find((wallet) => wallet.ownerType === 'company' && wallet.ownerId === companyId) || {};
  const companyTransactions = (state.walletTransactions || []).filter((txn) => txn.ownerType === 'company' && txn.ownerId === companyId);
  const payoutRequests = (state.payoutRequests || []).filter((request) => request.ownerType === 'company' && request.ownerId === companyId);
  const settlementBatchIds = new Set([...companyTransactions.map((txn) => txn.settlementBatchId || txn.batchId).filter(Boolean), ...payoutRequests.map((request) => request.settlementBatchId || request.payoutBatchId).filter(Boolean)]);
  const paymentByBooking = (booking) => (state.payments || []).find((payment) => payment.bookingRef === booking.bookingRef || payment.bookingId === booking.id) || {};
  const revenueRows = bookings.map((booking, index) => {
    const split = booking.pricing?.split || {};
    const payment = paymentByBooking(booking);
    const gross = amountNumber(booking.pricing?.total || payment.amount);
    const companyEarning = amountNumber(split.companyAmount || gross);
    const platformFee = amountNumber(split.platformFee);
    const promoterCommission = amountNumber(split.promoterAmount);
    const refundDebit = companyRefundAmountForBooking(booking);
    const netPayable = Math.max(0, companyEarning - refundDebit);
    const status = bookingSettlementLabel(booking);
    const service = SERVICE_LABELS[booking.serviceType] || booking.serviceType || 'Booking';
    const txnId = payment.id || booking.paymentRef || `FIN-${String(index + 1).padStart(4, '0')}`;
    const detail = {
      finance: { txnId, bookingRef: booking.bookingRef, serviceType: booking.serviceType, gross, companyEarning, platformFee, promoterCommission, refundDebit, netPayable, settlementStatus: status, payoutBatchId: booking.payoutBatchId || '', settlementBatchId: booking.settlementBatchId || '' },
      booking: bookingDetail(booking),
      payment,
      refundRequests: (state.refundRequests || []).filter((refund) => refund.bookingRef === booking.bookingRef || refund.bookingId === booking.id),
      company: companyDetail(findCompany(companyId)),
    };
    return [
      txnId,
      booking.bookingRef,
      service,
      moneyValue(gross, booking.pricing?.currency || payment.currency || 'UGX'),
      moneyValue(companyEarning, booking.pricing?.currency || payment.currency || 'UGX'),
      moneyValue(platformFee, booking.pricing?.currency || payment.currency || 'UGX'),
      moneyValue(promoterCommission, booking.pricing?.currency || payment.currency || 'UGX'),
      moneyValue(refundDebit, booking.pricing?.currency || payment.currency || 'UGX'),
      moneyValue(netPayable, booking.pricing?.currency || payment.currency || 'UGX'),
      status,
      dashboardMeta('company_finance_booking', txnId, booking.bookingRef || txnId, status, detail, ['view', 'booking', 'refunds', 'export']),
    ];
  });
  const ledgerRows = companyTransactions.map((txn) => [
    txn.id,
    txn.referenceId || txn.bookingRef || txn.bookingId || txn.transactionType || '-',
    txn.transactionType || txn.referenceType || 'wallet',
    txn.direction || '-',
    moneyValue(txn.amount || 0, txn.currency || 'UGX'),
    txn.settlementBatchId || txn.batchId || '-',
    txn.payoutRequestId || txn.payoutId || '-',
    txn.status || 'pending',
    dashboardMeta('company_ledger_transaction', txn.id, txn.id, txn.status || 'pending', { transaction: txn, company: companyDetail(findCompany(companyId)) }, ['view', 'settlement', 'export']),
  ]);
  const settlementRows = (state.settlementBatches || [])
    .filter((batch) => settlementBatchIds.has(batch.id) || settlementBatchIds.has(batch.batchNumber) || (batch.companyId && batch.companyId === companyId) || (batch.ownerId && batch.ownerId === companyId))
    .map((batch) => [
      batch.batchNumber || batch.id,
      batch.periodStart ? dateValue(batch.periodStart) : '-',
      batch.periodEnd ? dateValue(batch.periodEnd) : '-',
      moneyValue(batch.totalGross || 0, batch.currency || 'UGX'),
      moneyValue(batch.totalPayable || batch.companyEarning || 0, batch.currency || 'UGX'),
      String((batch.bookingRefs || batch.transactionIds || batch.requestIds || []).length || companyTransactions.filter((txn) => [txn.settlementBatchId, txn.batchId].includes(batch.id) || [txn.settlementBatchId, txn.batchId].includes(batch.batchNumber)).length),
      batch.status || 'draft',
      dashboardMeta('company_settlement_batch', batch.id, batch.batchNumber || batch.id, batch.status || 'draft', { batch, transactions: companyTransactions.filter((txn) => [txn.settlementBatchId, txn.batchId].includes(batch.id) || [txn.settlementBatchId, txn.batchId].includes(batch.batchNumber)) }, ['view', 'statement', 'payouts', 'export']),
    ]);
  const payoutRows = payoutRequests.map((request) => [
    request.id,
    request.transactionId || '-',
    moneyValue(request.amount || 0, request.currency || 'UGX'),
    request.payoutMethod || request.method || '-',
    request.payoutAccount || request.account || '-',
    request.payoutBatchId || request.batchId || '-',
    request.riskStatus || request.status || 'requested',
    request.status || 'requested',
    dashboardMeta('company_payout_request', request.id, request.id, request.status || 'requested', { request, company: companyDetail(findCompany(companyId)) }, ['view', 'risk', 'batch', 'export']),
  ]);
  const statementRows = (state.financeStatements || [])
    .filter((statement) => statement.ownerType === 'company' && statement.ownerId === companyId)
    .map((statement) => [
      statement.statementRef || statement.id,
      statement.periodStart ? dateValue(statement.periodStart) : '-',
      statement.periodEnd ? dateValue(statement.periodEnd) : '-',
      moneyValue(statement.gross || 0, statement.currency || 'UGX'),
      moneyValue(statement.companyEarning || statement.closingBalance || 0, statement.currency || 'UGX'),
      moneyValue(statement.refundDebits || 0, statement.currency || 'UGX'),
      statement.status || 'issued',
      dashboardMeta('company_finance_statement', statement.id, statement.statementRef || statement.id, statement.status || 'issued', { statement, company: companyDetail(findCompany(companyId)) }, ['view', 'export']),
    ]);
  const gross = revenueRows.reduce((total, row) => total + amountNumber(row[3].replace(/[^0-9.-]/g, '')), 0);
  const companyEarning = bookings.reduce((total, booking) => total + amountNumber(booking.pricing?.split?.companyAmount || booking.pricing?.total), 0);
  const platformFee = bookings.reduce((total, booking) => total + amountNumber(booking.pricing?.split?.platformFee), 0);
  const promoterCommission = bookings.reduce((total, booking) => total + amountNumber(booking.pricing?.split?.promoterAmount), 0);
  const refundDebits = bookings.reduce((total, booking) => total + companyRefundAmountForBooking(booking), 0);
  const pending = companyTransactions.filter((txn) => /pending|hold|review/.test(normalize(txn.status))).reduce((total, txn) => total + amountNumber(txn.amount), 0) || bookings.filter((booking) => bookingSettlementLabel(booking).includes('pending')).reduce((total, booking) => total + amountNumber(booking.pricing?.split?.companyAmount || booking.pricing?.total), 0);
  const released = companyTransactions.filter((txn) => /released|completed|settled|paid/.test(normalize(txn.status))).reduce((total, txn) => total + amountNumber(txn.amount), 0);
  return {
    summary: {
      gross: moneyValue(gross || bookings.reduce((total, booking) => total + amountNumber(booking.pricing?.total), 0), 'UGX'),
      companyEarning: moneyValue(companyEarning, 'UGX'),
      platformFee: moneyValue(platformFee, 'UGX'),
      promoterCommission: moneyValue(promoterCommission, 'UGX'),
      refundDebits: moneyValue(refundDebits, 'UGX'),
      netPayable: moneyValue(Math.max(0, companyEarning - refundDebits), 'UGX'),
      pending: moneyValue(pending, 'UGX'),
      released: moneyValue(released, 'UGX'),
      availableBalance: moneyValue(companyWallet.availableBalance || 0, companyWallet.currency || 'UGX'),
      pendingBalance: moneyValue(companyWallet.pendingBalance || 0, companyWallet.currency || 'UGX'),
      bookings: String(bookings.length),
      refunds: String((state.refundRequests || []).filter((refund) => bookingRefs.has(refund.bookingRef)).length),
    },
    revenueRows,
    settlementRows: settlementRows.length ? settlementRows : [[
      'Current pending batch', 'Current', dateValue(new Date()), moneyValue(bookings.reduce((total, booking) => total + amountNumber(booking.pricing?.total), 0), 'UGX'), moneyValue(Math.max(0, companyEarning - refundDebits), 'UGX'), String(bookings.length), pending > 0 ? 'pending release' : 'ready', dashboardMeta('company_settlement_batch', 'current-pending', 'Current pending batch', pending > 0 ? 'pending release' : 'ready', { settlement: { bookings: bookings.map((booking) => booking.bookingRef), pending, released, refundDebits }, company: companyDetail(findCompany(companyId)) }, ['view', 'export'])
    ]],
    ledgerRows,
    payoutRows,
    statementRows,
  };
}

function companyDashboardData(companyId, listings, bookings) {
  const company = findCompany(companyId) || {};
  const companyRoutes = state.routes.filter((route) => route.companyId === companyId);
  const routeStops = Array.isArray(state.routeStops) ? state.routeStops.filter((stop) => stop.companyId === companyId) : [];
  const vehicles = (state.vehicles || []).filter((vehicle) => vehicle.companyId === companyId);
  const schedules = state.schedules.filter((schedule) => schedule.companyId === companyId);
  const rooms = state.rooms.filter((room) => room.companyId === companyId);
  const reviews = state.reviews.filter((review) => review.companyId === companyId);
  const companyEmployees = Array.isArray(state.companyEmployees) ? state.companyEmployees.filter((employee) => employee.companyId === companyId) : [];
  const companyBranches = Array.isArray(state.companyBranches) ? state.companyBranches.filter((branch) => branch.companyId === companyId) : [];
  const companyPolicies = Array.isArray(state.companyPolicies) ? state.companyPolicies.filter((policy) => policy.companyId === companyId) : [];
  const driverAssignments = Array.isArray(state.driverAssignments) ? state.driverAssignments.filter((assignment) => assignment.companyId === companyId) : [];
  const driverIncidents = Array.isArray(state.driverIncidents) ? state.driverIncidents.filter((incident) => incident.companyId === companyId) : [];
  const tripStatusUpdates = Array.isArray(state.tripStatusUpdates) ? state.tripStatusUpdates.filter((update) => update.companyId === companyId) : [];
  const hotelProperties = Array.isArray(state.hotelProperties) ? state.hotelProperties.filter((property) => property.companyId === companyId) : [];
  const roomTypes = Array.isArray(state.roomTypes) ? state.roomTypes.filter((roomType) => roomType.companyId === companyId) : [];
  const roomUnits = Array.isArray(state.roomUnits) ? state.roomUnits.filter((unit) => unit.companyId === companyId) : [];
  const roomNightInventories = Array.isArray(state.roomNightInventories) ? state.roomNightInventories.filter((night) => night.companyId === companyId) : [];
  const serviceProfile = buildCompanyServiceProfile(company, listings, { hotelProperties, roomTypes, roomUnits, rooms, vehicles, schedules });
  const listingSupportsVisibleService = (listingId) => {
    const listing = findListing(listingId) || {};
    const type = normalize(listing.serviceType);
    return !type || serviceProfile.serviceTypes.includes(type);
  };
  const visibleRoutes = serviceProfile.supportsTransport ? companyRoutes.filter((route) => listingSupportsVisibleService(route.listingId)) : [];
  const visibleRouteIds = new Set(visibleRoutes.map((route) => route.id));
  const visibleRouteStops = serviceProfile.supportsTransport ? routeStops.filter((stop) => visibleRouteIds.has(stop.routeId)) : [];
  const visibleSchedules = serviceProfile.supportsTransport ? schedules.filter((schedule) => listingSupportsVisibleService(schedule.listingId)) : [];
  const busSchedules = serviceProfile.supportsBus ? visibleSchedules.filter((schedule) => normalize(findListing(schedule.listingId)?.serviceType) === 'bus') : [];
  const visibleVehicles = serviceProfile.supportsTransport ? vehicles.filter((vehicle) => listingSupportsVisibleService(vehicle.listingId) || serviceProfile.serviceTypes.includes(normalize(vehicle.serviceType))) : [];
  const hasOwnedHotelInventory = serviceProfile.supportsHotel
    || listings.some((listing) => normalize(listing.serviceType) === 'hotel')
    || rooms.length || hotelProperties.length || roomTypes.length || roomUnits.length || roomNightInventories.length;
  const visibleRooms = hasOwnedHotelInventory ? rooms : [];
  const visibleHotelProperties = hasOwnedHotelInventory ? hotelProperties : [];
  const visibleRoomTypes = hasOwnedHotelInventory ? roomTypes : [];
  const visibleRoomUnits = hasOwnedHotelInventory ? roomUnits : [];
  const visibleRoomNightInventories = hasOwnedHotelInventory ? roomNightInventories : [];
  const hotelBookings = hasOwnedHotelInventory ? bookings.filter((booking) => booking.serviceType === 'hotel') : [];
  const supportTickets = state.supportTickets.filter((ticket) => ticket.companyId === companyId || (ticket.ownerType === 'company' && (!ticket.ownerId || ticket.ownerId === companyId)));
  const grossRevenue = bookings.reduce((total, booking) => total + Number(booking.pricing?.total || 0), 0);
  const companyEarnings = bookings.reduce((total, booking) => total + Number(booking.pricing?.split?.companyAmount || 0), 0);
  const companyFinance = buildCompanyFinanceDrilldown(companyId, bookings);
  const seats = busSchedules.flatMap((schedule) => seatsForSchedule(schedule.id));
  const bookedSeats = seats.filter((seat) => seat.status === 'taken').length;
  const heldSeats = seats.filter((seat) => seat.status === 'locked').length;
  const blockedSeats = seats.filter((seat) => seat.status === 'blocked').length;
  const fillRate = seats.length ? Math.round((bookedSeats / seats.length) * 100) : 0;
  const activeListings = listings.filter((listing) => listing.status === 'active');
  const activeSchedules = visibleSchedules.filter((schedule) => schedule.status === 'active');
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
  const branchOption = (branch) => ({
    id: branch.id,
    value: branch.id,
    label: `${branch.name}${branch.city ? ` - ${branch.city}` : ''}`,
    branchType: branch.branchType,
    status: branch.status,
  });
  const driverOption = (employee) => {
    const user = state.users.find((item) => item.id === employee.userId) || {};
    return {
      id: employee.id,
      value: employee.id,
      userId: employee.userId,
      label: `${user.fullName || user.email || employee.id}${employee.licenseNumber ? ` - ${employee.licenseNumber}` : ''}`,
      status: employee.status,
    };
  };
  const seatInventoryRows = busSchedules.map((schedule) => {
    const scheduleSeats = seatsForSchedule(schedule.id);
    const totalSeats = scheduleSeats.length || Number(schedule.totalSeats || 0);
    const sold = scheduleSeats.filter((seat) => ['taken', 'booked', 'checked-in'].includes(normalize(seat.status))).length;
    const held = scheduleSeats.filter((seat) => ['locked', 'held', 'selected'].includes(normalize(seat.status))).length;
    const blocked = scheduleSeats.filter((seat) => ['blocked', 'maintenance', 'disabled'].includes(normalize(seat.status))).length;
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
  const seatMaps = busSchedules.map((schedule) => {
    const scheduleSeats = seatsForSchedule(schedule.id);
    const listing = findListing(schedule.listingId) || {};
    const route = visibleRoutes.find((item) => item.id === schedule.routeId) || {};
    const vehicle = visibleVehicles.find((item) => item.id === schedule.vehicleId) || {};
    const matchBookingSeat = (seat) => {
      const number = seat.seatNumber || seat.label || seat.id;
      return bookings.find((booking) => {
        if ((booking.ticketLegs || []).some((leg) => leg.scheduleId === schedule.id && leg.seatNumber === number)) return true;
        if ((booking.bookingItems || []).some((item) => item.scheduleId === schedule.id && item.seatNumber === number)) return true;
        return booking.scheduleId === schedule.id && (booking.passengers || []).some((passenger) => [passenger.seatOrRoom, passenger.seatNumber].includes(number));
      }) || null;
    };
    const seats = scheduleSeats.map((seat) => {
      const booking = matchBookingSeat(seat);
      const number = seat.seatNumber || seat.label || seat.id;
      const ticket = (booking?.ticketLegs || []).find((leg) => leg.scheduleId === schedule.id && leg.seatNumber === number) || {};
      const passenger = (booking?.passengers || [])[ticket.passengerIndex || 0] || (booking?.passengers || []).find((row) => [row.seatOrRoom, row.seatNumber].includes(number)) || {};
      const status = normalize(seat.status || 'available');
      return {
        id: seat.id,
        scheduleId: schedule.id,
        seatNumber: number,
        row: Number(seat.row || 0),
        col: Number(seat.col || 0),
        deck: seat.deck || 'main',
        seatClass: seat.seatClass || seat.seatType || 'Standard',
        seatType: seat.seatType || normalize(seat.seatClass || 'standard'),
        status,
        priceDelta: Number(seat.priceDelta || 0),
        lockedUntil: seat.lockedUntil || '',
        lockId: seat.lockId || '',
        blockedReason: seat.blockedReason || '',
        bookingRef: booking?.bookingRef || '',
        passengerName: passenger.fullName || ticket.passengerName || '',
        passengerPhone: passenger.phone || booking?.guestSnapshot?.phone || '',
        passengerEmail: passenger.email || booking?.guestSnapshot?.email || '',
        ticketNumber: ticket.ticketNumber || '',
        checkInStatus: ticket.checkInStatus || booking?.checkInStatus || '',
        paymentStatus: booking?.paymentStatus || '',
      };
    });
    return {
      scheduleId: schedule.id,
      listingId: listing.id || schedule.listingId,
      listingTitle: listing.title || bookingTitle({ listingId: schedule.listingId }),
      routeLabel: route.routeName || [route.origin || listing.from, route.destination || listing.to].filter(Boolean).join(' to '),
      vehicleName: vehicle.name || schedule.vehicleName || 'Vehicle pending',
      departAt: schedule.departAt,
      status: schedule.status,
      totals: {
        total: seats.length || Number(schedule.totalSeats || 0),
        booked: seats.filter((seat) => ['taken', 'booked', 'checked-in'].includes(seat.status)).length,
        held: seats.filter((seat) => ['locked', 'held', 'selected'].includes(seat.status)).length,
        available: seats.filter((seat) => seat.status === 'available').length,
        blocked: seats.filter((seat) => ['blocked', 'maintenance', 'disabled'].includes(seat.status)).length,
      },
      seats,
    };
  });
  const roomInventoryRows = visibleRooms.map((room) => {
    const roomBookings = bookings.filter((booking) => booking.listingId === room.listingId && booking.passengers?.some((passenger) => passenger.seatOrRoom === room.roomType)).length;
    return [
      room.roomType,
      bookingTitle({ listingId: room.listingId }),
      String(room.inventory + roomBookings),
      String(roomBookings),
      '0',
      room.status === 'active' ? '0' : String(room.inventory),
      room.status,
      { entity: 'room', id: room.id, label: room.roomType, status: room.status, detail: { room, listing: listingDetail(findListing(room.listingId) || {}), company: companyDetail(company) } },
    ];
  });
  const propertyById = (propertyId) => visibleHotelProperties.find((property) => property.id === propertyId) || {};
  const roomTypeById = (roomTypeId) => visibleRoomTypes.find((roomType) => roomType.id === roomTypeId) || {};
  const roomUnitById = (roomUnitId) => visibleRoomUnits.find((unit) => unit.id === roomUnitId) || {};
  const activeStayRows = hotelBookings.filter((booking) => {
    const status = normalize(booking.hotelStay?.status || booking.bookingStatus);
    return !['cancelled', 'refunded', 'voided'].includes(status);
  });
  const hotelManifestRow = (booking) => [
    booking.bookingRef,
    bookingCustomer(booking),
    bookingTitle(booking),
    (booking.passengers || []).map((guest) => guest.seatOrRoom || guest.roomNumber || guest.roomType).filter(Boolean).join(', ') || 'Room pending',
    booking.hotelStay?.checkIn || '-',
    booking.hotelStay?.checkOut || '-',
    booking.hotelStay?.status || booking.bookingStatus,
    dashboardMeta('hotel_booking', booking.bookingRef, booking.bookingRef, booking.bookingStatus, bookingDetail(booking), ['view', 'check_in', 'check_out', 'manifest', 'export']),
  ];
  const hotelPropertyRows = visibleHotelProperties.map((property) => {
    const listing = findListing(property.listingId) || {};
    return [
      property.propertyName || listing.title || 'Hotel property',
      listing.title || property.listingId || '-',
      [property.city, property.country].filter(Boolean).join(', ') || '-',
      `${property.checkInTime || '-'} / ${property.checkOutTime || '-'}`,
      Array.isArray(property.amenities) && property.amenities.length ? property.amenities.join(', ') : '-',
      property.status || 'active',
      dashboardMeta('hotel_property', property.id, property.propertyName || listing.title, property.status || 'active', { property, listing: listingDetail(listing), company: companyDetail(company) }, ['view', 'edit', 'rooms', 'manifest']),
    ];
  });
  const roomTypeRows = visibleRoomTypes.map((roomType) => {
    const listing = findListing(roomType.listingId) || {};
    const units = visibleRoomUnits.filter((unit) => unit.roomTypeId === roomType.id && unit.status !== 'archived');
    return [
      roomType.name || 'Room type',
      propertyById(roomType.propertyId).propertyName || listing.title || '-',
      String(roomType.capacity || 1),
      moneyValue(roomType.basePrice || listing.priceFrom || 0, listing.currency || company.settings?.defaultCurrency || 'UGX'),
      `${units.length} units`,
      roomType.status || 'active',
      dashboardMeta('room_type', roomType.id, roomType.name || 'Room type', roomType.status || 'active', { roomType, property: propertyById(roomType.propertyId), listing: listingDetail(listing), units }, ['view', 'edit', 'units', 'pricing']),
    ];
  });
  const roomUnitRows = visibleRoomUnits.map((unit) => {
    const roomType = roomTypeById(unit.roomTypeId);
    const listing = findListing(unit.listingId) || {};
    return [
      unit.unitNumber || unit.id,
      roomType.name || 'Room type',
      propertyById(unit.propertyId).propertyName || listing.title || '-',
      [unit.floor && `Floor ${unit.floor}`, unit.wing].filter(Boolean).join(' / ') || '-',
      unit.housekeepingStatus || 'clean',
      unit.status || 'available',
      dashboardMeta('room_unit', unit.id, unit.unitNumber || unit.id, unit.status || 'available', { roomUnit: unit, roomType, property: propertyById(unit.propertyId), listing: listingDetail(listing) }, ['view', 'edit', 'maintenance', 'housekeeping']),
    ];
  });
  const hotelHousekeepingTasks = visibleRoomUnits
    .filter((unit) => ['dirty', 'cleaning', 'maintenance', 'occupied', 'inspection', 'inspected'].includes(normalize(unit.housekeepingStatus || unit.status || '')))
    .map((unit) => {
      const roomType = roomTypeById(unit.roomTypeId);
      const listing = findListing(unit.listingId) || {};
      const property = propertyById(unit.propertyId);
      const activeNight = visibleRoomNightInventories
        .filter((night) => night.roomUnitId === unit.id)
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
        .find((night) => ['cleaning', 'maintenance', 'occupied', 'checked-out', 'booked'].includes(normalize(night.status))) || {};
      const booking = activeNight.bookingRef ? findBooking(activeNight.bookingRef) : null;
      const priority = unit.housekeepingPriority || (normalize(unit.housekeepingStatus) === 'maintenance' ? 'high' : normalize(unit.housekeepingStatus) === 'dirty' ? 'normal' : 'low');
      const taskStatus = unit.housekeepingTaskStatus || (['clean', 'inspected'].includes(normalize(unit.housekeepingStatus)) ? 'closed' : 'open');
      return [
        unit.unitNumber || unit.id,
        roomType.name || 'Room type',
        property.propertyName || listing.title || '-',
        unit.housekeepingStatus || 'dirty',
        priority,
        unit.housekeepingAssignedTo || 'Unassigned',
        unit.housekeepingDueAt ? dateValue(unit.housekeepingDueAt) : (activeNight.date || 'Today'),
        taskStatus,
        dashboardMeta('housekeeping', unit.id, unit.unitNumber || unit.id, taskStatus, { roomUnit: unit, roomType, property, listing: listingDetail(listing), roomNight: activeNight, booking: bookingDetail(booking) }, ['view', 'housekeeping', 'edit'])
      ];
    });
  const roomNightInventoryRows = visibleRoomNightInventories
    .slice()
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.roomUnitId || '').localeCompare(String(b.roomUnitId || '')))
    .map((night) => {
      const unit = roomUnitById(night.roomUnitId);
      const roomType = roomTypeById(night.roomTypeId);
      const listing = findListing(night.listingId) || {};
      const booking = night.bookingRef ? findBooking(night.bookingRef) : null;
      return [
        night.date || '-',
        unit.unitNumber || night.roomUnitId || '-',
        roomType.name || 'Room type',
        night.status || 'available',
        night.bookingRef || '-',
        night.guestName || bookingCustomer(booking || {}) || '-',
        moneyValue(night.price || roomType.basePrice || listing.priceFrom || 0, listing.currency || company.settings?.defaultCurrency || 'UGX'),
        dashboardMeta('room_night', night.id, `${unit.unitNumber || night.roomUnitId || 'Room'} ${night.date || ''}`.trim(), night.status || 'available', { roomNight: night, roomUnit: unit, roomType, booking: bookingDetail(booking), listing: listingDetail(listing) }, ['view', 'status', 'booking', 'manifest']),
      ];
    });
  let roomVisualMaps = visibleRoomTypes.map((roomType) => {
    const listing = findListing(roomType.listingId) || {};
    const units = visibleRoomUnits.filter((unit) => unit.roomTypeId === roomType.id && unit.status !== 'archived');
    const roomsForMap = units.map((unit) => {
      const nights = visibleRoomNightInventories.filter((night) => night.roomUnitId === unit.id).sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
      const activeNight = nights.find((night) => ['held', 'booked', 'occupied', 'checked-in', 'maintenance', 'cleaning', 'cancelled', 'refunded', 'reserved'].includes(normalize(night.status))) || nights[0] || {};
      const booking = activeNight.bookingRef ? findBooking(activeNight.bookingRef) : null;
      return {
        roomUnitId: unit.id,
        unitNumber: unit.unitNumber || unit.id,
        floor: unit.floor || '',
        wing: unit.wing || '',
        housekeepingStatus: unit.housekeepingStatus || 'clean',
        roomTypeId: roomType.id,
        roomTypeName: roomType.name || 'Room type',
        date: activeNight.date || '',
        dateRange: nights.length ? `${nights[0].date} to ${nights[nights.length - 1].date}` : 'No nightly inventory',
        status: activeNight.status || unit.status || 'available',
        bookingRef: activeNight.bookingRef || '',
        guestName: activeNight.guestName || bookingCustomer(booking || {}) || '',
        guestPhone: booking?.guestSnapshot?.phone || '',
        guestEmail: booking?.guestSnapshot?.email || '',
        checkIn: booking?.hotelStay?.checkIn || '',
        checkOut: booking?.hotelStay?.checkOut || '',
        price: activeNight.price || roomType.basePrice || listing.priceFrom || 0,
      };
    });
    return {
      roomTypeId: roomType.id,
      roomTypeName: roomType.name || 'Room type',
      propertyName: propertyById(roomType.propertyId).propertyName || listing.title || '-',
      listingId: listing.id || roomType.listingId,
      listingTitle: listing.title || 'Hotel listing',
      status: roomType.status || 'active',
      totals: {
        total: roomsForMap.length,
        available: roomsForMap.filter((room) => normalize(room.status) === 'available').length,
        held: roomsForMap.filter((room) => ['held', 'reserved'].includes(normalize(room.status))).length,
        booked: roomsForMap.filter((room) => ['booked', 'occupied', 'checked-in'].includes(normalize(room.status))).length,
        maintenance: roomsForMap.filter((room) => ['maintenance', 'cleaning'].includes(normalize(room.status))).length,
      },
      rooms: roomsForMap,
    };
  });
  if (!roomVisualMaps.length && visibleRooms.length) {
    roomVisualMaps = visibleRooms.map((room) => {
      const listing = findListing(room.listingId) || {};
      const roomBookings = bookings.filter((booking) => booking.listingId === room.listingId && (booking.passengers || []).some((passenger) => passenger.seatOrRoom === room.roomType || passenger.roomType === room.roomType));
      const bookedRooms = roomBookings.map((booking, index) => ({
        roomUnitId: `${room.id}-booking-${index + 1}`,
        unitNumber: `Booked ${index + 1}`,
        floor: '',
        wing: '',
        housekeepingStatus: 'guest-ready',
        roomTypeId: room.id,
        roomTypeName: room.roomType || 'Room type',
        date: booking.hotelStay?.checkIn || dateValue(booking.createdAt),
        dateRange: [booking.hotelStay?.checkIn, booking.hotelStay?.checkOut].filter(Boolean).join(' to ') || dateValue(booking.createdAt),
        status: booking.hotelStay?.status || booking.bookingStatus || 'booked',
        bookingRef: booking.bookingRef,
        guestName: bookingCustomer(booking),
        guestPhone: booking.guestSnapshot?.phone || '',
        guestEmail: booking.guestSnapshot?.email || '',
        checkIn: booking.hotelStay?.checkIn || '',
        checkOut: booking.hotelStay?.checkOut || '',
        price: room.nightlyPrice || listing.priceFrom || 0,
      }));
      const availableRooms = Array.from({ length: Math.max(0, Number(room.inventory || 0)) }).map((_, index) => ({
        roomUnitId: `${room.id}-available-${index + 1}`,
        unitNumber: `Open ${index + 1}`,
        floor: '',
        wing: '',
        housekeepingStatus: 'clean',
        roomTypeId: room.id,
        roomTypeName: room.roomType || 'Room type',
        date: '',
        dateRange: 'Available inventory',
        status: room.status === 'active' ? 'available' : room.status || 'available',
        bookingRef: '',
        guestName: '',
        guestPhone: '',
        guestEmail: '',
        checkIn: '',
        checkOut: '',
        price: room.nightlyPrice || listing.priceFrom || 0,
      }));
      const roomsForMap = [...bookedRooms, ...availableRooms];
      return {
        roomTypeId: room.id,
        roomTypeName: room.roomType || 'Room type',
        propertyName: listing.title || 'Hotel property',
        listingId: listing.id || room.listingId,
        listingTitle: listing.title || 'Hotel listing',
        status: room.status || 'active',
        totals: {
          total: roomsForMap.length,
          available: availableRooms.length,
          held: 0,
          booked: bookedRooms.length,
          maintenance: room.status === 'active' ? 0 : availableRooms.length,
        },
        rooms: roomsForMap,
      };
    });
  }
  const hotelArrivalRows = activeStayRows.map(hotelManifestRow);
  const hotelDepartureRows = activeStayRows.filter((booking) => {
    const status = normalize(booking.hotelStay?.status || booking.bookingStatus);
    return ['booked', 'confirmed', 'checked-in', 'occupied', 'checked-out', 'completed'].includes(status);
  }).map(hotelManifestRow);
  const hotelInHouseRows = activeStayRows.filter((booking) => {
    const status = normalize(booking.hotelStay?.status || booking.bookingStatus);
    return ['checked-in', 'occupied', 'in-house', 'in_house'].includes(status);
  }).map(hotelManifestRow);
  const bookedSeatGroups = seatMaps.map((map) => {
    const bookedOrHeld = (map.seats || []).filter((seat) => ['taken', 'booked', 'checked-in', 'checked_in', 'confirmed', 'locked', 'held', 'hold', 'selected', 'reserved'].includes(normalize(seat.status)));
    return {
      scheduleId: map.scheduleId,
      routeLabel: map.routeLabel || map.listingTitle || 'Route',
      vehicleName: map.vehicleName || 'Vehicle',
      travelDate: map.departAt ? dateValue(map.departAt) : 'Schedule date pending',
      status: map.status || 'active',
      totalBooked: bookedOrHeld.filter((seat) => ['taken', 'booked', 'checked-in', 'checked_in', 'confirmed'].includes(normalize(seat.status))).length,
      totalHeld: bookedOrHeld.filter((seat) => ['locked', 'held', 'hold', 'selected', 'reserved'].includes(normalize(seat.status))).length,
      seats: bookedOrHeld.map((seat) => ({
        seatNumber: seat.seatNumber,
        status: seat.status,
        bookingRef: seat.bookingRef || '',
        passengerName: seat.passengerName || '',
        passengerPhone: seat.passengerPhone || '',
        passengerEmail: seat.passengerEmail || '',
        paymentStatus: seat.paymentStatus || '',
        checkInStatus: seat.checkInStatus || '',
      })),
    };
  }).filter((group) => group.seats.length);
  const bookedRoomGroups = roomVisualMaps.map((map) => {
    const bookedOrHeld = (map.rooms || []).filter((room) => ['held', 'hold', 'reserved', 'booked', 'confirmed', 'occupied', 'checked-in', 'in-house'].includes(normalize(room.status)));
    return {
      roomTypeId: map.roomTypeId,
      roomTypeName: map.roomTypeName || 'Room type',
      propertyName: map.propertyName || map.listingTitle || 'Hotel',
      dateRange: bookedOrHeld[0]?.dateRange || 'Date range pending',
      status: map.status || 'active',
      totalBooked: bookedOrHeld.filter((room) => ['booked', 'confirmed', 'occupied', 'checked-in', 'in-house'].includes(normalize(room.status))).length,
      totalHeld: bookedOrHeld.filter((room) => ['held', 'hold', 'reserved'].includes(normalize(room.status))).length,
      rooms: bookedOrHeld.map((room) => ({
        roomUnitId: room.roomUnitId,
        unitNumber: room.unitNumber,
        status: room.status,
        bookingRef: room.bookingRef || '',
        guestName: room.guestName || '',
        guestPhone: room.guestPhone || '',
        guestEmail: room.guestEmail || '',
        checkIn: room.checkIn || '',
        checkOut: room.checkOut || '',
        date: room.date || '',
      })),
    };
  }).filter((group) => group.rooms.length);
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
      canPublish: company.settings?.canPublish !== false,
      logo: company.logo || null,
      coverImage: company.coverImage || null,
      documents: Array.isArray(company.documents) ? company.documents : [],
      reviewedBy: company.reviewedBy || '',
      reviewedAt: company.reviewedAt || '',
      reviewNotes: company.reviewNotes || '',
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
      routeCount: visibleRoutes.length.toLocaleString(),
      vehicleCount: visibleVehicles.filter((vehicle) => vehicle.status !== 'archived').length.toLocaleString(),
      roomTypes: (visibleRoomTypes.length || visibleRooms.length).toLocaleString(),
      blockedSeats: blockedSeats.toLocaleString(),
      checkedIn: checkedInBookings.length.toLocaleString(),
    },
    serviceProfile,
    options: {
      listings: listings.map(listingOption),
      busListings: listings.filter((listing) => listing.serviceType === 'bus').map(listingOption),
      hotelListings: listings.filter((listing) => listing.serviceType === 'hotel').map(listingOption),
      transportListings: listings.filter((listing) => ROUTED_SERVICE_TYPES.includes(listing.serviceType)).map(listingOption),
      routes: visibleRoutes.filter((route) => route.status !== 'archived').map(routeOption),
      vehicles: visibleVehicles.filter((vehicle) => vehicle.status !== 'archived').map(vehicleOption),
      drivers: (state.companyEmployees || []).filter((employee) => employee.companyId === companyId && (/driver/i.test(employee.roleTitle || '') || (employee.permissions || []).includes('trip_status'))).map((employee) => ({ id: employee.id, value: employee.id, label: employee.fullName || employee.email || employee.phone || employee.id, status: employee.status })),
      hotelProperties: visibleHotelProperties.filter((property) => property.status !== 'archived').map((property) => ({ id: property.id, value: property.id, label: property.propertyName || property.id, listingId: property.listingId, status: property.status })),
      roomTypes: visibleRoomTypes.filter((roomType) => roomType.status !== 'archived').map((roomType) => ({ id: roomType.id, value: roomType.id, label: roomType.name || roomType.id, listingId: roomType.listingId, propertyId: roomType.propertyId, status: roomType.status })),
      roomUnits: visibleRoomUnits.filter((unit) => unit.status !== 'archived').map((unit) => ({ id: unit.id, value: unit.id, label: unit.unitNumber || unit.id, roomTypeId: unit.roomTypeId, propertyId: unit.propertyId, status: unit.status })),
      schedules: visibleSchedules.filter((schedule) => schedule.status !== 'archived').map(scheduleOption),
      rooms: visibleRooms.filter((room) => room.status !== 'archived').map(roomOption),
      branches: companyBranches.filter((branch) => branch.status !== 'archived').map(branchOption),
      drivers: serviceProfile.supportsTransport ? companyEmployees.filter((employee) => /driver/i.test(employee.roleTitle || '') || (employee.permissions || []).some((permission) => ['driver_manifest', 'trip_status'].includes(permission))).map(driverOption) : [],
    },
    recentBookings: bookings.slice(0, 8).map((booking) => [booking.bookingRef, bookingTitle(booking), bookingCustomer(booking), booking.passengers?.[0]?.seatOrRoom || 'Selected', booking.bookingStatus, bookingTotal(booking)]),
    seatMaps,
    roomVisualMaps,
    bookedSeatGroups,
    bookedRoomGroups,
    listings: listings.map((listing) => [
      listing.title,
      listing.type,
      listing.serviceType === 'hotel' ? [listing.city, listing.country].filter(Boolean).join(', ') : `${listing.from} to ${listing.to}`,
      listing.serviceType === 'hotel' ? `${roomsForListing(listing.id).length} room types` : `${schedulesForListing(listing.id).length} schedules`,
      moneyValue(listing.priceFrom),
      listing.status,
      { entity: 'listing', id: listing.id, label: listing.title, status: listing.status, detail: { listing, company: companyDetail(company) } },
    ]),
    routes: visibleRoutes.map((route) => [
      route.routeName || `${route.origin} to ${route.destination}`,
      bookingTitle({ listingId: route.listingId }),
      `${route.boardingPoints?.length || 0} boarding`,
      `${route.dropoffPoints?.length || 0} dropoffs`,
      route.corridor || '',
      route.status,
      { entity: 'route', id: route.id, label: route.routeName || `${route.origin} to ${route.destination}`, status: route.status, detail: { route, listing: listingDetail(findListing(route.listingId) || {}), company: companyDetail(company) } },
    ]),
    routeStops: visibleRouteStops.map((stop) => {
      const route = visibleRoutes.find((item) => item.id === stop.routeId) || {};
      return [
        route.routeName || `${route.origin || ''} to ${route.destination || ''}`.trim() || stop.routeId,
        stop.name,
        stop.stopType || 'intermediate',
        String(stop.stopOrder || 0),
        String(stop.timeOffsetMinutes || 0),
        stop.status || 'active',
        { entity: 'routeStop', id: stop.id, label: stop.name, status: stop.status || 'active', detail: { routeStop: stop, route, company: companyDetail(company) } },
      ];
    }),
    schedules: visibleSchedules.slice(0, 24).map((schedule) => {
      const totalSeats = Number(schedule.totalSeats || 0);
      const sold = Math.max(0, totalSeats - Number(schedule.availableSeats || 0) - seatsForSchedule(schedule.id).filter((seat) => ['locked', 'blocked'].includes(seat.status)).length);
      const vehicle = visibleVehicles.find((item) => item.id === schedule.vehicleId);
      return [
        schedule.id,
        bookingTitle({ listingId: schedule.listingId }),
        scheduleLabel(schedule),
        vehicle?.name || schedule.vehicleName || 'Vehicle pending',
        `${sold}/${totalSeats}`,
        schedule.status,
        { entity: 'schedule', id: schedule.id, label: schedule.id, status: schedule.status, detail: { schedule, route: visibleRoutes.find((item) => item.id === schedule.routeId) || {}, vehicle, listing: listingDetail(findListing(schedule.listingId) || {}), company: companyDetail(company) } },
      ];
    }),
    vehicles: visibleVehicles.map((vehicle) => [
      vehicle.name,
      SERVICE_LABELS[vehicle.serviceType] || vehicle.serviceType || 'Vehicle',
      vehicle.plateOrCode || '-',
      `${vehicle.totalSeats || 0} seats`,
      vehicle.layoutName || 'Layout pending',
      vehicle.status,
      { entity: 'vehicle', id: vehicle.id, label: vehicle.name, status: vehicle.status, detail: { vehicle, listing: listingDetail(findListing(vehicle.listingId) || {}), company: companyDetail(company) } },
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
    hotelProperties: hotelPropertyRows,
    roomTypes: roomTypeRows,
    roomUnits: roomUnitRows,
    hotelHousekeepingTasks,
    roomNightInventory: roomNightInventoryRows,
    hotelArrivals: hotelArrivalRows,
    hotelDepartures: hotelDepartureRows,
    hotelInHouse: hotelInHouseRows,
    financeSummary: companyFinance.summary,
    revenueDrilldown: companyFinance.revenueRows,
    settlementBatches: companyFinance.settlementRows,
    settlementLedger: companyFinance.ledgerRows,
    payoutRequests: companyFinance.payoutRows,
    financeStatements: companyFinance.statementRows,
    payouts: companyFinance.revenueRows,
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
    branches: companyBranches.map((branch) => [
      branch.name,
      branch.branchType || 'terminal',
      [branch.city, branch.country].filter(Boolean).join(', '),
      (branch.serviceCategories || []).join(', '),
      branch.operatingHours || '-',
      branch.status || 'active',
      { entity: 'branch', id: branch.id, label: branch.name, status: branch.status || 'active', detail: { branch, company: companyDetail(company) } },
    ]),
    policies: companyPolicies.map((policy) => [
      policy.title,
      policy.policyType || 'operations',
      policy.serviceCategory || 'all',
      policy.customerVisible ? 'Customer visible' : 'Internal',
      policy.summary || '-',
      policy.status || 'active',
      { entity: 'policy', id: policy.id, label: policy.title, status: policy.status || 'active', detail: { policy, company: companyDetail(company) } },
    ]),
    staff: companyEmployees.map((employee) => {
      const user = state.users.find((item) => item.id === employee.userId) || {};
      return [user.fullName || user.email || employee.userId, employee.roleTitle || 'Staff', employee.branch || 'Main branch', (employee.permissions || []).join(', '), user.lastLoginAt ? dateValue(user.lastLoginAt) : 'Invited', employee.status || user.status || 'active', { entity: 'employee', id: employee.id, label: user.fullName || user.email || employee.userId, status: employee.status || user.status || 'active' }];
    }),
    drivers: (serviceProfile.supportsTransport ? companyEmployees : [])
      .filter((employee) => /driver/i.test(employee.roleTitle || '') || (employee.permissions || []).some((permission) => ['driver_manifest', 'trip_status'].includes(permission)))
      .map((employee) => {
        const user = state.users.find((item) => item.id === employee.userId) || {};
        return [
          user.fullName || user.email || employee.userId,
          employee.licenseNumber || '-',
          employee.safetyStatus || 'pending_review',
          (employee.permissions || []).join(', '),
          employee.branch || employee.assignedFleetId || '-',
          employee.status || user.status || 'active',
          { entity: 'driver', id: employee.id, label: user.fullName || user.email || employee.id, status: employee.status || user.status || 'active', detail: { driver: employee, user, company: companyDetail(company) } },
        ];
      }),
    driverAssignments: (serviceProfile.supportsTransport ? driverAssignments : []).map((assignment) => {
      const employee = companyEmployees.find((item) => item.id === assignment.employeeId) || {};
      const user = state.users.find((item) => item.id === employee.userId || item.id === assignment.driverUserId) || {};
      const vehicle = visibleVehicles.find((item) => item.id === assignment.vehicleId) || {};
      return [
        user.fullName || user.email || assignment.employeeId,
        vehicle.name || assignment.vehicleId || '-',
        assignment.scheduleId || '-',
        assignment.assignmentType || 'schedule',
        assignment.safetyStatus || employee.safetyStatus || '-',
        assignment.status || 'active',
        { entity: 'driverAssignment', id: assignment.id, label: assignment.scheduleId || assignment.id, status: assignment.status || 'active', detail: { assignment, driver: employee, user, vehicle, schedule: state.schedules.find((item) => item.id === assignment.scheduleId) || {}, company: companyDetail(company) } },
      ];
    }),
    driverIncidents: (serviceProfile.supportsTransport ? driverIncidents : []).map((incident) => [
      incident.id,
      incident.scheduleId || incident.bookingRef || '-',
      incident.category || 'general',
      incident.severity || 'normal',
      incident.title || incident.description || '-',
      incident.status || 'open',
      { entity: 'driverIncident', id: incident.id, label: incident.title || incident.id, status: incident.status || 'open', detail: { incident, company: companyDetail(company) } },
    ]),
    tripStatusUpdates: (serviceProfile.supportsTransport ? tripStatusUpdates : []).map((update) => [
      update.scheduleId,
      update.status,
      update.location || '-',
      update.note || '-',
      update.createdBy || update.driverUserId || '-',
      update.createdAt ? dateValue(update.createdAt) : 'Recent',
      { entity: 'tripStatusUpdate', id: update.id, label: update.scheduleId, status: update.status, detail: { tripStatusUpdate: update, company: companyDetail(company) } },
    ]),
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
      const meta = rowMetaLike(row);
      const route = state.routes.find((item) => item.companyId === companyId && (item.id === meta?.id || item.routeName === row[0] || `${item.origin} to ${item.destination}` === row[0])) || {};
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
    financeSummary: data.financeSummary || {},
    revenueDrilldown: data.revenueDrilldown || [],
    settlementBatches: data.settlementBatches || [],
    settlementLedger: data.settlementLedger || [],
    payoutRequests: data.payoutRequests || [],
    financeStatements: data.financeStatements || [],
    payouts: (data.payouts || []).map((row) => withMeta(row, dashboardMeta('payout', row[0], row[1] || row[0], row[9] || row[6], { payout: { transactionId: row[0], bookingRef: row[1], service: row[2], gross: row[3], ownerEarnings: row[4], platformFee: row[5], promoterCommission: row[6], refundDebit: row[7], netPayable: row[8], status: row[9] || row[6] }, company: companyDetail(findCompany(companyId)) }, ['view', 'request_payout', 'export']))),
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
  const driverMode = Boolean(context.driverMode);
  const company = findCompany(companyId) || {};
  const employeeUser = state.users.find((user) => user.id === employeeId) || state.users.find((user) => user.companyId === companyId && user.role === 'company_employee') || {};
  const employeeProfile = (Array.isArray(state.companyEmployees) ? state.companyEmployees : []).find((employee) => employee.companyId === companyId && employee.userId === employeeUser.id) || {};
  const listings = state.listings.filter((listing) => listing.companyId === companyId);
  const assignedScheduleIds = new Set((Array.isArray(state.driverAssignments) ? state.driverAssignments : [])
    .filter((assignment) => assignment.companyId === companyId && (!employeeProfile.id || assignment.employeeId === employeeProfile.id || assignment.driverUserId === employeeUser.id))
    .map((assignment) => assignment.scheduleId)
    .filter(Boolean));
  const allCompanySchedules = state.schedules.filter((schedule) => schedule.companyId === companyId && schedule.status !== 'archived');
  let schedules = allCompanySchedules
    .filter((schedule) => !driverMode || !assignedScheduleIds.size || assignedScheduleIds.has(schedule.id) || schedule.driverEmployeeId === employeeProfile.id || schedule.driverUserId === employeeUser.id)
    .slice(0, 50);
  // For local/demo driver accounts, do not leave Driver Ops blank just because
  // a seed assignment belongs to a different test user. Show active company trips.
  if (driverMode && !schedules.length) schedules = allCompanySchedules.slice(0, 50);
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

  const driverIncidentRows = (Array.isArray(state.driverIncidents) ? state.driverIncidents : [])
    .filter((incident) => incident.companyId === companyId && (!driverMode || schedules.some((schedule) => schedule.id === incident.scheduleId) || incident.driverUserId === employeeUser.id || incident.employeeId === employeeProfile.id || incident.employeeId === employeeUser.id))
    .map((incident) => withMeta([
      incident.id,
      incident.scheduleId || incident.bookingRef || '-',
      incident.category || incident.incidentType || 'general',
      incident.severity || 'normal',
      incident.title || incident.description || incident.notes || '-',
      incident.status || 'open',
    ], dashboardMeta('driverIncident', incident.id, incident.title || incident.id, incident.status || 'open', { incident, company: companyDetail(company) }, ['view', 'export'])));

  const tripStatusRows = (Array.isArray(state.tripStatusUpdates) ? state.tripStatusUpdates : [])
    .filter((update) => update.companyId === companyId && (!driverMode || schedules.some((schedule) => schedule.id === update.scheduleId) || update.driverUserId === employeeUser.id || update.updatedBy === employeeUser.id))
    .map((update) => withMeta([
      update.scheduleId,
      update.status,
      update.location || update.gate || '-',
      update.note || update.message || '-',
      update.createdAt ? dateValue(update.createdAt) : update.updatedAt ? dateValue(update.updatedAt) : 'Recent',
      update.createdBy || update.updatedBy || update.driverUserId || '-',
    ], dashboardMeta('tripStatusUpdate', update.id, update.scheduleId, update.status, { tripStatusUpdate: update, company: companyDetail(company) }, ['view', 'export'])));

  const driverScheduleFallbackRows = driverMode ? schedules.slice(0, 20).map((schedule) => withMeta([
    schedule.id,
    bookingCustomer({}) || 'Manifest pending',
    bookingTitle({ listingId: schedule.listingId }),
    'Seat assignment pending',
    schedule.departAt ? dateValue(schedule.departAt) : 'Departure pending',
    schedule.status || 'active',
  ], dashboardMeta('manifest', schedule.id, schedule.id, schedule.status || 'active', scheduleDetail(schedule), ['view', 'manifest', 'export']))) : [];

  const safeCheckinRows = checkinRows.length ? checkinRows : driverScheduleFallbackRows;
  const safeDriverOpsRows = scheduleRows.length ? scheduleRows : (driverMode ? schedules.map((schedule) => withMeta([
    schedule.id,
    bookingTitle({ listingId: schedule.listingId }),
    schedule.departAt ? dateValue(schedule.departAt) : 'Departure pending',
    schedule.vehicleName || state.vehicles.find((vehicle) => vehicle.id === schedule.vehicleId)?.name || 'Vehicle pending',
    `0/${schedule.totalSeats || 0}`,
    schedule.status || 'active',
  ], dashboardMeta('schedule', schedule.id, schedule.id, schedule.status || 'active', scheduleDetail(schedule), ['view', 'manifest', 'seat_map', 'export']))) : []);
  const safeTripStatusRows = tripStatusRows.length ? tripStatusRows : (driverMode ? schedules.slice(0, 8).map((schedule) => withMeta([
    schedule.id,
    schedule.status || 'scheduled',
    schedule.gate || schedule.platform || 'Terminal',
    'No driver update recorded yet',
    schedule.updatedAt ? dateValue(schedule.updatedAt) : 'Ready',
    employeeUser.fullName || 'Driver',
  ], dashboardMeta('tripStatusUpdate', `${schedule.id}-status`, schedule.id, schedule.status || 'scheduled', { schedule: scheduleDetail(schedule), company: companyDetail(company) }, ['view', 'export']))) : []);
  const safeDriverIncidentRows = driverIncidentRows.length ? driverIncidentRows : (driverMode ? [withMeta([
    'No open incidents',
    schedules[0]?.id || 'All assigned trips',
    'safety',
    'normal',
    'No incident has been reported for the assigned trips.',
    'clear',
  ], dashboardMeta('driverIncident', 'no-open-incidents', 'No open incidents', 'clear', { message: 'No driver incidents have been reported for this dashboard scope.', company: companyDetail(company) }, ['view']))] : []);
  const safeInventoryRows = enrichedInventory.length ? enrichedInventory : (companyDashboard.inventory && companyDashboard.inventory.length ? companyDashboard.inventory : (driverMode ? schedules.flatMap((schedule) => [withMeta([
    schedule.id,
    'Seats',
    bookingTitle({ listingId: schedule.listingId }),
    moneyValue(schedule.basePrice || findListing(schedule.listingId)?.priceFrom || 0, schedule.currency || findListing(schedule.listingId)?.currency || 'UGX'),
    `${schedule.availableSeats || 0} available`,
    '-',
    schedule.status || 'active',
  ], dashboardMeta('inventory', `${schedule.id}-inventory`, schedule.id, schedule.status || 'active', scheduleDetail(schedule), ['view', 'seat_map', 'export']))]) : []));

  return {
    mode: driverMode ? 'driver' : 'employee',
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
      roleTitle: driverMode ? (employeeProfile.roleTitle || 'Driver') : (employeeProfile.roleTitle || 'Ticket Checker'),
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
      vehicles: state.vehicles.filter((vehicle) => vehicle.companyId === companyId && vehicle.status !== 'archived').map((vehicle) => ({ id: vehicle.id, value: vehicle.id, label: `${vehicle.name || vehicle.id}${vehicle.plateOrCode ? ` - ${vehicle.plateOrCode}` : ''}`, listingId: vehicle.listingId, serviceType: vehicle.serviceType, status: vehicle.status })),
      rooms: rooms.filter((room) => room.status !== 'archived').map((room) => ({ id: room.id, value: room.id, label: `${room.roomType} - ${bookingTitle({ listingId: room.listingId })}`, listingId: room.listingId, status: room.status })),
    },
    tasks: supportRows,
    driverOps: safeDriverOpsRows,
    driverIncidents: safeDriverIncidentRows,
    tripStatusUpdates: safeTripStatusRows,
    checkins: safeCheckinRows,
    bookings: rows,
    schedules: scheduleRows.length ? scheduleRows : safeDriverOpsRows,
    routes: state.routes.filter((route) => route.companyId === companyId && route.status !== 'archived').map((route) => {
      const listing = findListing(route.listingId) || {};
      return [
        route.routeName || `${route.origin || listing.from || '-'} to ${route.destination || listing.to || '-'}`,
        listing.title || route.listingId || '-',
        `${(route.boardingPoints || []).length} boarding`,
        `${(route.dropoffPoints || []).length} dropoffs`,
        route.corridor || '-',
        route.status || 'active',
        dashboardMeta('route', route.id, route.routeName || `${route.origin || '-'} to ${route.destination || '-'}`, route.status || 'active', { route, listing: listingDetail(listing), company: companyDetail(findCompany(companyId) || {}) }, ['view', 'schedule']),
      ];
    }),
    vehicles: state.vehicles.filter((vehicle) => vehicle.companyId === companyId && vehicle.status !== 'archived').map((vehicle) => [
      vehicle.name || vehicle.id,
      SERVICE_LABELS[vehicle.serviceType] || vehicle.serviceType || 'Vehicle',
      vehicle.plateOrCode || '-',
      `${vehicle.totalSeats || vehicle.capacity || 0} seats`,
      vehicle.layoutName || 'Layout pending',
      vehicle.status || 'active',
      dashboardMeta('vehicle', vehicle.id, vehicle.name || vehicle.id, vehicle.status || 'active', { vehicle, listing: listingDetail(findListing(vehicle.listingId) || {}), company: companyDetail(findCompany(vehicle.companyId) || {}) }, ['view', 'schedule', 'manifest']),
    ]),
    inventory: safeInventoryRows,
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
      [currentTicket.serviceType === 'bus' ? 'Seat' : 'Seat / room', (currentTicket.passengers || []).map((pax) => currentTicket.serviceType === 'bus' ? displaySeatNo(pax.seatOrRoom || pax.seatNumber) : (pax.seatOrRoom || pax.seatNumber)).filter(Boolean).join(', ') || 'Assigned at check-in'],
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
  const promoterOfflineSales = (state.offlineSales || []).filter((sale) => sale.agentId === promoterId);
  const offlineSaleRows = promoterOfflineSales.map((sale) => [
    sale.saleRef || sale.id,
    sale.bookingRef || '-',
    sale.customerName || sale.passengerName || '-',
    findListing(sale.listingId)?.title || sale.listingId || '-',
    sale.paymentMethod || '-',
    moneyValue(sale.amountCollected || 0, sale.currency || 'UGX'),
    sale.status || 'completed',
    dashboardMeta('agent_sale', sale.id, sale.saleRef || sale.id, sale.status || 'completed', { sale, booking: sale.bookingRef ? bookingDetail(findBooking(sale.bookingRef)) : null }, ['view', 'booking', 'receipt', 'export']),
  ]);
  const promoterReferralClickRows = (state.referralClicks || []).filter((click) => click.promoterId === promoterId).map((click) => [
    click.id,
    click.code || '-',
    promoterUser.fullName || promoterId,
    findListing(click.listingId)?.title || click.listingId || '-',
    click.ip || '-',
    click.createdAt ? dateValue(click.createdAt) : '-',
    dashboardMeta('referral_click', click.id, click.code || click.id, 'tracked', { click, promoter: promoter.promoter }, ['view', 'export']),
  ]);
  const promoterAttributionRows = (state.attributionSessions || []).filter((session) => session.promoterId === promoterId).map((session) => [
    session.id,
    session.referralCode || '-',
    promoterUser.fullName || promoterId,
    findListing(session.listingId)?.title || session.listingId || '-',
    session.status || 'active',
    session.bookingRef || '-',
    session.createdAt ? dateValue(session.createdAt) : '-',
    dashboardMeta('attribution_session', session.id, session.referralCode || session.id, session.status || 'active', { session, promoter: promoter.promoter }, ['view', 'export']),
  ]);
  const promoterConversionRows = (state.campaignConversions || []).filter((conversion) => conversion.promoterId === promoterId).map((conversion) => [
    conversion.id,
    conversion.campaignId || conversion.linkId || '-',
    promoterUser.fullName || promoterId,
    conversion.bookingRef || '-',
    moneyValue(conversion.amount || 0, conversion.currency || 'UGX'),
    moneyValue(conversion.commissionAmount || 0, conversion.currency || 'UGX'),
    conversion.status || 'converted',
    dashboardMeta('campaign_conversion', conversion.id, conversion.bookingRef || conversion.id, conversion.status || 'converted', { conversion, booking: conversion.bookingRef ? bookingDetail(findBooking(conversion.bookingRef)) : null }, ['view', 'booking', 'export']),
  ]);
  const promoterReferralCardRows = links.map((link) => [
    link.id,
    promoterUser.fullName || promoterId,
    link.code || link.referralCode || '-',
    findListing(link.listingId)?.title || link.listingId || '-',
    link.qrCardUrl || `/promoter/links/${link.id}/qr-card`,
    link.status || 'active',
    dashboardMeta('referral_card', link.id, link.code || link.id, link.status || 'active', { link, promoter: promoter.promoter }, ['view', 'qr', 'export']),
  ]);
  const promoterFraudSignalRows = (state.fraudSignals || []).filter((signal) => signal.promoterId === promoterId || signal.agentId === promoterId).map((signal) => [
    signal.id,
    promoterUser.fullName || promoterId,
    signal.bookingRef || '-',
    signal.signalType || 'booking_risk',
    signal.severity || '-',
    String(signal.score || 0),
    signal.status || 'open',
    dashboardMeta('fraud_signal', signal.id, signal.bookingRef || signal.id, signal.status || 'open', { signal, booking: signal.bookingRef ? bookingDetail(findBooking(signal.bookingRef)) : null }, ['view', 'booking', 'export']),
  ]);

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
    offlineSales: offlineSaleRows,
    agentSales: offlineSaleRows,
    referralClicks: promoterReferralClickRows,
    attributionSessions: promoterAttributionRows,
    campaignConversions: promoterConversionRows,
    referralCards: promoterReferralCardRows,
    fraudSignals: promoterFraudSignalRows,
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
  let hotelSelection = null;

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
  const saved = findUserByIdentity(user.email || user.phone);
  persistRow('users', saved);
  return saved;
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
  persistRow('referralClicks', click);
  if (link) {
    link.clicks += 1;
    persistRow('promoterLinks', link);
  }
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
    const existingConversion = promoterLink
      ? state.campaignConversions.some((row) => row.bookingRef === booking.bookingRef && row.linkId === promoterLink.id)
      : false;
    if (promoterLink && !existingConversion) promoterLink.conversions = Number(promoterLink.conversions || 0) + 1;
  }
  const activeCampaign = listing ? state.promotionCampaigns.find((campaign) => campaign.listingId === listing.id && campaign.status === 'active') : null;
  if (activeCampaign) activeCampaign.bookings = Number(activeCampaign.bookings || 0) + 1;
  booking.settlementStatus = 'settled';
  booking.settledAt = new Date().toISOString();
  persistRow('bookings', booking);
  persistRows('wallets', state.wallets || []);
  persistRows('walletTransactions', state.walletTransactions || []);
  persistRows('commissions', state.commissions || []);
  if (promoterLink) persistRow('promoterLinks', promoterLink);
  if (activeCampaign) persistRow('promotionCampaigns', activeCampaign);
  return booking;
}

function parsePayloadArray(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (error) {
    return fallback;
  }
}

function listPayloadValues(value) {
  if (Array.isArray(value)) return value.flatMap((item) => listPayloadValues(item));
  return String(value || '').split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
}

function passengerInputFromPayload(payload = {}) {
  const explicit = parsePayloadArray(payload.passengers, []);
  if (explicit.length) return explicit;
  const names = listPayloadValues(payload.passengerNames || payload.passengerFullName || []);
  const phones = listPayloadValues(payload.passengerPhones || payload.passengerPhone || []);
  const emails = listPayloadValues(payload.passengerEmails || payload.passengerEmail || []);
  const pickups = listPayloadValues(payload.pickupPoints || payload.pickupPoint || []);
  const dropoffs = listPayloadValues(payload.dropoffPoints || payload.dropoffPoint || []);
  const notes = listPayloadValues(payload.passengerNotes || payload.passengerNote || []);
  const count = Math.max(names.length, phones.length, emails.length, pickups.length, dropoffs.length, notes.length);
  return Array.from({ length: count }).map((_, index) => ({
    fullName: names[index] || '',
    phone: phones[index] || '',
    email: emails[index] || '',
    pickupPoint: pickups[index] || '',
    dropoffPoint: dropoffs[index] || '',
    notes: notes[index] || '',
    specialNotes: notes[index] || '',
  }));
}

function cleanSeatToken(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withoutPrefix = raw.replace(/^seat\s*(no\.?|number)?\s*/i, '').trim();
  const legacy = withoutPrefix.match(/^[A-Za-z](\d+)$/);
  return legacy ? legacy[1] : withoutPrefix;
}

function displaySeatNo(value) {
  const clean = cleanSeatToken(value);
  return clean ? `Seat No ${clean}` : 'Seat pending';
}

function seatListFrom(value) {
  if (Array.isArray(value)) return value.flatMap((seat) => seatListFrom(seat));
  return String(value || '').split(',').map((seat) => cleanSeatToken(seat)).filter(Boolean);
}

function qrNonceFor(bookingRef, scheduleId, seatNumber, index) {
  return crypto.createHash('sha1').update(`${bookingRef}:${scheduleId}:${seatNumber}:${index}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 16).toUpperCase();
}

function qrPublicValueForLeg(bookingRef, leg = {}) {
  if (!leg || !bookingRef) return '';
  if (leg.qrToken) return leg.qrToken;
  if (!leg.qrNonce) return '';
  return `CTQR-${bookingRef}-${leg.id}-${leg.qrNonce}`;
}

function qrHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function qrPreview(token = '') {
  const value = String(token || '');
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function isoHotelDate(value, fallback = new Date()) {
  const date = value ? new Date(value) : new Date(fallback);
  return Number.isNaN(date.getTime()) ? new Date(fallback).toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
}

function hotelNightRangeFromPayload(payload = {}) {
  const checkIn = isoHotelDate(payload.checkInDate || payload.checkIn || payload.startDate);
  const fallbackOut = new Date(`${checkIn}T00:00:00.000Z`);
  fallbackOut.setUTCDate(fallbackOut.getUTCDate() + Math.max(1, Number(payload.nights || 1)));
  const checkOut = isoHotelDate(payload.checkOutDate || payload.checkOut || payload.endDate || fallbackOut);
  const start = new Date(`${checkIn}T00:00:00.000Z`);
  const end = new Date(`${checkOut}T00:00:00.000Z`);
  const nights = [];
  if (end > start) {
    for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) nights.push(d.toISOString().slice(0, 10));
  }
  if (!nights.length) nights.push(checkIn);
  return { checkIn, checkOut, nights };
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
  const explicitPromoterAttribution = !req && payload.promoterAttribution ? payload.promoterAttribution : null;
  const promoterAttribution = hasValidReferral
    ? { promoterId: promoterLink.promoterId, linkId: promoterLink.id, code: promoterLink.code }
    : explicitPromoterAttribution;
  let scheduleId = payload.scheduleId || schedulesForListing(listing.id)[0]?.id || null;
  let selected = payload.selected || payload.seatNumber || payload.roomId || (listing.serviceType === 'bus' ? '1' : 'Room 201');
  let subtotal = Number(listing.priceFrom) || 0;
  const passengerInput = passengerInputFromPayload(payload);
  const busLegSelections = [];
  let tripType = 'one_way';

  if (listing.serviceType === 'bus') {
    const schedule = state.schedules.find((item) => item.id === scheduleId) || schedulesForListing(listing.id)[0];
    scheduleId = schedule?.id || null;
    const passengerCount = Math.max(1, passengerInput.length, seatListFrom(payload.selectedSeats || payload.selected || payload.seatNumber).length, seatListFrom(payload.returnSeats).length);

    const reserveSeats = (legSchedule, requestedSeats, legType) => {
      if (!legSchedule) {
        const error = new Error('Selected schedule is no longer available');
        error.status = 409;
        throw error;
      }
      const seats = seatsForSchedule(legSchedule.id);
      const used = new Set();
      const requested = seatListFrom(requestedSeats);
      const selections = [];
      for (let index = 0; index < passengerCount; index += 1) {
        const requestedSeat = requested[index];
        let seat = requestedSeat ? seats.find((item) => item.seatNumber === requestedSeat) : null;
        if (!seat) seat = seats.find((item) => item.status === 'available' && !used.has(item.seatNumber));
        if (seat?.status === 'locked' && seat.lockedUntil && new Date(seat.lockedUntil) <= new Date()) {
          seat.status = 'available';
          seat.lockedUntil = null;
          seat.lockId = null;
        }
        if (seat?.status === 'taken' && !seat.bookingRef) {
          // Legacy local/demo cleanup: old failed checkout attempts could mark a seat
          // taken without a booking reference. Treat it as reusable.
          seat.status = 'available';
          seat.lockedUntil = null;
          seat.lockId = null;
        }
        const lockedByAnotherCheckout = seat?.status === 'locked' && (!payload.holdId || seat.lockId !== payload.holdId);
        if (!seat || used.has(seat.seatNumber) || ['taken', 'booked', 'blocked', 'maintenance', 'disabled'].includes(seat.status) || lockedByAnotherCheckout) {
          seat = seats.find((item) => item.status === 'available' && !used.has(item.seatNumber));
        }
        if (!seat || used.has(seat.seatNumber) || ['taken', 'booked', 'blocked', 'maintenance', 'disabled'].includes(seat.status)) {
          const error = new Error('Selected seat is no longer available');
          error.status = 409;
          throw error;
        }
        used.add(seat.seatNumber);
        seat.status = 'taken';
        seat.bookingRef = seat.bookingRef || '';
        seat.lockedUntil = null;
        seat.lockId = null;
        const price = Number(legSchedule.basePrice || listing.priceFrom || 0) + Number(seat.priceDelta || 0);
        selections.push({ legType, schedule: legSchedule, seat, passengerIndex: index, price });
      }
      legSchedule.availableSeats = Math.max(0, Number(legSchedule.availableSeats || 0) - selections.length);
      return selections;
    };

    const outboundSelections = reserveSeats(schedule, payload.selectedSeats || payload.selected || payload.seatNumber, 'outbound');
    busLegSelections.push(...outboundSelections);
    if (payload.returnScheduleId) {
      const returnSchedule = state.schedules.find((item) => item.id === payload.returnScheduleId && item.listingId === listing.id);
      tripType = 'round_trip';
      busLegSelections.push(...reserveSeats(returnSchedule, payload.returnSeats, 'return'));
    }
    selected = outboundSelections.map((selection) => selection.seat.seatNumber).join(',');
    subtotal = busLegSelections.reduce((total, selection) => total + selection.price, 0);
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
    const hotelRange = hotelNightRangeFromPayload(payload);
    room.inventory -= 1;
    selected = room.roomType;
    subtotal = Number(room.nightlyPrice || listing.priceFrom || 0) * hotelRange.nights.length;
    hotelSelection = { room, ...hotelRange };
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
  const outboundSelections = busLegSelections.filter((selection) => selection.legType === 'outbound');
  const passengerRows = listing.serviceType === 'bus'
    ? Array.from({ length: Math.max(1, passengerInput.length, outboundSelections.length) }).map((_, index) => {
      const input = passengerInput[index] || {};
      const seat = outboundSelections[index]?.seat;
      return {
        id: `passenger-${state.passengers.length + index + 1}`,
        fullName: input.fullName || input.name || (index === 0 ? payload.passengerName || payload.fullName : `${payload.fullName || 'Guest Customer'} ${index + 1}`),
        email: input.email || payload.email || '',
        phone: input.phone || payload.phone || '',
        seatOrRoom: seat?.seatNumber || selected,
        seatNumber: seat?.seatNumber || selected,
        pickupPoint: input.pickupPoint || payload.pickupPoint || '',
        dropoffPoint: input.dropoffPoint || payload.dropoffPoint || '',
        specialNotes: input.specialNotes || input.travelNotes || input.notes || '',
      };
    })
    : [{ fullName: payload.passengerName || payload.fullName || 'Guest Customer', seatOrRoom: selected }];
  const bookingLegs = listing.serviceType === 'bus'
    ? Array.from(new Map(busLegSelections.map((selection) => [selection.legType, selection])).values()).map((selection) => ({
      legType: selection.legType,
      scheduleId: selection.schedule.id,
      listingId: listing.id,
      companyId: listing.companyId,
      departAt: selection.schedule.departAt,
      arriveAt: selection.schedule.arriveAt,
      status: 'confirmed',
    }))
    : [];
  const bookingItems = listing.serviceType === 'bus'
    ? busLegSelections.map((selection, index) => ({
      id: `booking-item-${state.bookings.length + 1}-${index + 1}`,
      bookingRef,
      serviceType: 'bus',
      legType: selection.legType,
      listingId: listing.id,
      scheduleId: selection.schedule.id,
      seatNumber: selection.seat.seatNumber,
      passengerIndex: selection.passengerIndex,
      passengerName: passengerRows[selection.passengerIndex]?.fullName || payload.fullName || 'Passenger',
      unitPrice: selection.price,
      currency: listing.currency || selection.schedule.currency || 'UGX',
      status: 'confirmed',
    }))
    : listing.serviceType === 'hotel' && hotelSelection
      ? [{
        id: `booking-item-${state.bookings.length + 1}-hotel-1`,
        bookingRef,
        serviceType: 'hotel',
        listingId: listing.id,
        roomId: hotelSelection.room.id,
        roomType: hotelSelection.room.roomType,
        roomTypeId: hotelSelection.room.roomTypeId || '',
        roomUnitId: hotelSelection.room.roomUnitId || hotelSelection.room.id,
        checkIn: hotelSelection.checkIn,
        checkOut: hotelSelection.checkOut,
        nights: hotelSelection.nights,
        passengerName: passengerRows[0]?.fullName || payload.fullName || 'Guest',
        unitPrice: Number(hotelSelection.room.nightlyPrice || listing.priceFrom || 0),
        currency: listing.currency || 'UGX',
        status: 'confirmed',
      }]
      : [];
  const ticketLegs = listing.serviceType === 'bus'
    ? busLegSelections.map((selection, index) => {
      const id = `ticket-leg-${state.bookings.length + 1}-${index + 1}`;
      const qrNonce = qrNonceFor(bookingRef, selection.schedule.id, selection.seat.seatNumber, index + 1);
      const qrValue = `CTQR-${bookingRef}-${id}-${qrNonce}`;
      return {
        id,
        bookingRef,
        ticketNumber: `${bookingRef}-${selection.schedule.id}-${selection.seat.seatNumber}`,
        legType: selection.legType,
        serviceType: 'bus',
        listingId: listing.id,
        scheduleId: selection.schedule.id,
        seatNumber: selection.seat.seatNumber,
        passengerIndex: selection.passengerIndex,
        passengerName: passengerRows[selection.passengerIndex]?.fullName || payload.fullName || 'Passenger',
        qrNonce,
        // Keep the raw token in the in-memory compatibility read model for tests and immediate ticket rendering.
        // Persistent Mongo writes continue to rely on qrTokenHash/qrTokenPreview for lookup and reporting.
        qrToken: qrValue,
        qrTokenHash: qrHash(qrValue),
        qrTokenPreview: qrPreview(qrValue),
        checkInStatus: 'boarding',
        status: 'valid',
        createdAt: new Date().toISOString(),
      };
    })
    : [];
  const booking = {
    id: `booking-${state.bookings.length + 1}`,
    bookingRef,
    serviceType: listing.serviceType,
    guestSnapshot: {
      fullName: payload.fullName || payload.customerName || 'Guest Customer',
      email: payload.email || 'guest@example.com',
      phone: payload.phone || '+256700000000',
    },
    buyerSnapshot: {
      fullName: payload.fullName || payload.customerName || 'Guest Customer',
      email: payload.email || 'guest@example.com',
      phone: payload.phone || '+256700000000',
      idType: payload.idType || '',
      documentNumber: payload.documentNumber || '',
      notes: payload.notes || payload.customerNote || '',
    },
    customerUserId: payload.customerUserId || payload.userId || req?.session?.user?.id || null,
    companyId: listing.companyId,
    listingId: listing.id,
    scheduleId,
    passengers: passengerRows,
    bookingItems,
    bookingLegs,
    ticketLegs,
    hotelStay: listing.serviceType === 'hotel' && hotelSelection ? {
      checkIn: hotelSelection.checkIn,
      checkOut: hotelSelection.checkOut,
      nights: hotelSelection.nights,
      roomCount: 1,
      roomUnitIds: [hotelSelection.room.roomUnitId || hotelSelection.room.id].filter(Boolean),
      roomTypeIds: [hotelSelection.room.roomTypeId || ''].filter(Boolean),
      status: 'pending_payment',
    } : undefined,
    tripType,
    addons: selectedAddons,
    notes: payload.notes || payload.customerNote || '',
    pricing: { subtotal, fees, addonTotal, total, currency: listing.currency || 'UGX', split, addons: selectedAddons },
    promoterAttribution,
    paymentStatus: initialPaymentStatus,
    bookingStatus: initialPaymentStatus === 'successful' ? 'confirmed' : 'pending',
    qrCodeValue: `CLASSIC-TRIP:${bookingRef}:${listing.id}:${Date.now()}`,
    lockedUntil: addMinutes(new Date(), 10).toISOString(),
    createdAt: new Date().toISOString(),
  };
  state.bookings.unshift(booking);
  persistRow('bookings', booking);
  // Seat and schedule persistence is intentionally handled by bookingService with atomic MongoDB claims.
  passengerRows.forEach((passenger, index) => {
    const passengerRow = {
      ...passenger,
      id: passenger.id || `passenger-${state.passengers.length + 1}`,
      bookingId: booking.id,
      bookingRef: booking.bookingRef,
      companyId: booking.companyId,
      listingId: booking.listingId,
      scheduleId: booking.scheduleId,
      passengerIndex: index,
      createdAt: booking.createdAt,
    };
    state.passengers.push(passengerRow);
    persistRow('passengers', passengerRow);
  });
  const fraudService = require('../fraud/fraudService');
  const promoterNetworkService = require('../promoter/promoterNetworkService');
  booking.risk = fraudService.scoreBookingRisk(booking);
  if (fraudService.needsManualReview(booking.risk)) {
    const fraudTicket = {
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
    };
    state.supportTickets.unshift(fraudTicket);
    persistRow('supportTickets', fraudTicket);
    promoterNetworkService.createFraudSignal({
      booking,
      signalType: 'booking_risk',
      score: booking.risk.score,
      reasons: booking.risk.reasons || [],
      metadata: { source: booking.agentSale || booking.offlineSale ? 'agent_offline' : 'booking', risk: booking.risk },
    });
  }
  if (booking.promoterAttribution?.promoterId) {
    promoterNetworkService.recordConversion(booking, booking.agentSale || booking.offlineSale ? 'agent_offline' : 'booking');
  }
  if (booking.paymentStatus === 'successful') settleBookingPayment(booking.bookingRef);
  persistBookingGraph(booking);
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
  const ticketValues = (booking.ticketLegs || []).flatMap((ticket) => [
    ticket.id,
    ticket.ticketNumber,
    ticket.qrToken,
    ticket.qrTokenHash,
    ticket.seatNumber,
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
    ...ticketValues,
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

function ticketSearchValues(ticket = {}) {
  return [
    ticket.id,
    ticket.ticketNumber,
    ticket.qrToken,
    ticket.qrTokenHash,
    ticket.seatNumber,
    ticket.roomNumber,
  ].filter(Boolean).map((value) => String(value));
}

function findTicketOnBooking(booking = {}, value = '') {
  const key = normalize(value);
  if (!key) return null;
  const scannedHash = qrHash(value);
  return (booking.ticketLegs || []).find((ticket) => {
    if (ticket.qrTokenHash && normalize(ticket.qrTokenHash) === normalize(scannedHash)) return true;
    return ticketSearchValues(ticket).some((field) => normalize(field) === key || normalize(field).includes(key));
  }) || null;
}

function searchTicket(value, companyId = '') {
  const key = normalize(value);
  if (!key) return { booking: null, ticket: null };

  // Ticket QR tokens are intentionally not the same as booking references.
  // Search ticket legs directly first so company-scope validation can distinguish
  // "valid ticket, wrong company" from "ticket not found".
  for (const booking of state.bookings) {
    if (companyId && booking.companyId !== companyId) continue;
    const ticket = findTicketOnBooking(booking, value);
    if (ticket) return { booking, ticket };
  }

  const booking = searchBooking(value, companyId);
  if (!booking) return { booking: null, ticket: null };
  return { booking, ticket: findTicketOnBooking(booking, value) };
}

function updatePassengerCheckState(booking = {}, ticket = {}, status = 'boarding') {
  const passengerIndex = Number(ticket.passengerIndex || 0);
  const passenger = (booking.passengers || [])[passengerIndex];
  if (!passenger) return;
  passenger.checkInStatus = status;
  passenger.ticketNumber = ticket.ticketNumber || passenger.ticketNumber;
  passenger.scheduleId = ticket.scheduleId || passenger.scheduleId;
}

function bookingCheckInProgress(booking = {}) {
  const legs = booking.ticketLegs || [];
  if (!legs.length) return { allCheckedIn: booking.checkInStatus === 'checked_in', anyCheckedIn: booking.checkInStatus === 'checked_in' };
  return {
    allCheckedIn: legs.every((leg) => leg.checkInStatus === 'checked_in'),
    anyCheckedIn: legs.some((leg) => leg.checkInStatus === 'checked_in'),
    allClosed: legs.every((leg) => ['checked_in', 'no_show', 'cancelled', 'refunded', 'voided'].includes(normalize(leg.checkInStatus || leg.status))),
  };
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
      bookingItems: booking.bookingItems || [],
      bookingLegs: booking.bookingLegs || [],
      ticketLegs: booking.ticketLegs || [],
      tripType: booking.tripType || 'one_way',
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
      name: booking.buyerSnapshot?.fullName || booking.guestSnapshot?.fullName || booking.passengers?.[0]?.fullName || 'Guest customer',
      email: booking.buyerSnapshot?.email || booking.guestSnapshot?.email || '',
      phone: booking.buyerSnapshot?.phone || booking.guestSnapshot?.phone || '',
      idType: booking.buyerSnapshot?.idType || '',
      documentNumber: booking.buyerSnapshot?.documentNumber || '',
      notes: booking.buyerSnapshot?.notes || booking.notes || '',
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
    media: {
      logo: company.logo || null,
      coverImage: company.coverImage || null,
      documents: Array.isArray(company.documents) ? company.documents : [],
      canPublish: company.settings?.canPublish !== false,
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
      sub: listing.sub || listing.description || '',
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

function checkInBlockReason(booking = {}, ticket = null) {
  if (!booking) return 'Booking was not found';
  if (booking.paymentStatus !== 'successful') return 'Ticket payment is not confirmed';
  if (['cancelled', 'refunded', 'voided'].includes(booking.bookingStatus)) return `Ticket is ${booking.bookingStatus}`;
  if (ticket && ['checked_in', 'used'].includes(normalize(ticket.checkInStatus || ticket.status))) return 'Ticket leg is already used';
  if (ticket && ['cancelled', 'refunded', 'voided'].includes(normalize(ticket.checkInStatus || ticket.status))) return `Ticket leg is ${ticket.checkInStatus || ticket.status}`;
  if (!ticket && ['checked_in', 'partially_checked_in'].includes(booking.bookingStatus)) return 'Ticket is already checked in';
  if (!ticket && ['checked_in', 'partial'].includes(booking.checkInStatus)) return 'Ticket is already checked in';
  if (booking.bookingStatus === 'completed') return 'Trip or service is already completed';
  if (booking.bookingStatus === 'no_show') return 'Ticket is marked as no-show';
  return '';
}

function lookupTicket(value, companyId = '', context = {}) {
  const { booking, ticket } = searchTicket(value, companyId);
  if (!booking) {
    const unrestricted = searchTicket(value, '');
    if (companyId && unrestricted.booking) return { ok: false, result: 'not_authorized_for_ticket', booking: unrestricted.booking, ticket: unrestricted.ticket || null, message: 'This ticket belongs to another company scope' };
    return { ok: false, result: 'not_found', message: 'Ticket not found' };
  }
  const reason = checkInBlockReason(booking, ticket);
  return {
    ok: !reason,
    result: reason ? 'blocked' : 'ready',
    message: reason || (ticket ? 'Ticket leg found and ready for check-in' : 'Ticket found and ready for check-in'),
    canCheckIn: !reason,
    disabledReason: reason,
    booking,
    ticket: ticket || (booking.ticketLegs || [])[0] || null,
    listing: findListing(booking.listingId),
    detail: bookingDetail(booking),
  };
}

function validateTicket(qrCodeValue, employeeId = 'employee-system', companyId = '', context = {}) {
  const { booking, ticket } = searchTicket(qrCodeValue, companyId);
  if (!booking) {
    const unrestricted = searchTicket(qrCodeValue, '');
    if (companyId && unrestricted.booking) return { ok: false, result: 'not_authorized_for_ticket', booking: unrestricted.booking, ticket: unrestricted.ticket || null, message: 'This ticket belongs to another company scope', canCheckIn: false, disabledReason: 'Wrong company scope' };
    return { ok: false, result: 'not_found', message: 'Ticket not found' };
  }
  const reason = checkInBlockReason(booking, ticket);
  if (reason) {
    let result = 'not_valid_for_checkin';
    if (booking.paymentStatus !== 'successful') result = 'payment_not_successful';
    if ((ticket && ['checked_in', 'used'].includes(normalize(ticket.checkInStatus || ticket.status))) || booking.bookingStatus === 'checked_in' || booking.checkInStatus === 'checked_in' || booking.bookingStatus === 'completed') result = 'already_used';
    return { ok: false, result, booking, ticket: ticket || (booking.ticketLegs || [])[0] || null, listing: findListing(booking.listingId), detail: bookingDetail(booking), message: reason, canCheckIn: false, disabledReason: reason };
  }
  const now = new Date().toISOString();
  const activeTicket = ticket || (booking.ticketLegs || [])[0] || null;
  if (activeTicket) {
    activeTicket.checkInStatus = 'checked_in';
    activeTicket.status = 'used';
    activeTicket.usedAt = now;
    activeTicket.checkedInAt = now;
    activeTicket.checkedInBy = employeeId;
    activeTicket.source = context.source || activeTicket.source || '';
    activeTicket.location = context.location || activeTicket.location || '';
    updatePassengerCheckState(booking, activeTicket, 'checked_in');
  }
  const progress = bookingCheckInProgress(booking);
  booking.bookingStatus = progress.allCheckedIn || !activeTicket ? 'checked_in' : 'partially_checked_in';
  booking.checkInStatus = progress.allCheckedIn || !activeTicket ? 'checked_in' : 'partial';
  booking.checkedInAt = progress.allCheckedIn || !booking.checkedInAt ? now : booking.checkedInAt;
  booking.checkedInBy = employeeId;
  booking.checkedInByUserId = employeeId;
  const auditLog = {
    id: `audit-${state.auditLogs.length + 1}`,
    actorId: employeeId,
    actorRole: context.actorRole || 'company_employee',
    actorName: context.actorName || '',
    actorEmail: context.actorEmail || '',
    action: 'ticket.checked_in',
    target: activeTicket?.ticketNumber || booking.bookingRef,
    entityType: activeTicket ? 'ticket_leg' : 'booking',
    entityId: activeTicket?.id || booking.id,
    beforeSummary: 'Ticket leg was eligible for check-in',
    afterSummary: activeTicket ? `Ticket leg ${activeTicket.ticketNumber} marked checked_in` : 'Ticket marked checked_in and earnings release triggered',
    ip: context.ip || '',
    userAgent: context.userAgent || '',
    status: 'success',
    createdAt: now
  };
  state.auditLogs.push(auditLog);
  persistRow('auditLogs', auditLog);
  persistBookingGraph(booking);
  return { ok: true, result: 'validated', booking, ticket: activeTicket, listing: findListing(booking.listingId), detail: bookingDetail(booking), message: activeTicket ? 'Ticket leg validated and checked in' : 'Ticket validated and checked in', canCheckIn: false, disabledReason: activeTicket ? 'Ticket leg is already used' : 'Ticket is already checked in' };
}

function markNoShow(value, employeeId = 'employee-system', companyId = '', note = '', context = {}) {
  const { booking, ticket } = searchTicket(value, companyId);
  if (!booking) {
    const unrestricted = searchTicket(value, '');
    if (companyId && unrestricted.booking) return { ok: false, result: 'not_authorized_for_ticket', booking: unrestricted.booking, ticket: unrestricted.ticket || null, message: 'This ticket belongs to another company scope' };
    return { ok: false, result: 'not_found', message: 'Ticket not found' };
  }
  if (['cancelled', 'refunded', 'voided', 'completed'].includes(booking.bookingStatus) || (ticket && ['checked_in', 'used', 'cancelled', 'refunded', 'voided'].includes(normalize(ticket.checkInStatus || ticket.status)))) {
    return { ok: false, result: 'not_valid_for_no_show', booking, ticket: ticket || null, detail: bookingDetail(booking), message: ticket ? `Cannot mark ${ticket.checkInStatus || ticket.status} ticket leg as no-show` : `Cannot mark ${booking.bookingStatus} booking as no-show` };
  }
  const now = new Date().toISOString();
  const activeTicket = ticket || (booking.ticketLegs || [])[0] || null;
  if (activeTicket) {
    activeTicket.checkInStatus = 'no_show';
    activeTicket.status = 'no_show';
    activeTicket.noShowAt = now;
    activeTicket.noShowBy = employeeId;
    updatePassengerCheckState(booking, activeTicket, 'no_show');
  }
  const progress = bookingCheckInProgress(booking);
  booking.bookingStatus = progress.allClosed || !activeTicket ? 'no_show' : 'partially_checked_in';
  booking.checkInStatus = progress.allClosed || !activeTicket ? 'no_show' : 'partial';
  booking.noShowAt = now;
  booking.noShowBy = employeeId;
  booking.noShowByUserId = employeeId;
  booking.checkInNote = note || booking.checkInNote || 'Marked no-show from employee dashboard';
  const auditLog = {
    id: `audit-${state.auditLogs.length + 1}`,
    actorId: employeeId,
    actorRole: context.actorRole || 'company_employee',
    actorName: context.actorName || '',
    actorEmail: context.actorEmail || '',
    action: 'ticket.no_show',
    target: activeTicket?.ticketNumber || booking.bookingRef,
    entityType: activeTicket ? 'ticket_leg' : 'booking',
    entityId: activeTicket?.id || booking.id,
    beforeSummary: 'Ticket was not checked in',
    afterSummary: `${activeTicket ? 'Ticket leg' : 'Ticket'} marked no_show${note ? `: ${note}` : ''}`,
    ip: context.ip || '',
    userAgent: context.userAgent || '',
    status: 'success',
    createdAt: now
  };
  state.auditLogs.push(auditLog);
  persistRow('auditLogs', auditLog);
  persistBookingGraph(booking);
  return { ok: true, result: 'no_show', booking, ticket: activeTicket, listing: findListing(booking.listingId), detail: bookingDetail(booking), message: activeTicket ? 'Ticket leg marked as no-show' : 'Booking marked as no-show' };
}

module.exports = {
  state,
  hydrateFromDatabase,
  refreshFromDatabase,
  loadSeedReadModel,
  persistRow,
  persistRows,
  persistBookingGraph,
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
  qrPublicValueForLeg,
  findBooking,
  searchBooking,
  lookupTicket,
  bookingDetail,
  validateTicket,
  markNoShow,
};
