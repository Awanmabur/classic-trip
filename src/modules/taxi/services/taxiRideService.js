'use strict';

const repo = require('../repositories/taxiRepository');
const quoteService = require('./taxiQuoteService');
const securityService = require('../../../services/security/securityService');
const sensitive = require('../../../services/security/sensitiveFieldService');
const paymentSettlementService = require('../../../services/booking/paymentSettlementService');
const refundWorkflowService = require('../../../services/support/workflowService');
const calculateCommission = require('../../../utils/calculateCommission');
const generateBookingRef = require('../../../utils/generateBookingRef');
const { PLATFORM_MOBILITY_OWNER } = require('../domain/taxiGovernance');
const {
  cleanText, integerValue, validationError, conflictError, code, randomToken, hashToken, safeEqual,
  actorId, assertTransition, RIDE_TRANSITIONS,
} = require('../domain/taxiDomain');

function now() { return new Date(); }
function opts(session) { return session ? { session } : {}; }

async function event({ ride, from = '', to, eventType, actorType = 'system', actorIdValue = 'system', location = null, metadata = {}, session = null }) {
  const row = {
    id: await repo.nextId('ride-event'), companyId: PLATFORM_MOBILITY_OWNER,
    providerCompanyId: ride.providerCompanyId || '', rideId: ride.id,
    eventType: eventType || to, actorType, actorId: actorIdValue,
    statusFrom: from, statusTo: to, location, metadata,
    occurredAt: now(), createdAt: now(), updatedAt: now(),
  };
  await repo.events.save(row, { id: row.id }, opts(session));
  return row;
}

function customerContact(payload = {}) {
  const row = {
    fullName: cleanText(payload.contactName, 120),
    phone: cleanText(payload.phone, 60),
    email: cleanText(payload.email, 180).toLowerCase(),
  };
  if (!row.fullName || !row.phone) throw validationError('Passenger name and phone are required');
  return row;
}

