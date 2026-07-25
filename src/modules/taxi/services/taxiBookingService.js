'use strict';

const crypto = require('crypto');
const repo = require('../repositories/taxiRepository');
const paymentService = require('../../../services/payment/paymentService');
const paymentSettlementService = require('../../../services/booking/paymentSettlementService');
const generateBookingRef = require('../../../utils/generateBookingRef');
const generateCode = require('../../../utils/generateCode');
const { calculateCustomerFees } = require('../../../utils/calculateCustomerFees');
const { evaluateDriverEligibility } = require('../../../services/company/driverEligibilityService');
const { env } = require('../../../config/env');
const secretBox = require('../../../utils/secretBox');

function clean(value, max = 2000) { return String(value || '').replace(/<[^>]*>/g, '').trim().replace(/\s+/g, ' ').slice(0, max); }
function number(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function radians(degrees) { return Number(degrees) * Math.PI / 180; }
function haversineKm(a = {}, b = {}) {
  const lat1 = number(a.latitude, NaN); const lon1 = number(a.longitude, NaN);
  const lat2 = number(b.latitude, NaN); const lon2 = number(b.longitude, NaN);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return NaN;
  const dLat = radians(lat2 - lat1); const dLon = radians(lon2 - lon1);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
function locationFrom(payload = {}, prefix) {
  return {
    label: clean(payload[`${prefix}Label`] || payload[prefix] || payload[`${prefix}Address`], 300),
    city: clean(payload[`${prefix}City`] || payload.city, 140),
    district: clean(payload[`${prefix}District`], 140),
    country: clean(payload[`${prefix}Country`] || payload.country, 100),
    latitude: number(payload[`${prefix}Latitude`], NaN), longitude: number(payload[`${prefix}Longitude`], NaN),
    airportCode: clean(payload[`${prefix}AirportCode`], 10).toUpperCase(),
  };
}
function pickupPin() { return String(crypto.randomInt(1000, 10000)); }
function pinHash(pin) { return crypto.createHash('sha256').update(String(pin)).digest('hex'); }
function safeTimingEqual(a, b) { const left = Buffer.from(String(a)); const right = Buffer.from(String(b)); return left.length === right.length && crypto.timingSafeEqual(left, right); }
function validateCoordinates(location, label) {
  if (!location.label) throw repo.problem(`${label} address is required`);
  if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude) || Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180) {
    throw repo.problem(`${label} map coordinates are required for secure distance pricing`, 422, 'taxi_coordinates_required');
  }
}
function withinZone(zone = {}, location = {}) {
  const cities = (zone.cities || []).map((value) => clean(value, 140).toLowerCase());
  const districts = (zone.districts || []).map((value) => clean(value, 140).toLowerCase());
  const countries = (zone.countries || []).map((value) => clean(value, 100).toLowerCase());
  const byText = (!cities.length || cities.includes(clean(location.city, 140).toLowerCase()))
    && (!districts.length || !location.district || districts.includes(clean(location.district, 140).toLowerCase()))
    && (!countries.length || countries.includes(clean(location.country, 100).toLowerCase()));
  if (zone.radiusKm && Number.isFinite(number(zone.centerLatitude, NaN)) && Number.isFinite(number(zone.centerLongitude, NaN))) {
    return byText && haversineKm({ latitude: zone.centerLatitude, longitude: zone.centerLongitude }, location) <= Number(zone.radiusKm);
  }
  return byText;
}
function isAirportRide(pickup, destination, rideType) { return rideType === 'airport_transfer' || Boolean(pickup.airportCode || destination.airportCode) || /airport/i.test(`${pickup.label} ${destination.label}`); }
function nightRide(scheduledAt) { const hour = new Date(scheduledAt || Date.now()).getUTCHours(); return hour >= 20 || hour < 6; }

