const { platformCurrency } = require('../../utils/currency');
const commerceRepository = require('../../repositories/domain/commerceRepository');
const { buildBooking } = require('./bookingBuilderService');
const paymentSettlementService = require('./paymentSettlementService');
const { env } = require('../../config/env');
const inventoryHoldService = require('./inventoryHoldService');
const ticketAccessService = require('./ticketAccessService');
const ticketScanService = require('../qr/ticketScanService');
const timelineService = require('../support/timelineService');
const { runMongoUnitOfWork, sessionOptions } = require('../shared/mongoUnitOfWork');
const hotelInventoryService = require('../hotel/hotelInventoryService');

async function persistPaymentIntent(intent = {}) {
  const PaymentIntent = require('../../models/PaymentIntent');
  await PaymentIntent.updateOne(
    { idempotencyKey: intent.idempotencyKey || intent.id },
    { $set: intent },
    { upsert: true, runValidators: true }
  );
}

async function recordBookingTimeline(booking = {}, action, title, message = '', meta = {}) {
  if (!booking || !booking.bookingRef) return null;
  try {
    return await timelineService.recordEvent({
      bookingRef: booking.bookingRef,
      bookingId: booking.id,
      companyId: booking.companyId,
      customerUserId: booking.customerUserId || '',
      entityType: meta.entityType || 'booking',
      entityId: meta.entityId || booking.id || booking.bookingRef,
      action,
      title,
      message,
      status: meta.status || booking.bookingStatus || booking.paymentStatus || 'open',
      actorType: meta.actorType || 'system',
      actorId: meta.actorId || 'booking-service',
      actorName: meta.actorName || 'Classic Trip',
      visibility: meta.visibility || 'shared',
      metadata: { serviceType: booking.serviceType, scheduleId: booking.scheduleId || '', ...(meta.metadata || {}) },
    });
  } catch (error) {
    return null;
  }
}

function isoDate(value, fallback = new Date()) {
  const date = value ? new Date(value) : new Date(fallback);
  if (Number.isNaN(date.getTime())) {
    const error = new Error('Invalid hotel date');
    error.status = 422;
    throw error;
  }
  return date.toISOString().slice(0, 10);
}

function hotelNightRange(payload = {}, booking = {}) {
  const checkIn = isoDate(payload.checkInDate || payload.checkIn || payload.startDate || booking.hotelStay?.checkIn || booking.bookingItems?.[0]?.checkIn);
  const checkOutSeed = payload.checkOutDate || payload.checkOut || payload.endDate || booking.hotelStay?.checkOut || booking.bookingItems?.[0]?.checkOut;
  const fallbackOut = new Date(`${checkIn}T00:00:00.000Z`);
  fallbackOut.setUTCDate(fallbackOut.getUTCDate() + Math.max(1, Number(payload.nights || 1)));
  const checkOut = isoDate(checkOutSeed || fallbackOut);
  const start = new Date(`${checkIn}T00:00:00.000Z`);
  const end = new Date(`${checkOut}T00:00:00.000Z`);
  if (!(end > start)) {
    const error = new Error('Hotel check-out must be after check-in');
    error.status = 422;
    throw error;
  }
  const nights = [];
  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) nights.push(d.toISOString().slice(0, 10));
  return { checkIn, checkOut, nights };
}

function reusableSeatFilter(scheduleId, seatNumber, holdId = '', now = new Date()) {
  const reusable = [
    { status: 'available' },
    { status: 'locked', lockedUntil: { $lte: now } },
    // Older local builds did not persist bookingRef on Seat, so failed or test checkouts
    // could leave seats stuck as taken forever. Reclaim only unowned taken seats.
    { status: 'taken', $or: [{ bookingRef: { $exists: false } }, { bookingRef: '' }, { bookingRef: null }] },
  ];
  if (holdId) reusable.push({ status: 'locked', lockId: holdId, lockedUntil: { $gt: now } });
  return { scheduleId, seatNumber, $or: reusable };
}

async function refreshScheduleAvailability(scheduleId, session = null) {
  if (!scheduleId) return;
  const Seat = require('../../models/Seat');
  const TripSchedule = require('../../models/TripSchedule');
  const availableSeats = await Seat.countDocuments({ scheduleId, status: 'available' }).session(session || null);
  await TripSchedule.updateOne({ id: scheduleId }, { $set: { availableSeats } }, sessionOptions(session));
}

