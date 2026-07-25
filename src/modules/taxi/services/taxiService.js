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
const TaxiRide = require('../../../models/TaxiRide');
const TaxiRideEvent = require('../../../models/TaxiRideEvent');
const Booking = require('../../../models/Booking');
const BookingItem = require('../../../models/BookingItem');
const PaymentIntent = require('../../../models/PaymentIntent');
const Payment = require('../../../models/Payment');

const RIDE_TYPES = new Set(['immediate', 'scheduled', 'airport_transfer', 'intercity', 'hourly']);
const VEHICLE_CLASSES = new Set(['boda', 'economy', 'comfort', 'premium', 'suv', 'van', 'minibus']);

function clean(value, max = 500) { return String(value || '').trim().slice(0, max); }
function normalize(value) { return clean(value).toLowerCase().replace(/[\s-]+/g, '_'); }
function amount(value, fallback = 0) { const number = Number(value); return Number.isFinite(number) ? Math.round(number * 100) / 100 : fallback; }
function bool(value) { return value === true || value === 'true' || value === 'on' || value === '1' || value === 1; }
function boundedInteger(value, fallback, min, max) { const number = Number(value); return Number.isInteger(number) ? Math.max(min, Math.min(max, number)) : fallback; }
function fail(message, status = 422, code = 'taxi_validation_failed') { const error = new Error(message); error.status = status; error.code = code; throw error; }
function sha256(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }
function secret(bytes = 24) { return crypto.randomBytes(bytes).toString('base64url'); }
function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function signQuote(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', env.sessionSecret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}
function verifyQuoteToken(token) {
  const [encoded, signature] = clean(token, 5000).split('.');
  if (!encoded || !signature) fail('Taxi quote token is missing or invalid', 409, 'taxi_quote_invalid');
  const expected = crypto.createHmac('sha256', env.sessionSecret).update(encoded).digest('base64url');
  if (!timingSafeEqual(signature, expected)) fail('Taxi quote token signature is invalid', 403, 'taxi_quote_tampered');
  let payload;
  try { payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); } catch (_) { fail('Taxi quote token could not be read', 409, 'taxi_quote_invalid'); }
  if (Number(payload.expiresAt || 0) <= Date.now()) fail('Taxi quote expired. Request a new fare.', 409, 'taxi_quote_expired');
  return payload;
}

function coordinate(input = {}, prefix = '') {
  const nestedCoordinates = !prefix && input.coordinates && typeof input.coordinates === 'object' ? input.coordinates : null;
  const source = input[prefix] && typeof input[prefix] === 'object' ? input[prefix] : (nestedCoordinates || input);
  const latitude = Number(source.latitude ?? source.lat ?? input[`${prefix}Latitude`] ?? input[`${prefix}Lat`]);
  const longitude = Number(source.longitude ?? source.lng ?? source.lon ?? input[`${prefix}Longitude`] ?? input[`${prefix}Lng`] ?? input[`${prefix}Lon`]);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) fail(`${prefix || 'Location'} coordinates are required`, 422, 'taxi_coordinates_required');
  return { latitude, longitude };
}

function haversineKm(a, b) {
  const earth = 6371;
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return earth * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function withinZone(zone = {}, point) {
  if (!zone || zone.zoneType === 'national' || zone.zoneType === 'intercity') return true;
  if (zone.zoneType === 'radius' && zone.center?.latitude !== undefined && zone.center?.longitude !== undefined) {
    return haversineKm(zone.center, point) <= Number(zone.radiusKm || 0);
  }
  if (zone.zoneType === 'polygon' && Array.isArray(zone.polygon) && zone.polygon.length >= 3) {
    let inside = false;
    const x = point.longitude; const y = point.latitude;
    for (let i = 0, j = zone.polygon.length - 1; i < zone.polygon.length; j = i++) {
      const xi = Number(zone.polygon[i].longitude); const yi = Number(zone.polygon[i].latitude);
      const xj = Number(zone.polygon[j].longitude); const yj = Number(zone.polygon[j].latitude);
      const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi) / ((yj - yi) || Number.EPSILON)) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }
  return false;
}

function stopSnapshot(payload = {}) {
  const pickupCoordinates = coordinate(payload, 'pickup');
  const destinationCoordinates = coordinate(payload, 'destination');
  const pickupAddress = clean(payload.pickupAddress || payload.origin || payload.from, 300);
  const destinationAddress = clean(payload.destinationAddress || payload.destination || payload.to, 300);
  if (!pickupAddress || !destinationAddress) fail('Pickup and destination addresses are required');
  const middle = Array.isArray(payload.stops) ? payload.stops.slice(0, 5).map((row, index) => ({
    type: 'stop', order: index + 1, address: clean(row.address, 300), coordinates: coordinate(row), instructions: clean(row.instructions, 300),
  })).filter((row) => row.address) : [];
  return [
    { type: 'pickup', order: 0, address: pickupAddress, coordinates: pickupCoordinates, contactName: clean(payload.contactName || payload.fullName, 160), contactPhone: clean(payload.phone, 50), instructions: clean(payload.pickupInstructions, 300) },
    ...middle,
    { type: 'destination', order: middle.length + 1, address: destinationAddress, coordinates: destinationCoordinates, instructions: clean(payload.destinationInstructions, 300) },
  ];
}

function contactSnapshot(payload = {}, req = {}) {
  const fullName = clean(payload.contactName || payload.fullName || payload.name, 160);
  const email = clean(payload.email, 180).toLowerCase();
  const phone = clean(payload.phone, 50);
  if (!fullName || !email || !phone) fail('Rider name, email, and phone are required');
  return { fullName, email, phone, ip: clean(req.ip, 80), userAgent: clean(req.headers?.['user-agent'], 300) };
}

function commercialTerms(company = {}) {
  const commissionPercent = amount(company.commercialTerms?.commissionPercent, 0);
  return { model: 'percentage_commission', commissionPercent, providerPayoutPercent: Math.max(0, 100 - commissionPercent), termsVersion: clean(company.commercialTerms?.termsVersion || 'commission-v1', 80), capturedAt: new Date().toISOString() };
}

function isNight(date = new Date()) { const hour = date.getHours(); return hour >= 22 || hour < 5; }