async function createRide(payload = {}, actor = {}) {
  const quote = await quoteService.readQuote(payload.quoteId, payload.quoteToken);
  const contact = customerContact(payload);
  const idempotencyKey = cleanText(payload.idempotencyKey || actor.idempotencyKey, 240);
  if (!idempotencyKey) throw conflictError('Idempotency key is required', 'idempotency_key_required');
  const claim = await securityService.claimIdempotencyKey({
    key: idempotencyKey, scope: 'taxi_ride_create', entityType: 'ride_quote', entityId: quote.id,
    payload: { quoteId: quote.id, contact },
  });
  const existing = await repo.rides.findOne({ quoteId: quote.id, idempotencyKey });
  if (claim.replayed && existing) return { ride: existing, booking: await repo.bookings.findOne({ id: existing.bookingId }), replayed: true };

  const result = await repo.withTransaction(async (session) => {
    const bookingRef = generateBookingRef('taxi');
    const bookingId = await repo.nextId('booking');
    const bookingItemId = await repo.nextId('booking-item');
    const requestId = await repo.nextId('ride-request');
    const rideId = await repo.nextId('taxi-ride');
    const requestRef = code('RQ');
    const rideRef = code('RIDE');
    const listing = await repo.oneOrThrow(repo.listings, { id: quote.listingId, companyId: PLATFORM_MOBILITY_OWNER, bookable: true }, 'Local rides are not available', opts(session));
    const split = calculateCommission(quote.priceSnapshot.total, Boolean(actor.referralCode), { commissionPercent: listing.commissionPercent, currency: quote.priceSnapshot?.currency });
    const pricing = { ...quote.priceSnapshot, split };
    const pickupPin = String(Math.floor(1000 + Math.random() * 9000));
    const scheduled = new Date(quote.scheduledPickupAt).getTime() > Date.now() + 5 * 60 * 1000;
    const dispatchAfter = scheduled ? new Date(new Date(quote.scheduledPickupAt).getTime() - 20 * 60 * 1000) : now();
    const customerUserId = actor.userId || actor.id || '';
    const request = {
      id: requestId, requestRef, companyId: PLATFORM_MOBILITY_OWNER, providerCompanyId: '', platformManaged: true,
      listingId: quote.listingId, quoteId: quote.id, customerUserId, contactSnapshot: contact,
      serviceType: quote.serviceType, requestedPickupAt: quote.scheduledPickupAt, scheduled,
      pickup: quote.pickup, destination: quote.destination, stops: quote.stops || [], routeSnapshot: quote.routeSnapshot || null, vehicleClassId: quote.vehicleClassId,
      passengerCount: integerValue(payload.passengerCount, 'Passengers', 1, 20, 1),
      accessibilityNeeds: Array.isArray(payload.accessibilityNeeds) ? payload.accessibilityNeeds.map((value) => cleanText(value, 120)).filter(Boolean) : [],
      status: 'awaiting_payment', dispatchAfter, dispatchAttempts: 0, createdAt: now(), updatedAt: now(),
    };
    const ride = {
      id: rideId, rideRef, requestId, quoteId: quote.id, idempotencyKey,
      bookingId, bookingRef, bookingItemId,
      companyId: PLATFORM_MOBILITY_OWNER, providerCompanyId: '', platformManaged: true,
      listingId: quote.listingId, customerUserId,
      vehicleClassId: quote.vehicleClassId, serviceType: quote.serviceType,
      pickup: quote.pickup, destination: quote.destination, stops: quote.stops || [], routeSnapshot: quote.routeSnapshot || null, scheduledPickupAt: quote.scheduledPickupAt,
      pickupPinHash: hashToken(pickupPin), pickupPinEncrypted: sensitive.encrypt(pickupPin, `ride-pin:${rideId}`),
      status: 'awaiting_payment', paymentStatus: 'pending', settlementStatus: 'pending_payment',
      pricing, routeSnapshot: quote.routeSnapshot || null, estimateSnapshot: { distanceKm: quote.distanceKm, durationMinutes: quote.durationMinutes, price: quote.priceSnapshot, route: quote.routeSnapshot || null },
      createdAt: now(), updatedAt: now(),
    };
    const booking = {
      id: bookingId, bookingRef, guestLookupCode: randomToken(8), serviceType: 'local_transport',
      customerUserId, companyId: PLATFORM_MOBILITY_OWNER, providerCompanyId: '', tenantId: PLATFORM_MOBILITY_OWNER, listingId: quote.listingId,
      passengers: [{ id: 'primary', fullName: contact.fullName, name: contact.fullName, phone: contact.phone, email: contact.email, pickupPoint: quote.pickup.address, dropoffPoint: quote.destination.address, seatOrRoom: 'Private ride', checkInStatus: 'not_checked' }],
      bookingItems: [{ id: bookingItemId, serviceType: 'local_transport', domainReservationId: rideId, quantity: 1 }],
      bookingLegs: [{ type: 'taxi', rideRef, pickup: quote.pickup, destination: quote.destination, stops: quote.stops || [], routeSnapshot: quote.routeSnapshot || null, scheduledPickupAt: quote.scheduledPickupAt, serviceType: quote.serviceType }],
      ticketLegs: [], quantity: 1, pricing, grossAmount: pricing.total,
      buyerSnapshot: contact, guestSnapshot: contact, paymentStatus: 'pending', refundStatus: 'none',
      bookingChannel: actor.bookingChannel || 'web', bookingStatus: 'awaiting_payment', settlementStatus: 'pending_payment',
      commercialTermsSnapshot: { commissionPercent: split.partnerCommissionPercent }, referralCode: actor.referralCode || '',
      auditTrail: [{ at: now(), action: 'taxi_ride_created', actorId: actorId(actor) }], createdAt: now(), updatedAt: now(),
    };
    const item = {
      id: bookingItemId, bookingId, bookingRef, companyId: PLATFORM_MOBILITY_OWNER, providerCompanyId: '',
      listingId: quote.listingId, serviceType: 'local_transport', domainReservationId: rideId, quantity: 1,
      pricing, priceSnapshot: quote.priceSnapshot, policySnapshot: { cancellationFee: 0, noShowFee: 0 },
      status: 'awaiting_payment', createdAt: now(), updatedAt: now(),
    };
    await repo.requests.save(request, { id: request.id }, opts(session));
    await repo.rides.save(ride, { id: ride.id }, opts(session));
    await repo.bookings.save(booking, { id: booking.id }, opts(session));
    await repo.bookingItems.save(item, { id: item.id }, opts(session));
    quote.status = 'accepted'; quote.updatedAt = now(); await repo.quotes.save(quote, { id: quote.id }, opts(session));
    await event({ ride, to: 'awaiting_payment', eventType: 'ride_created', actorType: customerUserId ? 'customer' : 'system', actorIdValue: actorId(actor), session });
    await repo.audit({ actorId: actorId(actor), action: 'taxi.ride.created', targetType: 'taxi_ride', targetId: ride.id, companyId: PLATFORM_MOBILITY_OWNER, metadata: { bookingRef }, session });
    return { request, ride, booking, bookingItem: item, pickupPin };
  });
  await securityService.completeIdempotency(claim.record, { rideId: result.ride.id, bookingRef: result.booking.bookingRef });
  return result;
}