async function quote(payload = {}) {
  const listing = await repo.publicListingOrThrow(payload.listingId || payload.slug);
  const pickup = locationFrom(payload, 'pickup'); const destination = locationFrom(payload, 'destination');
  validateCoordinates(pickup, 'Pickup'); validateCoordinates(destination, 'Destination');
  const rideType = clean(payload.rideType || (isAirportRide(pickup, destination, '') ? 'airport_transfer' : 'immediate'), 40);
  if (!['immediate', 'scheduled', 'airport_transfer', 'intercity', 'hourly'].includes(rideType)) throw repo.problem('Invalid ride type');
  const scheduledAt = payload.scheduledAt ? new Date(payload.scheduledAt) : new Date();
  if (Number.isNaN(scheduledAt.getTime())) throw repo.problem('Valid ride date and time are required');
  if (rideType === 'scheduled' && scheduledAt.getTime() < Date.now() + 10 * 60 * 1000) throw repo.problem('Scheduled rides must be at least 10 minutes in the future');
  const vehicleClass = clean(payload.vehicleClass || 'economy', 40);
  const zones = await repo.zones.list({ companyId: 'platform', listingId: listing.id, status: 'active' }, { sort: { dispatchPriority: 1 }, limit: 500 });
  const zone = zones.find((item) => withinZone(item, pickup));
  if (!zone) throw repo.problem('Pickup is outside the Classic Trip service area', 409, 'taxi_pickup_outside_zone');
  if (rideType === 'intercity' && zone.allowsIntercity === false) throw repo.problem('Intercity rides are not enabled in this service area', 409, 'taxi_intercity_unavailable');
  if (rideType === 'airport_transfer' && zone.allowsAirportTransfers === false) throw repo.problem('Airport transfers are not enabled in this service area', 409, 'taxi_airport_unavailable');
  const directKm = haversineKm(pickup, destination);
  const routeFactor = rideType === 'intercity' ? 1.08 : 1.25;
  const distanceKm = Math.max(0.5, Math.round(directKm * routeFactor * 10) / 10);
  const durationMinutes = Math.max(5, Math.ceil(distanceKm * (rideType === 'intercity' ? 1.4 : 3.1)));
  const fare = await repo.fareRules.findOne({
    companyId: 'platform', listingId: listing.id, vehicleClass, status: 'active',
    $or: [{ zoneId: zone.id }, { zoneId: '' }, { zoneId: { $exists: false } }],
  });
  if (!fare) throw repo.problem(`No active ${vehicleClass} fare is configured for this area`, 409, 'taxi_fare_not_configured');
  let subtotal = Number(fare.baseFare || 0) + distanceKm * Number(fare.perKm || 0) + durationMinutes * Number(fare.perMinute || 0) + Number(fare.bookingFee || 0);
  if (isAirportRide(pickup, destination, rideType)) subtotal += Number(fare.airportSurcharge || 0);
  if (rideType === 'intercity') subtotal *= Number(fare.intercityMultiplier || 1);
  if (nightRide(scheduledAt)) subtotal *= 1 + Number(fare.nightSurchargePercent || 0) / 100;
  subtotal = Math.max(Number(fare.minimumFare || 0), Math.round(subtotal));
  const fees = calculateCustomerFees(subtotal);
  return {
    listing, zone, fareRule: fare, pickup, destination, rideType, scheduledAt, vehicleClass,
    distanceKm, durationMinutes, subtotal, fees: fees.totalFees, total: fees.total, currency: fare.currency,
    breakdown: {
      baseFare: Number(fare.baseFare || 0), distanceCharge: Math.round(distanceKm * Number(fare.perKm || 0)),
      timeCharge: Math.round(durationMinutes * Number(fare.perMinute || 0)), bookingFee: Number(fare.bookingFee || 0),
      airportSurcharge: isAirportRide(pickup, destination, rideType) ? Number(fare.airportSurcharge || 0) : 0,
      serviceFee: fees.serviceFee, taxAmount: fees.taxAmount,
    },
    commercialTerms: { commissionPercent: Number(fare.platformCommissionPercent || 0), driverPayoutPercent: Number(fare.driverPayoutPercent || 0) },
  };
}

async function event(ride, eventType, status, actorType, actorId, note = '', metadata = {}, session = null) {
  const row = {
    id: await repo.nextId('ride-event'), companyId: ride.providerCompanyId || ride.companyId, marketplaceCompanyId: 'platform',
    rideId: ride.id, bookingRef: ride.bookingRef, eventType, status, actorType, actorId,
    note: clean(note, 500), metadata, occurredAt: new Date(),
  };
  await repo.events.save(row, { id: row.id }, session ? { session } : {});
  return row;
}

