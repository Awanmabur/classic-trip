'use strict';

const crypto = require('crypto');
const repository = require('../../../repositories');
const { nextId } = require('../../../services/data/idService');
const { platformCurrency } = require('../../../utils/currency');
const { env } = require('../../../config/env');
const paymentService = require('../../../services/payment/paymentService');
const paymentSettlementService = require('../../../services/booking/paymentSettlementService');
const notificationService = require('../../../services/notification/notificationService');
const timelineService = require('../../../services/support/timelineService');
const { runMongoUnitOfWork, sessionOptions } = require('../../../services/shared/mongoUnitOfWork');
const FlightSchedule = require('../../../models/FlightSchedule');
const FlightOrder = require('../../../models/FlightOrder');
const FlightTicket = require('../../../models/FlightTicket');
const Booking = require('../../../models/Booking');
const BookingItem = require('../../../models/BookingItem');
const PaymentIntent = require('../../../models/PaymentIntent');
const Payment = require('../../../models/Payment');
const {
  normalizeSupplierType,
  supplierIsAvailable,
  assertScheduleSupplierAvailable,
  getSupplierAdapter,
} = require('../integrations/supplierRegistry');

const CABINS = new Set(['economy', 'premium_economy', 'business', 'first']);
const PASSENGER_TYPES = new Set(['adult', 'child', 'infant']);

function clean(value, max = 500) { return String(value || '').trim().slice(0, max); }
function normalize(value) { return clean(value).toLowerCase().replace(/[\s-]+/g, '_'); }
function amount(value, fallback = 0) { const number = Number(value); return Number.isFinite(number) ? Math.round(number * 100) / 100 : fallback; }
function fail(message, status = 422, code = 'flight_validation_failed') { const error = new Error(message); error.status = status; error.code = code; throw error; }
function now() { return new Date(); }
function sha256(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }
function secret(bytes = 24) { return crypto.randomBytes(bytes).toString('base64url'); }
function safeRegex(value) { return clean(value, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function validDate(value, label) {
  if (!value) fail(`${label} is required and must be a valid date`);
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) fail(`${label} is required and must be a valid date`);
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

function ageAt(dateOfBirth, travelDate) {
  let age = travelDate.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const monthDelta = travelDate.getUTCMonth() - dateOfBirth.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && travelDate.getUTCDate() < dateOfBirth.getUTCDate())) age -= 1;
  return age;
}

function passengerList(payload = {}, departureAt = new Date()) {
  const rows = Array.isArray(payload.travelers) ? payload.travelers : Array.isArray(payload.passengers) ? payload.passengers : [];
  const fallbackCount = Math.max(1, Math.min(9, Number(payload.passengerCount || payload.adults || 1)));
  const normalized = rows.length ? rows : Array.from({ length: fallbackCount }, (_, index) => ({
    fullName: index === 0 ? payload.fullName || payload.name : '',
    passengerType: 'adult',
    dateOfBirth: payload.dateOfBirth,
    sex: payload.sex,
    nationality: payload.nationality,
    documentType: payload.identityType || payload.documentType,
    documentNumber: payload.identityNumber || payload.documentNumber,
    documentExpiry: payload.documentExpiry,
    issuingCountry: payload.issuingCountry,
  }));
  if (normalized.length > 9) fail('A single flight booking may contain at most 9 travelers');
  const travelDate = validDate(departureAt, 'Flight departure date');
  const seenDocuments = new Set();
  return normalized.map((row, index) => {
    const travelerNumber = index + 1;
    const passengerType = normalize(row.passengerType || row.guestType || 'adult');
    if (!PASSENGER_TYPES.has(passengerType)) fail(`Traveler ${travelerNumber} has an invalid passenger type`);
    const fullName = clean(row.fullName || row.name, 160);
    if (!fullName || fullName.split(/\s+/).filter(Boolean).length < 2) fail(`Traveler ${travelerNumber} full legal name is required`);
    const dateOfBirth = validDate(row.dateOfBirth, `Traveler ${travelerNumber} date of birth`);
    if (dateOfBirth >= travelDate) fail(`Traveler ${travelerNumber} date of birth must be before departure`);
    const age = ageAt(dateOfBirth, travelDate);
    if (passengerType === 'adult' && age < 12) fail(`Traveler ${travelerNumber} must be 12 or older for an adult fare`);
    if (passengerType === 'child' && (age < 2 || age >= 12)) fail(`Traveler ${travelerNumber} must be aged 2 to 11 for a child fare`);
    if (passengerType === 'infant' && age >= 2) fail(`Traveler ${travelerNumber} must be under 2 for an infant fare`);
    const sex = normalize(row.sex);
    if (!['female', 'male', 'other'].includes(sex)) fail(`Traveler ${travelerNumber} sex is required`);
    const nationality = clean(row.nationality, 80);
    const issuingCountry = clean(row.issuingCountry, 80);
    if (!nationality || !issuingCountry) fail(`Traveler ${travelerNumber} nationality and issuing country are required`);
    const documentType = normalize(row.documentType || row.identityType);
    if (!['passport', 'national_id'].includes(documentType)) fail(`Traveler ${travelerNumber} travel document type is invalid`);
    const documentNumber = clean(row.documentNumber || row.identityNumber, 100).toUpperCase();
    if (!documentNumber) fail(`Traveler ${travelerNumber} travel document is required`);
    const documentKey = `${issuingCountry.toLowerCase()}:${documentType}:${documentNumber}`;
    if (seenDocuments.has(documentKey)) fail(`Traveler ${travelerNumber} travel document is duplicated in this booking`);
    seenDocuments.add(documentKey);
    const documentExpiry = validDate(row.documentExpiry, `Traveler ${travelerNumber} document expiry`);
    if (documentExpiry < travelDate) fail(`Traveler ${travelerNumber} travel document expires before departure`);
    const requests = Array.isArray(row.specialServiceRequests)
      ? row.specialServiceRequests
      : row.specialServiceRequests ? [row.specialServiceRequests] : [];
    return {
      id: clean(row.id) || `traveler-${travelerNumber}`,
      fullName,
      passengerType,
      dateOfBirth: dateOfBirth.toISOString().slice(0, 10),
      sex,
      nationality,
      documentType,
      documentNumber,
      documentExpiry: documentExpiry.toISOString().slice(0, 10),
      issuingCountry,
      seatNumber: clean(row.seatNumber, 8).toUpperCase(),
      specialServiceRequests: Array.from(new Set(requests.map((item) => normalize(item)).filter(Boolean))).slice(0, 10),
    };
  });
}
function contactSnapshot(payload = {}, req = {}) {
  const fullName = clean(payload.contactName || payload.fullName || payload.name, 160);
  const email = clean(payload.email, 180).toLowerCase();
  const phone = clean(payload.phone, 50);
  if (!fullName || !email || !phone) fail('Contact name, email, and phone are required');
  return { fullName, email, phone, ip: clean(req.ip, 80), userAgent: clean(req.headers?.['user-agent'], 300) };
}

function commercialTerms(company = {}) {
  const commissionPercent = amount(company.commercialTerms?.commissionPercent, 0);
  return {
    model: 'percentage_commission',
    commissionPercent,
    providerPayoutPercent: Math.max(0, 100 - commissionPercent),
    termsVersion: clean(company.commercialTerms?.termsVersion || 'commission-v1', 80),
    capturedAt: new Date().toISOString(),
  };
}

function scheduleSeatState(schedule = {}) {
  if (schedule.seatState instanceof Map) return Object.fromEntries(schedule.seatState.entries());
  return { ...(schedule.seatState || {}) };
}

function inventoryFor(schedule = {}, cabinClass = 'economy') {
  return (schedule.inventory || []).find((row) => normalize(row.cabinClass) === cabinClass) || null;
}

function fareTotal(fare = {}) { return amount(fare.baseFare) + amount(fare.taxes) + amount(fare.serviceFee); }

async function airportByInput(value) {
  const query = clean(value, 100);
  if (!query) return null;
  const exact = await repository.airports.findOne({ status: 'active', $or: [{ id: query }, { iataCode: query.toUpperCase() }] });
  if (exact) return exact;
  return repository.airports.findOne({ status: 'active', $or: [{ city: new RegExp(`^${safeRegex(query)}$`, 'i') }, { name: new RegExp(safeRegex(query), 'i') }] });
}

