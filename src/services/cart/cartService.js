const store = require('../data/persistentStore');
const repositories = require('../../repositories');
const { ENABLED_BOOKING_TYPES } = require('../../config/constants');
const { env } = require('../../config/env');
const generateBookingRef = require('../../utils/generateBookingRef');
const generateCode = require('../../utils/generateCode');
const calculateCommission = require('../../utils/calculateCommission');
const paymentService = require('../payment/paymentService');
const walletService = require('../wallet/walletService');
const commissionService = require('../commission/commissionService');

const RECOVERABLE_STATUSES = ['payment_failed', 'inventory_failed', 'validation_failed'];
const FUTURE_SERVICES = ['flight', 'train', 'tour', 'event', 'car_rental', 'cargo', 'insurance', 'ferry', 'visa', 'package'];

function ensureCollections() {
  ['carts', 'cartCheckoutAttempts', 'bookings', 'payments', 'notifications', 'auditLogs', 'walletTransactions', 'commissions', 'inventoryHolds'].forEach((key) => {
    if (!Array.isArray(store.state[key])) store.state[key] = [];
  });
}
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
function nextId(prefix, rows) { return `${prefix}-${String((rows || []).length + 1).padStart(4, '0')}`; }
async function upsert(entity, row) {
  if (repositories.mongoReady && repositories[entity]) await repositories[entity].upsert(row);
}
function cartRef() { return generateCode('CART', 8); }
function attemptId() { return generateCode('CARTTRY', 8); }
function publicCart(cart) {
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
    childBookingRefs: cart.childBookingRefs || [],
    paymentRef: cart.paymentRef,
    checkoutUrl: cart.checkoutUrl || '',
    expiresAt: cart.expiresAt,
  };
}
function findCart(cartRefValue) {
  ensureCollections();
  return store.state.carts.find((cart) => cart.cartRef === cartRefValue || cart.id === cartRefValue) || null;
}
function cartOrThrow(cartRefValue) {
  const cart = findCart(cartRefValue);
  if (!cart) { const error = new Error('Cart not found'); error.status = 404; throw error; }
  return cart;
}
function customerFromPayload(payload = {}, req = {}) {
  const sessionUser = req?.session?.user || {};
  return {
    fullName: clean(payload.fullName || payload.customerName || sessionUser.fullName || sessionUser.name || 'Guest Customer'),
    email: clean(payload.email || sessionUser.email || 'guest@example.com'),
    phone: clean(payload.phone || sessionUser.phone || '+256700000000'),
  };
}
function createCart(payload = {}, req = {}) {
  ensureCollections();
  const userId = payload.customerUserId || req?.session?.user?.id || null;
  const cart = {
    id: nextId('cart', store.state.carts),
    cartRef: cartRef(),
    status: 'draft',
    userId,
    guestKey: payload.guestKey || req?.sessionID || generateCode('GUEST', 6),
    customer: customerFromPayload(payload, req),
    items: [],
    holds: [],
    couponCode: clean(payload.couponCode || payload.coupon || ''),
    coupon: null,
    promoterAttribution: payload.promoterAttribution || (payload.ref ? { code: clean(payload.ref) } : null),
    pricing: { subtotal: 0, fees: 0, addonTotal: 0, total: 0, currency: payload.currency || 'UGX', split: calculateCommission(0, false) },
    taxes: [],
    validation: { status: 'draft', messages: ['Cart created. Add services before checkout.'] },
    recoveryState: null,
    expiresAt: addMinutes(payload.holdMinutes || 15),
    createdBy: userId || 'guest',
    createdAt: nowIso(),
  };
  store.state.carts.unshift(cart);
  upsert('carts', cart);
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
  const cart = cartOrThrow(cartRefValue);
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
function listingOrThrow(item) {
  const listing = store.findListing(item.listingId, item.serviceType) || store.state.listings.find((row) => row.id === item.listingId || row.slug === item.listingId);
  if (!listing) { const error = new Error(`Listing not found for cart item ${item.id}`); error.status = 404; throw error; }
  if (listing.serviceType !== item.serviceType) { const error = new Error(`Service type mismatch for ${listing.title}`); error.status = 422; throw error; }
  const company = store.findCompany(listing.companyId || listing.companySlug);
  if (listing.status !== 'active' || listing.bookable === false) { const error = new Error(`${listing.title} is not open for checkout`); error.status = 409; throw error; }
  if (company && (company.verificationStatus !== 'verified' || company.settings?.canPublish === false)) { const error = new Error(`${listing.title} provider is not verified for checkout`); error.status = 403; throw error; }
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
  if (['taken', 'booked', 'checked-in', 'no-show', 'blocked', 'maintenance', 'reserved', 'disabled'].includes(seat.status)) return false;
  if (seat.status === 'locked' && seat.lockId && seat.lockId !== holdId) return false;
  return true;
}
function validateBusItem(cart, item, listing) {
  const schedule = store.state.schedules.find((row) => row.id === item.scheduleId && row.listingId === listing.id) || store.schedulesForListing(listing.id)[0];
  if (!schedule || schedule.status !== 'active') { const error = new Error(`${listing.title} has no active schedule selected`); error.status = 409; throw error; }
  const seats = store.seatsForSchedule(schedule.id);
  const requestedSeats = item.selectedSeats.length ? item.selectedSeats : seats.filter((seat) => activeSeat(seat, item.holdId)).slice(0, 1).map((seat) => seat.seatNumber);
  if (!requestedSeats.length) { const error = new Error('Select at least one seat'); error.status = 422; throw error; }
  const unique = Array.from(new Set(requestedSeats));
  const selected = unique.map((seatNumber) => seats.find((seat) => seat.seatNumber === seatNumber));
  const unavailable = selected.find((seat) => !activeSeat(seat, item.holdId));
  if (unavailable) { const error = new Error(`Seat ${unavailable.seatNumber} is no longer available`); error.status = 409; error.recoveryType = 'inventory_unavailable'; throw error; }
  const passengers = passengerList(item, selected.length, cart.customer);
  const lines = selected.map((seat, index) => ({
    serviceType: 'bus',
    listingId: listing.id,
    companyId: listing.companyId,
    scheduleId: schedule.id,
    routeId: schedule.routeId,
    vehicleId: schedule.vehicleId,
    seatNumber: seat.seatNumber,
    passenger: { ...passengers[index], seatNumber: seat.seatNumber, seatOrRoom: seat.seatNumber },
    price: Number(schedule.basePrice || listing.priceFrom || 0) + Number(seat.priceDelta || 0),
    title: `${listing.title} seat ${seat.seatNumber}`,
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
function validateHotelItem(cart, item, listing) {
  if (!item.checkIn || !item.checkOut) { const error = new Error('Hotel check-in and check-out dates are required'); error.status = 422; throw error; }
  const nights = dateRange(item.checkIn, item.checkOut);
  const all = (store.state.roomNightInventories || []).filter((night) => night.listingId === listing.id && (!item.roomTypeId || night.roomTypeId === item.roomTypeId) && nights.includes(night.date));
  const byUnit = new Map();
  all.forEach((night) => { if (!byUnit.has(night.roomUnitId)) byUnit.set(night.roomUnitId, []); byUnit.get(night.roomUnitId).push(night); });
  const groups = Array.from(byUnit.values()).filter((rows) => rows.length === nights.length && rows.every((night) => ['available', 'reserved', 'held'].includes(night.status))).slice(0, item.roomCount);
  if (groups.length < item.roomCount) { const error = new Error('Not enough room-night inventory available'); error.status = 409; error.recoveryType = 'inventory_unavailable'; throw error; }
  const guests = passengerList(item, item.roomCount, cart.customer);
  const lines = groups.map((rows, index) => {
    const unit = store.state.roomUnits.find((row) => row.id === rows[0].roomUnitId) || {};
    const roomType = store.state.roomTypes.find((row) => row.id === rows[0].roomTypeId) || {};
    return {
      serviceType: 'hotel', listingId: listing.id, companyId: listing.companyId,
      roomTypeId: rows[0].roomTypeId, roomUnitId: rows[0].roomUnitId, roomNumber: unit.unitNumber || '',
      checkIn: item.checkIn, checkOut: item.checkOut, nights: rows.map((night) => night.date), nightIds: rows.map((night) => night.id),
      guest: { ...guests[index], seatOrRoom: unit.unitNumber || roomType.name || 'Room', roomNumber: unit.unitNumber || '', roomType: roomType.name || '' },
      price: rows.reduce((total, night) => total + Number(night.price || listing.priceFrom || 0), 0),
      title: `${listing.title} ${unit.unitNumber || roomType.name || 'room'}`,
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
function validateCartSync(cart) {
  if (!cart.items.length) { const error = new Error('Cart has no items'); error.status = 422; throw error; }
  const validations = [];
  const lines = [];
  let subtotal = 0;
  cart.items.forEach((item) => {
    const { listing } = listingOrThrow(item);
    const result = item.serviceType === 'bus' ? validateBusItem(cart, item, listing) : item.serviceType === 'hotel' ? validateHotelItem(cart, item, listing) : null;
    if (!result) { const error = new Error('Unsupported service item'); error.status = 409; throw error; }
    validations.push({ itemId: item.id, serviceType: item.serviceType, listingId: listing.id, status: 'valid', subtotal: result.subtotal });
    result.lines.forEach((line) => lines.push({ ...line, cartItemId: item.id }));
    subtotal += result.subtotal;
  });
  const coupon = validateCoupon(cart, subtotal);
  const taxable = Math.max(0, subtotal - coupon.amount);
  const taxAmount = Math.round(taxable * 0.045);
  const serviceFee = Math.round(Math.max(3500, taxable * 0.012));
  const fees = taxAmount + serviceFee;
  const total = taxable + fees;
  const hasReferral = Boolean(cart.promoterAttribution?.promoterId || cart.promoterAttribution?.code);
  return {
    status: 'valid',
    messages: [`${cart.items.length} cart item(s) validated`, `${lines.length} ticket/stay unit(s) ready`],
    lines,
    coupon,
    taxes: [{ label: 'Service tax', amount: taxAmount }, { label: 'Checkout service fee', amount: serviceFee }],
    pricing: { subtotal, fees, addonTotal: 0, discount: coupon.amount, total, currency: cart.pricing?.currency || 'UGX', split: calculateCommission(total, hasReferral) },
    validatedAt: nowIso(),
  };
}
async function validateCart(cartRefValue, options = {}) {
  const cart = cartOrThrow(cartRefValue);
  try {
    const validation = validateCartSync(cart);
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
function markSeatCommitted(line, bookingRef) {
  const seat = store.seatsForSchedule(line.scheduleId).find((row) => row.seatNumber === line.seatNumber);
  if (seat) { seat.status = 'taken'; seat.bookingRef = bookingRef; seat.lockedUntil = null; seat.lockId = null; seat.updatedAt = nowIso(); }
  const schedule = store.state.schedules.find((row) => row.id === line.scheduleId);
  if (schedule) { schedule.availableSeats = Math.max(0, Number(schedule.availableSeats || 0) - 1); schedule.updatedAt = nowIso(); }
}
function markHotelCommitted(line, bookingRef) {
  (store.state.roomNightInventories || []).filter((night) => line.nightIds.includes(night.id)).forEach((night) => {
    night.status = 'booked'; night.bookingRef = bookingRef; night.guestName = line.guest.fullName; night.checkInStatus = 'not_checked'; night.updatedAt = nowIso();
  });
}
function buildBooking(cart, payment, lines) {
  const bookingRef = generateBookingRef('cart');
  const groupedItems = lines.map((line, index) => ({
    id: `cart-line-${index + 1}`,
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
  const ticketLegs = lines.map((line, index) => ({
    id: `${bookingRef}-LEG-${index + 1}`,
    ticketNumber: `${bookingRef}-${index + 1}`,
    serviceType: line.serviceType,
    listingId: line.listingId,
    scheduleId: line.scheduleId || '',
    seatNumber: line.seatNumber || '',
    roomUnitId: line.roomUnitId || '',
    roomNumber: line.roomNumber || '',
    passengerName: line.passenger?.fullName || line.guest?.fullName || cart.customer.fullName,
    qrToken: `CLASSIC-TRIP:CART:${bookingRef}:${index + 1}:${Date.now()}`,
    status: 'confirmed',
    checkInStatus: 'pending',
  }));
  return {
    id: nextId('booking', store.state.bookings),
    bookingRef,
    guestLookupCode: generateCode('LOOKUP', 8),
    serviceType: 'cart',
    cartRef: cart.cartRef,
    checkoutGroupId: cart.cartRef,
    guestSnapshot: cart.customer,
    customerUserId: cart.userId || null,
    companyId: groupedItems[0]?.companyId || 'multi-company',
    listingId: groupedItems[0]?.listingId || 'multi-service',
    passengers: lines.map((line, index) => ({ id: `cart-passenger-${index + 1}`, ...(line.passenger || line.guest || {}), seatOrRoom: line.seatNumber || line.roomNumber || '' })),
    bookingItems: groupedItems,
    bookingLegs: cart.items.map((item) => ({ id: item.id, serviceType: item.serviceType, status: 'confirmed' })),
    ticketLegs,
    tripType: lines.some((line) => line.serviceType === 'bus') && lines.some((line) => line.serviceType === 'hotel') ? 'multi_service' : 'single_service_cart',
    pricing: cart.pricing,
    paymentStatus: payment.status || 'successful',
    paymentProvider: payment.provider,
    paymentRef: payment.providerReference,
    checkoutUrl: payment.checkoutUrl || '',
    bookingStatus: payment.status === 'successful' ? 'confirmed' : 'pending_payment',
    qrCodeValue: `CLASSIC-TRIP:CART:${bookingRef}:${Date.now()}`,
    createdAt: nowIso(),
  };
}
function recordLedgerAndCommission(booking, lines) {
  const currency = booking.pricing.currency || 'UGX';
  walletService.creditAvailable('platform', 'platform', booking.pricing.split.platformFee || 0, { currency, transactionType: 'cart_platform_fee', referenceType: 'cart_booking', referenceId: booking.id });
  const byCompany = new Map();
  lines.forEach((line) => byCompany.set(line.companyId, (byCompany.get(line.companyId) || 0) + Number(line.price || 0)));
  const totalLineAmount = Array.from(byCompany.values()).reduce((sum, value) => sum + value, 0) || 1;
  byCompany.forEach((gross, companyId) => {
    const companyShare = Math.round((booking.pricing.split.companyAmount || 0) * (gross / totalLineAmount));
    walletService.creditPending('company', companyId, companyShare, { currency, transactionType: 'cart_company_earning_pending', referenceType: 'cart_booking', referenceId: booking.id });
  });
  if (booking.promoterAttribution?.promoterId) {
    walletService.creditPending('promoter', booking.promoterAttribution.promoterId, booking.pricing.split.promoterAmount || 0, { currency, transactionType: 'cart_promoter_commission_pending', referenceType: 'cart_booking', referenceId: booking.id });
  }
  commissionService.createCommission(booking, Boolean(booking.promoterAttribution), booking.pricing.split);
}
async function checkout(cartRefValue, payload = {}, req = {}) {
  const cart = await validateCart(cartRefValue);
  if (!cart.validation || cart.validation.status !== 'valid') { const error = new Error('Cart is not valid for checkout'); error.status = 422; throw error; }
  const attempt = { id: attemptId(), cartRef: cart.cartRef, status: 'started', pricingSnapshot: cart.pricing, inventorySnapshot: cart.validation.lines, createdBy: cart.userId || req?.session?.user?.id || 'guest', createdAt: nowIso() };
  store.state.cartCheckoutAttempts.unshift(attempt);
  await upsert('cartCheckoutAttempts', attempt);
  if (payload.forcePaymentFailure) {
    cart.status = 'payment_failed';
    cart.recoveryState = { type: 'payment_failed', message: 'Payment could not be completed. Inventory was not consumed.', action: 'Try another payment method', recoveryUrl: `/cart/${cart.cartRef}/recovery` };
    attempt.status = 'failed'; attempt.failureType = 'payment_failed'; attempt.failureReason = cart.recoveryState.message; attempt.recoveryAction = cart.recoveryState.action; attempt.recoveryUrl = cart.recoveryState.recoveryUrl;
    await upsert('carts', cart); await upsert('cartCheckoutAttempts', attempt);
    return { cart, attempt, booking: null, payment: null };
  }
  const provider = paymentService.resolveProviderName(payload.provider || payload.paymentProvider);
  const payment = await paymentService.initiatePayment({
    provider,
    bookingRef: cart.cartRef,
    amount: cart.pricing.total,
    currency: cart.pricing.currency,
    customer: cart.customer,
    callbackUrl: `${env.appUrl}/booking/payment/callback?cartRef=${encodeURIComponent(cart.cartRef)}`,
    description: `Classic Trip cart checkout ${cart.cartRef}`,
  });
  const booking = buildBooking(cart, payment, cart.validation.lines);
  try {
    cart.validation.lines.forEach((line) => { if (line.serviceType === 'bus') markSeatCommitted(line, booking.bookingRef); if (line.serviceType === 'hotel') markHotelCommitted(line, booking.bookingRef); });
    store.state.bookings.unshift(booking);
    const paymentRow = { id: nextId('payment', store.state.payments), bookingId: booking.id, bookingRef: booking.bookingRef, amount: cart.pricing.total, currency: cart.pricing.currency, status: payment.status || 'pending', provider: payment.provider || provider, providerReference: payment.providerReference, customerUserId: cart.userId || null, idempotencyKey: `cart:${cart.cartRef}`, metadata: { cartRef: cart.cartRef, itemCount: cart.items.length, ticketCount: booking.ticketLegs.length }, checkoutUrl: payment.checkoutUrl || '', createdAt: nowIso(), paidAt: (payment.status || 'pending') === 'successful' ? (payment.paidAt || nowIso()) : null };
    store.state.payments.unshift(paymentRow);
    if (paymentRow.status === 'successful') recordLedgerAndCommission(booking, cart.validation.lines);
    cart.status = paymentRow.status === 'successful' ? 'checked_out' : 'payment_pending';
    cart.paymentId = paymentRow.id; cart.paymentRef = paymentRow.providerReference; cart.checkoutUrl = paymentRow.checkoutUrl || ''; cart.bookingRef = booking.bookingRef; cart.childBookingRefs = [booking.bookingRef]; cart.checkedOutAt = nowIso(); cart.recoveryState = null;
    attempt.status = 'completed'; attempt.bookingRef = booking.bookingRef; attempt.paymentId = paymentRow.id; attempt.providerReference = paymentRow.providerReference; attempt.resolvedAt = nowIso();
    const notificationTitle = paymentRow.status === 'successful' ? 'Cart checkout confirmed' : 'Cart checkout payment pending';
    const notificationMessage = paymentRow.status === 'successful'
      ? `${booking.bookingRef} confirmed with ${booking.ticketLegs.length} ticket/stay unit(s).`
      : `${booking.bookingRef} is waiting for payment confirmation. Checkout: ${paymentRow.checkoutUrl || 'payment link pending'}`;
    store.state.notifications.unshift({ id: nextId('notification', store.state.notifications), userId: cart.userId || 'guest', channels: ['email', 'sms'], title: notificationTitle, message: notificationMessage, status: 'queued', referenceType: 'cart_booking', referenceId: booking.id, meta: { bookingRef: booking.bookingRef, checkoutUrl: paymentRow.checkoutUrl || '' }, createdAt: nowIso() });
    store.state.auditLogs.unshift({ id: nextId('audit', store.state.auditLogs), actorId: cart.userId || 'guest', actorRole: 'customer', action: 'cart.checkout.completed', targetType: 'cart', targetId: cart.cartRef, status: 'success', createdAt: nowIso(), meta: { bookingRef: booking.bookingRef, paymentId: paymentRow.id } });
    await Promise.all([upsert('bookings', booking), upsert('payments', paymentRow), upsert('carts', cart), upsert('cartCheckoutAttempts', attempt)]);
    return { cart, attempt, booking, payment: paymentRow };
  } catch (error) {
    cart.status = 'inventory_failed';
    cart.recoveryState = { type: 'inventory_failed', message: error.message, action: 'Review unavailable items and checkout again', recoveryUrl: `/cart/${cart.cartRef}/recovery` };
    attempt.status = 'failed'; attempt.failureType = 'inventory_failed'; attempt.failureReason = error.message; attempt.recoveryAction = cart.recoveryState.action; attempt.recoveryUrl = cart.recoveryState.recoveryUrl;
    await upsert('carts', cart); await upsert('cartCheckoutAttempts', attempt);
    throw error;
  }
}
async function releaseRecoverableCart(cartRefValue, reason = 'customer_recovery') {
  const cart = cartOrThrow(cartRefValue);
  if (!RECOVERABLE_STATUSES.includes(cart.status)) return cart;
  cart.status = 'draft';
  cart.recoveryState = { type: 'released', message: 'Cart recovered. Please revalidate current inventory before checkout.', action: 'Revalidate cart', recoveryUrl: `/cart/${cart.cartRef}` };
  cart.updatedAt = nowIso();
  await upsert('carts', cart);
  store.state.auditLogs.unshift({ id: nextId('audit', store.state.auditLogs), actorId: 'cart-system', action: 'cart.recovered', targetType: 'cart', targetId: cart.cartRef, status: 'success', createdAt: nowIso(), meta: { reason } });
  return cart;
}
function cartRows() {
  return (store.state.carts || []).map((cart) => [cart.cartRef, String(cart.items?.length || 0), cart.customer?.fullName || 'Guest', cart.pricing?.currency || 'UGX', String(cart.pricing?.total || 0), cart.status || 'draft']);
}
function checkoutAttemptRows() {
  return (store.state.cartCheckoutAttempts || []).map((attempt) => [attempt.id, attempt.cartRef, attempt.bookingRef || '-', attempt.providerReference || '-', attempt.failureType || '-', attempt.status || 'started']);
}

module.exports = { createCart, addItem, findCart, publicCart, validateCart, checkout, releaseRecoverableCart, cartRows, checkoutAttemptRows };