async function createGuestBooking(payload = {}, req = null) {
  const quoted = await quote(payload);
  const provider = paymentService.resolveProviderName(payload.provider || payload.paymentProvider || env.paymentProvider);
  const fullName = clean(payload.fullName || payload.customerName, 180);
  const email = clean(payload.email, 254).toLowerCase(); const phone = clean(payload.phone, 60);
  if (!fullName || !phone) throw repo.problem('Customer full name and phone are required');
  const bookingRef = generateBookingRef('TAXI'); const bookingId = await repo.nextId('booking'); const rideId = await repo.nextId('taxi-ride');
  const pin = pickupPin(); const now = new Date().toISOString(); let booking;
  await repo.withTransaction(async (session) => {
    const ride = {
      id: rideId, companyId: 'platform', marketplaceCompanyId: 'platform', providerCompanyId: '', dispatchManagedBy: 'platform',
      bookingId, bookingRef, listingId: quoted.listing.id, zoneId: quoted.zone.id,
      customerUserId: req?.session?.user?.id || '', customerSnapshot: { fullName, email, phone },
      pickup: quoted.pickup, destination: quoted.destination, stops: [], rideType: quoted.rideType, scheduledAt: quoted.scheduledAt,
      vehicleClass: quoted.vehicleClass, distanceKm: quoted.distanceKm, durationMinutes: quoted.durationMinutes,
      quotedFare: quoted.total, currency: quoted.currency, pickupPinHash: pinHash(pin), pickupPinEncrypted: secretBox.seal(pin, 'taxi-pickup-pin'),
      status: 'awaiting_payment',
    };
    booking = {
      id: bookingId, bookingRef, guestLookupCode: generateCode('LOOKUP', 6), serviceType: 'local_transport',
      customerUserId: req?.session?.user?.id || '', companyId: 'platform', marketplaceCompanyId: 'platform', providerCompanyId: '',
      tenantId: 'platform', tenantSlug: 'classic-trip', listingId: quoted.listing.id, catalogId: quoted.listing.id, tripId: rideId, scheduleId: '',
      passengers: [{ id: `${bookingId}-passenger-1`, fullName, phone, email, seatOrRoom: quoted.vehicleClass, pickupPoint: quoted.pickup.label, dropoffPoint: quoted.destination.label, specialNotes: clean(payload.notes, 500), scheduleId: rideId }],
      bookingItems: [{ id: `${bookingId}-ride-item`, serviceType: 'local_transport', rideId, vehicleClass: quoted.vehicleClass, pickup: quoted.pickup, destination: quoted.destination, scheduledAt: quoted.scheduledAt, unitPrice: quoted.total, status: 'awaiting_payment' }],
      bookingLegs: [{ id: `${bookingId}-ride-leg`, serviceType: 'local_transport', rideId, pickup: quoted.pickup, destination: quoted.destination, scheduledAt: quoted.scheduledAt, distanceKm: quoted.distanceKm, durationMinutes: quoted.durationMinutes, status: 'awaiting_payment' }],
      ticketLegs: [{ id: `${bookingId}-ride-pass`, serviceType: 'local_transport', rideId, pickup: quoted.pickup, destination: quoted.destination, scheduledAt: quoted.scheduledAt, vehicleClass: quoted.vehicleClass, status: 'pending_payment', checkInStatus: 'not_checked' }],
      guestSnapshot: { fullName, email, phone }, buyerSnapshot: { fullName, email, phone }, quantity: 1, tripType: 'one_way',
      pricing: { subtotal: quoted.subtotal, fees: quoted.fees, addonTotal: 0, total: quoted.total, currency: quoted.currency, breakdown: quoted.breakdown },
      commercialTermsSnapshot: { model: 'platform_ride_hailing_commission', commissionPercent: quoted.commercialTerms.commissionPercent, driverPayoutPercent: quoted.commercialTerms.driverPayoutPercent, termsVersion: 'taxi-platform-v1', acceptedAt: now },
      grossAmount: quoted.total, paymentStatus: 'pending', refundStatus: 'none', paymentProvider: provider,
      bookingChannel: 'web', bookingStatus: 'pending_payment', settlementStatus: 'pending_payment', qrCodeValue: `CTT:${bookingRef}`,
      checkInStatus: 'not_checked', customerNote: clean(payload.notes, 1000), auditTrail: [{ action: 'taxi.booking.created', at: now, actorId: req?.session?.user?.id || 'guest' }], createdAt: now,
    };
    await repo.rides.save(ride, { bookingRef }, { session });
    await repo.bookings.save(booking, { bookingRef }, { session });
    await repo.bookingItems.save({
      id: `${bookingId}-taxi-ride`, bookingId, bookingRef, companyId: 'platform', listingId: booking.listingId,
      serviceType: 'local_transport', domainReservationId: rideId, quantity: 1, pricing: booking.pricing,
      priceSnapshot: { quotedAt: now, quote: quoted }, policySnapshot: { cancellationRules: quoted.listing.cancellationRules }, status: 'awaiting_payment',
    }, { id: `${bookingId}-taxi-ride` }, { session });
    await repo.passengers.save({ ...booking.passengers[0], bookingId, bookingRef, companyId: 'platform', listingId: booking.listingId, passengerIndex: 0 }, { id: booking.passengers[0].id }, { session });
    await repo.paymentIntents.save({
      id: `payment-intent-${bookingRef}`, intentRef: `PI-${bookingRef}`, bookingId, bookingRef, companyId: 'platform', customerUserId: booking.customerUserId,
      provider, idempotencyKey: `${provider}:${bookingRef}:initiate`, amount: booking.pricing.total, currency: booking.pricing.currency,
      status: 'created', expiresAt: new Date(Date.now() + 20 * 60 * 1000), attempts: [{ at: now, provider, status: 'created' }], metadata: { serviceType: 'local_transport', rideId, source: 'taxiBookingService' },
    }, { idempotencyKey: `${provider}:${bookingRef}:initiate` }, { session });
    await event(ride, 'ride_requested', 'awaiting_payment', 'customer', booking.customerUserId || 'guest', 'Ride created and awaiting payment', {}, session);
  });
  try {
    const payment = await paymentService.initiatePayment({
      provider, bookingRef, amount: booking.pricing.total, currency: booking.pricing.currency, customer: booking.guestSnapshot,
      idempotencyKey: `${provider}:${bookingRef}:initiate`, callbackUrl: `${env.appUrl}/booking/payment/callback?bookingRef=${encodeURIComponent(bookingRef)}`,
      description: `Classic Trip taxi ride ${bookingRef}`,
    });
    if (String(payment.status || '').toLowerCase() === 'failed') throw repo.problem(payment.message || 'Payment could not be initiated', 402, 'payment_failed');
    booking.paymentProvider = payment.provider || provider; booking.paymentRef = payment.providerReference || ''; booking.checkoutUrl = payment.checkoutUrl || '';
    booking.paymentStatus = payment.status === 'successful' ? 'successful' : 'pending';
    await repo.bookings.save(booking, { bookingRef });
    await repo.paymentIntents.updateOne({ bookingRef, provider }, { $set: { providerReference: booking.paymentRef, checkoutUrl: booking.checkoutUrl, status: booking.paymentStatus === 'successful' ? 'successful' : 'pending', paidAt: booking.paymentStatus === 'successful' ? new Date() : null }, $push: { attempts: { at: new Date(), provider, status: booking.paymentStatus, providerReference: booking.paymentRef } } });
    if (booking.paymentStatus === 'successful') return confirmPayment(bookingRef, { provider: booking.paymentProvider, providerReference: booking.paymentRef, source: 'immediate_payment' });
    return booking;
  } catch (error) {
    await failPayment(bookingRef, error.message, { source: 'payment_initiation' });
    throw error;
  }
}

