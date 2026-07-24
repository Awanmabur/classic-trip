const { platformCurrency } = require('../../utils/currency');
const commerceRepository = require('../../repositories/domain/commerceRepository');
const { nextId } = require('../data/idService');
const { ENABLED_BOOKING_TYPES } = require('../../config/constants');
const { env } = require('../../config/env');
const generateBookingRef = require('../../utils/generateBookingRef');
const generateCode = require('../../utils/generateCode');
const calculateCommission = require('../../utils/calculateCommission');
const { calculateCustomerFees } = require('../../utils/calculateCustomerFees');
const paymentService = require('../payment/paymentService');
const walletService = require('../wallet/walletService');
const commissionService = require('../commission/commissionService');
const cartAccessService = require('./cartAccessService');
const inventoryHoldService = require('../booking/inventoryHoldService');
const outboxService = require('../shared/outboxService');
const { handlers: outboxHandlers } = require('../shared/outboxHandlers');
const { getPlatformConfig } = require('../platform/platformConfigService');

const RECOVERABLE_STATUSES = ['payment_failed', 'inventory_failed', 'validation_failed'];

function nowIso() { return new Date().toISOString(); }
function addMinutes(minutes) { return new Date(Date.now() + (Number(minutes) || 10) * 60000).toISOString(); }
function clean(value, fallback = '') { return String(value ?? fallback).trim(); }
function money(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function list(value) { return Array.isArray(value) ? value : String(value || '').split(',').map((v) => v.trim()).filter(Boolean); }
function parseMaybeJson(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch (error) { return fallback; }
}
const collectionMap = {
  carts: commerceRepository.carts,
  cartCheckoutAttempts: commerceRepository.checkoutAttempts,
  bookingGroups: commerceRepository.bookingGroups,
  bookings: commerceRepository.bookings,
  payments: commerceRepository.payments,
  auditLogs: commerceRepository.auditLogs,
};
async function upsert(entity, row, options = {}) {
  const collection = collectionMap[entity];
  if (!collection) throw new Error(`Unsupported cart persistence collection: ${entity}`);
  return collection.save(row, null, options);
}
function cartRef() { return generateCode('CART', 8); }
function attemptId() { return generateCode('CARTTRY', 8); }
function publicCart(cart, options = {}) {
  return {
    cartRef: cart.cartRef,
    status: cart.status,
    customer: cart.customer,
    items: cart.items,
    holds: cart.holds,
    coupon: cart.coupon,
    taxes: cart.taxes,
    pricing: cart.pricing,
    validation: cart.validation,
    recoveryState: cart.recoveryState,
    bookingRef: cart.bookingRef,
    bookingGroupRef: cart.bookingGroupRef || '',
    childBookingRefs: cart.childBookingRefs || [],
    paymentRef: cart.paymentRef,
    checkoutUrl: cart.checkoutUrl || '',
    expiresAt: cart.expiresAt,
    ...(options.accessToken ? { accessToken: options.accessToken } : {}),
  };
}
async function findCart(cartRefValue) {
  return cartAccessService.findCart(cartRefValue);
}
async function cartOrThrow(cartRefValue) {
  const cart = await findCart(cartRefValue);
  if (!cart) { const error = new Error('Cart not found'); error.status = 404; throw error; }
  return cart;
}
function customerFromPayload(payload = {}, req = {}) {
  const sessionUser = req?.session?.user || {};
  return {
    fullName: clean(payload.fullName || payload.customerName || sessionUser.fullName || sessionUser.name),
    email: clean(payload.email || sessionUser.email).toLowerCase(),
    phone: clean(payload.phone || sessionUser.phone),
  };
}
async function createCart(payload = {}, req = {}) {
  const platformConfig = await getPlatformConfig();
  const userId = payload.customerUserId || req?.session?.user?.id || null;
  const accessToken = cartAccessService.generateAccessToken();
  const reference = cartRef();
  const cart = {
    id: generateCode('CARTID', 12),
    cartRef: reference,
    status: 'draft',
    userId,
    guestKey: cartAccessService.sha256(accessToken),
    customer: customerFromPayload(payload, req),
    items: [],
    holds: [],
    couponCode: clean(payload.couponCode || payload.coupon || ''),
    coupon: null,
    promoterAttribution: payload.promoterAttribution || (payload.ref ? { code: clean(payload.ref) } : null),
    pricing: { subtotal: 0, fees: 0, addonTotal: 0, total: 0, currency: platformConfig.defaultCurrency, split: calculateCommission(0, false) },
    taxes: [],
    validation: { status: 'draft', messages: ['Cart created. Add services before checkout.'] },
    recoveryState: null,
    expiresAt: addMinutes(platformConfig.holdMinutes),
    createdBy: userId || 'guest',
    createdAt: nowIso(),
  };
  cartAccessService.grantSessionAccess(req, cart.cartRef, accessToken);
  req.cartAccessToken = accessToken;
  await upsert('carts', cart);
  return cart;
}
function normalizeItem(payload = {}) {
  const rawPassengers = parseMaybeJson(payload.passengers || payload.passengerDetails || payload.guests || payload.guestDetails, []);
  const passengers = Array.isArray(rawPassengers) ? rawPassengers : [rawPassengers].filter(Boolean);
  return {
    id: payload.id || `cart-item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    serviceType: clean(payload.serviceType || payload.type || '').toLowerCase(),
    listingId: clean(payload.listingId || payload.slug || ''),
    scheduleId: clean(payload.scheduleId || ''),
    selectedSeats: list(payload.selectedSeats || payload.seatNumbers || payload.seatNumber),
    roomTypeId: clean(payload.roomTypeId || ''),
    roomCount: Math.max(1, Math.round(money(payload.roomCount || payload.rooms, 1))),
    checkIn: clean(payload.checkIn || payload.checkInDate || payload.startDate || ''),
    checkOut: clean(payload.checkOut || payload.checkOutDate || payload.endDate || ''),
    passengers,
    addons: list(payload.addons || payload.addonIds || payload.addon),
    holdId: clean(payload.holdId || ''),
    notes: clean(payload.notes || payload.customerNote || ''),
    status: 'draft',
    addedAt: nowIso(),
  };
}
async function addItem(cartRefValue, payload = {}) {
  const cart = await cartOrThrow(cartRefValue);
  if (!['draft', 'validation_failed', 'inventory_failed', 'payment_failed'].includes(cart.status)) {
    const error = new Error('Cart cannot be changed after checkout has started'); error.status = 409; throw error;
  }
  const item = normalizeItem(payload);
  cart.items.push(item);
  cart.status = 'draft';
  cart.validation = { status: 'pending', messages: ['Cart changed. Revalidate before checkout.'] };
  cart.recoveryState = null;
  cart.updatedAt = nowIso();
  await upsert('carts', cart);
  return validateCart(cart.cartRef, { soft: true });
}
async function listingOrThrow(item) {
  const listing = await commerceRepository.listings.findOne({
    $or: [{ id: item.listingId }, { slug: item.listingId }],
  });
  if (!listing) { const error = new Error(`Listing not found for cart item ${item.id}`); error.status = 404; throw error; }
  if (listing.serviceType !== item.serviceType) { const error = new Error(`Service type mismatch for ${listing.title}`); error.status = 422; throw error; }
  const company = await commerceRepository.companies.findOne({ id: listing.companyId });
  if (listing.status !== 'active' || listing.bookable === false) { const error = new Error(`${listing.title} is not open for checkout`); error.status = 409; throw error; }
  if (!company || company.verificationStatus !== 'verified' || company.status === 'suspended' || company.settings?.canPublish === false) {
    const error = new Error(`${listing.title} provider is not verified for checkout`); error.status = 403; throw error;
  }
  if (!ENABLED_BOOKING_TYPES.includes(listing.serviceType)) {
    const label = FUTURE_SERVICES.includes(listing.serviceType) ? `${listing.serviceType} is coming soon` : 'Service is not checkout-enabled';
    const error = new Error(`${label}; it is visible only as a marketing card until provider integration is enabled.`);
    error.status = 409;
    error.recoveryType = 'coming_soon_service';
    throw error;
  }
  return { listing, company };
}
function passengerList(item, count, customer) {
  const rows = Array.isArray(item.passengers) ? item.passengers : [];
  if (rows.length < count) { const error = new Error(`Passenger/guest details are required for every ${item.serviceType} unit`); error.status = 422; throw error; }
  return rows.slice(0, count).map((row, index) => {
    const fullName = clean(row.fullName || row.name || (index === 0 ? customer.fullName : ''));
    const phone = clean(row.phone || customer.phone);
    const email = clean(row.email || customer.email);
    if (!fullName || !phone || !email) { const error = new Error('Passenger/guest name, phone, and email are required'); error.status = 422; throw error; }
    return { id: `cart-pax-${index + 1}`, fullName, phone, email, ageCategory: row.ageCategory || 'adult', idNumber: row.idNumber || row.documentNumber || '', pickupPoint: row.pickupPoint || '', dropoffPoint: row.dropoffPoint || '', specialNotes: row.notes || row.specialNotes || '' };
  });
}
function activeSeat(seat, holdId) {
  if (!seat) return false;
  if (seat.status === 'locked' && seat.lockedUntil && new Date(seat.lockedUntil) <= new Date()) {
    seat.status = 'available'; seat.lockedUntil = null; seat.lockId = null;
  }
  if (['taken', 'booked', 'checked_in', 'no_show', 'checked-in', 'no-show', 'blocked', 'maintenance', 'reserved', 'disabled'].includes(seat.status)) return false;
  if (seat.status === 'locked' && seat.lockId && seat.lockId !== holdId) return false;
  return true;
}
async function validateBusItem(cart, item, listing) {
  let schedule = null;
  if (item.scheduleId) schedule = await commerceRepository.schedules.findOne({ id: item.scheduleId, listingId: listing.id });
  if (!schedule) schedule = await commerceRepository.schedules.findOne({ listingId: listing.id, status: 'active' }, { sort: { departureAt: 1 } });
  if (!schedule || schedule.status !== 'active') { const error = new Error(`${listing.title} has no active schedule selected`); error.status = 409; throw error; }
  const seats = await commerceRepository.seats.list({ scheduleId: schedule.id }, { sort: { seatNumber: 1 } });
  const requestedSeats = item.selectedSeats.length ? item.selectedSeats : seats.filter((seat) => activeSeat(seat, item.holdId)).slice(0, 1).map((seat) => seat.seatNumber);
  if (!requestedSeats.length) { const error = new Error('Select at least one seat'); error.status = 422; throw error; }
  const unique = Array.from(new Set(requestedSeats));
  const selected = unique.map((seatNumber) => seats.find((seat) => String(seat.seatNumber) === String(seatNumber)));
  const missing = selected.findIndex((seat) => !seat);
  if (missing >= 0) { const error = new Error(`Seat ${unique[missing]} does not exist`); error.status = 404; throw error; }
  const unavailable = selected.find((seat) => !activeSeat(seat, item.holdId));
  if (unavailable) { const error = new Error(`Seat ${unavailable.seatNumber} is no longer available`); error.status = 409; error.recoveryType = 'inventory_unavailable'; throw error; }
  const passengers = passengerList(item, selected.length, cart.customer);
  const lines = selected.map((seat, index) => ({
    serviceType: 'bus', listingId: listing.id, companyId: listing.companyId,
    scheduleId: schedule.id, routeId: schedule.routeId, vehicleId: schedule.vehicleId,
    seatNumber: seat.seatNumber,
    passenger: { ...passengers[index], seatNumber: seat.seatNumber, seatOrRoom: seat.seatNumber },
    price: Number(schedule.basePrice || listing.priceFrom || 0) + Number(seat.priceDelta || 0),
    title: `${listing.title} seat ${seat.seatNumber}`,
    holdId: item.holdId || '',
  }));
  return { item, listing, schedule, lines, subtotal: lines.reduce((total, line) => total + line.price, 0) };
}
function dateRange(checkIn, checkOut) {
  const start = new Date(`${checkIn}T00:00:00.000Z`);
  const end = new Date(`${checkOut}T00:00:00.000Z`);
  if (!(end > start)) { const error = new Error('Check-out must be after check-in'); error.status = 422; throw error; }
  const dates = [];
  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) dates.push(d.toISOString().slice(0, 10));
  return dates;
}
async function validateHotelItem(cart, item, listing) {
  if (!item.checkIn || !item.checkOut) { const error = new Error('Hotel check-in and check-out dates are required'); error.status = 422; throw error; }
  const nights = dateRange(item.checkIn, item.checkOut);
  const nightFilter = { listingId: listing.id, date: { $in: nights } };
  if (item.roomTypeId) nightFilter.roomTypeId = item.roomTypeId;
  const all = await commerceRepository.roomNights.list(nightFilter, { sort: { date: 1 } });
  const byUnit = new Map();
  all.forEach((night) => { if (!byUnit.has(night.roomUnitId)) byUnit.set(night.roomUnitId, []); byUnit.get(night.roomUnitId).push(night); });
  const groups = Array.from(byUnit.values())
    .filter((rows) => rows.length === nights.length && rows.every((night) => ['available', 'reserved', 'held'].includes(night.status) && !night.bookingRef))
    .slice(0, item.roomCount);
  if (groups.length < item.roomCount) { const error = new Error('Not enough room-night inventory available'); error.status = 409; error.recoveryType = 'inventory_unavailable'; throw error; }
  const guests = passengerList(item, item.roomCount, cart.customer);
  const unitIds = groups.map((rows) => rows[0].roomUnitId);
  const typeIds = groups.map((rows) => rows[0].roomTypeId);
  const [units, roomTypes] = await Promise.all([
    commerceRepository.roomUnits.list({ id: { $in: unitIds } }),
    commerceRepository.roomTypes.list({ id: { $in: typeIds } }),
  ]);
  const lines = groups.map((rows, index) => {
    const unit = units.find((row) => row.id === rows[0].roomUnitId) || {};
    const roomType = roomTypes.find((row) => row.id === rows[0].roomTypeId) || {};
    return {
      serviceType: 'hotel', listingId: listing.id, companyId: listing.companyId,
      roomTypeId: rows[0].roomTypeId, roomUnitId: rows[0].roomUnitId, roomNumber: unit.unitNumber || '',
      checkIn: item.checkIn, checkOut: item.checkOut, nights: rows.map((night) => night.date), nightIds: rows.map((night) => night.id),
      guest: { ...guests[index], seatOrRoom: unit.unitNumber || roomType.name || 'Room', roomNumber: unit.unitNumber || '', roomType: roomType.name || '' },
      price: rows.reduce((total, night) => total + Number(night.price || listing.priceFrom || 0), 0),
      title: `${listing.title} ${unit.unitNumber || roomType.name || 'room'}`,
      holdId: item.holdId || '',
    };
  });
  return { item, listing, lines, subtotal: lines.reduce((total, line) => total + line.price, 0) };
}
function validateCoupon(cart, subtotal) {
  const code = clean(cart.couponCode || '').toUpperCase();
  if (!code) return { code: '', amount: 0, label: 'No coupon' };
  const discounts = { CLASSIC10: 0.10, CLASSI90: 0.10, WELCOME5: 0.05 };
  const percent = discounts[code];
  if (!percent) { const error = new Error('Coupon is invalid or expired'); error.status = 422; throw error; }
  return { code, percent, amount: Math.round(subtotal * percent), label: `${Math.round(percent * 100)}% discount` };
}
async function validateCartData(cart) {
  if (!cart.items.length) { const error = new Error('Cart has no items'); error.status = 422; throw error; }
  const validations = [];
  const lines = [];
  let subtotal = 0;
  for (const item of cart.items) {
    const { listing } = await listingOrThrow(item);
    const result = item.serviceType === 'bus'
      ? await validateBusItem(cart, item, listing)
      : item.serviceType === 'hotel'
        ? await validateHotelItem(cart, item, listing)
        : null;
    if (!result) { const error = new Error('Unsupported service item'); error.status = 409; throw error; }
    validations.push({ itemId: item.id, serviceType: item.serviceType, listingId: listing.id, status: 'valid', subtotal: result.subtotal });
    result.lines.forEach((line) => lines.push({ ...line, cartItemId: item.id }));
    subtotal += result.subtotal;
  }
  const coupon = validateCoupon(cart, subtotal);
  const taxable = Math.max(0, subtotal - coupon.amount);
  const customerFees = calculateCustomerFees(taxable);
  const { taxAmount, serviceFee, totalFees: fees, total } = customerFees;
  const hasReferral = Boolean(cart.promoterAttribution?.promoterId || cart.promoterAttribution?.code);
  return {
    status: 'valid',
    messages: [`${cart.items.length} cart item(s) validated`, `${lines.length} ticket/stay unit(s) ready`],
    lines,
    coupon,
    taxes: [{ label: 'Service tax', amount: taxAmount }, { label: 'Checkout service fee', amount: serviceFee }],
    pricing: { subtotal, fees, addonTotal: 0, discount: coupon.amount, total, currency: cart.pricing?.currency || platformCurrency(), split: calculateCommission(total, hasReferral) },
    validatedAt: nowIso(),
  };
}
async function validateCart(cartRefValue, options = {}) {
  const cart = await cartOrThrow(cartRefValue);
  try {
    const validation = await validateCartData(cart);
    cart.validation = validation;
    cart.pricing = validation.pricing;
    cart.coupon = validation.coupon;
    cart.taxes = validation.taxes;
    cart.status = options.soft && cart.status === 'draft' ? 'draft' : 'validated';
    cart.recoveryState = null;
  } catch (error) {
    cart.validation = { status: 'failed', messages: [error.message], errorType: error.recoveryType || 'validation_failed', failedAt: nowIso() };
    cart.recoveryState = { type: error.recoveryType || 'validation_failed', message: error.message, action: 'Edit cart and revalidate', recoveryUrl: `/cart/${cart.cartRef}` };
    cart.status = error.status === 409 ? 'inventory_failed' : 'validation_failed';
    if (!options.soft) { await upsert('carts', cart); throw error; }
  }
  cart.updatedAt = nowIso();
  await upsert('carts', cart);
  return cart;
}
function allocateInteger(totalValue, weights = []) {
  const total = Math.round(Number(totalValue || 0));
  if (!weights.length) return [];
  const safeWeights = weights.map((weight) => Math.max(0, Number(weight || 0)));
  const weightTotal = safeWeights.reduce((sum, weight) => sum + weight, 0);
  if (weightTotal <= 0) {
    const result = Array(weights.length).fill(0);
    result[result.length - 1] = total;
    return result;
  }
  const exact = safeWeights.map((weight) => (total * weight) / weightTotal);
  const allocated = exact.map(Math.floor);
  let remainder = total - allocated.reduce((sum, amount) => sum + amount, 0);
  exact
    .map((amount, index) => ({ index, fraction: amount - Math.floor(amount) }))
    .sort((a, b) => b.fraction - a.fraction)
    .forEach(({ index }) => {
      if (remainder > 0) {
        allocated[index] += 1;
        remainder -= 1;
      }
    });
  return allocated;
}

function groupLines(lines = []) {
  const groups = new Map();
  lines.forEach((line) => {
    const key = `${line.companyId}::${line.serviceType}`;
    if (!groups.has(key)) groups.set(key, { key, companyId: line.companyId, serviceType: line.serviceType, lines: [] });
    groups.get(key).lines.push(line);
  });
  return Array.from(groups.values());
}

function buildBookingGroup(cart, payment) {
  const groupRef = generateCode('ORDER', 10);
  return {
    id: generateCode('GROUPID', 12),
    groupRef,
    cartRef: cart.cartRef,
    customerUserId: cart.userId || null,
    customerSnapshot: cart.customer,
    bookingRefs: [],
    companyIds: [],
    serviceTypes: [],
    pricing: cart.pricing,
    paymentProvider: payment.provider,
    paymentRef: payment.providerReference,
    paymentStatus: payment.status || 'pending',
    status: payment.status === 'successful' ? 'confirmed' : 'pending_payment',
    checkoutUrl: payment.checkoutUrl || '',
    metadata: { itemCount: cart.items.length, lineCount: cart.validation?.lines?.length || 0 },
    createdAt: nowIso(),
  };
}

function buildChildBookings(cart, payment, lines, bookingGroup) {
  const groups = groupLines(lines);
  const subtotals = groups.map((group) => group.lines.reduce((sum, line) => sum + Number(line.price || 0), 0));
  const feeAllocations = allocateInteger(cart.pricing?.fees, subtotals);
  const addonAllocations = allocateInteger(cart.pricing?.addonTotal, subtotals);
  const discountAllocations = allocateInteger(cart.pricing?.discount, subtotals);
  const totalAllocations = allocateInteger(cart.pricing?.total, subtotals);
  const split = cart.pricing?.split || {};
  const platformAllocations = allocateInteger(split.platformFee, subtotals);
  const companyAllocations = allocateInteger(split.companyAmount, subtotals);
  const promoterAllocations = allocateInteger(split.promoterAmount, subtotals);
  return groups.map((group, groupIndex) => {
    const bookingRef = generateBookingRef(group.serviceType);
    const lineSubtotal = subtotals[groupIndex];
    const groupedItems = group.lines.map((line, index) => ({
      id: `${bookingRef}-ITEM-${index + 1}`,
      cartItemId: line.cartItemId,
      serviceType: line.serviceType,
      listingId: line.listingId,
      companyId: line.companyId,
      scheduleId: line.scheduleId || '',
      seatNumber: line.seatNumber || '',
      roomUnitId: line.roomUnitId || '',
      roomNumber: line.roomNumber || '',
      checkIn: line.checkIn || '',
      checkOut: line.checkOut || '',
      passengerName: line.passenger?.fullName || line.guest?.fullName || cart.customer.fullName,
      price: line.price,
      status: 'confirmed',
    }));
    const ticketLegs = group.lines.map((line, index) => ({
      id: `${bookingRef}-LEG-${index + 1}`,
      ticketNumber: `${bookingRef}-${index + 1}`,
      serviceType: line.serviceType,
      listingId: line.listingId,
      scheduleId: line.scheduleId || '',
      seatNumber: line.seatNumber || '',
      roomUnitId: line.roomUnitId || '',
      roomNumber: line.roomNumber || '',
      passengerName: line.passenger?.fullName || line.guest?.fullName || cart.customer.fullName,
      qrToken: `CLASSIC-TRIP:${group.serviceType.toUpperCase()}:${bookingRef}:${index + 1}:${Date.now()}`,
      status: 'confirmed',
      checkInStatus: 'pending',
    }));
    const pricing = {
      subtotal: lineSubtotal,
      fees: feeAllocations[groupIndex],
      addonTotal: addonAllocations[groupIndex],
      discount: discountAllocations[groupIndex],
      total: totalAllocations[groupIndex],
      currency: cart.pricing?.currency || platformCurrency(),
      split: {
        platformFee: platformAllocations[groupIndex],
        companyAmount: companyAllocations[groupIndex],
        promoterAmount: promoterAllocations[groupIndex],
      },
    };
    return {
      id: generateCode('BOOKID', 12),
      bookingRef,
      guestLookupCode: generateCode('LOOKUP', 8),
      cartRef: cart.cartRef,
      bookingGroupId: bookingGroup.id,
      bookingGroupRef: bookingGroup.groupRef,
      serviceType: group.serviceType,
      guestSnapshot: cart.customer,
      buyerSnapshot: cart.customer,
      customerUserId: cart.userId || null,
      companyId: group.companyId,
      tenantId: group.companyId,
      listingId: groupedItems[0]?.listingId || '',
      scheduleId: groupedItems[0]?.scheduleId || '',
      passengers: group.lines.map((line, index) => ({ id: `${bookingRef}-PAX-${index + 1}`, ...(line.passenger || line.guest || {}), seatOrRoom: line.seatNumber || line.roomNumber || '' })),
      bookingItems: groupedItems,
      bookingLegs: cart.items.filter((item) => groupedItems.some((row) => row.cartItemId === item.id)).map((item) => ({ id: item.id, serviceType: item.serviceType, status: 'confirmed' })),
      ticketLegs,
      tripType: 'single_service_cart',
      pricing,
      grossAmount: pricing.total,
      promoterAttribution: cart.promoterAttribution || null,
      referralCode: cart.promoterAttribution?.code || '',
      paymentStatus: payment.status || 'pending',
      paymentProvider: payment.provider,
      paymentRef: payment.providerReference,
      paymentMethodNote: payment.methodNote || '',
      bookingStatus: payment.status === 'successful' ? 'confirmed' : 'pending_payment',
      settlementStatus: 'pending',
      qrCodeValue: `CLASSIC-TRIP:${group.serviceType.toUpperCase()}:${bookingRef}:${Date.now()}`,
      createdAt: nowIso(),
    };
  });
}

function bookingForLine(bookings, line) {
  return bookings.find((booking) => booking.companyId === line.companyId && booking.serviceType === line.serviceType);
}

async function commitCheckoutMongo({ cart, bookingGroup, bookings, paymentRow, attempt, lines, outboxEvents = [] }) {
  await commerceRepository.withTransaction(async (session) => {
      const Seat = require('../../models/Seat');
      const TripSchedule = require('../../models/TripSchedule');
      const RoomNightInventory = require('../../models/RoomNightInventory');
      const Booking = require('../../models/Booking');
      const BookingGroup = require('../../models/BookingGroup');
      const Payment = require('../../models/Payment');
      const Cart = require('../../models/Cart');
      const CartCheckoutAttempt = require('../../models/CartCheckoutAttempt');
      const InventoryHold = require('../../models/InventoryHold');
      const InventoryHoldItem = require('../../models/InventoryHoldItem');

      const consumedHoldIds = new Set();

      for (const line of lines) {
        const child = bookingForLine(bookings, line);
        if (!child) throw Object.assign(new Error('Booking partition could not be resolved'), { status: 500 });
        if (line.serviceType === 'bus') {
          const filter = {
            scheduleId: line.scheduleId,
            seatNumber: line.seatNumber,
            $or: [
              { status: 'available' },
              { status: 'locked', lockId: line.holdId || null, lockedUntil: { $gt: new Date() } },
            ],
          };
          const result = await Seat.updateOne(filter, {
            $set: { status: 'taken', bookingRef: child.bookingRef, updatedAt: new Date() },
            $unset: { lockedUntil: '', lockId: '' },
          }, { session });
          if (result.modifiedCount !== 1) throw Object.assign(new Error(`Seat ${line.seatNumber} is no longer available`), { status: 409 });
          const scheduleResult = await TripSchedule.updateOne(
            { id: line.scheduleId, availableSeats: { $gt: 0 } },
            { $inc: { availableSeats: -1 } },
            { session }
          );
          if (scheduleResult.modifiedCount !== 1) {
            throw Object.assign(new Error('Schedule capacity is no longer available'), { status: 409 });
          }
        }
        if (line.serviceType === 'hotel') {
          const result = await RoomNightInventory.updateMany({
            id: { $in: line.nightIds || [] },
            status: { $in: ['available', 'reserved', 'held'] },
          }, {
            $set: { status: 'booked', bookingRef: child.bookingRef, guestName: line.guest?.fullName || '', checkInStatus: 'not_checked', updatedAt: new Date() },
          }, { session });
          if (result.modifiedCount !== (line.nightIds || []).length) throw Object.assign(new Error('Room inventory is no longer available'), { status: 409 });
        }
        if (line.holdId) {
          const holdItemFilter = line.serviceType === 'bus'
            ? { holdId: line.holdId, resourceKey: inventoryHoldService.seatResourceKey(line.scheduleId, line.seatNumber), status: 'active' }
            : { holdId: line.holdId, status: 'active' };
          const holdItemResult = await InventoryHoldItem.updateOne(holdItemFilter, {
            $set: {
              status: 'consumed',
              consumedAt: new Date(),
              consumedBy: cart.userId || 'guest-checkout',
              bookingId: child.id,
              bookingRef: child.bookingRef,
            },
          }, { session });
          if (line.serviceType === 'bus' && holdItemResult.modifiedCount !== 1) {
            throw Object.assign(new Error(`Seat hold for ${line.seatNumber} is missing or expired`), { status: 409 });
          }
          consumedHoldIds.add(line.holdId);
        }
      }

      if (consumedHoldIds.size) {
        await InventoryHold.updateMany(
          { id: { $in: Array.from(consumedHoldIds) }, status: 'active' },
          { $set: {
            status: 'consumed',
            consumedAt: new Date(),
            consumedBy: cart.userId || 'guest-checkout',
            bookingId: bookingGroup.id,
            bookingRef: bookingGroup.groupRef,
          } },
          { session }
        );
      }

      await Booking.insertMany(bookings, { session });
      await BookingGroup.updateOne({ groupRef: bookingGroup.groupRef }, { $set: bookingGroup }, { upsert: true, runValidators: true, session });
      await Payment.updateOne({ idempotencyKey: paymentRow.idempotencyKey }, { $set: paymentRow }, { upsert: true, runValidators: true, session });
      await Cart.updateOne({ cartRef: cart.cartRef }, { $set: cart }, { upsert: true, runValidators: true, session });
      await CartCheckoutAttempt.updateOne({ id: attempt.id }, { $set: attempt }, { upsert: true, runValidators: true, session });
      await outboxService.persistInSession(outboxEvents, session);
  });
}

async function recordLedgerAndCommission(booking, lines) {
  const currency = booking.pricing.currency || platformCurrency();
  await walletService.creditAvailable('platform', 'platform', currency, booking.pricing.split.platformFee || 0, { transactionType: 'cart_platform_fee', referenceType: 'cart_booking', referenceId: booking.id });
  const byCompany = new Map();
  lines.forEach((line) => byCompany.set(line.companyId, (byCompany.get(line.companyId) || 0) + Number(line.price || 0)));
  const totalLineAmount = Array.from(byCompany.values()).reduce((sum, value) => sum + value, 0) || 1;
  for (const [companyId, gross] of byCompany) {
    const companyShare = Math.round((booking.pricing.split.companyAmount || 0) * (gross / totalLineAmount));
    await walletService.creditPending('company', companyId, currency, companyShare, { transactionType: 'cart_company_earning_pending', referenceType: 'cart_booking', referenceId: booking.id });
  }
  if (booking.promoterAttribution?.promoterId) {
    await walletService.creditPending('promoter', booking.promoterAttribution.promoterId, currency, booking.pricing.split.promoterAmount || 0, { transactionType: 'cart_promoter_commission_pending', referenceType: 'cart_booking', referenceId: booking.id });
  }
  await commissionService.createCommission(booking, Boolean(booking.promoterAttribution), booking.pricing.split);
}
async function checkout(cartRefValue, payload = {}, req = {}) {
  const cart = await validateCart(cartRefValue);
  if (!cart.validation || cart.validation.status !== 'valid') { const error = new Error('Cart is not valid for checkout'); error.status = 422; throw error; }
  const attempt = { id: attemptId(), cartRef: cart.cartRef, status: 'started', pricingSnapshot: cart.pricing, inventorySnapshot: cart.validation.lines, createdBy: cart.userId || req?.session?.user?.id || 'guest', createdAt: nowIso() };
  await upsert('cartCheckoutAttempts', attempt);
  if (payload.forcePaymentFailure) {
    cart.status = 'payment_failed';
    cart.recoveryState = { type: 'payment_failed', message: 'Payment could not be completed. Inventory was not consumed.', action: 'Try another payment method', recoveryUrl: `/cart/${cart.cartRef}/recovery` };
    attempt.status = 'failed'; attempt.failureType = 'payment_failed'; attempt.failureReason = cart.recoveryState.message; attempt.recoveryAction = cart.recoveryState.action; attempt.recoveryUrl = cart.recoveryState.recoveryUrl;
    await upsert('carts', cart); await upsert('cartCheckoutAttempts', attempt);
    return { cart, attempt, booking: null, payment: null };
  }
  const provider = paymentService.resolveProviderName(payload.provider || payload.paymentProvider);
  let payment;
  try {
    payment = await paymentService.initiatePayment({
      provider,
      bookingRef: cart.cartRef,
      amount: cart.pricing.total,
      currency: cart.pricing.currency,
      customer: cart.customer,
      callbackUrl: `${env.appUrl}/booking/payment/callback?cartRef=${encodeURIComponent(cart.cartRef)}`,
      description: `Classic Trip cart checkout ${cart.cartRef}`,
    });
  } catch (error) {
    cart.status = 'payment_failed';
    cart.recoveryState = { type: 'payment_failed', message: error.message || 'Payment could not be started. No booking or financial record was created.', action: 'Try another payment method', recoveryUrl: `/cart/${cart.cartRef}/recovery` };
    cart.paymentId = ''; cart.paymentRef = ''; cart.bookingRef = ''; cart.bookingGroupId = ''; cart.bookingGroupRef = ''; cart.childBookingRefs = [];
    attempt.status = 'failed'; attempt.failureType = 'payment_provider_error'; attempt.failureReason = cart.recoveryState.message; attempt.recoveryAction = cart.recoveryState.action; attempt.recoveryUrl = cart.recoveryState.recoveryUrl; attempt.resolvedAt = nowIso();
    await upsert('carts', cart); await upsert('cartCheckoutAttempts', attempt);
    throw error;
  }
  if (String(payment.status || '').toLowerCase() === 'failed') {
    cart.status = 'payment_failed';
    cart.recoveryState = { type: 'payment_failed', message: payment.message || payment.failureReason || 'Payment could not be completed. No booking or financial record was created.', action: 'Try another payment method', recoveryUrl: `/cart/${cart.cartRef}/recovery` };
    cart.paymentId = ''; cart.paymentRef = ''; cart.bookingRef = ''; cart.bookingGroupId = ''; cart.bookingGroupRef = ''; cart.childBookingRefs = [];
    attempt.status = 'failed'; attempt.failureType = 'payment_failed'; attempt.failureReason = cart.recoveryState.message; attempt.recoveryAction = cart.recoveryState.action; attempt.recoveryUrl = cart.recoveryState.recoveryUrl; attempt.resolvedAt = nowIso();
    await upsert('carts', cart); await upsert('cartCheckoutAttempts', attempt);
    return { cart, attempt, booking: null, bookingGroup: null, payment: null };
  }
  const bookingGroup = buildBookingGroup(cart, payment);
  const bookings = buildChildBookings(cart, payment, cart.validation.lines, bookingGroup);
  bookingGroup.bookingRefs = bookings.map((booking) => booking.bookingRef);
  bookingGroup.companyIds = Array.from(new Set(bookings.map((booking) => booking.companyId)));
  bookingGroup.serviceTypes = Array.from(new Set(bookings.map((booking) => booking.serviceType)));
  const primaryBooking = bookings[0];
  try {
    const paymentRow = {
      id: generateCode('PAYID', 12),
      bookingId: bookingGroup.id,
      bookingRef: bookingGroup.groupRef,
      amount: cart.pricing.total,
      grossAmount: cart.pricing.total,
      currency: cart.pricing.currency,
      status: payment.status || 'pending',
      provider: payment.provider || provider,
      providerReference: payment.providerReference,
      customerUserId: cart.userId || null,
      idempotencyKey: `cart:${cart.cartRef}`,
      metadata: {
        cartRef: cart.cartRef,
        bookingGroupRef: bookingGroup.groupRef,
        childBookingRefs: bookings.map((booking) => booking.bookingRef),
        itemCount: cart.items.length,
        ticketCount: bookings.reduce((sum, booking) => sum + booking.ticketLegs.length, 0),
      },
      checkoutUrl: payment.checkoutUrl || '',
      createdAt: nowIso(),
      paidAt: (payment.status || 'pending') === 'successful' ? (payment.paidAt || nowIso()) : null,
    };
    bookingGroup.paymentId = paymentRow.id;
    bookingGroup.paymentRef = paymentRow.providerReference;
    bookingGroup.paymentProvider = paymentRow.provider;
    bookingGroup.paymentStatus = paymentRow.status;
    bookingGroup.checkoutUrl = paymentRow.checkoutUrl || '';
    bookingGroup.status = paymentRow.status === 'successful' ? 'confirmed' : 'pending_payment';

    cart.status = paymentRow.status === 'successful' ? 'checked_out' : 'payment_pending';
    cart.paymentId = paymentRow.id;
    cart.paymentRef = paymentRow.providerReference;
    cart.checkoutUrl = paymentRow.checkoutUrl || '';
    cart.bookingRef = primaryBooking.bookingRef;
    cart.bookingGroupId = bookingGroup.id;
    cart.bookingGroupRef = bookingGroup.groupRef;
    cart.childBookingRefs = bookings.map((booking) => booking.bookingRef);
    cart.checkedOutAt = nowIso();
    cart.recoveryState = null;

    attempt.status = 'completed';
    attempt.bookingRef = primaryBooking.bookingRef;
    attempt.bookingGroupRef = bookingGroup.groupRef;
    attempt.childBookingRefs = bookings.map((booking) => booking.bookingRef);
    attempt.paymentId = paymentRow.id;
    attempt.providerReference = paymentRow.providerReference;
    attempt.resolvedAt = nowIso();

    const totalTickets = bookings.reduce((sum, booking) => sum + booking.ticketLegs.length, 0);
    const notificationTitle = paymentRow.status === 'successful' ? 'Cart checkout confirmed' : 'Cart checkout payment pending';
    const notificationMessage = paymentRow.status === 'successful'
      ? `${bookingGroup.groupRef} confirmed as ${bookings.length} company booking(s) with ${totalTickets} ticket/stay unit(s).`
      : `${bookingGroup.groupRef} is waiting for payment confirmation. Checkout: ${paymentRow.checkoutUrl || 'payment link pending'}`;
    const outboxEvents = [
      outboxService.createEvent({
        topic: 'notification.requested',
        aggregateType: 'booking_group',
        aggregateId: bookingGroup.id,
        tenantId: bookingGroup.companyIds[0] || '',
        dedupeKey: `notification:booking-group:${bookingGroup.groupRef}:checkout`,
        payload: {
          userId: cart.userId || null,
          channels: ['in_app', 'email', 'sms'],
          title: notificationTitle,
          message: notificationMessage,
          recipient: {
            name: cart.customer?.fullName || '',
            email: cart.customer?.email || '',
            phone: cart.customer?.phone || '',
          },
          ownerType: cart.userId ? 'customer' : 'guest',
          ownerId: cart.userId || cart.customer?.email || cart.customer?.phone || '',
          audience: 'customers',
          referenceType: 'cart_booking',
          referenceId: bookingGroup.id,
          meta: { bookingGroupRef: bookingGroup.groupRef, bookingRefs: bookingGroup.bookingRefs, checkoutUrl: paymentRow.checkoutUrl || '' },
        },
      }),
      outboxService.createEvent({
        topic: 'audit.write',
        aggregateType: 'booking_group',
        aggregateId: bookingGroup.id,
        tenantId: bookingGroup.companyIds[0] || '',
        dedupeKey: `audit:cart-checkout:${bookingGroup.groupRef}`,
        payload: {
          actorId: cart.userId || 'guest',
          actorRole: cart.userId ? 'customer' : 'guest',
          action: 'cart.checkout.completed',
          targetType: 'booking_group',
          targetId: bookingGroup.groupRef,
          status: 'success',
          meta: { cartRef: cart.cartRef, bookingRefs: bookingGroup.bookingRefs, paymentId: paymentRow.id },
          createdAt: nowIso(),
        },
      }),
    ];

    await commitCheckoutMongo({ cart, bookingGroup, bookings, paymentRow, attempt, lines: cart.validation.lines, outboxEvents });


    if (paymentRow.status === 'successful') {
      for (const booking of bookings) {
        const bookingLines = cart.validation.lines.filter((line) => line.companyId === booking.companyId && line.serviceType === booking.serviceType);
        await recordLedgerAndCommission(booking, bookingLines);
      }
    }

    for (const event of outboxEvents) {
      await outboxService.processEvent(event, outboxHandlers);
    }

    return { cart, attempt, booking: primaryBooking, bookings, bookingGroup, payment: paymentRow };
  } catch (error) {
    const paymentSucceeded = String(payment?.status || '').toLowerCase() === 'successful';
    cart.status = 'inventory_failed';
    cart.recoveryState = paymentSucceeded
      ? { type: 'payment_reconciliation_required', message: 'Payment succeeded but inventory could not be committed. A refund or manual reconciliation is required.', action: 'Contact support with the payment reference', recoveryUrl: `/cart/${cart.cartRef}/recovery`, paymentRef: payment.providerReference }
      : { type: 'inventory_failed', message: error.message, action: 'Review unavailable items and checkout again', recoveryUrl: `/cart/${cart.cartRef}/recovery` };
    attempt.status = 'failed'; attempt.failureType = 'inventory_failed'; attempt.failureReason = paymentSucceeded ? `${error.message}; payment reconciliation required` : error.message; attempt.recoveryAction = cart.recoveryState.action; attempt.recoveryUrl = cart.recoveryState.recoveryUrl;
    await upsert('carts', cart); await upsert('cartCheckoutAttempts', attempt);
    throw error;
  }
}
async function releaseRecoverableCart(cartRefValue, reason = 'customer_recovery') {
  const cart = await cartOrThrow(cartRefValue);
  if (!RECOVERABLE_STATUSES.includes(cart.status)) return cart;
  cart.status = 'draft';
  cart.recoveryState = { type: 'released', message: 'Cart recovered. Please revalidate current inventory before checkout.', action: 'Revalidate cart', recoveryUrl: `/cart/${cart.cartRef}` };
  cart.updatedAt = nowIso();
  await upsert('carts', cart);
  const audit = { id: await nextId('audit'), actorId: 'cart-system', action: 'cart.recovered', entityType: 'cart', entityId: cart.cartRef, target: cart.cartRef, status: 'success', createdAt: nowIso(), metadata: { reason } };
  await upsert('auditLogs', audit);
  return cart;
}
async function cartRows() {
  const carts = await commerceRepository.carts.list({}, { sort: { createdAt: -1 } });
  return carts.map((cart) => [cart.cartRef, String(cart.items?.length || 0), cart.customer?.fullName || 'Guest', cart.pricing?.currency || platformCurrency(), String(cart.pricing?.total || 0), cart.status || 'draft']);
}
async function checkoutAttemptRows() {
  const attempts = await commerceRepository.checkoutAttempts.list({}, { sort: { createdAt: -1 } });
  return attempts.map((attempt) => [attempt.id, attempt.cartRef, attempt.bookingRef || '-', attempt.providerReference || '-', attempt.failureType || '-', attempt.status || 'started']);
}

module.exports = { createCart, addItem, findCart, publicCart, validateCart, checkout, releaseRecoverableCart, cartRows, checkoutAttemptRows };
