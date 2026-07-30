const crypto = require('crypto');
const { ENABLED_BOOKING_TYPES } = require('../../config/constants');
const commerceRepository = require('../../repositories/domain/commerceRepository');
const promoterRepository = require('../../repositories/domain/promoterRepository');
const calculateCommission = require('../../utils/calculateCommission');
const { calculateCustomerFees } = require('../../utils/calculateCustomerFees');
const fraudService = require('../fraud/fraudService');
const { nextId } = require('../data/idService');
const { getCachedPlatformConfig } = require('../platform/platformConfigService');

function clean(value) { return String(value || '').trim(); }
function normalize(value) { return clean(value).toLowerCase(); }
function addMinutes(date, minutes) { return new Date(new Date(date).getTime() + Number(minutes || 0) * 60000); }
function toSlug(value) { return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

function parsePayloadArray(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (!value) return fallback;
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : fallback; } catch (_) { return fallback; }
}
function listPayloadValues(value) {
  if (Array.isArray(value)) return value.flatMap((item) => listPayloadValues(item));
  return clean(value).split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
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
  return Array.from({ length: count }, (_, index) => ({
    fullName: names[index] || '', phone: phones[index] || '', email: emails[index] || '',
    pickupPoint: pickups[index] || '', dropoffPoint: dropoffs[index] || '', notes: notes[index] || '', specialNotes: notes[index] || '',
  }));
}
function cleanSeatToken(value) {
  const raw = clean(value);
  const withoutPrefix = raw.replace(/^seat\s*(no\.?|number)?\s*/i, '').trim();
  const prefixed = withoutPrefix.match(/^[A-Za-z](\d+)$/);
  return prefixed ? prefixed[1] : withoutPrefix;
}
function seatListFrom(value) {
  if (Array.isArray(value)) return value.flatMap((seat) => seatListFrom(seat));
  return clean(value).split(',').map(cleanSeatToken).filter(Boolean);
}
function selectedAddonsFor(listing = {}, payload = {}) {
  const raw = payload.addons || payload.addonIds || payload.addon || [];
  const ids = new Set((Array.isArray(raw) ? raw : [raw]).flatMap((value) => clean(value).split(',')).map(toSlug).filter(Boolean));
  if (!ids.size) return [];
  const configured = Array.isArray(listing.addons) ? listing.addons : (Array.isArray(listing.optionalAddons) ? listing.optionalAddons : []);
  const catalog = configured.map((item) => {
    const row = typeof item === 'string' ? { name: item, price: 0 } : item || {};
    const name = clean(row.name || row.label || row.title);
    const id = toSlug(row.id || row.code || name);
    return { id, name, price: Number(row.price || row.amount || 0), currency: clean(row.currency || listing.currency) };
  }).filter((row) => row.id && row.name);
  const selected = catalog.filter((addon) => ids.has(addon.id));
  if (selected.length !== ids.size) {
    const error = new Error('One or more selected add-ons are not configured for this listing');
    error.status = 422;
    throw error;
  }
  return selected;
}
function buyerIdentity(payload = {}, req = null) {
  const sessionUser = req?.session?.user || {};
  const fullName = clean(payload.fullName || payload.customerName || sessionUser.fullName || sessionUser.name);
  const email = clean(payload.email || sessionUser.email).toLowerCase();
  const phone = clean(payload.phone || sessionUser.phone);
  if (!fullName) { const error = new Error('Customer full name is required'); error.status = 422; throw error; }
  if (!email && !phone) { const error = new Error('Provide a customer email or phone number'); error.status = 422; throw error; }
  return { fullName, email, phone };
}
function qrNonceFor(bookingRef, scheduleId, seatNumber, index) {
  return crypto.createHash('sha1').update(`${bookingRef}:${scheduleId}:${seatNumber}:${index}:${Date.now()}:${crypto.randomBytes(12).toString('hex')}`).digest('hex').slice(0, 16).toUpperCase();
}
function qrHash(token) { return crypto.createHash('sha256').update(clean(token)).digest('hex'); }
function qrPreview(token) { const value = clean(token); return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value; }
function isActiveLink(link = {}) {
  if (['archived', 'disabled', 'rejected', 'suspended'].includes(link.status)) return false;
  return !link.expiresAt || new Date(link.expiresAt) > new Date();
}
async function resolveReferral(payload, req, listingId) {
  const refCode = clean(payload.ref || req?.cookies?.ct_ref || req?.session?.referralCode || '');
  if (!refCode && payload.promoterAttribution && !req) return payload.promoterAttribution;
  if (!refCode) return null;
  const links = await promoterRepository.links.list({ status: { $nin: ['archived', 'disabled', 'rejected', 'suspended'] } });
  const link = links.find((row) => isActiveLink(row) && (!row.listingId || row.listingId === listingId) && [row.code, row.referralCode, clean(row.code).split('-').slice(0, -1).join('-')].some((value) => normalize(value) === normalize(refCode)));
  if (!link || req?.session?.user?.id === link.promoterId) return null;
  return { promoterId: link.promoterId, linkId: link.id, code: link.code || link.referralCode || refCode };
}
function usableSeat(seat, holdId) {
  if (!seat) return false;
  if (seat.status === 'available') return true;
  if (seat.status === 'locked') return Boolean(holdId && seat.lockId === holdId && (!seat.lockedUntil || new Date(seat.lockedUntil) > new Date()));
  return seat.status === 'taken' && !seat.bookingRef;
}
async function scheduleForListing(listingId, scheduleId) {
  if (scheduleId) return commerceRepository.schedules.findOne({ id: scheduleId, listingId });
  return (await commerceRepository.schedules.list({ listingId, status: { $nin: ['cancelled', 'archived'] } }, { sort: { departAt: 1 }, limit: 1 }))[0] || null;
}
async function selectBusLeg(listing, schedule, requestedSeats, passengerCount, legType, holdId) {
  if (!schedule || ['cancelled', 'archived'].includes(schedule.status)) { const error = new Error('Selected schedule is no longer available'); error.status = 409; throw error; }
  if (schedule.departAt && new Date(schedule.departAt) <= new Date()) { const error = new Error('Selected trip has already departed and can no longer be booked'); error.status = 409; throw error; }
  const seats = await commerceRepository.seats.list({ scheduleId: schedule.id }, { sort: { seatNumber: 1 } });
  const requested = seatListFrom(requestedSeats);
  const used = new Set();
  const selections = [];
  for (let index = 0; index < passengerCount; index += 1) {
    const requestedSeat = requested[index];
    let seat = requestedSeat ? seats.find((row) => row.seatNumber === requestedSeat && usableSeat(row, holdId)) : null;
    if (!seat) seat = seats.find((row) => usableSeat(row, holdId) && !used.has(row.seatNumber));
    if (!seat || used.has(seat.seatNumber)) { const error = new Error('Selected seat is no longer available'); error.status = 409; throw error; }
    used.add(seat.seatNumber);
    selections.push({ legType, schedule, seat, passengerIndex: index, price: Number(schedule.basePrice || listing.priceFrom || 0) + Number(seat.priceDelta || 0) });
  }
  return selections;
}