async function confirmPayment(bookingRef, meta = {}) {
  let booking; let shouldDispatch = false;
  await repo.withTransaction(async (session) => {
    booking = await repo.bookings.findOne({ bookingRef, serviceType: 'local_transport' }, { session });
    if (!booking) throw repo.problem('Taxi booking not found', 404, 'taxi_booking_not_found');
    if (booking.paymentStatus === 'successful' && ['confirmed', 'in_progress', 'completed'].includes(booking.bookingStatus)) return;
    const ride = await repo.rides.findOne({ bookingRef }, { session });
    if (!ride) throw repo.problem('Taxi ride record is missing', 409, 'taxi_ride_missing');
    const scheduled = ride.rideType === 'scheduled' && new Date(ride.scheduledAt).getTime() > Date.now() + 10 * 60 * 1000;
    ride.status = scheduled ? 'scheduled' : 'dispatching';
    booking.paymentStatus = 'successful'; booking.bookingStatus = 'confirmed'; booking.settlementStatus = 'pending_fulfillment';
    booking.paymentProvider = meta.provider || booking.paymentProvider; booking.paymentRef = meta.providerReference || booking.paymentRef;
    booking.bookingItems = (booking.bookingItems || []).map((item) => ({ ...item, status: 'confirmed' }));
    booking.bookingLegs = (booking.bookingLegs || []).map((leg) => ({ ...leg, status: ride.status }));
    booking.ticketLegs = (booking.ticketLegs || []).map((leg) => ({ ...leg, status: ride.status }));
    await repo.rides.save(ride, { bookingRef }, { session }); await repo.bookings.save(booking, { bookingRef }, { session });
    await repo.bookingItems.updateMany({ bookingRef }, { $set: { status: 'confirmed' } }, { session });
    await event(ride, 'payment_confirmed', ride.status, 'payment', meta.source || 'webhook', 'Payment confirmed; provider earnings remain pending until ride completion', { provider: booking.paymentProvider }, session);
    await repo.outbox({ companyId: 'platform', eventType: scheduled ? 'TaxiRideScheduled' : 'TaxiDispatchRequested', aggregateType: 'taxi_ride', aggregateId: ride.id, payload: { bookingRef, scheduledAt: ride.scheduledAt, vehicleClass: ride.vehicleClass }, session });
    shouldDispatch = !scheduled;
  });
  if (shouldDispatch) await dispatchRideByBookingRef(bookingRef);
  return booking;
}

async function failPayment(bookingRef, reason = 'Payment failed', meta = {}) {
  await repo.withTransaction(async (session) => {
    const booking = await repo.bookings.findOne({ bookingRef, serviceType: 'local_transport' }, { session });
    if (!booking) return;
    const ride = await repo.rides.findOne({ bookingRef }, { session });
    if (ride) await event(ride, 'payment_failed', 'failed', 'payment', meta.source || 'webhook', reason, {}, session);
    await repo.assignments.deleteMany({ rideId: ride?.id || '' }, { session }); await repo.events.deleteMany({ rideId: ride?.id || '' }, { session });
    await repo.rides.deleteMany({ bookingRef }, { session }); await repo.bookingItems.deleteMany({ bookingRef }, { session });
    await repo.passengers.deleteMany({ bookingRef }, { session }); await repo.bookings.deleteMany({ bookingRef }, { session });
    await repo.payments.deleteMany({ bookingRef }, { session });
    await repo.paymentIntents.updateOne({ bookingRef }, { $set: { status: 'failed', failedAt: new Date(), failureReason: clean(reason, 500), metadata: { serviceType: 'local_transport', source: meta.source || 'payment_failure' } } }, { session });
  });
  return { purged: true, bookingRef };
}