async function claimBusSeatsAtomically(booking = {}, payload = {}, session = null) {
  const seatClaims = (booking.bookingItems || [])
    .filter((item) => item.scheduleId && item.seatNumber)
    .map((item) => ({ scheduleId: item.scheduleId, seatNumber: item.seatNumber, legType: item.legType, passenger: item.passenger || item }));
  if (!seatClaims.length) return;
  const Seat = require('../../models/Seat');
  const now = new Date();
  const holdId = payload.holdId || booking.holdId || '';
  const failures = [];
  for (const claim of seatClaims) {
    const passenger = claim.passenger || {};
    const updated = await Seat.findOneAndUpdate(
      reusableSeatFilter(claim.scheduleId, claim.seatNumber, holdId, now),
      {
        $set: {
          status: 'taken',
          bookingRef: booking.bookingRef,
          bookingId: booking.id || '',
          passengerName: passenger.fullName || passenger.name || booking.guestSnapshot?.fullName || '',
          passengerPhone: passenger.phone || booking.guestSnapshot?.phone || '',
          passengerEmail: passenger.email || booking.guestSnapshot?.email || '',
        },
        $unset: { lockedUntil: '', lockId: '' },
      },
      sessionOptions(session, { new: true })
    ).lean();
    if (!updated) failures.push(`${claim.scheduleId}:${claim.seatNumber}`);
  }

  const touchedSchedules = [...new Set(seatClaims.map((claim) => claim.scheduleId).filter(Boolean))];
  for (const id of touchedSchedules) await refreshScheduleAvailability(id, session);
  if (failures.length) {
    const error = new Error(`Selected seat is no longer available: ${failures.join(', ')}`);
    error.status = 409;
    error.code = 'SEAT_CLAIM_FAILED';
    throw error;
  }
}

async function claimHotelRoomAtomically(booking = {}, payload = {}, session = null) {
  if (booking.serviceType !== 'hotel') return;
  await hotelInventoryService.claimSelectedRoom(booking, payload, session);
}

async function releaseFailedBookingInventory(booking = {}, payload = {}) {
  if (!booking) return;
  booking.cancelledAt = booking.cancelledAt || new Date().toISOString();
  booking.cancelReason = booking.cancelReason || 'Payment initiation failed';
  if (booking.serviceType === 'bus') {
    const claims = (booking.bookingItems || []).filter((item) => item.scheduleId && item.seatNumber);
    for (const claim of claims) {
      const seat = await commerceRepository.seats.findOne({ scheduleId: claim.scheduleId, seatNumber: claim.seatNumber });
      if (seat && seat.bookingRef === booking.bookingRef) {
        Object.assign(seat, { status: 'available', bookingRef: '', bookingId: '', passengerName: '', passengerPhone: '', passengerEmail: '' });
        delete seat.lockedUntil; delete seat.lockId;
        await commerceRepository.seats.save(seat, { id: seat.id });
      }
    }
    for (const scheduleId of [...new Set(claims.map((row) => row.scheduleId))]) {
      await refreshScheduleAvailability(scheduleId);
    }
  }
  if (booking.serviceType === 'hotel') await hotelInventoryService.releaseBookedNights(booking.bookingRef);
  if (payload.holdId) await inventoryHoldService.releaseHold(payload.holdId, 'payment_failed');
}

async function purgeFailedBookingArtifacts(booking = {}, payload = {}, reason = 'Payment failed') {
  if (!booking?.bookingRef) return { purged: false };
  if (String(booking.paymentStatus || '').toLowerCase() === 'successful' || String(booking.bookingStatus || '').toLowerCase() === 'confirmed') {
    const error = new Error('Successful bookings require the refund workflow and cannot be removed as failed payments');
    error.status = 409;
    throw error;
  }
  await releaseFailedBookingInventory(booking, payload);
  await runMongoUnitOfWork(async (session) => {
    const filters = { $or: [{ bookingId: booking.id }, { bookingRef: booking.bookingRef }] };
    await commerceRepository.payments.deleteMany(filters, { session });
    await commerceRepository.passengers.deleteMany(filters, { session });
    await commerceRepository.timelineEvents.deleteMany(filters, { session });
    await commerceRepository.commissions.deleteMany({ $or: [{ bookingId: booking.id }, { bookingRef: booking.bookingRef }, { referenceId: booking.id }] }, { session });
    await commerceRepository.transactions.deleteMany({ $or: [{ referenceId: booking.id }, { referenceId: booking.bookingRef }] }, { session });
    await commerceRepository.bookings.deleteMany({ $or: [{ id: booking.id }, { bookingRef: booking.bookingRef }] }, { session });
    await commerceRepository.auditLogs.save({
      id: `audit-payment-purge-${booking.bookingRef}-${Date.now()}`,
      actorId: 'payment-cleanup', action: 'booking.failed_payment_purged', target: booking.bookingRef, targetId: booking.bookingRef,
      status: 'success', meta: { reason: String(reason || 'Payment failed').slice(0, 500), retainedRecord: 'payment_intent_only' }, createdAt: new Date().toISOString(),
    }, null, { session });
  });
  return { purged: true, bookingRef: booking.bookingRef };
}