async function searchFlights(input = {}) {
  const origin = await airportByInput(input.origin || input.from);
  const destination = await airportByInput(input.destination || input.to);
  if (!origin || !destination) return { origin, destination, results: [], total: 0 };
  if (origin.id === destination.id) fail('Origin and destination airports must be different');
  const start = input.date ? new Date(`${clean(input.date, 10)}T00:00:00.000Z`) : new Date();
  if (Number.isNaN(start.getTime())) fail('A valid departure date is required');
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 1);
  const scheduleRows = await repository.flightSchedules.list({
    originAirportId: origin.id,
    destinationAirportId: destination.id,
    status: 'published',
    departureAt: { $gte: start, $lt: end },
  }, { sort: { departureAt: 1 }, limit: 100 });
  // External supplier inventory is never advertised unless its certified adapter is active.
  const schedules = scheduleRows.filter((schedule) => supplierIsAvailable(schedule.supplierType));
  const listingIds = [...new Set(schedules.map((row) => row.listingId))];
  const companyIds = [...new Set(schedules.map((row) => row.companyId))];
  const fareIds = [...new Set(schedules.flatMap((row) => row.fareIds || []))];
  const [listings, companies, fares] = await Promise.all([
    listingIds.length ? repository.listings.list({ id: { $in: listingIds }, serviceType: 'flight', status: 'active', bookable: true }) : [],
    companyIds.length ? repository.companies.list({ id: { $in: companyIds }, status: 'active', verificationStatus: 'verified' }) : [],
    fareIds.length ? repository.flightFares.list({ id: { $in: fareIds }, status: 'active' }) : [],
  ]);
  const listingMap = new Map(listings.map((row) => [row.id, row]));
  const companyMap = new Map(companies.map((row) => [row.id, row]));
  const fareMap = new Map(fares.map((row) => [row.id, row]));
  const cabinFilter = normalize(input.cabinClass || '');
  const passengerCount = Math.max(1, Math.min(9, Number(input.passengers || input.passengerCount || input.adults || 1)));
  const results = schedules.flatMap((schedule) => {
    const listing = listingMap.get(schedule.listingId);
    const company = companyMap.get(schedule.companyId);
    if (!listing || !company) return [];
    return (schedule.fareIds || []).map((id) => fareMap.get(id)).filter(Boolean).filter((fare) => !cabinFilter || fare.cabinClass === cabinFilter).map((fare) => {
      const inventory = inventoryFor(schedule, fare.cabinClass);
      const availableSeats = Math.max(0, Number(inventory?.totalSeats || 0) - Number(inventory?.heldSeats || 0) - Number(inventory?.bookedSeats || 0));
      return {
        id: `${schedule.id}:${fare.id}`,
        scheduleId: schedule.id,
        fareId: fare.id,
        listingId: listing.id,
        companyId: company.id,
        airline: company.name,
        title: listing.title,
        flightNumber: schedule.flightNumber,
        origin,
        destination,
        departureAt: schedule.departureAt,
        arrivalAt: schedule.arrivalAt,
        terminal: schedule.terminal || '',
        cabinClass: fare.cabinClass,
        fareName: fare.name,
        baggage: { checkedKg: fare.checkedBaggageKg || 0, cabinKg: fare.cabinBaggageKg || 0 },
        refundable: Boolean(fare.refundable),
        changeable: Boolean(fare.changeable),
        seatSelectionIncluded: Boolean(fare.seatSelectionIncluded),
        availableSeats,
        passengerCount,
        pricing: { unit: fareTotal(fare), total: fareTotal(fare) * passengerCount, currency: fare.currency },
        bookable: availableSeats >= passengerCount,
      };
    });
  });
  results.sort((a, b) => input.sort === 'cheapest' ? a.pricing.total - b.pricing.total : new Date(a.departureAt) - new Date(b.departureAt));
  return { origin, destination, results, total: results.length, passengerCount };
}

async function getFlightOffer(scheduleId, fareId) {
  const [schedule, fare] = await Promise.all([
    repository.flightSchedules.findOne({ id: clean(scheduleId), status: 'published' }),
    repository.flightFares.findOne({ id: clean(fareId), status: 'active' }),
  ]);
  if (!schedule || !fare || !(schedule.fareIds || []).includes(fare.id) || schedule.companyId !== fare.companyId) fail('Flight offer is no longer available', 404, 'flight_offer_not_found');
  const [listing, company, origin, destination, aircraft] = await Promise.all([
    repository.listings.findOne({ id: schedule.listingId, serviceType: 'flight', status: 'active', bookable: true }),
    repository.companies.findOne({ id: schedule.companyId, status: 'active', verificationStatus: 'verified' }),
    repository.airports.findOne({ id: schedule.originAirportId, status: 'active' }),
    repository.airports.findOne({ id: schedule.destinationAirportId, status: 'active' }),
    repository.aircraft.findOne({ id: schedule.aircraftId, companyId: schedule.companyId, status: 'active' }),
  ]);
  if (!listing || !company || !origin || !destination || !aircraft) fail('Flight offer is incomplete or unpublished', 409, 'flight_offer_incomplete');
  if (new Date(schedule.departureAt) <= new Date()) fail('This flight has already departed', 409, 'flight_departed');

  const supplier = assertScheduleSupplierAvailable(schedule);
  if (supplier.supplierType !== 'native') {
    const verified = await supplier.adapter.verifyOffer({ schedule, fare, listing, company, origin, destination, aircraft });
    if (!verified || verified.available === false) fail('The supplier could not verify this flight offer. No payment has been taken.', 409, 'flight_supplier_offer_unavailable');
    const seats = Array.isArray(verified.seats) ? verified.seats.map((seat) => ({
      seatNumber: clean(seat.seatNumber, 8).toUpperCase(),
      cabinClass: normalize(seat.cabinClass || fare.cabinClass),
      isBlocked: Boolean(seat.isBlocked),
      status: normalize(seat.status || 'available'),
    })).filter((seat) => seat.seatNumber && seat.cabinClass === fare.cabinClass) : [];
    const inventory = verified.inventory || {
      cabinClass: fare.cabinClass,
      totalSeats: Number(verified.availableSeats || seats.filter((seat) => seat.status === 'available').length || 0),
      heldSeats: 0,
      bookedSeats: 0,
    };
    return {
      schedule,
      fare: { ...fare, ...(verified.fare || {}) },
      listing,
      company,
      origin,
      destination,
      aircraft,
      seats,
      inventory,
      supplierType: supplier.supplierType,
      supplierAdapter: supplier.adapter,
      supplierOffer: verified.offerSnapshot || null,
    };
  }

  const state = scheduleSeatState(schedule);
  const seats = (aircraft.seatMap || []).filter((seat) => seat.cabinClass === fare.cabinClass).map((seat) => ({
    ...seat,
    status: seat.isBlocked ? 'blocked' : state[seat.seatNumber] ? String(state[seat.seatNumber]).split(':')[0] : 'available',
  }));
  const inventory = inventoryFor(schedule, fare.cabinClass);
  return { schedule, fare, listing, company, origin, destination, aircraft, seats, inventory, supplierType: 'native', supplierAdapter: null, supplierOffer: null };
}

function chooseSeats(offer = {}, travelers = [], requested = []) {
  const requestedSeats = [...new Set((Array.isArray(requested) ? requested : String(requested || '').split(',')).map((item) => clean(item, 8).toUpperCase()).filter(Boolean))];
  if (requestedSeats.length && requestedSeats.length !== travelers.length) fail('Select exactly one seat for each traveler');
  const available = (offer.seats || []).filter((seat) => seat.status === 'available' && !seat.isBlocked);
  const allowed = new Set(available.map((seat) => seat.seatNumber));
  if (requestedSeats.some((seat) => !allowed.has(seat))) fail('One or more selected seats are unavailable', 409, 'flight_seat_unavailable');
  const selected = requestedSeats.length ? requestedSeats : available.slice(0, travelers.length).map((seat) => seat.seatNumber);
  if (selected.length < travelers.length) fail('Not enough seats are available in this cabin', 409, 'flight_inventory_unavailable');
  return selected;
}

async function claimSeats(scheduleId, cabinClass, orderId, seats, session) {
  const conditions = seats.map((seatNumber) => ({ $or: [{ [`seatState.${seatNumber}`]: { $exists: false } }, { [`seatState.${seatNumber}`]: 'available' }] }));
  const set = Object.fromEntries(seats.map((seatNumber) => [`seatState.${seatNumber}`, `held:${orderId}`]));
  const updated = await FlightSchedule.findOneAndUpdate(
    { id: scheduleId, status: 'published', $and: conditions },
    { $set: set, $inc: { 'inventory.$[inventory].heldSeats': seats.length } },
    sessionOptions(session, { new: true, arrayFilters: [{ 'inventory.cabinClass': cabinClass }] }),
  ).lean();
  if (!updated) fail('Selected flight seats were taken by another traveler', 409, 'flight_seat_race_lost');
  const row = (updated.inventory || []).find((item) => item.cabinClass === cabinClass);
  if (!row || Number(row.heldSeats || 0) + Number(row.bookedSeats || 0) > Number(row.totalSeats || 0)) {
    const unset = Object.fromEntries(seats.map((seatNumber) => [`seatState.${seatNumber}`, '']));
    await FlightSchedule.updateOne(
      { id: scheduleId, ...Object.fromEntries(seats.map((seatNumber) => [`seatState.${seatNumber}`, `held:${orderId}`])) },
      { $unset: unset, $inc: { 'inventory.$[inventory].heldSeats': -seats.length } },
      sessionOptions(session, { arrayFilters: [{ 'inventory.cabinClass': cabinClass }] }),
    );
    fail('Flight cabin inventory is exhausted', 409, 'flight_inventory_unavailable');
  }
}