function distanceFromDriver(availability, ride) {
  const km = haversineKm({ latitude: availability.latitude, longitude: availability.longitude }, ride.pickup || {});
  return Number.isFinite(km) ? km : 999999;
}

async function eligibleDriverRows(ride) {
  const availability = await repo.driverAvailabilities.list({ status: 'available', lastSeenAt: { $gt: new Date(Date.now() - 5 * 60 * 1000) } }, { limit: 2000 });
  if (!availability.length) return [];
  const companyIds = [...new Set(availability.map((row) => String(row.companyId || '')).filter(Boolean))];
  const vehicleIds = [...new Set(availability.map((row) => String(row.vehicleId || '')).filter(Boolean))];
  const driverIds = [...new Set(availability.map((row) => String(row.driverUserId || '')).filter(Boolean))];
  const [vehicles, employees, companies, users, profiles] = await Promise.all([
    repo.vehicles.list({ id: { $in: vehicleIds }, status: 'active', verificationStatus: 'approved', vehicleClass: ride.vehicleClass }, { limit: 3000 }),
    repo.employees.list({ companyId: { $in: companyIds }, userId: { $in: driverIds }, status: 'active' }, { limit: 3000 }),
    repo.companies.list({ id: { $in: companyIds }, status: 'active', verificationStatus: 'verified', companyType: 'local_transport' }, { limit: 1000 }),
    repo.users.list({ id: { $in: driverIds } }, { limit: 3000 }),
    repo.listings.list({ companyId: { $in: companyIds }, serviceType: 'local_transport', listingKind: 'fleet_partner_profile', complianceStatus: 'approved', status: 'active' }, { limit: 1000 }),
  ]);
  const vehicleById = new Map(vehicles.map((row) => [String(row.id), row]));
  const employeeByKey = new Map(employees.map((row) => [`${row.companyId}:${row.userId}`, row]));
  const companyById = new Map(companies.map((row) => [String(row.id), row]));
  const userById = new Map(users.map((row) => [String(row.id), row]));
  const approvedFleetIds = new Set(profiles.map((row) => String(row.companyId)));
  return availability.map((row) => {
    const vehicle = vehicleById.get(String(row.vehicleId)); const employee = employeeByKey.get(`${row.companyId}:${row.driverUserId}`);
    const company = companyById.get(String(row.companyId)); const user = userById.get(String(row.driverUserId));
    const eligibility = evaluateDriverEligibility(employee || {}, user || {});
    return { availability: row, vehicle, employee, company, user, eligibility };
  }).filter((row) => row.vehicle && row.company && row.eligibility.eligible && approvedFleetIds.has(String(row.company.id)))
    .sort((a, b) => distanceFromDriver(a.availability, ride) - distanceFromDriver(b.availability, ride));
}

async function dispatchRideByBookingRef(bookingRef, actorId = 'dispatch-job') {
  const ride = await repo.rides.findOne({ bookingRef });
  if (!ride) throw repo.problem('Taxi ride not found', 404, 'taxi_ride_not_found');
  return dispatchRide('platform', ride.id, actorId);
}

async function dispatchRide(platformScope, rideId, actorId = 'dispatch-job') {
  if (platformScope !== 'platform') throw repo.problem('Taxi dispatch is controlled only by the platform dispatch engine', 403, 'taxi_dispatch_platform_only');
  const ride = await repo.platformRideOrThrow(rideId);
  if (!['dispatching', 'scheduled'].includes(ride.status)) return { ride, assignments: [] };
  if (ride.status === 'scheduled' && new Date(ride.scheduledAt).getTime() > Date.now() + 15 * 60 * 1000) return { ride, assignments: [] };
  const candidates = (await eligibleDriverRows(ride)).slice(0, 5);
  if (!candidates.length) {
    ride.status = 'dispatching'; await repo.rides.save(ride, { id: ride.id });
    await event(ride, 'dispatch_waiting', ride.status, 'system', actorId, 'No eligible nearby driver is currently online');
    return { ride, assignments: [] };
  }
  const assignments = [];
  await repo.withTransaction(async (session) => {
    ride.status = 'dispatching'; await repo.rides.save(ride, { id: ride.id }, { session });
    for (const candidate of candidates) {
      const existing = await repo.assignments.findOne({ rideId: ride.id, driverUserId: candidate.availability.driverUserId }, { session });
      if (existing && ['offered', 'accepted'].includes(existing.status)) { assignments.push(existing); continue; }
      const row = {
        id: await repo.nextId('ride-assignment'), companyId: candidate.company.id, marketplaceCompanyId: 'platform', rideId: ride.id,
        driverUserId: candidate.availability.driverUserId, vehicleId: candidate.vehicle.id, status: 'offered', offeredAt: new Date(), expiresAt: new Date(Date.now() + 60 * 1000),
      };
      await repo.assignments.save(row, { rideId: ride.id, driverUserId: row.driverUserId }, { session });
      await repo.driverAvailabilities.updateOne({ companyId: row.companyId, driverUserId: row.driverUserId, status: 'available' }, { $set: { status: 'offered' } }, { session });
      assignments.push(row);
    }
    await event(ride, 'driver_offers_sent', ride.status, 'platform', actorId, `Ride offered to ${assignments.length} eligible driver(s)`, { driverCount: assignments.length }, session);
  });
  return { ride, assignments };
}