async function consumeInventoryHoldInSession(holdId, booking, session) {
  if (!holdId) return;
  const InventoryHold = require('../../models/InventoryHold');
  const InventoryHoldItem = require('../../models/InventoryHoldItem');
  const update = {
    status: 'consumed',
    consumedAt: new Date(),
    consumedBy: booking.customerUserId || 'guest-checkout',
    bookingId: booking.id || '',
    bookingRef: booking.bookingRef || '',
  };
  const parentResult = await InventoryHold.updateOne(
    { id: holdId, status: 'active', expiresAt: { $gt: new Date() } },
    { $set: update },
    sessionOptions(session)
  );
  const itemResult = await InventoryHoldItem.updateMany(
    { holdId, status: 'active', expiresAt: { $gt: new Date() } },
    { $set: update },
    sessionOptions(session)
  );
  if (parentResult.matchedCount !== 1 || itemResult.matchedCount < 1) {
    throw Object.assign(new Error('Inventory hold is missing or expired'), { status: 409 });
  }
}

async function persistBooking(booking, payload, _transactionStartIndex, options = {}) {
  const shouldConsumeHold = Boolean(payload.holdId && !options.skipHoldConsume);
  const execute = async (session = null) => {
    if (options.claimInventory) {
      if (booking.serviceType === 'bus') await claimBusSeatsAtomically(booking, payload, session);
      if (booking.serviceType === 'hotel') await claimHotelRoomAtomically(booking, payload, session);
    }
    if (shouldConsumeHold) await consumeInventoryHoldInSession(payload.holdId, booking, session);
    await persistBookingRows(booking, payload, session);
  };
  await runMongoUnitOfWork(execute);
}

async function persistBookingRows(booking, payload, session = null) {
  await commerceRepository.bookings.save(booking, { bookingRef: booking.bookingRef }, { session: session || undefined });
  const passengers = (booking.passengers || []).map((passenger, index) => ({
    ...passenger,
    id: passenger.id || `${booking.id}-passenger-${index + 1}`,
    bookingId: booking.id,
    bookingRef: booking.bookingRef,
    companyId: booking.companyId,
    listingId: booking.listingId,
    scheduleId: passenger.scheduleId || booking.scheduleId,
    passengerIndex: index,
  }));
  if (passengers.length) await commerceRepository.passengers.saveMany(passengers, (row) => ({ id: row.id }), { session: session || undefined });
  if ((booking.paymentRef || booking.paymentProvider) && String(booking.paymentStatus || '').toLowerCase() !== 'failed') {
    const provider = booking.paymentProvider || payload.provider || env.paymentProvider;
    const providerReference = booking.paymentRef || `${booking.bookingRef}:pending`;
    const payment = {
      id: `payment-${booking.bookingRef}`,
      bookingId: booking.id,
      bookingRef: booking.bookingRef,
      companyId: booking.companyId,
      customerUserId: booking.customerUserId || '',
      provider,
      providerReference,
      paymentRef: booking.paymentRef || '',
      amount: booking.pricing?.total || 0,
      grossAmount: booking.pricing?.total || 0,
      currency: booking.pricing?.currency || platformCurrency(),
      status: booking.paymentStatus || 'pending',
      settlementStatus: booking.settlementStatus === 'settled' ? 'settled' : 'pending',
      paidAt: booking.paymentStatus === 'successful' ? new Date().toISOString() : null,
      checkoutUrl: booking.checkoutUrl || '',
      idempotencyKey: `${provider}:${booking.bookingRef}:${providerReference}`,
      metadata: { source: 'bookingService.persistBooking' },
    };
    await commerceRepository.payments.save(payment, { idempotencyKey: payment.idempotencyKey }, { session: session || undefined });
  }
}