async function releaseOrderSeats(order = {}, from = 'held', session = null) {
  const seats = (order.travelers || []).map((traveler) => clean(traveler.seatNumber, 8).toUpperCase()).filter(Boolean);
  if (!seats.length) return;
  const unset = Object.fromEntries(seats.map((seatNumber) => [`seatState.${seatNumber}`, '']));
  const expected = `${from}:${order.id}`;
  const conditions = seats.map((seatNumber) => ({ [`seatState.${seatNumber}`]: expected }));
  const increment = from === 'held' ? { 'inventory.$[inventory].heldSeats': -seats.length } : { 'inventory.$[inventory].bookedSeats': -seats.length };
  await FlightSchedule.updateOne(
    { id: order.scheduleId, $and: conditions },
    { $unset: unset, $inc: increment },
    sessionOptions(session, { arrayFilters: [{ 'inventory.cabinClass': order.cabinClass }] }),
  );
}

async function createGuestBooking(payload = {}, req = {}) {
  const offer = await getFlightOffer(payload.scheduleId, payload.fareId);
  const travelers = passengerList(payload, offer.schedule.departureAt);
  const contact = contactSnapshot(payload, req);
  const nativeInventory = offer.supplierType === 'native';
  let supplierHold = null;
  let selectedSeats = [];

  if (nativeInventory) {
    selectedSeats = chooseSeats(offer, travelers, payload.selectedSeats || payload.seats);
    selectedSeats.forEach((seat, index) => { travelers[index].seatNumber = seat; });
    const availableSeats = Math.max(0, Number(offer.inventory?.totalSeats || 0) - Number(offer.inventory?.heldSeats || 0) - Number(offer.inventory?.bookedSeats || 0));
    if (availableSeats < travelers.length) fail('Not enough flight inventory remains', 409, 'flight_inventory_unavailable');
  } else {
    supplierHold = await offer.supplierAdapter.holdOffer({
      schedule: offer.schedule,
      fare: offer.fare,
      listing: offer.listing,
      company: offer.company,
      travelers,
      contact,
      requestedSeats: Array.isArray(payload.selectedSeats || payload.seats)
        ? payload.selectedSeats || payload.seats
        : String(payload.selectedSeats || payload.seats || '').split(',').filter(Boolean),
      offerSnapshot: offer.supplierOffer,
      idempotencyKey: `flight-hold:${offer.schedule.id}:${offer.fare.id}:${sha256(`${contact.email}:${contact.phone}:${JSON.stringify(travelers)}`)}`,
    });
    if (!supplierHold || supplierHold.held !== true || !clean(supplierHold.holdReference, 200)) {
      fail('The supplier could not hold this flight offer. No payment has been taken.', 409, 'flight_supplier_hold_failed');
    }
    const assignedSeats = Array.isArray(supplierHold.seats) ? supplierHold.seats : [];
    assignedSeats.forEach((seat, index) => { if (travelers[index]) travelers[index].seatNumber = clean(seat, 8).toUpperCase(); });
  }

  const [bookingId, itemId, orderId, paymentIntentId] = await Promise.all([nextId('booking'), nextId('booking-item'), nextId('flight-order'), nextId('payment-intent')]);
  const bookingRef = `CTF-${clean(bookingId).split('-').pop()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const orderRef = `FO-${clean(orderId).split('-').pop()}`;
  const holdToken = secret();
  const defaultExpiry = new Date(Date.now() + 15 * 60 * 1000);
  const supplierExpiry = supplierHold?.expiresAt ? new Date(supplierHold.expiresAt) : null;
  const expiresAt = supplierExpiry && !Number.isNaN(supplierExpiry.getTime()) && supplierExpiry > new Date()
    ? new Date(Math.min(defaultExpiry.getTime(), supplierExpiry.getTime()))
    : defaultExpiry;
  const unit = fareTotal(offer.fare);
  const total = amount(nativeInventory ? unit * travelers.length : supplierHold.total);
  if (total <= 0) fail('The verified flight price is invalid. No payment has been taken.', 409, 'flight_supplier_price_invalid');
  const pricing = {
    subtotal: total,
    fees: 0,
    addonTotal: 0,
    total,
    currency: clean(nativeInventory ? offer.fare.currency : supplierHold.currency, 3).toUpperCase() || offer.company.operatingCurrency || platformCurrency(),
    addons: [],
  };
  const booking = {
    id: bookingId,
    bookingRef,
    guestLookupCode: crypto.randomBytes(4).toString('hex').toUpperCase(),
    serviceType: 'flight',
    customerUserId: req.session?.user?.id || '',
    companyId: offer.company.id,
    tenantId: offer.company.id,
    tenantSlug: offer.company.slug,
    listingId: offer.listing.id,
    scheduleId: offer.schedule.id,
    passengers: travelers.map((traveler) => ({ ...traveler, scheduleId: offer.schedule.id, seatOrRoom: traveler.seatNumber, seatNumber: traveler.seatNumber })),
    bookingItems: [{ id: itemId, serviceType: 'flight', domainReservationId: orderId, scheduleId: offer.schedule.id, fareId: offer.fare.id, cabinClass: offer.fare.cabinClass, passengerCount: travelers.length }],
    bookingLegs: [{ type: 'flight', scheduleId: offer.schedule.id, flightNumber: offer.schedule.flightNumber, origin: offer.origin.iataCode, destination: offer.destination.iataCode, departureAt: offer.schedule.departureAt, arrivalAt: offer.schedule.arrivalAt }],
    ticketLegs: [],
    quantity: travelers.length,
    pricing,
    grossAmount: total,
    commercialTermsSnapshot: commercialTerms(offer.company),
    guestSnapshot: contact,
    buyerSnapshot: contact,
    paymentStatus: 'pending',
    bookingStatus: 'pending_payment',
    settlementStatus: 'pending_payment',
    bookingChannel: 'web',
    lockedUntil: expiresAt,
    qrCodeValue: `flight:${bookingRef}:${secret(16)}`,
    checkInStatus: 'not_checked',
    auditTrail: [{ at: new Date().toISOString(), action: 'flight.booking.created', actorId: req.session?.user?.id || 'guest' }],
  };
  const order = {
    id: orderId,
    orderRef,
    bookingId,
    bookingRef,
    bookingItemId: itemId,
    companyId: offer.company.id,
    listingId: offer.listing.id,
    scheduleId: offer.schedule.id,
    fareId: offer.fare.id,
    cabinClass: offer.fare.cabinClass,
    travelers,
    contact,
    pricing,
    holdTokenHash: sha256(holdToken),
    holdExpiresAt: expiresAt,
    supplierType: offer.supplierType,
    supplierHoldReference: clean(supplierHold?.holdReference, 200),
    supplierOfferSnapshot: supplierHold?.offerSnapshot || offer.supplierOffer || null,
    status: 'awaiting_payment',
  };
  const item = {
    id: itemId, bookingId, bookingRef, companyId: offer.company.id, listingId: offer.listing.id,
    serviceType: 'flight', domainReservationId: orderId, quantity: travelers.length, pricing,
    priceSnapshot: { fare: offer.fare, schedule: { id: offer.schedule.id, flightNumber: offer.schedule.flightNumber, departureAt: offer.schedule.departureAt, arrivalAt: offer.schedule.arrivalAt, supplierType: offer.supplierType }, capturedAt: new Date().toISOString() },
    policySnapshot: { refundable: offer.fare.refundable, changeable: offer.fare.changeable, changeFee: offer.fare.changeFee, cancellationFee: offer.fare.cancellationFee, policyText: offer.fare.policyText },
    status: 'awaiting_payment',
  };
  const provider = paymentService.resolveProviderName(payload.paymentProvider || payload.provider || env.paymentProvider);
  const intent = {
    id: paymentIntentId,
    intentRef: `PI-${bookingRef}`,
    bookingId,
    bookingRef,
    companyId: offer.company.id,
    customerUserId: booking.customerUserId,
    provider,
    idempotencyKey: `${provider}:${bookingRef}:initiate`,
    amount: total,
    currency: pricing.currency,
    status: 'created',
    expiresAt,
    attempts: [{ at: new Date().toISOString(), provider, status: 'created' }],
    metadata: { source: 'flightService.createGuestBooking', orderId, scheduleId: offer.schedule.id, supplierType: offer.supplierType },
  };

  try {
    await runMongoUnitOfWork(async (session) => {
      if (nativeInventory) await claimSeats(offer.schedule.id, offer.fare.cabinClass, orderId, selectedSeats, session);
      await Booking.create([booking], sessionOptions(session));
      await BookingItem.create([item], sessionOptions(session));
      await FlightOrder.create([order], sessionOptions(session));
      await PaymentIntent.create([intent], sessionOptions(session));
    });
  } catch (error) {
    if (!nativeInventory && supplierHold) {
      await offer.supplierAdapter.releaseHold({ schedule: offer.schedule, fare: offer.fare, holdReference: supplierHold.holdReference, reason: 'local_booking_transaction_failed' }).catch(() => null);
    }
    throw error;
  }

  let payment;
  try {
    payment = await paymentService.initiatePayment({
      provider,
      bookingRef,
      amount: total,
      currency: pricing.currency,
      customer: contact,
      idempotencyKey: intent.idempotencyKey,
      callbackUrl: `${env.appUrl}/booking/payment/callback?bookingRef=${encodeURIComponent(bookingRef)}`,
      description: `Classic Trip flight ${offer.schedule.flightNumber} ${bookingRef}`,
    });
    if (normalize(payment.status) === 'failed') fail(payment.message || 'Payment could not be initiated', 402, 'payment_failed');
  } catch (error) {
    await failPayment(bookingRef, error.message || 'Payment initiation failed', { provider, source: 'flight_checkout' });
    throw error;
  }

  await PaymentIntent.updateOne({ id: paymentIntentId }, { $set: {
    providerReference: clean(payment.providerReference, 200),
    checkoutUrl: clean(payment.checkoutUrl, 1000),
    status: normalize(payment.status) || 'pending',
    paidAt: normalize(payment.status) === 'successful' ? new Date() : null,
    attempts: [...intent.attempts, { at: new Date().toISOString(), provider, status: normalize(payment.status) || 'pending', providerReference: clean(payment.providerReference, 200) }],
  } }, { runValidators: true });
  await Booking.updateOne({ bookingRef }, { $set: { paymentProvider: provider, paymentRef: clean(payment.providerReference, 200), checkoutUrl: clean(payment.checkoutUrl, 1000) } }, { runValidators: true });
  if (normalize(payment.status) === 'successful') {
    await Payment.updateOne({ idempotencyKey: intent.idempotencyKey }, { $set: {
      id: `payment-${bookingRef}`, bookingId, bookingRef, companyId: offer.company.id, customerUserId: booking.customerUserId,
      provider, providerReference: clean(payment.providerReference, 200), amount: total, grossAmount: total, currency: pricing.currency,
      status: 'successful', paidAt: new Date(), idempotencyKey: intent.idempotencyKey, metadata: { source: 'flight_checkout_immediate' },
    } }, { upsert: true, runValidators: true });
    return confirmPayment(bookingRef, { provider, providerReference: payment.providerReference, source: 'immediate_payment' });
  }
  await timelineService.recordEvent({ bookingRef, bookingId, companyId: offer.company.id, customerUserId: booking.customerUserId, entityType: 'flight_order', entityId: orderId, action: 'flight.awaiting_payment', title: `Flight ${bookingRef} awaiting payment`, message: 'Seats are held temporarily while payment is completed.', status: 'pending_payment', actorType: 'system', actorId: 'flight-service' }).catch(() => null);
  return { ...booking, checkoutUrl: clean(payment.checkoutUrl, 1000), paymentProvider: provider, paymentRef: clean(payment.providerReference, 200), holdAccessToken: holdToken };
}

async function confirmPayment(bookingRef, context = {}) {
  const booking = await repository.bookings.findOne({ bookingRef: clean(bookingRef), serviceType: 'flight' });
  if (!booking) fail('Flight booking was not found', 404, 'flight_booking_not_found');
  if (booking.paymentStatus === 'successful' && booking.bookingStatus === 'confirmed') return booking;
  const order = await repository.flightOrders.findOne({ bookingRef: booking.bookingRef });
  if (!order) fail('Flight order was not found', 404, 'flight_order_not_found');
  const schedule = await repository.flightSchedules.findOne({ id: order.scheduleId });
  if (!schedule) fail('Flight schedule was not found', 404, 'flight_schedule_not_found');
  const supplier = assertScheduleSupplierAvailable({ ...schedule, supplierType: order.supplierType || schedule.supplierType });
  const existingTickets = await repository.flightTickets.list({ bookingRef: booking.bookingRef });
  const rawTokens = [];
  let supplierConfirmation = null;

  if (supplier.supplierType !== 'native' && !existingTickets.length) {
    supplierConfirmation = await supplier.adapter.confirmOrder({
      schedule,
      order,
      booking,
      holdReference: order.supplierHoldReference,
      offerSnapshot: order.supplierOfferSnapshot,
      payment: { provider: context.provider, providerReference: context.providerReference },
      idempotencyKey: `flight-confirm:${order.orderRef}`,
    });
    if (!supplierConfirmation || supplierConfirmation.confirmed !== true || !clean(supplierConfirmation.supplierReference, 200)) {
      fail('The flight supplier did not confirm the order. Payment requires reconciliation and no ticket was issued.', 409, 'flight_supplier_confirmation_required');
    }
    if (!Array.isArray(supplierConfirmation.tickets) || supplierConfirmation.tickets.length !== order.travelers.length) {
      fail('The flight supplier response did not contain one valid ticket per traveler.', 409, 'flight_supplier_ticket_mismatch');
    }
  }

  const tickets = existingTickets.length
    ? existingTickets.map((ticket, index) => {
      const token = `flight-ticket:${booking.bookingRef}:${index + 1}:${secret(18)}`;
      rawTokens.push(token);
      return { ...ticket, qrTokenHash: sha256(token), status: ticket.status || 'issued' };
    })
    : order.travelers.map((traveler, index) => {
      const token = `flight-ticket:${booking.bookingRef}:${index + 1}:${secret(18)}`;
      rawTokens.push(token);
      const supplierTicket = supplierConfirmation?.tickets?.[index] || {};
      const ticketNumber = supplier.supplierType === 'native'
        ? `${booking.bookingRef.replace(/[^A-Z0-9]/gi, '')}${String(index + 1).padStart(2, '0')}`
        : clean(supplierTicket.ticketNumber, 100).toUpperCase();
      if (!ticketNumber) fail(`Supplier ticket number is missing for traveler ${index + 1}`, 409, 'flight_supplier_ticket_invalid');
      return {
        id: `flight-ticket-${booking.bookingRef}-${index + 1}`,
        ticketNumber,
        orderId: order.id,
        orderRef: order.orderRef,
        bookingId: booking.id,
        bookingRef: booking.bookingRef,
        companyId: booking.companyId,
        listingId: booking.listingId,
        scheduleId: booking.scheduleId,
        travelerId: traveler.id,
        travelerName: traveler.fullName,
        seatNumber: clean(supplierTicket.seatNumber || traveler.seatNumber, 8).toUpperCase(),
        cabinClass: normalize(supplierTicket.cabinClass || order.cabinClass),
        qrTokenHash: sha256(token),
        issuedAt: new Date(),
        status: 'issued',
      };
    });
  if (new Set(tickets.map((ticket) => ticket.ticketNumber)).size !== tickets.length) {
    fail('Duplicate flight ticket numbers were returned during confirmation.', 409, 'flight_supplier_ticket_duplicate');
  }

  const seats = (order.travelers || []).map((traveler) => traveler.seatNumber).filter(Boolean);
  const heldConditions = seats.map((seatNumber) => ({ [`seatState.${seatNumber}`]: `held:${order.id}` }));
  const setBooked = Object.fromEntries(seats.map((seatNumber) => [`seatState.${seatNumber}`, `booked:${order.id}`]));
  await runMongoUnitOfWork(async (session) => {
    if (supplier.supplierType === 'native' && seats.length) {
      const updated = await FlightSchedule.findOneAndUpdate(
        { id: order.scheduleId, $and: heldConditions },
        { $set: setBooked, $inc: { 'inventory.$[inventory].heldSeats': -seats.length, 'inventory.$[inventory].bookedSeats': seats.length } },
        sessionOptions(session, { new: true, arrayFilters: [{ 'inventory.cabinClass': order.cabinClass }] }),
      ).lean();
      if (!updated) {
        const current = await FlightSchedule.findOne({ id: order.scheduleId }).session(session || null).lean();
        const state = scheduleSeatState(current || {});
        const alreadyBooked = seats.every((seatNumber) => state[seatNumber] === `booked:${order.id}`);
        if (!alreadyBooked) fail('Flight seat confirmation failed; payment requires reconciliation', 409, 'flight_confirmation_reconciliation_required');
      }
    }
    if (!existingTickets.length) await FlightTicket.insertMany(tickets, sessionOptions(session, { ordered: true }));
    else {
      for (const ticket of tickets) {
        await FlightTicket.updateOne({ id: ticket.id, bookingRef: booking.bookingRef }, { $set: { qrTokenHash: ticket.qrTokenHash, status: ticket.status } }, sessionOptions(session));
      }
    }
    const ticketLegs = tickets.map((ticket, index) => ({
      id: ticket.id,
      serviceType: 'flight',
      ticketNumber: ticket.ticketNumber,
      scheduleId: ticket.scheduleId,
      passengerIndex: index,
      passengerName: ticket.travelerName,
      seatNumber: ticket.seatNumber,
      cabinClass: ticket.cabinClass,
      qrCodeValue: rawTokens[index] || '',
      status: ticket.status,
    }));
    const supplierReference = supplier.supplierType === 'native'
      ? clean(schedule.supplierReference || `native:${order.orderRef}`, 200)
      : clean(supplierConfirmation?.supplierReference || order.supplierReference, 200);
    await FlightOrder.updateOne({ id: order.id }, { $set: {
      status: 'ticketed',
      confirmedAt: new Date(),
      ticketedAt: new Date(),
      supplierType: supplier.supplierType,
      supplierReference,
      supplierOrderSnapshot: supplierConfirmation?.orderSnapshot || order.supplierOrderSnapshot || null,
    } }, sessionOptions(session));
    await BookingItem.updateOne({ bookingRef: booking.bookingRef, serviceType: 'flight' }, { $set: { status: 'confirmed' } }, sessionOptions(session));
    await Booking.updateOne({ bookingRef: booking.bookingRef }, { $set: {
      paymentStatus: 'successful', bookingStatus: 'confirmed', settlementStatus: 'pending', paymentProvider: clean(context.provider, 50) || booking.paymentProvider,
      paymentRef: clean(context.providerReference, 200) || booking.paymentRef, lockedUntil: null, ticketLegs,
      auditTrail: [...(booking.auditTrail || []), { at: new Date().toISOString(), action: 'flight.payment.confirmed', actorId: clean(context.source, 80) || 'payment-system' }],
    } }, sessionOptions(session));
    await PaymentIntent.updateOne({ bookingRef: booking.bookingRef }, { $set: { status: 'successful', paidAt: new Date(), providerReference: clean(context.providerReference, 200) } }, sessionOptions(session));
  });
  let confirmed = await repository.bookings.findOne({ bookingRef: booking.bookingRef });
  try {
    Object.assign(confirmed, await paymentSettlementService.settleBookingPayment(confirmed, { source: context.source || 'flight_payment' }) || {});
    await repository.bookings.upsert(confirmed, { bookingRef: confirmed.bookingRef });
  } catch (error) {
    confirmed.settlementStatus = 'reconciliation_required';
    confirmed.settlementError = clean(error.message, 500);
    await repository.bookings.upsert(confirmed, { bookingRef: confirmed.bookingRef });
  }
  await timelineService.recordEvent({ bookingRef: confirmed.bookingRef, bookingId: confirmed.id, companyId: confirmed.companyId, customerUserId: confirmed.customerUserId, entityType: 'flight_order', entityId: order.id, action: 'flight.ticketed', title: `Flight tickets issued for ${confirmed.bookingRef}`, message: `${tickets.length} passenger ticket(s) were issued.`, status: 'confirmed', actorType: 'system', actorId: 'flight-service' }).catch(() => null);
  await notificationService.bookingConfirmed(confirmed).catch(() => null);
  return confirmed;
}

async function failPayment(bookingRef, reason = 'Payment failed', context = {}) {
  const booking = await repository.bookings.findOne({ bookingRef: clean(bookingRef), serviceType: 'flight' });
  const order = booking ? await repository.flightOrders.findOne({ bookingRef: booking.bookingRef }) : null;
  const schedule = order ? await repository.flightSchedules.findOne({ id: order.scheduleId }) : null;
  const supplierType = normalizeSupplierType(order?.supplierType || schedule?.supplierType);
  let supplierReleaseError = '';
  if (order && supplierType !== 'native') {
    const adapter = getSupplierAdapter(supplierType);
    if (adapter) {
      await adapter.releaseHold({
        schedule,
        order,
        holdReference: order.supplierHoldReference,
        reason: clean(reason, 500),
        idempotencyKey: `flight-release:${order.orderRef}`,
      }).catch((error) => { supplierReleaseError = clean(error.message, 500); });
    } else {
      supplierReleaseError = `Supplier adapter ${supplierType} was unavailable during hold release`;
    }
  }
  await runMongoUnitOfWork(async (session) => {
    if (order && supplierType === 'native') await releaseOrderSeats(order, 'held', session);
    if (booking) {
      await BookingItem.deleteMany({ bookingId: booking.id }, sessionOptions(session));
      await FlightOrder.deleteMany({ bookingId: booking.id }, sessionOptions(session));
      await FlightTicket.deleteMany({ bookingId: booking.id }, sessionOptions(session));
      await Payment.deleteMany({ bookingId: booking.id }, sessionOptions(session));
      await Booking.deleteOne({ id: booking.id }, sessionOptions(session));
    }
    await PaymentIntent.updateOne({ bookingRef: clean(bookingRef) }, { $set: {
      status: normalize(context.intentStatus || 'failed'),
      failedAt: new Date(),
      failureReason: clean(reason, 500),
      metadata: {
        source: clean(context.source, 100) || 'flight_payment',
        provider: clean(context.provider, 50),
        providerReference: clean(context.providerReference, 200),
        supplierType,
        supplierReleaseError,
      },
    } }, sessionOptions(session));
  });
  return {
    bookingRef: clean(bookingRef),
    purged: Boolean(booking),
    releasedSeats: supplierType === 'native' ? Number(order?.travelers?.length || 0) : 0,
    supplierHoldReleaseAttempted: Boolean(order && supplierType !== 'native'),
    supplierReleaseError,
    reason: clean(reason, 500),
  };
}

async function refundBooking(bookingRef, reason = 'Flight refund confirmed', context = {}) {
  const booking = await repository.bookings.findOne({ bookingRef: clean(bookingRef), serviceType: 'flight' });
  if (!booking) fail('Flight booking was not found', 404, 'flight_booking_not_found');
  const order = await repository.flightOrders.findOne({ bookingRef: booking.bookingRef });
  if (!order) fail('Flight order was not found', 404, 'flight_order_not_found');
  const schedule = await repository.flightSchedules.findOne({ id: order.scheduleId });
  if (schedule && new Date(schedule.departureAt) <= new Date()) fail('A flown or departed flight cannot release seat inventory automatically', 409, 'flight_already_departed');
  const supplier = assertScheduleSupplierAvailable({ ...(schedule || {}), supplierType: order.supplierType || schedule?.supplierType });
  let supplierRefund = null;
  if (supplier.supplierType !== 'native') {
    supplierRefund = await supplier.adapter.refundOrder({
      schedule,
      order,
      booking,
      supplierReference: order.supplierReference,
      amount: amount(booking.pricing?.total),
      currency: booking.pricing?.currency,
      reason: clean(reason, 500),
      idempotencyKey: `flight-refund:${order.orderRef}`,
      payment: { provider: context.provider, providerReference: context.providerReference },
    });
    if (!supplierRefund || supplierRefund.refunded !== true) {
      fail('The flight supplier did not confirm the refund. The booking remains unchanged for reconciliation.', 409, 'flight_supplier_refund_unconfirmed');
    }
  }
  await runMongoUnitOfWork(async (session) => {
    if (supplier.supplierType === 'native') await releaseOrderSeats(order, 'booked', session);
    await FlightOrder.updateOne({ id: order.id }, { $set: {
      status: 'refunded',
      cancelledAt: new Date(),
      cancellationReason: clean(reason, 500),
      supplierOrderSnapshot: supplierRefund?.refundSnapshot || order.supplierOrderSnapshot || null,
    } }, sessionOptions(session));
    await FlightTicket.updateMany({ bookingRef: booking.bookingRef }, { $set: { status: 'refunded' } }, sessionOptions(session));
    await BookingItem.updateMany({ bookingRef: booking.bookingRef }, { $set: { status: 'refunded' } }, sessionOptions(session));
    await Booking.updateOne({ bookingRef: booking.bookingRef }, { $set: {
      paymentStatus: 'refunded',
      bookingStatus: 'refunded',
      refundStatus: 'refunded',
      refundedAmount: booking.pricing?.total || 0,
      settlementStatus: 'refunded',
      cancellationReason: clean(reason, 500),
      cancelledAt: new Date(),
      'ticketLegs.$[].status': 'refunded',
    } }, sessionOptions(session));
  });
  return repository.bookings.findOne({ bookingRef: booking.bookingRef });
}

async function requestCancellation(bookingRef, requesterId = 'guest', reason = '') {
  const booking = await repository.bookings.findOne({ bookingRef: clean(bookingRef), serviceType: 'flight' });
  if (!booking) fail('Flight booking was not found', 404, 'flight_booking_not_found');
  const item = await repository.bookingItems.findOne({ bookingRef: booking.bookingRef, serviceType: 'flight' });
  if (!item?.policySnapshot?.refundable) fail('This fare is non-refundable. Contact support for an exceptional review.', 409, 'flight_non_refundable');
  const existing = await repository.refundRequests.findOne({ bookingRef: booking.bookingRef, status: { $in: ['pending', 'reviewing'] } });
  if (existing) return existing;
  const id = await nextId('refund');
  const row = {
    id,
    bookingId: booking.id,
    bookingRef: booking.bookingRef,
    companyId: booking.companyId,
    requesterId: clean(requesterId, 120),
    amount: Math.max(0, amount(booking.pricing?.total) - amount(item.policySnapshot?.cancellationFee)),
    currency: booking.pricing?.currency || platformCurrency(),
    reason: clean(reason || 'Traveler requested flight cancellation', 500),
    status: 'pending',
    metadata: { serviceType: 'flight', cancellationFee: amount(item.policySnapshot?.cancellationFee) },
  };
  await repository.refundRequests.insert(row);
  await repository.bookingItems.updateOne({ id: item.id }, { $set: { status: 'cancellation_pending' } });
  await repository.bookings.updateOne({ bookingRef: booking.bookingRef }, { $set: { bookingStatus: 'cancellation_pending', refundStatus: 'requested', cancellationReason: row.reason } });
  return row;
}

async function manifest(companyId, scheduleId) {
  const schedule = await repository.flightSchedules.findOne({ id: clean(scheduleId), companyId: clean(companyId) });
  if (!schedule) fail('Flight departure was not found for this company', 404, 'flight_schedule_not_found');
  const [orders, tickets, origin, destination] = await Promise.all([
    repository.flightOrders.list({ companyId: clean(companyId), scheduleId: schedule.id, status: { $in: ['confirmed', 'ticketed', 'in_progress', 'completed', 'no_show'] } }, { sort: { createdAt: 1 } }),
    repository.flightTickets.list({ companyId: clean(companyId), scheduleId: schedule.id }, { sort: { seatNumber: 1 } }),
    repository.airports.findOne({ id: schedule.originAirportId }),
    repository.airports.findOne({ id: schedule.destinationAirportId }),
  ]);
  const orderMap = new Map(orders.map((row) => [row.id, row]));
  return {
    schedule,
    origin,
    destination,
    rows: tickets.map((ticket) => {
      const order = orderMap.get(ticket.orderId) || {};
      const traveler = (order.travelers || []).find((row) => row.id === ticket.travelerId) || {};
      return {
        ticketNumber: ticket.ticketNumber,
        bookingRef: ticket.bookingRef,
        travelerName: ticket.travelerName,
        passengerType: traveler.passengerType || 'adult',
        documentNumber: traveler.documentNumber || '',
        nationality: traveler.nationality || '',
        seatNumber: ticket.seatNumber || '',
        cabinClass: ticket.cabinClass || '',
        status: ticket.status,
        contactPhone: order.contact?.phone || '',
      };
    }),
  };
}


async function flightListingReadiness(companyId, listingId) {
  const companyKey = clean(companyId);
  const listingKey = clean(listingId);
  const [company, listing, aircraftRows, fares, schedules] = await Promise.all([
    repository.companies.findOne({ id: companyKey }),
    repository.listings.findOne({ id: listingKey, companyId: companyKey, serviceType: 'flight' }),
    repository.aircraft.list({ companyId: companyKey, status: 'active' }, { limit: 500 }),
    repository.flightFares.list({ companyId: companyKey, status: 'active' }, { limit: 1000 }),
    repository.flightSchedules.list({ companyId: companyKey, listingId: listingKey, status: { $in: ['draft', 'published', 'boarding', 'delayed'] } }, { sort: { departureAt: 1 }, limit: 2000 }),
  ]);
  if (!listing) fail('Flight listing was not found for this airline', 404, 'flight_listing_not_found');
  const nowTime = Date.now();
  const activeAircraftIds = new Set(aircraftRows.filter((row) => Array.isArray(row.seatMap) && row.seatMap.some((seat) => !seat.isBlocked)).map((row) => String(row.id)));
  const activeFareIds = new Set(fares.map((row) => String(row.id)));
  const eligibleSchedules = schedules.filter((schedule) => {
    if ((new Date(schedule.departureAt).getTime() || 0) <= nowTime) return false;
    if (!activeAircraftIds.has(String(schedule.aircraftId || ''))) return false;
    const scheduleFareIds = Array.isArray(schedule.fareIds) ? schedule.fareIds.map(String) : [];
    if (!scheduleFareIds.some((id) => activeFareIds.has(id))) return false;
    return Array.isArray(schedule.inventory) && schedule.inventory.some((row) => Number(row.totalSeats || 0) > Number(row.heldSeats || 0) + Number(row.bookedSeats || 0));
  });
  const gaps = [];
  if (!company || normalize(company.status) !== 'active' || normalize(company.verificationStatus) !== 'verified') gaps.push('Airline company must be verified and active');
  if (!aircraftRows.length) gaps.push('Activate at least one aircraft with a complete seat map');
  if (!fares.length) gaps.push('Create at least one active fare family');
  if (!eligibleSchedules.length) gaps.push('Create a future departure linked to an active aircraft, fare and cabin inventory');
  return { ready: gaps.length === 0, gaps, company, listing, aircraft: aircraftRows, fares, schedules, eligibleSchedules };
}

async function publishFlightListing(companyId, listingId, actorId = 'company-admin') {
  const readiness = await flightListingReadiness(companyId, listingId);
  if (!readiness.ready) fail(`Flight listing is incomplete: ${readiness.gaps.join('; ')}`, 409, 'flight_listing_not_ready');
  const updatedAt = new Date();
  await runMongoUnitOfWork(async (session) => {
    await repository.listings.updateOne(
      { id: readiness.listing.id, companyId: clean(companyId), serviceType: 'flight' },
      { $set: { status: 'active', releaseStatus: 'published', bookable: true, isVerified: true, publishedAt: readiness.listing.publishedAt || updatedAt, updatedAt } },
      sessionOptions(session),
    );
    const draftIds = readiness.eligibleSchedules.filter((row) => normalize(row.status) === 'draft').map((row) => row.id);
    if (draftIds.length) await repository.flightSchedules.updateMany({ id: { $in: draftIds }, companyId: clean(companyId) }, { $set: { status: 'published' } }, sessionOptions(session));
    await repository.auditLogs.insert({
      id: await nextId('audit'), actorId: clean(actorId), action: 'flight.listing.published', entityType: 'listing', entityId: readiness.listing.id,
      companyId: clean(companyId), metadata: { eligibleScheduleIds: readiness.eligibleSchedules.map((row) => row.id), fareIds: readiness.fares.map((row) => row.id) }, createdAt: updatedAt,
    }, session ? { session } : undefined);
  });
  return repository.listings.findOne({ id: readiness.listing.id, companyId: clean(companyId) });
}

async function createAircraft(companyId, payload = {}) {
  const seatMap = Array.isArray(payload.seatMap) ? payload.seatMap : [];
  if (!seatMap.length) fail('Aircraft seat map is required');
  const seatNumbers = seatMap.map((row) => clean(row.seatNumber, 8).toUpperCase());
  if (new Set(seatNumbers).size !== seatNumbers.length) fail('Aircraft seat numbers must be unique');
  const id = await nextId('aircraft');
  const row = {
    id, companyId: clean(companyId), registrationNumber: clean(payload.registrationNumber, 40).toUpperCase(), manufacturer: clean(payload.manufacturer, 80), modelName: clean(payload.modelName, 80), aircraftTypeCode: clean(payload.aircraftTypeCode, 20).toUpperCase(),
    seatMap: seatMap.map((seat, index) => ({ seatNumber: seatNumbers[index], row: Number(seat.row || parseInt(seatNumbers[index], 10) || index + 1), column: clean(seat.column || seatNumbers[index].replace(/\d/g, ''), 3).toUpperCase(), cabinClass: normalize(seat.cabinClass || 'economy'), seatType: normalize(seat.seatType || 'middle'), isExitRow: Boolean(seat.isExitRow), isAccessible: Boolean(seat.isAccessible), isBlocked: Boolean(seat.isBlocked) })),
    totalSeats: seatMap.length,
    status: normalize(payload.status || 'draft'),
  };
  if (!row.registrationNumber || !row.manufacturer || !row.modelName) fail('Aircraft registration, manufacturer, and model are required');
  return repository.aircraft.insert(row);
}

async function updateAircraftStatus(companyId, aircraftId, status) {
  const nextStatus = normalize(status);
  if (!['draft', 'active', 'maintenance', 'suspended', 'retired'].includes(nextStatus)) fail('Choose a valid aircraft status');
  const aircraft = await repository.aircraft.findOne({ id: clean(aircraftId), companyId: clean(companyId) });
  if (!aircraft) fail('Aircraft was not found for this company', 404, 'aircraft_not_found');
  if (nextStatus === 'active' && (!Array.isArray(aircraft.seatMap) || !aircraft.seatMap.length)) fail('Aircraft needs a complete seat map before activation');
  await repository.aircraft.updateOne({ id: aircraft.id, companyId: clean(companyId) }, { $set: { status: nextStatus } });
  return repository.aircraft.findOne({ id: aircraft.id, companyId: clean(companyId) });
}

async function createFare(companyId, payload = {}) {
  const id = await nextId('flight-fare');
  const cabinClass = normalize(payload.cabinClass || 'economy');
  if (!CABINS.has(cabinClass)) fail('Choose a valid cabin class');
  const row = { id, companyId: clean(companyId), name: clean(payload.name, 100), code: clean(payload.code, 30).toUpperCase(), cabinClass, currency: clean(payload.currency || platformCurrency(), 3).toUpperCase(), baseFare: amount(payload.baseFare), taxes: amount(payload.taxes), serviceFee: amount(payload.serviceFee), checkedBaggageKg: amount(payload.checkedBaggageKg), cabinBaggageKg: amount(payload.cabinBaggageKg, 7), refundable: Boolean(payload.refundable === true || payload.refundable === 'true' || payload.refundable === 'on'), changeable: Boolean(payload.changeable === true || payload.changeable === 'true' || payload.changeable === 'on'), changeFee: amount(payload.changeFee), cancellationFee: amount(payload.cancellationFee), mealIncluded: Boolean(payload.mealIncluded === true || payload.mealIncluded === 'true' || payload.mealIncluded === 'on'), seatSelectionIncluded: Boolean(payload.seatSelectionIncluded === true || payload.seatSelectionIncluded === 'true' || payload.seatSelectionIncluded === 'on'), policyText: clean(payload.policyText, 1000), status: 'active' };
  if (!row.name || !row.code || row.baseFare < 0) fail('Fare name, code, and non-negative base fare are required');
  return repository.flightFares.insert(row);
}

async function createSchedule(companyId, payload = {}) {
  const [aircraft, listing, origin, destination] = await Promise.all([
    repository.aircraft.findOne({ id: clean(payload.aircraftId), companyId: clean(companyId) }),
    repository.listings.findOne({ id: clean(payload.listingId), companyId: clean(companyId), serviceType: 'flight' }),
    repository.airports.findOne({ id: clean(payload.originAirportId), status: 'active' }),
    repository.airports.findOne({ id: clean(payload.destinationAirportId), status: 'active' }),
  ]);
  if (!aircraft || !listing || !origin || !destination) fail('Choose an owned flight listing, aircraft, and valid airports');
  if (origin.id === destination.id) fail('Origin and destination airports must be different');
  const fareIds = [...new Set((Array.isArray(payload.fareIds) ? payload.fareIds : String(payload.fareIds || '').split(',')).map((value) => clean(value)).filter(Boolean))];
  const fares = fareIds.length ? await repository.flightFares.list({ id: { $in: fareIds }, companyId: clean(companyId), status: 'active' }) : [];
  if (!fares.length || fares.length !== fareIds.length) fail('Select at least one active fare owned by this company');
  const departureAt = new Date(payload.departureAt);
  const arrivalAt = new Date(payload.arrivalAt);
  if (Number.isNaN(departureAt.getTime()) || Number.isNaN(arrivalAt.getTime()) || arrivalAt <= departureAt) fail('Valid departure and arrival times are required');
  const counts = Object.fromEntries(['economy', 'premium_economy', 'business', 'first'].map((cabin) => [cabin, (aircraft.seatMap || []).filter((seat) => seat.cabinClass === cabin && !seat.isBlocked).length]));
  const inventory = [...new Set(fares.map((fare) => fare.cabinClass))].map((cabinClass) => ({ cabinClass, totalSeats: counts[cabinClass] || 0, heldSeats: 0, bookedSeats: 0 }));
  if (inventory.some((row) => row.totalSeats < 1)) fail('Aircraft seat map has no seats for one of the selected fare cabins');
  const id = await nextId('flight-schedule');
  return repository.flightSchedules.insert({ id, companyId: clean(companyId), listingId: listing.id, aircraftId: aircraft.id, flightNumber: clean(payload.flightNumber, 20).toUpperCase(), originAirportId: origin.id, destinationAirportId: destination.id, departureAt, arrivalAt, originTimezone: origin.timezone, destinationTimezone: destination.timezone, terminal: clean(payload.terminal, 30), gate: clean(payload.gate, 20), fareIds, inventory, seatState: {}, supplierType: 'native', status: 'draft', notes: clean(payload.notes, 1000) });
}

async function publishSchedule(companyId, scheduleId) {
  const schedule = await repository.flightSchedules.findOne({ id: clean(scheduleId), companyId: clean(companyId) });
  if (!schedule) fail('Flight schedule was not found', 404, 'flight_schedule_not_found');
  if (new Date(schedule.departureAt) <= new Date()) fail('Only a future flight can be published');
  const [aircraft, listing, fares] = await Promise.all([
    repository.aircraft.findOne({ id: schedule.aircraftId, companyId: clean(companyId), status: 'active' }),
    repository.listings.findOne({ id: schedule.listingId, companyId: clean(companyId), serviceType: 'flight', status: 'active', bookable: true }),
    repository.flightFares.list({ id: { $in: schedule.fareIds || [] }, companyId: clean(companyId), status: 'active' }),
  ]);
  if (!aircraft || !listing || !fares.length) fail('Activate the aircraft, publish the flight listing, and keep at least one fare active before publishing');
  await repository.flightSchedules.updateOne({ id: schedule.id, companyId: clean(companyId) }, { $set: { status: 'published' } });
  return repository.flightSchedules.findOne({ id: schedule.id });
}


const SCHEDULE_TRANSITIONS = Object.freeze({
  draft: ['published', 'cancelled'],
  published: ['delayed', 'boarding', 'cancelled'],
  delayed: ['published', 'boarding', 'cancelled'],
  boarding: ['departed', 'cancelled'],
  departed: ['arrived'],
  arrived: [],
  cancelled: [],
});

const TICKET_TRANSITIONS = Object.freeze({
  issued: ['checked_in', 'no_show', 'voided'],
  checked_in: ['boarded', 'no_show', 'voided'],
  boarded: ['flown', 'voided'],
  flown: [],
  no_show: [],
  voided: [],
  refunded: [],
});

async function transitionSchedule(companyId, scheduleId, payload = {}, actorId = 'company-admin') {
  const schedule = await repository.flightSchedules.findOne({ id: clean(scheduleId), companyId: clean(companyId) });
  if (!schedule) fail('Flight schedule was not found for this airline', 404, 'flight_schedule_not_found');
  const nextStatus = normalize(payload.status || payload.toStatus);
  if (!(SCHEDULE_TRANSITIONS[normalize(schedule.status)] || []).includes(nextStatus)) {
    fail(`Flight cannot move from ${schedule.status} to ${nextStatus}`, 409, 'flight_invalid_schedule_transition');
  }
  if (nextStatus === 'published' && new Date(schedule.departureAt) <= new Date()) fail('A past flight cannot be published');
  const update = { status: nextStatus, updatedAt: new Date() };
  if (Object.prototype.hasOwnProperty.call(payload, 'gate')) update.gate = clean(payload.gate, 20);
  if (Object.prototype.hasOwnProperty.call(payload, 'terminal')) update.terminal = clean(payload.terminal, 30);
  if (Object.prototype.hasOwnProperty.call(payload, 'notes')) update.notes = clean(payload.notes, 1000);
  if (nextStatus === 'delayed') {
    update.delayMinutes = Math.max(1, Math.min(1440, Number(payload.delayMinutes || 0)));
    if (!Number.isFinite(update.delayMinutes)) fail('Delay minutes are required');
  }
  if (nextStatus === 'published') update.delayMinutes = 0;

  const activeOrders = await repository.flightOrders.list({
    companyId: clean(companyId), scheduleId: schedule.id,
    status: { $in: ['confirmed', 'ticketed', 'in_progress'] },
  }, { limit: 5000 });

  await runMongoUnitOfWork(async (session) => {
    await FlightSchedule.updateOne({ id: schedule.id, companyId: clean(companyId), status: schedule.status }, { $set: update }, sessionOptions(session));

    if (nextStatus === 'cancelled') {
      for (const order of activeOrders) {
        await releaseOrderSeats(order, 'booked', session);
        const booking = await Booking.findOne({ bookingRef: order.bookingRef, companyId: clean(companyId) }).session(session || null).lean();
        if (!booking) continue;
        const existingRefund = await repository.refundRequests.findOne({ bookingRef: booking.bookingRef, status: { $in: ['pending', 'reviewing', 'approved'] } }, { session });
        let refundId = existingRefund?.id || '';
        if (!existingRefund) {
          refundId = await nextId('refund');
          await repository.refundRequests.insert({
            id: refundId, bookingId: booking.id, bookingRef: booking.bookingRef, companyId: booking.companyId,
            customerUserId: booking.customerUserId || '', requesterId: clean(actorId), amount: amount(booking.pricing?.total),
            currency: booking.pricing?.currency || platformCurrency(), reason: clean(payload.reason || `Flight ${schedule.flightNumber} was cancelled by the airline`, 500),
            status: 'pending', requestedAt: new Date(), metadata: { serviceType: 'flight', scheduleId: schedule.id, involuntary: true },
          }, { session });
        }
        await FlightOrder.updateOne({ id: order.id }, { $set: { status: 'cancelled', cancelledAt: new Date(), cancellationReason: clean(payload.reason || 'Flight cancelled by airline', 500) } }, sessionOptions(session));
        await FlightTicket.updateMany({ orderId: order.id }, { $set: { status: 'voided' } }, sessionOptions(session));
        await BookingItem.updateOne({ bookingRef: booking.bookingRef, serviceType: 'flight' }, { $set: { status: 'cancellation_pending' } }, sessionOptions(session));
        await Booking.updateOne({ bookingRef: booking.bookingRef }, { $set: {
          bookingStatus: 'cancellation_pending', refundStatus: 'requested', cancellationReason: clean(payload.reason || 'Flight cancelled by airline', 500),
          cancelledAt: new Date(), refundIds: Array.from(new Set([...(booking.refundIds || []), refundId].filter(Boolean))),
          'ticketLegs.$[].status': 'voided',
        } }, sessionOptions(session));
      }
    }

    if (nextStatus === 'departed') {
      await FlightTicket.updateMany({ companyId: clean(companyId), scheduleId: schedule.id, status: { $in: ['issued', 'checked_in'] } }, { $set: { status: 'no_show' } }, sessionOptions(session));
      await FlightOrder.updateMany({ companyId: clean(companyId), scheduleId: schedule.id, status: { $in: ['confirmed', 'ticketed'] } }, { $set: { status: 'in_progress' } }, sessionOptions(session));
      await Booking.updateMany({ companyId: clean(companyId), scheduleId: schedule.id, bookingStatus: 'confirmed' }, { $set: { bookingStatus: 'in_progress' } }, sessionOptions(session));
    }

    if (nextStatus === 'arrived') {
      await FlightTicket.updateMany({ companyId: clean(companyId), scheduleId: schedule.id, status: 'boarded' }, { $set: { status: 'flown' } }, sessionOptions(session));
      await FlightOrder.updateMany({ companyId: clean(companyId), scheduleId: schedule.id, status: 'in_progress' }, { $set: { status: 'completed' } }, sessionOptions(session));
      await BookingItem.updateMany({ companyId: clean(companyId), serviceType: 'flight', domainReservationId: { $in: activeOrders.map((row) => row.id) } }, { $set: { status: 'completed' } }, sessionOptions(session));
      await Booking.updateMany({ companyId: clean(companyId), scheduleId: schedule.id, bookingStatus: 'in_progress' }, { $set: { bookingStatus: 'completed', completedAt: new Date(), settlementStatus: 'eligible' } }, sessionOptions(session));
    }

    await repository.auditLogs.insert({
      id: await nextId('audit'), actorId: clean(actorId), action: `flight.schedule.${nextStatus}`, entityType: 'flight_schedule', entityId: schedule.id,
      companyId: clean(companyId), metadata: { fromStatus: schedule.status, toStatus: nextStatus, delayMinutes: update.delayMinutes || 0, reason: clean(payload.reason, 500) }, createdAt: new Date(),
    }, { session });
  });

  if (['delayed', 'cancelled'].includes(nextStatus)) {
    for (const order of activeOrders) {
      await timelineService.recordEvent({
        bookingRef: order.bookingRef, bookingId: order.bookingId, companyId: clean(companyId), entityType: 'flight_schedule', entityId: schedule.id,
        action: `flight.${nextStatus}`, title: nextStatus === 'delayed' ? `Flight ${schedule.flightNumber} delayed` : `Flight ${schedule.flightNumber} cancelled`,
        message: nextStatus === 'delayed' ? `The flight is delayed by ${update.delayMinutes} minutes.` : clean(payload.reason || 'The airline cancelled this flight. A refund review has been opened.', 500),
        status: nextStatus, actorType: 'company', actorId: clean(actorId),
      }).catch(() => null);
    }
  }
  return repository.flightSchedules.findOne({ id: schedule.id, companyId: clean(companyId) });
}

async function transitionTicket(companyId, ticketNumber, toStatus, actorId = 'company-staff') {
  const ticket = await repository.flightTickets.findOne({ ticketNumber: clean(ticketNumber).toUpperCase(), companyId: clean(companyId) });
  if (!ticket) fail('Flight ticket was not found for this airline', 404, 'flight_ticket_not_found');
  const nextStatus = normalize(toStatus);
  if (!(TICKET_TRANSITIONS[normalize(ticket.status)] || []).includes(nextStatus)) fail(`Ticket cannot move from ${ticket.status} to ${nextStatus}`, 409, 'flight_invalid_ticket_transition');
  const schedule = await repository.flightSchedules.findOne({ id: ticket.scheduleId, companyId: clean(companyId) });
  if (!schedule) fail('Ticket flight schedule was not found', 404, 'flight_schedule_not_found');
  if (nextStatus === 'boarded' && normalize(schedule.status) !== 'boarding') fail('Flight must be in boarding status before boarding passengers', 409, 'flight_not_boarding');
  if (nextStatus === 'flown' && normalize(schedule.status) !== 'arrived') fail('A ticket can be marked flown only after flight arrival', 409, 'flight_not_arrived');
  if (nextStatus === 'no_show' && !['departed', 'arrived'].includes(normalize(schedule.status))) fail('No-show can be confirmed only after departure', 409, 'flight_not_departed');
  const update = { status: nextStatus };
  if (nextStatus === 'checked_in') update.checkedInAt = new Date();
  if (nextStatus === 'boarded') update.boardedAt = new Date();
  await runMongoUnitOfWork(async (session) => {
    const changed = await FlightTicket.findOneAndUpdate({ id: ticket.id, companyId: clean(companyId), status: ticket.status }, { $set: update }, sessionOptions(session, { new: true })).lean();
    if (!changed) fail('Ticket changed while this operation was being processed', 409, 'flight_ticket_transition_race');
    await Booking.updateOne({ bookingRef: ticket.bookingRef }, { $set: {
      [`ticketLegs.$[ticket].status`]: nextStatus,
      ...(nextStatus === 'checked_in' ? { checkInStatus: 'checked_in', checkedInAt: new Date(), checkedInBy: clean(actorId) } : {}),
      ...(nextStatus === 'no_show' ? { checkInStatus: 'no_show', noShowAt: new Date(), noShowBy: clean(actorId) } : {}),
    } }, sessionOptions(session, { arrayFilters: [{ 'ticket.ticketNumber': ticket.ticketNumber }] }));
    await repository.auditLogs.insert({
      id: await nextId('audit'), actorId: clean(actorId), action: `flight.ticket.${nextStatus}`, entityType: 'flight_ticket', entityId: ticket.id,
      companyId: clean(companyId), metadata: { ticketNumber: ticket.ticketNumber, bookingRef: ticket.bookingRef, fromStatus: ticket.status, toStatus: nextStatus }, createdAt: new Date(),
    }, { session });
  });
  const orderTickets = await repository.flightTickets.list({ orderId: ticket.orderId }, { limit: 20 });
  const statuses = new Set(orderTickets.map((row) => normalize(row.status)));
  if ([...statuses].every((status) => status === 'flown')) {
    await repository.flightOrders.updateOne({ id: ticket.orderId }, { $set: { status: 'completed' } });
    await repository.bookingItems.updateOne({ bookingRef: ticket.bookingRef, serviceType: 'flight' }, { $set: { status: 'completed' } });
    await repository.bookings.updateOne({ bookingRef: ticket.bookingRef }, { $set: { bookingStatus: 'completed', completedAt: new Date(), settlementStatus: 'eligible' } });
  } else if ([...statuses].every((status) => ['no_show', 'voided', 'refunded'].includes(status))) {
    await repository.flightOrders.updateOne({ id: ticket.orderId }, { $set: { status: statuses.has('no_show') ? 'no_show' : 'cancelled' } });
    await repository.bookingItems.updateOne({ bookingRef: ticket.bookingRef, serviceType: 'flight' }, { $set: { status: statuses.has('no_show') ? 'no_show' : 'cancelled' } });
    await repository.bookings.updateOne({ bookingRef: ticket.bookingRef }, { $set: { bookingStatus: statuses.has('no_show') ? 'no_show' : 'cancelled' } });
  }
  return repository.flightTickets.findOne({ id: ticket.id, companyId: clean(companyId) });
}

module.exports = {
  searchFlights,
  getFlightOffer,
  createGuestBooking,
  confirmPayment,
  failPayment,
  refundBooking,
  requestCancellation,
  manifest,
  flightListingReadiness,
  publishFlightListing,
  createAircraft,
  updateAircraftStatus,
  createFare,
  createSchedule,
  publishSchedule,
  transitionSchedule,
  transitionTicket,
};
