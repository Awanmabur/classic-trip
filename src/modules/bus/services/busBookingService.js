'use strict';
const { calculateCustomerFees } = require('../../../utils/calculateCustomerFees');

const crypto = require('crypto');
const generateCode = require('../../../utils/generateCode');
const { env } = require('../../../config/env');
const paymentService = require('../../../services/payment/paymentService');
const paymentSettlementService = require('../../../services/booking/paymentSettlementService');
const repository = require('../repositories/busRepository');
const inventoryService = require('./busInventoryService');
const {
  cleanText,
  normalize,
  unique,
  validationError,
  conflictError,
  randomToken,
  hashToken,
  tokenPreview,
  immutableSnapshot,
} = require('../domain/busDomain');

function nowIso() { return new Date().toISOString(); }
function list(value) { return Array.isArray(value) ? value : value == null ? [] : [value]; }
function listCsv(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  return unique(source.map((item) => cleanText(item, 180)).filter(Boolean));
}
function itemAt(values, index, fallback = '') {
  const rows = list(values);
  return cleanText(rows[index] == null ? fallback : rows[index], 500);
}
function actorId(value) { return cleanText(value || 'guest', 180); }
function minExpiry(holds = []) {
  return holds.map((hold) => new Date(hold.expiresAt).getTime()).filter(Number.isFinite).sort((a, b) => a - b)[0] || Date.now();
}


function addonChargeMultiplier(chargeBasis = 'per_booking', passengerCount = 1, legCount = 1) {
  const passengers = Math.max(1, Number(passengerCount) || 1);
  const legs = Math.max(1, Number(legCount) || 1);
  if (chargeBasis === 'per_passenger') return passengers;
  if (chargeBasis === 'per_trip_leg') return legs;
  if (chargeBasis === 'per_passenger_per_leg') return passengers * legs;
  return 1;
}

async function selectedAddonPricing({ companyId, listingId, addonIds = [], passengerCount = 1, legCount = 1, currency = '' } = {}) {
  const ids = unique(listCsv(addonIds));
  if (!ids.length) return { addons: [], addonTotal: 0 };
  const rows = await repository.serviceAddons.list({ companyId, listingId, id: { $in: ids }, status: 'active' }, { limit: 100 });
  if (rows.length !== ids.length) throw validationError('One or more selected optional extras are unavailable for this listing', 409);
  const tripType = legCount > 1 ? 'round_trip' : 'one_way';
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const addons = ids.map((id) => {
    const row = byId.get(String(id));
    if (!row) throw validationError('Selected optional extra was not found', 409);
    const availability = normalize(row.availableFor || 'all');
    if (availability !== 'all' && availability !== tripType) throw validationError(`${row.name || 'This add-on'} is not available for this trip type`, 409);
    const addonCurrency = cleanText(row.currency, 10).toUpperCase();
    if (addonCurrency && currency && addonCurrency !== String(currency).toUpperCase()) throw validationError('Add-on currency does not match the trip currency', 409);
    const unitPrice = Number(row.price || 0);
    const quantity = addonChargeMultiplier(row.chargeBasis, passengerCount, legCount);
    return immutableSnapshot({
      id: row.id,
      name: row.name,
      description: row.description || '',
      category: row.category || 'other',
      icon: row.icon || 'fa-circle-plus',
      chargeBasis: row.chargeBasis || 'per_booking',
      availableFor: row.availableFor || 'all',
      unitPrice,
      quantity,
      total: unitPrice * quantity,
      currency: addonCurrency || currency,
    });
  });
  return { addons, addonTotal: addons.reduce((sum, row) => sum + Number(row.total || 0), 0) };
}

function guestSnapshot(payload = {}) {
  const fullName = cleanText(payload.fullName || payload.name, 180);
  const email = cleanText(payload.email, 254).toLowerCase();
  const phone = cleanText(payload.phone, 80);
  if (!fullName) throw validationError('Traveler full name is required');
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw validationError('A valid email address is required');
  if (!phone) throw validationError('Phone number is required');
  return {
    fullName,
    name: fullName,
    email,
    phone,
    country: cleanText(payload.country, 120),
    address: cleanText(payload.address, 300),
  };
}

function buildPassengerPayloads(payload = {}, seatNumbers = []) {
  const names = list(payload.passengerNames);
  const phones = list(payload.passengerPhones);
  const emails = list(payload.passengerEmails);
  const identities = list(payload.identityNumbers || payload.passengerIdentityNumbers || payload.documentNumbers);
  const identityTypes = list(payload.identityTypes || payload.idTypes);
  const datesOfBirth = list(payload.datesOfBirth);
  const sexes = list(payload.sexes);
  const nationalities = list(payload.nationalities);
  const notes = list(payload.specialNotes || payload.travelNotes || payload.passengerNotes);
  const luggageCounts = list(payload.luggageCounts);
  const emergencyNames = list(payload.emergencyContactNames);
  const emergencyPhones = list(payload.emergencyContactPhones);
  const buyer = guestSnapshot(payload);
  return seatNumbers.map((seatNumber, index) => {
    const fullName = itemAt(names, index, index === 0 ? buyer.fullName : '');
    if (!fullName) throw validationError(`Passenger ${index + 1} full name is required`);
    return {
      fullName,
      name: fullName,
      phone: itemAt(phones, index, buyer.phone),
      email: itemAt(emails, index, buyer.email).toLowerCase(),
      identityNumber: itemAt(identities, index),
      identityType: itemAt(identityTypes, index),
      dateOfBirth: itemAt(datesOfBirth, index) || null,
      sex: itemAt(sexes, index),
      nationality: itemAt(nationalities, index),
      emergencyContactName: itemAt(emergencyNames, index),
      emergencyContactPhone: itemAt(emergencyPhones, index),
      luggageCount: Math.max(0, Number(itemAt(luggageCounts, index, '0')) || 0),
      seatOrRoom: seatNumber,
      seatNumber,
      specialNotes: itemAt(notes, index),
      travelNotes: itemAt(notes, index),
      checkInStatus: 'not_checked',
    };
  });
}

function payloadHash(payload = {}) {
  const stable = JSON.stringify(payload, Object.keys(payload).sort());
  return crypto.createHash('sha256').update(stable).digest('hex');
}