async function createGuestBooking(payload, req) {
  // Hotel bookings must always use the normalized hotel reservation engine.
  // Keep this safeguard here even though public/API routes dispatch by service type,
  // so future callers cannot accidentally fall back to legacy embedded room records.
  const listingKey = String(payload?.listingId || payload?.slug || '').trim();
  if (listingKey) {
    const listing = await commerceRepository.listings.findOne({
      $or: [{ id: listingKey }, { slug: listingKey }],
    });
    const serviceType = String(listing?.serviceType || '').toLowerCase();
    if (serviceType === 'hotel') {
      return require('../hotel/hotelService').createHotelBooking(payload, req);
    }
    if (serviceType === 'bus') {
      const error = new Error('Bus bookings must use the canonical bus reservation service');
      error.status = 409;
      error.code = 'canonical_bus_booking_required';
      throw error;
    }
  }
  const paymentService = require('../payment/paymentService');
  const provider = paymentService.resolveProviderName(payload.provider || payload.paymentProvider || env.paymentProvider);
  const { booking } = await buildBooking({ ...payload, deferPayment: true }, req);
  try {
    const intentBase = {
      id: `payment-intent-${booking.bookingRef}`,
      intentRef: `PI-${booking.bookingRef}`,
      bookingId: booking.id,
      bookingRef: booking.bookingRef,
      companyId: booking.companyId,
      customerUserId: booking.customerUserId || '',
      provider,
      idempotencyKey: `${provider}:${booking.bookingRef}:initiate`,
      amount: booking.pricing?.total,
      currency: booking.pricing?.currency,
      status: 'created',
      expiresAt: booking.lockedUntil,
      attempts: [{ at: new Date().toISOString(), provider, status: 'created' }],
      metadata: { source: 'bookingService.createGuestBooking' },
    };
    await persistPaymentIntent(intentBase);
    await persistBooking(booking, payload, 0, { claimInventory: true });
    await recordBookingTimeline(booking, 'booking.created', `Booking ${booking.bookingRef} created`, 'Inventory was selected and booking record was created.', { metadata: { source: payload.source || 'checkout', holdId: payload.holdId || '' } });
    await recordBookingTimeline(booking, 'inventory.claimed', `Inventory claimed for ${booking.bookingRef}`, booking.serviceType === 'bus' ? 'Selected seat inventory was connected to this booking.' : 'Selected room inventory was connected to this booking.', { entityType: 'inventory', entityId: payload.holdId || booking.scheduleId || booking.listingId });
    const payment = await paymentService.initiatePayment({
      ...payload,
      provider,
      bookingRef: booking.bookingRef,
      amount: booking.pricing?.total,
      currency: booking.pricing?.currency,
      customer: booking.guestSnapshot,
      idempotencyKey: intentBase.idempotencyKey,
      callbackUrl: `${env.appUrl}/booking/payment/callback?bookingRef=${encodeURIComponent(booking.bookingRef)}`,
      description: `Classic Trip booking ${booking.bookingRef}`,
    });
    if (String(payment.status || '').toLowerCase() === 'failed') {
      const paymentError = new Error(payment.message || payment.failureReason || 'Payment could not be completed');
      paymentError.status = 402;
      paymentError.code = 'payment_failed';
      throw paymentError;
    }
    await persistPaymentIntent({
      ...intentBase,
      providerReference: payment.providerReference || '',
      checkoutUrl: payment.checkoutUrl || '',
      status: payment.status || 'pending',
      paidAt: payment.status === 'successful' ? new Date().toISOString() : null,
      attempts: [...intentBase.attempts, { at: new Date().toISOString(), provider, status: payment.status || 'pending', providerReference: payment.providerReference || '' }],
    });
    booking.paymentProvider = payment.provider;
    booking.paymentRef = payment.providerReference;
    booking.checkoutUrl = payment.checkoutUrl || '';
    booking.paymentStatus = payment.status || booking.paymentStatus;
    if (booking.paymentStatus === 'successful') {
      booking.bookingStatus = 'confirmed';
      Object.assign(booking, await paymentSettlementService.settleBookingPayment(booking) || {});
      await recordBookingTimeline(booking, 'payment.succeeded', `Payment received for ${booking.bookingRef}`, 'Payment was confirmed and tickets are valid for operation.', { entityType: 'payment', entityId: payment.providerReference || booking.paymentRef || '', status: 'successful', metadata: { provider: payment.provider } });
      await recordBookingTimeline(booking, 'ticket.issued', `Ticket issued for ${booking.bookingRef}`, `${(booking.ticketLegs || []).length || 1} ticket leg(s) are available for QR validation.`, { entityType: 'ticket', entityId: booking.ticketLegs?.[0]?.id || booking.bookingRef, status: 'issued' });
    } else {
      await recordBookingTimeline(booking, 'payment.pending', `Payment pending for ${booking.bookingRef}`, 'Booking is waiting for payment confirmation before operation.', { entityType: 'payment', entityId: payment.providerReference || booking.paymentRef || '', status: booking.paymentStatus || 'pending', metadata: { provider: payment.provider, checkoutUrl: payment.checkoutUrl || '' } });
    }
  } catch (error) {
    booking.paymentStatus = 'failed';
    booking.bookingStatus = 'cancelled';
    await persistPaymentIntent({
      id: `payment-intent-${booking.bookingRef}`,
      intentRef: `PI-${booking.bookingRef}`,
      bookingId: booking.id,
      bookingRef: booking.bookingRef,
      companyId: booking.companyId,
      customerUserId: booking.customerUserId || '',
      provider,
      idempotencyKey: `${provider}:${booking.bookingRef}:initiate`,
      amount: booking.pricing?.total,
      currency: booking.pricing?.currency,
      status: 'failed',
      failedAt: new Date().toISOString(),
      failureReason: error.message,
      metadata: { source: 'bookingService.createGuestBooking' },
    });
    await purgeFailedBookingArtifacts(booking, payload, error.message);
    throw error;
  }
  await persistBooking(booking, payload, 0, { skipHoldConsume: true });
  const notificationService = require('../notification/notificationService');
  if (booking.bookingStatus === 'confirmed') {
    await notificationService.bookingConfirmed(booking);
  } else {
    await notificationService.queueNotification({
      userId: booking.customerUserId || null,
      channels: ['email', 'sms'],
      title: `Payment pending ${booking.bookingRef}`,
      message: `Your Classic Trip booking ${booking.bookingRef} is waiting for payment confirmation.`,
      recipient: {
        email: booking.guestSnapshot?.email,
        phone: booking.guestSnapshot?.phone,
        name: booking.guestSnapshot?.fullName,
      },
      referenceType: 'booking',
      referenceId: booking.id,
      meta: { bookingRef: booking.bookingRef, checkoutUrl: booking.checkoutUrl },
    });
  }
  const ticketPdfService = require('../pdf/ticketPdfService');
  const listing = await commerceRepository.listings.findOne({ id: booking.listingId });
  booking.ticketPdf = await ticketPdfService.uploadTicketPdf(booking, listing);
  await persistBooking(booking, payload, 0, { skipHoldConsume: true });
  return booking;
}