function rideRequirements(payload = {}) {
  const passengerCount = boundedInteger(payload.passengerCount, 1, 1, 30);
  const luggageCount = boundedInteger(payload.luggageCount, 0, 0, 50);
  const childSeatCount = boundedInteger(payload.childSeatCount, 0, 0, 10);
  if (childSeatCount > passengerCount) fail('Child seats cannot exceed the passenger count');
  return {
    passengerCount,
    luggageCount,
    childSeatCount,
    wheelchairRequired: bool(payload.wheelchairRequired),
    accessibilityNotes: clean(payload.accessibilityNotes, 500),
  };
}

function vehicleIsCompliant(vehicle = {}, at = new Date()) {
  if (!vehicle.inspectionExpiresAt || !vehicle.insuranceExpiresAt) return false;
  const point = at.getTime();
  const inspection = new Date(vehicle.inspectionExpiresAt).getTime();
  const insurance = new Date(vehicle.insuranceExpiresAt).getTime();
  return Number.isFinite(inspection) && Number.isFinite(insurance) && inspection >= point && insurance >= point;
}

function vehicleMeetsRequirements(vehicle = {}, requirements = {}) {
  return Number(vehicle.passengerCapacity || 0) >= Number(requirements.passengerCount || 1)
    && Number(vehicle.luggageCapacity || 0) >= Number(requirements.luggageCount || 0)
    && (!requirements.wheelchairRequired || vehicle.wheelchairAccessible === true);
}

async function resolveQuoteContext(payload = {}) {
  const listing = await repository.listings.findOne({ id: clean(payload.listingId), serviceType: 'taxi', status: 'active', bookable: true });
  if (!listing) fail('Taxi service listing was not found', 404, 'taxi_listing_not_found');
  const company = await repository.companies.findOne({ id: listing.companyId, status: 'active', verificationStatus: 'verified' });
  if (!company) fail('Taxi provider is not operational', 409, 'taxi_provider_unavailable');
  const serviceType = normalize(payload.serviceType || 'immediate');
  const vehicleClass = normalize(payload.vehicleClass || 'economy');
  if (!RIDE_TYPES.has(serviceType) || !VEHICLE_CLASSES.has(vehicleClass)) fail('Choose a valid taxi service and vehicle class');
  const fareRule = payload.fareRuleId
    ? await repository.taxiFareRules.findOne({ id: clean(payload.fareRuleId), companyId: company.id, listingId: listing.id, serviceType, vehicleClass, status: 'active' })
    : await repository.taxiFareRules.findOne({ companyId: company.id, listingId: listing.id, serviceType, vehicleClass, status: 'active' });
  if (!fareRule) fail('No active fare rule matches this ride', 404, 'taxi_fare_not_found');
  const zone = fareRule.serviceZoneId ? await repository.taxiServiceZones.findOne({ id: fareRule.serviceZoneId, companyId: company.id, status: 'active' }) : null;
  const vehicles = await repository.taxiVehicles.list({ companyId: company.id, status: 'active', vehicleClass }, { sort: { createdAt: 1 }, limit: 500 });
  return { listing, company, fareRule, zone, serviceType, vehicleClass, vehicles: vehicles.filter((vehicle) => vehicleIsCompliant(vehicle)) };
}