async function confirmPayment(bookingRef, payment = {}) {
  return repo.withTransaction(async (session) => {
    const booking = await repo.oneOrThrow(repo.bookings, { bookingRef, serviceType: 'local_transport' }, 'Local ride booking was not found', opts(session));
    const ride = await repo.oneOrThrow(repo.rides, { bookingId: booking.id, companyId: PLATFORM_MOBILITY_OWNER }, 'Local ride was not found', opts(session));
    const request = await repo.oneOrThrow(repo.requests, { id: ride.requestId, companyId: PLATFORM_MOBILITY_OWNER }, 'Ride request was not found', opts(session));
    if (ride.paymentStatus === 'successful') return booking;
    const next = request.scheduled && new Date(request.dispatchAfter) > now() ? 'scheduled' : 'dispatch_pending';
    const from = ride.status;
    Object.assign(ride, { status: next, paymentStatus: 'successful', settlementStatus: 'pending_fulfillment', updatedAt: now() });
    Object.assign(request, { status: next, updatedAt: now() });
    Object.assign(booking, {
      paymentStatus: 'successful', paymentProvider: payment.provider || booking.paymentProvider || '',
      paymentRef: payment.providerReference || booking.paymentRef || '',
      bookingStatus: next === 'scheduled' ? 'confirmed' : 'in_progress', settlementStatus: 'pending_fulfillment',
      ticketLegs: [{ type: 'local_transport', rideId: ride.id, rideRef: ride.rideRef, pickup: ride.pickup, destination: ride.destination, routeSnapshot: ride.routeSnapshot || null, scheduledPickupAt: ride.scheduledPickupAt, status: next }],
      updatedAt: now(),
    });
    await repo.rides.save(ride, { id: ride.id }, opts(session));
    await repo.requests.save(request, { id: request.id }, opts(session));
    await repo.bookings.save(booking, { id: booking.id }, opts(session));
    await repo.bookingItems.updateMany({ bookingId: booking.id, serviceType: 'local_transport' }, { $set: { status: 'confirmed', updatedAt: now() } }, opts(session));
    await event({ ride, from, to: next, eventType: 'payment_confirmed', metadata: { provider: payment.provider || '' }, session });
    await repo.outbox({ eventType: 'TaxiRidePaymentConfirmed', aggregateType: 'taxi_ride', aggregateId: ride.id, companyId: PLATFORM_MOBILITY_OWNER, payload: { bookingRef, rideRef: ride.rideRef, status: next }, session });
    return booking;
  });
}