async function createManualBooking(payload = {}, context = {}) {
  const actorId = String(context.actorId || payload.createdByEmployeeId || payload.actorId || 'employee-system').trim();
  const listingKey = String(payload.listingId || payload.slug || '').trim();
  if (listingKey) {
    const listing = await commerceRepository.listings.findOne({ $or: [{ id: listingKey }, { slug: listingKey }] });
    const serviceType = String(listing?.serviceType || '').toLowerCase();
    if (serviceType === 'hotel') {
      if (context.companyId && String(listing.companyId) !== String(context.companyId)) {
        const error = new Error('Hotel listing does not belong to this company');
        error.status = 403;
        throw error;
      }
      return require('../hotel/hotelService').createHotelBooking({
        ...payload,
        listingId: listing.id,
        source: 'company_manual',
        actorId,
        createdByEmployeeId: actorId,
        paymentStatus: 'pending',
        bookingStatus: 'pending_payment',
      }, { session: { user: { id: actorId } } }, { trustedManual: true, companyId: context.companyId || listing.companyId });
    }
    if (serviceType === 'bus') {
      const error = new Error('Manual bus bookings must use the canonical bus reservation service');
      error.status = 409;
      error.code = 'canonical_bus_booking_required';
      throw error;
    }
  }
  const { booking } = await buildBooking({
    ...payload,
    deferPayment: true,
    paymentStatus: 'pending',
    bookingChannel: 'company_manual',
    source: 'employee_manual',
  }, null);
  booking.source = 'employee_manual';
  booking.bookingChannel = 'company_manual';
  booking.createdByEmployeeId = actorId;
  booking.createdAtDesk = new Date().toISOString();
  booking.paymentStatus = 'pending';
  booking.bookingStatus = 'pending_payment';
  booking.settlementStatus = 'pending';
  const intent = {
    id: `payment-intent-${booking.bookingRef}`,
    intentRef: `PI-${booking.bookingRef}`,
    bookingId: booking.id,
    bookingRef: booking.bookingRef,
    companyId: booking.companyId,
    customerUserId: booking.customerUserId || '',
    provider: 'cash',
    idempotencyKey: `manual:${booking.bookingRef}:awaiting-payment`,
    amount: booking.pricing?.total || 0,
    currency: booking.pricing?.currency || platformCurrency(),
    status: 'pending',
    expiresAt: null,
    attempts: [{ at: new Date().toISOString(), provider: 'cash', status: 'pending', actorId }],
    metadata: { source: 'bookingService.createManualBooking', actorId },
  };
  await persistPaymentIntent(intent);
  await persistBooking(booking, payload, 0, { claimInventory: true });
  await recordBookingTimeline(booking, 'booking.created', `Manual booking ${booking.bookingRef} created`, 'Company staff created the booking and reserved inventory. Payment is still required.', {
    actorType: 'employee', actorId, status: 'pending_payment', metadata: { source: 'employee_manual' },
  });
  await recordBookingTimeline(booking, 'payment.pending', `Payment pending for ${booking.bookingRef}`, 'The booking is waiting for an authorized payment record.', {
    entityType: 'payment', actorType: 'employee', actorId, status: 'pending', metadata: { provider: 'cash' },
  });
  return booking;
}