async function acceptAssignment(companyId, assignmentId, driverUserId) {
  let accepted;
  await repo.withTransaction(async (session) => {
    const assignment = await repo.assignments.findOne({ id: clean(assignmentId, 180), companyId, driverUserId, status: 'offered', expiresAt: { $gt: new Date() } }, { session });
    if (!assignment) throw repo.problem('Ride offer is expired or unavailable', 409, 'taxi_offer_unavailable');
    const ride = await repo.rides.findOne({ id: assignment.rideId, status: { $in: ['dispatching', 'scheduled'] } }, { session });
    if (!ride) throw repo.problem('Another driver already accepted this ride', 409, 'taxi_ride_already_assigned');
    const claimed = await repo.rides.updateOne({ id: ride.id, status: { $in: ['dispatching', 'scheduled'] }, $or: [{ driverUserId: '' }, { driverUserId: { $exists: false } }] }, { $set: { status: 'assigned', providerCompanyId: companyId, driverUserId, vehicleId: assignment.vehicleId, assignedAt: new Date() } }, { session });
    if (Number(claimed.matchedCount ?? claimed.n ?? 0) !== 1) throw repo.problem('Another driver already accepted this ride', 409, 'taxi_ride_already_assigned');
    assignment.status = 'accepted'; assignment.respondedAt = new Date(); await repo.assignments.save(assignment, { id: assignment.id }, { session });
    await repo.assignments.updateMany({ rideId: ride.id, id: { $ne: assignment.id }, status: 'offered' }, { $set: { status: 'cancelled', respondedAt: new Date() } }, { session });
    await repo.driverAvailabilities.updateOne({ companyId, driverUserId }, { $set: { status: 'assigned', vehicleId: assignment.vehicleId } }, { session });
    const otherAssignments = await repo.assignments.list({ rideId: ride.id, id: { $ne: assignment.id } }, { session });
    for (const other of otherAssignments) await repo.driverAvailabilities.updateOne({ companyId: other.companyId, driverUserId: other.driverUserId, status: 'offered' }, { $set: { status: 'available' } }, { session });
    Object.assign(ride, { status: 'assigned', providerCompanyId: companyId, driverUserId, vehicleId: assignment.vehicleId, assignedAt: new Date() });
    const booking = await repo.bookings.findOne({ bookingRef: ride.bookingRef }, { session });
    if (booking) {
      booking.providerCompanyId = companyId; booking.companyId = companyId; booking.tenantId = companyId;
      booking.bookingLegs = (booking.bookingLegs || []).map((leg) => ({ ...leg, status: 'assigned', providerCompanyId: companyId }));
      booking.ticketLegs = (booking.ticketLegs || []).map((leg) => ({ ...leg, status: 'assigned', providerCompanyId: companyId }));
      await repo.bookings.save(booking, { bookingRef: booking.bookingRef }, { session });
      await repo.bookingItems.updateMany({ bookingRef: booking.bookingRef }, { $set: { companyId, providerCompanyId: companyId, status: 'assigned' } }, { session });
    }
    await event(ride, 'driver_assigned', 'assigned', 'driver', driverUserId, 'Driver accepted the platform-dispatched ride', { vehicleId: assignment.vehicleId, providerCompanyId: companyId }, session);
    accepted = ride;
  });
  return accepted;
}

async function rejectAssignment(companyId, assignmentId, driverUserId) {
  const assignment = await repo.assignments.findOne({ id: clean(assignmentId, 180), companyId, driverUserId, status: 'offered' });
  if (!assignment) throw repo.problem('Ride offer not found', 404, 'taxi_offer_not_found');
  assignment.status = 'rejected'; assignment.respondedAt = new Date(); await repo.assignments.save(assignment, { id: assignment.id });
  await repo.driverAvailabilities.updateOne({ companyId, driverUserId, status: 'offered' }, { $set: { status: 'available' } });
  return assignment;
}

const DRIVER_TRANSITIONS = { assigned: ['driver_arriving'], driver_arriving: ['arrived'], arrived: ['in_progress', 'no_show'], in_progress: ['completed'] };
const PLATFORM_TRANSITIONS = { scheduled: ['dispatching', 'cancelled'], dispatching: ['cancelled'], assigned: ['cancelled'], driver_arriving: ['cancelled'], arrived: ['cancelled'] };