async function failPayment(bookingRef, reason = 'Ride payment failed', payment = {}) {
  return repo.withTransaction(async (session) => {
    const booking = await repo.bookings.findOne({ bookingRef, serviceType: 'local_transport' }, opts(session));
    if (!booking) return null;
    const ride = await repo.rides.findOne({ bookingId: booking.id }, opts(session));
    if (ride) {
      const from = ride.status; ride.status = 'failed'; ride.paymentStatus = 'failed'; ride.updatedAt = now();
      await repo.rides.save(ride, { id: ride.id }, opts(session));
      await repo.requests.updateMany({ id: ride.requestId }, { $set: { status: 'failed', updatedAt: now() } }, opts(session));
      await event({ ride, from, to: 'failed', eventType: 'payment_failed', metadata: { reason }, session });
    }
    Object.assign(booking, { paymentStatus: 'failed', bookingStatus: 'failed', notes: reason, paymentProvider: payment.provider || booking.paymentProvider || '', paymentRef: payment.providerReference || booking.paymentRef || '', updatedAt: now() });
    await repo.bookings.save(booking, { id: booking.id }, opts(session));
    await repo.bookingItems.updateMany({ bookingId: booking.id }, { $set: { status: 'failed', updatedAt: now() } }, opts(session));
    return booking;
  });
}

function assertPartnerAccess(ride, actor = {}) {
  if (actor.actorType === 'system' || actor.role === 'super_admin') return;
  if (actor.driverProfileId && String(actor.driverProfileId) === String(ride.driverProfileId || '')) return;
  if (actor.companyId && String(actor.companyId) === String(ride.providerCompanyId || '')) return;
  throw validationError('Local ride was not found', 404);
}

async function transitionRide(rideId, next, actor = {}, metadata = {}) {
  return repo.withTransaction(async (session) => {
    const ride = await repo.oneOrThrow(repo.rides, { id: cleanText(rideId, 180) }, 'Local ride was not found', opts(session));
    assertPartnerAccess(ride, actor);
    const from = ride.status; next = assertTransition(from, next, RIDE_TRANSITIONS);
    ride.status = next; ride.updatedAt = now();
    if (next === 'driver_arrived') ride.driverArrivedAt = now();
    if (next === 'in_progress') ride.startedAt = now();
    if (next === 'completed') ride.completedAt = now();
    await repo.rides.save(ride, { id: ride.id }, opts(session));
    await repo.requests.updateMany({ id: ride.requestId }, { $set: { status: ['scheduled', 'dispatch_pending', 'offering', 'assigned', 'cancelled', 'failed'].includes(next) ? next : 'assigned', updatedAt: now() } }, opts(session));
    await event({ ride, from, to: next, eventType: `ride_${next}`, actorType: actor.actorType || 'partner', actorIdValue: actorId(actor), location: metadata.location || null, metadata, session });
    return ride;
  });
}

async function verifyPickupPin(rideId, pin, actor = {}) {
  const ride = await repo.oneOrThrow(repo.rides, { id: cleanText(rideId, 180), driverProfileId: actor.driverProfileId }, 'Assigned local ride was not found');
  if (ride.status !== 'driver_arrived') throw conflictError('Driver must arrive before verifying the passenger pickup PIN');
  if (!safeEqual(hashToken(cleanText(pin, 12)), ride.pickupPinHash)) throw validationError('Pickup PIN is incorrect', 403, 'invalid_pickup_pin');
  return transitionRide(ride.id, 'pickup_verified', { ...actor, actorType: 'driver' }, { verified: true });
}

function assertCustomerAccess(booking, lookupCode = '', actor = {}) {
  if (actor.actorType === 'system' || actor.role === 'super_admin') return;
  const authenticatedUserId = cleanText(actor.userId, 180);
  if (authenticatedUserId && String(booking.customerUserId || '') === authenticatedUserId) return;
  if (!lookupCode || !safeEqual(lookupCode, booking.guestLookupCode || '')) throw validationError('Ride booking lookup code is required or invalid', 403);
}