async function lookupTicket(value, companyId = '', context = {}) {
  const busOperationsService = require('../../modules/bus/services/busOperationsService');
  const canonicalTicket = companyId ? await busOperationsService.findTicketForScan(companyId, value) : null;
  if (canonicalTicket) return busOperationsService.lookupTicket({ companyId, scannedToken: value, scheduleId: context.scheduleId || '' });
  const ticketOperationsService = require('./ticketOperationsService');
  const result = await ticketOperationsService.lookup(value, companyId, context);
  await ticketScanService.recordScan('lookup', value, result, { ...context, companyId });
  return result;
}

async function validateTicket(value, employeeId = 'employee-system', companyId = '', context = {}) {
  const busOperationsService = require('../../modules/bus/services/busOperationsService');
  const canonicalTicket = companyId ? await busOperationsService.findTicketForScan(companyId, value) : null;
  if (canonicalTicket) {
    return busOperationsService.validateTicket({
      companyId,
      employeeId,
      scannedToken: value,
      scheduleId: context.scheduleId || canonicalTicket.scheduleId || '',
      note: context.note || '',
      location: context.location || '',
      req: { ip: context.ip || '', headers: { 'user-agent': context.userAgent || '' } },
    });
  }
  const ticketOperationsService = require('./ticketOperationsService');
  const result = await ticketOperationsService.validate(value, employeeId, companyId, context);
  await ticketScanService.recordScan('validate', value, result, { ...context, userId: employeeId, companyId });
  if (result.ok) await recordBookingTimeline(result.booking, 'ticket.checked_in', `Passenger checked in for ${result.booking.bookingRef}`, result.message || 'Passenger checked in.', { entityType: 'ticket_scan', entityId: result.ticket?.id || result.ticket?.ticketNumber || result.booking.bookingRef, actorType: context.actorRole || 'employee', actorId: employeeId, actorName: context.actorName || '', status: 'checked_in', metadata: { location: context.location || '', scheduleId: context.scheduleId || result.ticket?.scheduleId || '' } });
  return result;
}

async function markNoShow(value, employeeId = 'employee-system', companyId = '', note = '', context = {}) {
  const busOperationsService = require('../../modules/bus/services/busOperationsService');
  const canonicalTicket = companyId ? await busOperationsService.findTicketForScan(companyId, value) : null;
  if (canonicalTicket) {
    const result = await busOperationsService.markNoShow({
      companyId,
      employeeId,
      ticketId: canonicalTicket.id,
      scheduleId: context.scheduleId || canonicalTicket.scheduleId,
      note,
      req: { ip: context.ip || '', headers: { 'user-agent': context.userAgent || '' } },
    });
    return result;
  }
  const ticketOperationsService = require('./ticketOperationsService');
  const result = await ticketOperationsService.markNoShow(value, employeeId, companyId, note, context);
  await ticketScanService.recordScan('no_show', value, result, { ...context, userId: employeeId, companyId, note });
  if (result.ok) await recordBookingTimeline(result.booking, 'ticket.no_show', `No-show marked for ${result.booking.bookingRef}`, note || result.message || 'Passenger was marked as no-show.', { entityType: 'ticket_scan', entityId: result.ticket?.id || result.ticket?.ticketNumber || result.booking.bookingRef, actorType: context.actorRole || 'employee', actorId: employeeId, actorName: context.actorName || '', status: 'no_show', metadata: { location: context.location || '', scheduleId: context.scheduleId || result.ticket?.scheduleId || '' } });
  return result;
}

