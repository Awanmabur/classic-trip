const { platformCurrency } = require('../../utils/currency');
const { formatRouteLabel } = require('../../utils/routeLabel');
const { getCachedPlatformConfig } = require('../platform/platformConfigService');
const { calculateCustomerFees } = require('../../utils/calculateCustomerFees');
const crypto = require('crypto');
const sensitiveFieldService = require('../security/sensitiveFieldService');
const { env } = require('../../config/env');
const generateBookingRef = require('../../utils/generateBookingRef');
const calculateCommission = require('../../utils/calculateCommission');
const {
  addMinutes
} = require('../../utils/dates');
const {
  ENABLED_BOOKING_TYPES
} = require('../../config/constants');
const toSlug = require('../../utils/slugify');
const { buildVehicleSeatTemplateProjections } = require('./vehicleSeatTemplateProjection');
const { buildLiveDepartureSeatMaps, isBusDepartureSchedule } = require('./liveDepartureSeatMapProjection');
const { buildCompanyBusScope, rowId: busScopeRowId } = require('./companyBusScope');
const { normalizePermissions } = require('../../config/accessControl');
const { evaluateDriverAssignment, evaluateDriverEligibility, evaluatePartnerDriverActivation, isDriverConfigured } = require('../company/driverEligibilityService');
function createDashboardProjection(initialState = {}) {
  const cachedPlatformConfig = getCachedPlatformConfig();
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
      ratePlans: [],
      hotelReservations: [],
      hotelGuests: [],
      roomAssignments: [],
      housekeepingTasks: [],
      maintenanceBlocks: [],
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
      bookingGroups: [],
      bookings: [],
      passengers: [],
      payments: [],
      correspondenceMessages: [],
      bookingTimelineEvents: [],
      notificationDeliveryAttempts: [],
      pushSubscriptions: [],
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
      inventoryHolds: [],
      inventoryHoldItems: [],
      outboxEvents: [],
      ticketScans: [],
      scheduleRules: [],
      platformSettings: {},
      notificationTemplates: []
    };
  }
  const state = initialState || emptyProductionState();
  const listingFareFromIndex = new Map();
  const fareProductListingById = new Map();
  function rememberListingFare(listingId, amount, currency = '') {
    const key = String(listingId || '');
    const value = Number(amount || 0);
    if (!key || !Number.isFinite(value) || value <= 0) return;
    const current = listingFareFromIndex.get(key);
    if (!current || value < current.amount) listingFareFromIndex.set(key, { amount: value, currency: String(currency || current?.currency || '').toUpperCase() });
  }
  for (const product of (state.fareProducts || [])) {
    const productId = String(product.id || product._id || '');
    const listingId = String(product.listingId || '');
    if (productId && listingId) fareProductListingById.set(productId, listingId);
    for (const amount of [product.priceFrom, product.basePrice, product.price, product.amount]) rememberListingFare(listingId, amount, product.currency);
  }
  for (const fare of (state.busSegmentFares || [])) {
    const listingId = String(fare.listingId || fareProductListingById.get(String(fare.fareProductId || '')) || '');
    rememberListingFare(listingId, fare.amount || fare.price, fare.currency);
  }
  function listingFareFrom(listing = {}) {
    const indexed = listingFareFromIndex.get(String(listing.id || listing._id || ''));
    const direct = Number(listing.priceFrom || listing.price || 0);
    if (Number.isFinite(direct) && direct > 0 && (!indexed || direct <= indexed.amount)) return { amount: direct, currency: String(listing.currency || indexed?.currency || platformCurrency()).toUpperCase() };
    return indexed || { amount: 0, currency: String(listing.currency || platformCurrency()).toUpperCase() };
  }
  // `rooms` is a dashboard-only read model derived from canonical room types and units.
  // There is no writable Room collection in the runtime architecture.
  const unitCountByType = new Map();
  (state.roomUnits || []).filter((unit) => unit.status !== 'archived').forEach((unit) => unitCountByType.set(unit.roomTypeId, (unitCountByType.get(unit.roomTypeId) || 0) + 1));
  state.roomSummaries = (state.roomTypes || []).map((roomType) => ({
    ...roomType,
    id: roomType.id,
    roomTypeId: roomType.id,
    roomType: roomType.name,
    nightlyPrice: Number(roomType.basePrice || 0),
    inventory: unitCountByType.get(roomType.id) || 0,
    availableUnits: unitCountByType.get(roomType.id) || 0,
  }));
  const { SERVICE_REGISTRY } = require('../../config/serviceRegistry');
  const { partnerProfile } = require('../../config/partnerProfiles');
  const SERVICE_LABELS = Object.freeze(Object.fromEntries(Object.entries(SERVICE_REGISTRY).map(([key, value]) => [key, value.singular])));
  function companyPartnerCategory(company = {}) {
    return normalize(company.partnerCategory || company.settings?.partnerCategory);
  }
  function companyPartnerLabel(company = {}) {
    const profile = partnerProfile(companyPartnerCategory(company));
    if (profile?.label) return profile.label;
    return SERVICE_LABELS[company.companyType || company.type || company.serviceType] || company.companyType || company.type || 'Partner';
  }
  const ROUTED_SERVICE_TYPES = ['bus'];
  const COMPANY_COMMON_DASHBOARD_PAGES = ['overview', 'company-profile', 'staff', 'listings', 'bookings', 'reviews', 'support', 'ads', 'revenue', 'settlement', 'reports'];
  const COMPANY_SERVICE_PAGE_MAP = Object.freeze({
    bus: ['overview', 'company-profile', 'staff', 'listings', 'routes', 'vehicles', 'seat-maps', 'schedules', 'bookings', 'manifests', 'checkins', 'reviews', 'support', 'ads', 'revenue', 'settlement', 'reports'],
    hotel: ['overview', 'company-profile', 'staff', 'listings', 'hotel-rooms', 'bookings', 'manifests', 'checkins', 'reviews', 'support', 'ads', 'revenue', 'settlement', 'reports'],
    flight: ['overview', 'company-profile', 'staff', 'flight-search', 'flight-quotes', 'bookings', 'flight-travelers', 'flight-tickets', 'flight-changes', 'flight-refunds', 'support', 'ads', 'revenue', 'settlement', 'reports'],
    local_transport: ['overview', 'company-profile', 'staff', 'taxi-fleet', 'taxi-drivers', 'taxi-availability', 'taxi-operations', 'taxi-incidents', 'bookings', 'reviews', 'support', 'ads', 'revenue', 'settlement', 'reports'],
    tour: ['overview', 'company-profile', 'staff', 'listings', 'bookings', 'reviews', 'support', 'ads', 'revenue', 'settlement', 'reports'],
    car_rental: ['overview', 'company-profile', 'staff', 'listings', 'bookings', 'reviews', 'support', 'ads', 'revenue', 'settlement', 'reports'],
    cargo: ['overview', 'company-profile', 'staff', 'listings', 'bookings', 'reviews', 'support', 'ads', 'revenue', 'settlement', 'reports'],
  });
  const platformDefaultCurrency = String(state.platformSettings?.financeRules?.defaultCurrency || '').toUpperCase();
  function normalize(value) {
    return String(value || '').toLowerCase().trim();
  }
  function indexFirst(rows = [], valuesForRow = () => []) {
    const index = new Map();
    (rows || []).forEach((row) => {
      valuesForRow(row).forEach((value) => {
        const indexed = normalize(value);
        if (indexed && !index.has(indexed)) index.set(indexed, row);
      });
    });
    return index;
  }
  function groupByIdentity(rows = [], valueForRow = () => '') {
    const groups = new Map();
    (rows || []).forEach((row) => {
      const value = String(valueForRow(row) ?? '').trim();
      if (!value) return;
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value).push(row);
    });
    return groups;
  }
  function bookingIdentityValues(booking = {}) {
    return [
      booking.id, booking._id, booking.bookingRef, booking.reference,
      booking.guestLookupCode, booking.lookupCode, booking.qrCodeValue,
      booking.paymentRef, booking.providerReference,
    ].filter(Boolean);
  }

  // Build request-local read indexes once. The previous projection repeatedly
  // scanned complete arrays from inside every row/detail builder; with even one
  // real record that work multiplied across the many dashboard projections.
  const listingByIdentity = indexFirst(state.listings, (row) => [row.id, row._id, row.slug]);
  const listingByTitleAndType = indexFirst(state.listings, (row) => [`${row.title || ''}::${row.serviceType || ''}`]);
  const listingByTitle = indexFirst(state.listings, (row) => [row.title]);
  const companyByIdentity = indexFirst(state.companies, (row) => [row.id, row._id, row.slug]);
  const bookingByIdentity = indexFirst(state.bookings, bookingIdentityValues);
  const scheduleById = indexFirst(state.schedules, (row) => [row.id, row._id]);
  const routeById = indexFirst(state.routes, (row) => [row.id, row._id]);
  const vehicleById = indexFirst(state.vehicles, (row) => [row.id, row._id]);
  const userById = indexFirst(state.users, (row) => [row.id, row._id]);
  const listingsByCompany = groupByIdentity(state.listings, (row) => row.companyId);
  const routesByListing = groupByIdentity(state.routes, (row) => row.listingId);
  const schedulesByListing = groupByIdentity(state.schedules, (row) => row.listingId);
  const roomsByListing = groupByIdentity(state.roomSummaries, (row) => row.listingId);
  const seatsBySchedule = groupByIdentity(state.seats, (row) => row.scheduleId);
  const bookingsBySchedule = groupByIdentity(state.bookings, (row) => row.scheduleId);
  const bookingsByListing = groupByIdentity(state.bookings, (row) => row.listingId);
  const paymentByBookingIdentity = indexFirst(state.payments, (row) => [row.bookingId, row.bookingRef]);

  function isActivePromoterLink(link = {}) {
    return !['archived', 'deleted', 'disabled'].includes(normalize(link.status));
  }
  function isFailedPaymentArtifact(booking = {}, payment = {}) {
    const paymentState = normalize(payment.status || booking.paymentStatus);
    const bookingState = normalize(booking.bookingStatus || booking.status);
    return paymentState === 'failed' || ['failed', 'payment_failed'].includes(bookingState)
      || (paymentState === 'failed' && ['cancelled', 'pending_payment', 'draft'].includes(bookingState));
  }
  function isFinanciallySuccessful(booking = {}, payment = {}) {
    if (isFailedPaymentArtifact(booking, payment)) return false;
    const paymentState = normalize(payment.status || booking.paymentStatus);
    return ['successful', 'success', 'paid', 'completed', 'settled'].includes(paymentState);
  }
  function asDate(value) {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  }
  function formatMoney(amount, currency = platformDefaultCurrency) {
    return `${currency} ${Math.round(Number(amount) || 0).toLocaleString()}`;
  }

  // Sums figures that may legitimately span more than one currency (e.g. platform-wide
  // totals across companies, or a promoter's referrals across companies) into a per-currency
  // breakdown instead of blending amounts under one mislabeled currency.
  function sumByCurrency(items, amountFn, currencyFn) {
    const totals = new Map();
    items.forEach(item => {
      const currency = currencyFn(item) || platformDefaultCurrency;
      const amount = Number(amountFn(item)) || 0;
      totals.set(currency, (totals.get(currency) || 0) + amount);
    });
    return totals;
  }
  function formatMoneyBreakdown(totals) {
    if (!totals.size) return formatMoney(0);
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]).map(([currency, amount]) => formatMoney(amount, currency)).join(' · ');
  }
  function dateValue(value) {
    if (!value) return '-';
    return new Date(value).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  }
  function bookingTitle(booking) {
    const listing = findListing(booking.listingId);
    return listing ? listing.title : booking.serviceType;
  }
  function bookingCompany(booking) {
    const company = findCompany(booking.companyId);
    return company ? company.name : '';
  }
  function bookingCustomer(booking) {
    return booking.guestSnapshot?.fullName || booking.passengers?.[0]?.fullName || 'Guest customer';
  }
  function bookingTotal(booking) {
    return formatMoney(booking.pricing?.total, booking.pricing?.currency || platformCurrency());
  }
  const dashboardDataCache = new Map();
  const DASHBOARD_DATA_CACHE_MS = 5000;
  function dashboardData(role = 'admin', context = {}) {
    // computeDashboardData assembles its payload almost entirely out of repeated full
    // linear scans over state.bookings/schedules/seats/etc per row (e.g. seatsForSchedule
    // rescans all seats for every schedule row), which is expensive to redo on every
    // request. A dashboard overview doesn't need millisecond freshness, so cache per
    // role+context for a few seconds instead of recomputing from scratch each time.
    const cacheKey = `${role}:${context.companyId || ''}:${context.promoterId || ''}:${context.customerId || ''}:${context.activePage || 'overview'}:${context.hotelManifestDate || ''}:${context.hotelManifestListingId || ''}`;
    const cached = dashboardDataCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.at < DASHBOARD_DATA_CACHE_MS) return cached.value;
    const value = computeDashboardData(role, context);
    dashboardDataCache.set(cacheKey, {
      value,
      at: now
    });
    return value;
  }
  function requireContextId(value, label) {
    if (!value) {
      const error = new Error(`${label} is required to build this dashboard`);
      error.status = 403;
      throw error;
    }
    return value;
  }
  function computeDashboardData(role = 'admin', context = {}) {
    // Missing authenticated identities fail closed.
    // not silently render someone else's dashboard. Every current route resolves a real id first.
    const bookings = state.bookings.slice();
    if (role === 'admin') return adminDashboardData(bookings);
    if (['company', 'employee', 'driver'].includes(role)) {
      const companyId = requireContextId(context.companyId, 'companyId');
      const company = (state.companies || []).find((row) => String(row.id || '') === String(companyId)) || {};
      const companyType = normalizeCompanyType(company.companyType || company.type || company.serviceType);
      const companyBookings = bookings.filter((booking) => booking.companyId === companyId
        || (companyType === 'flight' && booking.agentCompanyId === companyId)
        || (companyType === 'local_transport' && booking.providerCompanyId === companyId));
      if (role === 'company') {
        const companyListings = state.listings.filter(listing => listing.companyId === companyId);
        return enrichCompanyDashboard(companyDashboardData(companyId, companyListings, companyBookings, context), companyId, companyBookings);
      }
      return employeeDashboardData(companyId, companyBookings, role === 'driver' ? {
        ...context,
        driverMode: true
      } : context);
    }
    if (role === 'customer') {
      const customerId = requireContextId(context.customerId, 'customerId');
      const customerBookings = bookings.filter(booking => booking.customerUserId === customerId);
      return customerDashboardData(customerBookings, customerId);
    }
    if (role === 'promoter') {
      const promoterId = requireContextId(context.promoterId, 'promoterId');
      const promoterLinks = state.promoterLinks.filter(link => link.promoterId === promoterId && isActivePromoterLink(link));
      const promoterBookings = bookings.filter(booking => booking.promoterAttribution?.promoterId === promoterId);
      return promoterDashboardData(promoterLinks, promoterBookings, promoterId);
    }
    return {};
  }
  function adminDashboardData(bookings) {
    const activeUsers = state.users.filter(user => user.status !== 'suspended');
    const suspendedUsers = state.users.filter(user => user.status === 'suspended');
    const partnerCompanies = state.companies;
    const busProviders = partnerCompanies.filter(company => normalize(company.companyType) === 'bus');
    const hotelProviders = partnerCompanies.filter(company => normalize(company.companyType) === 'hotel');
    const flightAgents = partnerCompanies.filter(company => normalize(company.companyType) === 'flight' || companyPartnerCategory(company) === 'flight_agent');
    const mobilityPartners = partnerCompanies.filter(company => normalize(company.companyType) === 'local_transport');
    const bodaRiders = mobilityPartners.filter(company => companyPartnerCategory(company) === 'boda_rider');
    const carDrivers = mobilityPartners.filter(company => companyPartnerCategory(company) === 'car_driver');
    const fleetOwners = mobilityPartners.filter(company => companyPartnerCategory(company) === 'fleet_owner');
    const mobilityCompanies = mobilityPartners.filter(company => companyPartnerCategory(company) === 'taxi_company');
    const activePartners = partnerCompanies.filter(company => ['verified', 'active', 'approved'].includes(normalize(company.verificationStatus || company.status)));
    const suspendedPartners = partnerCompanies.filter(company => normalize(company.status) === 'suspended' || normalize(company.verificationStatus) === 'suspended');
    const activeListings = state.listings.filter(listing => listing.status === 'active');
    const closedListings = state.listings.filter(listing => ['cancelled', 'closed', 'archived', 'inactive'].includes(normalize(listing.status)));
    const confirmedBookings = bookings.filter(booking => ['confirmed', 'checked_in', 'completed'].includes(booking.bookingStatus));
    const pendingPaymentBookings = bookings.filter(booking => !['successful', 'paid', 'completed'].includes(normalize(booking.paymentStatus)));
    const cancelledRefundedBookings = bookings.filter(booking => /cancel|refund/.test(normalize(booking.bookingStatus)) || /refund/.test(normalize(booking.paymentStatus)));
    const guestBookings = bookings.filter(booking => !booking.customerUserId);
    const referredBookings = bookings.filter(booking => booking.promoterAttribution?.promoterId || booking.promoterAttribution?.code);
    const pendingSettlementTxns = state.walletTransactions.filter(txn => /pending|hold|review/.test(normalize(txn.status)));
    const withdrawalTxns = state.walletTransactions.filter(txn => /withdraw|payout/.test(normalize(txn.transactionType || txn.referenceType)));
    const grossRevenueBreakdown = formatMoneyBreakdown(sumByCurrency(bookings, booking => booking.pricing?.total, booking => booking.pricing?.currency));
    const platformCommissionBreakdown = formatMoneyBreakdown(sumByCurrency(bookings, booking => booking.pricing?.split?.platformFee, booking => booking.pricing?.currency));
    const partnerEarningsBreakdown = formatMoneyBreakdown(sumByCurrency(bookings, booking => booking.pricing?.split?.companyAmount, booking => booking.pricing?.currency));
    const promoterCommissionBreakdown = formatMoneyBreakdown(sumByCurrency(bookings, booking => booking.pricing?.split?.promoterAmount, booking => booking.pricing?.currency));
    const pendingSettlementsBreakdown = formatMoneyBreakdown(sumByCurrency(pendingSettlementTxns, txn => txn.amount, txn => txn.currency));
    const walletWithdrawalsBreakdown = formatMoneyBreakdown(sumByCurrency(withdrawalTxns, txn => txn.amount, txn => txn.currency));
    const openSupport = state.supportTickets.filter(ticket => !['closed', 'resolved'].includes(normalize(ticket.status)));
    const overviewStats = [{
      label: 'Total users',
      value: state.users.length.toLocaleString(),
      icon: 'fa-users',
      hint: `${activeUsers.length} active / ${suspendedUsers.length} suspended`
    }, {
      label: 'Customers',
      value: state.users.filter(user => user.role === 'customer').length.toLocaleString(),
      icon: 'fa-user',
      hint: 'Registered customer accounts'
    }, {
      label: 'Promoters',
      value: state.users.filter(user => user.role === 'promoter').length.toLocaleString(),
      icon: 'fa-bullhorn',
      hint: 'Referral sellers'
    }, {
      label: 'Company admins / employees',
      value: `${state.users.filter(user => ['partner', 'company_admin'].includes(user.role)).length}/${state.users.filter(user => user.role === 'company_employee').length}`,
      icon: 'fa-user-tie',
      hint: 'Admins / employees'
    }, {
      label: 'Partner companies',
      value: partnerCompanies.length.toLocaleString(),
      icon: 'fa-building',
      hint: `${activePartners.length} active / ${suspendedPartners.length} suspended`
    }, {
      label: 'Service providers',
      value: `${busProviders.length}/${hotelProviders.length}/${flightAgents.length}/${mobilityPartners.length}`,
      icon: 'fa-layer-group',
      hint: 'Bus / hotel / flight agent / local mobility'
    }, {
      label: 'Mobility network',
      value: `${bodaRiders.length}/${carDrivers.length}/${fleetOwners.length}/${mobilityCompanies.length}`,
      icon: 'fa-motorcycle',
      hint: 'Boda / car / fleet-rental / mobility company'
    }, {
      label: 'Listings / routes / trips',
      value: `${state.listings.length}/${state.routes.length}/${state.schedules.length}`,
      icon: 'fa-route',
      hint: `${activeListings.length} active, ${closedListings.length} closed`
    }, {
      label: 'Total bookings',
      value: bookings.length.toLocaleString(),
      icon: 'fa-ticket',
      hint: `${confirmedBookings.length} confirmed, ${pendingPaymentBookings.length} pending payment`
    }, {
      label: 'Cancelled / refunded',
      value: cancelledRefundedBookings.length.toLocaleString(),
      icon: 'fa-rotate-left',
      hint: 'Bookings requiring refund/cancellation review'
    }, {
      label: 'Guest / referred bookings',
      value: `${guestBookings.length}/${referredBookings.length}`,
      icon: 'fa-link',
      hint: 'Guest checkout / promoter referral'
    }, {
      label: 'Gross revenue',
      value: grossRevenueBreakdown,
      icon: 'fa-money-bill-wave',
      hint: 'All booking value'
    }, {
      label: 'Platform commission',
      value: platformCommissionBreakdown,
      icon: 'fa-percent',
      hint: 'Platform fee total'
    }, {
      label: 'Partner earnings',
      value: partnerEarningsBreakdown,
      icon: 'fa-building-columns',
      hint: 'Owner/company share'
    }, {
      label: 'Promoter commission',
      value: promoterCommissionBreakdown,
      icon: 'fa-hand-holding-dollar',
      hint: 'Referral commission'
    }, {
      label: 'Pending settlements',
      value: pendingSettlementsBreakdown,
      icon: 'fa-clock',
      hint: 'Wallet/payout items on hold'
    }, {
      label: 'Wallet withdrawals',
      value: walletWithdrawalsBreakdown,
      icon: 'fa-wallet',
      hint: 'Payout/withdrawal requests'
    }, {
      label: 'Support cases',
      value: openSupport.length.toLocaleString(),
      icon: 'fa-headset',
      hint: 'Open support/dispute queue'
    }];
    const visibleBookings = bookings.filter(booking => !isFailedPaymentArtifact(booking));
    const bookingRows = visibleBookings.slice(0, 80).map(booking => {
      const detail = bookingDetail(booking);
      const hold = booking.lockedUntil ? `${Math.max(0, Math.ceil((new Date(booking.lockedUntil).getTime() - Date.now()) / 60000))} min left` : 'None';
      return [booking.bookingRef, detail.service.name || bookingTitle(booking), `${detail.customer.name} / ${detail.customer.email || detail.customer.phone || detail.customer.type}`, dateValue(booking.createdAt), hold, booking.bookingStatus, bookingTotal(booking), dashboardMeta('booking', booking.bookingRef, booking.bookingRef, booking.bookingStatus, detail, ['view', 'copy', 'customer', 'company', 'payment', 'refund', 'export'])];
    });
    const companyRows = state.companies.map(company => {
      const detail = companyDetail(company);
      return [company.name, companyPartnerLabel(company), company.country || '-', String(detail.performance.totalListings), company.verificationStatus || company.status || 'pending', detail.performance.revenue, `${Number(detail.commercialTerms.commissionPercent || 0).toFixed(2)}%`, dashboardMeta('partner', company.id, company.name, company.verificationStatus || company.status, {
        ...detail,
        partnerCategory: companyPartnerCategory(company),
        companyType: normalize(company.companyType || company.type || company.serviceType),
        accountModel: normalize(company.accountModel || company.settings?.accountModel),
      }, ['view', 'commission', 'portal', 'suspend', 'invite', 'bookings', 'listings', 'payouts'])];
    });
    const listingRows = state.listings.map(listing => {
      const detail = listingDetail(listing);
      const marketplaceState = listing.isSponsored
        ? 'Sponsored'
        : listing.status === 'active' && normalize(listing.releaseStatus) === 'published' && listing.bookable === true
          ? 'Bookable'
          : listing.status === 'draft'
            ? 'Draft'
            : listing.releaseStatus || listing.status || 'Draft';
      return [listing.title, SERVICE_LABELS[listing.serviceType] || listing.serviceType || listing.type, detail.owner.companyName, listing.serviceType === 'hotel' ? `${detail.inventory.roomInventory} rooms` : `${detail.inventory.remainingSeats}/${detail.inventory.totalSeats} seats`, listing.serviceType === 'hotel' ? [listing.city, listing.country].filter(Boolean).join(', ') : formatRouteLabel(listing.from || '-', listing.to || '-'), marketplaceState, formatMoney(listingFareFrom(listing).amount, listingFareFrom(listing).currency), dashboardMeta('listing', listing.id, listing.title, listing.status, detail, ['view', 'bookings', 'occupancy', 'open'])];
    });
    const paymentRows = visibleBookings.map(booking => {
      const payment = state.payments.find(item => item.bookingRef === booking.bookingRef || item.bookingId === booking.id) || {};
      return { booking, payment };
    }).filter(({ booking, payment }) => !isFailedPaymentArtifact(booking, payment)).slice(0, 80).map(({ booking, payment }, index) => {
      const detail = paymentDetail(booking, payment);
      return [payment.id || `TX-${78000 + index}`, booking.bookingRef, formatMoney(detail.payment.amount, detail.payment.currency), formatMoney(booking.pricing?.split?.companyAmount || 0, booking.pricing?.currency), formatMoney(booking.pricing?.split?.platformFee || 0, booking.pricing?.currency), formatMoney(booking.pricing?.split?.promoterAmount || 0, booking.pricing?.currency), detail.payment.status || booking.paymentStatus, dashboardMeta('payment', payment.id || booking.bookingRef, payment.id || booking.bookingRef, detail.payment.status || booking.paymentStatus, detail, ['view', 'booking', 'settlement', 'export'])];
    });
    const promoterRows = state.users.filter(user => user.role === 'promoter').map(user => {
      const detail = promoterDetail(user);
      const links = state.promoterLinks.filter(link => link.promoterId === user.id);
      return [user.fullName, String(links.reduce((total, link) => total + Number(link.clicks || 0), 0)), String(links.reduce((total, link) => total + Number(link.conversions || 0), 0)), detail.performance.commissionEarned, detail.wallet.availableBalance, user.status || 'active', dashboardMeta('promoter', user.id, user.fullName, user.status || 'active', detail, ['view', 'bookings', 'wallet', 'suspend'])];
    });
    const customerRows = state.users.filter(user => user.role === 'customer').map(user => {
      const detail = customerDetail(user);
      return [user.fullName, user.email || user.phone || '-', String(detail.bookingSummary.totalBookings), detail.bookingSummary.totalSpend, detail.bookingSummary.lastTravelDate ? dateValue(detail.bookingSummary.lastTravelDate) : 'No bookings', user.status || 'active', dashboardMeta('customer', user.id, user.fullName, user.status || 'active', detail, ['view', 'bookings', 'payments', 'note'])];
    });
    const supportRows = state.supportTickets.map(ticket => [ticket.id, ticket.audience || ticket.ownerType || ticket.ownerId || 'Customer', ticket.subject, ticket.priority || 'normal', ticket.status || 'open', ticket.updatedAt ? dateValue(ticket.updatedAt) : dateValue(ticket.createdAt), dashboardMeta('support', ticket.id, ticket.id, ticket.status, employeeSupportDetail(ticket), ['view', 'assign', 'progress', 'resolve', 'reopen'])]);
    const leadRows = (state.partnerLeads || []).map(lead => [lead.businessName || lead.name || '-', lead.leadType || lead.companyType || 'company', lead.contactName || '-', lead.email || lead.phone || '-', lead.sourceChannel || 'manual', lead.status || 'new', dashboardMeta('partner_lead', lead.id, lead.businessName || lead.id, lead.status || 'new', {
      lead
    }, ['view', 'session', 'agreement', 'invite'])]);
    const sessionRows = (state.discoverySessions || []).map(session => {
      const lead = (state.partnerLeads || []).find(row => row.id === session.leadId) || {};
      return [session.providerName || lead.businessName || session.leadId || '-', session.sessionType || 'Discovery call', session.scheduledAt ? dateValue(session.scheduledAt) : '-', Array.isArray(session.attendees) ? session.attendees.join(', ') : session.attendees || '-', session.agreedNextAction || session.notes || '-', session.status || 'scheduled', dashboardMeta('discovery_session', session.id, session.providerName || lead.businessName || session.id, session.status || 'scheduled', {
        session,
        lead
      }, ['view', 'agreement', 'lead'])];
    });
    const agreementRows = (state.agreements || []).map(agreement => {
      const lead = (state.partnerLeads || []).find(row => row.id === agreement.leadId) || {};
      return [agreement.partnerName || lead.businessName || '-', agreement.agreementType || lead.leadType || 'company', agreement.commissionModel || 'percentage_commission', agreement.payoutFrequency || '-', agreement.startDate ? dateValue(agreement.startDate) : '-', agreement.status || 'draft', dashboardMeta('agreement', agreement.id, agreement.partnerName || lead.businessName || agreement.id, agreement.status || 'draft', {
        agreement,
        lead
      }, ['view', 'approve', 'reject', 'invite'])];
    });
    const campaignRows = state.promotionCampaigns.map(campaign => [campaign.name || campaign.title, findCompany(campaign.companyId)?.name || campaign.companyId || 'Partner', campaign.placement || campaign.type || 'Campaign', formatMoney(campaign.budget || 0), String(campaign.clicks || 0), String(campaign.bookings || campaign.conversions || 0), campaign.status || 'draft', dashboardMeta('promotion', campaign.id, campaign.name || campaign.title, campaign.status, campaignDetail(campaign), ['view', 'approve', 'reject', 'pause'])]);
    const routeRows = state.routes.slice(0, 120).map(route => {
      const listing = findListing(route.listingId) || {};
      const company = findCompany(route.companyId || listing.companyId) || {};
      const schedules = state.schedules.filter(schedule => schedule.routeId === route.id || schedule.listingId === route.listingId);
      const stops = [route.boardingPoints, route.dropoffPoints].flat().filter(Boolean).length || (Array.isArray(state.routeStops) ? state.routeStops.filter(stop => stop.routeId === route.id).length : 0);
      const label = formatRouteLabel(route.origin || listing.from || '-', route.destination || listing.to || '-', route.routeName);
      return [label, listing.title || route.listingId || '-', company.name || listing.partner || '-', `${stops} stops`, `${schedules.length} schedules`, route.status || listing.status || 'active', dashboardMeta('route', route.id, label, route.status || listing.status || 'active', {
        route,
        listing: listingDetail(listing),
        company: companyDetail(company)
      }, ['view', 'listings', 'schedules', 'open'])];
    });
    const vehicleRows = (state.vehicles || []).slice(0, 120).map(vehicle => {
      const company = findCompany(vehicle.companyId) || {};
      const listing = findListing(vehicle.listingId) || {};
      return [vehicle.name || vehicle.vehicleName || vehicle.id, company.name || listing.partner || vehicle.companyId || '-', SERVICE_LABELS[vehicle.serviceType] || vehicle.serviceType || listing.serviceType || 'Vehicle', vehicle.plateOrCode || vehicle.registrationNumber || vehicle.code || '-', `${vehicle.totalSeats || vehicle.capacity || 0} seats`, vehicle.status || 'active', dashboardMeta('vehicle', vehicle.id, vehicle.name || vehicle.id, vehicle.status || 'active', {
        vehicle,
        listing: listingDetail(listing),
        company: companyDetail(company)
      }, ['view', 'schedules', 'open'])];
    });
    const scheduleRows = (state.schedules || []).slice(0, 160).map(schedule => {
      const listing = findListing(schedule.listingId) || {};
      const company = findCompany(schedule.companyId || listing.companyId) || {};
      const vehicle = (state.vehicles || []).find(item => item.id === schedule.vehicleId) || {};
      const label = schedule.id || [dateValue(schedule.departAt), listing.title].filter(Boolean).join(' - ');
      return [label, listing.title || schedule.routeId || schedule.listingId || '-', company.name || listing.partner || '-', vehicle.name || schedule.vehicleName || schedule.vehicleId || '-', `${schedule.availableSeats ?? '-'} / ${schedule.totalSeats ?? '-'}`, schedule.status || 'active', dashboardMeta('schedule', schedule.id, label, schedule.status || 'active', scheduleDetail(schedule), ['view', 'manifest', 'seat_map', 'open'])];
    });
    const routeInventoryRows = state.routes.slice(0, 80).map(route => {
      const listing = findListing(route.listingId) || {};
      const schedules = schedulesForListing(route.listingId);
      const detail = listingDetail(listing);
      return [formatRouteLabel(route.origin || detail.service.from || '-', route.destination || detail.service.to || '-', route.routeName), detail.service.vehicleDetails || listing.type || 'Inventory', detail.owner.companyName || 'Partner', `${detail.inventory.remainingSeats}/${detail.inventory.totalSeats}`, `${schedules.length} schedules`, route.status || listing.status || 'active', formatMoney(listing.priceFrom || 0, listing.currency), dashboardMeta('route', route.id, formatRouteLabel(route.origin, route.destination, route.routeName), route.status, {
        route,
        listing: detail
      }, ['view', 'bookings', 'occupancy', 'open'])];
    });
    const stayInventoryRows = state.roomSummaries.slice(0, 80).map(room => {
      const listing = findListing(room.listingId) || {};
      return [listing.title || 'Hotel', room.roomType, findCompany(room.companyId)?.name || listing.partner || 'Partner', `${room.inventory} rooms`, listing.city || listing.country || '-', room.status, formatMoney(room.nightlyPrice || listing.priceFrom || 0, listing.currency), dashboardMeta('room', room.id, room.roomType, room.status, {
        room,
        listing: listingDetail(listing)
      }, ['view', 'bookings', 'occupancy'])];
    });
    const auditRows = state.auditLogs.map(log => [dateValue(log.createdAt), log.actorId, log.action, log.target || log.entityId || '-', 'Backend store', log.status || 'Success', dashboardMeta('audit', log.id, log.action, log.status || 'Success', auditDetail(log), ['view', 'export'])]);
    const adminRows = state.users.filter(user => ['super_admin', 'admin', 'finance_admin', 'support_admin', 'content_admin'].includes(user.role)).map(user => [user.fullName, user.role, user.permissionsLabel || 'Role based', env.platformMfaEnabled ? (user.twoFactorEnabled ? 'Enabled' : 'Required') : 'Disabled', user.lastLoginAt ? dateValue(user.lastLoginAt) : 'No login', user.status || 'active', dashboardMeta('admin', user.id, user.fullName, user.status || 'active', adminUserDetail(user), ['view', 'invite', 'suspend'])]);
    const companyKycRows = state.companies.map(company => {
      const documents = Array.isArray(company.documents) ? company.documents : [];
      const pendingDocuments = documents.filter(document => /pending|review/i.test(document.status || 'pending_review')).length;
      const documentLabel = documents.length ? `${documents.length} documents${pendingDocuments ? `, ${pendingDocuments} pending` : ''}` : 'Business profile';
      const payout = typeof company.payoutAccount === 'object' && company.payoutAccount !== null
        ? [company.payoutAccount.provider, company.payoutAccount.accountName, company.payoutAccount.accountNumber || company.payoutAccount.account].filter(Boolean).join(' · ')
        : company.payoutAccount || company.walletId || 'Payout pending';
      const review = (state.verificationReviews || []).find(item => item.targetType === 'company' && item.targetId === company.id) || null;
      return [company.name, documentLabel, company.country || '-', payout, company.verificationStatus === 'verified' && !pendingDocuments ? 'Low' : 'Medium', company.verificationStatus || 'pending', dashboardMeta('kyc', company.id, company.name, company.verificationStatus, {
        targetType: 'company',
        targetId: company.id,
        company: companyDetail(company),
        verificationReview: review,
      }, ['view', 'approve', 'reject', 'changes'])];
    });
    const promoterKycRows = (state.users || []).filter(user => user.role === 'promoter').map(user => {
      const review = (state.verificationReviews || []).find(item => item.targetType === 'promoter' && item.targetId === user.id) || null;
      const checklist = Array.isArray(review?.checklist) ? review.checklist : [];
      const submitted = checklist.filter(item => /submitted|pending|review/i.test(item.status || '')).length;
      const documentLabel = user.verificationDocumentType
        ? `${user.verificationDocumentType}${user.verificationReference ? ` · ${user.verificationReference}` : ''}${submitted ? ` · ${submitted} pending` : ''}`
        : `Promoter identity${submitted ? ` · ${submitted} pending` : ''}`;
      const payout = typeof user.payoutAccount === 'object' && user.payoutAccount !== null
        ? [user.payoutAccount.provider, user.payoutAccount.accountName, user.payoutAccount.accountNumber || user.payoutAccount.account].filter(Boolean).join(' · ')
        : user.payoutAccount || 'Payout pending';
      return [user.fullName || user.email || user.id, documentLabel, user.country || user.city || '-', payout, user.verificationStatus === 'verified' ? 'Low' : 'Medium', user.verificationStatus || 'pending', dashboardMeta('kyc', user.id, user.fullName || user.email || user.id, user.verificationStatus, {
        targetType: 'promoter',
        targetId: user.id,
        promoter: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          phone: user.phone,
          referralCode: user.referralCode,
          verificationStatus: user.verificationStatus,
          verificationDocumentType: user.verificationDocumentType,
          verificationReference: user.verificationReference,
          payoutAccount: user.payoutAccount,
          promoterProfile: user.promoterProfile,
        },
        verificationReview: review,
      }, ['view', 'approve', 'reject', 'changes'])];
    });
    const kycRows = [...companyKycRows, ...promoterKycRows];

    const refundRows = state.refundRequests.map(refund => [refund.id, refund.bookingRef, bookingCustomer(findBooking(refund.bookingRef) || {}) || refund.requesterId || 'Customer', refund.reason, formatMoney(refund.amount), refund.status, dashboardMeta('refund', refund.id, refund.id, refund.status, employeeRefundDetail(refund), ['view', 'approve', 'reject', 'booking', 'payment'])]);
    const notificationRows = (state.notifications || []).map(note => [note.title || note.subject, Array.isArray(note.channels) ? note.channels.join(', ') : note.channel || 'Email', note.audience || note.ownerType || 'Users', String(note.sentCount || note.deliveredCount || 0), note.deliveryStatus || note.status || 'Pending', note.status || 'queued', dashboardMeta('notification', note.id, note.title || note.subject, note.status, notificationDetail(note), ['view', 'send'])]);
    const cartRows = (state.carts || []).map(cart => [cart.cartRef, String(cart.items?.length || 0), cart.customer?.fullName || 'Guest customer', formatMoney(cart.pricing?.total || 0, cart.pricing?.currency || platformCurrency()), cart.bookingRef || '-', cart.status || 'draft', dashboardMeta('cart', cart.cartRef, cart.cartRef, cart.status || 'draft', {
      cart,
      booking: cart.bookingRef ? bookingDetail(findBooking(cart.bookingRef)) : null
    }, ['view', 'recover', 'booking', 'export'])]);
    const cartCheckoutRows = (state.cartCheckoutAttempts || []).map(attempt => [attempt.id, attempt.cartRef, attempt.bookingRef || '-', attempt.providerReference || attempt.paymentId || '-', attempt.failureType || attempt.paymentId || '-', attempt.status || 'started', dashboardMeta('cart_checkout', attempt.id, attempt.cartRef || attempt.id, attempt.status || 'started', {
      attempt,
      cart: (state.carts || []).find(cart => cart.cartRef === attempt.cartRef) || null
    }, ['view', 'cart', 'payment', 'export'])]);
    const ticketScanRows = (state.ticketScans || []).map(scan => [scan.id, scan.bookingRef || '-', scan.ticketNumber || '-', scan.scheduleId || '-', scan.scanType || '-', scan.result || '-', scan.meta?.checkInStatus || scan.message || '-', scan.scannedAt ? dateValue(scan.scannedAt) : '-', scan.actorName || scan.employeeId || scan.actorEmail || '-', scan.location || scan.source || '-', dashboardMeta('ticket_scan', scan.id, scan.ticketNumber || scan.bookingRef || scan.id, scan.result || 'scan', {
      scan,
      booking: scan.bookingRef ? bookingDetail(findBooking(scan.bookingRef)) : null
    }, ['view', 'booking', 'export'])]);
    const ticketLegRows = bookings.flatMap(booking => (booking.ticketLegs || []).map((ticket, index) => [ticket.ticketNumber, booking.bookingRef, ticket.passengerName || (booking.passengers || [])[Number(ticket.passengerIndex || index)]?.fullName || bookingCustomer(booking), ticket.legType || 'primary', ticket.scheduleId || booking.scheduleId || '-', ticket.seatNumber || ticket.roomNumber || (booking.passengers || [])[Number(ticket.passengerIndex || index)]?.seatOrRoom || '-', ticket.status || booking.bookingStatus, ticket.checkInStatus || booking.checkInStatus || 'boarding', ticket.qrTokenPreview || '-', ticket.usedAt || ticket.checkedInAt ? dateValue(ticket.usedAt || ticket.checkedInAt) : '-', dashboardMeta('ticket_leg', ticket.id || ticket.ticketNumber, ticket.ticketNumber, ticket.checkInStatus || ticket.status || 'valid', {
      ticket,
      booking: bookingDetail(booking)
    }, ['view', 'booking', 'scan_history', 'export'])]));
    const correspondenceRows = (state.correspondenceMessages || []).map(message => [message.id, message.bookingRef || message.supportTicketId || message.refundId || message.agreementId || message.verificationId || message.driverId || message.customerId || '-', message.subject || '-', message.visibility || 'shared', Array.isArray(message.channels) ? message.channels.join(', ') : message.channels || '-', message.status || 'open', message.createdAt ? dateValue(message.createdAt) : '-', dashboardMeta('correspondence', message.id, message.subject || message.id, message.status || 'open', {
      message,
      booking: message.bookingRef ? bookingDetail(findBooking(message.bookingRef)) : null
    }, ['view', 'booking', 'support', 'export'])]);
    const deliveryAttemptRows = (state.notificationDeliveryAttempts || []).map(attempt => [attempt.id, attempt.correspondenceMessageId || attempt.notificationId || '-', attempt.bookingRef || attempt.referenceId || '-', attempt.channel || '-', attempt.status || 'queued', attempt.provider || '-', attempt.attemptedAt ? dateValue(attempt.attemptedAt) : '-', dashboardMeta('delivery_attempt', attempt.id, attempt.channel || attempt.id, attempt.status || 'queued', {
      attempt
    }, ['view', 'message', 'export'])]);
    const timelineRows = (state.bookingTimelineEvents || []).map(event => [event.bookingRef || '-', event.entityType || '-', event.action || event.title || '-', event.actorName || event.actorId || event.actorType || '-', event.status || '-', event.createdAt ? dateValue(event.createdAt) : '-', dashboardMeta('booking_timeline', event.id, event.action || event.title || event.id, event.status || 'open', {
      event,
      booking: event.bookingRef ? bookingDetail(findBooking(event.bookingRef)) : null
    }, ['view', 'booking', 'export'])]);
    const rescheduleRows = (state.rescheduleRequests || []).map(request => [request.id, request.bookingRef, request.requestedScheduleId || [request.preferredDate ? dateValue(request.preferredDate) : '', request.preferredTime || ''].filter(Boolean).join(' ') || request.currentScheduleId || '-', request.reason || '-', request.status || 'pending', request.updatedAt || request.reviewedAt || request.createdAt ? dateValue(request.updatedAt || request.reviewedAt || request.createdAt) : '-', dashboardMeta('reschedule_request', request.id, request.bookingRef || request.id, request.status || 'pending', {
      request,
      booking: request.bookingRef ? bookingDetail(findBooking(request.bookingRef)) : null
    }, ['view', 'approve', 'reject', 'booking', 'export'])]);
    const financeOwnerLabel = (ownerType, ownerId) => {
      if (ownerType === 'company') return findCompany(ownerId)?.name || ownerId || 'Company';
      if (ownerType === 'promoter') return state.users.find(user => user.id === ownerId)?.fullName || ownerId || 'Promoter';
      if (ownerType === 'customer') return state.users.find(user => user.id === ownerId)?.fullName || ownerId || 'Customer';
      return [ownerType, ownerId].filter(Boolean).join(':') || 'Platform';
    };
    const paymentIntentRows = (state.paymentIntents || []).map(intent => [intent.intentRef || intent.id, intent.bookingRef || intent.cartRef || intent.bookingId || '-', intent.provider || '-', formatMoney(intent.amount || 0, intent.currency || platformCurrency()), intent.status || 'created', intent.providerReference || '-', intent.createdAt ? dateValue(intent.createdAt) : '-', dashboardMeta('payment_intent', intent.id, intent.intentRef || intent.id, intent.status || 'created', {
      intent
    }, ['view', 'booking', 'export'])]);
    const receiptInvoiceRows = (state.receiptInvoices || []).map(document => [document.documentRef || document.id, document.documentType || 'receipt', document.bookingRef || '-', document.customerName || document.customerEmail || '-', formatMoney(document.total || 0, document.currency || platformCurrency()), document.status || 'pending', document.issuedAt ? dateValue(document.issuedAt) : '-', dashboardMeta('receipt_invoice', document.id, document.documentRef || document.id, document.status || 'pending', {
      document,
      booking: document.bookingRef ? bookingDetail(findBooking(document.bookingRef)) : null
    }, ['view', 'booking', 'export'])]);
    const taxFeeRows = (state.taxFeeRecords || []).map(record => [record.id, record.bookingRef || '-', formatMoney(record.subtotal || 0, record.currency || platformCurrency()), formatMoney(record.serviceFee || 0, record.currency || platformCurrency()), formatMoney(record.taxAmount || 0, record.currency || platformCurrency()), formatMoney(record.providerFee || 0, record.currency || platformCurrency()), formatMoney(record.totalFees || 0, record.currency || platformCurrency()), record.status || 'recorded', dashboardMeta('tax_fee', record.id, record.bookingRef || record.id, record.status || 'recorded', {
      record,
      booking: record.bookingRef ? bookingDetail(findBooking(record.bookingRef)) : null
    }, ['view', 'booking', 'export'])]);
    const financeStatementRows = (state.financeStatements || []).map(statement => [statement.statementRef || statement.id, financeOwnerLabel(statement.ownerType, statement.ownerId), statement.periodStart ? dateValue(statement.periodStart) : '-', statement.periodEnd ? dateValue(statement.periodEnd) : '-', formatMoney(statement.gross || 0, statement.currency || platformCurrency()), formatMoney(statement.closingBalance || 0, statement.currency || platformCurrency()), statement.status || 'issued', dashboardMeta('finance_statement', statement.id, statement.statementRef || statement.id, statement.status || 'issued', {
      statement
    }, ['view', 'owner', 'export'])]);
    const financeRiskRows = (state.financeRiskReviews || []).map(review => [review.id, [review.targetType, review.targetId].filter(Boolean).join(':') || '-', financeOwnerLabel(review.ownerType, review.ownerId), formatMoney(review.amount || 0, review.currency || platformCurrency()), String(review.riskScore || 0), review.status || 'clear', Array.isArray(review.flags) && review.flags.length ? review.flags.join(', ') : 'No flags', dashboardMeta('finance_risk', review.id, review.targetId || review.id, review.status || 'clear', {
      review
    }, ['view', 'target', 'export'])]);
    const settlementRows = (state.settlementBatches || []).map(batch => [batch.batchNumber || batch.id, batch.periodStart ? dateValue(batch.periodStart) : '-', batch.periodEnd ? dateValue(batch.periodEnd) : '-', formatMoney(batch.totalGross || 0, batch.currency || platformCurrency()), formatMoney(batch.totalPayable || 0, batch.currency || platformCurrency()), batch.status || 'draft', dashboardMeta('settlement_batch', batch.id, batch.batchNumber || batch.id, batch.status || 'draft', {
      batch
    }, ['view', 'statements', 'payouts', 'export'])]);
    const payoutRequestRows = (state.payoutRequests || []).map(request => [request.id, request.transactionId || '-', financeOwnerLabel(request.ownerType, request.ownerId), formatMoney(request.amount || 0, request.currency || platformCurrency()), request.payoutMethod || '-', request.payoutBatchId || '-', request.riskStatus || request.status || 'requested', request.status || 'requested', dashboardMeta('payout_request', request.id, request.transactionId || request.id, request.status || 'requested', {
      request
    }, ['view', 'review', 'batch', 'export'])]);
    const payoutBatchRows = (state.payoutBatches || []).map(batch => [batch.batchNumber || batch.id, batch.providerReference || '-', String((batch.requestIds || []).length), formatMoney(batch.totalAmount || 0, batch.currency || platformCurrency()), batch.status || 'exported', batch.createdAt ? dateValue(batch.createdAt) : '-', dashboardMeta('payout_batch', batch.id, batch.batchNumber || batch.id, batch.status || 'exported', {
      batch
    }, ['view', 'requests', 'export'])]);
    const reconciliationRows = (state.reconciliationReports || []).map(report => [report.id, report.settlementBatchId || '-', report.periodStart ? dateValue(report.periodStart) : '-', report.periodEnd ? dateValue(report.periodEnd) : '-', formatMoney(report.grossPayments || 0, platformCurrency()), formatMoney(report.variance || 0, platformCurrency()), report.status || 'variance_review', dashboardMeta('reconciliation', report.id, report.settlementBatchId || report.id, report.status || 'variance_review', {
      report
    }, ['view', 'settlement', 'export'])]);
    const ledgerRows = (state.walletTransactions || []).map(transaction => [transaction.id, financeOwnerLabel(transaction.ownerType, transaction.ownerId), transaction.transactionType || transaction.referenceType || 'wallet', transaction.direction || '-', formatMoney(transaction.amount || 0, transaction.currency || platformCurrency()), transaction.status || 'completed', dashboardMeta('ledger_transaction', transaction.id, transaction.id, transaction.status || 'completed', {
      transaction
    }, ['view', 'owner', 'export'])]);
    const referralClickRows = (state.referralClicks || []).map(click => [click.id, click.code || '-', financeOwnerLabel('promoter', click.promoterId), findListing(click.listingId)?.title || click.listingId || '-', click.ip || '-', click.createdAt ? dateValue(click.createdAt) : '-', dashboardMeta('referral_click', click.id, click.code || click.id, 'tracked', {
      click
    }, ['view', 'promoter', 'listing', 'export'])]);
    const attributionSessionRows = (state.attributionSessions || []).map(session => [session.id, session.referralCode || '-', financeOwnerLabel('promoter', session.promoterId), findListing(session.listingId)?.title || session.listingId || '-', session.status || 'active', session.bookingRef || '-', session.createdAt ? dateValue(session.createdAt) : '-', dashboardMeta('attribution_session', session.id, session.referralCode || session.id, session.status || 'active', {
      session
    }, ['view', 'click', 'booking', 'export'])]);
    const campaignConversionRows = (state.campaignConversions || []).map(conversion => [conversion.id, conversion.campaignId || conversion.linkId || '-', financeOwnerLabel('promoter', conversion.promoterId), conversion.bookingRef || '-', formatMoney(conversion.amount || 0, conversion.currency || platformCurrency()), formatMoney(conversion.commissionAmount || 0, conversion.currency || platformCurrency()), conversion.status || 'converted', dashboardMeta('campaign_conversion', conversion.id, conversion.bookingRef || conversion.id, conversion.status || 'converted', {
      conversion,
      booking: conversion.bookingRef ? bookingDetail(findBooking(conversion.bookingRef)) : null
    }, ['view', 'booking', 'export'])]);
    const agentProfileRows = (state.agentProfiles || []).map(profile => [profile.id, financeOwnerLabel('promoter', profile.userId || profile.promoterId), profile.agentCode || '-', profile.officeName || '-', profile.location || '-', profile.offlineSalesEnabled ? 'Enabled' : 'Disabled', profile.status || 'active', dashboardMeta('agent_profile', profile.id, profile.agentCode || profile.id, profile.status || 'active', {
      profile
    }, ['view', 'agent', 'export'])]);
    const fraudSignalRows = (state.fraudSignals || []).map(signal => [signal.id, financeOwnerLabel('promoter', signal.promoterId || signal.agentId), signal.bookingRef || '-', signal.signalType || 'booking_risk', signal.severity || '-', String(signal.score || 0), signal.status || 'open', dashboardMeta('fraud_signal', signal.id, signal.bookingRef || signal.id, signal.status || 'open', {
      signal,
      booking: signal.bookingRef ? bookingDetail(findBooking(signal.bookingRef)) : null
    }, ['view', 'review', 'booking', 'export'])]);
    const referralCardRows = (state.promoterLinks || []).map(link => [link.id, financeOwnerLabel('promoter', link.promoterId), link.code || link.referralCode || '-', findListing(link.listingId)?.title || link.listingId || '-', link.qrCardUrl || `/promoter/links/${link.id}/qr-card`, link.status || 'active', dashboardMeta('referral_card', link.id, link.code || link.id, link.status || 'active', {
      link,
      listing: listingDetail(findListing(link.listingId))
    }, ['view', 'qr', 'export'])]);
    const agentSaleRows = (state.offlineSales || []).map(sale => [sale.saleRef || sale.id, sale.bookingRef || '-', sale.customerName || sale.passengerName || '-', findListing(sale.listingId)?.title || sale.listingId || '-', sale.paymentMethod || '-', formatMoney(sale.amountCollected || 0, sale.currency || platformCurrency()), sale.status || 'completed', dashboardMeta('agent_sale', sale.id, sale.saleRef || sale.id, sale.status || 'completed', {
      sale,
      booking: sale.bookingRef ? bookingDetail(findBooking(sale.bookingRef)) : null
    }, ['view', 'booking', 'receipt', 'export'])]);
    const companyNameById = new Map((state.companies || []).map(company => [String(company.id || ''), company.name || company.id]));
    const vehicleById = new Map((state.taxiVehicles || []).map(vehicle => [String(vehicle.id || ''), vehicle]));
    const driverById = new Map((state.taxiDriverProfiles || []).map(driver => [String(driver.id || ''), driver]));
    const partnerNetwork = {
      serviceCounts: {
        bus: busProviders.length,
        hotel: hotelProviders.length,
        flight: flightAgents.length,
        localTransport: mobilityPartners.length,
        bodaRiders: bodaRiders.length,
        carDrivers: carDrivers.length,
        fleetOwners: fleetOwners.length,
        mobilityCompanies: mobilityCompanies.length,
      },
      flightAgents: flightAgents.map(company => ({
        id: company.id,
        name: company.name,
        country: company.country || '-',
        city: company.city || '-',
        licenceNumber: company.onboardingProfile?.agencyLicenceNumber || company.complianceProfile?.agencyLicenceNumber || company.registrationNumber || '-',
        verificationStatus: company.verificationStatus || company.status || 'pending',
        status: company.status || 'pending',
        currency: company.operatingCurrency || '-',
        staffCount: (state.companyEmployees || []).filter(employee => employee.companyId === company.id && employee.status !== 'archived').length,
        quoteCount: (state.flightAgentQuotes || []).filter(row => row.agentCompanyId === company.id).length,
        bookingCount: bookings.filter(row => row.agentCompanyId === company.id).length,
      })),
      mobilityPartners: mobilityPartners.map(company => ({
        id: company.id,
        name: company.name,
        partnerCategory: companyPartnerCategory(company),
        partnerLabel: companyPartnerLabel(company),
        accountModel: company.accountModel || company.settings?.accountModel || 'organization',
        country: company.country || '-',
        city: company.city || '-',
        currency: company.operatingCurrency || '-',
        verificationStatus: company.verificationStatus || company.status || 'pending',
        status: company.status || 'pending',
        vehicleCount: (state.taxiVehicles || []).filter(row => row.companyId === company.id).length,
        driverCount: (state.taxiDriverProfiles || []).filter(row => row.companyId === company.id).length,
        activeDriverCount: (state.taxiDriverProfiles || []).filter(row => row.companyId === company.id && ['available','assigned','on_trip'].includes(normalize(row.availabilityStatus))).length,
        rideCount: (state.taxiRides || []).filter(row => row.providerCompanyId === company.id).length,
        payoutPercent: ['boda_rider','car_driver'].includes(companyPartnerCategory(company)) ? 100 : Number(company.settings?.driverPayoutPercent ?? 80),
      })),
      mobilityDrivers: (state.taxiDriverProfiles || []).map(driver => {
        const vehicle = vehicleById.get(String(driver.assignedVehicleId || '')) || {};
        return {
          id: driver.id,
          driverNumber: driver.driverNumber,
          companyId: driver.companyId,
          partnerName: companyNameById.get(String(driver.companyId || '')) || driver.companyId || '-',
          partnerCategory: companyPartnerCategory((state.companies || []).find(company => company.id === driver.companyId) || {}),
          licenceLast4: driver.licenceNumberLast4 || '-',
          licenceClass: driver.licenceClass || '-',
          licenceExpiresAt: driver.licenceExpiresAt || null,
          assignedVehicleId: driver.assignedVehicleId || '',
          vehicleRegistration: vehicle.registrationNumber || 'Not assigned',
          identityVerified: driver.identityVerified === true,
          backgroundCheckStatus: driver.backgroundCheckStatus || 'pending',
          safetyTrainingCompletedAt: driver.safetyTrainingCompletedAt || null,
          verificationStatus: driver.verificationStatus || 'pending',
          availabilityStatus: driver.availabilityStatus || 'offline',
        };
      }),
      mobilityVehicles: (state.taxiVehicles || []).map(vehicle => ({
        id: vehicle.id,
        companyId: vehicle.companyId,
        partnerName: companyNameById.get(String(vehicle.companyId || '')) || vehicle.companyId || '-',
        registrationNumber: vehicle.registrationNumber,
        makeModel: [vehicle.make, vehicle.model].filter(Boolean).join(' ') || '-',
        year: vehicle.year || '-',
        vehicleClassId: vehicle.vehicleClassId || '-',
        passengerCapacity: Number(vehicle.passengerCapacity || 0),
        inspectionExpiresAt: vehicle.inspectionExpiresAt || null,
        insuranceExpiresAt: vehicle.insuranceExpiresAt || null,
        registrationExpiresAt: vehicle.registrationExpiresAt || null,
        verificationStatus: vehicle.verificationStatus || 'pending',
        operationalStatus: vehicle.operationalStatus || 'offline',
        reviewNotes: vehicle.reviewNotes || '',
      })),
      dispatch: (state.taxiRides || []).map(ride => {
        const assignment = (state.rideAssignments || []).find(row => row.rideId === ride.id && !['cancelled','expired'].includes(normalize(row.status))) || {};
        const driver = driverById.get(String(assignment.driverProfileId || ride.driverProfileId || '')) || {};
        const vehicle = vehicleById.get(String(assignment.vehicleId || ride.vehicleId || '')) || {};
        return {
          id: ride.id,
          rideRef: ride.rideRef || ride.bookingRef || ride.id,
          pickup: ride.pickup?.address || 'Pickup',
          destination: ride.destination?.address || 'Destination',
          partnerName: companyNameById.get(String(ride.providerCompanyId || assignment.providerCompanyId || '')) || 'Unassigned',
          driverNumber: driver.driverNumber || 'Unassigned',
          vehicleRegistration: vehicle.registrationNumber || 'Unassigned',
          scheduledFor: ride.scheduledFor || ride.requestedPickupAt || null,
          status: ride.status || 'pending',
          amount: Number(ride.pricing?.total || 0),
          currency: ride.pricing?.currency || platformDefaultCurrency,
        };
      }),
      safetyIncidents: (state.taxiIncidents || []).map(incident => ({
        id: incident.id,
        rideId: incident.rideId || '-',
        partnerName: companyNameById.get(String(incident.companyId || incident.providerCompanyId || '')) || incident.companyId || '-',
        category: incident.category || incident.incidentType || 'safety',
        severity: incident.severity || 'medium',
        description: incident.description || incident.title || '-',
        status: incident.status || 'open',
        createdAt: incident.createdAt || null,
      })),
    };
    const priceRuleRows = (state.platformSettings?.priceRules || []).map((rule) => {
      const listing = rule.listingId ? (findListing(rule.listingId) || {}) : {};
      const percent = Number(rule.percent || 0);
      return [
        rule.ruleName || 'Pricing rule',
        listing.title || (rule.listingId ? `Listing ${rule.listingId}` : 'All listings'),
        `${percent > 0 ? '+' : ''}${percent}%`,
        rule.status || 'active',
        dashboardMeta('price_rule', rule.id, rule.ruleName || rule.id, rule.status || 'active', {
          priceRule: rule,
          listing,
        }, ['view', 'edit', 'export']),
      ];
    });
    return {
      overviewStats,
      liveActivity: [['Bookings today', bookings.length.toLocaleString()], ['Seats / rooms on hold', state.seats.filter(seat => seat.status === 'locked').length.toLocaleString()], ['Pending partner approvals', partnerCompanies.filter(company => /pending|review/.test(normalize(company.verificationStatus))).length.toLocaleString()], ['Open disputes', openSupport.length.toLocaleString()]],
      recentActivity: [...bookings.slice(0, 4).map(booking => ({
        type: 'booking',
        label: booking.bookingRef,
        message: `${bookingCustomer(booking)} booked ${bookingTitle(booking)}`,
        at: booking.createdAt
      })), ...state.auditLogs.slice(0, 4).map(log => ({
        type: 'audit',
        label: log.action,
        message: `${log.actorId} ${log.action}`,
        at: log.createdAt
      }))],
      partnerNetwork,
      travelSupply: {
        mobility: {
          listing: (state.listings || []).find(row => row.companyId === 'platform' && row.serviceType === 'local_transport') || null,
          vehicleClasses: (state.vehicleClasses || []).filter(row => row.companyId === 'platform').map(row => ({ ...row })),
          zones: (state.taxiServiceZones || []).filter(row => row.companyId === 'platform').map(row => ({ ...row })),
          fareRules: (state.taxiFareRules || []).filter(row => row.companyId === 'platform').map(row => ({ ...row })),
          partners: (state.companies || []).filter(row => row.companyType === 'local_transport' && ['boda_rider', 'car_driver', 'fleet_owner', 'taxi_company'].includes(companyPartnerCategory(row))).map(row => ({
            id: row.id,
            name: row.name,
            partnerCategory: companyPartnerCategory(row),
            accountModel: row.accountModel,
            status: row.status,
            verificationStatus: row.verificationStatus,
            driverPayoutPercent: ['boda_rider', 'car_driver'].includes(companyPartnerCategory(row)) ? 100 : Number(row.settings?.driverPayoutPercent ?? 80),
            payoutPolicyReviewedAt: row.settings?.driverPayoutPolicy?.reviewedAt || null,
          })),
          vehicles: (state.taxiVehicles || []).map(row => ({ ...row })),
          drivers: (state.taxiDriverProfiles || []).map(row => ({ ...row, licenceNumberEncrypted: undefined })),
          availability: (state.driverAvailabilities || []).map(row => ({ ...row })),
          rides: (state.taxiRides || []).map(row => ({ ...row, pickupPinEncrypted: undefined })),
          assignments: (state.rideAssignments || []).map(row => ({ ...row })),
          incidents: (state.taxiIncidents || []).map(row => ({ ...row })),
        },
        flight: {
          listing: (state.listings || []).find(row => row.companyId === 'platform' && row.serviceType === 'flight') || null,
          airlines: (state.airlines || []).filter(row => row.companyId === 'platform').map(row => ({ ...row })),
          suppliers: (state.flightSuppliers || []).filter(row => row.companyId === 'platform').map(row => ({ ...row, credentialSecretRef: row.credentialSecretRef ? 'configured' : '', webhookSecretRef: row.webhookSecretRef ? 'configured' : '' })),
          aircraft: (state.aircraft || []).filter(row => row.companyId === 'platform').map(row => ({ ...row })),
          seatMaps: (state.flightSeatMapVersions || []).filter(row => row.companyId === 'platform').map(row => ({ ...row })),
          routes: (state.flightRoutes || []).filter(row => row.companyId === 'platform').map(row => ({ ...row })),
          fareFamilies: (state.flightFareFamilies || []).filter(row => row.companyId === 'platform').map(row => ({ ...row })),
          departures: (state.flightDepartures || []).filter(row => row.companyId === 'platform').map(row => ({ ...row })),
          ancillaries: (state.flightAncillaries || []).filter(row => row.companyId === 'platform').map(row => ({ ...row })),
          agentQuotes: (state.flightAgentQuotes || []).map(row => ({ ...row, publicTokenHash: undefined, publicTokenEncrypted: undefined, offerTokenEncrypted: undefined })),
          changeRequests: (state.flightChangeRequests || []).map(row => ({ ...row })),
          refundRequests: (state.flightRefundRequests || []).map(row => ({ ...row })),
          airports: (state.airports || []).filter(row => row.status !== 'archived').map(row => ({ ...row })),
          aircraftTypes: (state.aircraftTypes || []).map(row => ({ ...row })),
        },
      },
      systemHealth: {
        appStatus: 'Online',
        databaseStatus: 'MongoDB repositories are the runtime source of truth',
        environment: process.env.NODE_ENV || 'development',
        nodeEnv: process.env.NODE_ENV || 'development',
        uptimeSeconds: Math.floor(process.uptime ? process.uptime() : 0),
        recentFailedPayments: bookings.filter(booking => /fail|cancel|refund/.test(normalize(booking.paymentStatus))).length,
        recentFailedOperations: state.auditLogs.filter(log => /fail|error/.test(normalize(log.status))).length,
        queueJobs: state.notifications?.length || state.supportTickets.length
      },
      platformSettings: {
        ...(state.platformSettings || {}),
        platformName: state.platformSettings?.platformName || cachedPlatformConfig.platformName,
        defaultCurrency: state.platformSettings?.financeRules?.defaultCurrency || cachedPlatformConfig.defaultCurrency,
        partnerCommissionPercent: Number(state.platformSettings?.financeRules?.partnerCommissionPercent ?? cachedPlatformConfig.partnerCommissionPercent),
        promoterSharePercent: Number(state.platformSettings?.financeRules?.promoterSharePercent ?? cachedPlatformConfig.promoterSharePercent),
        partnerPayoutPercent: Number(cachedPlatformConfig.partnerPayoutPercent),
        supportEmail: state.platformSettings?.supportEmail || '',
        maintenanceMode: state.platformSettings?.maintenanceMode === true,
        termsUrl: state.platformSettings?.termsUrl || '/terms',
        privacyUrl: state.platformSettings?.privacyUrl || '/privacy'
      },
      recentBookings: bookingRows.slice(0, 8).map(row => [row[0], row[row.length - 1].detail.booking.serviceType || row[1], row[row.length - 1].detail.customer.name, row[row.length - 1].detail.company.name, row[row.length - 1].detail.booking.paymentStatus, row[6], row[row.length - 1]]),
      bookings: bookingRows,
      partners: companyRows,
      listings: listingRows,
      priceRules: priceRuleRows,
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
      blogs: (state.blogs || []).map((blog) => ({ ...blog })),
      routeInventory: routeInventoryRows,
      stayInventory: stayInventoryRows,
      reviewInventory: state.listings.filter(listing => normalize(listing.releaseStatus) !== 'published' || listing.status !== 'active').slice(0, 20).map(listing => [listing.title, findCompany(listing.companyId)?.name || listing.partner || 'Partner', listing.releaseStatus || 'Needs content review', listing.status === 'active' ? 'Medium' : 'High', listing.updatedAt ? dateValue(listing.updatedAt) : '-', listing.status || 'Needs review', dashboardMeta('listing_review', listing.id, listing.title, listing.status, listingDetail(listing), ['view', 'approve', 'reject'])]),
      audit: auditRows,
      financeAudit: paymentRows.slice(0, 20).map(row => [dateValue(row[row.length - 1].detail.timestamps.createdAt), 'Finance/system', 'Revenue split', row[2], row[6] === 'successful' ? 'Low' : 'Review', row[6], row[row.length - 1]]),
      securityAudit: auditRows.slice(0, 20),
      admins: adminRows,
      kyc: kycRows,
      refunds: refundRows,
      notifications: notificationRows,
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
      options: {
        companies: (state.companies || []).filter(company => !['archived', 'rejected'].includes(normalize(company.status || company.verificationStatus))).map(company => ({
          id: company.id, value: company.id, label: company.name || company.id, companyId: company.id, status: company.status || company.verificationStatus || 'active'
        })),
        listings: (state.listings || []).filter(listing => listing.status === 'active' && listing.bookable !== false).map(listing => ({
          id: listing.id, value: listing.id, label: `${listing.title || listing.id} (${SERVICE_LABELS[listing.serviceType] || listing.serviceType || 'Service'})`,
          companyId: listing.companyId, listingId: listing.id, serviceType: listing.serviceType, status: listing.status
        })),
        schedules: (state.schedules || []).filter(schedule => !['archived', 'cancelled', 'completed'].includes(normalize(schedule.status))).map(schedule => {
          const listing = findListing(schedule.listingId) || {};
          return {
            id: schedule.id, value: schedule.id, label: `${listing.title || schedule.listingId || 'Departure'} - ${schedule.departAt ? dateValue(schedule.departAt) : schedule.id}`,
            companyId: schedule.companyId || listing.companyId, listingId: schedule.listingId, routeId: schedule.routeId, vehicleId: schedule.vehicleId, scheduleId: schedule.id, serviceType: listing.serviceType || schedule.serviceType, status: schedule.status
          };
        }),
        seats: (state.seats || []).filter(seat => ['available', 'held'].includes(normalize(seat.status))).map(seat => ({
          id: seat.id, value: seat.seatNumber || seat.id, label: `${seat.scheduleId || 'Departure'} - Seat ${seat.seatNumber || seat.id} (${seat.status || 'available'})`,
          companyId: seat.companyId, listingId: seat.listingId, scheduleId: seat.scheduleId, serviceType: 'bus', status: seat.status
        })),
        roomTypes: (state.roomTypes || []).filter(roomType => roomType.status === 'active').map(roomType => ({
          id: roomType.id, value: roomType.id, label: roomType.name || roomType.id,
          companyId: roomType.companyId, listingId: roomType.listingId, propertyId: roomType.propertyId, roomTypeId: roomType.id, serviceType: 'hotel', status: roomType.status
        })),
        roomUnits: (state.roomUnits || []).filter(unit => ['active', 'available', 'ready'].includes(normalize(unit.status))).map(unit => ({
          id: unit.id, value: unit.id, label: unit.unitNumber || unit.id,
          companyId: unit.companyId, listingId: unit.listingId, propertyId: unit.propertyId, roomTypeId: unit.roomTypeId, roomUnitId: unit.id, serviceType: 'hotel', status: unit.status
        }))
      }
    };
  }
  const {
    normalizeCompanyType
  } = require('../../utils/companyServiceType');
  function buildCompanyServiceProfile(company = {}, listings = [], assets = {}) {
    const companyType = normalizeCompanyType(company.companyType || company.type || company.serviceType);
    const listingTypes = Array.from(new Set((listings || []).map((listing) => normalizeCompanyType(listing.serviceType || listing.type)).filter(Boolean)));
    const fallbackType = listingTypes[0]
      || (((assets.hotelProperties || []).length || (assets.roomTypes || []).length || (assets.roomUnits || []).length) ? 'hotel' : '')
      || (((assets.vehicles || []).length || (assets.schedules || []).length) ? 'bus' : '')
      || (((assets.airlines || []).length || (assets.flightDepartures || []).length || (assets.aircraft || []).length) ? 'flight' : '')
      || (((assets.taxiVehicles || []).length || (assets.taxiDrivers || []).length || (assets.taxiRides || []).length) ? 'local_transport' : '');
    const primaryServiceType = companyType || fallbackType;
    const serviceTypes = primaryServiceType ? [primaryServiceType] : [];
    const supportsHotel = primaryServiceType === 'hotel';
    const supportsBus = primaryServiceType === 'bus';
    const supportsBusOperations = supportsBus;
    const supportsFlight = primaryServiceType === 'flight';
    const supportsTaxi = primaryServiceType === 'local_transport';
    const supportsTour = primaryServiceType === 'tour';
    const supportsRental = primaryServiceType === 'car_rental';
    const supportsCargo = primaryServiceType === 'cargo';
    const partnerCategory = normalize(company.partnerCategory || company.settings?.partnerCategory);
    const primaryLabel = supportsFlight ? 'Flight agency' : supportsTaxi && ['boda_rider','car_driver'].includes(partnerCategory) ? 'Driver' : supportsTaxi ? 'Mobility partner' : supportsTour ? 'Tour operator' : supportsRental ? 'Car rental partner' : supportsCargo ? 'Cargo partner' : (SERVICE_LABELS[primaryServiceType] || 'Company');
    const inventoryLabel = supportsBus ? 'Seat maps' : supportsHotel ? 'Rooms' : supportsFlight ? 'Customer quotes' : supportsTaxi ? 'My vehicle availability' : supportsTour ? 'Tour capacity' : supportsRental ? 'Vehicle availability' : supportsCargo ? 'Shipment capacity' : 'Inventory';
    const dashboardLabel = supportsBus ? 'Bus Operations Dashboard' : supportsHotel ? 'Hotel Operations Dashboard' : supportsFlight ? 'Flight Agent Dashboard' : supportsTaxi ? (['boda_rider','car_driver'].includes(partnerCategory) ? 'Driver Dashboard' : 'Mobility Partner Dashboard') : supportsTour ? 'Tour Operations Dashboard' : supportsRental ? 'Car Rental Dashboard' : supportsCargo ? 'Cargo Operations Dashboard' : `${primaryLabel} Operations Dashboard`;
    const visiblePages = new Set(COMPANY_SERVICE_PAGE_MAP[primaryServiceType] || COMPANY_COMMON_DASHBOARD_PAGES);
    if (supportsTaxi && ['boda_rider','car_driver'].includes(partnerCategory)) {
      visiblePages.delete('staff');
    }
    visiblePages.add('setup-guide');
    const pageMeta = {
      overview: [dashboardLabel, `Manage only this company's ${primaryLabel.toLowerCase()} operations, bookings, inventory, team work, support, revenue, and settlement.`],
      'setup-guide': [`${primaryLabel} Setup & Workflow Guide`, 'Follow the dependency order from company verification and operating locations through inventory, bookings, daily work, and settlement.'],
      listings: [`${primaryLabel} Listings`, `Manage only ${primaryLabel.toLowerCase()} services connected to this company.`],
      routes: ['Routes & Stops', 'Manage ordered terminals, boarding points, drop-off points, segments, and route readiness before creating departures.'],
      vehicles: ['Vehicles & Seat Templates', 'Manage compliant buses, published seat-map versions, and driver-ready fleet records.'],
      schedules: ['Departures & Fares', 'Manage linked fares, future dated departures, assigned vehicles, drivers, and persisted inventory.'],
      checkins: [supportsHotel ? 'Guest Check-ins' : 'Boarding Check-ins', supportsHotel ? 'Validate arriving guests and monitor stay status.' : 'Validate tickets and monitor boarding progress.'],
      seatrooms: [inventoryLabel, supportsBus ? 'Control persisted live departure inventory and blocked, held, or booked seats.' : 'Control room types, units, room-night inventory, housekeeping, and booked stays.'],
      'seat-maps': ['Live Departure Seat Maps', 'Control persisted live departure inventory generated from a published vehicle seat-map version.'],
      'hotel-rooms': ['Rooms & Inventory', 'Control hotel properties, room types, room units, room-night inventory, housekeeping, and booked stays.'],
      'flight-search': ['Search Live Flights', 'Search platform-approved airline and supplier offers for a customer. Agents cannot create airline schedules or seat inventory.'],
      'flight-quotes': ['Customer Flight Quotes', 'Create protected, time-limited quotes from live supplier prices without changing the customer fare.'],
      'flight-travelers': ['Flight Travelers', 'Review traveler and document-status summaries for bookings created by this agency.'],
      'flight-tickets': ['Tickets & Booking References', 'Track confirmed supplier references and issued e-tickets for this agency’s customers.'],
      'flight-changes': ['Flight Change Requests', 'Submit date, route, name, seat and baggage changes for platform review and supplier processing.'],
      'flight-refunds': ['Flight Refund Requests', 'Submit policy-controlled cancellation and refund requests without directly editing supplier records.'],
      'taxi-fleet': [partnerCategory === 'boda_rider' ? 'My Boda' : partnerCategory === 'car_driver' ? 'My Car' : 'My Fleet', 'Submit and maintain only vehicles owned by this account. Vehicle classes and approval rules are controlled by Super Admin.'],
      'taxi-drivers': [['boda_rider','car_driver'].includes(partnerCategory) ? 'My Rider / Driver Profile' : 'My Drivers', ['boda_rider','car_driver'].includes(partnerCategory) ? 'Maintain your own identity, licence, safety-training and assigned-vehicle record for Super Admin review.' : 'Maintain your own driver records. Super Admin controls verification, background review and platform activation.'],
      'taxi-availability': ['Go Online & Availability', 'Set verified riders and drivers online or offline and keep location heartbeats current for automatic dispatch.'],
      'taxi-operations': ['Assigned Rides', 'View only rides automatically assigned to your verified drivers and update permitted ride states.'],
      'taxi-incidents': ['Safety & Incidents', 'Report SOS, accident, conduct, vehicle and lost-item cases for restricted platform review.'],
      manifests: ['Manifests', supportsHotel ? 'Print hotel arrival, departure, and in-house lists.' : 'Print passenger manifests and operational lists.'],
      revenue: ['Revenue', 'View company revenue, booking splits, pending earnings, and refunds.'],
      ads: ['Promote Services', 'Create sponsored campaigns for this company’s own published services and track their placement, budget, clicks, and bookings.'],
      settlement: ['Settlement', 'Request payout and track pending, available, and paid-out earnings.'],
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
      supportsTaxi,
      supportsTour,
      supportsRental,
      supportsCargo,
      supportsBusOperations,
      supportsMultiple: false,
      partnerCategory,
      accountModel: normalize(company.accountModel || company.settings?.accountModel),
      capabilityPolicy: company.capabilityPolicy || company.settings?.capabilityPolicy || {},
      companyName: company.name || company.companyName || '',
      commercialTerms: {
        model: company.commercialTerms?.model || 'percentage_commission',
        commissionPercent: Number(company.commercialTerms?.commissionPercent ?? cachedPlatformConfig.partnerCommissionPercent ?? 0),
        partnerPayoutPercent: Math.max(0, 100 - Number(company.commercialTerms?.commissionPercent ?? cachedPlatformConfig.partnerCommissionPercent ?? 0)),
        promoterFunding: company.commercialTerms?.promoterFunding || 'platform_commission',
        termsVersion: company.commercialTerms?.termsVersion || cachedPlatformConfig.commercialTermsVersion || 'commission-v1',
        source: company.commercialTerms?.source || 'platform_default',
      },
      visiblePages: Array.from(visiblePages),
      pageMeta,
    };
  }
  function amountNumber(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number : 0;
  }
  function companyRefundAmountForBooking(booking = {}) {
    return (state.refundRequests || []).filter(refund => refund.bookingRef === booking.bookingRef || refund.bookingId === booking.id).filter(refund => !['rejected', 'cancelled', 'closed'].includes(normalize(refund.status))).reduce((total, refund) => total + amountNumber(refund.amount || booking.pricing?.total), 0);
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
    const financeCompany = findCompany(companyId) || {};
    const currency = financeCompany.operatingCurrency || financeCompany.settings?.defaultCurrency || platformCurrency();
    const bookingRefs = new Set(bookings.map(booking => booking.bookingRef).filter(Boolean));
    const companyWallet = (state.wallets || []).find(wallet => wallet.ownerType === 'company' && wallet.ownerId === companyId) || {};
    const companyTransactions = (state.walletTransactions || []).filter(txn => txn.ownerType === 'company' && txn.ownerId === companyId);
    const payoutRequests = (state.payoutRequests || []).filter(request => request.ownerType === 'company' && request.ownerId === companyId);
    const settlementBatchIds = new Set([...companyTransactions.map(txn => txn.settlementBatchId || txn.batchId).filter(Boolean), ...payoutRequests.map(request => request.settlementBatchId || request.payoutBatchId).filter(Boolean)]);
    const paymentByBooking = booking => (state.payments || []).find(payment => payment.bookingRef === booking.bookingRef || payment.bookingId === booking.id) || {};
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
        finance: {
          txnId,
          bookingRef: booking.bookingRef,
          serviceType: booking.serviceType,
          gross,
          companyEarning,
          platformFee,
          promoterCommission,
          refundDebit,
          netPayable,
          settlementStatus: status,
          payoutBatchId: booking.payoutBatchId || '',
          settlementBatchId: booking.settlementBatchId || ''
        },
        booking: bookingDetail(booking),
        payment,
        refundRequests: (state.refundRequests || []).filter(refund => refund.bookingRef === booking.bookingRef || refund.bookingId === booking.id),
        company: companyDetail(findCompany(companyId))
      };
      return [txnId, booking.bookingRef, service, formatMoney(gross, booking.pricing?.currency || payment.currency || platformCurrency()), formatMoney(companyEarning, booking.pricing?.currency || payment.currency || platformCurrency()), formatMoney(platformFee, booking.pricing?.currency || payment.currency || platformCurrency()), formatMoney(promoterCommission, booking.pricing?.currency || payment.currency || platformCurrency()), formatMoney(refundDebit, booking.pricing?.currency || payment.currency || platformCurrency()), formatMoney(netPayable, booking.pricing?.currency || payment.currency || platformCurrency()), status, dashboardMeta('company_finance_booking', txnId, booking.bookingRef || txnId, status, detail, ['view', 'booking', 'refunds', 'export'])];
    });
    const ledgerRows = companyTransactions.map(txn => [txn.id, txn.referenceId || txn.bookingRef || txn.bookingId || txn.transactionType || '-', txn.transactionType || txn.referenceType || 'wallet', txn.direction || '-', formatMoney(txn.amount || 0, txn.currency || platformCurrency()), txn.settlementBatchId || txn.batchId || '-', txn.payoutRequestId || txn.payoutId || '-', txn.status || 'pending', dashboardMeta('company_ledger_transaction', txn.id, txn.id, txn.status || 'pending', {
      transaction: txn,
      company: companyDetail(findCompany(companyId))
    }, ['view', 'settlement', 'export'])]);
    const settlementRows = (state.settlementBatches || []).filter(batch => settlementBatchIds.has(batch.id) || settlementBatchIds.has(batch.batchNumber) || batch.companyId && batch.companyId === companyId || batch.ownerId && batch.ownerId === companyId).map(batch => [batch.batchNumber || batch.id, batch.periodStart ? dateValue(batch.periodStart) : '-', batch.periodEnd ? dateValue(batch.periodEnd) : '-', formatMoney(batch.totalGross || 0, batch.currency || platformCurrency()), formatMoney(batch.totalPayable || batch.companyEarning || 0, batch.currency || platformCurrency()), String((batch.bookingRefs || batch.transactionIds || batch.requestIds || []).length || companyTransactions.filter(txn => [txn.settlementBatchId, txn.batchId].includes(batch.id) || [txn.settlementBatchId, txn.batchId].includes(batch.batchNumber)).length), batch.status || 'draft', dashboardMeta('company_settlement_batch', batch.id, batch.batchNumber || batch.id, batch.status || 'draft', {
      batch,
      transactions: companyTransactions.filter(txn => [txn.settlementBatchId, txn.batchId].includes(batch.id) || [txn.settlementBatchId, txn.batchId].includes(batch.batchNumber))
    }, ['view', 'statement', 'payouts', 'export'])]);
    const payoutRows = payoutRequests.map(request => [request.id, request.transactionId || '-', formatMoney(request.amount || 0, request.currency || platformCurrency()), request.payoutMethod || request.method || '-', request.payoutAccount || request.account || '-', request.payoutBatchId || request.batchId || '-', request.riskStatus || request.status || 'requested', request.status || 'requested', dashboardMeta('company_payout_request', request.id, request.id, request.status || 'requested', {
      request,
      company: companyDetail(findCompany(companyId))
    }, ['view', 'risk', 'batch', 'export'])]);
    const statementRows = (state.financeStatements || []).filter(statement => statement.ownerType === 'company' && statement.ownerId === companyId).map(statement => [statement.statementRef || statement.id, statement.periodStart ? dateValue(statement.periodStart) : '-', statement.periodEnd ? dateValue(statement.periodEnd) : '-', formatMoney(statement.gross || 0, statement.currency || platformCurrency()), formatMoney(statement.companyEarning || statement.closingBalance || 0, statement.currency || platformCurrency()), formatMoney(statement.refundDebits || 0, statement.currency || platformCurrency()), statement.status || 'issued', dashboardMeta('company_finance_statement', statement.id, statement.statementRef || statement.id, statement.status || 'issued', {
      statement,
      company: companyDetail(findCompany(companyId))
    }, ['view', 'export'])]);
    const gross = revenueRows.reduce((total, row) => total + amountNumber(row[3].replace(/[^0-9.-]/g, '')), 0);
    const companyEarning = bookings.reduce((total, booking) => total + amountNumber(booking.pricing?.split?.companyAmount || booking.pricing?.total), 0);
    const platformFee = bookings.reduce((total, booking) => total + amountNumber(booking.pricing?.split?.platformFee), 0);
    const promoterCommission = bookings.reduce((total, booking) => total + amountNumber(booking.pricing?.split?.promoterAmount), 0);
    const refundDebits = bookings.reduce((total, booking) => total + companyRefundAmountForBooking(booking), 0);
    const pending = companyTransactions.filter(txn => /pending|hold|review/.test(normalize(txn.status))).reduce((total, txn) => total + amountNumber(txn.amount), 0) || bookings.filter(booking => bookingSettlementLabel(booking).includes('pending')).reduce((total, booking) => total + amountNumber(booking.pricing?.split?.companyAmount || booking.pricing?.total), 0);
    const released = companyTransactions.filter(txn => /released|completed|settled|paid/.test(normalize(txn.status))).reduce((total, txn) => total + amountNumber(txn.amount), 0);
    return {
      summary: {
        gross: formatMoney(gross || bookings.reduce((total, booking) => total + amountNumber(booking.pricing?.total), 0), currency),
        companyEarning: formatMoney(companyEarning, currency),
        platformFee: formatMoney(platformFee, currency),
        promoterCommission: formatMoney(promoterCommission, currency),
        refundDebits: formatMoney(refundDebits, currency),
        netPayable: formatMoney(Math.max(0, companyEarning - refundDebits), currency),
        pending: formatMoney(pending, currency),
        released: formatMoney(released, currency),
        availableBalance: formatMoney(companyWallet.availableBalance || 0, companyWallet.currency || currency),
        pendingBalance: formatMoney(companyWallet.pendingBalance || 0, companyWallet.currency || currency),
        bookings: String(bookings.length),
        refunds: String((state.refundRequests || []).filter(refund => bookingRefs.has(refund.bookingRef)).length)
      },
      revenueRows,
      settlementRows: settlementRows.length ? settlementRows : [['Current pending batch', 'Current', dateValue(new Date()), formatMoney(bookings.reduce((total, booking) => total + amountNumber(booking.pricing?.total), 0), currency), formatMoney(Math.max(0, companyEarning - refundDebits), currency), String(bookings.length), pending > 0 ? 'pending release' : 'ready', dashboardMeta('company_settlement_batch', 'current-pending', 'Current pending batch', pending > 0 ? 'pending release' : 'ready', {
        settlement: {
          bookings: bookings.map(booking => booking.bookingRef),
          pending,
          released,
          refundDebits
        },
        company: companyDetail(findCompany(companyId))
      }, ['view', 'export'])]],
      ledgerRows,
      payoutRows,
      statementRows
    };
  }
  function companyDashboardData(companyId, listings, bookings, context = {}) {
    const company = findCompany(companyId) || {};
    bookings = (bookings || []).filter((booking) => !(normalize(booking.paymentStatus) === 'failed' && ['cancelled', 'failed', 'pending_payment', 'draft'].includes(normalize(booking.bookingStatus))));
    const financialBookings = bookings.filter((booking) => normalize(booking.paymentStatus) === 'successful' && !['failed', 'cancelled', 'voided'].includes(normalize(booking.bookingStatus)));
    const ownerUser = state.users.find(user => user.id === company.ownerId) || state.users.find(user => user.companyId === companyId && ['company_admin', 'partner'].includes(user.role)) || {};
    // Bus ownership is resolved through the company's canonical listing chain.
    // Legacy records may omit companyId, but an explicit different companyId is
    // always rejected. This keeps old valid departures visible without opening
    // cross-company data access.
    const busScope = buildCompanyBusScope(state, companyId, listings);
    const companyRoutes = busScope.routes;
    const routeStops = busScope.routeStops;
    const fareProducts = busScope.fareProducts;
    const segmentFares = busScope.segmentFares;
    const serviceAddons = busScope.serviceAddons;
    const seatMapTemplates = busScope.seatMapTemplates;
    const seatMapVersions = busScope.seatMapVersions;
    const vehicles = busScope.vehicles;
    const schedules = busScope.schedules;
    const scheduleRules = Array.isArray(state.scheduleRules) ? state.scheduleRules.filter((rule) => String(rule.companyId || '') === String(companyId)) : [];
    const rooms = state.roomSummaries.filter(room => room.companyId === companyId);
    const reviews = state.reviews.filter(review => review.companyId === companyId);
    const companyEmployees = Array.isArray(state.companyEmployees) ? state.companyEmployees.filter(employee => String(employee.companyId || '') === String(companyId)) : [];
    const companyInvitations = Array.isArray(state.invitations) ? state.invitations.filter(invitation => String(invitation.companyId || '') === String(companyId) && ['staff', 'driver'].includes(normalize(invitation.type))) : [];
    const companyVerificationReviews = Array.isArray(state.verificationReviews) ? state.verificationReviews.filter(review => String(review.companyId || '') === String(companyId)) : [];
    const companyBranches = Array.isArray(state.companyBranches) ? state.companyBranches.filter(branch => branch.companyId === companyId) : [];
    const companyPolicies = Array.isArray(state.companyPolicies) ? state.companyPolicies.filter(policy => policy.companyId === companyId) : [];
    const driverAssignments = Array.isArray(state.driverAssignments) ? state.driverAssignments.filter(assignment => assignment.companyId === companyId) : [];
    const driverIncidents = Array.isArray(state.driverIncidents) ? state.driverIncidents.filter(incident => incident.companyId === companyId) : [];
    const tripStatusUpdates = Array.isArray(state.tripStatusUpdates) ? state.tripStatusUpdates.filter(update => update.companyId === companyId) : [];
    const hotelProperties = Array.isArray(state.hotelProperties) ? state.hotelProperties.filter(property => property.companyId === companyId) : [];
    const roomTypes = Array.isArray(state.roomTypes) ? state.roomTypes.filter(roomType => roomType.companyId === companyId) : [];
    const roomUnits = Array.isArray(state.roomUnits) ? state.roomUnits.filter(unit => unit.companyId === companyId) : [];
    const roomNightInventories = Array.isArray(state.roomNightInventories) ? state.roomNightInventories.filter(night => night.companyId === companyId) : [];
    const ratePlans = Array.isArray(state.ratePlans) ? state.ratePlans.filter(plan => plan.companyId === companyId) : [];
    const hotelReservations = Array.isArray(state.hotelReservations) ? state.hotelReservations.filter(reservation => reservation.companyId === companyId) : [];
    const hotelGuests = Array.isArray(state.hotelGuests) ? state.hotelGuests.filter(guest => guest.companyId === companyId) : [];
    const roomAssignments = Array.isArray(state.roomAssignments) ? state.roomAssignments.filter(assignment => assignment.companyId === companyId) : [];
    const housekeepingTasks = Array.isArray(state.housekeepingTasks) ? state.housekeepingTasks.filter(task => task.companyId === companyId) : [];
    const maintenanceBlocks = Array.isArray(state.maintenanceBlocks) ? state.maintenanceBlocks.filter(block => block.companyId === companyId) : [];
    const airlines = Array.isArray(state.airlines) ? state.airlines.filter(row => row.companyId === companyId) : [];
    const flightSuppliers = Array.isArray(state.flightSuppliers) ? state.flightSuppliers.filter(row => row.companyId === companyId) : [];
    const aircraft = Array.isArray(state.aircraft) ? state.aircraft.filter(row => row.companyId === companyId) : [];
    const flightSeatMapVersions = Array.isArray(state.flightSeatMapVersions) ? state.flightSeatMapVersions.filter(row => row.companyId === companyId) : [];
    const flightRoutes = Array.isArray(state.flightRoutes) ? state.flightRoutes.filter(row => row.companyId === companyId) : [];
    const flightFareFamilies = Array.isArray(state.flightFareFamilies) ? state.flightFareFamilies.filter(row => row.companyId === companyId) : [];
    const flightDepartures = Array.isArray(state.flightDepartures) ? state.flightDepartures.filter(row => row.companyId === companyId) : [];
    const flightSeatInventories = Array.isArray(state.flightSeatInventories) ? state.flightSeatInventories.filter(row => row.companyId === companyId) : [];
    const flightOrders = Array.isArray(state.flightOrders) ? state.flightOrders.filter(row => row.agentCompanyId === companyId) : [];
    const flightTravelers = Array.isArray(state.flightTravelers) ? state.flightTravelers.filter(row => row.agentCompanyId === companyId) : [];
    const flightTickets = Array.isArray(state.flightTickets) ? state.flightTickets.filter(row => row.agentCompanyId === companyId) : [];
    const flightAncillaries = Array.isArray(state.flightAncillaries) ? state.flightAncillaries.filter(row => row.companyId === companyId) : [];
    const flightScheduleChanges = Array.isArray(state.flightScheduleChanges) ? state.flightScheduleChanges.filter(row => row.companyId === companyId) : [];
    const flightAgentQuotes = Array.isArray(state.flightAgentQuotes) ? state.flightAgentQuotes
      .filter(row => row.agentCompanyId === companyId)
      .map(row => {
        const token = sensitiveFieldService.decrypt(row.publicTokenEncrypted, 'flight-agent-share-token');
        return {
          ...row,
          offerTokenEncrypted: undefined,
          publicTokenHash: undefined,
          publicTokenEncrypted: undefined,
          sharePath: token ? `/api/v1/flights/agent-quotes/${encodeURIComponent(row.quoteRef)}?token=${encodeURIComponent(token)}` : '',
        };
      }) : [];
    const flightChangeRequests = Array.isArray(state.flightChangeRequests) ? state.flightChangeRequests.filter(row => row.agentCompanyId === companyId) : [];
    const flightRefundRequests = Array.isArray(state.flightRefundRequests) ? state.flightRefundRequests.filter(row => row.agentCompanyId === companyId) : [];
    const vehicleClasses = Array.isArray(state.vehicleClasses) ? state.vehicleClasses.filter(row => row.companyId === 'platform' && row.status === 'active') : [];
    const taxiVehicles = Array.isArray(state.taxiVehicles) ? state.taxiVehicles.filter(row => row.companyId === companyId) : [];
    const taxiDrivers = Array.isArray(state.taxiDriverProfiles) ? state.taxiDriverProfiles.filter(row => row.companyId === companyId) : [];
    const taxiZones = []; // Platform zones are not editable or exposed in partner workspaces.
    const taxiFareRules = []; // Platform fare rules remain Super Admin-only.
    const driverAvailabilities = Array.isArray(state.driverAvailabilities) ? state.driverAvailabilities.filter(row => row.companyId === companyId) : [];
    const driverLocations = Array.isArray(state.driverLocations) ? state.driverLocations.filter(row => row.companyId === companyId) : [];
    const taxiRides = Array.isArray(state.taxiRides) ? state.taxiRides.filter(row => row.providerCompanyId === companyId) : [];
    const rideAssignments = Array.isArray(state.rideAssignments) ? state.rideAssignments.filter(row => row.providerCompanyId === companyId) : [];
    const taxiIncidents = Array.isArray(state.taxiIncidents) ? state.taxiIncidents.filter(row => row.companyId === companyId) : [];
    const driverEarnings = Array.isArray(state.driverEarnings) ? state.driverEarnings.filter(row => row.companyId === companyId) : [];
    const assignedTaxiDriverUsers = new Set(taxiDrivers.map(row => String(row.userId || '')).filter(Boolean));
    const mobilityDriverCandidates = companyEmployees
      .filter(row => String(row.status || '').toLowerCase() === 'active' && row.userId && !assignedTaxiDriverUsers.has(String(row.userId)))
      .map(row => {
        const user = (state.users || []).find(item => String(item.id || item._id || '') === String(row.userId || '')) || {};
        return {
          id: row.id,
          userId: row.userId,
          label: `${user.fullName || row.fullName || row.email || row.userId}${row.roleTitle ? ` · ${row.roleTitle}` : ''}`,
          roleTitle: row.roleTitle || '',
        };
      });
    const airports = Array.isArray(state.airports) ? state.airports : [];
    const aircraftTypes = Array.isArray(state.aircraftTypes) ? state.aircraftTypes : [];
    const serviceProfile = buildCompanyServiceProfile(company, listings, {
      hotelProperties,
      roomTypes,
      roomUnits,
      rooms,
      vehicles,
      schedules,
      airlines,
      aircraft,
      flightDepartures,
      taxiVehicles,
      taxiDrivers,
      taxiRides
    });
    const listingSupportsVisibleService = listingId => {
      const listing = findListing(listingId) || {};
      const type = normalize(listing.serviceType);
      return !type || serviceProfile.serviceTypes.includes(type);
    };
    const visibleRoutes = serviceProfile.supportsBusOperations ? companyRoutes.filter(route => listingSupportsVisibleService(route.listingId)) : [];
    const visibleRouteIds = new Set(visibleRoutes.map(busScopeRowId).filter(Boolean));
    const visibleRouteStops = serviceProfile.supportsBusOperations ? routeStops.filter(stop => visibleRouteIds.has(String(stop.routeId || ''))) : [];
    const visibleSchedules = serviceProfile.supportsBusOperations ? schedules.filter(schedule => listingSupportsVisibleService(schedule.listingId)) : [];
    const visibleScheduleRules = serviceProfile.supportsBusOperations ? scheduleRules.filter((rule) => listingSupportsVisibleService(rule.listingId)) : [];
    const busScheduleContext = {
      listingById: new Map(listings.map(item => [String(item.id || ''), item])),
      routeById: new Map(companyRoutes.map(item => [busScopeRowId(item), item]).filter(([id]) => id)),
      vehicleById: new Map(vehicles.map(item => [busScopeRowId(item), item]).filter(([id]) => id)),
    };
    const busSchedules = serviceProfile.supportsBus
      ? schedules.filter(schedule => isBusDepartureSchedule(schedule, busScheduleContext))
      : [];
    const visibleVehicles = serviceProfile.supportsBusOperations ? vehicles.filter(vehicle => listingSupportsVisibleService(vehicle.listingId) || serviceProfile.serviceTypes.includes(normalize(vehicle.serviceType))) : [];
    const vehicleSeatTemplates = buildVehicleSeatTemplateProjections({ vehicles: visibleVehicles, templates: seatMapTemplates, versions: seatMapVersions });
    const hasOwnedHotelInventory = serviceProfile.supportsHotel || listings.some(listing => normalize(listing.serviceType) === 'hotel') || rooms.length || hotelProperties.length || roomTypes.length || roomUnits.length || roomNightInventories.length || ratePlans.length || hotelReservations.length;
    const visibleRooms = hasOwnedHotelInventory ? rooms : [];
    const visibleHotelProperties = hasOwnedHotelInventory ? hotelProperties : [];
    const visibleRoomTypes = hasOwnedHotelInventory ? roomTypes : [];
    const visibleRoomUnits = hasOwnedHotelInventory ? roomUnits : [];
    const visibleRoomNightInventories = hasOwnedHotelInventory ? roomNightInventories : [];
    const visibleRatePlans = hasOwnedHotelInventory ? ratePlans : [];
    const visibleHotelReservations = hasOwnedHotelInventory ? hotelReservations : [];
    const visibleHotelGuests = hasOwnedHotelInventory ? hotelGuests : [];
    const visibleRoomAssignments = hasOwnedHotelInventory ? roomAssignments : [];
    const visibleHousekeepingTasks = hasOwnedHotelInventory ? housekeepingTasks : [];
    const visibleMaintenanceBlocks = hasOwnedHotelInventory ? maintenanceBlocks : [];
    const hotelBookings = hasOwnedHotelInventory ? bookings.filter(booking => booking.serviceType === 'hotel') : [];
    const supportTickets = state.supportTickets.filter(ticket => ticket.companyId === companyId || ticket.ownerType === 'company' && (!ticket.ownerId || ticket.ownerId === companyId));
    const companyNotificationRows = (state.notifications || [])
      .filter(note => !note.companyId || note.companyId === companyId || note.ownerId === companyId)
      .slice(0, 12)
      .map(note => [
        note.title || note.subject || note.id,
        note.type || note.channel || (Array.isArray(note.channels) ? note.channels.join(', ') : 'Notification'),
        note.message || note.body || '',
        dateValue(note.createdAt || note.updatedAt || new Date()),
        note.status || note.deliveryStatus || 'Unread',
        dashboardMeta('notification', note.id, note.title || note.subject, note.status, notificationDetail(note), ['view', 'mark_read', 'export']),
      ]);
    const companyCurrency = company.operatingCurrency || company.settings?.defaultCurrency || platformCurrency();
    const grossRevenue = financialBookings.reduce((total, booking) => total + Number(booking.pricing?.total || 0), 0);
    const companyEarnings = financialBookings.reduce((total, booking) => total + Number(booking.pricing?.split?.companyAmount || 0), 0);
    const companyFinance = buildCompanyFinanceDrilldown(companyId, financialBookings);
    const busScheduleIds = new Set(busSchedules.map(busScopeRowId).filter(Boolean));
    const seats = busScope.seats.filter((seat) => busScheduleIds.has(String(seat.scheduleId || seat.departureId || seat.tripScheduleId || '')));
    const bookedSeats = seats.length
      ? seats.filter(seat => ['taken', 'booked', 'sold'].includes(normalize(seat.status))).length
      : busSchedules.reduce((total, schedule) => total + Math.max(0, Number(schedule.totalSeats || 0) - Number(schedule.availableSeats || 0)), 0);
    const heldSeats = seats.filter(seat => seat.status === 'locked').length;
    const blockedSeats = seats.filter(seat => seat.status === 'blocked').length;
    const fillRate = seats.length ? Math.round(bookedSeats / seats.length * 100) : 0;
    const activeListings = listings.filter(listing => listing.status === 'active');
    const activeSchedules = visibleSchedules.filter(schedule => schedule.status === 'active');
    const checkedInBookings = bookings.filter(booking => booking.bookingStatus === 'checked_in');
    const scheduleLabel = schedule => {
      const departAt = schedule.departAt ? new Date(schedule.departAt) : null;
      const time = departAt && !Number.isNaN(departAt.getTime()) ? departAt.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit'
      }) : '';
      return `${dateValue(schedule.departAt)}${time ? ` ${time}` : ''}`;
    };
    const listingOption = listing => ({
      id: listing.id,
      value: listing.id,
      label: listing.title,
      title: listing.title,
      serviceType: listing.serviceType,
      branchId: listing.branchId || '',
      currency: listing.currency || companyCurrency,
      country: listing.country || company.country || '',
      city: listing.city || '',
      baggageRules: listing.baggageRules || '',
      cancellationRules: listing.cancellationRules || '',
      status: listing.status
    });
    const routeOption = route => {
      const listing = findListing(route.listingId);
      return {
        id: route.id,
        value: route.id,
        label: `${formatRouteLabel(route.origin, route.destination, route.routeName)}${listing ? ` - ${listing.title}` : ''}`,
        listingId: route.listingId,
        routeName: formatRouteLabel(route.origin, route.destination, route.routeName),
        routeCode: route.routeCode || '',
        origin: route.origin || '',
        destination: route.destination || '',
        originStopId: route.originStopId || '',
        destinationStopId: route.destinationStopId || '',
        timezone: route.timezone || 'Africa/Kampala',
        estimatedDuration: route.estimatedDuration || '',
        estimatedDurationMinutes: route.estimatedDurationMinutes || '',
        operatingDays: (route.operatingDays || []).join(','),
        activeFareProductId: route.activeFareProductId || '',
        currency: listing?.currency || companyCurrency,
        baggageRules: route.baggageRules || listing?.baggageRules || '',
        cancellationRules: route.cancellationRules || listing?.cancellationRules || '',
        status: route.status
      };
    };
    const scheduleOption = schedule => ({
      id: schedule.id,
      value: schedule.id,
      label: `${scheduleLabel(schedule)} - ${bookingTitle({
        listingId: schedule.listingId
      })}`,
      routeId: schedule.routeId,
      listingId: schedule.listingId,
      vehicleId: schedule.vehicleId || '',
      driverEmployeeId: schedule.driverEmployeeId || '',
      fareProductId: schedule.fareProductId || '',
      currency: schedule.currency || '',
      totalSeats: schedule.totalSeats || '',
      departAt: schedule.departAt || '',
      arriveAt: schedule.arriveAt || '',
      status: schedule.status
    });
    const roomOption = room => ({
      id: room.id,
      value: room.id,
      label: `${room.roomType} - ${bookingTitle({
        listingId: room.listingId
      })}`,
      listingId: room.listingId,
      status: room.status
    });
    const vehicleOption = vehicle => {
      const activeVersion = seatMapVersions.find(version => version.id === vehicle.activeSeatMapVersionId)
        || seatMapVersions.filter(version => version.vehicleId === vehicle.id && version.status === 'published').sort((a, b) => Number(b.version || 0) - Number(a.version || 0))[0]
        || {};
      const versionSeats = Array.isArray(activeVersion.seats) && activeVersion.seats.length
        ? activeVersion.seats
        : Array.isArray(vehicle.seatTemplate) ? vehicle.seatTemplate : [];
      const seatNumber = seat => seat.seatNumber || seat.label || seat.id;
      return {
        id: vehicle.id,
        value: vehicle.id,
        label: `${vehicle.name}${vehicle.plateOrCode ? ` - ${vehicle.plateOrCode}` : ''} (${vehicle.totalSeats || versionSeats.length || 0} seats)`,
        title: vehicle.name || vehicle.id,
        serviceType: vehicle.serviceType,
        listingId: vehicle.listingId,
        vehicleId: vehicle.id,
        plateOrCode: vehicle.plateOrCode || '',
        layoutName: activeVersion.layoutName || vehicle.layoutName || '2x2',
        numberingStartSide: activeVersion.numberingStartSide || vehicle.numberingStartSide || 'left',
        driverPosition: activeVersion.driverPosition || vehicle.driverPosition || 'right',
        frontRowPassengerSeats: Number(activeVersion.frontRowPassengerSeats ?? vehicle.frontRowPassengerSeats ?? 0) === 1 ? 1 : 0,
        rowLayoutOverrides: (activeVersion.rowLayoutOverrides || vehicle.rowLayoutOverrides || []).map((row) => `${row.row}:${row.leftSeats}+${row.rightSeats}`).join(', '),
        seatLabelMode: activeVersion.labelMode || vehicle.seatLabelMode || 'automatic',
        seatLabelPrefix: activeVersion.labelPrefix || vehicle.seatLabelPrefix || '',
        rows: activeVersion.rows || vehicle.rows || '',
        columns: activeVersion.columns || vehicle.cols || '',
        totalSeats: activeVersion.totalSeats || vehicle.totalSeats || versionSeats.length || '',
        vehicleClass: vehicle.vehicleClass || activeVersion.vehicleClass || (String(vehicle.defaultSeatClass || '').toLowerCase() === 'vip' ? 'vip' : 'standard'),
        seatLabels: versionSeats.map(seatNumber).filter(Boolean).join(','),
        accessibleSeats: versionSeats.filter(seat => seat.accessible || /accessible/i.test([seat.seatClass, seat.seatType].join(' '))).map(seatNumber).filter(Boolean).join(','),
        crewSeats: versionSeats.filter(seat => /crew/i.test([seat.seatClass, seat.seatType, seat.blockedReason].join(' '))).map(seatNumber).filter(Boolean).join(','),
        disabledSeats: versionSeats.filter(seat => seat.enabled === false || seat.isDisabled || /disabled|non-passenger/i.test(String(seat.blockedReason || seat.status || ''))).map(seatNumber).filter(Boolean).join(','),
        blockedSeats: versionSeats.filter(seat => /blocked|maintenance|reserved/i.test(String(seat.blockedReason || seat.status || ''))).map(seatNumber).filter(Boolean).join(','),
        defaultSeatClass: vehicle.defaultSeatClass || ((vehicle.vehicleClass || activeVersion.vehicleClass) === 'vip' ? 'VIP' : 'Standard'),
        activeSeatMapVersionId: activeVersion.id || vehicle.activeSeatMapVersionId || '',
        seatMapVersion: activeVersion.version || '',
        seatMapStatus: activeVersion.status || '',
        manufacturer: vehicle.manufacturer || '',
        modelName: vehicle.modelName || '',
        modelYear: vehicle.modelYear || '',
        operatorPermitRef: vehicle.operatorPermitRef || '',
        operatorPermitExpiresAt: vehicle.operatorPermitExpiresAt || '',
        inspectionRef: vehicle.inspectionRef || '',
        inspectionExpiresAt: vehicle.inspectionExpiresAt || '',
        insuranceRef: vehicle.insuranceRef || '',
        insuranceExpiresAt: vehicle.insuranceExpiresAt || '',
        amenities: (vehicle.amenities || []).join(','),
        status: vehicle.status
      };
    };
    const branchOption = branch => ({
      id: branch.id,
      value: branch.id,
      label: `${branch.name}${branch.city ? ` - ${branch.city}` : ''}`,
      branchType: branch.branchType,
      title: branch.name || branch.id,
      terminalCode: branch.terminalCode || '',
      city: branch.city || '',
      country: branch.country || '',
      address: branch.address || '',
      status: branch.status
    });
    const fareProductOption = fare => {
      const route = visibleRoutes.find(item => item.id === fare.routeId) || {};
      const fullRouteFare = segmentFares.find(row => row.fareProductId === fare.id && row.fromStopId === route.originStopId && row.toStopId === route.destinationStopId && row.status === 'active')
        || segmentFares.filter(row => row.fareProductId === fare.id && row.status === 'active').sort((a, b) => (Number(b.toOrder || 0) - Number(b.fromOrder || 0)) - (Number(a.toOrder || 0) - Number(a.fromOrder || 0)))[0]
        || {};
      return {
        id: fare.id,
        value: fare.id,
        label: `${fare.name || fare.fareClass || 'Fare'}${fare.currency ? ` - ${fare.currency}` : ''}${fullRouteFare.amount != null ? ` ${fullRouteFare.amount}` : ''}`,
        title: fare.name || fare.id,
        listingId: fare.listingId,
        routeId: fare.routeId,
        fareProductId: fare.id,
        fareClass: fare.fareClass || 'standard',
        currency: fare.currency || companyCurrency,
        amount: fullRouteFare.amount ?? '',
        baggageAllowanceKg: fare.baggageAllowanceKg || 0,
        refundable: String(Boolean(fare.refundable)),
        changeable: String(Boolean(fare.changeable)),
        status: fare.status
      };
    };
    const routeStopOption = stop => ({
      id: stop.id,
      value: stop.id,
      label: `${stop.stopOrder || ''}. ${stop.name || stop.id}`,
      routeId: stop.routeId,
      branchId: stop.branchId || '',
      stopOrder: stop.stopOrder || '',
      stopType: stop.stopType || '',
      pickupAllowed: String(Boolean(stop.pickupAllowed)),
      dropoffAllowed: String(Boolean(stop.dropoffAllowed)),
      status: stop.status
    });
    const driverOption = employee => {
      const user = state.users.find(item => String(item.id || item._id || '') === String(employee.userId || '')) || {};
      const assignment = evaluateDriverAssignment(employee, user);
      const lifecycle = [employee.status || 'unknown', user.verificationStatus || user.status || 'not verified'].filter(Boolean).join(' · ');
      return {
        id: employee.id,
        value: employee.id,
        userId: employee.userId,
        label: `${user.fullName || employee.fullName || user.email || employee.email || employee.phone || employee.id}${employee.licenseNumber ? ` - ${employee.licenseNumber}` : ''} [${lifecycle}]`,
        status: employee.status,
        operational: assignment.operational,
        warnings: assignment.warnings,
      };
    };
    const seatInventoryRows = busSchedules.map(schedule => {
      const scheduleSeats = seatsForSchedule(schedule.id);
      const totalSeats = scheduleSeats.length || Number(schedule.totalSeats || 0);
      const sold = scheduleSeats.filter(seat => ['taken', 'booked', 'checked-in'].includes(normalize(seat.status))).length;
      const held = scheduleSeats.filter(seat => ['locked', 'held', 'selected'].includes(normalize(seat.status))).length;
      const blocked = scheduleSeats.filter(seat => ['blocked', 'maintenance', 'disabled'].includes(normalize(seat.status))).length;
      return [`Seat map ${schedule.id}`, bookingTitle({
        listingId: schedule.listingId
      }), String(totalSeats), String(sold), String(held), String(blocked), schedule.status, {
        entity: 'schedule',
        id: schedule.id,
        label: `Seat map ${schedule.id}`,
        status: schedule.status
      }];
    });
    const seatMaps = buildLiveDepartureSeatMaps({
      schedules: busSchedules,
      listings,
      routes: visibleRoutes.length ? visibleRoutes : companyRoutes,
      vehicles: visibleVehicles.length ? visibleVehicles : vehicles,
      seatMapVersions,
      seats: busScope.seats,
      bookings,
    });
    const roomInventoryRows = visibleRooms.map(room => {
      const roomBookings = bookings.filter(booking => booking.listingId === room.listingId && booking.passengers?.some(passenger => passenger.seatOrRoom === room.roomType)).length;
      return [room.roomType, bookingTitle({
        listingId: room.listingId
      }), String(room.inventory + roomBookings), String(roomBookings), '0', room.status === 'active' ? '0' : String(room.inventory), room.status, {
        entity: 'room',
        id: room.id,
        label: room.roomType,
        status: room.status,
        detail: {
          room,
          listing: listingDetail(findListing(room.listingId) || {}),
          company: companyDetail(company)
        }
      }];
    });
    const propertyById = propertyId => visibleHotelProperties.find(property => String(property.id) === String(propertyId)) || {};
    const roomTypeById = roomTypeId => visibleRoomTypes.find(roomType => String(roomType.id) === String(roomTypeId)) || {};
    const roomUnitById = roomUnitId => visibleRoomUnits.find(unit => String(unit.id) === String(roomUnitId)) || {};
    const ratePlanById = ratePlanId => visibleRatePlans.find(plan => String(plan.id) === String(ratePlanId)) || {};
    const reservationById = reservationId => visibleHotelReservations.find(reservation => String(reservation.id) === String(reservationId)) || {};
    const hotelDateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: company.timezone || 'Africa/Kampala', year: 'numeric', month: '2-digit', day: '2-digit' });
    const requestedHotelDate = /^\d{4}-\d{2}-\d{2}$/.test(String(context.hotelManifestDate || '')) ? String(context.hotelManifestDate) : '';
    const hotelToday = requestedHotelDate || hotelDateFormatter.format(new Date());
    const maskIdentity = value => {
      const text = String(value || '').trim();
      if (!text) return '-';
      if (text.length <= 4) return '*'.repeat(text.length);
      return `${text.slice(0, 2)}${'*'.repeat(Math.max(2, text.length - 4))}${text.slice(-2)}`;
    };
    const requestedHotelListingId = String(context.hotelManifestListingId || '').trim();
    const manifestListingMatches = row => !requestedHotelListingId || String(row.listingId || '') === requestedHotelListingId;
    const normalizedReservationRows = visibleHotelReservations.filter(reservation => manifestListingMatches(reservation) && !['cancelled', 'refunded', 'failed', 'expired'].includes(normalize(reservation.status)));
    const legacyReservationRows = hotelBookings.filter(booking => {
      const status = normalize(booking.hotelStay?.status || booking.bookingStatus);
      return manifestListingMatches(booking)
        && !['cancelled', 'refunded', 'voided', 'failed', 'expired'].includes(status)
        && !visibleHotelReservations.some(reservation => String(reservation.bookingRef) === String(booking.bookingRef));
    }).map(booking => ({
      id: `legacy:${booking.bookingRef}`,
      bookingRef: booking.bookingRef,
      bookingId: booking.id,
      companyId,
      listingId: booking.listingId,
      propertyId: booking.hotelStay?.propertyId || '',
      checkInDate: booking.hotelStay?.checkIn || '',
      checkOutDate: booking.hotelStay?.checkOut || '',
      actualCheckInAt: booking.hotelStay?.actualCheckInAt || booking.checkedInAt,
      actualCheckOutAt: booking.hotelStay?.actualCheckOutAt || booking.checkedOutAt,
      roomCount: Number(booking.hotelStay?.roomCount || 1),
      adults: Number(booking.hotelStay?.adults || booking.passengers?.length || 1),
      children: Number(booking.hotelStay?.children || 0),
      infants: Number(booking.hotelStay?.infants || 0),
      status: booking.hotelStay?.status || booking.bookingStatus,
      paymentStatus: booking.paymentStatus,
      settlementStatus: booking.settlementStatus,
      specialRequests: booking.hotelStay?.specialRequests || booking.specialRequests || '',
      _legacyBooking: booking,
    }));
    const allHotelReservations = [...normalizedReservationRows, ...legacyReservationRows];
    const hotelReservationManifestRow = reservation => {
      const booking = reservation._legacyBooking || findBooking(reservation.bookingRef) || state.bookings.find(item => String(item.id) === String(reservation.bookingId)) || {};
      const guests = visibleHotelGuests.filter(guest => String(guest.reservationId) === String(reservation.id));
      const leadGuest = guests.find(guest => guest.isLeadGuest) || guests[0] || booking.passengers?.[0] || booking.guestSnapshot || {};
      const assignments = visibleRoomAssignments.filter(assignment => String(assignment.reservationId) === String(reservation.id));
      const property = propertyById(reservation.propertyId);
      const listing = findListing(reservation.listingId) || {};
      const roomLabels = assignments.length
        ? assignments.map(assignment => assignment.roomNumberSnapshot || roomUnitById(assignment.roomUnitId).unitNumber || assignment.roomUnitId).filter(Boolean)
        : (booking.passengers || []).map(guest => guest.seatOrRoom || guest.roomNumber || guest.roomType).filter(Boolean);
      const identityNumber = leadGuest.identityNumber || leadGuest.documentNumber || leadGuest.idNumber || '';
      const identityLabel = [leadGuest.identityType || leadGuest.documentType, maskIdentity(identityNumber), leadGuest.nationality].filter(Boolean).join(' / ') || '-';
      const occupancy = `${Number(reservation.adults || 1)}A${Number(reservation.children || 0) ? ` · ${Number(reservation.children)}C` : ''}${Number(reservation.infants || 0) ? ` · ${Number(reservation.infants)}I` : ''} · ${Number(reservation.roomCount || assignments.length || 1)} room${Number(reservation.roomCount || assignments.length || 1) === 1 ? '' : 's'}`;
      const contact = leadGuest.phone || leadGuest.email || booking.guestSnapshot?.phone || booking.guestSnapshot?.email || '-';
      const status = reservation.status || booking.hotelStay?.status || booking.bookingStatus || 'confirmed';
      const detail = {
        reservation,
        booking: bookingDetail(booking),
        guests,
        assignments,
        property,
        listing: listingDetail(listing),
      };
      return [
        reservation.bookingRef || booking.bookingRef || '-',
        leadGuest.fullName || leadGuest.name || bookingCustomer(booking) || 'Guest',
        contact,
        identityLabel,
        property.propertyName || listing.title || 'Hotel property',
        roomLabels.join(', ') || 'Room pending',
        occupancy,
        reservation.actualCheckInAt ? `${reservation.checkInDate || '-'} · ${dateValue(reservation.actualCheckInAt)}` : reservation.checkInDate || '-',
        reservation.actualCheckOutAt ? `${reservation.checkOutDate || '-'} · ${dateValue(reservation.actualCheckOutAt)}` : reservation.checkOutDate || '-',
        reservation.paymentStatus || booking.paymentStatus || 'pending',
        status,
        dashboardMeta('hotel_booking', reservation.bookingRef || booking.bookingRef, reservation.bookingRef || booking.bookingRef, status, detail, ['view', 'check_in', 'no_show', 'check_out', 'manifest', 'export']),
      ];
    };
    const hotelManifestAllRows = allHotelReservations.slice().sort((a, b) => String(a.checkInDate || '').localeCompare(String(b.checkInDate || ''))).map(hotelReservationManifestRow);
    const hotelHistoryRows = visibleHotelReservations.filter(reservation => manifestListingMatches(reservation) && ['checked_out', 'completed', 'cancelled', 'no_show', 'refunded', 'failed', 'expired'].includes(normalize(reservation.status))).sort((a, b) => String(b.updatedAt || b.checkOutDate || '').localeCompare(String(a.updatedAt || a.checkOutDate || ''))).map(hotelReservationManifestRow);
    const hotelArrivalRows = allHotelReservations.filter(reservation => String(reservation.checkInDate || '').slice(0, 10) === hotelToday && ['awaiting_payment', 'confirmed'].includes(normalize(reservation.status))).map(hotelReservationManifestRow);
    const hotelDepartureRows = allHotelReservations.filter(reservation => String(reservation.checkOutDate || '').slice(0, 10) === hotelToday && ['confirmed', 'checked_in', 'checked_out'].includes(normalize(reservation.status))).map(hotelReservationManifestRow);
    const hotelInHouseRows = allHotelReservations.filter(reservation => String(reservation.checkInDate || '').slice(0, 10) <= hotelToday && String(reservation.checkOutDate || '').slice(0, 10) > hotelToday && ['checked_in'].includes(normalize(reservation.status))).map(hotelReservationManifestRow);
    const hotelPropertyRows = visibleHotelProperties.map(property => {
      const listing = findListing(property.listingId) || {};
      return [property.propertyName || listing.title || 'Hotel property', property.propertyType || property.category || 'Hotel', listing.title || property.listingId || '-', [property.city, property.country].filter(Boolean).join(', ') || '-', `${property.checkInTime || '-'} / ${property.checkOutTime || '-'}`, Array.isArray(property.amenities) && property.amenities.length ? property.amenities.join(', ') : '-', property.status || 'active', dashboardMeta('hotel_property', property.id, property.propertyName || listing.title, property.status || 'active', {
        property,
        listing: listingDetail(listing),
        company: companyDetail(company)
      }, ['view', 'edit', 'rooms', 'manifest'])];
    });
    const roomTypeRows = visibleRoomTypes.map(roomType => {
      const listing = findListing(roomType.listingId) || {};
      const units = visibleRoomUnits.filter(unit => String(unit.roomTypeId) === String(roomType.id) && unit.status !== 'archived');
      const occupancy = `${Number(roomType.maxAdults || roomType.capacity || 1)}A / ${Number(roomType.maxChildren || 0)}C / ${Number(roomType.maxInfants || 0)}I`;
      return [roomType.name || 'Room type', propertyById(roomType.propertyId).propertyName || listing.title || '-', occupancy, roomType.bedConfiguration?.length ? roomType.bedConfiguration.map(bed => `${bed.quantity || 1} ${bed.type || 'bed'}`).join(', ') : roomType.bedType || '-', formatMoney(roomType.basePrice || listing.priceFrom || 0, roomType.currency || listing.currency || company.settings?.defaultCurrency || platformCurrency()), `${units.length} units`, roomType.status || 'active', dashboardMeta('room_type', roomType.id, roomType.name || 'Room type', roomType.status || 'active', {
        roomType,
        property: propertyById(roomType.propertyId),
        listing: listingDetail(listing),
        units
      }, ['view', 'edit', 'units', 'pricing'])];
    });
    const ratePlanRows = visibleRatePlans.map(plan => {
      const roomType = roomTypeById(plan.roomTypeId);
      const property = propertyById(plan.propertyId);
      return [plan.name || plan.code || 'Rate plan', roomType.name || 'Room type', property.propertyName || '-', plan.mealPlan || 'room_only', plan.refundable ? `Refundable · ${Number(plan.cancellationDeadlineHours || 0)}h` : 'Non-refundable', formatMoney(plan.basePrice || roomType.basePrice || 0, plan.currency || company.settings?.defaultCurrency || platformCurrency()), `${Number(plan.minStay || 1)}–${Number(plan.maxStay || 90)} nights`, plan.status || 'active', dashboardMeta('rate_plan', plan.id, plan.name || plan.code, plan.status || 'active', { ratePlan: plan, roomType, property }, ['view', 'edit', 'pricing'])];
    });
    const roomUnitRows = visibleRoomUnits.map(unit => {
      const roomType = roomTypeById(unit.roomTypeId);
      const listing = findListing(unit.listingId) || {};
      return [unit.unitNumber || unit.id, roomType.name || 'Room type', propertyById(unit.propertyId).propertyName || listing.title || '-', [unit.floor && `Floor ${unit.floor}`, unit.wing].filter(Boolean).join(' / ') || '-', unit.view || '-', unit.housekeepingStatus || 'clean', unit.status || 'available', dashboardMeta('room_unit', unit.id, unit.unitNumber || unit.id, unit.status || 'available', {
        roomUnit: unit,
        roomType,
        property: propertyById(unit.propertyId),
        listing: listingDetail(listing)
      }, ['view', 'edit', 'maintenance', 'housekeeping'])];
    });
    const normalizedHousekeepingRows = visibleHousekeepingTasks.map(task => {
      const unit = roomUnitById(task.roomUnitId);
      const roomType = roomTypeById(unit.roomTypeId);
      const property = propertyById(task.propertyId || unit.propertyId);
      return [unit.unitNumber || task.roomUnitId, roomType.name || 'Room type', property.propertyName || '-', task.taskType || 'manual', task.priority || 'normal', task.assignedTo || 'Unassigned', task.dueAt ? dateValue(task.dueAt) : 'Not scheduled', task.status || 'open', dashboardMeta('housekeeping', task.id, unit.unitNumber || task.roomUnitId, task.status || 'open', { task, roomUnit: unit, roomType, property }, ['view', 'housekeeping', 'edit'])];
    });
    const legacyHousekeepingRows = visibleRoomUnits.filter(unit => ['dirty', 'cleaning', 'maintenance', 'occupied', 'inspection', 'inspected'].includes(normalize(unit.housekeepingStatus || unit.status || '')) && !visibleHousekeepingTasks.some(task => String(task.roomUnitId) === String(unit.id) && !['completed', 'cancelled'].includes(normalize(task.status)))).map(unit => {
      const roomType = roomTypeById(unit.roomTypeId);
      const listing = findListing(unit.listingId) || {};
      const property = propertyById(unit.propertyId);
      const activeNight = visibleRoomNightInventories.filter(night => String(night.roomUnitId) === String(unit.id)).sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).find(night => ['cleaning', 'maintenance', 'occupied', 'checked-out', 'booked'].includes(normalize(night.status))) || {};
      const priority = unit.housekeepingPriority || (normalize(unit.housekeepingStatus) === 'maintenance' ? 'high' : normalize(unit.housekeepingStatus) === 'dirty' ? 'normal' : 'low');
      const taskStatus = unit.housekeepingTaskStatus || (['clean', 'inspected'].includes(normalize(unit.housekeepingStatus)) ? 'completed' : 'open');
      return [unit.unitNumber || unit.id, roomType.name || 'Room type', property.propertyName || listing.title || '-', 'legacy/manual', priority, unit.housekeepingAssignedTo || 'Unassigned', unit.housekeepingDueAt ? dateValue(unit.housekeepingDueAt) : activeNight.date || 'Today', taskStatus, dashboardMeta('housekeeping', unit.id, unit.unitNumber || unit.id, taskStatus, { roomUnit: unit, roomType, property, roomNight: activeNight }, ['view', 'housekeeping', 'edit'])];
    });
    const hotelHousekeepingTasks = [...normalizedHousekeepingRows, ...legacyHousekeepingRows];
    const roomNightInventoryRows = visibleRoomNightInventories.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.roomUnitId || '').localeCompare(String(b.roomUnitId || ''))).map(night => {
      const unit = roomUnitById(night.roomUnitId);
      const roomType = roomTypeById(night.roomTypeId);
      const ratePlan = ratePlanById(night.ratePlanId);
      const listing = findListing(night.listingId) || {};
      const booking = night.bookingRef ? findBooking(night.bookingRef) : null;
      return [night.date || '-', unit.unitNumber || night.roomUnitId || '-', roomType.name || 'Room type', ratePlan.name || ratePlan.code || 'Default', night.status || 'available', night.bookingRef || '-', night.guestName || bookingCustomer(booking || {}) || '-', formatMoney(night.price || ratePlan.basePrice || roomType.basePrice || listing.priceFrom || 0, ratePlan.currency || listing.currency || company.settings?.defaultCurrency || platformCurrency()), dashboardMeta('room_night', night.id, `${unit.unitNumber || night.roomUnitId || 'Room'} ${night.date || ''}`.trim(), night.status || 'available', {
        roomNight: night,
        roomUnit: unit,
        roomType,
        ratePlan,
        reservation: reservationById(night.reservationId),
        booking: bookingDetail(booking),
        listing: listingDetail(listing)
      }, ['view', 'status', 'booking', 'manifest'])];
    });
    let roomVisualMaps = visibleRoomTypes.map(roomType => {
      const listing = findListing(roomType.listingId) || {};
      const units = visibleRoomUnits.filter(unit => unit.roomTypeId === roomType.id && unit.status !== 'archived');
      const roomsForMap = units.map(unit => {
        const nights = visibleRoomNightInventories.filter(night => night.roomUnitId === unit.id).sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
        const activeNight = nights.find(night => ['held', 'booked', 'occupied', 'checked-in', 'maintenance', 'cleaning', 'cancelled', 'refunded', 'reserved'].includes(normalize(night.status))) || nights[0] || {};
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
          price: activeNight.price || roomType.basePrice || listing.priceFrom || 0
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
          available: roomsForMap.filter(room => normalize(room.status) === 'available').length,
          held: roomsForMap.filter(room => ['held', 'reserved'].includes(normalize(room.status))).length,
          booked: roomsForMap.filter(room => ['booked', 'occupied', 'checked-in'].includes(normalize(room.status))).length,
          maintenance: roomsForMap.filter(room => ['maintenance', 'cleaning'].includes(normalize(room.status))).length
        },
        rooms: roomsForMap
      };
    });
    if (!roomVisualMaps.length && visibleRooms.length) {
      roomVisualMaps = visibleRooms.map(room => {
        const listing = findListing(room.listingId) || {};
        const roomBookings = bookings.filter(booking => booking.listingId === room.listingId && (booking.passengers || []).some(passenger => passenger.seatOrRoom === room.roomType || passenger.roomType === room.roomType));
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
          price: room.nightlyPrice || listing.priceFrom || 0
        }));
        const availableRooms = Array.from({
          length: Math.max(0, Number(room.inventory || 0))
        }).map((_, index) => ({
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
          price: room.nightlyPrice || listing.priceFrom || 0
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
            maintenance: room.status === 'active' ? 0 : availableRooms.length
          },
          rooms: roomsForMap
        };
      });
    }
    const bookedSeatGroups = seatMaps.map(map => {
      const bookedOrHeld = (map.seats || []).filter(seat => ['taken', 'booked', 'checked-in', 'checked_in', 'confirmed', 'locked', 'held', 'hold', 'selected', 'reserved'].includes(normalize(seat.status)));
      return {
        scheduleId: map.scheduleId,
        routeLabel: map.routeLabel || map.listingTitle || 'Route',
        vehicleName: map.vehicleName || 'Vehicle',
        travelDate: map.departAt ? dateValue(map.departAt) : 'Schedule date pending',
        status: map.status || 'active',
        totalBooked: bookedOrHeld.filter(seat => ['taken', 'booked', 'checked-in', 'checked_in', 'confirmed'].includes(normalize(seat.status))).length,
        totalHeld: bookedOrHeld.filter(seat => ['locked', 'held', 'hold', 'selected', 'reserved'].includes(normalize(seat.status))).length,
        seats: bookedOrHeld.map(seat => ({
          seatNumber: seat.seatNumber,
          status: seat.status,
          bookingRef: seat.bookingRef || '',
          passengerName: seat.passengerName || '',
          passengerPhone: seat.passengerPhone || '',
          passengerEmail: seat.passengerEmail || '',
          paymentStatus: seat.paymentStatus || '',
          checkInStatus: seat.checkInStatus || ''
        }))
      };
    }).filter(group => group.seats.length);
    const bookedRoomGroups = roomVisualMaps.map(map => {
      const bookedOrHeld = (map.rooms || []).filter(room => ['held', 'hold', 'reserved', 'booked', 'confirmed', 'occupied', 'checked_in', 'in_house'].includes(normalize(room.status)));
      return {
        roomTypeId: map.roomTypeId,
        roomTypeName: map.roomTypeName || 'Room type',
        propertyName: map.propertyName || map.listingTitle || 'Hotel',
        dateRange: bookedOrHeld[0]?.dateRange || 'Date range pending',
        status: map.status || 'active',
        totalBooked: bookedOrHeld.filter(room => ['booked', 'confirmed', 'occupied', 'checked_in', 'in_house'].includes(normalize(room.status))).length,
        totalHeld: bookedOrHeld.filter(room => ['held', 'hold', 'reserved'].includes(normalize(room.status))).length,
        rooms: bookedOrHeld.map(room => ({
          roomUnitId: room.roomUnitId,
          unitNumber: room.unitNumber,
          status: room.status,
          bookingRef: room.bookingRef || '',
          guestName: room.guestName || '',
          guestPhone: room.guestPhone || '',
          guestEmail: room.guestEmail || '',
          checkIn: room.checkIn || '',
          checkOut: room.checkOut || '',
          date: room.date || ''
        }))
      };
    }).filter(group => group.rooms.length);

    // Staff and driver onboarding is a lifecycle, not only an employee table.
    // A staff invite exists before CompanyEmployee is created, and a driver
    // legacy request may exist as a SupportTicket, but Partner Admin owns
    // every employee and driver lifecycle after the company is approved. Merge all stages so a saved request appears immediately and
    // operators can see exactly what still blocks assignment/publication.
    const userIndex = new Map((state.users || []).map(user => [String(user.id || user._id || ''), user]));
    const branchIndex = new Map(companyBranches.map(branch => [String(branch.id || ''), branch]));
    const invitationIndex = new Map(companyInvitations.map(invitation => [String(invitation.id || ''), invitation]));
    const driverRequestTickets = supportTickets.filter(ticket => normalize(ticket.category) === 'driver_invitation_request');
    const driverRequestByInvitationId = new Map(driverRequestTickets
      .filter(ticket => ticket.metadata?.invitationId)
      .map(ticket => [String(ticket.metadata.invitationId), ticket]));

    const isDriverEmployee = employee => {
      const account = userIndex.get(String(employee.userId || '')) || {};
      const categories = Array.isArray(employee.serviceCategories) ? employee.serviceCategories.map(normalize) : [];
      return normalize(account.role) === 'driver'
        || /driver/i.test(String(employee.roleTitle || ''))
        || categories.includes('driver');
    };
    const employeeForInvitation = invitation => {
      const linkedEmployeeId = String(invitation.meta?.driverEmployeeId || invitation.metadata?.driverEmployeeId || invitation.driverEmployeeId || '');
      if (linkedEmployeeId) {
        const linked = companyEmployees.find(employee => String(employee.id || '') === linkedEmployeeId);
        if (linked) return linked;
      }
      const invitationId = String(invitation.id || '');
      if (invitationId) {
        const linked = companyEmployees.find(employee => String(employee.invitationId || '') === invitationId);
        if (linked) return linked;
      }
      const acceptedUserId = String(invitation.acceptedBy || invitation.userId || '');
      if (acceptedUserId) {
        const direct = companyEmployees.find(employee => String(employee.userId || '') === acceptedUserId);
        if (direct) return direct;
      }
      const email = normalize(invitation.email);
      if (!email) return null;
      const directEmail = companyEmployees.find(employee => normalize(employee.email) === email && isDriverEmployee(employee));
      if (directEmail) return directEmail;
      const user = (state.users || []).find(account => normalize(account.email) === email);
      return user ? companyEmployees.find(employee => String(employee.userId || '') === String(user.id || user._id || '')) || null : null;
    };
    const safeEmployeeUser = user => ({
      id: String(user?.id || user?._id || ''),
      fullName: user?.fullName || '',
      email: user?.email || '',
      phone: user?.phone || '',
      role: user?.role || '',
      status: user?.status || '',
      verificationStatus: user?.verificationStatus || '',
      onboardingStatus: user?.onboardingStatus || '',
      emailVerifiedAt: user?.emailVerifiedAt || '',
      phoneVerifiedAt: user?.phoneVerifiedAt || '',
      lastLoginAt: user?.lastLoginAt || '',
      companyId: user?.companyId || '',
    });
    const branchLabel = value => {
      const branch = branchIndex.get(String(value || ''));
      return branch ? `${branch.name || branch.id}${branch.city ? ` - ${branch.city}` : ''}` : value || 'Not assigned';
    };
    const invitationStatusLabel = invitation => {
      const status = normalize(invitation.status);
      if (status === 'sent') return 'Invitation sent · awaiting acceptance';
      if (status === 'requested') return 'Partner Admin action required';
      if (status === 'accepted') return invitation.type === 'driver' ? 'Accepted · verification pending' : 'Accepted · onboarding pending';
      if (status === 'expired') return 'Invitation expired';
      if (status === 'rejected') return 'Invitation rejected';
      if (status === 'revoked') return 'Invitation revoked';
      return status || 'Invitation pending';
    };
    const driverEmployeeStatus = (employee, user, review) => {
      const assignment = evaluateDriverAssignment(employee, user);
      const eligibility = evaluateDriverEligibility(employee, user);
      if (!assignment.assignable) {
        const lifecycle = [employee.status || 'pending', user.status || 'account setup pending', review?.status || employee.safetyStatus || 'verification pending'].filter(Boolean).join(' · ');
        return `Pending · ${lifecycle} · ${assignment.reasons.join('; ') || 'Partner Admin action required'}`;
      }
      if (eligibility.eligible) return eligibility.approvalSource === 'partner_admin' ? 'Assignable · Partner Admin approved · operational' : 'Assignable · platform verified · operational';
      const lifecycle = [employee.status || 'unknown membership', user.status || 'no linked account', review?.status || employee.safetyStatus || user.verificationStatus || 'not verified'].filter(Boolean).join(' · ');
      return `Assignable · ${lifecycle} · operational warning: ${eligibility.reasons.join('; ') || 'verification pending'}`;
    };
    const driverRequestStatus = ticket => {
      const status = normalize(ticket.status);
      if (status === 'pending_super_admin_approval') return 'Legacy request · Partner Admin action required';
      if (status === 'resolved' && ticket.metadata?.invitationId) return 'Approved · invitation sent';
      if (status === 'closed') return ticket.metadata?.approvalStatus === 'rejected' ? 'Request rejected' : 'Request closed';
      return status || 'Request submitted';
    };

    const driverEligibilityRows = serviceProfile.supportsBusOperations ? companyEmployees
      .filter(isDriverEmployee)
      .map((employee) => {
        const account = userIndex.get(String(employee.userId || '')) || {};
        return {
          employee,
          account,
          assignment: evaluateDriverAssignment(employee, account),
          eligibility: evaluateDriverEligibility(employee, account),
        };
      }) : [];
    const assignableDriverEmployees = driverEligibilityRows.filter((row) => row.assignment.assignable).map((row) => row.employee);
    const activeDriverEmployees = driverEligibilityRows.filter((row) => normalize(row.employee.status) === 'active').map((row) => row.employee);
    const activeStaffEmployees = companyEmployees.filter(employee => !isDriverEmployee(employee) && normalize(employee.status) === 'active');

    const staffEmployeeRows = companyEmployees.filter(employee => !isDriverEmployee(employee)).map(employee => {
      const user = userIndex.get(String(employee.userId || '')) || {};
      return [user.fullName || user.email || employee.userId, employee.roleTitle || 'Staff', branchLabel(employee.branchId || employee.branch), (employee.permissions || []).join(', ') || 'No permissions assigned', user.lastLoginAt ? dateValue(user.lastLoginAt) : employee.acceptedAt ? `Accepted ${dateValue(employee.acceptedAt)}` : 'Invited', employee.status || user.status || 'active', {
        entity: 'employee', id: employee.id, label: user.fullName || user.email || employee.userId, status: employee.status || user.status || 'active',
        detail: { staff: employee, user: safeEmployeeUser(user), company: companyDetail(company) }
      }];
    });
    const staffInvitationRows = companyInvitations.filter(invitation => normalize(invitation.type) === 'staff' && !employeeForInvitation(invitation)).map(invitation => [
      invitation.fullName || invitation.email,
      invitation.roleTitle || 'Staff member',
      branchLabel(invitation.branchId),
      (invitation.permissions || []).join(', ') || 'Permissions pending',
      invitation.sentAt ? `Sent ${dateValue(invitation.sentAt)}` : `Created ${dateValue(invitation.createdAt)}`,
      invitationStatusLabel(invitation),
      {
        entity: 'staff_invitation', id: invitation.id, label: invitation.fullName || invitation.email, status: invitation.status,
        detail: { invitation, company: companyDetail(company), nextStep: normalize(invitation.status) === 'sent' ? 'The staff member must accept the signed invitation.' : 'Review the invitation status.' }
      }
    ]);
    const staffLifecycleRows = [...staffEmployeeRows, ...staffInvitationRows];

    const driverEmployeeRows = (serviceProfile.supportsBusOperations ? companyEmployees.filter(isDriverEmployee) : []).map(employee => {
      const user = userIndex.get(String(employee.userId || '')) || {};
      const review = companyVerificationReviews.find(item => normalize(item.targetType) === 'driver' && String(item.targetId || '') === String(employee.id || '')) || {};
      const invitation = companyInvitations.find(item => normalize(item.type) === 'driver' && (
        String(item.id || '') === String(employee.invitationId || '')
        || String(item.meta?.driverEmployeeId || item.metadata?.driverEmployeeId || item.driverEmployeeId || '') === String(employee.id || '')
        || (employee.userId && String(item.acceptedBy || item.userId || '') === String(employee.userId))
      )) || {};
      const vehicle = visibleVehicles.find(item => String(item.id || '') === String(employee.assignedFleetId || employee.pendingVehicleId || '')) || {};
      const eligibility = evaluateDriverEligibility(employee, user);
      const partnerActivation = evaluatePartnerDriverActivation(employee, user);
      return [
        user.fullName || employee.fullName || user.email || employee.email || employee.phone || employee.userId || employee.id,
        employee.licenseNumber || invitation.licenseNumber || '-',
        normalize(employee.safetyStatus) === 'cleared' ? 'Cleared' : review.status || employee.safetyStatus || 'Pending review',
        (employee.permissions || []).join(', ') || 'Driver permissions pending',
        vehicle.name || branchLabel(employee.branchId || employee.branch) || '-',
        driverEmployeeStatus(employee, user, review),
        {
          entity: 'driver', id: employee.id, label: user.fullName || employee.fullName || user.email || employee.email || employee.id, status: employee.status || user.status || 'pending_verification',
          detail: { driver: employee, user: safeEmployeeUser(user), invitation, verification: review, vehicle, company: companyDetail(company), driverEligibility: eligibility, partnerActivation }
        }
      ];
    });
    const driverInvitationRows = (serviceProfile.supportsBusOperations ? companyInvitations : []).filter(invitation => normalize(invitation.type) === 'driver' && !employeeForInvitation(invitation)).map(invitation => {
      const ticket = driverRequestByInvitationId.get(String(invitation.id || '')) || driverRequestTickets.find(item => String(item.id || '') === String(invitation.meta?.requestTicketId || invitation.metadata?.requestTicketId || '')) || {};
      const vehicle = visibleVehicles.find(item => String(item.id || '') === String(invitation.vehicleId || invitation.meta?.requestedVehicleId || invitation.metadata?.requestedVehicleId || '')) || {};
      const schedule = visibleSchedules.find(item => String(item.id || '') === String(invitation.scheduleId || invitation.meta?.requestedScheduleId || invitation.metadata?.requestedScheduleId || '')) || {};
      return [
        invitation.fullName || invitation.email,
        invitation.licenseNumber || ticket.requestedDriver?.licenseNumber || '-',
        normalize(invitation.status) === 'accepted' ? 'Verification pending' : 'Not started',
        (invitation.permissions || []).join(', ') || 'Driver permissions',
        vehicle.name || (schedule.id ? `Departure ${schedule.id}` : branchLabel(invitation.branchId)),
        invitationStatusLabel(invitation),
        {
          entity: 'driver_invitation', id: invitation.id, label: invitation.fullName || invitation.email, status: invitation.status,
          detail: { invitation, request: ticket, vehicle, schedule, company: companyDetail(company), nextStep: normalize(invitation.status) === 'sent' ? 'The driver must accept the invitation and submit licence, identity, phone, and safety information.' : 'Continue the driver verification workflow.' }
        }
      ];
    });
    const invitationTicketIds = new Set((serviceProfile.supportsBusOperations ? companyInvitations : []).map(invitation => String(invitation.meta?.requestTicketId || invitation.metadata?.requestTicketId || '')).filter(Boolean));
    const invitationEmails = new Set((serviceProfile.supportsBusOperations ? companyInvitations : []).map(invitation => normalize(invitation.email)).filter(Boolean));
    const driverRequestRows = (serviceProfile.supportsBusOperations ? driverRequestTickets : []).filter(ticket => {
      if (invitationTicketIds.has(String(ticket.id || ''))) return false;
      if (ticket.metadata?.invitationId && invitationIndex.has(String(ticket.metadata.invitationId))) return false;
      const email = normalize(ticket.requestedDriver?.email || ticket.metadata?.requestedDriver?.email);
      return !email || !invitationEmails.has(email);
    }).map(ticket => {
      const requested = ticket.requestedDriver || ticket.metadata?.requestedDriver || {};
      const vehicle = visibleVehicles.find(item => String(item.id || '') === String(requested.vehicleId || '')) || {};
      const schedule = visibleSchedules.find(item => String(item.id || '') === String(requested.scheduleId || '')) || {};
      return [
        requested.fullName || requested.email || ticket.subject,
        requested.licenseNumber || '-',
        'Not started',
        'Partner Admin managed invitation',
        vehicle.name || (schedule.id ? `Departure ${schedule.id}` : 'Assignment pending'),
        driverRequestStatus(ticket),
        {
          entity: 'driver_request', id: ticket.id, label: requested.fullName || requested.email || ticket.id, status: ticket.status,
          detail: { request: ticket, requestedDriver: requested, vehicle, schedule, company: companyDetail(company), nextStep: 'Partner Admin manages this driver. Open the driver record to set status, permissions, and assignment.' }
        }
      ];
    });
    const driverLifecycleRows = [...driverEmployeeRows, ...driverInvitationRows, ...driverRequestRows];
    const provisionalDriverOptions = [
      ...(serviceProfile.supportsBusOperations ? companyInvitations : [])
        .filter((invitation) => normalize(invitation.type) === 'driver' && !employeeForInvitation(invitation) && !['rejected', 'revoked', 'expired'].includes(normalize(invitation.status)))
        .map((invitation) => ({
          id: `invitation:${invitation.id}`,
          value: `invitation:${invitation.id}`,
          label: `${invitation.fullName || invitation.email || 'Driver'} [${invitationStatusLabel(invitation)}]`,
          status: invitation.status,
          operational: false,
          warnings: ['Driver account or membership is not complete yet'],
        })),
      ...(serviceProfile.supportsBusOperations ? driverRequestTickets : [])
        .filter((ticket) => {
          const employeeId = String(ticket.metadata?.driverEmployeeId || '');
          if (employeeId && companyEmployees.some((employee) => String(employee.id || '') === employeeId)) return false;
          const linkedInvitationId = String(ticket.metadata?.invitationId || '');
          if (linkedInvitationId && companyInvitations.some((invitation) => String(invitation.id || '') === linkedInvitationId && !employeeForInvitation(invitation))) return false;
          return !['closed'].includes(normalize(ticket.status));
        })
        .map((ticket) => {
          const requested = ticket.requestedDriver || ticket.metadata?.requestedDriver || {};
          return {
            id: `request:${ticket.id}`,
            value: `request:${ticket.id}`,
            label: `${requested.fullName || requested.email || ticket.subject || 'Driver request'} [${driverRequestStatus(ticket)}]`,
            status: ticket.status,
            operational: false,
            warnings: ['Driver account setup or verification is still pending'],
          };
        }),
    ];
    const driverSelectorOptions = assignableDriverEmployees.map(driverOption)
      .filter((option, index, options) => options.findIndex((item) => item.value === option.value) === index);
    const pendingStaffCount = companyInvitations.filter(invitation => normalize(invitation.type) === 'staff' && ['sent', 'requested'].includes(normalize(invitation.status)) && !employeeForInvitation(invitation)).length;
    const driverStageIsPending = value => /awaiting|pending|sent|accepted|under review|approved|documents required|onboarding|not started/i.test(String(value || ''));
    const pendingDriverCount = driverLifecycleRows.filter(row => driverStageIsPending(row[5])).length;

    const routeByIdForFares = new Map(visibleRoutes.map((route) => [String(route.id || ''), route]));
    const stopByIdForFares = new Map(visibleRouteStops.map((stop) => [String(stop.id || ''), stop]));
    const productByIdForFares = new Map(fareProducts.map((fare) => [String(fare.id || ''), fare]));
    const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const scheduleRuleRows = visibleScheduleRules.filter((rule) => normalize(rule.status) !== 'cancelled').map((rule) => {
      const route = routeByIdForFares.get(String(rule.routeId || '')) || {};
      const vehicle = visibleVehicles.find((item) => String(item.id || '') === String(rule.vehicleId || '')) || {};
      const fareProduct = fareProducts.find((item) => String(item.id || '') === String(rule.fareProductId || '')) || {};
      const employeeId = (Array.isArray(rule.driverIds) ? rule.driverIds : String(rule.driverIds || '').split(',')).map((value) => String(value || '').trim()).filter(Boolean)[0] || '';
      const employee = companyEmployees.find((item) => [item.id, item.userId].map(String).includes(String(employeeId))) || {};
      const driverUser = userIndex.get(String(employee.userId || '')) || {};
      const repeat = Array.isArray(rule.daysOfWeek) && rule.daysOfWeek.length
        ? rule.daysOfWeek.map((day) => weekdayLabels[Number(day)] || String(day)).join(', ')
        : 'Every day';
      const label = `${formatRouteLabel(route.origin, route.destination, route.routeName) || 'Route'} at ${rule.departureTime || '--:--'}`;
      return [
        label,
        repeat,
        `${String(rule.startDate || '').slice(0, 10)}${rule.endDate ? ` → ${String(rule.endDate).slice(0, 10)}` : ' onward'}`,
        vehicle.name || rule.vehicleId || 'Vehicle pending',
        fareProduct.name || fareProduct.fareClass || 'Fare plan',
        driverUser.fullName || employee.fullName || 'Optional / unassigned',
        rule.status || 'draft',
        {
          entity: 'schedule_rule', id: rule.id, label, status: rule.status,
          detail: { scheduleRule: rule, route, vehicle, fareProduct, driver: employee, user: safeEmployeeUser(driverUser), listing: listingDetail(findListing(rule.listingId) || {}), company: companyDetail(company), purpose: 'Recurring rules create future dated departures. Editing the rule changes future materialization; already-created departures remain independent and editable.' }
        }
      ];
    });

    const fareProductRows = fareProducts.filter((fare) => normalize(fare.status) !== 'archived').map((fare) => {
      const route = routeByIdForFares.get(String(fare.routeId || '')) || {};
      const fares = segmentFares.filter((row) => String(row.fareProductId || '') === String(fare.id || '') && normalize(row.status) === 'active');
      const fullFare = fares.find((row) => String(row.fromStopId || '') === String(route.originStopId || '') && String(row.toStopId || '') === String(route.destinationStopId || ''))
        || fares.slice().sort((a, b) => (Number(b.toOrder || 0) - Number(b.fromOrder || 0)) - (Number(a.toOrder || 0) - Number(a.fromOrder || 0)))[0]
        || {};
      const routeLabel = formatRouteLabel(route.origin, route.destination, route.routeName) || 'Route not available';
      return [
        fare.name || fare.fareClass || 'Fare plan',
        routeLabel,
        fare.fareClass || 'standard',
        Number(fullFare.amount || 0) > 0 ? formatMoney(fullFare.amount, fare.currency || companyCurrency) : 'Stop-to-stop price required',
        `${fares.length} stop price${fares.length === 1 ? '' : 's'}`,
        fare.status || 'draft',
        {
          entity: 'fare_product', id: fare.id, label: fare.name || fare.id, status: fare.status,
          detail: { fareProduct: fare, route, segmentFares: fares, purpose: 'A fare plan defines the commercial class, currency, baggage and refund/change rules used by departures. Stop-to-stop prices define the actual amount between any two ordered stops.' }
        }
      ];
    });
    const segmentFareRows = segmentFares.filter((fare) => normalize(fare.status) !== 'archived').map((fare) => {
      const product = productByIdForFares.get(String(fare.fareProductId || '')) || {};
      const route = routeByIdForFares.get(String(fare.routeId || product.routeId || '')) || {};
      const fromStop = stopByIdForFares.get(String(fare.fromStopId || '')) || {};
      const toStop = stopByIdForFares.get(String(fare.toStopId || '')) || {};
      return [
        product.name || product.fareClass || 'Fare plan',
        formatRouteLabel(fromStop.name || route.origin || 'Origin', toStop.name || route.destination || 'Destination'),
        formatRouteLabel(route.origin, route.destination, route.routeName) || '-',
        formatMoney(fare.amount || 0, fare.currency || product.currency || companyCurrency),
        `${fare.fromOrder ?? '-'} ⇄ ${fare.toOrder ?? '-'}`,
        fare.status || 'active',
        {
          entity: 'segment_fare', id: fare.id, label: formatRouteLabel(fromStop.name || 'Origin', toStop.name || 'Destination'), status: fare.status,
          detail: { segmentFare: fare, fareProduct: product, route, fromStop, toStop, purpose: 'This is the price charged when a passenger boards at the selected first stop and leaves at the selected later stop.' }
        }
      ];
    });

    const listingByIdForAddons = new Map(listings.map((listing) => [String(listing.id || ''), listing]));
    const serviceAddonRows = serviceAddons.filter((addon) => normalize(addon.status) !== 'archived').map((addon) => {
      const listing = listingByIdForAddons.get(String(addon.listingId || '')) || {};
      const serviceType = normalize(addon.serviceType || listing.serviceType || 'bus');
      const addonBasisLabels = serviceType === 'hotel' ? {
        per_booking: 'Per stay',
        per_passenger: 'Per guest',
        per_trip_leg: 'Per room / night',
        per_passenger_per_leg: 'Per guest / night',
      } : {
        per_booking: 'Per booking',
        per_passenger: 'Per traveler',
        per_trip_leg: 'Per trip leg',
        per_passenger_per_leg: 'Per traveler / leg',
      };
      const availabilityLabel = serviceType === 'hotel' ? 'All stays' : addon.availableFor === 'round_trip' ? 'Return only' : addon.availableFor === 'one_way' ? 'One-way only' : 'All trips';
      return [
        addon.name || 'Optional extra',
        listing.title || listing.routeLabel || (serviceType === 'hotel' ? 'Hotel listing' : 'Bus listing'),
        addon.category || 'other',
        formatMoney(addon.price || 0, addon.currency || listing.currency || companyCurrency),
        addonBasisLabels[addon.chargeBasis] || (serviceType === 'hotel' ? 'Per stay' : 'Per booking'),
        availabilityLabel,
        addon.status || 'active',
        {
          entity: 'service_addon', id: addon.id, label: addon.name || addon.id, status: addon.status,
          detail: { serviceAddon: addon, listing, purpose: serviceType === 'hotel' ? 'Optional hotel extras are selected during preview and repriced securely on the server by stay, guest, room-night, or guest-night.' : 'Optional extras are selected by travelers during preview and are repriced securely on the server for one-way or return bookings.' }
        }
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
        legalName: company.legalName || company.name || '',
        registrationNumber: company.registrationNumber || '',
        taxNumber: company.taxNumber || '',
        headOfficeAddress: company.headOfficeAddress || '',
        website: company.website || '',
        description: company.description || '',
        verificationStatus: company.verificationStatus || 'pending',
        ownerEmail: ownerUser.email || '',
        ownerPhone: ownerUser.phone || '',
        ownerEmailVerifiedAt: ownerUser.emailVerifiedAt || '',
        ownerPhoneVerifiedAt: ownerUser.phoneVerifiedAt || '',
        supportEmail: company.supportContacts?.email || '',
        supportPhone: company.supportContacts?.phone || '',
        supportWhatsapp: company.supportContacts?.whatsapp || '',
        payoutAccount: company.payoutAccount || company.settings?.payoutAccount || '',
        defaultCurrency: companyCurrency,
        supportMessage: company.settings?.supportMessage || '',
        ratingAverage: Number(company.ratingAverage || 0),
        reviewCount: Number(company.reviewCount || reviews.length),
        canPublish: company.settings?.canPublish !== false,
        profileIncomplete: Boolean(company.settings?.profileIncomplete || !company.city),
        missingProfileFields: Array.isArray(company.settings?.missingProfileFields) ? company.settings.missingProfileFields : (!company.city ? ['city'] : []),
        logo: company.logo || null,
        coverImage: company.coverImage || null,
        documents: Array.isArray(company.documents) ? company.documents : [],
        reviewedBy: company.reviewedBy || '',
        reviewedAt: company.reviewedAt || '',
        reviewNotes: company.reviewNotes || ''
      },
      stats: {
        earnings: formatMoney(companyEarnings, companyCurrency),
        grossRevenue: formatMoney(grossRevenue, companyCurrency),
        averageOrderValue: formatMoney(financialBookings.length ? grossRevenue / financialBookings.length : 0, companyCurrency),
        confirmedBookings: financialBookings.length.toLocaleString(),
        activeListings: activeListings.length.toLocaleString(),
        seatsOnHold: heldSeats.toLocaleString(),
        upcomingTrips: activeSchedules.length.toLocaleString(),
        openSupportCases: supportTickets.filter(ticket => !['closed', 'resolved'].includes(normalize(ticket.status))).length.toLocaleString(),
        fillRate: `${fillRate}%`,
        rating: `${Number(company.ratingAverage || 0).toFixed(1)}/5`,
        routeCount: visibleRoutes.length.toLocaleString(),
        vehicleCount: visibleVehicles.filter(vehicle => vehicle.status !== 'archived').length.toLocaleString(),
        roomTypes: (visibleRoomTypes.length || visibleRooms.length).toLocaleString(),
        blockedSeats: blockedSeats.toLocaleString(),
        checkedIn: checkedInBookings.length.toLocaleString(),
        upcomingFlights: flightDepartures.filter(row => ['published','scheduled','check_in_open','boarding'].includes(normalize(row.publicationStatus || row.operationalStatus))).length.toLocaleString(),
        availableFlightSeats: flightSeatInventories.filter(row => normalize(row.status) === 'available').length.toLocaleString(),
        activeTaxiDrivers: driverAvailabilities.filter(row => ['available','offered','assigned','on_trip'].includes(normalize(row.status))).length.toLocaleString(),
        pendingTaxiDispatch: taxiRides.filter(row => ['scheduled','dispatch_pending','offering'].includes(normalize(row.status))).length.toLocaleString()
      },
      serviceProfile,
      options: {
        listings: listings.map(listingOption),
        busListings: listings.filter(listing => listing.serviceType === 'bus').map(listingOption),
        hotelListings: listings.filter(listing => listing.serviceType === 'hotel').map(listingOption),
        transportListings: listings.filter(listing => ROUTED_SERVICE_TYPES.includes(listing.serviceType)).map(listingOption),
        routes: visibleRoutes.filter(route => route.status !== 'archived').map(routeOption),
        routeStops: visibleRouteStops.filter(stop => stop.status !== 'archived').map(routeStopOption),
        fareProducts: fareProducts.filter(fare => fare.status !== 'archived').map(fareProductOption),
        serviceAddons: serviceAddons.filter(addon => addon.status !== 'archived'),
        vehicles: visibleVehicles.filter(vehicle => vehicle.status !== 'archived').map(vehicleOption),
        vehicleSeats: visibleVehicles.filter(vehicle => vehicle.status !== 'archived').flatMap(vehicle => {
          const activeVersion = seatMapVersions.find(version => version.id === vehicle.activeSeatMapVersionId)
            || seatMapVersions.filter(version => version.vehicleId === vehicle.id && version.status === 'published').sort((a, b) => Number(b.version || 0) - Number(a.version || 0))[0]
            || {};
          const versionSeats = Array.isArray(activeVersion.seats) && activeVersion.seats.length
            ? activeVersion.seats
            : Array.isArray(vehicle.seatTemplate) ? vehicle.seatTemplate : [];
          return versionSeats.map(seat => ({
            id: `${vehicle.id}:${seat.seatNumber || seat.label || seat.id}`,
            value: seat.seatNumber || seat.label || seat.id,
            label: `Seat ${seat.seatNumber || seat.label || seat.id}${seat.seatClass ? ` - ${seat.seatClass}` : ''}`,
            listingId: vehicle.listingId,
            vehicleId: vehicle.id,
            seatMapVersionId: activeVersion.id || vehicle.activeSeatMapVersionId || '',
            seatClass: seat.seatClass || '',
            seatType: seat.seatType || '',
            status: seat.enabled === false || seat.isDisabled ? 'disabled' : seat.status || 'available'
          }));
        }),
        hotelProperties: visibleHotelProperties.filter(property => property.status !== 'archived').map(property => ({
          id: property.id,
          value: property.id,
          label: property.propertyName || property.id,
          listingId: property.listingId,
          status: property.status
        })),
        roomTypes: visibleRoomTypes.filter(roomType => roomType.status !== 'archived').map(roomType => ({
          id: roomType.id,
          value: roomType.id,
          label: roomType.name || roomType.id,
          listingId: roomType.listingId,
          propertyId: roomType.propertyId,
          status: roomType.status
        })),
        ratePlans: visibleRatePlans.filter(plan => plan.status !== 'archived').map(plan => ({
          id: plan.id,
          value: plan.id,
          label: `${plan.name || plan.code || plan.id} - ${roomTypeById(plan.roomTypeId).name || 'Room type'}`,
          listingId: plan.listingId,
          propertyId: plan.propertyId,
          roomTypeId: plan.roomTypeId,
          currency: plan.currency,
          basePrice: plan.basePrice,
          mealPlan: plan.mealPlan,
          refundable: plan.refundable,
          status: plan.status
        })),
        roomUnits: visibleRoomUnits.filter(unit => unit.status !== 'archived').map(unit => ({
          id: unit.id,
          value: unit.id,
          label: unit.unitNumber || unit.id,
          listingId: unit.listingId,
          roomTypeId: unit.roomTypeId,
          propertyId: unit.propertyId,
          status: unit.status
        })),
        roomNights: visibleRoomNightInventories.filter(night => !['cancelled', 'refunded'].includes(normalize(night.status))).map(night => {
          const unit = visibleRoomUnits.find(item => item.id === night.roomUnitId) || {};
          return {
            id: night.id,
            value: night.id,
            label: `${unit.unitNumber || night.roomUnitId || 'Room'} - ${String(night.date || '').slice(0, 10)} (${night.status || 'available'})`,
            listingId: night.listingId,
            propertyId: night.propertyId,
            roomTypeId: night.roomTypeId,
            roomUnitId: night.roomUnitId,
            status: night.status
          };
        }),
        flightListings: listings.filter(listing => listing.serviceType === 'flight').map(listingOption),
        taxiListings: listings.filter(listing => listing.serviceType === 'local_transport').map(listingOption),
        airports: airports.map(row => ({ id: row.id, value: row.id, label: `${row.iataCode || row.icaoCode || ''} - ${row.name || row.id}`, iataCode: row.iataCode || '', city: row.city || '', country: row.country || '', timezone: row.timezone || '' })),
        airlines: airlines.map(row => ({ id: row.id, value: row.id, label: `${row.iataCode || row.icaoCode || ''} - ${row.name || row.id}`, status: row.status })),
        flightSuppliers: flightSuppliers.map(row => ({ id: row.id, value: row.id, label: row.name || row.code || row.id, mode: row.mode, status: row.status })),
        aircraftTypes: aircraftTypes.map(row => ({ id: row.id, value: row.id, label: `${row.manufacturer || ''} ${row.model || row.name || row.id}`.trim(), seatCapacity: row.seatCapacity || row.maxSeats || 0 })),
        aircraft: aircraft.map(row => ({ id: row.id, value: row.id, label: `${row.registrationNumber || row.tailNumber || row.id} - ${row.name || row.modelName || 'Aircraft'}`, status: row.status, seatMapVersionId: row.activeSeatMapVersionId || '' })),
        flightSeatMaps: flightSeatMapVersions.map(row => ({ id: row.id, value: row.id, label: `${row.name || row.layoutName || 'Seat map'} v${row.version || 1}`, aircraftId: row.aircraftId, status: row.status, totalSeats: row.totalSeats || (row.seats || []).length })),
        flightRoutes: flightRoutes.map(row => ({ id: row.id, value: row.id, label: `${row.routeCode || ''} ${formatRouteLabel(row.originAirportCode || row.originAirportId || '', row.destinationAirportCode || row.destinationAirportId || '')}`.trim(), listingId: row.listingId, status: row.status })),
        flightFareFamilies: flightFareFamilies.map(row => ({ id: row.id, value: row.id, label: `${row.name || row.code || 'Fare'} - ${row.cabinClass || 'economy'}`, routeId: row.routeId, status: row.status })),
        flightDepartures: flightDepartures.map(row => ({ id: row.id, value: row.id, label: `${row.flightNumber || row.id} - ${dateValue(row.departAt)}`, routeId: row.routeId, aircraftId: row.aircraftId, status: row.operationalStatus || row.publicationStatus })),
        flightAncillaries: flightAncillaries.map(row => ({ id: row.id, value: row.id, label: row.name || row.code || row.id, type: row.type, price: row.price, currency: row.currency, status: row.status })),
        vehicleClasses: vehicleClasses.map(row => ({ id: row.id, value: row.id, label: `${row.name || row.code || row.id} (${row.passengerCapacity || 0} passengers)`, status: row.status })),
        taxiVehicles: taxiVehicles.map(row => ({ id: row.id, value: row.id, label: `${row.registrationNumber || row.id} - ${row.make || ''} ${row.model || ''}`.trim(), vehicleClassId: row.vehicleClassId, status: row.operationalStatus || row.verificationStatus })),
        taxiDrivers: taxiDrivers.map(row => ({ id: row.id, value: row.id, label: `${row.driverNumber || row.id} - ${row.verificationStatus || 'pending'}`, vehicleId: row.assignedVehicleId || '', status: row.availabilityStatus || row.verificationStatus })),
        taxiZones: taxiZones.map(row => ({ id: row.id, value: row.id, label: `${row.name || row.code || row.id} - ${row.country || ''}`, status: row.status })),
        taxiFareRules: taxiFareRules.map(row => ({ id: row.id, value: row.id, label: `${row.name || row.serviceType || 'Fare rule'} - ${row.currency || companyCurrency}`, vehicleClassId: row.vehicleClassId, zoneId: row.zoneId, status: row.status })),
        staff: activeStaffEmployees.map(employee => {
          const user = userIndex.get(String(employee.userId || '')) || {};
          return {
            id: employee.id,
            value: employee.userId,
            userId: employee.userId,
            label: `${user.fullName || user.email || employee.id}${employee.roleTitle ? ` - ${employee.roleTitle}` : ''}`,
            branchId: employee.branchId || '',
            status: employee.status
          };
        }),
        schedules: visibleSchedules.filter(schedule => schedule.status !== 'archived').map(scheduleOption),
        rooms: visibleRooms.filter(room => room.status !== 'archived').map(roomOption),
        branches: companyBranches.filter(branch => branch.status !== 'archived').map(branchOption),
        drivers: driverSelectorOptions,
        driverEligibility: driverEligibilityRows.map(({ employee, assignment, eligibility }) => ({
          id: employee.id, value: employee.id, label: assignment.label || eligibility.label,
          eligible: eligibility.eligible,
          assignable: assignment.assignable,
          operational: eligibility.eligible,
          reasons: eligibility.reasons,
          warnings: assignment.warnings,
          operationalReasons: eligibility.reasons,
          status: assignment.assignable ? (eligibility.eligible ? 'assignable_operational' : 'assignable_optional') : 'not_assignable'
        })),
        pendingStaffInvitations: companyInvitations.filter(invitation => normalize(invitation.type) === 'staff' && ['sent', 'requested'].includes(normalize(invitation.status))).map(invitation => ({ id: invitation.id, value: invitation.id, label: `${invitation.fullName || invitation.email} - ${invitationStatusLabel(invitation)}`, status: invitation.status })),
        pendingDriverRequests: driverLifecycleRows.filter(row => driverStageIsPending(row[5])).map(row => ({ id: row[6]?.id || row[0], value: row[6]?.id || row[0], label: `${row[0]} - ${row[5]}`, status: row[5] }))
      },
      recentBookings: bookings.slice(0, 8).map(booking => [booking.bookingRef, bookingTitle(booking), bookingCustomer(booking), booking.passengers?.[0]?.seatOrRoom || 'Selected', booking.bookingStatus, bookingTotal(booking)]),
      fareProducts,
      segmentFares,
      serviceAddons,
      fareProductRows,
      segmentFareRows,
      serviceAddonRows,
      seatMapTemplates,
      seatMapVersions,
      vehicleSeatTemplates,
      seatMaps,
      seatMapDiagnostics: {
        scheduleCount: busSchedules.length,
        renderedMapCount: seatMaps.length,
        persistedInventoryCount: seatMaps.filter((map) => map.inventorySource === 'persisted_inventory').length,
        missingInventoryCount: seatMaps.filter((map) => !map.seats?.length).length,
        templateCount: vehicleSeatTemplates.length,
      },
      roomVisualMaps,
      bookedSeatGroups,
      bookedRoomGroups,
      listings: listings.map((listing) => {
        const isStayListing = listing.serviceType === 'hotel';
        const inventoryLabel = isStayListing
          ? `${roomsForListing(listing.id).length} room types`
          : `${busSchedules.filter((schedule) => String(schedule.listingId || '') === String(listing.id || '')).length} schedules`;
        const routeOrLocation = isStayListing
          ? [listing.city, listing.country].filter(Boolean).join(', ')
          : formatRouteLabel(listing.from, listing.to, listing.routeLabel);
        return [
          listing.title,
          listing.type,
          company?.name || listing.partner || '-',
          inventoryLabel,
          routeOrLocation,
          listing.status,
          formatMoney(listingFareFrom(listing).amount, listingFareFrom(listing).currency),
          {
            entity: 'listing',
            id: listing.id,
            label: listing.title,
            status: listing.status,
            detail: {
              listing,
              company: companyDetail(company)
            }
          }
        ];
      }),
      routes: visibleRoutes.map(route => [formatRouteLabel(route.origin, route.destination, route.routeName), bookingTitle({
        listingId: route.listingId
      }), `${route.boardingPoints?.length || 0} boarding`, `${route.dropoffPoints?.length || 0} dropoffs`, route.corridor || '', route.status, {
        entity: 'route',
        id: route.id,
        label: formatRouteLabel(route.origin, route.destination, route.routeName),
        status: route.status,
        detail: {
          route,
          listing: listingDetail(findListing(route.listingId) || {}),
          company: companyDetail(company)
        }
      }]),
      routeStops: visibleRouteStops.map(stop => {
        const route = visibleRoutes.find(item => item.id === stop.routeId) || {};
        return [formatRouteLabel(route.origin, route.destination, route.routeName) || stop.routeId, stop.name, stop.stopType || 'intermediate', String(stop.stopOrder || 0), String(stop.timeOffsetMinutes || 0), stop.status || 'active', {
          entity: 'routeStop',
          id: stop.id,
          label: stop.name,
          status: stop.status || 'active',
          detail: {
            routeStop: stop,
            route,
            company: companyDetail(company)
          }
        }];
      }),
      scheduleRules: scheduleRuleRows,
      schedules: visibleSchedules.slice(0, 24).map(schedule => {
        const totalSeats = Number(schedule.totalSeats || 0);
        const sold = Math.max(0, totalSeats - Number(schedule.availableSeats || 0) - seatsForSchedule(schedule.id).filter(seat => ['locked', 'blocked'].includes(seat.status)).length);
        const vehicle = visibleVehicles.find(item => item.id === schedule.vehicleId);
        return [schedule.id, bookingTitle({
          listingId: schedule.listingId
        }), scheduleLabel(schedule), vehicle?.name || schedule.vehicleName || 'Vehicle pending', `${sold}/${totalSeats}`, schedule.status, {
          entity: 'schedule',
          id: schedule.id,
          label: schedule.id,
          status: schedule.status,
          detail: {
            schedule,
            route: visibleRoutes.find(item => item.id === schedule.routeId) || {},
            vehicle,
            listing: listingDetail(findListing(schedule.listingId) || {}),
            company: companyDetail(company)
          }
        }];
      }),
      vehicles: visibleVehicles.map(vehicle => [vehicle.name, (vehicle.vehicleClass || '').toLowerCase() === 'vip' || vehicle.defaultSeatClass === 'VIP' ? 'VIP bus' : 'Standard bus', vehicle.plateOrCode || '-', `${vehicle.totalSeats || 0} seats`, vehicle.layoutName || 'Layout pending', vehicle.status, {
        entity: 'vehicle',
        id: vehicle.id,
        label: vehicle.name,
        status: vehicle.status,
        detail: {
          vehicle,
          listing: listingDetail(findListing(vehicle.listingId) || {}),
          company: companyDetail(company)
        }
      }]),
      bookings: bookings.map(booking => [booking.bookingRef, bookingTitle(booking), bookingCustomer(booking), booking.passengers?.[0]?.seatOrRoom || 'Selected', dateValue(booking.createdAt), booking.bookingStatus, bookingTotal(booking)]),
      checkins: bookings.slice(0, 24).map(booking => [booking.bookingRef, bookingCustomer(booking), bookingTitle(booking), booking.passengers?.[0]?.seatOrRoom || 'Selected', booking.checkedInAt ? dateValue(booking.checkedInAt) : 'Pending', booking.bookingStatus === 'checked_in' ? 'Checked in' : booking.bookingStatus, {
        entity: 'checkin',
        id: booking.bookingRef,
        label: booking.bookingRef,
        status: booking.bookingStatus,
        detail: bookingDetail(booking)
      }]),
      inventory: [...seatInventoryRows, ...roomInventoryRows],
      hotelProperties: hotelPropertyRows,
      roomTypes: roomTypeRows,
      ratePlans: ratePlanRows,
      roomUnits: roomUnitRows,
      hotelHousekeepingTasks,
      roomNightInventory: roomNightInventoryRows,
      hotelManifestDate: hotelToday,
      hotelManifestListingId: requestedHotelListingId,
      hotelManifestAll: hotelManifestAllRows,
      hotelArrivals: hotelArrivalRows,
      hotelDepartures: hotelDepartureRows,
      hotelInHouse: hotelInHouseRows,
      hotelManifestHistory: hotelHistoryRows,
      airports,
      aircraftTypes,
      airlines,
      flightSuppliers,
      aircraft,
      flightSeatMapVersions,
      flightRoutes,
      flightFareFamilies,
      flightDepartures,
      flightSeatInventories,
      flightOrders,
      flightTravelers,
      flightTickets,
      flightAncillaries,
      flightScheduleChanges,
      flightAgentQuotes,
      flightChangeRequests,
      flightRefundRequests,
      vehicleClasses,
      taxiVehicles,
      taxiDrivers,
      taxiZones,
      taxiFareRules,
      driverAvailabilities,
      driverLocations,
      taxiRides,
      rideAssignments,
      taxiIncidents,
      driverEarnings,
      mobilityDriverCandidates,
      financeSummary: companyFinance.summary,
      revenueDrilldown: companyFinance.revenueRows,
      settlementBatches: companyFinance.settlementRows,
      settlementLedger: companyFinance.ledgerRows,
      payoutRequests: companyFinance.payoutRows,
      financeStatements: companyFinance.statementRows,
      payouts: companyFinance.revenueRows,
      promotions: state.promotionCampaigns.filter(campaign => campaign.companyId === companyId).map(campaign => [campaign.name, findListing(campaign.listingId)?.title || 'Listing', campaign.placement, formatMoney(campaign.budget), String(campaign.clicks), String(campaign.bookings), campaign.status, {
        entity: 'promotion',
        id: campaign.id,
        label: campaign.name,
        status: campaign.status
      }]),
      ads: state.promotionCampaigns.filter(campaign => campaign.companyId === companyId).map(campaign => [campaign.name, findListing(campaign.listingId)?.title || 'Listing', campaign.placement, formatMoney(campaign.budget), String(campaign.clicks || 0), String(campaign.bookings || 0), campaign.status, { entity: 'promotion', id: campaign.id, label: campaign.name, status: campaign.status }]),
      reviews: reviews.map(review => {
        const booking = state.bookings.find(item => item.id === review.bookingId);
        return [bookingCustomer(booking || {}) || review.customerUserId || 'Customer', bookingTitle({
          listingId: review.listingId
        }), String(review.rating || '-'), review.comment || '', review.companyReply?.message ? `Replied: ${review.companyReply.message}` : dateValue(review.createdAt), review.status, {
          entity: 'review',
          id: review.id,
          label: booking?.bookingRef || review.id,
          status: review.status
        }];
      }),
      branches: companyBranches.map(branch => [branch.name, branch.branchType || 'terminal', [branch.city, branch.country].filter(Boolean).join(', '), (branch.serviceCategories || []).join(', '), branch.operatingHours || '-', branch.status || 'active', {
        entity: 'branch',
        id: branch.id,
        label: branch.name,
        status: branch.status || 'active',
        detail: {
          branch,
          company: companyDetail(company)
        }
      }]),
      policies: companyPolicies.map(policy => [policy.title, policy.policyType || 'operations', policy.serviceCategory || 'all', policy.customerVisible ? 'Customer visible' : 'Internal', policy.summary || '-', policy.status || 'active', {
        entity: 'policy',
        id: policy.id,
        label: policy.title,
        status: policy.status || 'active',
        detail: {
          policy,
          company: companyDetail(company)
        }
      }]),
      staffDriverWorkflow: {
        activeStaff: activeStaffEmployees.length,
        pendingStaff: pendingStaffCount,
        assignableDrivers: driverSelectorOptions.length,
        activeDrivers: activeDriverEmployees.length,
        pendingDrivers: pendingDriverCount,
        staffInvitations: companyInvitations.filter(invitation => normalize(invitation.type) === 'staff').length,
        driverRequests: driverRequestTickets.length,
        canPublishDeparture: true,
      },
      staff: staffLifecycleRows,
      drivers: driverLifecycleRows,
      driverAssignments: (serviceProfile.supportsBusOperations ? driverAssignments : []).map(assignment => {
        const employee = companyEmployees.find(item => item.id === assignment.employeeId) || {};
        const user = state.users.find(item => item.id === employee.userId || item.id === assignment.driverUserId) || {};
        const vehicle = visibleVehicles.find(item => item.id === assignment.vehicleId) || {};
        return [user.fullName || user.email || assignment.employeeId, vehicle.name || assignment.vehicleId || '-', assignment.scheduleId || '-', assignment.assignmentType || 'schedule', assignment.safetyStatus || employee.safetyStatus || '-', assignment.status || 'active', {
          entity: 'driverAssignment',
          id: assignment.id,
          label: assignment.scheduleId || assignment.id,
          status: assignment.status || 'active',
          detail: {
            assignment,
            driver: employee,
            user,
            vehicle,
            schedule: state.schedules.find(item => item.id === assignment.scheduleId) || {},
            company: companyDetail(company)
          }
        }];
      }),
      driverIncidents: (serviceProfile.supportsBusOperations ? driverIncidents : []).map(incident => [incident.id, incident.scheduleId || incident.bookingRef || '-', incident.category || 'general', incident.severity || 'normal', incident.title || incident.description || '-', incident.status || 'open', {
        entity: 'driverIncident',
        id: incident.id,
        label: incident.title || incident.id,
        status: incident.status || 'open',
        detail: {
          incident,
          company: companyDetail(company)
        }
      }]),
      tripStatusUpdates: (serviceProfile.supportsBusOperations ? tripStatusUpdates : []).map(update => [update.scheduleId, update.status, update.location || '-', update.note || '-', update.createdBy || update.driverUserId || '-', update.createdAt ? dateValue(update.createdAt) : '-', {
        entity: 'tripStatusUpdate',
        id: update.id,
        label: update.scheduleId,
        status: update.status,
        detail: {
          tripStatusUpdate: update,
          company: companyDetail(company)
        }
      }]),
      notifications: companyNotificationRows,
      support: supportTickets.map(ticket => [ticket.id, ticket.audience || ticket.ownerType, ticket.subject, ticket.priority, ticket.status, ticket.updatedAt ? dateValue(ticket.updatedAt) : dateValue(ticket.createdAt), {
        entity: 'support',
        id: ticket.id,
        label: ticket.id,
        status: ticket.status
      }])
    };
  }
  function enrichCompanyDashboard(data, companyId, bookings) {
    const withMeta = (row, meta) => {
      if (!Array.isArray(row)) return row;
      const existing = rowMetaLike(row);
      if (existing) return [...row.slice(0, -1), {
        ...existing,
        detail: existing.detail || meta.detail,
        actions: existing.actions || meta.actions || []
      }];
      return [...row, meta];
    };
    const bookingMeta = booking => dashboardMeta('booking', booking.bookingRef, booking.bookingRef, booking.bookingStatus, bookingDetail(booking), ['view', 'check_in', 'no_show', 'note', 'refund', 'export']);
    const listingByTitle = title => state.listings.find(listing => listing.companyId === companyId && listing.title === title) || {};
    const scheduleById = id => state.schedules.find(schedule => schedule.id === id) || {};
    const employeeDetail = (employee = {}) => {
      const user = state.users.find(item => String(item.id || item._id || '') === String(employee.userId || '')) || {};
      return {
        // Preserve the canonical employee fields so Edit opens the same record
        // the table displays instead of a reduced, differently named summary.
        staff: {
          ...employee,
          fullName: user.fullName || employee.fullName || '',
          email: user.email || employee.email || '',
          phone: user.phone || employee.phone || '',
          userRole: user.role || '',
        },
        user: {
          id: String(user?.id || user?._id || ''),
          fullName: user?.fullName || '',
          email: user?.email || '',
          phone: user?.phone || '',
          role: user?.role || '',
          status: user?.status || '',
          verificationStatus: user?.verificationStatus || '',
          onboardingStatus: user?.onboardingStatus || '',
          emailVerifiedAt: user?.emailVerifiedAt || '',
          phoneVerifiedAt: user?.phoneVerifiedAt || '',
          lastLoginAt: user?.lastLoginAt || '',
          companyId: user?.companyId || '',
        },
        company: companyDetail(findCompany(companyId)),
        timestamps: {
          createdAt: employee.createdAt,
          updatedAt: employee.updatedAt
        }
      };
    };
    const rowBooking = ref => state.bookings.find(booking => booking.bookingRef === ref) || {};
    const rowSupport = id => state.supportTickets.find(ticket => ticket.id === id) || {};
    const rowReview = id => state.reviews.find(review => review.id === id) || {};
    return {
      ...data,
      recentBookings: (data.recentBookings || []).map(row => withMeta(row, bookingMeta(rowBooking(row[0])))),
      bookings: (data.bookings || []).map(row => withMeta(row, bookingMeta(rowBooking(row[0])))),
      checkins: (data.checkins || []).map(row => withMeta(row, bookingMeta(rowBooking(row[0])))),
      listings: (data.listings || []).map(row => {
        const listing = listingByTitle(row[0]);
        return withMeta(row, dashboardMeta('listing', recordIdentity(listing) || row[0], row[0], row[5], listingDetail(listing), ['view', 'edit', 'close', 'bookings', 'occupancy']));
      }),
      routes: (data.routes || []).map(row => {
        const meta = rowMetaLike(row);
        const route = state.routes.find(item => item.companyId === companyId && (item.id === meta?.id || item.routeName === row[0] || formatRouteLabel(item.origin, item.destination, item.routeName) === row[0])) || {};
        const listing = findListing(route.listingId) || {};
        return withMeta(row, dashboardMeta('route', route.id || row[0], row[0], row[5], {
          route,
          listing: listingDetail(listing)
        }, ['view', 'edit', 'close']));
      }),
      schedules: (data.schedules || []).map(row => {
        const schedule = scheduleById(row[0]);
        const listing = findListing(schedule.listingId) || {};
        const seats = seatsForSchedule(schedule.id);
        return withMeta(row, dashboardMeta('schedule', schedule.id || row[0], row[0], row[5], {
          schedule,
          listing: listingDetail(listing),
          seats: {
            total: seats.length || schedule.totalSeats,
            booked: seats.filter(seat => seat.status === 'taken').length,
            held: seats.filter(seat => seat.status === 'locked').length,
            remaining: schedule.availableSeats
          }
        }, ['view', 'edit', 'cancel', 'manifest', 'seat_map']));
      }),
      vehicles: (data.vehicles || []).map(row => {
        const vehicle = state.vehicles.find(item => item.companyId === companyId && item.name === row[0]) || {};
        return withMeta(row, dashboardMeta('vehicle', vehicle.id || row[0], row[0], row[5], {
          vehicle,
          listing: listingDetail(findListing(vehicle.listingId) || {})
        }, ['view', 'edit', 'archive']));
      }),
      inventory: (data.inventory || []).map(row => withMeta(row, dashboardMeta('inventory', row[0], row[0], row[6], {
        inventory: {
          item: row[0],
          service: row[1],
          total: row[2],
          booked: row[3],
          held: row[4],
          blocked: row[5],
          status: row[6]
        }
      }, ['view', 'move_seat', 'release_holds']))),
      staff: (data.staff || []).map(row => {
        const employee = state.companyEmployees.find(item => item.companyId === companyId && (state.users.find(user => user.id === item.userId)?.fullName === row[0] || item.id === row[0])) || {};
        return withMeta(row, dashboardMeta('employee', employee.id || row[0], row[0], row[5], employeeDetail(employee), ['view', 'invite', 'resend', 'suspend']));
      }),
      financeSummary: data.financeSummary || {},
      revenueDrilldown: data.revenueDrilldown || [],
      settlementBatches: data.settlementBatches || [],
      settlementLedger: data.settlementLedger || [],
      payoutRequests: data.payoutRequests || [],
      financeStatements: data.financeStatements || [],
      payouts: (data.payouts || []).map(row => withMeta(row, dashboardMeta('payout', row[0], row[1] || row[0], row[9] || row[6], {
        payout: {
          transactionId: row[0],
          bookingRef: row[1],
          service: row[2],
          gross: row[3],
          ownerEarnings: row[4],
          platformFee: row[5],
          promoterCommission: row[6],
          refundDebit: row[7],
          netPayable: row[8],
          status: row[9] || row[6]
        },
        company: companyDetail(findCompany(companyId))
      }, ['view', 'request_payout', 'export']))),
      promotions: (data.promotions || []).map(row => {
        const campaign = state.promotionCampaigns.find(item => item.companyId === companyId && item.name === row[0]) || {};
        return withMeta(row, dashboardMeta('promotion', campaign.id || row[0], row[0], row[6], campaignDetail(campaign), ['view', 'edit', 'pause']));
      }),
      reviews: (data.reviews || []).map(row => {
        const review = rowReview(row[row.length - 1]?.id) || state.reviews.find(item => item.companyId === companyId && item.comment === row[3]) || {};
        return withMeta(row, dashboardMeta('review', review.id || row[0], row[0], row[5], {
          review,
          booking: bookingDetail(state.bookings.find(booking => booking.id === review.bookingId) || {})
        }, ['view', 'reply', 'flag']));
      }),
      support: (data.support || []).map(row => withMeta(row, dashboardMeta('support', row[0], row[0], row[4], supportDetail(rowSupport(row[0])), ['view', 'respond', 'resolve'])))
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
    const employeeUser = state.users.find(user => user.id === employeeId) || state.users.find(user => user.companyId === companyId && user.role === 'company_employee') || {};
    const employeeProfile = (Array.isArray(state.companyEmployees) ? state.companyEmployees : []).find(employee => employee.companyId === companyId && employee.userId === employeeUser.id) || {};
    const listings = state.listings.filter(listing => listing.companyId === companyId);
    const assignedScheduleIds = new Set((Array.isArray(state.driverAssignments) ? state.driverAssignments : []).filter(assignment => assignment.companyId === companyId && (!employeeProfile.id || assignment.employeeId === employeeProfile.id || assignment.driverUserId === employeeUser.id)).map(assignment => assignment.scheduleId).filter(Boolean));
    const allCompanySchedules = state.schedules.filter(schedule => schedule.companyId === companyId && schedule.status !== 'archived');
    let schedules = allCompanySchedules.filter(schedule => !driverMode || !assignedScheduleIds.size || assignedScheduleIds.has(schedule.id) || schedule.driverEmployeeId === employeeProfile.id || schedule.driverUserId === employeeUser.id).slice(0, 50);
    // Driver operations remain scoped to the authenticated account.
    if (driverMode && !schedules.length) schedules = allCompanySchedules.slice(0, 50);
    const rooms = state.roomSummaries.filter(room => room.companyId === companyId);
    const supportTickets = state.supportTickets.filter(ticket => ticket.companyId === companyId || ticket.ownerType === 'company' && (!ticket.ownerId || ticket.ownerId === companyId));
    const companyDashboard = companyDashboardData(companyId, listings, bookings);
    const todayKey = new Date().toISOString().slice(0, 10);
    const isToday = value => value && new Date(value).toISOString().slice(0, 10) === todayKey;
    const bookingRow = booking => withMeta([booking.bookingRef, bookingTitle(booking), bookingCustomer(booking), booking.passengers?.[0]?.seatOrRoom || booking.passengers?.[0]?.seatNumber || 'Selected', booking.serviceDate ? dateValue(booking.serviceDate) : dateValue(booking.createdAt), booking.bookingStatus, bookingTotal(booking)], dashboardMeta('booking', booking.bookingRef, booking.bookingRef, booking.bookingStatus, bookingDetail(booking), ['view', 'check_in', 'no_show', 'record_payment', 'refund_request', 'customer_note', 'export']));
    const visibleBookings = bookings.filter(booking => !isFailedPaymentArtifact(booking));
    const rows = visibleBookings.slice(0, 50).map(bookingRow);
    const checkinRows = visibleBookings.slice(0, 50).map(booking => withMeta([booking.bookingRef, bookingCustomer(booking), bookingTitle(booking), booking.passengers?.[0]?.seatOrRoom || booking.passengers?.[0]?.seatNumber || 'Selected', booking.checkedInAt ? dateValue(booking.checkedInAt) : booking.noShowAt ? dateValue(booking.noShowAt) : 'Pending', booking.bookingStatus === 'checked_in' ? 'Checked in' : booking.bookingStatus === 'no_show' ? 'No-show' : 'Not checked'], dashboardMeta('checkin', booking.bookingRef, booking.bookingRef, booking.bookingStatus, bookingDetail(booking), ['view', 'check_in', 'no_show', 'note', 'export'])));
    const paymentRows = [...state.payments.filter(payment => {
      const booking = findBooking(payment.bookingRef || payment.bookingId);
      return booking?.companyId === companyId && !isFailedPaymentArtifact(booking, payment);
    }).map(payment => {
      const booking = findBooking(payment.bookingRef || payment.bookingId) || {};
      return withMeta([payment.id, payment.bookingRef, bookingCustomer(booking), payment.provider || 'Desk', formatMoney(payment.amount, payment.currency), payment.status], dashboardMeta('payment', payment.id, payment.id, payment.status, paymentRecordDetail(payment), ['view', 'record_payment', 'export']));
    }), ...visibleBookings.filter(booking => !state.payments.some(payment => payment.bookingRef === booking.bookingRef || payment.bookingId === booking.id)).slice(0, 8).map((booking, index) => withMeta([`PAY-${8000 + index}`, booking.bookingRef, bookingCustomer(booking), booking.paymentProvider || 'Classic Trip Payments', bookingTotal(booking), booking.paymentStatus], dashboardMeta('payment', booking.bookingRef, booking.bookingRef, booking.paymentStatus, bookingDetail(booking), ['view', 'record_payment', 'export'])))];
    const handovers = (Array.isArray(state.shiftHandovers) ? state.shiftHandovers : []).filter(handover => handover.companyId === companyId).slice(0, 20);
    const checkedInCount = bookings.filter(booking => booking.bookingStatus === 'checked_in' || booking.checkInStatus === 'checked_in').length;
    const manualBookings = bookings.filter(booking => booking.source === 'employee_manual').length;
    const deskSales = visibleBookings.filter(booking => isFinanciallySuccessful(booking)).reduce((total, booking) => total + Number(booking.pricing?.total || 0), 0);
    const paymentsRecorded = state.payments.filter(payment => {
      const booking = findBooking(payment.bookingRef || payment.bookingId);
      return booking?.companyId === companyId && payment.rawPayload?.source === 'employee_dashboard';
    }).length;
    const refundRequestsHandled = state.refundRequests.filter(refund => refund.companyId === companyId && refund.createdBy === employeeId).length;
    const notesAdded = supportTickets.filter(ticket => ticket.createdBy === employeeId || ticket.assignedTo === employeeId).length;
    const supportRows = supportTickets.map(ticket => withMeta([ticket.id, ticket.audience || ticket.ownerType || 'Customer', ticket.subject, ticket.priority, ticket.status, ticket.updatedAt ? dateValue(ticket.updatedAt) : dateValue(ticket.createdAt)], dashboardMeta('support', ticket.id, ticket.id, ticket.status, employeeSupportDetail(ticket), ['view', 'resolve', 'update_status', 'export'])));
    const enrichedInventory = [];
    schedules.forEach(schedule => {
      const seats = seatsForSchedule(schedule.id).slice(0, 12);
      seats.forEach(seat => {
        const booking = bookings.find(item => item.scheduleId === schedule.id && (item.passengers || []).some(pax => [pax.seatOrRoom, pax.seatNumber].includes(seat.seatNumber || seat.label || seat.id)));
        enrichedInventory.push(withMeta([schedule.id, seat.seatNumber || seat.label || seat.id, bookingTitle({
          listingId: schedule.listingId
        }), formatMoney(schedule.basePrice || findListing(schedule.listingId)?.priceFrom || 0, schedule.currency || findListing(schedule.listingId)?.currency || platformCurrency()), booking ? bookingCustomer(booking) : 'Available', seat.lockedUntil ? dateValue(seat.lockedUntil) : '-', booking ? 'booked' : seat.status || 'available'], dashboardMeta('inventory', `${schedule.id}:${seat.seatNumber || seat.id}`, seat.seatNumber || seat.id, booking ? 'booked' : seat.status, inventoryDetail({
          ...seat,
          scheduleId: schedule.id,
          listingId: schedule.listingId,
          bookingRef: booking?.bookingRef,
          companyId
        }, companyId), ['view', 'move_seat', 'release_hold', 'export'])));
      });
    });
    rooms.slice(0, 20).forEach(room => {
      enrichedInventory.push(withMeta([room.listingId || 'Room listing', room.roomType || room.id, bookingTitle({
        listingId: room.listingId
      }), formatMoney(room.nightlyPrice || room.price || 0, room.currency || platformCurrency()), `${room.inventory || room.available || 0} available`, '-', room.status || 'available'], dashboardMeta('inventory', room.id, room.roomType || room.id, room.status, inventoryDetail({
        ...room,
        companyId
      }, companyId), ['view', 'release_hold', 'export'])));
    });
    const customerRows = bookings.slice(0, 30).map(booking => {
      const customerDetail = customerOpsDetail(booking);
      return withMeta([bookingCustomer(booking), booking.guestSnapshot?.phone || booking.guestSnapshot?.email || 'Contact', String(customerDetail.metrics?.bookingsCount || 1), bookingTitle(booking), customerDetail.metrics?.totalSpend || bookingTotal(booking), booking.bookingStatus], dashboardMeta('customer', booking.customerUserId || booking.bookingRef, bookingCustomer(booking), booking.bookingStatus, customerDetail, ['view', 'customer_note', 'bookings', 'export']));
    });
    const refundRows = state.refundRequests.filter(refund => !refund.companyId || refund.companyId === companyId || bookings.some(booking => booking.bookingRef === refund.bookingRef)).map(refund => withMeta([refund.id, refund.bookingRef, bookingCustomer(findBooking(refund.bookingRef) || {}), refund.reason, formatMoney(refund.amount, refund.currency || findBooking(refund.bookingRef)?.pricing?.currency || platformCurrency()), refund.status], dashboardMeta('refund', refund.id, refund.id, refund.status, employeeRefundDetail(refund), ['view', 'refund_request', 'export'])));
    const scheduleRows = schedules.map(schedule => withMeta([schedule.id, bookingTitle({
      listingId: schedule.listingId
    }), dateValue(schedule.departAt), schedule.vehicleName || state.vehicles.find(vehicle => vehicle.id === schedule.vehicleId)?.name || 'Assigned inventory', `${Math.max(0, Number(schedule.totalSeats || 0) - Number(schedule.availableSeats || 0))}/${schedule.totalSeats || '0'}`, schedule.status], dashboardMeta('schedule', schedule.id, schedule.id, schedule.status, scheduleDetail(schedule), ['view', 'manifest', 'seat_map', 'delay_notice', 'export'])));
    const handoverRows = handovers.length ? handovers.map(handover => withMeta([handover.shift, handover.nextStaff || handover.employeeId, handover.note, handover.status], dashboardMeta('handover', handover.id, handover.shift, handover.status, handoverDetail(handover, companyId), ['view', 'export']))) : [withMeta(['Current shift', employeeUser.fullName || 'Team', 'No handover submitted yet. Use the form to record cash, bookings, check-ins, and issues.', 'Open'], dashboardMeta('handover', 'handover-current', 'Current shift', 'open', handoverDetail({
      id: 'handover-current',
      companyId,
      employeeId,
      shift: 'Current shift',
      nextStaff: employeeUser.fullName,
      note: 'No handover submitted yet',
      status: 'open'
    }, companyId), ['view']))];
    const driverIncidentRows = (Array.isArray(state.driverIncidents) ? state.driverIncidents : []).filter(incident => incident.companyId === companyId && (!driverMode || schedules.some(schedule => schedule.id === incident.scheduleId) || incident.driverUserId === employeeUser.id || incident.employeeId === employeeProfile.id || incident.employeeId === employeeUser.id)).map(incident => withMeta([incident.id, incident.scheduleId || incident.bookingRef || '-', incident.category || incident.incidentType || 'general', incident.severity || 'normal', incident.title || incident.description || incident.notes || '-', incident.status || 'open'], dashboardMeta('driverIncident', incident.id, incident.title || incident.id, incident.status || 'open', {
      incident,
      company: companyDetail(company)
    }, ['view', 'export'])));
    const tripStatusRows = (Array.isArray(state.tripStatusUpdates) ? state.tripStatusUpdates : []).filter(update => update.companyId === companyId && (!driverMode || schedules.some(schedule => schedule.id === update.scheduleId) || update.driverUserId === employeeUser.id || update.updatedBy === employeeUser.id)).map(update => withMeta([update.scheduleId, update.status, update.location || update.gate || '-', update.note || update.message || '-', update.createdAt ? dateValue(update.createdAt) : update.updatedAt ? dateValue(update.updatedAt) : '-', update.createdBy || update.updatedBy || update.driverUserId || '-'], dashboardMeta('tripStatusUpdate', update.id, update.scheduleId, update.status, {
      tripStatusUpdate: update,
      company: companyDetail(company)
    }, ['view', 'export'])));
    const driverScheduleFallbackRows = driverMode ? schedules.slice(0, 20).map(schedule => withMeta([schedule.id, bookingCustomer({}) || 'Manifest pending', bookingTitle({
      listingId: schedule.listingId
    }), 'Seat assignment pending', schedule.departAt ? dateValue(schedule.departAt) : 'Departure pending', schedule.status || 'active'], dashboardMeta('manifest', schedule.id, schedule.id, schedule.status || 'active', scheduleDetail(schedule), ['view', 'manifest', 'export']))) : [];
    const safeCheckinRows = checkinRows.length ? checkinRows : driverScheduleFallbackRows;
    const safeDriverOpsRows = scheduleRows.length ? scheduleRows : driverMode ? schedules.map(schedule => withMeta([schedule.id, bookingTitle({
      listingId: schedule.listingId
    }), schedule.departAt ? dateValue(schedule.departAt) : 'Departure pending', schedule.vehicleName || state.vehicles.find(vehicle => vehicle.id === schedule.vehicleId)?.name || 'Vehicle pending', `0/${schedule.totalSeats || 0}`, schedule.status || 'active'], dashboardMeta('schedule', schedule.id, schedule.id, schedule.status || 'active', scheduleDetail(schedule), ['view', 'manifest', 'seat_map', 'export']))) : [];
    const safeTripStatusRows = tripStatusRows.length ? tripStatusRows : driverMode ? schedules.slice(0, 8).map(schedule => withMeta([schedule.id, schedule.status || 'scheduled', schedule.gate || schedule.platform || 'Terminal', 'No driver update recorded yet', schedule.updatedAt ? dateValue(schedule.updatedAt) : 'Ready', employeeUser.fullName || 'Driver'], dashboardMeta('tripStatusUpdate', `${schedule.id}-status`, schedule.id, schedule.status || 'scheduled', {
      schedule: scheduleDetail(schedule),
      company: companyDetail(company)
    }, ['view', 'export']))) : [];
    const safeDriverIncidentRows = driverIncidentRows.length ? driverIncidentRows : driverMode ? [withMeta(['No open incidents', schedules[0]?.id || 'All assigned trips', 'safety', 'normal', 'No incident has been reported for the assigned trips.', 'clear'], dashboardMeta('driverIncident', 'no-open-incidents', 'No open incidents', 'clear', {
      message: 'No driver incidents have been reported for this dashboard scope.',
      company: companyDetail(company)
    }, ['view']))] : [];
    const safeInventoryRows = enrichedInventory.length ? enrichedInventory : companyDashboard.inventory && companyDashboard.inventory.length ? companyDashboard.inventory : driverMode ? schedules.flatMap(schedule => [withMeta([schedule.id, 'Seats', bookingTitle({
      listingId: schedule.listingId
    }), formatMoney(schedule.basePrice || findListing(schedule.listingId)?.priceFrom || 0, schedule.currency || findListing(schedule.listingId)?.currency || platformCurrency()), `${schedule.availableSeats || 0} available`, '-', schedule.status || 'active'], dashboardMeta('inventory', `${schedule.id}-inventory`, schedule.id, schedule.status || 'active', scheduleDetail(schedule), ['view', 'seat_map', 'export']))]) : [];
    return {
      mode: driverMode ? 'driver' : 'employee',
      company: {
        id: company.id || companyId,
        name: company.name || 'Company partner',
        slug: company.slug || companyId
      },
      serviceProfile: companyDashboard.serviceProfile,
      notifications: companyDashboard.notifications || [],
      profile: {
        id: employeeUser.id || employeeId,
        fullName: employeeUser.fullName || 'Company employee',
        email: employeeUser.email || '',
        phone: employeeUser.phone || '',
        status: employeeUser.status || 'active',
        role: employeeUser.role || 'company_employee',
        roleTitle: driverMode ? employeeProfile.roleTitle || 'Driver' : employeeProfile.roleTitle || 'Ticket Checker',
        permissionsLabel: (employeeProfile.permissions || ['booking.view', 'checkin.assist']).join(', '),
        branch: employeeProfile.branch || company.city || 'Main branch',
        shift: employeeProfile.shift || 'Morning shift',
        notes: employeeProfile.notes || 'Can create bookings, check in passengers, view payments, and create support tasks.',
        permissions: employeeProfile.permissions || ['booking.view', 'checkin.assist'],
        company: company.name || companyId,
        createdAt: employeeUser.createdAt || employeeProfile.createdAt,
        updatedAt: employeeUser.updatedAt || employeeProfile.updatedAt
      },
      stats: {
        checkedIn: checkedInCount.toLocaleString(),
        manualBookings: manualBookings.toLocaleString(),
        openTasks: supportTickets.filter(ticket => !['closed', 'resolved', 'completed'].includes(normalize(ticket.status))).length.toLocaleString(),
        deskSales: formatMoney(deskSales),
        shiftEnds: employeeProfile.shiftEnds || '6:00 PM',
        paymentsRecorded: paymentsRecorded.toLocaleString(),
        notesAdded: notesAdded.toLocaleString(),
        refundRequestsHandled: refundRequestsHandled.toLocaleString()
      },
      options: {
        listings: listings.filter(listing => listing.bookable && listing.status === 'active').map(listing => ({
          id: listing.id,
          value: listing.id,
          slug: listing.slug,
          label: listing.title,
          serviceType: listing.serviceType
        })),
        schedules: schedules.filter(schedule => schedule.status !== 'archived').map(schedule => ({
          id: schedule.id,
          value: schedule.id,
          label: `${schedule.id} - ${bookingTitle({
            listingId: schedule.listingId
          })}`,
          listingId: schedule.listingId,
          status: schedule.status
        })),
        vehicles: state.vehicles.filter(vehicle => vehicle.companyId === companyId && vehicle.status !== 'archived').map(vehicle => ({
          id: vehicle.id,
          value: vehicle.id,
          label: `${vehicle.name || vehicle.id}${vehicle.plateOrCode ? ` - ${vehicle.plateOrCode}` : ''}`,
          listingId: vehicle.listingId,
          serviceType: vehicle.serviceType,
          status: vehicle.status
        })),
        rooms: rooms.filter(room => room.status !== 'archived').map(room => ({
          id: room.id,
          value: room.id,
          label: `${room.roomType} - ${bookingTitle({
            listingId: room.listingId
          })}`,
          listingId: room.listingId,
          status: room.status
        }))
      },
      tasks: supportRows,
      driverOps: safeDriverOpsRows,
      driverIncidents: safeDriverIncidentRows,
      tripStatusUpdates: safeTripStatusRows,
      checkins: safeCheckinRows,
      bookings: rows,
      schedules: scheduleRows.length ? scheduleRows : safeDriverOpsRows,
      routes: state.routes.filter(route => route.companyId === companyId && route.status !== 'archived').map(route => {
        const listing = findListing(route.listingId) || {};
        return [formatRouteLabel(route.origin || listing.from || '-', route.destination || listing.to || '-', route.routeName), listing.title || route.listingId || '-', `${(route.boardingPoints || []).length} boarding`, `${(route.dropoffPoints || []).length} dropoffs`, route.corridor || '-', route.status || 'active', dashboardMeta('route', route.id, formatRouteLabel(route.origin || '-', route.destination || '-', route.routeName), route.status || 'active', {
          route,
          listing: listingDetail(listing),
          company: companyDetail(findCompany(companyId) || {})
        }, ['view', 'schedule'])];
      }),
      vehicles: state.vehicles.filter(vehicle => vehicle.companyId === companyId && vehicle.status !== 'archived').map(vehicle => [vehicle.name || vehicle.id, SERVICE_LABELS[vehicle.serviceType] || vehicle.serviceType || 'Vehicle', vehicle.plateOrCode || '-', `${vehicle.totalSeats || vehicle.capacity || 0} seats`, vehicle.layoutName || 'Layout pending', vehicle.status || 'active', dashboardMeta('vehicle', vehicle.id, vehicle.name || vehicle.id, vehicle.status || 'active', {
        vehicle,
        listing: listingDetail(findListing(vehicle.listingId) || {}),
        company: companyDetail(findCompany(vehicle.companyId) || {})
      }, ['view', 'schedule', 'manifest'])]),
      inventory: safeInventoryRows,
      customers: customerRows,
      payments: paymentRows,
      refunds: refundRows,
      support: supportRows,
      handovers: handoverRows,
      reports: [['Check-ins done', checkedInCount.toLocaleString(), 'Today / active company scope', 'Ready'], ['Payments recorded', paymentsRecorded.toLocaleString(), 'Cashier / desk entries', 'Ready'], ['Notes added', notesAdded.toLocaleString(), 'Customer notes and support replies', 'Ready'], ['Bookings handled', manualBookings.toLocaleString(), 'Manual desk bookings', 'Ready'], ['Refund requests handled', refundRequestsHandled.toLocaleString(), 'Employee-created requests', 'Review']]
    };
  }
  function scheduleDetail(schedule = {}) {
    if (!schedule) return null;
    const listing = findListing(schedule.listingId) || {};
    const company = findCompany(schedule.companyId) || {};
    const route = routeById.get(normalize(schedule.routeId)) || routesForListing(schedule.listingId)[0] || {};
    const vehicle = vehicleById.get(normalize(schedule.vehicleId)) || {};
    const scheduleBookings = bookingsBySchedule.get(String(schedule.id || '').trim()) || bookingsByListing.get(String(schedule.listingId || '').trim()) || [];
    const seatRows = seatsForSchedule(schedule.id);
    const bookedSeats = seatRows.filter(seat => ['taken', 'booked'].includes(normalize(seat.status))).length || Number(schedule.bookedSeats || 0);
    const heldSeats = seatRows.filter(seat => ['locked', 'held', 'hold'].includes(normalize(seat.status))).length || Number(schedule.heldSeats || 0);
    const totalSeats = seatRows.length || Number(schedule.totalSeats || vehicle.totalSeats || listing.availability || 0);
    return {
      schedule: {
        id: schedule.id,
        routeId: schedule.routeId,
        listingId: schedule.listingId,
        companyId: schedule.companyId,
        status: schedule.status,
        departure: schedule.departAt,
        arrival: schedule.arriveAt,
        basePrice: schedule.basePrice || listing.priceFrom,
        currency: schedule.currency || listing.currency || platformCurrency(),
        totalSeats,
        bookedSeats,
        heldSeats,
        remainingSeats: Math.max(0, totalSeats - bookedSeats - heldSeats),
        occupancy: totalSeats ? `${Math.round(bookedSeats / totalSeats * 100)}%` : '0%',
        driverName: schedule.driverName || '',
        gate: schedule.gate || '',
        platform: schedule.platform || '',
        notes: schedule.notes || ''
      },
      route: {
        origin: route.origin || listing.from,
        destination: route.destination || listing.to,
        corridor: route.corridor || listing.corridor,
        status: route.status
      },
      vehicle: {
        id: vehicle.id,
        name: vehicle.name || schedule.vehicleName,
        plateOrCode: vehicle.plateOrCode,
        layoutName: vehicle.layoutName,
        totalSeats: vehicle.totalSeats,
        status: vehicle.status
      },
      service: {
        listingId: listing.id,
        title: listing.title,
        serviceType: listing.serviceType,
        address: listing.address || listing.location,
        status: listing.status
      },
      company: companyDetail(company),
      operations: {
        manifestCount: scheduleBookings.length,
        checkedIn: scheduleBookings.filter(booking => booking.bookingStatus === 'checked_in').length,
        noShows: scheduleBookings.filter(booking => booking.bookingStatus === 'no_show').length
      },
      timestamps: {
        createdAt: schedule.createdAt,
        updatedAt: schedule.updatedAt
      }
    };
  }
  function inventoryDetail(record = {}, companyId = '') {
    if (!record) return null;
    const schedule = scheduleById.get(normalize(record.scheduleId)) || {};
    const listing = findListing(record.listingId || schedule.listingId) || {};
    const booking = record.bookingRef ? findBooking(record.bookingRef) : null;
    const company = findCompany(companyId || record.companyId || listing.companyId || schedule.companyId) || {};
    return {
      inventory: {
        id: record.id || record.seatNumber || record.roomNumber || record.roomType,
        scheduleId: record.scheduleId,
        listingId: listing.id,
        type: record.roomType ? 'room' : 'seat',
        seatNumber: record.seatNumber || record.label || '',
        roomType: record.roomType || '',
        price: record.price || record.priceDelta || listing.priceFrom || 0,
        currency: record.currency || listing.currency || platformCurrency(),
        status: record.status,
        lockedUntil: record.lockedUntil,
        holdId: record.lockId || record.holdId,
        bookingRef: record.bookingRef || booking?.bookingRef || ''
      },
      currentBooking: booking ? bookingDetail(booking) : {},
      service: {
        listingId: listing.id,
        title: listing.title,
        serviceType: listing.serviceType,
        from: listing.from,
        to: listing.to,
        address: listing.address || listing.location
      },
      schedule: {
        id: schedule.id,
        departure: schedule.departAt,
        arrival: schedule.arriveAt,
        vehicleName: schedule.vehicleName,
        status: schedule.status
      },
      company: companyDetail(company),
      timestamps: {
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
      }
    };
  }
  function employeeSupportDetail(ticket = {}) {
    if (!ticket) return null;
    const booking = ticket.bookingRef ? findBooking(ticket.bookingRef) : null;
    const company = findCompany(ticket.companyId || booking?.companyId || ticket.ownerId) || {};
    return {
      case: {
        id: ticket.id,
        subject: ticket.subject,
        category: ticket.category || ticket.type || 'support',
        message: ticket.message,
        priority: ticket.priority,
        status: ticket.status,
        audience: ticket.audience,
        assignedTo: ticket.assignedTo,
        createdBy: ticket.createdBy
      },
      customer: {
        ownerType: ticket.ownerType,
        ownerId: ticket.ownerId,
        email: ticket.email || booking?.guestSnapshot?.email,
        phone: ticket.phone || booking?.guestSnapshot?.phone
      },
      booking: booking ? bookingDetail(booking).booking : {
        bookingRef: ticket.bookingRef || ''
      },
      company: companyDetail(company),
      resolution: {
        lastResponse: ticket.lastResponse,
        resolutionNotes: ticket.resolutionNotes,
        respondedBy: ticket.respondedBy,
        respondedAt: ticket.respondedAt,
        resolvedAt: ticket.resolvedAt
      },
      timestamps: {
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt
      }
    };
  }
  function employeeRefundDetail(refund = {}) {
    if (!refund) return null;
    const booking = findBooking(refund.bookingRef) || {};
    return {
      refund: {
        id: refund.id,
        bookingRef: refund.bookingRef,
        amount: refund.amount,
        currency: refund.currency || booking.pricing?.currency || platformCurrency(),
        reason: refund.reason,
        status: refund.status,
        requestedBy: refund.requesterId || refund.createdBy,
        reviewedBy: refund.reviewedBy,
        reviewedAt: refund.reviewedAt,
        rejectionReason: refund.rejectionReason
      },
      booking: bookingDetail(booking),
      timestamps: {
        createdAt: refund.createdAt,
        updatedAt: refund.updatedAt
      }
    };
  }
  function paymentRecordDetail(payment = {}) {
    if (!payment) return null;
    const booking = findBooking(payment.bookingRef || payment.bookingId) || {};
    return {
      payment: {
        id: payment.id,
        bookingId: payment.bookingId,
        bookingRef: payment.bookingRef,
        provider: payment.provider,
        providerReference: payment.providerReference,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        paidAt: payment.paidAt,
        failureReason: payment.failureReason,
        checkoutUrl: payment.checkoutUrl,
        methodNote: payment.methodNote || payment.paymentMethodNote,
        metadata: payment.rawPayload || payment.metadata
      },
      booking: bookingDetail(booking),
      timestamps: {
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt
      }
    };
  }
  function customerOpsDetail(booking = {}) {
    const detail = bookingDetail(booking) || {};
    const customerKey = normalize(booking.guestSnapshot?.email || booking.guestSnapshot?.phone || booking.customerUserId || booking.bookingRef);
    const customerBookings = state.bookings.filter(item => normalize(item.customerUserId || item.guestSnapshot?.email || item.guestSnapshot?.phone || item.bookingRef) === customerKey);
    return {
      customer: detail.customer || {},
      latestBooking: detail.booking || {},
      company: detail.company || {},
      metrics: {
        bookingsCount: customerBookings.length,
        confirmedBookings: customerBookings.filter(item => ['confirmed', 'checked_in', 'completed'].includes(item.bookingStatus)).length,
        totalSpend: formatMoney(customerBookings.reduce((total, item) => total + Number(item.pricing?.total || 0), 0)),
        notesCount: state.supportTickets.filter(ticket => normalize(ticket.ownerId) === customerKey || normalize(ticket.audience) === customerKey).length
      },
      bookings: customerBookings.slice(0, 8).map(item => ({
        bookingRef: item.bookingRef,
        service: bookingTitle(item),
        status: item.bookingStatus,
        paymentStatus: item.paymentStatus,
        amount: formatMoney(item.pricing?.total || 0, item.pricing?.currency)
      }))
    };
  }
  function handoverDetail(handover = {}, companyId = '') {
    const company = findCompany(companyId || handover.companyId) || {};
    const employee = state.users.find(user => user.id === handover.employeeId) || {};
    return {
      handover: {
        id: handover.id,
        companyId: handover.companyId,
        employeeId: handover.employeeId,
        employeeName: employee.fullName || handover.employeeId,
        shift: handover.shift,
        nextStaff: handover.nextStaff,
        note: handover.note,
        issues: handover.issues,
        cashCollected: handover.cashCollected,
        bookingsHandled: handover.bookingsHandled,
        checkInsHandled: handover.checkInsHandled,
        status: handover.status
      },
      company: companyDetail(company),
      timestamps: {
        createdAt: handover.createdAt,
        updatedAt: handover.updatedAt
      }
    };
  }
  function customerDashboardData(bookings, customerId) {
    // Never fall back to "any customer in the store" - if the caller's own id doesn't resolve to a
    // real user, render an empty dashboard rather than silently substituting a different customer's.
    const customerUser = state.users.find(user => user.id === customerId) || {};
    const customerWallets = state.wallets.filter(wallet => wallet.ownerType === 'customer' && (!wallet.ownerId || wallet.ownerId === customerUser.id));
    const wallet = customerWallets[0] || {};
    const activeBookings = bookings.filter(booking => ['confirmed', 'pending', 'ticketed', 'checked_in'].includes(normalize(booking.bookingStatus)) && !/refund|cancel/.test(normalize(booking.bookingStatus)));
    const pastBookings = bookings.filter(booking => ['completed', 'checked_in'].includes(normalize(booking.bookingStatus)));
    const savedListings = state.savedListings?.filter(item => item.userId === customerUser.id).map(item => findListing(item.listingId)).filter(Boolean) || state.listings.filter(listing => listing.isFeatured || listing.bookable).slice(0, 8);
    const bookingMeta = (booking, actions = ['view', 'ticket', 'receipt', 'refund', 'support', 'review', 'export']) => dashboardMeta('booking', booking.bookingRef, booking.bookingRef, booking.bookingStatus, bookingDetail(booking), actions);
    const bookingRows = bookings.map(booking => [booking.bookingRef, bookingTitle(booking), bookingCompany(booking), dateValue(booking.createdAt || booking.travelDate || booking.departAt), bookingCustomer(booking), booking.bookingStatus, bookingTotal(booking), bookingMeta(booking)]);
    const savedRows = savedListings.map(listing => [listing.title, listing.type || listing.serviceType, listing.partner || findCompany(listing.companyId)?.name || '', listing.to ? formatRouteLabel(listing.from || listing.city || listing.location || '-', listing.to) : (listing.from || listing.city || listing.location || '-'), formatMoney(listing.priceFrom || listing.price || 0, listing.currency || platformCurrency()), listing.bookable ? 'Available' : listing.status || 'Saved', dashboardMeta('saved_listing', listing.id, listing.title, listing.status || 'saved', listingDetail(listing), ['view', 'book', 'remove', 'export'])]);
    const receiptRows = (state.receiptInvoices || [])
      .filter((document) => document.documentType === 'receipt' && bookings.some((booking) => booking.bookingRef === document.bookingRef))
      .map((document) => {
        const booking = bookings.find((item) => item.bookingRef === document.bookingRef) || {};
        return [document.documentRef || document.id, document.bookingRef, document.provider || 'Payment', dateValue(document.issuedAt || document.createdAt), formatMoney(document.total || 0, document.currency || platformCurrency()), document.status || 'issued', dashboardMeta('receipt', document.id, document.documentRef || document.id, document.status || 'issued', { document, booking: bookingDetail(booking) }, ['view', 'download', 'booking', 'export'])];
      });
    const refundRows = state.refundRequests.filter(refund => !refund.bookingRef || bookings.some(booking => booking.bookingRef === refund.bookingRef)).map(refund => [refund.id, refund.bookingRef, refund.reason, formatMoney(refund.amount || 0, refund.currency || platformCurrency()), refund.status, refund.reviewedAt ? dateValue(refund.reviewedAt) : dateValue(refund.createdAt || new Date()), dashboardMeta('refund', refund.id, refund.id, refund.status, refundDetail(refund), ['view', 'booking', 'support', 'export'])]);
    const supportRows = state.supportTickets.filter(ticket => ticket.ownerType === 'customer' || ticket.ownerId === customerUser.id || bookings.some(booking => booking.bookingRef === ticket.bookingRef)).map(ticket => [ticket.id, ticket.bookingRef || ticket.relatedBookingRef || 'General', ticket.subject, ticket.priority || 'Normal', ticket.status, dateValue(ticket.createdAt || ticket.updatedAt || new Date()), dashboardMeta('support', ticket.id, ticket.id, ticket.status, supportDetail(ticket), ['view', 'reply', 'reopen', 'export'])]);
    const reviewRows = bookings.map(booking => {
      const review = state.reviews.find(item => item.bookingId === booking.id || item.bookingRef === booking.bookingRef);
      const canReview = ['checked_in', 'completed'].includes(normalize(booking.bookingStatus));
      return [booking.bookingRef, bookingTitle(booking), bookingCompany(booking), review ? String(review.rating) : '-', review ? review.comment : canReview ? 'Eligible for review' : 'Trip not completed yet', review ? review.status === 'published' ? 'Submitted' : review.status : canReview ? 'Pending' : 'Not eligible', dashboardMeta('review', review?.id || booking.bookingRef, booking.bookingRef, review?.status || (canReview ? 'pending' : 'not eligible'), {
        review: review || {},
        booking: bookingDetail(booking)
      }, ['view', canReview ? 'write_review' : 'disabled', 'export'])];
    });
    const walletRows = state.walletTransactions.filter(txn => txn.ownerType === 'customer' || txn.ownerId === customerUser.id || txn.customerId === customerUser.id).map(txn => [txn.id, txn.transactionType || txn.type, txn.method || txn.reference || txn.source || 'Wallet', dateValue(txn.createdAt || new Date()), formatMoney(txn.amount || 0, txn.currency || wallet.currency || platformCurrency()), txn.status || 'completed', dashboardMeta('wallet_transaction', txn.id, txn.id, txn.status, {
      transaction: txn,
      wallet
    }, ['view', 'export'])]);
    const fallbackWalletRows = customerWallets.map(item => [item.id, 'Wallet balance', item.currency || platformCurrency(), 'Current', formatMoney(item.availableBalance || 0, item.currency || platformCurrency()), item.status || 'Active', dashboardMeta('wallet', item.id, item.id, item.status || 'active', {
      wallet: item,
      owner: customerDetail(customerUser)
    }, ['view', 'export'])]);
    const notificationRows = (state.notifications || []).filter(note => !note.ownerType || note.ownerType === 'customer' || note.audience === 'customers').slice(0, 12).map(note => [note.title || note.subject || note.id, note.type || note.channel || (Array.isArray(note.channels) ? note.channels.join(', ') : 'Notification'), note.message || note.body || '', dateValue(note.createdAt || note.updatedAt || new Date()), note.status || note.deliveryStatus || 'Unread', dashboardMeta('notification', note.id, note.title || note.subject, note.status, notificationDetail(note), ['view', 'mark_read', 'export'])]);
    const currentTicket = activeBookings[0] || bookings[0] || {};
    const totalSpend = bookings.reduce((total, booking) => total + Number(booking.pricing?.total || 0), 0);
    const refundsTotal = refundRows.reduce((total, row) => total + Number(String(row[3]).replace(/[^0-9.-]/g, '') || 0), 0);
    return {
      overviewStats: [{
        label: 'Active booking',
        value: activeBookings[0]?.bookingRef || 'None',
        icon: 'fa-ticket',
        hint: activeBookings.length ? 'Ready' : 'No active ticket'
      }, {
        label: 'Upcoming trips',
        value: String(activeBookings.length),
        icon: 'fa-calendar-days',
        hint: 'Customer scoped'
      }, {
        label: 'Past bookings',
        value: String(pastBookings.length),
        icon: 'fa-clock-rotate-left',
        hint: 'Completed travel'
      }, {
        label: 'Wallet balance',
        value: formatMoney(wallet.availableBalance || 0, wallet.currency || platformCurrency()),
        icon: 'fa-wallet',
        hint: wallet.currency || platformCurrency()
      }, {
        label: 'Refunds tracked',
        value: formatMoney(refundsTotal || 0, wallet.currency || platformCurrency()),
        icon: 'fa-rotate-left',
        hint: `${refundRows.length} requests`
      }, {
        label: 'Support cases',
        value: String(supportRows.length),
        icon: 'fa-headset',
        hint: supportRows.filter(row => !/resolved|closed/i.test(row[4])).length + ' open'
      }, {
        label: 'Reviews',
        value: String(reviewRows.filter(row => row[5] === 'Submitted').length),
        icon: 'fa-star',
        hint: 'Submitted'
      }, {
        label: 'Total spend',
        value: formatMoney(totalSpend, wallet.currency || platformCurrency()),
        icon: 'fa-coins',
        hint: 'All bookings'
      }],
      liveActivity: currentTicket.bookingRef ? [['Service', bookingTitle(currentTicket)], ['Departure', dateValue(currentTicket.travelDate || currentTicket.departAt || currentTicket.createdAt)], [currentTicket.serviceType === 'bus' ? 'Seat' : 'Seat / room', (currentTicket.passengers || []).map(pax => currentTicket.serviceType === 'bus' ? displaySeatNo(pax.seatOrRoom || pax.seatNumber) : pax.seatOrRoom || pax.seatNumber).filter(Boolean).join(', ') || 'Assigned at check-in'], ['Booking', currentTicket.bookingRef]] : [],
      profile: {
        fullName: customerUser.fullName || bookingCustomer(currentTicket),
        email: customerUser.email || currentTicket.guestSnapshot?.email || '',
        phone: customerUser.phone || currentTicket.guestSnapshot?.phone || '',
        city: customerUser.city || '',
        status: customerUser.status || 'active',
        createdAt: customerUser.createdAt || '',
        passengerNote: customerUser.passengerNote || `${bookingCustomer(currentTicket)} • ${currentTicket.guestSnapshot?.phone || customerUser.phone || 'No phone'} • ${currentTicket.guestSnapshot?.email || customerUser.email || 'No email'}`,
        preferences: {
          preferredSeat: customerUser.preferredSeat || '',
          defaultCurrency: wallet.currency || platformCurrency(),
          notifications: customerUser.notificationPreferences ? 'Configured' : 'Not configured',
          receiptEmail: customerUser.email ? 'Enabled' : 'Add email'
        }
      },
      currentTicket: currentTicket.bookingRef ? bookingDetail(currentTicket) : null,
      bookings: bookingRows,
      saved: savedRows,
      receipts: receiptRows,
      refunds: refundRows,
      support: supportRows,
      reviews: reviewRows,
      wallet: walletRows.length ? walletRows : fallbackWalletRows,
      notifications: notificationRows,
      options: {
        bookings: bookings.map(booking => ({
          id: booking.bookingRef,
          value: booking.bookingRef,
          label: `${booking.bookingRef} - ${bookingTitle(booking)} (${booking.bookingStatus || 'booking'})`,
          listingId: booking.listingId,
          scheduleId: booking.scheduleId || booking.bookingItems?.[0]?.scheduleId || '',
          serviceType: booking.serviceType,
          status: booking.bookingStatus
        })),
        reviewableBookings: bookings.filter(booking => ['checked_in', 'checked_out', 'completed'].includes(normalize(booking.bookingStatus))).map(booking => ({
          id: booking.bookingRef,
          value: booking.bookingRef,
          label: `${booking.bookingRef} - ${bookingTitle(booking)}`,
          listingId: booking.listingId,
          serviceType: booking.serviceType,
          status: booking.bookingStatus
        })),
        reschedulableBookings: bookings.filter(booking => ['confirmed', 'ticketed', 'pending_payment'].includes(normalize(booking.bookingStatus))).map(booking => ({
          id: booking.bookingRef,
          value: booking.bookingRef,
          label: `${booking.bookingRef} - ${bookingTitle(booking)}`,
          listingId: booking.listingId,
          scheduleId: booking.scheduleId || booking.bookingItems?.[0]?.scheduleId || '',
          serviceType: booking.serviceType,
          status: booking.bookingStatus
        }))
      },
      security: [['Current session', 'Dashboard browser', dateValue(new Date()), 'Current', dashboardMeta('security_session', 'current-session', 'Current session', 'Current', {
        session: {
          device: 'Dashboard browser',
          location: 'Current location',
          current: true
        },
        customer: customerDetail(customerUser)
      }, ['view'])], ['Password', 'Account credentials', customerUser.passwordChangedAt ? dateValue(customerUser.passwordChangedAt) : 'Not recorded', 'Change available', dashboardMeta('security_password', 'password', 'Password', 'Change available', {
        security: {
          passwordChangeForm: 'Available from customer security panel',
          twoFactorEnabled: Boolean(customerUser.twoFactorEnabled)
        },
        customer: customerDetail(customerUser)
      }, ['view'])], ['Email verification', customerUser.email || 'No email', customerUser.emailVerifiedAt ? dateValue(customerUser.emailVerifiedAt) : 'Pending', customerUser.emailVerifiedAt ? 'Verified' : 'Recommended', dashboardMeta('security_email', 'email', 'Email verification', customerUser.emailVerifiedAt ? 'Verified' : 'Recommended', {
        security: {
          email: customerUser.email,
          verifiedAt: customerUser.emailVerifiedAt || ''
        }
      }, ['view'])]]
    };
  }
  function promoterDashboardData(links, bookings, promoterId) {
    // Never fall back to "any promoter in the store" - see customerDashboardData for the same fix.
    const promoterUser = state.users.find(user => user.id === promoterId) || {};
    const promoter = promoterDetail(promoterUser) || {};
    const wallet = state.wallets.find(item => item.ownerType === 'promoter' && item.ownerId === promoterId) || {};
    const shareListings = state.listings.filter(listing => listing.bookable || listing.isSponsored).slice(0, 12);
    const promoterListingIds = new Set(shareListings.map(listing => String(listing.id || '')));
    const promoterSchedules = (state.schedules || []).filter(schedule => promoterListingIds.has(String(schedule.listingId || '')) && !['archived', 'cancelled', 'draft'].includes(normalize(schedule.status)));
    const promoterScheduleIds = new Set(promoterSchedules.map(schedule => String(schedule.id || '')));
    const promoterRoutes = (state.routes || []).filter(route => promoterListingIds.has(String(route.listingId || '')) && normalize(route.status) !== 'archived');
    const promoterRouteIds = new Set(promoterRoutes.map(route => String(route.id || '')));
    const promoterRouteStops = (state.routeStops || []).filter(stop => promoterRouteIds.has(String(stop.routeId || '')) && normalize(stop.status) !== 'archived');
    const promoterRoomTypes = (state.roomTypes || []).filter(roomType => promoterListingIds.has(String(roomType.listingId || '')) && normalize(roomType.status) === 'active');
    const promoterRatePlans = (state.ratePlans || []).filter(plan => promoterListingIds.has(String(plan.listingId || '')) && normalize(plan.status) === 'active');
    const promoterRoomUnits = (state.roomUnits || []).filter(unit => promoterListingIds.has(String(unit.listingId || '')) && !['archived', 'maintenance'].includes(normalize(unit.status)));
    const promoterRoomNights = (state.roomNightInventories || []).filter(night => promoterListingIds.has(String(night.listingId || '')) && ['available', 'open'].includes(normalize(night.status)) && !night.bookingRef);
    const promoterAddons = (state.serviceAddons || []).filter(addon => promoterListingIds.has(String(addon.listingId || '')) && normalize(addon.status) === 'active');
    const allClicks = links.reduce((total, link) => total + Number(link.clicks || 0), 0);
    const allConversions = links.reduce((total, link) => total + Number(link.conversions || 0), 0);
    const paidBookings = bookings.filter(booking => ['successful', 'paid', 'completed'].includes(normalize(booking.paymentStatus)));
    const cancelledRefundedBookings = bookings.filter(booking => /cancel|refund/.test(normalize(booking.bookingStatus)) || /refund/.test(normalize(booking.paymentStatus)));
    const grossRevenueBreakdown = formatMoneyBreakdown(sumByCurrency(bookings, booking => booking.pricing?.total, booking => booking.pricing?.currency));
    const commissionEarnedBreakdown = formatMoneyBreakdown(sumByCurrency(bookings, booking => booking.pricing?.split?.promoterAmount, booking => booking.pricing?.currency));
    const withdrawalTransactions = state.walletTransactions.filter(txn => txn.ownerType === 'promoter' && (!txn.ownerId || txn.ownerId === promoterId));
    const paidWithdrawals = withdrawalTransactions.filter(txn => ['paid', 'completed', 'released'].includes(normalize(txn.status))).reduce((total, txn) => total + Number(txn.amount || 0), 0);
    const pendingWithdrawals = withdrawalTransactions.filter(txn => !['paid', 'completed', 'released'].includes(normalize(txn.status))).reduce((total, txn) => total + Number(txn.amount || 0), 0);
    const mainLink = links[0] || {};
    const linkDetail = (link = {}) => {
      const listing = findListing(link.listingId) || {};
      const company = findCompany(listing.companyId) || {};
      const referralBookings = bookings.filter(booking => booking.promoterAttribution?.linkId === link.id || normalize(booking.promoterAttribution?.code) === normalize(link.code));
      const conversionRate = Number(link.clicks || 0) ? `${Math.round(Number(link.conversions || 0) / Number(link.clicks || 0) * 1000) / 10}%` : '0%';
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
          status: link.status || 'active'
        },
        listing: listingDetail(listing)?.listing || {
          listingId: link.listingId
        },
        service: listingDetail(listing)?.service || {},
        company: {
          companyId: company.id || listing.companyId || '',
          name: company.name || listing.partner || '',
          slug: company.slug || '',
          phone: company.phone || company.supportContacts?.phone || ''
        },
        finance: {
          referredBookings: referralBookings.length,
          grossReferredRevenue: formatMoneyBreakdown(sumByCurrency(referralBookings, booking => booking.pricing?.total, booking => booking.pricing?.currency || company.operatingCurrency)),
          commissionEarned: formatMoneyBreakdown(sumByCurrency(referralBookings, booking => booking.pricing?.split?.promoterAmount, booking => booking.pricing?.currency || company.operatingCurrency))
        },
        promoter: promoter.promoter,
        timestamps: {
          createdAt: link.createdAt,
          updatedAt: link.updatedAt
        }
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
          qrCodePayload: referralUrl
        },
        company: {
          companyId: company.id || listing.companyId || '',
          name: company.name || listing.partner || '',
          email: company.email || company.supportContacts?.email || '',
          phone: company.phone || company.supportContacts?.phone || ''
        }
      };
    };
    const commissionDetail = (booking = {}, index = 0) => {
      const commission = state.commissions.find(item => item.bookingId === booking.id && item.promoterId === promoterId) || {};
      const detail = bookingDetail(booking) || {};
      return {
        commission: {
          commissionId: commission.id || booking.commissionId || booking.id || booking.bookingRef,
          bookingId: booking.id,
          bookingRef: booking.bookingRef,
          referralCode: booking.promoterAttribution?.code || mainLink.code || '',
          referralPercent: booking.pricing?.split?.promoterPercent || '0%',
          grossAmount: formatMoney(booking.pricing?.total || 0, booking.pricing?.currency),
          commissionAmount: formatMoney(booking.pricing?.split?.promoterAmount || 0, booking.pricing?.currency),
          commissionStatus: commission.status || (['successful', 'paid'].includes(normalize(booking.paymentStatus)) ? 'earned' : 'pending'),
          settlementStatus: booking.settlementStatus || commission.settlementStatus || 'pending',
          paidAt: commission.paidAt || ''
        },
        booking: detail.booking,
        customer: detail.customer,
        company: detail.company,
        service: detail.service,
        payment: detail.payment,
        split: detail.split,
        timestamps: {
          createdAt: commission.createdAt || booking.createdAt,
          updatedAt: commission.updatedAt || booking.updatedAt
        }
      };
    };
    const withdrawalDetail = (row = {}, fallbackWallet = null) => ({
      withdrawal: {
        transactionId: row.id || fallbackWallet?.id || '',
        type: row.transactionType || row.type || 'Promoter withdrawal',
        method: row.method || promoterUser.payoutAccount?.method || 'Mobile Money',
        account: row.account || promoterUser.payoutAccount?.account || promoterUser.phone || '',
        amount: formatMoney(row.amount ?? fallbackWallet?.availableBalance ?? 0, row.currency || fallbackWallet?.currency || platformCurrency()),
        currency: row.currency || fallbackWallet?.currency || platformCurrency(),
        status: row.status || (fallbackWallet?.pendingBalance > 0 ? 'pending' : 'available'),
        reference: row.reference || row.referenceId || '',
        createdAt: row.createdAt || '',
        reviewedAt: row.reviewedAt || ''
      },
      promoter: promoter.promoter,
      wallet: promoter.wallet,
      payoutAccount: promoterUser.payoutAccount || {
        method: 'Not configured',
        account: promoterUser.phone || ''
      }
    });
    const supportRows = state.supportTickets.filter(ticket => ticket.ownerType === 'promoter' && (!ticket.ownerId || ticket.ownerId === promoterId));
    const trafficRows = [['Cancelled referred bookings', 'All referral links', String(cancelledRefundedBookings.length), cancelledRefundedBookings.length > 2 ? 'Medium' : 'Low', cancelledRefundedBookings.length ? 'Review' : 'Approved', dashboardMeta('traffic_quality', 'cancelled-referred', 'Cancelled referred bookings', cancelledRefundedBookings.length ? 'Review' : 'Approved', {
      traffic: {
        cancelledOrRefunded: cancelledRefundedBookings.length,
        bookingRefs: cancelledRefundedBookings.map(booking => booking.bookingRef),
        risk: cancelledRefundedBookings.length > 2 ? 'medium' : 'low'
      },
      promoter: promoter.promoter
    }, ['view', 'export'])], ['Failed payments', 'Referral bookings', String(bookings.filter(booking => !['successful', 'paid', 'completed'].includes(normalize(booking.paymentStatus))).length), 'Low', 'Approved', dashboardMeta('traffic_quality', 'failed-payments', 'Failed payments', 'Approved', {
      traffic: {
        failedPayments: bookings.filter(booking => !['successful', 'paid', 'completed'].includes(normalize(booking.paymentStatus))).map(booking => booking.bookingRef),
        reason: 'Track failed referrals for quality review'
      },
      promoter: promoter.promoter
    }, ['view', 'export'])], ['Duplicate customer contacts', 'Referral records', String(new Set(bookings.map(booking => normalize(booking.guestSnapshot?.phone || booking.guestSnapshot?.email))).size), 'Low', 'Approved', dashboardMeta('traffic_quality', 'duplicate-contacts', 'Duplicate customer contacts', 'Approved', {
      traffic: {
        uniqueContacts: new Set(bookings.map(booking => normalize(booking.guestSnapshot?.phone || booking.guestSnapshot?.email))).size,
        totalBookings: bookings.length
      },
      promoter: promoter.promoter
    }, ['view', 'export'])], ['Cancellation rate', 'All sources', bookings.length ? `${Math.round(cancelledRefundedBookings.length / bookings.length * 100)}%` : '0%', cancelledRefundedBookings.length > 2 ? 'Medium' : 'Low', cancelledRefundedBookings.length > 2 ? 'Review' : 'Approved', dashboardMeta('traffic_quality', 'cancellation-rate', 'Cancellation rate', cancelledRefundedBookings.length > 2 ? 'Review' : 'Approved', {
      traffic: {
        totalBookings: bookings.length,
        cancelledOrRefunded: cancelledRefundedBookings.length,
        rate: bookings.length ? `${Math.round(cancelledRefundedBookings.length / bookings.length * 100)}%` : '0%'
      },
      promoter: promoter.promoter
    }, ['view', 'export'])]];
    const promoterOfflineSales = (state.offlineSales || []).filter(sale => sale.agentId === promoterId);
    const offlineSaleRows = promoterOfflineSales.map(sale => [sale.saleRef || sale.id, sale.bookingRef || '-', sale.customerName || sale.passengerName || '-', findListing(sale.listingId)?.title || sale.listingId || '-', sale.paymentMethod || '-', formatMoney(sale.amountCollected || 0, sale.currency || platformCurrency()), sale.status || 'completed', dashboardMeta('agent_sale', sale.id, sale.saleRef || sale.id, sale.status || 'completed', {
      sale,
      booking: sale.bookingRef ? bookingDetail(findBooking(sale.bookingRef)) : null
    }, ['view', 'booking', 'receipt', 'export'])]);
    const promoterReferralClickRows = (state.referralClicks || []).filter(click => click.promoterId === promoterId).map(click => [click.id, click.code || '-', promoterUser.fullName || promoterId, findListing(click.listingId)?.title || click.listingId || '-', click.ip || '-', click.createdAt ? dateValue(click.createdAt) : '-', dashboardMeta('referral_click', click.id, click.code || click.id, 'tracked', {
      click,
      promoter: promoter.promoter
    }, ['view', 'export'])]);
    const promoterAttributionRows = (state.attributionSessions || []).filter(session => session.promoterId === promoterId).map(session => [session.id, session.referralCode || '-', promoterUser.fullName || promoterId, findListing(session.listingId)?.title || session.listingId || '-', session.status || 'active', session.bookingRef || '-', session.createdAt ? dateValue(session.createdAt) : '-', dashboardMeta('attribution_session', session.id, session.referralCode || session.id, session.status || 'active', {
      session,
      promoter: promoter.promoter
    }, ['view', 'export'])]);
    const promoterConversionRows = (state.campaignConversions || []).filter(conversion => conversion.promoterId === promoterId).map(conversion => [conversion.id, conversion.campaignId || conversion.linkId || '-', promoterUser.fullName || promoterId, conversion.bookingRef || '-', formatMoney(conversion.amount || 0, conversion.currency || platformCurrency()), formatMoney(conversion.commissionAmount || 0, conversion.currency || platformCurrency()), conversion.status || 'converted', dashboardMeta('campaign_conversion', conversion.id, conversion.bookingRef || conversion.id, conversion.status || 'converted', {
      conversion,
      booking: conversion.bookingRef ? bookingDetail(findBooking(conversion.bookingRef)) : null
    }, ['view', 'booking', 'export'])]);
    const promoterReferralCardRows = links.map(link => [link.id, promoterUser.fullName || promoterId, link.code || link.referralCode || '-', findListing(link.listingId)?.title || link.listingId || '-', link.qrCardUrl || `/promoter/links/${link.id}/qr-card`, link.status || 'active', dashboardMeta('referral_card', link.id, link.code || link.id, link.status || 'active', {
      link,
      promoter: promoter.promoter
    }, ['view', 'qr', 'export'])]);
    const promoterFraudSignalRows = (state.fraudSignals || []).filter(signal => signal.promoterId === promoterId || signal.agentId === promoterId).map(signal => [signal.id, promoterUser.fullName || promoterId, signal.bookingRef || '-', signal.signalType || 'booking_risk', signal.severity || '-', String(signal.score || 0), signal.status || 'open', dashboardMeta('fraud_signal', signal.id, signal.bookingRef || signal.id, signal.status || 'open', {
      signal,
      booking: signal.bookingRef ? bookingDetail(findBooking(signal.bookingRef)) : null
    }, ['view', 'booking', 'export'])]);
    const promoterNotificationRows = (state.notifications || [])
      .filter(note => !note.ownerType || note.ownerType === 'promoter' || note.audience === 'promoter' || note.promoterId === promoterId || note.userId === promoterId)
      .slice(0, 12)
      .map(note => [
        note.title || note.subject || note.id,
        note.type || note.channel || (Array.isArray(note.channels) ? note.channels.join(', ') : 'Notification'),
        note.message || note.body || '',
        dateValue(note.createdAt || note.updatedAt || new Date()),
        note.status || note.deliveryStatus || 'Unread',
        dashboardMeta('notification', note.id, note.title || note.subject, note.status, notificationDetail(note), ['view', 'mark_read', 'export']),
      ]);
    return {
      profile: {
        ...(promoter.promoter || {}),
        payoutAccount: promoterUser.payoutAccount || {
          method: 'Not configured',
          account: promoterUser.phone || ''
        },
        mainReferralCode: mainLink.code || promoterUser.referralCode || '',
        mainReferralUrl: mainLink.url || `/marketplace?ref=${encodeURIComponent(promoterUser.referralCode || '')}`,
        verificationStatus: promoterUser.verificationStatus || promoterUser.status || 'pending'
      },
      overviewStats: [{
        label: 'Referral code',
        value: mainLink.code || promoterUser.referralCode || '-',
        icon: 'fa-link',
        hint: 'Primary tracking code'
      }, {
        label: 'Total bookings',
        value: String(bookings.length),
        icon: 'fa-ticket',
        hint: `${paidBookings.length} confirmed / ${cancelledRefundedBookings.length} cancelled-refunded`
      }, {
        label: 'Gross referred revenue',
        value: grossRevenueBreakdown,
        icon: 'fa-chart-line',
        hint: 'Total ticket value from referrals'
      }, {
        label: 'Commission earned',
        value: commissionEarnedBreakdown,
        icon: 'fa-coins',
        hint: 'Promoter commission from referred bookings'
      }],
      liveActivity: [['Withdrawable', formatMoney(wallet.availableBalance || 0, wallet.currency || platformCurrency())], ['Pending withdrawals', formatMoney(pendingWithdrawals || wallet.pendingBalance || 0, wallet.currency || platformCurrency())], ['Paid withdrawals', formatMoney(paidWithdrawals, wallet.currency || platformCurrency())], ['Conversion rate', allClicks ? `${Math.round(allConversions / allClicks * 100)}%` : '0%']],
      links: links.map(link => {
        const listing = findListing(link.listingId) || {};
        const detail = linkDetail(link);
        return [link.code, listing.title || 'Listing', listing.type || listing.serviceType || 'Service', String(link.clicks || 0), String(link.conversions || 0), link.status || 'Active', dashboardMeta('referral_link', link.id, link.code, link.status || 'active', detail, ['view', 'copy', 'share', 'export'])];
      }),
      share: shareListings.map(listing => {
        const detail = shareDetail(listing);
        const company = findCompany(listing.companyId) || {};
        return [listing.title, listing.type || listing.serviceType, company.name || listing.partner, listing.to ? formatRouteLabel(listing.from || listing.city || '', listing.to) : (listing.from || listing.city || ''), formatMoney(listingFareFrom(listing).amount, listingFareFrom(listing).currency), listing.isSponsored ? 'Promotion' : listing.bookable ? 'Available' : 'Review', dashboardMeta('share_listing', listing.id, listing.title, listing.isSponsored ? 'promotion' : 'available', detail, ['view', 'copy', 'share', 'export'])];
      }),
      commissions: bookings.map((booking, index) => {
        const detail = commissionDetail(booking, index);
        const status = detail.commission.commissionStatus === 'released' ? 'Earned' : detail.commission.commissionStatus === 'hold' ? 'Hold' : detail.commission.commissionStatus;
        return [detail.commission.commissionId, booking.bookingRef, detail.commission.grossAmount, detail.commission.referralPercent, detail.commission.commissionAmount, status, dashboardMeta('commission', detail.commission.commissionId, detail.commission.commissionId, status, detail, ['view', 'booking', 'export'])];
      }),
      withdrawals: withdrawalTransactions.length ? withdrawalTransactions.map(txn => [txn.id, txn.transactionType || 'Withdrawal', txn.account || promoterUser.phone || promoterId, dateValue(txn.createdAt), formatMoney(txn.amount, txn.currency), txn.status, dashboardMeta('withdrawal', txn.id, txn.id, txn.status, withdrawalDetail(txn), ['view', 'export'])]) : [[wallet.id || 'promoter-wallet', 'available_balance', promoterId, 'Current', formatMoney(wallet.availableBalance || 0, wallet.currency || platformCurrency()), wallet.pendingBalance > 0 ? 'Pending payout' : 'Available', dashboardMeta('withdrawal', wallet.id || 'promoter-wallet', wallet.id || 'promoter-wallet', wallet.pendingBalance > 0 ? 'pending' : 'available', withdrawalDetail({}, wallet), ['view', 'export'])]],
      bookings: bookings.map(booking => {
        const detail = bookingDetail(booking) || {};
        return [booking.bookingRef, bookingTitle(booking), bookingCustomer(booking), bookingTotal(booking), formatMoney(booking.pricing?.split?.promoterAmount || 0, booking.pricing?.currency), booking.paymentStatus, dashboardMeta('referral_booking', booking.id, booking.bookingRef, booking.paymentStatus, detail, ['view', 'copy', 'export'])];
      }),
      campaigns: state.promotionCampaigns.map(campaign => {
        const detail = campaignDetail(campaign);
        const relatedLinks = links.filter(link => link.listingId === campaign.listingId).length;
        return [campaign.name || campaign.title, campaign.placement || campaign.type, String(relatedLinks), String(campaign.clicks || 0), String(campaign.bookings || campaign.conversions || 0), formatMoney(campaign.budget || 0), campaign.status, dashboardMeta('campaign', campaign.id, campaign.name || campaign.title, campaign.status, detail, ['view', 'export'])];
      }),
      payouts: [[wallet.id || 'promoter-wallet', 'Current balance', wallet.currency || platformCurrency(), formatMoney(wallet.availableBalance || 0, wallet.currency || platformCurrency()), promoterUser.payoutAccount?.method || 'Wallet', wallet.pendingBalance > 0 ? 'Pending' : 'Available', dashboardMeta('payout', wallet.id || 'promoter-wallet', wallet.id || 'promoter-wallet', wallet.pendingBalance > 0 ? 'pending' : 'available', withdrawalDetail({}, wallet), ['view', 'export'])], ...withdrawalTransactions.map(txn => [txn.id, dateValue(txn.createdAt), txn.currency || wallet.currency || platformCurrency(), formatMoney(txn.amount || 0, txn.currency || wallet.currency || platformCurrency()), txn.reference || txn.transactionType || 'Withdrawal', txn.status, dashboardMeta('payout', txn.id, txn.id, txn.status, withdrawalDetail(txn), ['view', 'export'])])],
      fraud: trafficRows,
      offlineSales: offlineSaleRows,
      agentSales: offlineSaleRows,
      options: {
        listings: shareListings.map(listingOption),
        busListings: shareListings.filter(listing => normalize(listing.serviceType) === 'bus').map(listingOption),
        hotelListings: shareListings.filter(listing => normalize(listing.serviceType) === 'hotel').map(listingOption),
        schedules: promoterSchedules.map(scheduleOption),
        routes: promoterRoutes.map(routeOption),
        routeStops: promoterRouteStops.map(routeStopOption),
        seats: (state.seats || []).filter(seat => promoterScheduleIds.has(String(seat.scheduleId || '')) && !['taken', 'booked', 'checked_in', 'checked-in', 'no_show', 'no-show', 'blocked', 'maintenance', 'reserved', 'disabled', 'locked', 'held'].includes(normalize(seat.status))).map(seat => {
          const schedule = promoterSchedules.find(item => String(item.id) === String(seat.scheduleId)) || {};
          return {
            id: `${seat.scheduleId}:${seat.seatNumber || seat.id}`,
            value: seat.seatNumber || seat.id,
            label: `Seat ${seat.seatNumber || seat.id}${seat.seatClass ? ` - ${seat.seatClass}` : ''}`,
            scheduleId: seat.scheduleId,
            listingId: schedule.listingId || seat.listingId || '',
            routeId: schedule.routeId || '',
            status: seat.status || 'available'
          };
        }),
        hotelProperties: (state.hotelProperties || []).filter(property => promoterListingIds.has(String(property.listingId || '')) && normalize(property.status) === 'active').map(property => ({ id: property.id, value: property.id, label: property.propertyName || property.id, listingId: property.listingId, status: property.status })),
        roomTypes: promoterRoomTypes.map(roomType => ({ id: roomType.id, value: roomType.id, label: roomType.name || roomType.id, listingId: roomType.listingId, propertyId: roomType.propertyId, status: roomType.status })),
        ratePlans: promoterRatePlans.map(plan => ({ id: plan.id, value: plan.id, label: plan.name || plan.code || plan.id, listingId: plan.listingId, propertyId: plan.propertyId, roomTypeId: plan.roomTypeId, currency: plan.currency, status: plan.status })),
        roomUnits: promoterRoomUnits.map(unit => ({ id: unit.id, value: unit.id, label: unit.unitNumber || unit.id, listingId: unit.listingId, propertyId: unit.propertyId, roomTypeId: unit.roomTypeId, status: unit.status })),
        roomNights: promoterRoomNights.map(night => ({ id: night.id, value: night.id, label: `${night.roomUnitId || 'Room'} - ${String(night.date || '').slice(0, 10)}`, listingId: night.listingId, propertyId: night.propertyId, roomTypeId: night.roomTypeId, roomUnitId: night.roomUnitId, status: night.status })),
        serviceAddons: promoterAddons,
      },
      referralClicks: promoterReferralClickRows,
      attributionSessions: promoterAttributionRows,
      campaignConversions: promoterConversionRows,
      referralCards: promoterReferralCardRows,
      fraudSignals: promoterFraudSignalRows,
      notifications: promoterNotificationRows,
      support: supportRows.map(ticket => [ticket.id, ticket.subject, ticket.priority, ticket.status, dateValue(ticket.createdAt || ticket.updatedAt), dashboardMeta('support_case', ticket.id, ticket.id, ticket.status, supportDetail(ticket), ['view', 'export'])]),
      performance: {
        bars: Array.from({ length: 7 }, (_, offset) => {
          const day = new Date();
          day.setHours(0, 0, 0, 0);
          day.setDate(day.getDate() - (6 - offset));
          const nextDay = new Date(day);
          nextDay.setDate(nextDay.getDate() + 1);
          const count = bookings.filter((booking) => {
            const createdAt = new Date(booking.createdAt || 0);
            return Number.isFinite(createdAt.getTime()) && createdAt >= day && createdAt < nextDay;
          }).length;
          return [day.toLocaleDateString('en-GB', { weekday: 'short' }), count];
        }),
        bestListings: shareListings.slice(0, 5).map(listing => listing.title),
        bestCompanies: Array.from(new Set(shareListings.map(listing => findCompany(listing.companyId)?.name || listing.partner).filter(Boolean))).slice(0, 5),
        bookingsOverTime: bookings.map(booking => ({
          date: dateValue(booking.createdAt),
          bookingRef: booking.bookingRef,
          amount: booking.pricing?.total || 0,
          commission: booking.pricing?.split?.promoterAmount || 0
        }))
      }
    };
  }
  function recordIdentity(row = {}) {
    return String(row.id ?? row._id ?? row.uuid ?? '').trim();
  }
  function sameRecordId(left, right) {
    const a = typeof left === 'object' && left ? recordIdentity(left) : String(left ?? '').trim();
    const b = typeof right === 'object' && right ? recordIdentity(right) : String(right ?? '').trim();
    return Boolean(a && b && a === b);
  }
  function findListing(identifier, serviceType) {
    const id = normalize(identifier);
    const type = normalize(serviceType || '');
    if (!id) return null;
    return listingByIdentity.get(id)
      || (type ? listingByTitleAndType.get(`${id}::${type}`) : null)
      || listingByTitle.get(id)
      || null;
  }
  function findCompany(slug) {
    return companyByIdentity.get(normalize(slug)) || null;
  }
  function listingsForCompany(companyId) {
    return listingsByCompany.get(String(companyId ?? '').trim()) || [];
  }
  function routesForListing(listingId) {
    return routesByListing.get(String(listingId ?? '').trim()) || [];
  }
  function schedulesForListing(listingId) {
    return schedulesByListing.get(String(listingId ?? '').trim()) || [];
  }
  function roomsForListing(listingId) {
    return roomsByListing.get(String(listingId ?? '').trim()) || [];
  }
  function seatsForSchedule(scheduleId) {
    return seatsBySchedule.get(String(scheduleId ?? '').trim()) || [];
  }
  function findBooking(ref) {
    const key = normalize(ref);
    return key ? (bookingByIdentity.get(key) || null) : null;
  }
  function bookingDetail(booking = {}) {
    if (!booking) return null;
    const listing = findListing(booking.listingId) || {};
    const company = findCompany(booking.companyId) || {};
    const schedule = scheduleById.get(normalize(booking.scheduleId)) || {};
    const vehicle = vehicleById.get(normalize(schedule.vehicleId || booking.vehicleId)) || {};
    const payment = paymentByBookingIdentity.get(normalize(booking.bookingRef)) || paymentByBookingIdentity.get(normalize(booking.id)) || {};
    const promoter = booking.promoterAttribution?.promoterId ? userById.get(normalize(booking.promoterAttribution.promoterId)) : null;
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
        seats: (booking.passengers || []).map(pax => pax.seatOrRoom || pax.seatNumber).filter(Boolean),
        bookingItems: booking.bookingItems || [],
        bookingLegs: booking.bookingLegs || [],
        ticketLegs: booking.ticketLegs || [],
        hotelStay: booking.hotelStay || null,
        tripType: booking.tripType || 'one_way',
        notes: booking.notes || booking.customerNote || '',
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt,
        cancelledAt: booking.cancelledAt,
        cancelReason: booking.cancelReason || booking.cancellationReason,
        completedAt: booking.completedAt
      },
      customer: {
        userId: booking.customerUserId || '',
        type: booking.customerUserId ? 'Registered customer' : 'Guest customer',
        name: booking.buyerSnapshot?.fullName || booking.guestSnapshot?.fullName || booking.passengers?.[0]?.fullName || 'Guest customer',
        email: booking.buyerSnapshot?.email || booking.guestSnapshot?.email || '',
        phone: booking.buyerSnapshot?.phone || booking.guestSnapshot?.phone || '',
        idType: booking.buyerSnapshot?.idType || '',
        documentNumber: booking.buyerSnapshot?.documentNumber || '',
        notes: booking.buyerSnapshot?.notes || booking.notes || ''
      },
      company: {
        id: company.id || booking.companyId,
        name: company.name || 'Company partner',
        slug: company.slug || '',
        email: company.email || company.supportEmail || '',
        phone: company.phone || company.supportPhone || '',
        status: company.status || company.verificationStatus || ''
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
        arrival: schedule.arriveAt || listing.arrival || ''
      },
      payment: {
        id: payment.id || booking.paymentRef || '',
        provider: payment.provider || booking.paymentProvider || 'Classic Trip Payments',
        reference: payment.providerReference || booking.paymentRef || '',
        amount: payment.amount || booking.pricing?.total || 0,
        currency: payment.currency || booking.pricing?.currency || platformCurrency(),
        status: payment.status || booking.paymentStatus || '',
        paidAt: payment.paidAt || booking.paidAt || '',
        failureReason: payment.failureReason || '',
        checkoutUrl: payment.checkoutUrl || ''
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
        currency: booking.pricing?.currency || platformCurrency(),
        settlementStatus: booking.settlementStatus || 'pending'
      },
      checkIn: {
        status: booking.checkInStatus || (booking.bookingStatus === 'checked_in' ? 'checked_in' : 'not_checked'),
        checkedInAt: booking.checkedInAt || '',
        checkedInBy: booking.checkedInBy || booking.checkedInByUserId || '',
        note: booking.checkInNote || '',
        noShowAt: booking.noShowAt || '',
        noShowBy: booking.noShowBy || ''
      }
    };
  }
  function dashboardMeta(entity, id, label, status, detail = {}, actions = []) {
    return {
      entity,
      id: id || label || entity,
      label: label || id || entity,
      status: status || '',
      detail,
      actions
    };
  }
  function companyDetail(company = {}) {
    if (!company) return null;
    const listings = listingsForCompany(company.id || '');
    const companyBookings = state.bookings.filter(booking => booking.companyId === company.id);
    const grossRevenue = companyBookings.reduce((total, booking) => total + Number(booking.pricing?.total || 0), 0);
    const ownerEarnings = companyBookings.reduce((total, booking) => total + Number(booking.pricing?.split?.companyAmount || 0), 0);
    const pendingPayout = state.wallets.find(wallet => wallet.ownerType === 'company' && wallet.ownerId === company.id)?.pendingBalance || 0;
    const adminUser = state.users.find(user => user.companyId === company.id && ['company_admin', 'partner'].includes(user.role)) || {};
    return {
      main: {
        companyId: company.id,
        name: company.name,
        slug: company.slug,
        businessType: company.companyType || company.type,
        partnerCategory: company.partnerCategory || company.settings?.partnerCategory || '',
        accountModel: company.accountModel || company.settings?.accountModel || '',
        capabilityPolicy: company.capabilityPolicy || {},
        status: company.status || company.verificationStatus,
        verificationStatus: company.verificationStatus,
        country: company.country,
        city: company.city,
        currency: company.settings?.defaultCurrency || company.currency || platformCurrency()
      },
      admin: {
        userId: adminUser.id || company.adminUserId || '',
        name: adminUser.fullName || company.adminName || '',
        email: adminUser.email || company.email || company.supportContacts?.email || '',
        phone: adminUser.phone || company.phone || company.supportContacts?.phone || '',
        role: adminUser.role || 'company_admin'
      },
      contact: {
        supportEmail: company.supportContacts?.email || company.email || '',
        supportPhone: company.supportContacts?.phone || company.phone || '',
        whatsapp: company.supportContacts?.whatsapp || '',
        supportMessage: company.settings?.supportMessage || company.supportMessage || ''
      },
      onboarding: {
        source: company.onboardingSource || 'dashboard',
        invitedBy: company.invitedBy || '',
        invitedAt: company.invitedAt || '',
        onboardedAt: company.onboardedAt || company.createdAt || '',
        reviewedBy: company.reviewedBy || '',
        reviewedAt: company.reviewedAt || '',
        reviewNotes: company.reviewNotes || ''
      },
      performance: {
        totalListings: listings.length,
        activeListings: listings.filter(listing => listing.status === 'active').length,
        totalBookings: companyBookings.length,
        confirmedBookings: companyBookings.filter(booking => ['confirmed', 'checked_in', 'completed'].includes(booking.bookingStatus)).length,
        revenue: formatMoney(grossRevenue),
        ownerEarnings: formatMoney(ownerEarnings),
        pendingPayout: formatMoney(pendingPayout)
      },
      commercialTerms: {
        model: company.commercialTerms?.model || 'percentage_commission',
        commissionPercent: Number(company.commercialTerms?.commissionPercent ?? cachedPlatformConfig.partnerCommissionPercent ?? 0),
        partnerPayoutPercent: Math.max(0, 100 - Number(company.commercialTerms?.commissionPercent ?? cachedPlatformConfig.partnerCommissionPercent ?? 0)),
        promoterFunding: company.commercialTerms?.promoterFunding || 'platform_commission',
        termsVersion: company.commercialTerms?.termsVersion || cachedPlatformConfig.commercialTermsVersion || 'commission-v1',
        source: company.commercialTerms?.source || 'platform_default',
        acceptedAt: company.commercialTerms?.acceptedAt || '',
        acceptedBy: company.commercialTerms?.acceptedBy || '',
        updatedAt: company.commercialTerms?.updatedAt || '',
        updatedBy: company.commercialTerms?.updatedBy || ''
      },
      payout: {
        payoutAccount: company.payoutAccount || company.settings?.payoutAccount || '',
        walletId: company.walletId || ''
      },
      media: {
        logo: company.logo || null,
        coverImage: company.coverImage || null,
        documents: Array.isArray(company.documents) ? company.documents : [],
        canPublish: company.settings?.canPublish !== false
      },
      timestamps: {
        createdAt: company.createdAt,
        updatedAt: company.updatedAt
      }
    };
  }
  function listingDetail(listing = {}) {
    if (!listing) return null;
    const listingId = recordIdentity(listing);
    const company = findCompany(listing.companyId) || {};
    const routes = routesForListing(listingId);
    const schedules = schedulesForListing(listingId);
    const rooms = roomsForListing(listingId);
    const scheduleSeats = schedules.flatMap(schedule => seatsForSchedule(schedule.id));
    const bookedSeats = scheduleSeats.filter(seat => seat.status === 'taken').length;
    const heldSeats = scheduleSeats.filter(seat => seat.status === 'locked').length;
    const totalSeats = scheduleSeats.length || schedules.reduce((total, schedule) => total + Number(schedule.totalSeats || 0), 0);
    return {
      listing: {
        catalogId: listing.catalogId || listingId,
        listingId,
        slug: listing.slug,
        title: listing.title,
        sub: listing.sub || listing.description || '',
        serviceType: listing.serviceType,
        type: listing.type,
        status: listing.status,
        releaseStatus: listing.releaseStatus || '',
        isSponsored: Boolean(listing.isSponsored),
        bookable: Boolean(listing.bookable)
      },
      owner: {
        companyId: company.id || listing.companyId,
        companyName: company.name || listing.partner,
        tenantSlug: company.slug || listing.tenantSlug || '',
        country: company.country || listing.country,
        currency: listing.currency || company.settings?.defaultCurrency || platformCurrency()
      },
      service: {
        from: listing.from || '',
        to: listing.to || '',
        address: listing.address || listing.location || '',
        city: listing.city || '',
        country: listing.country || '',
        routeDetails: routes.map(route => formatRouteLabel(route.origin, route.destination, route.routeName)).join('; '),
        vehicleDetails: state.vehicles.filter(vehicle => sameRecordId(vehicle.listingId, listingId)).map(vehicle => `${vehicle.name} (${vehicle.plateOrCode || 'no plate'})`).join('; '),
        departure: schedules[0]?.departAt || listing.departure || '',
        arrival: schedules[0]?.arriveAt || listing.arrival || ''
      },
      inventory: {
        basePrice: listing.priceFrom,
        price: formatMoney(listingFareFrom(listing).amount, listingFareFrom(listing).currency),
        currency: listing.currency,
        totalSeats,
        bookedSeats,
        heldSeats,
        remainingSeats: Math.max(0, totalSeats - bookedSeats - heldSeats),
        roomTypes: rooms.length,
        roomInventory: rooms.reduce((total, room) => total + Number(room.inventory || 0), 0),
        schedules: schedules.length
      },
      timestamps: {
        createdAt: listing.createdAt,
        updatedAt: listing.updatedAt
      }
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
        formattedAmount: formatMoney(payment.amount || booking.pricing?.total || 0, payment.currency || booking.pricing?.currency || platformCurrency()),
        currency: payment.currency || booking.pricing?.currency || platformCurrency(),
        status: payment.status || booking.paymentStatus,
        paidAt: payment.paidAt || booking.paidAt || '',
        failureReason: payment.failureReason || '',
        checkoutUrl: payment.checkoutUrl || '',
        methodNote: payment.methodNote || booking.paymentMethodNote || '',
        metadata: payment.rawPayload || payment.metadata || {}
      },
      booking: detail.booking,
      customer: detail.customer,
      company: detail.company,
      split: detail.split,
      timestamps: {
        createdAt: payment.createdAt || booking.createdAt,
        updatedAt: payment.updatedAt || booking.updatedAt
      }
    };
  }
  function promoterDetail(user = {}) {
    const links = state.promoterLinks.filter(link => link.promoterId === user.id);
    const referred = state.bookings.filter(booking => booking.promoterAttribution?.promoterId === user.id);
    const gross = referred.reduce((total, booking) => total + Number(booking.pricing?.total || 0), 0);
    const commission = referred.reduce((total, booking) => total + Number(booking.pricing?.split?.promoterAmount || 0), 0);
    const wallet = state.wallets.find(item => item.ownerType === 'promoter' && item.ownerId === user.id) || {};
    return {
      promoter: {
        userId: user.id,
        name: user.fullName,
        email: user.email,
        phone: user.phone,
        referralCode: links[0]?.code || user.referralCode || '',
        status: user.status || 'active'
      },
      performance: {
        totalReferredBookings: referred.length,
        confirmedReferredBookings: referred.filter(booking => ['confirmed', 'checked_in', 'completed'].includes(booking.bookingStatus)).length,
        cancelledOrRefunded: referred.filter(booking => /cancel|refund/.test(normalize(booking.bookingStatus))).length,
        grossReferredRevenue: formatMoney(gross),
        commissionEarned: formatMoney(commission),
        conversionRate: links.reduce((total, link) => total + Number(link.clicks || 0), 0) ? `${Math.round(links.reduce((total, link) => total + Number(link.conversions || 0), 0) / links.reduce((total, link) => total + Number(link.clicks || 0), 0) * 100)}%` : '0%'
      },
      wallet: {
        availableBalance: formatMoney(wallet.availableBalance || 0, wallet.currency || platformCurrency()),
        pendingBalance: formatMoney(wallet.pendingBalance || 0, wallet.currency || platformCurrency()),
        paidWithdrawals: formatMoney(state.walletTransactions.filter(txn => txn.ownerType === 'promoter' && txn.ownerId === user.id && txn.status === 'paid').reduce((total, txn) => total + Number(txn.amount || 0), 0), wallet.currency || platformCurrency()),
        pendingWithdrawals: formatMoney(state.walletTransactions.filter(txn => txn.ownerType === 'promoter' && txn.ownerId === user.id && txn.status !== 'paid').reduce((total, txn) => total + Number(txn.amount || 0), 0), wallet.currency || platformCurrency())
      },
      recentBookings: referred.slice(0, 5).map(booking => booking.bookingRef),
      timestamps: {
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    };
  }
  function customerDetail(user = {}) {
    const userBookings = state.bookings.filter(booking => booking.customerUserId === user.id || normalize(booking.guestSnapshot?.email) === normalize(user.email) || normalize(booking.guestSnapshot?.phone) === normalize(user.phone));
    const totalSpend = userBookings.reduce((total, booking) => total + Number(booking.pricing?.total || 0), 0);
    const wallet = state.wallets.find(item => item.ownerType === 'customer' && item.ownerId === user.id) || {};
    const lastBooking = userBookings[0] || {};
    return {
      customer: {
        userId: user.id,
        name: user.fullName,
        email: user.email,
        phone: user.phone,
        status: user.status || 'active',
        role: user.role
      },
      bookingSummary: {
        totalBookings: userBookings.length,
        confirmedBookings: userBookings.filter(booking => ['confirmed', 'checked_in', 'completed'].includes(booking.bookingStatus)).length,
        cancelledOrRefunded: userBookings.filter(booking => /cancel|refund/.test(normalize(booking.bookingStatus))).length,
        totalSpend: formatMoney(totalSpend),
        lastBooking: lastBooking.bookingRef || '',
        lastTravelDate: lastBooking.createdAt || '',
        guestBookingsMatched: userBookings.filter(booking => !booking.customerUserId).length
      },
      wallet: {
        balance: formatMoney(wallet.availableBalance || 0, wallet.currency || platformCurrency()),
        walletId: wallet.id || ''
      },
      notes: {
        adminNote: user.adminNote || user.note || ''
      },
      timestamps: {
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
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
        resolutionNotes: ticket.resolutionNotes || ticket.lastResponse || ''
      },
      requester: {
        ownerType: ticket.ownerType,
        ownerId: ticket.ownerId,
        email: ticket.email || '',
        phone: ticket.phone || '',
        audience: ticket.audience || ''
      },
      related: {
        bookingRef: booking?.bookingRef || ticket.bookingRef || '',
        paymentStatus: booking?.paymentStatus || '',
        company: booking ? bookingCompany(booking) : ticket.companyId || ''
      },
      timestamps: {
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        respondedAt: ticket.respondedAt
      }
    };
  }
  function campaignDetail(campaign = {}) {
    const listing = findListing(campaign.listingId) || {};
    const company = findCompany(campaign.companyId) || {};
    return {
      campaign: {
        id: campaign.id,
        promotionId: campaign.id,
        name: campaign.name || campaign.title,
        title: campaign.name || campaign.title,
        placement: campaign.placement || campaign.type,
        type: campaign.placement || campaign.type,
        status: campaign.status,
        startsAt: campaign.startsAt || campaign.startDate,
        endsAt: campaign.endsAt || campaign.endDate,
        startDate: campaign.startsAt || campaign.startDate,
        endDate: campaign.endsAt || campaign.endDate,
        budgetAmount: Number(campaign.budget || 0),
        budget: formatMoney(campaign.budget || 0),
        spend: formatMoney(campaign.spend || 0),
        clicks: campaign.clicks || 0,
        views: campaign.views || 0,
        conversions: campaign.bookings || campaign.conversions || 0
      },
      owner: {
        companyId: company.id || campaign.companyId,
        companyName: company.name || '',
        promoterId: campaign.promoterId || ''
      },
      target: {
        listingId: listing.id || campaign.listingId,
        listingTitle: listing.title || ''
      },
      timestamps: {
        createdAt: campaign.createdAt,
        updatedAt: campaign.updatedAt
      }
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
        amount: formatMoney(refund.amount || detail.payment?.amount || 0, detail.payment?.currency || platformCurrency()),
        status: refund.status,
        requestedAt: refund.createdAt,
        reviewedBy: refund.reviewedBy || '',
        reviewedAt: refund.reviewedAt || '',
        rejectionReason: refund.rejectionReason || ''
      },
      booking: detail.booking,
      customer: detail.customer,
      company: detail.company,
      payment: detail.payment
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
        createdBy: row.createdBy || row.actorId || ''
      },
      timestamps: {
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      }
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
        status: log.status || 'success'
      },
      timestamps: {
        createdAt: log.createdAt,
        updatedAt: log.updatedAt
      }
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
        lastActivity: user.lastLoginAt || user.updatedAt || ''
      },
      timestamps: {
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    };
  }
  return { dashboardData };
}
module.exports = {
  createDashboardProjection
};