async function cancelRide(reference, reason, actor = {}) {
  return repo.withTransaction(async (session) => {
    const ref = cleanText(reference, 180);
    const ride = await repo.oneOrThrow(repo.rides, { $or: [{ id: ref }, { rideRef: ref }, { bookingRef: ref }] }, 'Local ride was not found', opts(session));
    const cancellationReason = cleanText(reason, 1000);
    if (cancellationReason.length < 5) throw validationError('Provide a clear cancellation reason');
    const booking = await repo.bookings.findOne({ id: ride.bookingId, companyId: PLATFORM_MOBILITY_OWNER }, opts(session));
    if (actor.companyId || actor.driverProfileId) assertPartnerAccess(ride, actor);
    else if (actor.actorType !== 'system') assertCustomerAccess(booking, actor.lookupCode, actor);
    if (['completed', 'refunded', 'cancelled'].includes(ride.status)) throw conflictError('This local ride cannot be cancelled');
    const from = ride.status; assertTransition(from, 'cancelled', RIDE_TRANSITIONS);
    ride.status = 'cancelled'; ride.cancellation = { reason: cancellationReason, actorId: actorId(actor), actorType: actor.actorType || 'customer', at: now() }; ride.updatedAt = now();
    await repo.rides.save(ride, { id: ride.id }, opts(session));
    await repo.requests.updateMany({ id: ride.requestId }, { $set: { status: 'cancelled', updatedAt: now() } }, opts(session));
    await repo.assignments.updateMany({ rideId: ride.id, status: { $in: ['offered', 'accepted'] } }, { $set: { status: 'cancelled', updatedAt: now() } }, opts(session));
    if (ride.driverProfileId) {
      await repo.availability.updateMany({ driverProfileId: ride.driverProfileId }, { $set: { status: 'available', updatedAt: now() }, $inc: { version: 1 } }, opts(session));
      await repo.vehicles.updateMany({ id: ride.vehicleId }, { $set: { operationalStatus: 'available', updatedAt: now() } }, opts(session));
    }
    let refund = null;
    if (booking) {
      Object.assign(booking, { bookingStatus: 'cancelled', cancelledAt: now(), cancellationReason: ride.cancellation.reason, refundStatus: booking.paymentStatus === 'successful' ? 'requested' : 'none', updatedAt: now() });
      await repo.bookings.save(booking, { id: booking.id }, opts(session));
      await repo.bookingItems.updateMany({ bookingId: booking.id }, { $set: { status: 'cancelled', updatedAt: now() } }, opts(session));
      if (booking.paymentStatus === 'successful') {
        refund = await refundWorkflowService.requestRefundLive({
          bookingRef: booking.bookingRef,
          requesterId: actorId(actor),
          reason: ride.cancellation.reason || 'Customer cancelled local ride',
          companyId: booking.companyId,
          actorType: actor.actorType || 'customer',
          session,
        });
        booking.refundIds = [...new Set([...(booking.refundIds || []), refund.id])];
      }
    }
    await event({ ride, from, to: 'cancelled', eventType: 'ride_cancelled', actorType: actor.actorType || 'customer', actorIdValue: actorId(actor), metadata: { reason: ride.cancellation.reason, refundId: refund?.id || '' }, session });
    return { ride: { ...ride, pickupPinHash: undefined, pickupPinEncrypted: undefined }, booking: booking ? { ...booking, guestLookupCode: undefined } : null, refund: refund ? { id: refund.id, status: refund.status, amount: refund.amount, currency: refund.currency } : null };
  });
}