async function lookupBooking(bookingRef, contact = '', accessCode = '') {
  const booking = await commerceRepository.bookings.findOne({ bookingRef });
  if (!booking) return null;
  if (ticketAccessService.accessCodeMatches(booking, accessCode)) return booking;
  if (!contact) return null;
  return ticketAccessService.contactMatches(booking, contact) ? booking : null;
}


async function hotelCancellationRefundDecision(booking, hotelRepository, now = new Date()) {
  const total = Math.max(0, Number(booking?.pricing?.total || 0));
  const assignments = await hotelRepository.roomAssignments.list({
    bookingRef: booking.bookingRef,
    companyId: booking.companyId || '',
  });
  if (!assignments.length) {
    return { amount: 0, reviewRequired: true, reason: 'Canonical room assignments or rate-policy snapshots are missing' };
  }

  for (const assignment of assignments) {
    const plan = assignment.ratePlanSnapshot || {};
    if (!Object.prototype.hasOwnProperty.call(plan, 'refundable')) {
      return { amount: 0, reviewRequired: true, reason: 'A booked rate plan has no immutable refundable-policy snapshot' };
    }
    if (plan.refundable === false) {
      return { amount: 0, reviewRequired: false, reason: 'The booked rate plan is non-refundable' };
    }
    const checkIn = String(assignment.checkInDate || booking?.hotelStay?.checkIn || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn)) {
      return { amount: 0, reviewRequired: true, reason: 'The cancellation deadline cannot be evaluated without a valid check-in date' };
    }
    const deadlineHours = Math.max(0, Number(plan.cancellationDeadlineHours || 0));
    const deadline = new Date(`${checkIn}T00:00:00.000Z`).getTime() - (deadlineHours * 60 * 60 * 1000);
    if (now.getTime() <= deadline) continue;
    const penaltyType = String(plan.cancellationPenaltyType || 'first_night').toLowerCase();
    if (penaltyType !== 'none') {
      return { amount: 0, reviewRequired: true, reason: `Cancellation is inside the penalty window (${penaltyType}); finance review is required` };
    }
  }
  return { amount: total, reviewRequired: false, reason: 'All booked rates remain fully refundable at cancellation time' };
}

