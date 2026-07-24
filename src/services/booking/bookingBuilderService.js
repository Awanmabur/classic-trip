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

async function buildBooking(payload = {}, req = null) {
  const listingKey = clean(payload.listingId || payload.slug);
  const listing = await commerceRepository.listings.findOne({ $or: [{ id: listingKey }, { slug: listingKey }] });
  if (!listing) { const error = new Error('Listing not found'); error.status = 404; throw error; }
  const company = await commerceRepository.companies.findOne({ $or: [{ id: listing.companyId }, { slug: listing.companySlug || listing.companyId }] });
  if (listing.status !== 'active' || listing.bookable === false) { const error = new Error('This listing is not currently open for booking'); error.status = 409; throw error; }
  if (!ENABLED_BOOKING_TYPES.includes(listing.serviceType)) { const error = new Error('This service is not currently bookable'); error.status = 409; throw error; }
  if (listing.serviceType === 'hotel') {
    const error = new Error('Hotel bookings must use the canonical hotel reservation engine');
    error.status = 409;
    error.code = 'CANONICAL_HOTEL_ENGINE_REQUIRED';
    throw error;
  }
  if (company && (company.verificationStatus !== 'verified' || company.status === 'suspended' || company.settings?.canPublish === false)) { const error = new Error('Company must be verified before it can receive bookings'); error.status = 403; throw error; }
  const bookingCurrency = clean(listing.currency || company?.operatingCurrency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(bookingCurrency)) { const error = new Error('The listing has no valid operating currency'); error.status = 422; throw error; }
  const buyer = buyerIdentity(payload, req);

  const passengerInput = passengerInputFromPayload(payload);
  if (!passengerInput.length) passengerInput.push({ ...buyer });
  const promoterAttribution = await resolveReferral(payload, req, listing.id);
  let scheduleId = clean(payload.scheduleId);
  let selected = '';
  let subtotal = Number(listing.priceFrom || 0);
  let tripType = 'one_way';
  let busSelections = [];

  {
    const outbound = await scheduleForListing(listing.id, scheduleId);
    scheduleId = outbound?.id || '';
    const passengerCount = Math.max(1, passengerInput.length, seatListFrom(payload.selectedSeats || payload.selected || payload.seatNumber).length, seatListFrom(payload.returnSeats).length);
    if (passengerInput.length < passengerCount || passengerInput.slice(0, passengerCount).some((row) => !clean(row.fullName || row.name))) {
      const error = new Error('Provide exactly one passenger name for every selected seat');
      error.status = 422;
      throw error;
    }
    busSelections = await selectBusLeg(listing, outbound, payload.selectedSeats || payload.selected || payload.seatNumber, passengerCount, 'outbound', payload.holdId);
    if (payload.returnScheduleId) {
      const returning = await scheduleForListing(listing.id, payload.returnScheduleId);
      if (!returning || returning.id !== payload.returnScheduleId || new Date(returning.departAt) <= new Date(outbound.departAt)) { const error = new Error('Return trip must depart after the outbound trip'); error.status = 409; throw error; }
      busSelections.push(...await selectBusLeg(listing, returning, payload.returnSeats, passengerCount, 'return', payload.holdId));
      tripType = 'round_trip';
    }
    selected = busSelections.filter((row) => row.legType === 'outbound').map((row) => row.seat.seatNumber).join(',');
    subtotal = busSelections.reduce((sum, row) => sum + row.price, 0);
  }

  const addons = selectedAddonsFor(listing, payload);
  const addonTotal = addons.reduce((sum, row) => sum + Number(row.price || 0), 0);
  const customerFees = calculateCustomerFees(subtotal);
  const fees = customerFees.totalFees;
  const computedTotal = customerFees.total + addonTotal;
  const total = computedTotal;
  const split = calculateCommission(total, Boolean(promoterAttribution), { commissionPercent: company?.commercialTerms?.commissionPercent });
  const bookingId = await nextId('booking');
  const bookingRef = `CT-${String(listing.serviceType || 'TRIP').toUpperCase()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  const initialPaymentStatus = payload.paymentStatus || (payload.deferPayment ? 'pending' : 'successful');
  const outboundSelections = busSelections.filter((row) => row.legType === 'outbound');
  const passengerRows = await Promise.all(Array.from({ length: Math.max(1, passengerInput.length, outboundSelections.length) }, async (_, index) => {
    const input = passengerInput[index] || {}; const seat = outboundSelections[index]?.seat;
    return { id: await nextId('passenger'), fullName: clean(input.fullName || input.name || (index === 0 ? payload.passengerName || buyer.fullName : '')), email: input.email || payload.email || '', phone: input.phone || payload.phone || '', seatOrRoom: seat?.seatNumber || selected, seatNumber: seat?.seatNumber || selected, pickupPoint: input.pickupPoint || payload.pickupPoint || '', dropoffPoint: input.dropoffPoint || payload.dropoffPoint || '', specialNotes: input.specialNotes || input.travelNotes || input.notes || '' };
  }));
  const bookingItems = await Promise.all(busSelections.map(async (row) => ({ id: await nextId('booking-item'), bookingRef, serviceType: 'bus', legType: row.legType, listingId: listing.id, scheduleId: row.schedule.id, seatNumber: row.seat.seatNumber, passengerIndex: row.passengerIndex, passengerName: passengerRows[row.passengerIndex]?.fullName, unitPrice: row.price, currency: bookingCurrency, status: 'confirmed' })));
  const ticketLegs = await Promise.all(busSelections.map(async (row, index) => {
    const id = await nextId('ticket-leg'); const nonce = qrNonceFor(bookingRef, row.schedule.id, row.seat.seatNumber, index + 1); const token = `CTQR-${bookingRef}-${id}-${nonce}`;
    return { id, bookingRef, ticketNumber: `${bookingRef}-${row.schedule.id}-${row.seat.seatNumber}`, legType: row.legType, serviceType: 'bus', listingId: listing.id, scheduleId: row.schedule.id, seatNumber: row.seat.seatNumber, passengerIndex: row.passengerIndex, passengerName: passengerRows[row.passengerIndex]?.fullName, qrNonce: nonce, qrToken: token, qrTokenHash: qrHash(token), qrTokenPreview: qrPreview(token), checkInStatus: 'boarding', status: 'valid', createdAt: new Date().toISOString() };
  }));
  const booking = {
    id: bookingId, bookingRef, guestLookupCode: crypto.randomBytes(6).toString('hex').toUpperCase(), serviceType: listing.serviceType,
    guestSnapshot: { ...buyer },
    buyerSnapshot: { ...buyer, idType: payload.idType || '', documentNumber: payload.documentNumber || '', notes: payload.notes || payload.customerNote || '' },
    customerUserId: payload.customerUserId || payload.userId || req?.session?.user?.id || null, companyId: listing.companyId, listingId: listing.id, scheduleId,
    passengers: passengerRows, bookingItems, bookingLegs: [...new Map(busSelections.map((row) => [row.legType, row])).values()].map((row) => ({ legType: row.legType, scheduleId: row.schedule.id, listingId: listing.id, companyId: listing.companyId, departAt: row.schedule.departAt, arriveAt: row.schedule.arriveAt, status: 'confirmed' })), ticketLegs,
    tripType, addons, notes: payload.notes || payload.customerNote || '', pricing: { subtotal, fees, addonTotal, total, currency: bookingCurrency, split, addons }, promoterAttribution,
    commercialTermsSnapshot: { model: 'percentage_commission', commissionPercent: split.partnerCommissionPercent, partnerPayoutPercent: split.partnerPayoutPercent, promoterSharePercent: split.promoterSharePercent, termsVersion: company?.commercialTerms?.termsVersion || getCachedPlatformConfig().commercialTermsVersion || 'commission-v1' },
    referralCode: promoterAttribution?.code || '', paymentStatus: initialPaymentStatus, bookingStatus: initialPaymentStatus === 'successful' ? 'confirmed' : 'pending', settlementStatus: 'pending',
    qrCodeValue: `CLASSIC-TRIP:${bookingRef}:${listing.id}:${Date.now()}`, lockedUntil: addMinutes(new Date(), getCachedPlatformConfig().holdMinutes).toISOString(), bookingChannel: payload.offlineSale ? 'agent_offline' : (payload.bookingChannel || 'web'), createdByAgentId: payload.agentId || '', createdAt: new Date().toISOString(),
  };
  booking.risk = fraudService.scoreBookingRisk(booking);
  return { booking, listing, company };
}

module.exports = { buildBooking, qrHash };