async function quoteRide(payload = {}) {
  const context = await resolveQuoteContext(payload);
  const requirements = rideRequirements(payload);
  const compatibleVehicles = context.vehicles.filter((vehicle) => vehicleMeetsRequirements(vehicle, requirements));
  if (!compatibleVehicles.length) fail('No active vehicle can safely carry the selected passengers, luggage, and accessibility requirements', 409, 'taxi_vehicle_capacity_unavailable');
  const stops = stopSnapshot(payload);
  const pickup = stops[0].coordinates;
  const destination = stops[stops.length - 1].coordinates;
  if (context.zone && !withinZone(context.zone, pickup)) fail('Pickup is outside this taxi provider’s service zone', 409, 'taxi_pickup_outside_zone');
  let distanceKm = 0;
  for (let index = 0; index < stops.length - 1; index += 1) distanceKm += haversineKm(stops[index].coordinates, stops[index + 1].coordinates);
  distanceKm = Math.max(0.1, amount(distanceKm, 0.1));
  const durationMinutes = Math.max(5, Math.ceil((distanceKm / 32) * 60));
  const requestedPickupAt = context.serviceType === 'immediate' ? new Date(Date.now() + 5 * 60 * 1000) : new Date(payload.requestedPickupAt || payload.pickupAt);
  if (Number.isNaN(requestedPickupAt.getTime())) fail('A valid pickup date and time is required');
  if (context.serviceType !== 'immediate' && requestedPickupAt < new Date(Date.now() + 30 * 60 * 1000)) fail('Scheduled rides must be booked at least 30 minutes ahead');
  const base = amount(context.fareRule.baseFare);
  const distanceCharge = amount(distanceKm * amount(context.fareRule.perKilometre));
  const timeCharge = amount(durationMinutes * amount(context.fareRule.perMinute));
  const airportSurcharge = context.serviceType === 'airport_transfer' ? amount(context.fareRule.airportSurcharge) : 0;
  const bookingFee = amount(context.fareRule.bookingFee);
  const preSurcharge = base + distanceCharge + timeCharge + airportSurcharge + bookingFee;
  const nightSurcharge = isNight(requestedPickupAt) ? amount(preSurcharge * amount(context.fareRule.nightSurchargePercent) / 100) : 0;
  const total = Math.max(amount(context.fareRule.minimumFare), amount(preSurcharge + nightSurcharge));
  const quote = {
    quoteId: `TQ-${crypto.randomBytes(8).toString('hex').toUpperCase()}`,
    listingId: context.listing.id,
    companyId: context.company.id,
    fareRuleId: context.fareRule.id,
    serviceZoneId: context.zone?.id || '',
    serviceType: context.serviceType,
    vehicleClass: context.vehicleClass,
    requestedPickupAt: requestedPickupAt.toISOString(),
    distanceKm,
    durationMinutes,
    stops,
    pricing: { subtotal: amount(base + distanceCharge + timeCharge), fees: amount(airportSurcharge + bookingFee + nightSurcharge), addonTotal: 0, total, currency: context.fareRule.currency || context.company.operatingCurrency || platformCurrency(), addons: [] },
    breakdown: { base, distanceCharge, timeCharge, airportSurcharge, bookingFee, nightSurcharge, minimumFare: amount(context.fareRule.minimumFare) },
    requirements,
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
  return { ...quote, quoteToken: signQuote(quote), provider: { id: context.company.id, name: context.company.name }, listing: { id: context.listing.id, title: context.listing.title } };
}

async function recordEvent(ride, eventType, fromStatus, toStatus, context = {}, session = null) {
  const id = await nextId('taxi-ride-event');
  const row = {
    id,
    rideId: ride.id,
    rideRef: ride.rideRef,
    bookingRef: ride.bookingRef,
    companyId: ride.companyId,
    eventType,
    fromStatus: clean(fromStatus, 60),
    toStatus: clean(toStatus, 60),
    actorType: normalize(context.actorType || 'system'),
    actorId: clean(context.actorId, 120),
    note: clean(context.note, 500),
    location: context.location || null,
    metadata: context.metadata || {},
    occurredAt: new Date(),
  };
  if (session) await TaxiRideEvent.create([row], { session });
  else await repository.taxiRideEvents.insert(row);
  return row;
}

async function createGuestBooking(payload = {}, req = {}) {
  const quote = verifyQuoteToken(payload.quoteToken);
  const fresh = await quoteRide({
    ...payload,
    listingId: quote.listingId,
    fareRuleId: quote.fareRuleId,
    serviceType: quote.serviceType,
    vehicleClass: quote.vehicleClass,
    requestedPickupAt: quote.requestedPickupAt,
    pickupAddress: quote.stops?.[0]?.address,
    pickupLatitude: quote.stops?.[0]?.coordinates?.latitude,
    pickupLongitude: quote.stops?.[0]?.coordinates?.longitude,
    destinationAddress: quote.stops?.[quote.stops.length - 1]?.address,
    destinationLatitude: quote.stops?.[quote.stops.length - 1]?.coordinates?.latitude,
    destinationLongitude: quote.stops?.[quote.stops.length - 1]?.coordinates?.longitude,
    stops: quote.stops?.slice(1, -1),
    ...(quote.requirements || {}),
  });
  if (fresh.companyId !== quote.companyId || fresh.fareRuleId !== quote.fareRuleId || Math.abs(amount(fresh.pricing.total) - amount(quote.pricing.total)) > 0.01) fail('Taxi fare changed. Request a new quote.', 409, 'taxi_quote_repriced');
  const [bookingId, itemId, rideId, paymentIntentId] = await Promise.all([nextId('booking'), nextId('booking-item'), nextId('taxi-ride'), nextId('payment-intent')]);
  const bookingRef = `CTX-${clean(bookingId).split('-').pop()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const rideRef = `RIDE-${clean(rideId).split('-').pop()}`;
  const rider = contactSnapshot(payload, req);
  const pickupPin = String(crypto.randomInt(1000, 10000));
  const trackingToken = secret(24);
  const dispatchAfter = quote.serviceType === 'immediate' ? new Date() : new Date(new Date(quote.requestedPickupAt).getTime() - 30 * 60 * 1000);
  const booking = {
    id: bookingId,
    bookingRef,
    guestLookupCode: crypto.randomBytes(4).toString('hex').toUpperCase(),
    serviceType: 'taxi',
    customerUserId: req.session?.user?.id || '',
    companyId: quote.companyId,
    tenantId: quote.companyId,
    listingId: quote.listingId,
    passengers: [{ id: 'rider-1', fullName: rider.fullName, name: rider.fullName, phone: rider.phone, email: rider.email, passengerCount: quote.requirements?.passengerCount || 1, luggageCount: quote.requirements?.luggageCount || 0, wheelchairRequired: Boolean(quote.requirements?.wheelchairRequired), pickupPoint: quote.stops[0].address, dropoffPoint: quote.stops[quote.stops.length - 1].address }],
    bookingItems: [{ id: itemId, serviceType: 'taxi', domainReservationId: rideId, serviceTypeName: quote.serviceType, vehicleClass: quote.vehicleClass, requirements: quote.requirements }],
    bookingLegs: [{ type: 'taxi', rideRef, pickup: quote.stops[0], destination: quote.stops[quote.stops.length - 1], requestedPickupAt: quote.requestedPickupAt }],
    ticketLegs: [{ id: `ride-ticket-${rideId}`, serviceType: 'taxi', rideRef, passengerIndex: 0, passengerName: rider.fullName, status: 'awaiting_payment' }],
    quantity: 1,
    pricing: quote.pricing,
    grossAmount: quote.pricing.total,
    commercialTermsSnapshot: commercialTerms(await repository.companies.findOne({ id: quote.companyId })),
    guestSnapshot: rider,
    buyerSnapshot: rider,
    paymentStatus: 'pending',
    bookingStatus: 'pending_payment',
    settlementStatus: 'pending_payment',
    bookingChannel: 'web',
    lockedUntil: new Date(Date.now() + 20 * 60 * 1000),
    qrCodeValue: `taxi:${bookingRef}:${trackingToken}`,
    auditTrail: [{ at: new Date().toISOString(), action: 'taxi.ride.requested', actorId: req.session?.user?.id || 'guest' }],
  };
  const ride = {
    id: rideId,
    rideRef,
    bookingId,
    bookingRef,
    bookingItemId: itemId,
    companyId: quote.companyId,
    listingId: quote.listingId,
    fareRuleId: quote.fareRuleId,
    serviceZoneId: quote.serviceZoneId,
    serviceType: quote.serviceType,
    vehicleClass: quote.vehicleClass,
    requestedPickupAt: new Date(quote.requestedPickupAt),
    dispatchAfter,
    stops: quote.stops,
    estimatedDistanceKm: quote.distanceKm,
    estimatedDurationMinutes: quote.durationMinutes,
    pricing: quote.pricing,
    rider,
    passengerCount: quote.requirements?.passengerCount || 1,
    luggageCount: quote.requirements?.luggageCount || 0,
    childSeatCount: quote.requirements?.childSeatCount || 0,
    wheelchairRequired: Boolean(quote.requirements?.wheelchairRequired),
    accessibilityNotes: clean(quote.requirements?.accessibilityNotes, 500),
    pickupPinHash: sha256(pickupPin),
    trackingTokenHash: sha256(trackingToken),
    status: 'awaiting_payment',
  };
  const item = {
    id: itemId, bookingId, bookingRef, companyId: quote.companyId, listingId: quote.listingId,
    serviceType: 'taxi', domainReservationId: rideId, quantity: 1, pricing: quote.pricing,
    priceSnapshot: { quoteId: quote.quoteId, fareRuleId: quote.fareRuleId, distanceKm: quote.distanceKm, durationMinutes: quote.durationMinutes, breakdown: quote.breakdown, requirements: quote.requirements, capturedAt: new Date().toISOString() },
    policySnapshot: { cancellationFee: amount((await repository.taxiFareRules.findOne({ id: quote.fareRuleId }))?.cancellationFee), requestedPickupAt: quote.requestedPickupAt },
    status: 'awaiting_payment',
  };
  const provider = paymentService.resolveProviderName(payload.paymentProvider || payload.provider || env.paymentProvider);
  const intent = {
    id: paymentIntentId, intentRef: `PI-${bookingRef}`, bookingId, bookingRef, companyId: quote.companyId, customerUserId: booking.customerUserId,
    provider, idempotencyKey: `${provider}:${bookingRef}:initiate`, amount: quote.pricing.total, currency: quote.pricing.currency,
    status: 'created', expiresAt: booking.lockedUntil, attempts: [{ at: new Date().toISOString(), provider, status: 'created' }],
    metadata: { source: 'taxiService.createGuestBooking', rideId, quoteId: quote.quoteId },
  };
  await runMongoUnitOfWork(async (session) => {
    await Booking.create([booking], sessionOptions(session));
    await BookingItem.create([item], sessionOptions(session));
    await TaxiRide.create([ride], sessionOptions(session));
    await PaymentIntent.create([intent], sessionOptions(session));
    await recordEvent(ride, 'requested', '', 'awaiting_payment', { actorType: req.session?.user ? 'customer' : 'system', actorId: req.session?.user?.id || 'guest' }, session);
  });
  let payment;
  try {
    payment = await paymentService.initiatePayment({ provider, bookingRef, amount: quote.pricing.total, currency: quote.pricing.currency, customer: rider, idempotencyKey: intent.idempotencyKey, callbackUrl: `${env.appUrl}/booking/payment/callback?bookingRef=${encodeURIComponent(bookingRef)}`, description: `Classic Trip taxi ${rideRef}` });
    if (normalize(payment.status) === 'failed') fail(payment.message || 'Payment could not be initiated', 402, 'payment_failed');
  } catch (error) {
    await failPayment(bookingRef, error.message || 'Payment initiation failed', { provider, source: 'taxi_checkout' });
    throw error;
  }
  await PaymentIntent.updateOne({ id: paymentIntentId }, { $set: { providerReference: clean(payment.providerReference, 200), checkoutUrl: clean(payment.checkoutUrl, 1000), status: normalize(payment.status) || 'pending', paidAt: normalize(payment.status) === 'successful' ? new Date() : null, attempts: [...intent.attempts, { at: new Date().toISOString(), provider, status: normalize(payment.status) || 'pending', providerReference: clean(payment.providerReference, 200) }] } }, { runValidators: true });
  await Booking.updateOne({ bookingRef }, { $set: { paymentProvider: provider, paymentRef: clean(payment.providerReference, 200), checkoutUrl: clean(payment.checkoutUrl, 1000) } }, { runValidators: true });
  if (normalize(payment.status) === 'successful') {
    await Payment.updateOne({ idempotencyKey: intent.idempotencyKey }, { $set: { id: `payment-${bookingRef}`, bookingId, bookingRef, companyId: quote.companyId, customerUserId: booking.customerUserId, provider, providerReference: clean(payment.providerReference, 200), amount: quote.pricing.total, grossAmount: quote.pricing.total, currency: quote.pricing.currency, status: 'successful', paidAt: new Date(), idempotencyKey: intent.idempotencyKey, metadata: { source: 'taxi_checkout_immediate' } } }, { upsert: true, runValidators: true });
    const confirmed = await confirmPayment(bookingRef, { provider, providerReference: payment.providerReference, source: 'immediate_payment' });
    return { ...confirmed, pickupPin, trackingToken };
  }
  return { ...booking, checkoutUrl: clean(payment.checkoutUrl, 1000), paymentProvider: provider, paymentRef: clean(payment.providerReference, 200), pickupPin, trackingToken, rideRef };
}

async function confirmPayment(bookingRef, context = {}) {
  const booking = await repository.bookings.findOne({ bookingRef: clean(bookingRef), serviceType: 'taxi' });
  if (!booking) fail('Taxi booking was not found', 404, 'taxi_booking_not_found');
  if (booking.paymentStatus === 'successful' && booking.bookingStatus === 'confirmed') return booking;
  const ride = await repository.taxiRides.findOne({ bookingRef: booking.bookingRef });
  if (!ride) fail('Taxi ride was not found', 404, 'taxi_ride_not_found');
  const nextStatus = ride.dispatchAfter && new Date(ride.dispatchAfter) <= new Date() ? 'searching_driver' : 'requested';
  await runMongoUnitOfWork(async (session) => {
    const updated = await TaxiRide.findOneAndUpdate({ id: ride.id, status: { $in: ['awaiting_payment', 'requested', 'searching_driver'] } }, { $set: { status: nextStatus } }, sessionOptions(session, { new: true })).lean();
    if (!updated && !['requested', 'searching_driver', 'assigned', 'accepted', 'driver_arriving', 'arrived', 'in_progress', 'completed'].includes(ride.status)) fail('Taxi payment confirmation requires reconciliation', 409, 'taxi_confirmation_reconciliation_required');
    await BookingItem.updateOne({ bookingRef: booking.bookingRef, serviceType: 'taxi' }, { $set: { status: 'confirmed' } }, sessionOptions(session));
    await Booking.updateOne({ bookingRef: booking.bookingRef }, { $set: { paymentStatus: 'successful', bookingStatus: 'confirmed', settlementStatus: 'pending_fulfillment', paymentProvider: clean(context.provider, 50) || booking.paymentProvider, paymentRef: clean(context.providerReference, 200) || booking.paymentRef, lockedUntil: null, 'ticketLegs.0.status': nextStatus } }, sessionOptions(session));
    await PaymentIntent.updateOne({ bookingRef: booking.bookingRef }, { $set: { status: 'successful', paidAt: new Date(), providerReference: clean(context.providerReference, 200) } }, sessionOptions(session));
    await recordEvent(ride, 'payment_confirmed', ride.status, nextStatus, { actorType: 'system', actorId: 'payment-system', metadata: context }, session);
  });
  const confirmed = await repository.bookings.findOne({ bookingRef: booking.bookingRef });
  await notificationService.bookingConfirmed(confirmed).catch(() => null);
  if (nextStatus === 'searching_driver') await dispatchRide(ride.id).catch(() => null);
  return confirmed;
}

async function failPayment(bookingRef, reason = 'Payment failed', context = {}) {
  const booking = await repository.bookings.findOne({ bookingRef: clean(bookingRef), serviceType: 'taxi' });
  const ride = booking ? await repository.taxiRides.findOne({ bookingRef: booking.bookingRef }) : null;
  await runMongoUnitOfWork(async (session) => {
    if (booking) {
      await BookingItem.deleteMany({ bookingId: booking.id }, sessionOptions(session));
      await TaxiRideEvent.deleteMany({ rideId: ride?.id || '__none__' }, sessionOptions(session));
      await TaxiRide.deleteMany({ bookingId: booking.id }, sessionOptions(session));
      await Payment.deleteMany({ bookingId: booking.id }, sessionOptions(session));
      await Booking.deleteOne({ id: booking.id }, sessionOptions(session));
    }
    await PaymentIntent.updateOne({ bookingRef: clean(bookingRef) }, { $set: { status: normalize(context.intentStatus || 'failed'), failedAt: new Date(), failureReason: clean(reason, 500), metadata: { source: clean(context.source, 100) || 'taxi_payment', provider: clean(context.provider, 50), providerReference: clean(context.providerReference, 200) } } }, sessionOptions(session));
  });
  return { bookingRef: clean(bookingRef), purged: Boolean(booking), reason: clean(reason, 500) };
}

async function eligibleDriverAndVehicle(ride) {
  const activeRides = await repository.taxiRides.list({ companyId: ride.companyId, status: { $in: ['assigned', 'accepted', 'driver_arriving', 'arrived', 'in_progress'] } });
  const busyDrivers = new Set(activeRides.map((row) => row.assignedDriverId).filter(Boolean));
  const busyVehicles = new Set(activeRides.map((row) => row.assignedVehicleId).filter(Boolean));
  const drivers = await repository.companyEmployees.list({ companyId: ride.companyId, status: 'active', safetyStatus: 'cleared', $or: [{ roleTitle: { $regex: /driver/i } }, { permissions: 'taxi.ride.update' }] }, { sort: { lastAssignedAt: 1, createdAt: 1 }, limit: 100 });
  const vehicles = (await repository.taxiVehicles.list({ companyId: ride.companyId, status: 'active', vehicleClass: ride.vehicleClass }, { sort: { createdAt: 1 }, limit: 100 }))
    .filter((vehicle) => vehicleIsCompliant(vehicle) && vehicleMeetsRequirements(vehicle, ride));
  for (const driver of drivers) {
    if (busyDrivers.has(driver.id)) continue;
    const assigned = vehicles.find((vehicle) => !busyVehicles.has(vehicle.id) && (!vehicle.assignedDriverId || vehicle.assignedDriverId === driver.id));
    if (assigned) return { driver, vehicle: assigned };
  }
  return null;
}

async function dispatchRide(rideId) {
  const ride = await repository.taxiRides.findOne({ $or: [{ id: clean(rideId) }, { rideRef: clean(rideId) }] });
  if (!ride) fail('Taxi ride was not found', 404, 'taxi_ride_not_found');
  if (!['requested', 'searching_driver'].includes(ride.status)) return ride;
  const booking = await repository.bookings.findOne({ bookingRef: ride.bookingRef, paymentStatus: 'successful' });
  if (!booking) fail('Only paid taxi rides can be dispatched', 409, 'taxi_payment_required');
  if (new Date(ride.dispatchAfter) > new Date()) return ride;
  const match = await eligibleDriverAndVehicle(ride);
  if (!match) {
    await repository.taxiRides.updateOne({ id: ride.id }, { $set: { status: 'searching_driver' } });
    return repository.taxiRides.findOne({ id: ride.id });
  }
  const assigned = await TaxiRide.findOneAndUpdate(
    { id: ride.id, status: { $in: ['requested', 'searching_driver'] }, assignedDriverId: { $in: [null, ''] } },
    { $set: { status: 'assigned', assignedDriverId: match.driver.id, assignedVehicleId: match.vehicle.id } },
    { new: true, runValidators: true },
  ).lean();
  if (!assigned) return repository.taxiRides.findOne({ id: ride.id });
  await repository.companyEmployees.updateOne({ id: match.driver.id }, { $set: { lastAssignedAt: new Date() } });
  await recordEvent(assigned, 'driver_assigned', ride.status, 'assigned', { actorType: 'system', actorId: 'taxi-dispatch', metadata: { driverId: match.driver.id, vehicleId: match.vehicle.id } });
  return assigned;
}

async function dispatchDueRides(limit = 100, companyId = '') {
  const query = { status: { $in: ['requested', 'searching_driver'] }, dispatchAfter: { $lte: new Date() } };
  if (clean(companyId)) query.companyId = clean(companyId);
  const rides = await repository.taxiRides.list(query, { sort: { requestedPickupAt: 1 }, limit: Math.max(1, Math.min(500, Number(limit || 100))) });
  const results = [];
  for (const ride of rides) results.push(await dispatchRide(ride.id).catch((error) => ({ id: ride.id, error: error.message })));
  return results;
}

const TRANSITIONS = Object.freeze({
  assigned: ['accepted', 'cancelled'],
  accepted: ['driver_arriving', 'cancelled'],
  driver_arriving: ['arrived', 'cancelled'],
  arrived: ['in_progress', 'customer_no_show', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
});

async function transitionRide({ rideRef, actorId, actorType = 'driver', companyId = '', toStatus, pickupPin = '', note = '', location = null } = {}) {
  const identityQuery = { $or: [{ rideRef: clean(rideRef) }, { id: clean(rideRef) }] };
  if (clean(companyId)) identityQuery.companyId = clean(companyId);
  const ride = await repository.taxiRides.findOne(identityQuery);
  if (!ride) fail('Taxi ride was not found for this operator', 404, 'taxi_ride_not_found');
  const next = normalize(toStatus);
  if (normalize(actorType) === 'driver' && clean(actorId) !== clean(ride.assignedDriverId)) fail('This ride is assigned to another driver', 403, 'taxi_driver_scope_denied');
  if (!(TRANSITIONS[ride.status] || []).includes(next)) fail(`Ride cannot move from ${ride.status} to ${next}`, 409, 'taxi_invalid_transition');
  if (next === 'in_progress' && !timingSafeEqual(sha256(clean(pickupPin, 12)), ride.pickupPinHash)) fail('Pickup PIN is incorrect', 403, 'taxi_pickup_pin_invalid');
  const update = { status: next };
  const eventMap = { accepted: 'driver_accepted', driver_arriving: 'driver_arriving', arrived: 'arrived', in_progress: 'ride_started', completed: 'ride_completed', customer_no_show: 'customer_no_show', cancelled: 'cancelled' };
  if (next === 'accepted') update.assignmentAcceptedAt = new Date();
  if (next === 'completed') { update.completedAt = new Date(); update.finalFare = ride.pricing?.total || 0; }
  if (next === 'cancelled') update.cancellation = { reason: clean(note || 'Ride cancelled', 500), actorType: normalize(actorType), actorId: clean(actorId), at: new Date() };
  const updated = await TaxiRide.findOneAndUpdate({ id: ride.id, status: ride.status }, { $set: update }, { new: true, runValidators: true }).lean();
  if (!updated) fail('Ride changed while this action was being processed', 409, 'taxi_transition_race');
  await recordEvent(updated, eventMap[next], ride.status, next, { actorType, actorId, note, location });
  const bookingStatus = next === 'completed' ? 'completed' : next === 'customer_no_show' ? 'no_show' : next === 'cancelled' ? 'cancelled' : next === 'in_progress' ? 'booked' : 'confirmed';
  const itemStatus = next === 'completed' ? 'completed' : next === 'customer_no_show' ? 'no_show' : next === 'cancelled' ? 'cancelled' : next === 'in_progress' ? 'in_progress' : 'confirmed';
  const bookingUpdate = { bookingStatus, 'ticketLegs.0.status': next };
  if (next === 'in_progress') bookingUpdate.checkInStatus = 'checked_in';
  if (next === 'completed') bookingUpdate.completedAt = new Date();
  await repository.bookings.updateOne({ bookingRef: ride.bookingRef }, { $set: bookingUpdate });
  await repository.bookingItems.updateOne({ bookingRef: ride.bookingRef, serviceType: 'taxi' }, { $set: { status: itemStatus } });
  if (next === 'completed') {
    let booking = await repository.bookings.findOne({ bookingRef: ride.bookingRef });
    try {
      Object.assign(booking, await paymentSettlementService.settleBookingPayment(booking, { source: 'taxi_ride_completed' }) || {});
      await repository.bookings.upsert(booking, { bookingRef: booking.bookingRef });
    } catch (error) {
      await repository.bookings.updateOne({ bookingRef: ride.bookingRef }, { $set: { settlementStatus: 'reconciliation_required', settlementError: clean(error.message, 500) } });
    }
  }
  return updated;
}

async function updateDriverLocation({ rideRef, driverId, latitude, longitude, heading, speedKph } = {}) {
  const ride = await repository.taxiRides.findOne({ $or: [{ rideRef: clean(rideRef) }, { id: clean(rideRef) }] });
  if (!ride) fail('Taxi ride was not found', 404, 'taxi_ride_not_found');
  if (clean(driverId) !== clean(ride.assignedDriverId)) fail('This ride is assigned to another driver', 403, 'taxi_driver_scope_denied');
  if (!['accepted', 'driver_arriving', 'arrived', 'in_progress'].includes(ride.status)) fail('Location updates are not accepted for this ride state', 409, 'taxi_tracking_inactive');
  const coordinates = coordinate({ latitude, longitude });
  const recordedAt = new Date();
  await repository.taxiRides.updateOne({ id: ride.id }, { $set: { driverLocation: { coordinates, heading: amount(heading), speedKph: Math.max(0, amount(speedKph)), recordedAt } } });
  await recordEvent(ride, 'location_updated', ride.status, ride.status, { actorType: 'driver', actorId: driverId, location: coordinates });
  return { rideRef: ride.rideRef, status: ride.status, coordinates, heading: amount(heading), speedKph: Math.max(0, amount(speedKph)), recordedAt };
}

async function publicTracking(rideRef, token) {
  const ride = await repository.taxiRides.findOne({ rideRef: clean(rideRef) });
  if (!ride) fail('Taxi ride was not found', 404, 'taxi_ride_not_found');
  if (!timingSafeEqual(sha256(clean(token, 500)), ride.trackingTokenHash)) fail('Ride tracking access token is invalid', 403, 'taxi_tracking_denied');
  const [driver, vehicle, events] = await Promise.all([
    ride.assignedDriverId ? repository.companyEmployees.findOne({ id: ride.assignedDriverId, companyId: ride.companyId }) : null,
    ride.assignedVehicleId ? repository.taxiVehicles.findOne({ id: ride.assignedVehicleId, companyId: ride.companyId }) : null,
    repository.taxiRideEvents.list({ rideId: ride.id, eventType: { $ne: 'location_updated' } }, { sort: { occurredAt: 1 }, limit: 100 }),
  ]);
  return {
    rideRef: ride.rideRef,
    bookingRef: ride.bookingRef,
    status: ride.status,
    requestedPickupAt: ride.requestedPickupAt,
    stops: ride.stops,
    driver: driver ? { fullName: driver.fullName, phone: ride.status === 'assigned' ? '' : driver.phone } : null,
    vehicle: vehicle ? { registrationNumber: vehicle.registrationNumber, make: vehicle.make, modelName: vehicle.modelName, color: vehicle.color, vehicleClass: vehicle.vehicleClass } : null,
    driverLocation: ride.driverLocation || null,
    events: events.map((event) => ({ eventType: event.eventType, status: event.toStatus, note: event.note, occurredAt: event.occurredAt })),
  };
}

async function requestCancellation(bookingRef, requesterId = 'guest', reason = '') {
  const booking = await repository.bookings.findOne({ bookingRef: clean(bookingRef), serviceType: 'taxi' });
  if (!booking) fail('Taxi booking was not found', 404, 'taxi_booking_not_found');
  const ride = await repository.taxiRides.findOne({ bookingRef: booking.bookingRef });
  if (!ride) fail('Taxi ride was not found', 404, 'taxi_ride_not_found');
  if (['in_progress', 'completed'].includes(ride.status)) fail('An active or completed ride cannot be cancelled through self-service', 409, 'taxi_cancellation_closed');
  const item = await repository.bookingItems.findOne({ bookingRef: booking.bookingRef, serviceType: 'taxi' });
  const fee = ['assigned', 'accepted', 'driver_arriving', 'arrived'].includes(ride.status) ? amount(item?.policySnapshot?.cancellationFee) : 0;
  const refundable = Math.max(0, amount(booking.pricing?.total) - fee);
  const refundId = await nextId('refund');
  await runMongoUnitOfWork(async (session) => {
    await TaxiRide.updateOne({ id: ride.id }, { $set: { status: 'cancelled', cancellation: { reason: clean(reason || 'Traveler cancelled ride', 500), actorType: 'customer', actorId: clean(requesterId), at: new Date(), fee } } }, sessionOptions(session));
    await BookingItem.updateOne({ bookingRef: booking.bookingRef, serviceType: 'taxi' }, { $set: { status: refundable > 0 ? 'cancellation_pending' : 'cancelled' } }, sessionOptions(session));
    await Booking.updateOne({ bookingRef: booking.bookingRef }, { $set: { bookingStatus: 'cancelled', refundStatus: refundable > 0 ? 'requested' : 'none', cancellationReason: clean(reason || 'Traveler cancelled ride', 500), cancelledAt: new Date() } }, sessionOptions(session));
    if (refundable > 0) {
      const RefundRequest = require('../../../models/RefundRequest');
      await RefundRequest.create([{ id: refundId, bookingId: booking.id, bookingRef: booking.bookingRef, companyId: booking.companyId, requesterId: clean(requesterId), customerUserId: booking.customerUserId || '', amount: refundable, currency: booking.pricing?.currency || platformCurrency(), reason: clean(reason || 'Taxi ride cancellation', 500), status: 'pending', requestedAt: new Date(), metadata: { serviceType: 'taxi', cancellationFee: fee, rideId: ride.id } }], sessionOptions(session));
    }
    await recordEvent(ride, 'cancelled', ride.status, 'cancelled', { actorType: 'customer', actorId: requesterId, note: reason, metadata: { cancellationFee: fee, refundable } }, session);
  });
  return { bookingRef: booking.bookingRef, rideRef: ride.rideRef, status: 'cancelled', cancellationFee: fee, refundAmount: refundable, refundId: refundable > 0 ? refundId : '' };
}

async function refundBooking(bookingRef, reason = 'Taxi refund confirmed') {
  const booking = await repository.bookings.findOne({ bookingRef: clean(bookingRef), serviceType: 'taxi' });
  if (!booking) fail('Taxi booking was not found', 404, 'taxi_booking_not_found');
  const ride = await repository.taxiRides.findOne({ bookingRef: booking.bookingRef });
  await runMongoUnitOfWork(async (session) => {
    if (ride) await TaxiRide.updateOne({ id: ride.id }, { $set: { status: 'refunded' } }, sessionOptions(session));
    await BookingItem.updateMany({ bookingRef: booking.bookingRef }, { $set: { status: 'refunded' } }, sessionOptions(session));
    await Booking.updateOne({ bookingRef: booking.bookingRef }, { $set: { paymentStatus: 'refunded', bookingStatus: 'refunded', refundStatus: 'refunded', refundedAmount: booking.pricing?.total || 0, settlementStatus: 'refunded', cancellationReason: clean(reason, 500) } }, sessionOptions(session));
    if (ride) await recordEvent(ride, 'refunded', ride.status, 'refunded', { actorType: 'system', actorId: 'payment-system', note: reason }, session);
  });
  return repository.bookings.findOne({ bookingRef: booking.bookingRef });
}


async function taxiListingReadiness(companyId, listingId) {
  const companyKey = clean(companyId);
  const listingKey = clean(listingId);
  const [company, listing, zones, fares, vehicles, drivers] = await Promise.all([
    repository.companies.findOne({ id: companyKey }),
    repository.listings.findOne({ id: listingKey, companyId: companyKey, serviceType: 'taxi' }),
    repository.taxiServiceZones.list({ companyId: companyKey, status: 'active' }, { limit: 1000 }),
    repository.taxiFareRules.list({ companyId: companyKey, listingId: listingKey, status: 'active' }, { limit: 2000 }),
    repository.taxiVehicles.list({ companyId: companyKey, status: 'active' }, { limit: 2000 }),
    repository.companyEmployees.list({ companyId: companyKey, status: 'active', safetyStatus: 'cleared', $or: [{ roleTitle: { $regex: /driver/i } }, { permissions: 'taxi.ride.update' }] }, { limit: 2000 }),
  ]);
  if (!listing) fail('Taxi listing was not found for this operator', 404, 'taxi_listing_not_found');
  const compliantVehicles = vehicles.filter((vehicle) => vehicleIsCompliant(vehicle));
  const compatibleFares = fares.filter((fare) => compliantVehicles.some((vehicle) => normalize(vehicle.vehicleClass) === normalize(fare.vehicleClass)));
  const gaps = [];
  if (!company || normalize(company.status) !== 'active' || normalize(company.verificationStatus) !== 'verified') gaps.push('Taxi operator must be verified and active');
  if (!zones.length) gaps.push('Create at least one active service zone');
  if (!fares.length) gaps.push('Create at least one active fare rule');
  if (!compliantVehicles.length) gaps.push('Activate at least one inspected and insured vehicle');
  if (!drivers.length) gaps.push('Activate at least one safety-cleared taxi driver');
  if (fares.length && compliantVehicles.length && !compatibleFares.length) gaps.push('An active vehicle class must match an active fare rule');
  return { ready: gaps.length === 0, gaps, company, listing, zones, fares, vehicles: compliantVehicles, drivers, compatibleFares };
}

async function publishTaxiListing(companyId, listingId, actorId = 'company-admin') {
  const readiness = await taxiListingReadiness(companyId, listingId);
  if (!readiness.ready) fail(`Taxi listing is incomplete: ${readiness.gaps.join('; ')}`, 409, 'taxi_listing_not_ready');
  const updatedAt = new Date();
  await runMongoUnitOfWork(async (session) => {
    await repository.listings.updateOne(
      { id: readiness.listing.id, companyId: clean(companyId), serviceType: 'taxi' },
      { $set: { status: 'active', releaseStatus: 'published', bookable: true, isVerified: true, publishedAt: readiness.listing.publishedAt || updatedAt, updatedAt } },
      sessionOptions(session),
    );
    await repository.auditLogs.insert({
      id: await nextId('audit'), actorId: clean(actorId), action: 'taxi.listing.published', entityType: 'listing', entityId: readiness.listing.id,
      companyId: clean(companyId), metadata: { zoneIds: readiness.zones.map((row) => row.id), fareRuleIds: readiness.fares.map((row) => row.id), vehicleIds: readiness.vehicles.map((row) => row.id), driverIds: readiness.drivers.map((row) => row.id) }, createdAt: updatedAt,
    }, session ? { session } : undefined);
  });
  return repository.listings.findOne({ id: readiness.listing.id, companyId: clean(companyId) });
}

async function createServiceZone(companyId, payload = {}) {
  const id = await nextId('taxi-zone');
  const zoneType = normalize(payload.zoneType || 'radius');
  const row = { id, companyId: clean(companyId), name: clean(payload.name, 120), country: clean(payload.country, 80), cityOrDistrict: clean(payload.cityOrDistrict || payload.city, 120), zoneType, radiusKm: amount(payload.radiusKm), airportCodes: (Array.isArray(payload.airportCodes) ? payload.airportCodes : String(payload.airportCodes || '').split(',')).map((value) => clean(value, 3).toUpperCase()).filter(Boolean), status: 'active' };
  if (zoneType === 'radius') row.center = coordinate(payload, 'center');
  if (!row.name || !row.country || !row.cityOrDistrict) fail('Zone name, country, and city or district are required');
  return repository.taxiServiceZones.insert(row);
}

async function createVehicle(companyId, payload = {}) {
  const id = await nextId('taxi-vehicle');
  const vehicleClass = normalize(payload.vehicleClass || 'economy');
  if (!VEHICLE_CLASSES.has(vehicleClass)) fail('Choose a valid taxi vehicle class');
  const row = { id, companyId: clean(companyId), registrationNumber: clean(payload.registrationNumber, 40).toUpperCase(), make: clean(payload.make, 80), modelName: clean(payload.modelName, 80), year: Number(payload.year || new Date().getFullYear()), color: clean(payload.color, 50), vehicleClass, passengerCapacity: Math.max(1, Number(payload.passengerCapacity || 4)), luggageCapacity: Math.max(0, Number(payload.luggageCapacity || 2)), wheelchairAccessible: Boolean(payload.wheelchairAccessible === true || payload.wheelchairAccessible === 'true' || payload.wheelchairAccessible === 'on'), inspectionExpiresAt: payload.inspectionExpiresAt || null, insuranceExpiresAt: payload.insuranceExpiresAt || null, assignedDriverId: clean(payload.assignedDriverId), status: normalize(payload.status || 'draft') };
  if (!row.registrationNumber || !row.make || !row.modelName) fail('Vehicle registration, make, and model are required');
  return repository.taxiVehicles.insert(row);
}

async function updateVehicleStatus(companyId, vehicleId, status) {
  const nextStatus = normalize(status);
  if (!['draft', 'active', 'maintenance', 'suspended', 'retired'].includes(nextStatus)) fail('Choose a valid taxi vehicle status');
  const vehicle = await repository.taxiVehicles.findOne({ id: clean(vehicleId), companyId: clean(companyId) });
  if (!vehicle) fail('Taxi vehicle was not found for this company', 404, 'taxi_vehicle_not_found');
  if (nextStatus === 'active') {
    if (!vehicle.inspectionExpiresAt || !vehicle.insuranceExpiresAt) fail('Active vehicles require current inspection and insurance expiry dates');
    if (!vehicleIsCompliant(vehicle)) fail('Vehicle inspection or insurance is expired or invalid');
  }
  await repository.taxiVehicles.updateOne({ id: vehicle.id, companyId: clean(companyId) }, { $set: { status: nextStatus } });
  return repository.taxiVehicles.findOne({ id: vehicle.id, companyId: clean(companyId) });
}

async function createFareRule(companyId, payload = {}) {
  const [listing, zone] = await Promise.all([
    repository.listings.findOne({ id: clean(payload.listingId), companyId: clean(companyId), serviceType: 'taxi' }),
    payload.serviceZoneId ? repository.taxiServiceZones.findOne({ id: clean(payload.serviceZoneId), companyId: clean(companyId), status: 'active' }) : null,
  ]);
  if (!listing || (payload.serviceZoneId && !zone)) fail('Choose an owned taxi listing and service zone');
  const serviceType = normalize(payload.serviceType || 'immediate');
  const vehicleClass = normalize(payload.vehicleClass || 'economy');
  if (!RIDE_TYPES.has(serviceType) || !VEHICLE_CLASSES.has(vehicleClass)) fail('Choose a valid service type and vehicle class');
  const id = await nextId('taxi-fare');
  const row = { id, companyId: clean(companyId), listingId: listing.id, serviceZoneId: zone?.id || '', name: clean(payload.name, 120), serviceType, vehicleClass, currency: clean(payload.currency || platformCurrency(), 3).toUpperCase(), baseFare: amount(payload.baseFare), perKilometre: amount(payload.perKilometre), perMinute: amount(payload.perMinute), minimumFare: amount(payload.minimumFare), bookingFee: amount(payload.bookingFee), airportSurcharge: amount(payload.airportSurcharge), nightSurchargePercent: amount(payload.nightSurchargePercent), cancellationFee: amount(payload.cancellationFee), waitingGraceMinutes: Math.max(0, Number(payload.waitingGraceMinutes || 5)), waitingPerMinute: amount(payload.waitingPerMinute), status: 'active' };
  if (!row.name || row.baseFare < 0) fail('Fare name and a non-negative base fare are required');
  return repository.taxiFareRules.insert(row);
}

module.exports = {
  quoteRide,
  createGuestBooking,
  confirmPayment,
  failPayment,
  refundBooking,
  requestCancellation,
  dispatchRide,
  dispatchDueRides,
  transitionRide,
  updateDriverLocation,
  publicTracking,
  taxiListingReadiness,
  publishTaxiListing,
  createServiceZone,
  createVehicle,
  updateVehicleStatus,
  createFareRule,
};