async function transitionRide(companyId, rideId, nextStatus, actor = {}) {
  const platformOverride = actor.platformOverride === true || companyId === 'platform';
  const ride = platformOverride ? await repo.platformRideOrThrow(rideId) : await repo.rideOrThrow(companyId, rideId);
  const next = clean(nextStatus, 40);
  const allowed = platformOverride ? PLATFORM_TRANSITIONS : DRIVER_TRANSITIONS;
  if (!(allowed[ride.status] || []).includes(next)) throw repo.problem(`Cannot move ride from ${ride.status} to ${next}`, 409, 'taxi_transition_not_allowed');
  if (!platformOverride) {
    if (!actor.driverUserId || String(ride.driverUserId || '') !== String(actor.driverUserId)) throw repo.problem('Only the assigned driver can update this ride', 403, 'taxi_driver_scope_denied');
    if (String(ride.providerCompanyId || '') !== String(companyId)) throw repo.problem('Ride belongs to another fleet partner', 403, 'taxi_provider_scope_denied');
  }
  if (next === 'in_progress') {
    const submitted = clean(actor.pickupPin, 20);
    if (!submitted || !safeTimingEqual(pinHash(submitted), ride.pickupPinHash)) throw repo.problem('Correct passenger pickup PIN is required to start the ride', 403, 'taxi_pickup_pin_invalid');
  }
  const now = new Date(); ride.status = next;
  if (next === 'driver_arriving') ride.driverArrivingAt = now;
  if (next === 'arrived') ride.arrivedAt = now;
  if (next === 'in_progress') ride.startedAt = now;
  if (next === 'completed') { ride.completedAt = now; ride.finalFare = Number(ride.quotedFare || 0); }
  if (next === 'cancelled' || next === 'no_show') { ride.cancelledAt = now; ride.cancellationReason = clean(actor.reason || (next === 'no_show' ? 'Passenger no-show' : 'Ride cancelled'), 500); }
  let bookingToSettle = null;
  await repo.withTransaction(async (session) => {
    await repo.rides.save(ride, { id: ride.id }, { session });
    const booking = await repo.bookings.findOne({ bookingRef: ride.bookingRef }, { session });
    if (booking) {
      if (next === 'in_progress') { booking.bookingStatus = 'in_progress'; booking.checkInStatus = 'checked_in'; }
      if (next === 'completed') { booking.bookingStatus = 'completed'; booking.completedAt = now; booking.settlementStatus = 'pending'; booking.ticketLegs = (booking.ticketLegs || []).map((leg) => ({ ...leg, status: 'completed' })); bookingToSettle = booking; }
      if (next === 'no_show') { booking.bookingStatus = 'no_show'; booking.checkInStatus = 'no_show'; }
      if (next === 'cancelled') booking.bookingStatus = 'cancelled';
      booking.bookingLegs = (booking.bookingLegs || []).map((leg) => ({ ...leg, status: next }));
      await repo.bookings.save(booking, { bookingRef: booking.bookingRef }, { session });
      await repo.bookingItems.updateMany({ bookingRef: booking.bookingRef }, { $set: { status: next } }, { session });
    }
    if (ride.driverUserId) await repo.driverAvailabilities.updateOne({ companyId: ride.providerCompanyId, driverUserId: ride.driverUserId }, { $set: { status: ['completed', 'cancelled', 'no_show'].includes(next) ? 'available' : (next === 'in_progress' ? 'on_trip' : 'assigned') } }, { session });
    await event(ride, `ride_${next}`, next, platformOverride ? 'platform' : 'driver', actor.driverUserId || actor.actorId || 'platform', actor.reason || '', {}, session);
    await repo.outbox({ companyId: ride.providerCompanyId || 'platform', eventType: `TaxiRide${next.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase())}`, aggregateType: 'taxi_ride', aggregateId: ride.id, payload: { bookingRef: ride.bookingRef, status: next }, session });
  });
  if (bookingToSettle && ride.providerCompanyId) await paymentSettlementService.settleBookingPayment(bookingToSettle, { source: 'taxi_ride_completed' });
  return ride;
}