async function confirmRefund(reference, payment = {}) {
  return repo.withTransaction(async (session) => {
    const ref = cleanText(reference, 180);
    const ride = await repo.oneOrThrow(repo.rides, { $or: [{ id: ref }, { rideRef: ref }, { bookingRef: ref }] }, 'Local ride was not found', opts(session));
    const booking = await repo.oneOrThrow(repo.bookings, { id: ride.bookingId, companyId: PLATFORM_MOBILITY_OWNER }, 'Local ride booking was not found', opts(session));
    if (ride.status === 'refunded' && booking.paymentStatus === 'refunded') return booking;
    if (ride.status !== 'cancelled') throw conflictError('The local ride must be cancelled before its payment refund is finalized', 'ride_refund_requires_cancellation');
    ride.status = 'refunded'; ride.paymentStatus = 'refunded'; ride.settlementStatus = 'refunded'; ride.updatedAt = now();
    await repo.rides.save(ride, { id: ride.id }, opts(session));
    Object.assign(booking, {
      bookingStatus: 'refunded', paymentStatus: 'refunded', refundStatus: 'refunded',
      refundedAt: now(), refundId: payment.refundId || booking.refundId || '',
      paymentProvider: payment.provider || booking.paymentProvider || '',
      paymentRef: payment.providerReference || booking.paymentRef || '',
      settlementStatus: 'refunded', updatedAt: now(),
    });
    await repo.bookings.save(booking, { id: booking.id }, opts(session));
    await repo.bookingItems.updateMany({ bookingId: booking.id }, { $set: { status: 'refunded', updatedAt: now() } }, opts(session));
    await event({ ride, from: 'cancelled', to: 'refunded', eventType: 'ride_refunded', actorType: 'system', actorIdValue: payment.source || 'refund-workflow', metadata: { refundId: payment.refundId || '', providerReference: payment.providerReference || '' }, session });
    await repo.outbox({ eventType: 'TaxiRideRefunded', aggregateType: 'taxi_ride', aggregateId: ride.id, companyId: ride.companyId, payload: { bookingRef: booking.bookingRef, refundId: payment.refundId || '' }, dedupeKey: `TaxiRideRefunded:${ride.id}`, session });
    await repo.audit({ actorId: payment.source || 'refund-workflow', action: 'taxi.ride.refunded', targetType: 'taxi_ride', targetId: ride.id, companyId: ride.companyId, metadata: { bookingRef: booking.bookingRef, refundId: payment.refundId || '', providerReference: payment.providerReference || '' }, session });
    return booking;
  });
}

async function reportCustomerIncident(reference, payload = {}, actor = {}) {
  return repo.withTransaction(async (session) => {
    const ref = cleanText(reference, 180);
    const ride = await repo.oneOrThrow(repo.rides, { $or: [{ rideRef: ref }, { bookingRef: ref }, { id: ref }] }, 'Local ride was not found', opts(session));
    const booking = await repo.oneOrThrow(repo.bookings, { id: ride.bookingId, companyId: PLATFORM_MOBILITY_OWNER }, 'Local ride booking was not found', opts(session));
    assertCustomerAccess(booking, actor.lookupCode, actor);
    const category = cleanText(payload.category || 'safety', 40).toLowerCase();
    const severity = cleanText(payload.severity || 'high', 20).toLowerCase();
    const description = cleanText(payload.description, 3000);
    if (!['safety', 'collision', 'harassment', 'lost_item', 'vehicle', 'route', 'payment', 'other'].includes(category)) throw validationError('Incident category is invalid');
    if (!['low', 'medium', 'high', 'critical'].includes(severity)) throw validationError('Incident severity is invalid');
    if (description.length < 10) throw validationError('Describe the safety issue in at least 10 characters');
    const incident = {
      id: await repo.nextId('taxi-incident'),
      companyId: PLATFORM_MOBILITY_OWNER,
      providerCompanyId: ride.providerCompanyId || '',
      rideId: ride.id,
      driverProfileId: ride.driverProfileId || '',
      vehicleId: ride.vehicleId || '',
      reportedBy: actorId(actor),
      reporterType: 'customer',
      category,
      severity,
      description,
      evidence: [],
      status: 'open',
      createdAt: now(),
      updatedAt: now(),
    };
    await repo.incidents.save(incident, { id: incident.id }, opts(session));
    const allowedSafetyHold = Array.isArray(RIDE_TRANSITIONS[String(ride.status || '').toLowerCase()])
      && RIDE_TRANSITIONS[String(ride.status || '').toLowerCase()].includes('safety_hold');
    if (severity === 'critical' && allowedSafetyHold) {
      const from = ride.status;
      ride.status = 'safety_hold';
      ride.safetyState = { status: 'open', incidentId: incident.id, openedAt: now(), openedBy: actorId(actor) };
      ride.updatedAt = now();
      await repo.rides.save(ride, { id: ride.id }, opts(session));
      await event({ ride, from, to: 'safety_hold', eventType: 'customer_safety_hold', actorType: 'customer', actorIdValue: actorId(actor), metadata: { incidentId: incident.id }, session });
    } else {
      await event({ ride, from: ride.status, to: ride.status, eventType: 'customer_incident_reported', actorType: 'customer', actorIdValue: actorId(actor), metadata: { incidentId: incident.id, category, severity }, session });
    }
    await repo.audit({ actorId: actorId(actor), action: 'taxi.customer.incident_reported', targetType: 'taxi_incident', targetId: incident.id, companyId: PLATFORM_MOBILITY_OWNER, metadata: { rideId: ride.id, category, severity }, session });
    await repo.outbox({ eventType: 'TaxiCustomerIncidentReported', aggregateType: 'taxi_incident', aggregateId: incident.id, companyId: PLATFORM_MOBILITY_OWNER, payload: { rideId: ride.id, bookingRef: ride.bookingRef, category, severity }, session });
    return { incident: { id: incident.id, category, severity, status: incident.status, createdAt: incident.createdAt }, ride: { id: ride.id, status: ride.status } };
  });
}