async function cancelBooking(bookingRef, reason = 'Customer requested cancellation', context = {}) {
  const customerRepository = require('../../repositories/domain/customerRepository');
  const busOperationsRepository = require('../../repositories/domain/busOperationsRepository');
  const hotelRepository = require('../../repositories/domain/hotelRepository');
  const booking = await customerRepository.bookings.findOne({ bookingRef });
  if (!booking) return null;
  const hotelRefundDecision = String(booking.serviceType || '').toLowerCase() === 'hotel' && booking.paymentStatus === 'successful'
    ? await hotelCancellationRefundDecision(booking, hotelRepository)
    : null;
  if (String(booking.serviceType || '').toLowerCase() === 'bus') {
    const busBookingService = require('../../modules/bus/services/busBookingService');
    return busBookingService.cancelBooking(bookingRef, reason, context);
  }
  if (['cancelled', 'refunded', 'voided'].includes(booking.bookingStatus)) return booking;
  if (['completed', 'checked_in', 'checked-in', 'checked-out'].includes(booking.bookingStatus)) {
    const error = new Error('This booking can no longer be cancelled online');
    error.status = 409;
    throw error;
  }

  const cancelledAt = new Date().toISOString();
  booking.bookingStatus = 'cancelled';
  booking.cancelReason = String(reason || 'Customer requested cancellation').trim().slice(0, 1000);
  booking.cancelledAt = cancelledAt;
  booking.ticketLegs = (booking.ticketLegs || []).map((leg) => ({ ...leg, status: 'cancelled', checkInStatus: 'cancelled', cancelledAt }));
  if (booking.serviceType === 'hotel') {
    booking.hotelStay = { ...(booking.hotelStay || {}), status: 'cancelled', cancelledAt };
    booking.checkInStatus = 'cancelled';
    booking.bookingItems = (booking.bookingItems || []).map((item) => ({ ...item, status: 'cancelled', cancelledAt }));
    booking.settlementStatus = booking.paymentStatus === 'successful' ? 'reconciliation_required' : 'pending_payment';
    booking.settlementError = booking.paymentStatus === 'successful'
      ? (hotelRefundDecision?.reason || 'Paid hotel cancellation requires refund-policy reconciliation')
      : '';
  }

  await runMongoUnitOfWork(async (session) => {
    if (booking.serviceType === 'bus') {
      const claims = (booking.bookingItems || []).filter((item) => item.scheduleId && item.seatNumber);
      for (const claim of claims) {
        await busOperationsRepository.seats.updateOne(
          { scheduleId: claim.scheduleId, seatNumber: claim.seatNumber, bookingRef: booking.bookingRef },
          { $set: { status: 'available' }, $unset: { lockedUntil: '', lockId: '', bookingRef: '', bookingId: '', passengerName: '', passengerPhone: '', passengerEmail: '' } },
          { session }
        );
      }
      for (const scheduleId of [...new Set(claims.map((item) => item.scheduleId))]) await refreshScheduleAvailability(scheduleId, session);
    }
    if (booking.serviceType === 'hotel') {
      const canonicalCancellation = await hotelRepository.cancelReservation({
        bookingRef: booking.bookingRef,
        companyId: booking.companyId || '',
        reason: booking.cancelReason,
        actorId: context.actorId || booking.customerUserId || 'customer',
        session,
      });
      if (!canonicalCancellation?.reservation) {
        const nights = await hotelRepository.roomNightInventories.list({ bookingRef: booking.bookingRef }, { session });
        for (const night of nights) {
          if (['occupied', 'checked_in', 'checked_out', 'cleaning', 'maintenance'].includes(String(night.status || '').toLowerCase())) continue;
          await hotelRepository.roomNightInventories.updateOne(
            { id: night.id, bookingRef: booking.bookingRef },
            { $set: { status: 'available', bookingRef: '', reservationId: '', assignmentId: '', guestName: '', checkInStatus: '', availableInventory: 1 }, $unset: { holdId: '' } },
            { session }
          );
        }
      }
    }
    await customerRepository.bookings.save(booking, { bookingRef: booking.bookingRef }, { session });
  });

  await recordBookingTimeline(booking, 'booking.cancelled', `Booking ${booking.bookingRef} cancelled`, booking.cancelReason, {
    actorType: context.actorRole || 'customer', actorId: context.actorId || booking.customerUserId || 'customer',
    actorName: context.actorName || '', status: 'cancelled', metadata: { source: 'customer_cancellation' },
  });

  if (booking.paymentStatus === 'successful') {
    if (booking.serviceType === 'hotel' && (!hotelRefundDecision || hotelRefundDecision.reviewRequired || hotelRefundDecision.amount <= 0)) {
      booking.refundStatus = hotelRefundDecision?.reviewRequired ? 'review_required' : 'not_refundable';
      booking.settlementStatus = 'reconciliation_required';
      booking.settlementError = hotelRefundDecision?.reason || 'Paid hotel cancellation requires finance review';
      await customerRepository.bookings.save(booking, { bookingRef: booking.bookingRef });
    } else {
      try {
        const workflowService = require('../support/workflowService');
        await Promise.resolve(workflowService.requestRefund({
          bookingRef: booking.bookingRef,
          requesterId: context.actorId || booking.customerUserId || 'customer',
          amount: booking.serviceType === 'hotel' ? hotelRefundDecision.amount : Number(booking.pricing?.total || 0),
          reason: `Cancellation: ${booking.cancelReason}`,
        }));
      } catch (error) {
        booking.settlementStatus = 'reconciliation_required';
        booking.settlementError = `Cancellation refund request failed: ${error.message}`;
        await customerRepository.bookings.save(booking, { bookingRef: booking.bookingRef });
      }
    }
  }
  return booking;
}

module.exports = { purgeFailedBookingArtifacts, createGuestBooking, createManualBooking, lookupTicket, validateTicket, markNoShow, lookupBooking, cancelBooking };