async function publicTracking(bookingRef, access = {}) {
  const booking = await repo.bookings.findOne({ bookingRef: clean(bookingRef, 120), serviceType: 'local_transport' });
  if (!booking) throw repo.problem('Taxi booking not found', 404, 'taxi_booking_not_found');
  const email = clean(access.email || access.contact, 254).toLowerCase(); const phone = clean(access.phone || access.contact, 60).replace(/\D/g, ''); const code = clean(access.accessCode || access.code, 40).toLowerCase();
  const allowed = (email && email === clean(booking.guestSnapshot?.email, 254).toLowerCase()) || (phone.length >= 9 && clean(booking.guestSnapshot?.phone, 60).replace(/\D/g, '').endsWith(phone.slice(-9))) || (code && code === clean(booking.guestLookupCode, 40).toLowerCase());
  if (!allowed) throw repo.problem('Booking contact or access code is required', 403, 'taxi_tracking_access_denied');
  const ride = await repo.rides.findOne({ bookingRef: booking.bookingRef });
  if (!ride) throw repo.problem('Taxi ride not found', 404, 'taxi_ride_not_found');
  const vehicle = ride.vehicleId ? await repo.vehicles.findOne({ id: ride.vehicleId, companyId: ride.providerCompanyId }) : null;
  const user = ride.driverUserId ? await repo.users.findOne({ id: ride.driverUserId }) : null;
  const availability = ride.driverUserId ? await repo.driverAvailabilities.findOne({ companyId: ride.providerCompanyId, driverUserId: ride.driverUserId }) : null;
  return {
    bookingRef: booking.bookingRef, status: ride.status, rideType: ride.rideType, scheduledAt: ride.scheduledAt,
    pickup: ride.pickup, destination: ride.destination, vehicleClass: ride.vehicleClass, quotedFare: ride.quotedFare, finalFare: ride.finalFare, currency: ride.currency,
    driver: user ? { name: user.fullName || user.name || 'Assigned driver', phoneMasked: clean(user.phone, 60).replace(/.(?=.{4})/g, '*') } : null,
    vehicle: vehicle ? { registrationNumber: vehicle.registrationNumber, make: vehicle.make, model: vehicle.model, color: vehicle.color, vehicleClass: vehicle.vehicleClass } : null,
    location: availability && ['assigned', 'on_trip'].includes(availability.status) ? { latitude: availability.latitude, longitude: availability.longitude, lastSeenAt: availability.lastSeenAt } : null,
    pickupPin: ['assigned', 'driver_arriving', 'arrived'].includes(ride.status) ? (() => { try { return secretBox.open(ride.pickupPinEncrypted, 'taxi-pickup-pin'); } catch (_) { return ''; } })() : undefined,
  };
}

async function dispatchScheduledRides(now = new Date()) {
  const due = await repo.rides.list({ status: 'scheduled', scheduledAt: { $lte: new Date(now.getTime() + 15 * 60 * 1000) } }, { sort: { scheduledAt: 1 }, limit: 500 });
  const results = [];
  for (const ride of due) {
    try { results.push(await dispatchRide('platform', ride.id, 'scheduled-dispatch-job')); }
    catch (error) { results.push({ rideId: ride.id, error: error.message }); }
  }
  return { due: due.length, results };
}

async function expireOffers(now = new Date()) {
  const expired = await repo.assignments.list({ status: 'offered', expiresAt: { $lte: now } }, { limit: 1000 });
  for (const assignment of expired) {
    assignment.status = 'expired'; assignment.respondedAt = now; await repo.assignments.save(assignment, { id: assignment.id });
    await repo.driverAvailabilities.updateOne({ companyId: assignment.companyId, driverUserId: assignment.driverUserId, status: 'offered' }, { $set: { status: 'available' } });
  }
  return { expired: expired.length };
}

async function refundBooking(bookingRef, reason = 'Refunded', meta = {}) {
  let booking;
  await repo.withTransaction(async (session) => {
    booking = await repo.bookings.findOne({ bookingRef, serviceType: 'local_transport' }, { session });
    if (!booking) throw repo.problem('Taxi booking not found', 404, 'taxi_booking_not_found');
    const ride = await repo.rides.findOne({ bookingRef }, { session });
    if (ride && ['in_progress', 'completed'].includes(ride.status)) throw repo.problem('Started or completed rides require a manual dispute review', 409, 'taxi_refund_manual_required');
    if (ride) {
      ride.status = 'refunded'; ride.cancelledAt = new Date(); ride.cancellationReason = clean(reason, 500); await repo.rides.save(ride, { id: ride.id }, { session });
      await repo.assignments.updateMany({ rideId: ride.id, status: { $in: ['offered', 'accepted'] } }, { $set: { status: 'cancelled' } }, { session });
      if (ride.driverUserId) await repo.driverAvailabilities.updateOne({ companyId: ride.providerCompanyId, driverUserId: ride.driverUserId }, { $set: { status: 'available' } }, { session });
      await event(ride, 'ride_refunded', 'refunded', 'finance', meta.actorId || 'payment-webhook', reason, {}, session);
    }
    booking.paymentStatus = 'refunded'; booking.bookingStatus = 'refunded'; booking.refundStatus = 'refunded'; booking.refundedAmount = Number(booking.pricing?.total || 0);
    booking.settlementStatus = 'refunded'; booking.cancellationReason = clean(reason, 500); booking.ticketLegs = (booking.ticketLegs || []).map((leg) => ({ ...leg, status: 'refunded' }));
    await repo.bookings.save(booking, { bookingRef }, { session }); await repo.bookingItems.updateMany({ bookingRef }, { $set: { status: 'refunded' } }, { session });
  });
  return booking;
}

module.exports = {
  quote, createGuestBooking, confirmPayment, failPayment, refundBooking,
  dispatchRide, dispatchRideByBookingRef, acceptAssignment, rejectAssignment, transitionRide,
  publicTracking, dispatchScheduledRides, expireOffers, eligibleDriverRows, event,
};