async function getPublicRide(reference, lookupCode = '', actor = {}) {
  const ref = cleanText(reference, 180);
  const ride = await repo.rides.findOne({ $or: [{ rideRef: ref }, { bookingRef: ref }, { id: ref }] });
  if (!ride) throw validationError('Local ride was not found', 404);
  const booking = await repo.oneOrThrow(repo.bookings, { id: ride.bookingId, companyId: PLATFORM_MOBILITY_OWNER }, 'Local ride booking was not found');
  assertCustomerAccess(booking, lookupCode, actor);
  const providerCompanyId = ride.providerCompanyId || '';
  const [driver, vehicle, klass, events, location] = await Promise.all([
    ride.driverProfileId ? repo.drivers.findOne({ id: ride.driverProfileId, companyId: providerCompanyId }) : null,
    ride.vehicleId ? repo.vehicles.findOne({ id: ride.vehicleId, companyId: providerCompanyId }) : null,
    repo.vehicleClasses.findOne({ id: ride.vehicleClassId, companyId: PLATFORM_MOBILITY_OWNER }),
    repo.events.list({ rideId: ride.id, companyId: PLATFORM_MOBILITY_OWNER }, { sort: { occurredAt: 1 }, limit: 100 }),
    ride.driverProfileId ? repo.locations.findOne({ driverProfileId: ride.driverProfileId, rideId: ride.id, expiresAt: { $gt: now() } }, { sort: { capturedAt: -1 } }) : null,
  ]);
  let driverPublic = null;
  if (driver) {
    const user = await repo.users.findOne({ id: driver.userId });
    driverPublic = { id: driver.id, name: user?.fullName || 'Assigned driver', ratingAverage: driver.ratingAverage || 0, completedRideCount: driver.completedRideCount || 0, driverNumber: driver.driverNumber };
  }
  const vehiclePublic = vehicle ? { id: vehicle.id, registrationNumber: vehicle.registrationNumber, make: vehicle.make, model: vehicle.model, year: vehicle.year, color: vehicle.color, passengerCapacity: vehicle.passengerCapacity, luggageCapacity: vehicle.luggageCapacity, images: vehicle.images || [] } : null;
  let pickupPin = '';
  try { pickupPin = sensitive.decrypt(ride.pickupPinEncrypted, `ride-pin:${ride.id}`); } catch (_) { pickupPin = ''; }
  return {
    booking: { ...booking, guestLookupCode: undefined },
    ride: { ...ride, pickupPinHash: undefined, pickupPinEncrypted: undefined, pickupPin },
    vehicle: vehiclePublic, vehicleClass: klass, driver: driverPublic, events,
    location: location ? { latitude: location.latitude, longitude: location.longitude, heading: location.heading, speedKph: location.speedKph, capturedAt: location.capturedAt } : null,
  };
}

module.exports = { createRide, confirmPayment, failPayment, transitionRide, verifyPickupPin, cancelRide, confirmRefund, reportCustomerIncident, getPublicRide, event, assertPartnerAccess };