async function claimIdempotency(key, scope, entityId, payload = {}) {
  const cleanKey = cleanText(key, 300);
  if (!cleanKey) return { replayed: false, record: null };
  const existing = await repository.idempotencyKeys.findOne({ key: cleanKey, scope });
  if (existing) {
    if (existing.payloadHash && existing.payloadHash !== payloadHash(payload)) {
      throw conflictError('This idempotency key was already used with different booking data', 'idempotency_payload_mismatch');
    }
    return { replayed: true, record: existing };
  }
  const timestamp = new Date();
  const record = {
    id: await repository.nextId('idempotency'),
    key: cleanKey,
    scope,
    entityType: 'booking',
    entityId: cleanText(entityId, 180),
    payloadHash: payloadHash(payload),
    status: 'started',
    firstSeenAt: timestamp.toISOString(),
    lastSeenAt: timestamp.toISOString(),
    expiresAt: new Date(timestamp.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    metadata: {},
  };
  try {
    await repository.idempotencyKeys.save(record, { key: cleanKey, scope });
  } catch (error) {
    if (error.code === 11000) return { replayed: true, record: await repository.idempotencyKeys.findOne({ key: cleanKey, scope }) };
    throw error;
  }
  return { replayed: false, record };
}

async function completeIdempotency(record, booking) {
  if (!record) return;
  record.entityId = booking.id;
  record.status = 'completed';
  record.responseHash = payloadHash({ bookingRef: booking.bookingRef, status: booking.bookingStatus });
  record.lastSeenAt = nowIso();
  record.metadata = { bookingRef: booking.bookingRef, bookingStatus: booking.bookingStatus, paymentStatus: booking.paymentStatus };
  await repository.idempotencyKeys.save(record, { key: record.key, scope: record.scope });
}

function legSpec(payload = {}, prefix = '') {
  const returnLeg = prefix === 'return';
  return {
    legType: returnLeg ? 'return' : 'outbound',
    holdId: cleanText(returnLeg ? payload.returnHoldId : payload.holdId, 180),
    holdToken: cleanText(returnLeg ? payload.returnHoldToken : payload.holdToken, 500),
    scheduleId: cleanText(returnLeg ? payload.returnScheduleId : payload.scheduleId, 180),
    selectedSeats: listCsv(returnLeg ? payload.returnSeats : (payload.selectedSeats || payload.selected)),
    originStopId: cleanText(returnLeg ? payload.returnOriginStopId : payload.originStopId, 180),
    destinationStopId: cleanText(returnLeg ? payload.returnDestinationStopId : payload.destinationStopId, 180),
  };
}

async function ensureLegHold(spec, context = {}) {
  if (spec.holdId) {
    if (!spec.holdToken) throw validationError(`The ${spec.legType} seat-hold access token is required`, 403);
    return inventoryService.assertActiveHold(spec.holdId, spec.holdToken);
  }
  if (!spec.scheduleId || !spec.selectedSeats.length) throw validationError(`Select a ${spec.legType} departure and seats before booking`);
  return inventoryService.holdSeats({
    scheduleId: spec.scheduleId,
    originStopId: spec.originStopId,
    destinationStopId: spec.destinationStopId,
    selectedSeats: spec.selectedSeats,
    context: { ...context, source: `bus_booking_checkout_${spec.legType}` },
  });
}

async function buildLeg({ hold, bookingId, bookingRef, passengers, legIndex }) {
  const availability = await inventoryService.getAvailability({
    scheduleId: hold.scheduleId,
    originStopId: hold.originStopId,
    destinationStopId: hold.destinationStopId,
    holdId: hold.id,
  });
  const schedule = await repository.schedules.findOne({ id: hold.scheduleId, companyId: hold.companyId });
  if (!schedule) throw conflictError('Held departure no longer exists', 'departure_configuration_missing');
  const seatNumbers = listCsv(hold.seatNumbers || hold.seatNumber);
  if (!seatNumbers.length) throw conflictError('Seat hold has no seats attached', 'hold_inventory_mismatch');
  if (seatNumbers.length !== passengers.length) throw validationError('Each trip leg must have one selected seat for every passenger');
  const seatByNumber = new Map(availability.seats.map((seat) => [String(seat.seatNumber).toUpperCase(), seat]));
  const selectedSeatRows = seatNumbers.map((number) => seatByNumber.get(String(number).toUpperCase()));
  if (selectedSeatRows.some((seat) => !seat)) throw conflictError('Seat-map version no longer matches this hold', 'seat_map_mismatch');

  const timestamp = nowIso();
  const itemId = await repository.nextId('booking-item');
  const reservationId = await repository.nextId('bus-reservation');
  const subtotal = selectedSeatRows.reduce((sum, seat) => sum + Number(availability.fare.baseAmountPerSeat || 0) + Number(seat.priceDelta || 0), 0);
  const total = subtotal;
  if (total <= 0) throw validationError('Server pricing produced an invalid booking total');
  const pricing = { subtotal, fees: 0, addonTotal: 0, total, currency: availability.fare.currency, addons: [], split: null };
  const priceSnapshot = immutableSnapshot({
    ...availability.fare,
    selectedSeats: selectedSeatRows.map((seat) => ({ seatNumber: seat.seatNumber, seatClass: seat.seatClass, priceDelta: seat.priceDelta })),
    subtotal,
    total,
  });
  const item = {
    id: itemId,
    bookingId,
    bookingRef,
    companyId: hold.companyId,
    listingId: hold.listingId,
    serviceType: 'bus',
    domainReservationId: reservationId,
    quantity: seatNumbers.length,
    pricing,
    priceSnapshot,
    policySnapshot: immutableSnapshot({
      refundable: availability.fare.refundable,
      changeable: availability.fare.changeable,
      baggageAllowanceKg: availability.fare.baggageAllowanceKg,
    }),
    status: 'awaiting_payment',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const reservation = {
    id: reservationId,
    bookingItemId: itemId,
    bookingId,
    bookingRef,
    companyId: hold.companyId,
    listingId: hold.listingId,
    routeId: schedule.routeId,
    scheduleId: hold.scheduleId,
    vehicleId: schedule.vehicleId,
    seatMapVersionId: schedule.seatMapVersionId,
    fareProductId: availability.fare.fareProductId,
    originStopId: hold.originStopId,
    destinationStopId: hold.destinationStopId,
    originOrder: hold.originOrder,
    destinationOrder: hold.destinationOrder,
    segmentIds: hold.segmentIds,
    passengerCount: seatNumbers.length,
    holdId: hold.id,
    priceSnapshot,
    routeSnapshot: immutableSnapshot({ route: availability.route, journey: availability.journey, stops: availability.stops }),
    status: 'awaiting_payment',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const assignments = [];
  const tickets = [];
  const ticketLegs = [];
  for (let index = 0; index < passengers.length; index += 1) {
    const passenger = passengers[index];
    const seatNumber = seatNumbers[index];
    const assignment = {
      id: await repository.nextId('bus-seat-assignment'),
      reservationId,
      bookingItemId: itemId,
      bookingId,
      bookingRef,
      passengerId: passenger.id,
      companyId: hold.companyId,
      scheduleId: hold.scheduleId,
      seatNumber,
      originStopId: hold.originStopId,
      destinationStopId: hold.destinationStopId,
      segmentIds: hold.segmentIds,
      status: 'held',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const qrToken = randomToken(32);
    const ticket = {
      id: await repository.nextId('bus-ticket'),
      ticketNumber: generateCode('BUS', 12),
      bookingId,
      bookingRef,
      bookingItemId: itemId,
      reservationId,
      seatAssignmentId: assignment.id,
      passengerId: passenger.id,
      companyId: hold.companyId,
      listingId: hold.listingId,
      routeId: schedule.routeId,
      scheduleId: hold.scheduleId,
      seatNumber,
      originStopId: hold.originStopId,
      destinationStopId: hold.destinationStopId,
      qrTokenHash: hashToken(qrToken),
      qrTokenPreview: tokenPreview(qrToken),
      status: 'pending_payment',
      checkInStatus: 'not_checked',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    assignments.push(assignment);
    tickets.push(ticket);
    ticketLegs.push({
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      legType: legIndex === 0 ? 'outbound' : 'return',
      legIndex,
      scheduleId: hold.scheduleId,
      routeId: schedule.routeId,
      passengerId: passenger.id,
      passengerName: passenger.fullName,
      seatNumber,
      originStopId: hold.originStopId,
      destinationStopId: hold.destinationStopId,
      originName: availability.journey.originName,
      destinationName: availability.journey.destinationName,
      departAt: availability.schedule.departAt,
      arriveAt: availability.schedule.arriveAt,
      vehicleName: availability.schedule.vehicleName,
      qrToken,
      qrTokenHash: ticket.qrTokenHash,
      status: 'pending_payment',
      checkInStatus: 'not_checked',
    });
  }
  return { hold, availability, schedule, seatNumbers, item, reservation, assignments, tickets, ticketLegs, pricing };
}

async function buildCanonicalRows(payload = {}, req = null) {
  const guest = guestSnapshot(payload);
  const context = {
    createdBy: req?.session?.user?.id || guest.email || 'guest',
    ip: req?.ip || '',
    userAgent: req?.headers?.['user-agent'] || '',
    requestId: req?.id || req?.headers?.['x-request-id'] || '',
    guest,
  };
  const outboundSpec = legSpec(payload);
  const returnSpec = legSpec(payload, 'return');
  const hasReturn = Boolean(returnSpec.holdId || returnSpec.scheduleId || returnSpec.selectedSeats.length);
  const outboundHold = await ensureLegHold(outboundSpec, context);
  let returnHold = null;
  try {
    if (hasReturn) returnHold = await ensureLegHold(returnSpec, context);
  } catch (error) {
    if (!outboundSpec.holdId) await inventoryService.releaseHold(outboundHold.id, 'return_leg_hold_failed', context.createdBy);
    throw error;
  }
  const holds = [outboundHold, ...(returnHold ? [returnHold] : [])];
  const outboundSeats = listCsv(outboundHold.seatNumbers || outboundHold.seatNumber);
  if (!outboundSeats.length) throw conflictError('Outbound hold has no seats attached', 'hold_inventory_mismatch');
  if (returnHold && listCsv(returnHold.seatNumbers || returnHold.seatNumber).length !== outboundSeats.length) {
    throw validationError('Outbound and return trips must have the same number of passenger seats');
  }
  if (returnHold) {
    if (outboundHold.companyId !== returnHold.companyId) throw validationError('Round-trip legs must belong to the same bus company');
    if (outboundHold.originStopId !== returnHold.destinationStopId || outboundHold.destinationStopId !== returnHold.originStopId) {
      throw validationError('Return journey must reverse the outbound origin and destination');
    }
    const [outboundSchedule, returnSchedule] = await Promise.all([
      repository.schedules.findOne({ id: outboundHold.scheduleId }),
      repository.schedules.findOne({ id: returnHold.scheduleId }),
    ]);
    const outboundJourneyEndsAt = outboundSchedule?.arriveAt || outboundSchedule?.departAt;
    if (!outboundSchedule || !returnSchedule || new Date(returnSchedule.departAt).getTime() <= new Date(outboundJourneyEndsAt).getTime()) {
      throw validationError('Return departure must be after the outbound journey arrives');
    }
  }

  const timestamp = nowIso();
  const bookingId = await repository.nextId('booking');
  const bookingRef = generateCode('CTB', 10);
  const passengerInputs = buildPassengerPayloads(payload, outboundSeats);
  const passengers = [];
  for (let index = 0; index < passengerInputs.length; index += 1) {
    passengers.push({
      ...passengerInputs[index],
      id: await repository.nextId('passenger'),
      bookingId,
      bookingRef,
      companyId: outboundHold.companyId,
      listingId: outboundHold.listingId,
      scheduleId: outboundHold.scheduleId,
      passengerIndex: index,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
  const legs = [];
  for (let legIndex = 0; legIndex < holds.length; legIndex += 1) {
    legs.push(await buildLeg({ hold: holds[legIndex], bookingId, bookingRef, passengers, legIndex }));
  }
  const currencies = unique(legs.map((leg) => leg.pricing.currency));
  if (currencies.length !== 1) throw validationError('All bus legs in one booking must use the same currency');
  const subtotal = legs.reduce((sum, leg) => sum + Number(leg.pricing.subtotal || 0), 0);
  const addonPricing = await selectedAddonPricing({
    companyId: outboundHold.companyId,
    listingId: outboundHold.listingId,
    addonIds: payload.addons,
    passengerCount: passengers.length,
    legCount: legs.length,
    currency: currencies[0],
  });
  const customerFees = calculateCustomerFees(subtotal);
  const pricing = {
    subtotal,
    fees: customerFees.totalFees,
    addonTotal: addonPricing.addonTotal,
    total: customerFees.total + addonPricing.addonTotal,
    currency: currencies[0],
    addons: addonPricing.addons,
    split: null,
  };
  const firstLeg = legs[0];
  const booking = {
    id: bookingId,
    bookingRef,
    guestLookupCode: generateCode('LOOKUP', 6),
    serviceType: 'bus',
    guestSnapshot: guest,
    buyerSnapshot: immutableSnapshot(guest),
    customerUserId: cleanText(payload.customerUserId, 180) || (['agent_offline', 'company_manual', 'employee_manual'].includes(normalize(payload.source)) ? '' : cleanText(req?.session?.user?.id, 180)),
    companyId: outboundHold.companyId,
    tenantId: outboundHold.companyId,
    listingId: outboundHold.listingId,
    scheduleId: outboundHold.scheduleId,
    tripId: outboundHold.scheduleId,
    vehicleId: firstLeg.schedule.vehicleId,
    passengers: passengers.map((passenger) => ({ ...passenger })),
    bookingItems: legs.map((leg, index) => ({
      id: leg.item.id,
      serviceType: 'bus',
      legType: index === 0 ? 'outbound' : 'return',
      reservationId: leg.reservation.id,
      listingId: leg.hold.listingId,
      scheduleId: leg.hold.scheduleId,
      routeId: leg.schedule.routeId,
      seatNumbers: leg.seatNumbers,
      originStopId: leg.hold.originStopId,
      destinationStopId: leg.hold.destinationStopId,
      pricing: leg.item.pricing,
      status: leg.item.status,
    })),
    bookingLegs: legs.map((leg, index) => ({
      id: leg.reservation.id,
      serviceType: 'bus',
      legType: index === 0 ? 'outbound' : 'return',
      scheduleId: leg.hold.scheduleId,
      routeId: leg.schedule.routeId,
      vehicleId: leg.schedule.vehicleId,
      originStopId: leg.hold.originStopId,
      destinationStopId: leg.hold.destinationStopId,
      seatNumbers: leg.seatNumbers,
      departAt: leg.availability.schedule.departAt,
      arriveAt: leg.availability.schedule.arriveAt,
      status: leg.reservation.status,
    })),
    ticketLegs: legs.flatMap((leg) => leg.ticketLegs),
    tripType: returnHold ? 'round_trip' : 'one_way',
    quantity: passengers.length,
    addons: addonPricing.addons,
    pricing,
    grossAmount: pricing.total,
    paymentStatus: 'pending',
    bookingChannel: 'web',
    bookingStatus: 'pending_payment',
    settlementStatus: 'pending',
    lockedUntil: new Date(minExpiry(holds)).toISOString(),
    checkInStatus: 'not_checked',
    customerNote: cleanText(payload.customerNote || payload.notes, 1200),
    auditTrail: [{
      at: timestamp,
      action: 'bus_booking_created',
      actor: req?.session?.user?.id || guest.email,
      holdIds: holds.map((hold) => hold.id),
      legCount: legs.length,
      addonIds: addonPricing.addons.map((addon) => addon.id),
      addonTotal: addonPricing.addonTotal,
    }],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  booking.qrCodeValue = booking.ticketLegs[0]?.qrToken || '';
  return {
    holds,
    legs,
    booking,
    items: legs.map((leg) => leg.item),
    reservations: legs.map((leg) => leg.reservation),
    passengers,
    assignments: legs.flatMap((leg) => leg.assignments),
    tickets: legs.flatMap((leg) => leg.tickets),
  };
}

async function persistPendingRows(rows, actor = 'guest') {
  await repository.withTransaction(async (session) => {
    await repository.bookings.save(rows.booking, { bookingRef: rows.booking.bookingRef }, { session });
    await repository.bookingItems.saveMany(rows.items, null, { session });
    await repository.reservations.saveMany(rows.reservations, null, { session });
    await repository.passengers.saveMany(rows.passengers, null, { session });
    await repository.seatAssignments.saveMany(rows.assignments, null, { session });
    await repository.tickets.saveMany(rows.tickets, null, { session });
    for (const hold of rows.holds) await inventoryService.attachHoldToBooking(hold.id, rows.booking, actor, session);
    await repository.outbox({
      eventType: 'BusBookingCreated',
      aggregateType: 'booking',
      aggregateId: rows.booking.id,
      companyId: rows.booking.companyId,
      payload: { bookingRef: rows.booking.bookingRef, scheduleIds: rows.reservations.map((row) => row.scheduleId), reservationIds: rows.reservations.map((row) => row.id) },
      dedupeKey: `BusBookingCreated:${rows.booking.id}`,
      session,
    });
    await repository.audit({
      actorId: actorId(actor),
      action: 'bus.booking.created',
      targetType: 'booking',
      targetId: rows.booking.id,
      companyId: rows.booking.companyId,
      metadata: { bookingRef: rows.booking.bookingRef, holdIds: rows.holds.map((hold) => hold.id), seats: rows.legs.map((leg) => leg.seatNumbers), addonIds: (rows.booking.addons || []).map((addon) => addon.id), addonTotal: rows.booking.pricing?.addonTotal || 0 },
      session,
    });
  });
}

async function purgeFailedBookingArtifacts(booking, options = {}) {
  if (!booking) return { purged: false };
  if (normalize(booking.paymentStatus) === 'successful' || normalize(booking.bookingStatus) === 'confirmed') {
    throw conflictError('A successful booking cannot be removed by the failed-payment cleanup');
  }
  const records = options.records || await canonicalRecords(booking);
  const holds = options.holds || [];
  await repository.withTransaction(async (session) => {
    const holdIds = unique([
      ...holds.map((hold) => hold?.id),
      ...records.reservations.map((reservation) => reservation.holdId),
    ].filter(Boolean));
    for (const holdId of holdIds) await inventoryService.releaseHold(holdId, 'payment_failed', options.actor || 'payment-cleanup', session);
    await repository.payments.deleteMany({ $or: [{ bookingId: booking.id }, { bookingRef: booking.bookingRef }] }, { session });
    await repository.tickets.deleteMany({ $or: [{ bookingId: booking.id }, { bookingRef: booking.bookingRef }] }, { session });
    await repository.seatAssignments.deleteMany({ $or: [{ bookingId: booking.id }, { bookingRef: booking.bookingRef }] }, { session });
    await repository.passengers.deleteMany({ $or: [{ bookingId: booking.id }, { bookingRef: booking.bookingRef }] }, { session });
    await repository.reservations.deleteMany({ $or: [{ bookingId: booking.id }, { bookingRef: booking.bookingRef }] }, { session });
    await repository.bookingItems.deleteMany({ $or: [{ bookingId: booking.id }, { bookingRef: booking.bookingRef }] }, { session });
    await repository.bookings.deleteMany({ $or: [{ id: booking.id }, { bookingRef: booking.bookingRef }] }, { session });
    await repository.audit({
      actorId: actorId(options.actor || 'payment-cleanup'),
      action: 'bus.booking.failed_payment_purged',
      targetType: 'payment_attempt',
      targetId: booking.bookingRef,
      companyId: booking.companyId,
      metadata: { reason: cleanText(options.reason || 'Payment failed', 500), retainedRecord: 'payment_intent_only' },
      session,
    });
  });
  return { purged: true, bookingRef: booking.bookingRef };
}

async function canonicalRecords(booking) {
  const [items, reservations, passengers, assignments, tickets] = await Promise.all([
    repository.bookingItems.list({ bookingId: booking.id, serviceType: 'bus' }),
    repository.reservations.list({ bookingId: booking.id }),
    repository.passengers.list({ bookingId: booking.id }),
    repository.seatAssignments.list({ bookingId: booking.id }),
    repository.tickets.list({ bookingId: booking.id }),
  ]);
  return { items, reservations, passengers, assignments, tickets };
}

async function createGuestBooking(payload = {}, req = null) {
  const provider = paymentService.resolveProviderName(payload.provider || payload.paymentProvider || env.paymentProvider);
  const idempotencyKey = cleanText(
    payload.idempotencyKey
      || req?.headers?.['idempotency-key']
      || `${provider}:${payload.holdId || payload.scheduleId}:${payload.returnHoldId || payload.returnScheduleId || ''}:${cleanText(payload.email, 254)}:${cleanText(payload.selectedSeats || payload.selected, 180)}`,
    300
  );
  const claimPayload = {
    holdId: payload.holdId,
    returnHoldId: payload.returnHoldId,
    scheduleId: payload.scheduleId,
    returnScheduleId: payload.returnScheduleId,
    selectedSeats: payload.selectedSeats || payload.selected,
    returnSeats: payload.returnSeats,
    email: cleanText(payload.email, 254),
  };
  const claim = await claimIdempotency(idempotencyKey, 'bus_booking_create', payload.holdId || payload.scheduleId || '', claimPayload);
  if (claim.replayed && claim.record?.metadata?.bookingRef) {
    const existing = await repository.bookings.findOne({ bookingRef: claim.record.metadata.bookingRef, serviceType: 'bus' });
    if (existing) return existing;
  }
  const rows = await buildCanonicalRows(payload, req);
  await persistPendingRows(rows, req?.session?.user?.id || rows.booking.guestSnapshot.email);
  const intent = {
    id: await repository.nextId('payment-intent'),
    intentRef: generateCode('PI', 10),
    bookingId: rows.booking.id,
    bookingRef: rows.booking.bookingRef,
    companyId: rows.booking.companyId,
    customerUserId: rows.booking.customerUserId,
    provider,
    idempotencyKey: `${provider}:${rows.booking.bookingRef}:initiate`,
    amount: rows.booking.pricing.total,
    currency: rows.booking.pricing.currency,
    status: 'created',
    expiresAt: rows.booking.lockedUntil,
    attempts: [{ at: nowIso(), provider, status: 'created' }],
    metadata: {
      source: 'busBookingService',
      holdIds: rows.holds.map((hold) => hold.id),
      reservationIds: rows.reservations.map((reservation) => reservation.id),
    },
    createdAt: nowIso(),
  };
  await repository.paymentIntents.save(intent, { idempotencyKey: intent.idempotencyKey });
  try {
    const result = await paymentService.initiatePayment({
      provider,
      bookingRef: rows.booking.bookingRef,
      reference: rows.booking.bookingRef,
      amount: rows.booking.pricing.total,
      currency: rows.booking.pricing.currency,
      customer: rows.booking.guestSnapshot,
      idempotencyKey: intent.idempotencyKey,
      callbackUrl: `${env.appUrl}/booking/payment/callback?bookingRef=${encodeURIComponent(rows.booking.bookingRef)}`,
      description: `Classic Trip bus booking ${rows.booking.bookingRef}`,
      metadata: {
        bookingId: rows.booking.id,
        bookingRef: rows.booking.bookingRef,
        serviceType: 'bus',
        holdIds: rows.holds.map((hold) => hold.id),
      },
    });
    Object.assign(intent, {
      providerReference: result.providerReference || '',
      checkoutUrl: result.checkoutUrl || '',
      status: result.status || 'pending',
      paidAt: result.status === 'successful' ? nowIso() : null,
      attempts: [...intent.attempts, { at: nowIso(), provider, status: result.status || 'pending', providerReference: result.providerReference || '' }],
    });
    await repository.paymentIntents.save(intent, { idempotencyKey: intent.idempotencyKey });
    if (normalize(result.status) === 'failed') {
      const paymentError = new Error(result.message || result.failureReason || 'Payment could not be completed');
      paymentError.status = 402;
      paymentError.code = 'payment_failed';
      throw paymentError;
    }
    Object.assign(rows.booking, {
      paymentProvider: result.provider || provider,
      paymentRef: result.providerReference || '',
      checkoutUrl: result.checkoutUrl || '',
      paymentStatus: result.status || 'pending',
      updatedAt: nowIso(),
    });
    const payment = {
      id: await repository.nextId('payment'),
      bookingId: rows.booking.id,
      bookingRef: rows.booking.bookingRef,
      companyId: rows.booking.companyId,
      customerUserId: rows.booking.customerUserId,
      provider: result.provider || provider,
      providerReference: result.providerReference || `${rows.booking.bookingRef}:pending`,
      paymentRef: result.providerReference || '',
      amount: rows.booking.pricing.total,
      grossAmount: rows.booking.pricing.total,
      currency: rows.booking.pricing.currency,
      status: result.status || 'pending',
      settlementStatus: 'pending',
      paidAt: result.status === 'successful' ? (result.paidAt || nowIso()) : null,
      checkoutUrl: result.checkoutUrl || '',
      idempotencyKey: `${provider}:${rows.booking.bookingRef}:${result.providerReference || 'pending'}`,
      rawPayload: result.rawPayload || result,
      metadata: { source: 'busBookingService.createGuestBooking', paymentIntentId: intent.id },
      createdAt: nowIso(),
    };
    await repository.withTransaction(async (session) => {
      await repository.bookings.save(rows.booking, { bookingRef: rows.booking.bookingRef }, { session });
      await repository.payments.save(payment, { idempotencyKey: payment.idempotencyKey }, { session });
    });
    let booking = rows.booking;
    if (result.status === 'successful') {
      booking = await confirmPayment(rows.booking.bookingRef, {
        provider: payment.provider,
        providerReference: payment.providerReference,
        paymentId: payment.id,
        source: 'payment_initiation',
      });
    }
    await completeIdempotency(claim.record, booking);
    return booking;
  } catch (error) {
    intent.status = 'failed';
    intent.failedAt = nowIso();
    intent.failureReason = cleanText(error.message, 500);
    intent.attempts = [...(intent.attempts || []), { at: nowIso(), provider, status: 'failed', reason: intent.failureReason }];
    await repository.paymentIntents.save(intent, { idempotencyKey: intent.idempotencyKey });
    await purgeFailedBookingArtifacts(rows.booking, {
      holds: rows.holds,
      records: { items: rows.items, reservations: rows.reservations, passengers: rows.passengers, assignments: rows.assignments, tickets: rows.tickets },
      reason: error.message,
      actor: req?.session?.user?.id || rows.booking.guestSnapshot.email || 'busBookingService',
    });
    if (claim.record) {
      claim.record.status = 'failed';
      claim.record.lastSeenAt = nowIso();
      claim.record.metadata = { bookingRef: rows.booking.bookingRef, error: cleanText(error.message, 300) };
      await repository.idempotencyKeys.save(claim.record, { key: claim.record.key, scope: claim.record.scope });
    }
    throw error;
  }
}


async function createTrustedManualBooking(payload = {}, context = {}) {
  const actor = cleanText(context.actorId || payload.createdByEmployeeId || payload.actorId, 180);
  const companyId = cleanText(context.companyId, 180);
  if (!actor || !companyId) throw validationError('A company-scoped staff account is required for a manual bus booking', 403);
  const idempotencyKey = cleanText(
    payload.idempotencyKey || `manual:${companyId}:${actor}:${payload.scheduleId || ''}:${cleanText(payload.selectedSeats || payload.selected, 180)}:${cleanText(payload.email || payload.phone, 180)}`,
    300
  );
  const existingIntent = await repository.paymentIntents.findOne({ idempotencyKey });
  if (existingIntent?.bookingRef) {
    const existing = await repository.bookings.findOne({ bookingRef: existingIntent.bookingRef, serviceType: 'bus', companyId });
    if (existing) return existing;
  }

  const requestContext = {
    session: { user: { id: actor } },
    ip: context.ip || '',
    id: context.requestId || '',
    headers: { 'user-agent': context.userAgent || '' },
  };
  const rows = await buildCanonicalRows({ ...payload, source: 'company_manual' }, requestContext);
  if (String(rows.booking.companyId) !== companyId) {
    await Promise.all(rows.holds.map((hold) => inventoryService.releaseHold(hold.id, 'company_scope_mismatch', actor)));
    throw validationError('The selected departure does not belong to this company', 403);
  }

  const createdAt = nowIso();
  Object.assign(rows.booking, {
    bookingChannel: 'company_manual',
    source: 'employee_manual',
    createdByEmployeeId: actor,
    createdAtDesk: createdAt,
    paymentStatus: 'pending',
    bookingStatus: 'pending_payment',
    settlementStatus: 'pending',
    updatedAt: createdAt,
  });
  const intent = {
    id: await repository.nextId('payment-intent'),
    intentRef: generateCode('PI', 10),
    bookingId: rows.booking.id,
    bookingRef: rows.booking.bookingRef,
    companyId,
    customerUserId: rows.booking.customerUserId || '',
    provider: 'cash',
    idempotencyKey,
    amount: Number(rows.booking.pricing?.total || 0),
    currency: rows.booking.pricing?.currency,
    status: 'pending',
    attempts: [{ at: createdAt, provider: 'cash', status: 'pending', actorId: actor }],
    metadata: { source: 'busBookingService.createTrustedManualBooking', actorId: actor, holdIds: rows.holds.map((hold) => hold.id) },
    createdAt,
  };

  try {
    await persistPendingRows(rows, actor);
    await repository.paymentIntents.save(intent, { idempotencyKey });
    return rows.booking;
  } catch (error) {
    await purgeFailedBookingArtifacts(rows.booking, {
      holds: rows.holds,
      records: { items: rows.items, reservations: rows.reservations, passengers: rows.passengers, assignments: rows.assignments, tickets: rows.tickets },
      reason: error.message,
      actor,
    }).catch(() => {});
    intent.status = 'failed';
    intent.failedAt = nowIso();
    intent.failureReason = cleanText(error.message, 500);
    await repository.paymentIntents.save(intent, { idempotencyKey }).catch(() => {});
    throw error;
  }
}

async function createTrustedOfflineBooking(payload = {}, context = {}) {
  const agentId = cleanText(context.agentId || payload.agentId, 180);
  if (!agentId) throw validationError('An approved promoter account is required for an offline bus sale', 403);
  const idempotencyKey = cleanText(payload.idempotencyKey || `offline:${agentId}:${payload.paymentReference || payload.listingId || payload.scheduleId || ''}`, 300);
  const existingIntent = await repository.paymentIntents.findOne({ idempotencyKey });
  if (existingIntent?.bookingRef) {
    const existingBooking = await repository.bookings.findOne({ bookingRef: existingIntent.bookingRef, serviceType: 'bus' });
    const existingPayment = await repository.payments.findOne({ bookingRef: existingIntent.bookingRef, provider: 'cash' });
    if (existingBooking && existingPayment) return { booking: existingBooking, payment: existingPayment, replayed: true };
  }

  const requestContext = {
    session: { user: { id: agentId } },
    ip: context.ip || '',
    id: context.requestId || '',
    headers: { 'user-agent': context.userAgent || '' },
  };
  const rows = await buildCanonicalRows({ ...payload, source: 'agent_offline' }, requestContext);
  const amountCollected = Number(payload.amountCollected || payload.total || 0);
  const total = Number(rows.booking.pricing?.total || 0);
  if (!Number.isFinite(amountCollected) || amountCollected + 0.0001 < total) {
    throw validationError(`Collected amount is below the computed booking total of ${rows.booking.pricing?.currency || ''} ${total}`);
  }
  Object.assign(rows.booking, {
    bookingChannel: 'agent_offline',
    createdByAgentId: agentId,
    agentSale: {
      agentId,
      agentName: cleanText(context.agentName || payload.agentName, 180),
      location: cleanText(payload.agentLocation, 240),
    },
    promoterAttribution: payload.promoterAttribution || null,
  });

  const paidAt = nowIso();
  const providerReference = cleanText(payload.paymentReference || `CASH-${rows.booking.bookingRef}`, 180);
  const intent = {
    id: await repository.nextId('payment-intent'),
    intentRef: generateCode('PI', 10),
    bookingId: rows.booking.id,
    bookingRef: rows.booking.bookingRef,
    companyId: rows.booking.companyId,
    customerUserId: rows.booking.customerUserId,
    provider: 'cash',
    providerReference,
    idempotencyKey,
    amount: total,
    currency: rows.booking.pricing.currency,
    status: 'successful',
    paidAt,
    attempts: [{ at: paidAt, provider: 'cash', status: 'successful', providerReference, actorId: agentId }],
    metadata: { source: 'busBookingService.createTrustedOfflineBooking', agentId, holdIds: rows.holds.map((hold) => hold.id) },
    createdAt: paidAt,
  };
  const payment = {
    id: await repository.nextId('payment'),
    bookingId: rows.booking.id,
    bookingRef: rows.booking.bookingRef,
    companyId: rows.booking.companyId,
    customerUserId: rows.booking.customerUserId,
    provider: 'cash',
    providerReference,
    paymentRef: providerReference,
    methodNote: `Cash collected by approved promoter ${agentId}`,
    amount: total,
    grossAmount: total,
    currency: rows.booking.pricing.currency,
    status: 'successful',
    settlementStatus: 'pending',
    paidAt,
    idempotencyKey: `cash:${rows.booking.bookingRef}`,
    metadata: { source: 'agent_offline_sale', agentId, externalReference: cleanText(payload.paymentReference, 180) },
    createdAt: paidAt,
  };

  try {
    await persistPendingRows(rows, agentId);
    await repository.withTransaction(async (session) => {
      await repository.paymentIntents.save(intent, { idempotencyKey }, { session });
      await repository.payments.save(payment, { idempotencyKey: payment.idempotencyKey }, { session });
    });
    const booking = await confirmPayment(rows.booking.bookingRef, {
      provider: 'cash',
      providerReference,
      paymentId: payment.id,
      source: 'agent_offline',
    });
    Object.assign(booking, {
      bookingChannel: 'agent_offline',
      createdByAgentId: agentId,
      agentSale: rows.booking.agentSale,
      promoterAttribution: rows.booking.promoterAttribution,
      updatedAt: nowIso(),
    });
    await repository.bookings.save(booking, { bookingRef: booking.bookingRef });
    return { booking, payment, replayed: false };
  } catch (error) {
    await purgeFailedBookingArtifacts(rows.booking, {
      holds: rows.holds,
      records: { items: rows.items, reservations: rows.reservations, passengers: rows.passengers, assignments: rows.assignments, tickets: rows.tickets },
      reason: error.message,
      actor: agentId,
    });
    intent.status = 'failed';
    intent.failedAt = nowIso();
    intent.failureReason = cleanText(error.message, 500);
    await repository.paymentIntents.save(intent, { idempotencyKey });
    throw error;
  }
}

async function confirmPayment(bookingRef, payment = {}) {
  const booking = await repository.bookings.findOne({ bookingRef: cleanText(bookingRef, 180), serviceType: 'bus' });
  if (!booking) throw validationError('Bus booking not found', 404);
  if (booking.paymentStatus === 'successful' && booking.bookingStatus === 'confirmed') return booking;
  const records = await canonicalRecords(booking);
  if (!records.items.length || records.items.length !== records.reservations.length) {
    throw conflictError('Canonical bus booking records are incomplete', 'booking_reconciliation_required');
  }
  if (records.assignments.length !== records.tickets.length || records.assignments.length !== records.passengers.length * records.reservations.length) {
    throw conflictError('Passenger ticket records are incomplete', 'booking_reconciliation_required');
  }
  const itemById = new Map(records.items.map((item) => [item.id, item]));
  const timestamp = nowIso();
  await repository.withTransaction(async (session) => {
    for (const reservation of records.reservations) {
      const item = itemById.get(reservation.bookingItemId);
      const assignments = records.assignments.filter((row) => row.reservationId === reservation.id);
      const tickets = records.tickets.filter((row) => row.reservationId === reservation.id);
      if (!item || assignments.length !== reservation.passengerCount || tickets.length !== reservation.passengerCount) {
        throw conflictError('A bus leg is missing its item, seat assignments, or tickets', 'booking_reconciliation_required');
      }
      await inventoryService.consumeHold(reservation.holdId, {
        bookingId: booking.id,
        bookingRef: booking.bookingRef,
        bookingItemId: item.id,
        reservationId: reservation.id,
        assignments,
        tickets,
        actor: payment.source || 'payment-confirmation',
        session,
      });
      item.status = 'confirmed';
      item.updatedAt = timestamp;
      reservation.status = 'confirmed';
      reservation.confirmedAt = timestamp;
      reservation.updatedAt = timestamp;
    }
    for (const assignment of records.assignments) {
      assignment.status = 'confirmed';
      assignment.updatedAt = timestamp;
    }
    for (const ticket of records.tickets) {
      ticket.status = 'valid';
      ticket.issuedAt = timestamp;
      ticket.updatedAt = timestamp;
    }
    booking.paymentStatus = 'successful';
    booking.paymentProvider = cleanText(payment.provider || booking.paymentProvider, 80);
    booking.paymentRef = cleanText(payment.providerReference || booking.paymentRef, 180);
    booking.bookingStatus = 'confirmed';
    booking.checkInStatus = 'not_checked';
    booking.lockedUntil = null;
    booking.updatedAt = timestamp;
    booking.ticketLegs = (booking.ticketLegs || []).map((leg) => ({ ...leg, status: 'valid', issuedAt: timestamp }));
    booking.bookingItems = (booking.bookingItems || []).map((row) => ({ ...row, status: 'confirmed' }));
    booking.bookingLegs = (booking.bookingLegs || []).map((row) => ({ ...row, status: 'confirmed' }));
    await repository.bookings.save(booking, { bookingRef: booking.bookingRef }, { session });
    await repository.bookingItems.saveMany(records.items, null, { session });
    await repository.reservations.saveMany(records.reservations, null, { session });
    await repository.seatAssignments.saveMany(records.assignments, null, { session });
    await repository.tickets.saveMany(records.tickets, null, { session });
    await repository.outbox({
      eventType: 'BusBookingConfirmed',
      aggregateType: 'booking',
      aggregateId: booking.id,
      companyId: booking.companyId,
      payload: {
        bookingRef: booking.bookingRef,
        reservationIds: records.reservations.map((row) => row.id),
        scheduleIds: records.reservations.map((row) => row.scheduleId),
        ticketNumbers: records.tickets.map((ticket) => ticket.ticketNumber),
        tripType: booking.tripType || (records.reservations.length > 1 ? 'round_trip' : 'one_way'),
        addons: (booking.addons || []).map((addon) => ({
          id: addon.id,
          name: addon.name,
          category: addon.category,
          quantity: addon.quantity,
          total: addon.total,
          currency: addon.currency,
        })),
      },
      dedupeKey: `BusBookingConfirmed:${booking.id}`,
      session,
    });
    await repository.audit({
      actorId: actorId(payment.source || 'payment-confirmation'),
      action: 'bus.booking.confirmed',
      targetType: 'booking',
      targetId: booking.id,
      companyId: booking.companyId,
      metadata: { bookingRef: booking.bookingRef, providerReference: booking.paymentRef, legCount: records.reservations.length },
      session,
    });
  });
  try {
    Object.assign(booking, await paymentSettlementService.settleBookingPayment(booking, { source: payment.source || 'bus_booking' }) || {});
  } catch (error) {
    booking.settlementStatus = 'reconciliation_required';
    booking.settlementError = cleanText(error.message, 500);
    await repository.bookings.save(booking, { bookingRef: booking.bookingRef });
  }
  return repository.bookings.findOne({ bookingRef: booking.bookingRef });
}

async function failPayment(bookingRef, reason = 'Payment failed', payment = {}) {
  const booking = await repository.bookings.findOne({ bookingRef: cleanText(bookingRef, 180), serviceType: 'bus' });
  if (!booking) return null;
  if (booking.paymentStatus === 'successful') throw conflictError('A successful booking cannot be failed without a refund workflow');
  const records = await canonicalRecords(booking);
  await purgeFailedBookingArtifacts(booking, {
    records,
    reason,
    actor: payment.source || 'payment-webhook',
  });
  return null;
}

function serviceHasStarted(schedule) {
  return schedule && ['boarding', 'departed', 'arrived', 'completed'].includes(normalize(schedule.status));
}

async function releaseReservationInventory(reservation, timestamp, session) {
  const inventoryRows = await repository.segmentInventory.list({ reservationId: reservation.id, status: { $in: ['booked', 'held'] } }, { session });
  for (const row of inventoryRows) {
    row.status = 'available';
    row.bookingId = '';
    row.bookingItemId = '';
    row.reservationId = '';
    row.ticketId = '';
    row.passengerId = '';
    row.holdId = '';
    row.lockedUntil = null;
    row.updatedAt = timestamp;
  }
  if (inventoryRows.length) await repository.segmentInventory.saveMany(inventoryRows, null, { session });
  const seats = unique(inventoryRows.map((row) => row.seatNumber));
  for (const seatNumber of seats) await inventoryService.recalculateCompatibilitySeat(reservation.scheduleId, seatNumber, session);
  await inventoryService.recalculateScheduleAvailableSeats(reservation.scheduleId, session);
  return inventoryRows.length;
}

async function requestCancellationRefund(booking, reason, actor) {
  if (booking.paymentStatus !== 'successful') return;
  try {
    const workflowService = require('../../../services/support/workflowService');
    const supportRepository = require('../../../repositories/domain/supportRepository');
    await Promise.resolve(workflowService.requestRefund({
      bookingRef: booking.bookingRef,
      requesterId: actorId(actor),
      amount: Number(booking.pricing?.total || 0),
      reason: `Cancellation: ${reason}`,
    }));
  } catch (error) {
    booking.settlementStatus = 'reconciliation_required';
    booking.settlementError = `Cancellation refund request failed: ${cleanText(error.message, 400)}`;
    await repository.bookings.save(booking, { bookingRef: booking.bookingRef });
  }
}

async function cancelBooking(bookingRef, reason = 'Cancelled by traveler', actor = 'customer') {
  const booking = await repository.bookings.findOne({ bookingRef: cleanText(bookingRef, 180), serviceType: 'bus' });
  if (!booking) throw validationError('Bus booking not found', 404);
  if (['cancelled', 'refunded'].includes(normalize(booking.bookingStatus))) return booking;
  if (normalize(booking.bookingStatus) === 'completed') throw conflictError('This booking has completed and cannot be cancelled online');
  const records = await canonicalRecords(booking);
  if (!records.reservations.length) throw conflictError('Bus reservation is missing', 'booking_reconciliation_required');
  const schedules = await Promise.all(records.reservations.map((reservation) => repository.schedules.findOne({ id: reservation.scheduleId })));
  if (schedules.some(serviceHasStarted)) throw conflictError('A trip in this booking has started and the booking cannot be cancelled online');
  const timestamp = nowIso();
  const cleanReason = cleanText(reason, 500);
  booking.bookingStatus = 'cancelled';
  booking.cancelReason = cleanReason;
  booking.cancelledAt = timestamp;
  booking.updatedAt = timestamp;
  booking.checkInStatus = 'cancelled';
  booking.ticketLegs = (booking.ticketLegs || []).map((leg) => ({ ...leg, status: 'cancelled', checkInStatus: 'cancelled', cancelledAt: timestamp }));
  booking.bookingItems = (booking.bookingItems || []).map((item) => ({ ...item, status: 'cancelled' }));
  booking.bookingLegs = (booking.bookingLegs || []).map((leg) => ({ ...leg, status: 'cancelled' }));
  for (const item of records.items) item.status = 'cancelled';
  for (const reservation of records.reservations) {
    reservation.status = 'cancelled';
    reservation.cancelledAt = timestamp;
    reservation.cancellationReason = cleanReason;
  }
  for (const assignment of records.assignments) assignment.status = 'cancelled';
  for (const ticket of records.tickets) {
    ticket.status = 'cancelled';
    ticket.checkInStatus = 'cancelled';
    ticket.cancelledAt = timestamp;
  }
  await repository.withTransaction(async (session) => {
    for (const reservation of records.reservations) await releaseReservationInventory(reservation, timestamp, session);
    await repository.bookings.save(booking, { bookingRef: booking.bookingRef }, { session });
    await repository.bookingItems.saveMany(records.items, null, { session });
    await repository.reservations.saveMany(records.reservations, null, { session });
    if (records.assignments.length) await repository.seatAssignments.saveMany(records.assignments, null, { session });
    if (records.tickets.length) await repository.tickets.saveMany(records.tickets, null, { session });
    await repository.outbox({
      eventType: 'BusBookingCancelled',
      aggregateType: 'booking',
      aggregateId: booking.id,
      companyId: booking.companyId,
      payload: { bookingRef: booking.bookingRef, reason: cleanReason, reservationIds: records.reservations.map((row) => row.id) },
      dedupeKey: `BusBookingCancelled:${booking.id}`,
      session,
    });
    await repository.audit({
      actorId: actorId(typeof actor === 'object' ? actor.actorId : actor),
      action: 'bus.booking.cancelled',
      targetType: 'booking',
      targetId: booking.id,
      companyId: booking.companyId,
      metadata: { reason: cleanReason, legCount: records.reservations.length },
      session,
    });
  });
  await requestCancellationRefund(booking, cleanReason, typeof actor === 'object' ? actor.actorId : actor);
  return booking;
}

async function refundBooking(bookingRef, reason = 'Refunded by payment provider', payment = {}) {
  const booking = await repository.bookings.findOne({ bookingRef: cleanText(bookingRef, 180), serviceType: 'bus' });
  if (!booking) return null;
  if (booking.paymentStatus === 'refunded' && booking.bookingStatus === 'refunded') return booking;
  const records = await canonicalRecords(booking);
  if (!records.items.length || !records.reservations.length) throw conflictError('Canonical bus booking records are incomplete', 'booking_reconciliation_required');
  const schedules = await Promise.all(records.reservations.map((reservation) => repository.schedules.findOne({ id: reservation.scheduleId })));
  const startedByReservation = new Map(records.reservations.map((reservation, index) => [reservation.id, serviceHasStarted(schedules[index])]));
  const timestamp = nowIso();
  const cleanReason = cleanText(reason, 500);
  booking.paymentStatus = 'refunded';
  booking.bookingStatus = 'refunded';
  booking.refundedAt = timestamp;
  booking.refundReason = cleanReason;
  booking.paymentProvider = cleanText(payment.provider || booking.paymentProvider, 80);
  booking.paymentRef = cleanText(payment.providerReference || booking.paymentRef, 180);
  booking.updatedAt = timestamp;
  booking.checkInStatus = schedules.some(serviceHasStarted) ? booking.checkInStatus : 'refunded';
  booking.ticketLegs = (booking.ticketLegs || []).map((leg) => ({
    ...leg,
    status: 'refunded',
    checkInStatus: serviceHasStarted(schedules.find((schedule) => schedule?.id === leg.scheduleId)) ? leg.checkInStatus : 'cancelled',
    refundedAt: timestamp,
  }));
  booking.bookingItems = (booking.bookingItems || []).map((item) => ({ ...item, status: 'refunded' }));
  booking.bookingLegs = (booking.bookingLegs || []).map((leg) => ({ ...leg, status: 'refunded' }));
  for (const item of records.items) item.status = 'refunded';
  for (const reservation of records.reservations) {
    reservation.status = 'refunded';
    if (!startedByReservation.get(reservation.id)) reservation.cancelledAt = timestamp;
    reservation.cancellationReason = cleanReason;
  }
  for (const assignment of records.assignments) assignment.status = 'refunded';
  for (const ticket of records.tickets) {
    ticket.status = 'refunded';
    if (!startedByReservation.get(ticket.reservationId)) ticket.checkInStatus = 'cancelled';
    ticket.cancelledAt = timestamp;
  }
  await repository.withTransaction(async (session) => {
    for (const reservation of records.reservations) {
      if (!startedByReservation.get(reservation.id)) await releaseReservationInventory(reservation, timestamp, session);
    }
    await repository.bookings.save(booking, { bookingRef: booking.bookingRef }, { session });
    await repository.bookingItems.saveMany(records.items, null, { session });
    await repository.reservations.saveMany(records.reservations, null, { session });
    if (records.assignments.length) await repository.seatAssignments.saveMany(records.assignments, null, { session });
    if (records.tickets.length) await repository.tickets.saveMany(records.tickets, null, { session });
    await repository.outbox({
      eventType: 'BusBookingRefunded',
      aggregateType: 'booking',
      aggregateId: booking.id,
      companyId: booking.companyId,
      payload: { bookingRef: booking.bookingRef, reason: cleanReason, reservationIds: records.reservations.map((row) => row.id) },
      dedupeKey: `BusBookingRefunded:${booking.id}`,
      session,
    });
    await repository.audit({
      actorId: actorId(payment.source || 'payment-refund'),
      action: 'bus.booking.refunded',
      targetType: 'booking',
      targetId: booking.id,
      companyId: booking.companyId,
      metadata: { reason: cleanReason, providerReference: booking.paymentRef, legCount: records.reservations.length },
      session,
    });
  });
  return booking;
}

async function hydrateBooking(bookingRef) {
  const booking = await repository.bookings.findOne({ bookingRef: cleanText(bookingRef, 180), serviceType: 'bus' });
  if (!booking) return null;
  return { booking, ...(await canonicalRecords(booking)) };
}

module.exports = { purgeFailedBookingArtifacts,
  addonChargeMultiplier,
  selectedAddonPricing,
  guestSnapshot,
  buildPassengerPayloads,
  claimIdempotency,
  createGuestBooking,
  createTrustedManualBooking,
  createTrustedOfflineBooking,
  confirmPayment,
  failPayment,
  cancelBooking,
  refundBooking,
  hydrateBooking,
};