function isoDate(value, fieldName, { required = true } = {}) {
  const raw = clean(value);
  if (!raw && !required) return '';
  const date = raw ? new Date(`${raw.slice(0, 10)}T00:00:00.000Z`) : null;
  if (!date || Number.isNaN(date.getTime())) { const error = new Error(`${fieldName} is required and must be a valid date`); error.status = 422; throw error; }
  return date.toISOString().slice(0, 10);
}
function dateSpanDays(startValue, endValue, maximum = 90) {
  const start = new Date(`${startValue}T00:00:00.000Z`);
  const end = new Date(`${endValue}T00:00:00.000Z`);
  const days = Math.ceil((end - start) / 86400000);
  if (!Number.isFinite(days) || days < 1 || days > maximum) { const error = new Error(`Return date must be after pickup date and within ${maximum} days`); error.status = 422; throw error; }
  return days;
}
function boundedInteger(value, fallback, min, max, label) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) { const error = new Error(`${label} must be between ${min} and ${max}`); error.status = 422; throw error; }
  return parsed;
}

async function buildBooking(payload = {}, req = null) {
  const listingKey = clean(payload.listingId || payload.slug);
  const listing = await commerceRepository.listings.findOne({ $or: [{ id: listingKey }, { slug: listingKey }] });
  if (!listing) { const error = new Error('Listing not found'); error.status = 404; throw error; }
  const company = await commerceRepository.companies.findOne({ $or: [{ id: listing.companyId }, { slug: listing.companySlug || listing.companyId }] });
  if (listing.status !== 'active' || listing.bookable === false) { const error = new Error('This listing is not currently open for booking'); error.status = 409; throw error; }
  if (!ENABLED_BOOKING_TYPES.includes(listing.serviceType)) { const error = new Error('This service is not currently bookable'); error.status = 409; throw error; }
  if (listing.serviceType === 'hotel') {
    const error = new Error('Hotel bookings must use the canonical hotel reservation engine'); error.status = 409; error.code = 'CANONICAL_HOTEL_ENGINE_REQUIRED'; throw error;
  }
  if (listing.serviceType === 'local_transport' || listing.serviceType === 'flight') {
    const error = new Error(`This ${listing.serviceType === 'flight' ? 'flight' : 'ride'} must use its dedicated reservation engine`); error.status = 409; error.code = 'DEDICATED_BOOKING_ENGINE_REQUIRED'; throw error;
  }
  if (company && (company.verificationStatus !== 'verified' || company.status === 'suspended' || company.settings?.canPublish === false)) { const error = new Error('Company must be verified before it can receive bookings'); error.status = 403; throw error; }
  const bookingCurrency = clean(listing.currency || company?.operatingCurrency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(bookingCurrency)) { const error = new Error('The listing has no valid operating currency'); error.status = 422; throw error; }
  const buyer = buyerIdentity(payload, req);
  const serviceType = normalize(listing.serviceType).replace(/-/g, '_');
  const passengerInput = passengerInputFromPayload(payload);
  const promoterAttribution = await resolveReferral(payload, req, listing.id);
  let scheduleId = '';
  let subtotal = 0;
  let tripType = 'one_way';
  let passengerRows = [];
  let bookingItems = [];
  let bookingLegs = [];
  let ticketLegs = [];
  let serviceReservation = null;
  let quantity = 1;

  const bookingId = await nextId('booking');
  const bookingRef = `CT-${String(serviceType || 'TRIP').toUpperCase()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;

  if (serviceType === 'bus') {
    if (!passengerInput.length) passengerInput.push({ ...buyer });
    const outbound = await scheduleForListing(listing.id, clean(payload.scheduleId));
    scheduleId = outbound?.id || '';
    const passengerCount = Math.max(1, passengerInput.length, seatListFrom(payload.selectedSeats || payload.selected || payload.seatNumber).length, seatListFrom(payload.returnSeats).length);
    if (passengerInput.length < passengerCount || passengerInput.slice(0, passengerCount).some((row) => !clean(row.fullName || row.name))) {
      const error = new Error('Provide exactly one passenger name for every selected seat'); error.status = 422; throw error;
    }
    let busSelections = await selectBusLeg(listing, outbound, payload.selectedSeats || payload.selected || payload.seatNumber, passengerCount, 'outbound', payload.holdId);
    if (payload.returnScheduleId) {
      const returning = await scheduleForListing(listing.id, payload.returnScheduleId);
      if (!returning || returning.id !== payload.returnScheduleId) { const error = new Error('The selected return trip is no longer available'); error.status = 409; throw error; }
      busSelections.push(...await selectBusLeg(listing, returning, payload.returnSeats, passengerCount, 'return', payload.returnHoldId || payload.holdId));
      tripType = 'round_trip';
    }
    subtotal = busSelections.reduce((sum, row) => sum + row.price, 0);
    quantity = passengerCount;
    const outboundSelections = busSelections.filter((row) => row.legType === 'outbound');
    passengerRows = await Promise.all(Array.from({ length: passengerCount }, async (_, index) => {
      const input = passengerInput[index] || {}; const seat = outboundSelections[index]?.seat;
      return { id: await nextId('passenger'), fullName: clean(input.fullName || input.name || (index === 0 ? payload.passengerName || buyer.fullName : '')), email: input.email || payload.email || '', phone: input.phone || payload.phone || '', seatOrRoom: seat?.seatNumber || '', seatNumber: seat?.seatNumber || '', pickupPoint: input.pickupPoint || payload.pickupPoint || '', dropoffPoint: input.dropoffPoint || payload.dropoffPoint || '', specialNotes: input.specialNotes || input.travelNotes || input.notes || '' };
    }));
    bookingItems = await Promise.all(busSelections.map(async (row) => ({ id: await nextId('booking-item'), bookingRef, serviceType: 'bus', legType: row.legType, listingId: listing.id, scheduleId: row.schedule.id, seatNumber: row.seat.seatNumber, passengerIndex: row.passengerIndex, passengerName: passengerRows[row.passengerIndex]?.fullName, unitPrice: row.price, currency: bookingCurrency, status: 'confirmed' })));
    bookingLegs = [...new Map(busSelections.map((row) => [row.legType, row])).values()].map((row) => ({ legType: row.legType, scheduleId: row.schedule.id, listingId: listing.id, companyId: listing.companyId, departAt: row.schedule.departAt, arriveAt: row.schedule.arriveAt, status: 'confirmed' }));
    ticketLegs = await Promise.all(busSelections.map(async (row, index) => {
      const id = await nextId('ticket-leg'); const nonce = qrNonceFor(bookingRef, row.schedule.id, row.seat.seatNumber, index + 1); const token = `CTQR-${bookingRef}-${id}-${nonce}`;
      return { id, bookingRef, ticketNumber: `${bookingRef}-${row.schedule.id}-${row.seat.seatNumber}`, legType: row.legType, serviceType: 'bus', listingId: listing.id, scheduleId: row.schedule.id, seatNumber: row.seat.seatNumber, passengerIndex: row.passengerIndex, passengerName: passengerRows[row.passengerIndex]?.fullName, qrNonce: nonce, qrToken: token, qrTokenHash: qrHash(token), qrTokenPreview: qrPreview(token), checkInStatus: 'boarding', status: 'valid', createdAt: new Date().toISOString() };
    }));
  } else if (serviceType === 'tour') {
    const serviceDate = isoDate(payload.serviceDate || payload.date || payload.activityDate, 'Tour date');
    if (new Date(`${serviceDate}T23:59:59.999Z`) < new Date()) { const error = new Error('Tour date cannot be in the past'); error.status = 422; throw error; }
    quantity = boundedInteger(payload.participantCount ?? payload.quantity ?? (passengerInput.length || 1), 1, 1, Math.min(50, Number(listing.maxGuests || 50)), 'Participant count');
    const available = Number(listing.remainingInventory ?? listing.inventory ?? 0);
    if (available < quantity) { const error = new Error(`Only ${Math.max(0, available)} tour place(s) remain`); error.status = 409; throw error; }
    while (passengerInput.length < quantity) passengerInput.push(passengerInput.length === 0 ? { ...buyer } : { fullName: `Guest ${passengerInput.length + 1}` });
    passengerRows = await Promise.all(passengerInput.slice(0, quantity).map(async (input, index) => ({ id: await nextId('passenger'), fullName: clean(input.fullName || input.name || (index === 0 ? buyer.fullName : `Guest ${index + 1}`)), email: input.email || (index === 0 ? buyer.email : ''), phone: input.phone || (index === 0 ? buyer.phone : ''), guestType: 'participant', specialNotes: input.specialNotes || payload.specialRequests || '' })));
    subtotal = Number(listing.priceFrom || 0) * quantity;
    serviceReservation = { serviceType, serviceDate, participantCount: quantity, meetingPoint: clean(payload.meetingPoint || listing.serviceDetails?.meetingPoint || listing.address), pickupLocation: clean(payload.pickupLocation || listing.from), language: clean(payload.language), specialRequests: clean(payload.specialRequests || payload.notes), status: 'reserved' };
  } else if (serviceType === 'car_rental') {
    const pickupDate = isoDate(payload.pickupDate || payload.startDate || payload.date, 'Pickup date');
    const returnDate = isoDate(payload.returnDate || payload.endDate, 'Return date');
    if (new Date(`${pickupDate}T23:59:59.999Z`) < new Date()) { const error = new Error('Pickup date cannot be in the past'); error.status = 422; throw error; }
    const rentalDays = dateSpanDays(pickupDate, returnDate, 90);
    const available = Number(listing.remainingInventory ?? listing.inventory ?? 0);
    if (available < 1) { const error = new Error('This rental vehicle is no longer available'); error.status = 409; throw error; }
    quantity = 1;
    passengerRows = [{ id: await nextId('passenger'), fullName: buyer.fullName, email: buyer.email, phone: buyer.phone, guestType: 'renter', specialNotes: clean(payload.specialRequests || payload.notes) }];
    subtotal = Number(listing.priceFrom || 0) * rentalDays;
    serviceReservation = { serviceType, pickupDate, returnDate, rentalDays, pickupLocation: clean(payload.pickupLocation || listing.from || listing.address), returnLocation: clean(payload.returnLocation || listing.to || listing.address), pickupTime: clean(payload.pickupTime), returnTime: clean(payload.returnTime), driverOption: clean(payload.driverOption || listing.serviceDetails?.driverOption || 'self_drive'), vehicleCategory: clean(listing.vehicleCategory), specialRequests: clean(payload.specialRequests || payload.notes), status: 'reserved' };
    tripType = 'round_trip';
  } else if (serviceType === 'cargo') {
    const pickupDate = isoDate(payload.pickupDate || payload.date, 'Cargo pickup date');
    if (new Date(`${pickupDate}T23:59:59.999Z`) < new Date()) { const error = new Error('Pickup date cannot be in the past'); error.status = 422; throw error; }
    const packageCount = boundedInteger(payload.packageCount ?? payload.quantity ?? 1, 1, 1, Math.min(100, Number(listing.packageLimit || 100)), 'Package count');
    const weightKg = Number(payload.weightKg || 0);
    if (!Number.isFinite(weightKg) || weightKg <= 0 || (Number(listing.weightLimitKg || 0) > 0 && weightKg > Number(listing.weightLimitKg))) { const error = new Error(`Cargo weight must be greater than zero${Number(listing.weightLimitKg || 0) > 0 ? ` and not exceed ${listing.weightLimitKg} kg` : ''}`); error.status = 422; throw error; }
    const pickupLocation = clean(payload.pickupLocation || listing.from);
    const deliveryLocation = clean(payload.deliveryLocation || listing.to);
    if (!pickupLocation || !deliveryLocation) { const error = new Error('Pickup and delivery locations are required'); error.status = 422; throw error; }
    quantity = packageCount;
    passengerRows = [{ id: await nextId('passenger'), fullName: buyer.fullName, email: buyer.email, phone: buyer.phone, guestType: 'sender', pickupPoint: pickupLocation, dropoffPoint: deliveryLocation, specialNotes: clean(payload.cargoDescription || payload.notes) }];
    const pricingUnit = normalize(listing.pricingUnit);
    subtotal = pricingUnit === 'per_kg' ? Number(listing.priceFrom || 0) * weightKg : Number(listing.priceFrom || 0) * (pricingUnit === 'per_package' ? packageCount : 1);
    const perKg = Number(listing.serviceDetails?.additionalPricePerKg || 0);
    if (pricingUnit !== 'per_kg' && perKg > 0) subtotal += perKg * weightKg;
    serviceReservation = { serviceType, pickupDate, pickupLocation, deliveryLocation, cargoType: clean(payload.cargoType || listing.cargoTypes?.[0] || 'parcel'), weightKg, packageCount, dimensions: clean(payload.dimensions), cargoDescription: clean(payload.cargoDescription || payload.notes), recipientName: clean(payload.recipientName), recipientPhone: clean(payload.recipientPhone), declaredValue: Math.max(0, Number(payload.declaredValue || 0)), status: 'reserved' };
  } else {
    const error = new Error('This service does not have an active booking engine'); error.status = 409; throw error;
  }

  if (serviceType !== 'bus') {
    bookingItems = [{ id: await nextId('booking-item'), bookingRef, serviceType, listingId: listing.id, quantity, unitPrice: Number(listing.priceFrom || 0), lineTotal: subtotal, currency: bookingCurrency, reservation: serviceReservation, status: 'confirmed' }];
    bookingLegs = [{ legType: 'service', listingId: listing.id, companyId: listing.companyId, serviceDate: serviceReservation?.serviceDate || serviceReservation?.pickupDate || '', status: 'confirmed' }];
    ticketLegs = await Promise.all(passengerRows.map(async (passenger, index) => {
      const id = await nextId('ticket-leg'); const nonce = qrNonceFor(bookingRef, listing.id, String(index + 1), index + 1); const token = `CTQR-${bookingRef}-${id}-${nonce}`;
      return { id, bookingRef, ticketNumber: `${bookingRef}-${index + 1}`, legType: 'service', serviceType, listingId: listing.id, passengerIndex: index, passengerName: passenger.fullName, qrNonce: nonce, qrToken: token, qrTokenHash: qrHash(token), qrTokenPreview: qrPreview(token), checkInStatus: 'pending', status: 'valid', createdAt: new Date().toISOString() };
    }));
  }

  const addons = selectedAddonsFor(listing, payload);
  const addonTotal = addons.reduce((sum, row) => sum + Number(row.price || 0), 0);
  const customerFees = calculateCustomerFees(subtotal);
  const fees = customerFees.totalFees;
  const total = customerFees.total + addonTotal;
  const split = calculateCommission(total, Boolean(promoterAttribution), { commissionPercent: company?.commercialTerms?.commissionPercent });
  const initialPaymentStatus = payload.paymentStatus || (payload.deferPayment ? 'pending' : 'successful');
  const booking = {
    id: bookingId, bookingRef, guestLookupCode: crypto.randomBytes(6).toString('hex').toUpperCase(), serviceType,
    guestSnapshot: { ...buyer }, buyerSnapshot: { ...buyer, idType: payload.idType || '', documentNumber: payload.documentNumber || '', notes: payload.notes || payload.customerNote || '' },
    customerUserId: payload.customerUserId || payload.userId || req?.session?.user?.id || null, companyId: listing.companyId, providerCompanyId: listing.companyId, listingId: listing.id, scheduleId,
    passengers: passengerRows, bookingItems, bookingLegs, ticketLegs, serviceReservation,
    tripType, quantity, addons, notes: payload.notes || payload.customerNote || '', pricing: { subtotal, fees, addonTotal, total, currency: bookingCurrency, split, addons }, promoterAttribution,
    commercialTermsSnapshot: { model: 'percentage_commission', commissionPercent: split.partnerCommissionPercent, partnerPayoutPercent: split.partnerPayoutPercent, promoterSharePercent: split.promoterSharePercent, termsVersion: company?.commercialTerms?.termsVersion || getCachedPlatformConfig().commercialTermsVersion || 'commission-v1' },
    referralCode: promoterAttribution?.code || '', paymentStatus: initialPaymentStatus, bookingStatus: initialPaymentStatus === 'successful' ? 'confirmed' : 'pending', settlementStatus: 'pending',
    qrCodeValue: `CLASSIC-TRIP:${bookingRef}:${listing.id}:${Date.now()}`, lockedUntil: addMinutes(new Date(), getCachedPlatformConfig().holdMinutes).toISOString(), bookingChannel: payload.offlineSale ? 'agent_offline' : (payload.bookingChannel || 'web'), createdByAgentId: payload.agentId || '', createdAt: new Date().toISOString(),
  };
  booking.risk = fraudService.scoreBookingRisk(booking);
  return { booking, listing, company };
}

module.exports = { buildBooking, qrHash };
