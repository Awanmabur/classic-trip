const { platformCurrency } = require('../../utils/currency');
const supportRepository = require('../../repositories/domain/supportRepository');
const walletService = require('../wallet/walletService');
const ledgerService = require('../wallet/ledgerService');
const timelineService = require('./timelineService');
const { nextId } = require('../data/idService');
const hotelRepository = require('../../repositories/domain/hotelRepository');
const paymentService = require('../payment/paymentService');

function cleanText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

async function requestRefundLive({ bookingRef, requesterId = 'guest', amount, reason = 'Customer requested refund', companyId = '', actorType = 'customer', session = null } = {}) {
  const readOptions = session ? { session } : {};
  const booking = await supportRepository.bookings.findOne({ $or: [{ bookingRef }, { id: bookingRef }] }, readOptions);
  if (!booking || (companyId && String(booking.companyId) !== String(companyId))) {
    const error = new Error('Booking not found');
    error.status = 404;
    throw error;
  }
  const existing = await supportRepository.refunds.findOne({ bookingRef: booking.bookingRef, status: { $in: ['pending', 'reviewing'] } }, readOptions);
  if (existing) return existing;
  const cleanReason = cleanText(reason) || 'Customer requested refund';
  const bookingTotal = Number(booking.pricing?.total || booking.grossAmount || 0);
  const approvedRefunds = await supportRepository.refunds.list({ bookingRef: booking.bookingRef, status: 'approved' }, readOptions);
  const alreadyRefunded = approvedRefunds.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const remainingRefundable = Math.max(0, roundMoney(bookingTotal - alreadyRefunded));
  if (!(remainingRefundable > 0)) {
    const error = new Error('This booking has already been fully refunded');
    error.status = 409;
    error.code = 'booking_already_refunded';
    throw error;
  }
  const parsedAmount = Number(Array.isArray(amount) ? NaN : amount);
  const safeAmount = Number.isFinite(parsedAmount) && parsedAmount > 0
    ? Math.min(parsedAmount, remainingRefundable)
    : remainingRefundable;
  if (!(safeAmount > 0)) {
    const error = new Error('Refund amount must be greater than zero');
    error.status = 422;
    throw error;
  }
  const now = new Date().toISOString();
  const refund = {
    id: await nextId('refund'), bookingId: booking.id, bookingRef: booking.bookingRef,
    companyId: booking.companyId, requesterId, customerUserId: booking.customerUserId || requesterId,
    amount: safeAmount, currency: booking.pricing?.currency || platformCurrency(), reason: cleanReason,
    status: 'pending', requestedAt: now, createdAt: now, metadata: { actorType },
  };
  const companyActor = ['employee', 'company', 'partner', 'flight_agent', 'admin'].includes(actorType);
  const ticket = {
    id: await nextId('support'), ownerType: companyActor ? 'company' : 'customer',
    ownerId: companyActor ? booking.companyId : requesterId, userId: booking.customerUserId || requesterId,
    companyId: booking.companyId, bookingId: booking.id, bookingRef: booking.bookingRef,
    subject: `Refund request ${booking.bookingRef}`, category: 'Refund request', message: cleanReason,
    priority: safeAmount > 500000 ? 'high' : 'medium', status: 'open', assignedTo: companyActor ? requesterId : '',
    createdBy: requesterId, createdAt: now,
  };
  const timeline = {
    id: await nextId('timeline'), bookingId: booking.id, bookingRef: booking.bookingRef, companyId: booking.companyId,
    customerUserId: booking.customerUserId || requesterId, entityType: 'refund_request', entityId: refund.id,
    action: 'refund.requested', title: `Refund requested for ${booking.bookingRef}`, message: cleanReason, status: 'pending',
    actorType: ['employee', 'company', 'partner', 'flight_agent', 'admin', 'promoter', 'customer'].includes(actorType) ? actorType : 'system', actorId: requesterId,
    metadata: { amount: safeAmount, currency: refund.currency }, createdAt: now,
  };
  const persist = async (activeSession) => {
    const options = activeSession ? { session: activeSession } : {};
    await supportRepository.refunds.save(refund, { id: refund.id }, options);
    await supportRepository.tickets.save(ticket, { id: ticket.id }, options);
    await supportRepository.timelineEvents.save(timeline, { id: timeline.id }, options);
    booking.refundStatus = 'requested';
    booking.refundIds = [...new Set([...(booking.refundIds || []), refund.id])];
    await supportRepository.bookings.save(booking, { bookingRef: booking.bookingRef }, options);
    if (booking.serviceType === 'hotel') {
      await hotelRepository.hotelReservations.updateOne({ bookingRef: booking.bookingRef, companyId: booking.companyId }, {
        $set: { refundStatus: 'requested', updatedAt: new Date() },
        $addToSet: { refundIds: refund.id },
      }, options);
    }
  };
  if (session) await persist(session);
  else await supportRepository.withTransaction(persist);
  return refund;
}

async function persistRefundWorkflow(booking, refund) {
  await supportRepository.refunds.save(refund, { id: refund.id });
  if (booking?.bookingRef) await supportRepository.bookings.save(booking, { bookingRef: booking.bookingRef });
  const seatClaims = (booking?.bookingItems || []).filter((item) => item.scheduleId && item.seatNumber);
  if (booking?.serviceType === 'bus' && refund.fullRefund && seatClaims.length && booking.checkInStatus !== 'checked_in') {
    const filter = { $or: seatClaims.map((claim) => ({ scheduleId: claim.scheduleId, seatNumber: claim.seatNumber })) };
    await supportRepository.seats.repository.updateMany(filter, { $set: { status: 'available' }, $unset: { lockedUntil: '', lockId: '' } });
    const scheduleCounts = seatClaims.reduce((acc, claim) => { acc[claim.scheduleId] = (acc[claim.scheduleId] || 0) + 1; return acc; }, {});
    supportRepository.schedules.assertReady();
    await supportRepository.schedules.repository.Model.bulkWrite(
      Object.entries(scheduleCounts).map(([id, count]) => ({
        updateOne: { filter: { id }, update: { $inc: { availableSeats: count } } },
      })),
      { ordered: false }
    );
  }
}

function markRefundedBookingArtifacts(booking = {}, refund = {}) {
  if (!booking || !refund.fullRefund) return;
  (booking.ticketLegs || []).forEach((leg) => Object.assign(leg, { status: 'refunded', checkInStatus: 'refunded', refundId: refund.id }));
  (booking.passengers || []).forEach((passenger) => Object.assign(passenger, { checkInStatus: 'refunded', refundId: refund.id }));
}

function roundMoney(value) { return Math.round((Number(value) || 0) * 100) / 100; }
function refundRatio(booking, refund) {
  const total = Number(booking?.pricing?.total || 0);
  if (!total) return 1;
  return Math.max(0, Math.min(1, Number(refund.amount || 0) / total));
}

async function applyRefundReversals(booking, refund, adminId) {
  const ratio = refundRatio(booking, refund);
  const priorApproved = await supportRepository.refunds.list({ bookingRef: booking.bookingRef, id: { $ne: refund.id }, status: 'approved' });
  const cumulativeRefunded = priorApproved.reduce((sum, row) => sum + Number(row.amount || 0), 0) + Number(refund.amount || 0);
  const total = Number(booking.pricing?.total || booking.grossAmount || 0);
  const cumulativeRatio = total > 0 ? Math.max(0, Math.min(1, cumulativeRefunded / total)) : 1;
  const fullRefund = cumulativeRatio >= 0.999;
  const split = booking.pricing?.split || {};
  const currency = refund.currency || booking.pricing?.currency || platformCurrency();
  const reversals = [];
  const reverse = async (ownerType, ownerId, amount, transactionType) => {
    if (!ownerId || amount <= 0) return null;
    const result = await walletService.reverseEarning(ownerType, ownerId, currency, amount, {
      transactionType, referenceType: 'refund', referenceId: refund.id,
      sourceReferenceType: 'booking', sourceReferenceId: booking.id, approvedBy: adminId,
    });
    reversals.push({ ownerType, ownerId, amount, transactionId: result.transaction?.id, status: result.transaction?.status, pendingDebit: result.transaction?.pendingDebit || 0, availableDebit: result.transaction?.availableDebit || 0, uncoveredAmount: result.transaction?.uncoveredAmount || 0 });
    return result;
  };
  await reverse('platform', 'platform', roundMoney(Number(split.platformFee || 0) * ratio), 'refund_debit');
  await reverse('company', booking.companyId, roundMoney(Number(split.companyAmount || 0) * ratio), 'refund_debit');
  if (booking.promoterAttribution?.promoterId) await reverse('promoter', booking.promoterAttribution.promoterId, roundMoney(Number(split.promoterAmount || 0) * ratio), 'refund_debit');

  const commissions = await supportRepository.commissions.list({ bookingId: booking.id });
  for (const commission of commissions) {
    Object.assign(commission, {
      refundedAmount: roundMoney(Number(commission.promoterAmount || 0) * cumulativeRatio),
      refundId: refund.id, refundedAt: new Date().toISOString(), status: fullRefund ? 'cancelled' : 'partially_refunded',
    });
    await supportRepository.commissions.save(commission, { id: commission.id });
  }
  if (fullRefund) await ledgerService.updateTransactions({ referenceType: 'booking', referenceId: booking.id, status: 'pending' }, { status: 'rejected', refundId: refund.id });
  Object.assign(refund, { reversals, refundRatio: ratio, fullRefund });
  return reversals;
}

const ONLINE_REFUND_PROVIDERS = new Set(['pesapal', 'mtn_momo', 'airtel_money', 'flutterwave', 'paystack', 'dpo']);
const MANUAL_REFUND_PROVIDERS = new Set(['cash', 'manual', 'offline', 'bank_transfer', 'wallet']);

function assertOperationalCancellation(booking, isFullRefund) {
  const serviceType = String(booking?.serviceType || '').toLowerCase();
  if (isFullRefund && ['flight', 'local_transport'].includes(serviceType) && !['cancelled', 'refunded'].includes(String(booking.bookingStatus || '').toLowerCase())) {
    const error = new Error(serviceType === 'flight'
      ? 'Cancel the flight and confirm the supplier cancellation before approving its full refund'
      : 'Cancel the local ride before approving its full refund');
    error.status = 409;
    error.code = 'operational_cancellation_required';
    throw error;
  }
}

async function initiateProviderRefund(refund, booking, adminId) {
  const previouslyApproved = await supportRepository.refunds.list({ bookingRef: booking.bookingRef, id: { $ne: refund.id }, status: 'approved' });
  const approvedAmount = previouslyApproved.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const bookingTotal = Number(booking.pricing?.total || booking.grossAmount || 0);
  if (!(bookingTotal > 0) || approvedAmount + Number(refund.amount || 0) > bookingTotal + 0.01) {
    throw Object.assign(new Error('The requested refund exceeds the booking payment balance'), { status: 409, code: 'refund_amount_exceeds_payment' });
  }
  assertOperationalCancellation(booking, approvedAmount + Number(refund.amount || 0) >= bookingTotal - 0.01);
  const payments = await supportRepository.payments.list({ bookingRef: booking.bookingRef, status: { $in: ['successful', 'refunded'] } }, { sort: { paidAt: -1, createdAt: -1 }, limit: 5 });
  const payment = payments[0];
  if (!payment) throw Object.assign(new Error('A successful payment record is required before approving a refund'), { status: 409, code: 'refund_payment_missing' });
  const provider = String(payment.provider || booking.paymentProvider || '').toLowerCase();
  const paymentCurrency = String(payment.currency || booking.pricing?.currency || '').toUpperCase();
  if (paymentCurrency && String(refund.currency || '').toUpperCase() !== paymentCurrency) {
    throw Object.assign(new Error('Refund currency does not match the original payment'), { status: 409, code: 'refund_currency_mismatch' });
  }
  if (!ONLINE_REFUND_PROVIDERS.has(provider) && !MANUAL_REFUND_PROVIDERS.has(provider)) {
    throw Object.assign(new Error(`Refunds are not configured for payment provider '${provider || 'unknown'}'`), { status: 503, code: 'refund_provider_not_configured' });
  }
  if (MANUAL_REFUND_PROVIDERS.has(provider)) {
    Object.assign(refund, {
      provider,
      providerPaymentReference: payment.providerReference || payment.paymentRef || '',
      providerRefundStatus: 'completed',
      providerRefundReference: `MANUAL-${refund.id}`,
      providerRefundInitiatedAt: refund.providerRefundInitiatedAt || new Date().toISOString(),
      providerRefundCompletedAt: new Date().toISOString(),
      providerRefundError: '',
    });
    await supportRepository.refunds.save(refund, { id: refund.id });
    return { completed: true, payment, result: { accepted: true, status: 'successful', providerRefundReference: refund.providerRefundReference } };
  }
  if (!payment.providerReference) throw Object.assign(new Error('The original provider transaction reference is missing'), { status: 409, code: 'refund_provider_reference_missing' });
  if (refund.providerRefundStatus === 'completed') return { completed: true, payment, result: null };
  if (refund.providerRefundStatus === 'accepted') return { completed: false, payment, result: null };
  if (['in_progress', 'reconciliation_required'].includes(refund.providerRefundStatus)) {
    throw Object.assign(new Error('This provider refund is already processing or requires reconciliation'), { status: 409, code: 'refund_reconciliation_required' });
  }
  if (provider === 'pesapal') {
    const earlier = await supportRepository.refunds.findOne({ bookingRef: booking.bookingRef, id: { $ne: refund.id }, provider: 'pesapal', providerRefundStatus: { $in: ['accepted', 'completed'] } });
    if (earlier) throw Object.assign(new Error('Pesapal permits only one refund request per payment; reconcile the existing refund first'), { status: 409, code: 'pesapal_single_refund_limit' });
  }
  const claim = await supportRepository.refunds.updateOne({
    id: refund.id,
    status: { $in: ['pending', 'reviewing'] },
    $or: [{ providerRefundStatus: 'not_started' }, { providerRefundStatus: { $exists: false } }, { providerRefundStatus: null }, { providerRefundStatus: 'failed' }],
  }, { $set: {
    status: 'reviewing',
    reviewedBy: adminId,
    reviewedAt: new Date().toISOString(),
    provider,
    providerPaymentReference: payment.providerReference,
    providerRefundStatus: 'in_progress',
    providerRefundInitiatedAt: new Date().toISOString(),
    providerRefundError: '',
  } });
  if (Number(claim?.modifiedCount ?? claim?.nModified ?? 0) !== 1) {
    throw Object.assign(new Error('This refund was already claimed for provider processing'), { status: 409, code: 'refund_already_processing' });
  }
  try {
    const result = await paymentService.initiateRefund({
      provider,
      providerReference: payment.providerReference,
      amount: Number(refund.amount),
      currency: refund.currency,
      reason: refund.reason,
      refundId: refund.id,
      bookingRef: booking.bookingRef,
      approvedBy: adminId,
      idempotencyKey: `classic-trip-refund:${refund.id}`,
    });
    if (!result?.accepted) throw Object.assign(new Error('The payment provider did not accept the refund'), { status: 409 });
    const completed = ['successful', 'succeeded', 'refunded', 'processed'].includes(String(result.status || '').toLowerCase());
    Object.assign(refund, {
      status: completed ? refund.status : 'reviewing',
      reviewedBy: adminId,
      reviewedAt: refund.reviewedAt || new Date().toISOString(),
      provider,
      providerPaymentReference: payment.providerReference,
      providerRefundStatus: completed ? 'completed' : 'accepted',
      providerRefundReference: result.providerRefundReference || '',
      providerRefundCompletedAt: completed ? new Date().toISOString() : null,
      providerRefundError: '',
      providerRefundPayload: result.rawPayload || {},
    });
    await supportRepository.refunds.save(refund, { id: refund.id });
    return { completed, payment, result };
  } catch (error) {
    const safelyRetryable = ['provider_refund_not_configured', 'paystack_currency_not_supported'].includes(error.code)
      || [422, 503].includes(Number(error.status));
    Object.assign(refund, {
      status: 'reviewing',
      provider,
      providerPaymentReference: payment.providerReference,
      providerRefundStatus: safelyRetryable ? 'failed' : 'reconciliation_required',
      providerRefundError: cleanText(error.message).slice(0, 500),
    });
    await supportRepository.refunds.save(refund, { id: refund.id });
    throw error;
  }
}

async function finalizeApprovedRefund(refund, booking, adminId = 'admin-system', payment = null) {
  if (refund.status === 'approved') return refund;
  Object.assign(refund, { status: 'approved', approvedBy: adminId, approvedAt: new Date().toISOString() });
  if (booking) {
    await applyRefundReversals(booking, refund, adminId);
    const fullRefund = refund.fullRefund !== false;
    if (fullRefund && booking.serviceType === 'bus') {
      const canonicalBooking = await require('../../modules/bus/services/busBookingService').refundBooking(
        booking.bookingRef,
        `Refund ${refund.id} approved`,
        { provider: refund.provider, providerReference: refund.providerPaymentReference, source: 'refund_workflow' }
      );
      if (canonicalBooking) Object.assign(booking, canonicalBooking);
    } else if (fullRefund && booking.serviceType === 'flight') {
      const canonicalBooking = await require('../../modules/flight/services/flightBookingService').confirmRefund(
        booking.bookingRef,
        { provider: refund.provider, providerReference: refund.providerPaymentReference, refundId: refund.id, source: 'refund_workflow' }
      );
      if (canonicalBooking) Object.assign(booking, canonicalBooking);
    } else if (fullRefund && booking.serviceType === 'local_transport') {
      const canonicalBooking = await require('../../modules/taxi/services/taxiRideService').confirmRefund(
        booking.bookingRef,
        { provider: refund.provider, providerReference: refund.providerPaymentReference, refundId: refund.id, source: 'refund_workflow' }
      );
      if (canonicalBooking) Object.assign(booking, canonicalBooking);
    }
    markRefundedBookingArtifacts(booking, refund);
    const refundedAmount = roundMoney(Number(booking.refundedAmount || 0) + Number(refund.amount || 0));
    const refundIds = [...new Set([...(booking.refundIds || []), refund.id])];
    Object.assign(booking, fullRefund
      ? { bookingStatus: 'refunded', paymentStatus: 'refunded', refundStatus: 'refunded', refundedAmount, refundIds, refundedAt: new Date().toISOString(), refundId: refund.id }
      : { refundStatus: 'partially_refunded', refundedAmount, refundIds, lastRefundedAt: new Date().toISOString(), refundId: refund.id });
    if (booking.serviceType === 'hotel') {
      if (fullRefund) {
        await hotelRepository.applyPaymentLifecycle({
          bookingRef: booking.bookingRef,
          companyId: booking.companyId,
          paymentStatus: 'refunded',
          reason: `Refund ${refund.id} approved`,
        });
        const reservation = await hotelRepository.hotelReservations.findOne({ bookingRef: booking.bookingRef, companyId: booking.companyId });
        if (reservation) {
          reservation.refundStatus = 'refunded';
          reservation.refundedAmount = roundMoney(Number(reservation.refundedAmount || 0) + Number(refund.amount || 0));
          reservation.refundIds = [...new Set([...(reservation.refundIds || []), refund.id])];
          reservation.updatedAt = new Date().toISOString();
          await hotelRepository.hotelReservations.save(reservation, { id: reservation.id });
        }
      } else {
        const reservation = await hotelRepository.hotelReservations.findOne({ bookingRef: booking.bookingRef, companyId: booking.companyId });
        if (reservation) {
          reservation.refundStatus = 'partially_refunded';
          reservation.refundedAmount = roundMoney(Number(reservation.refundedAmount || 0) + Number(refund.amount || 0));
          reservation.refundIds = [...new Set([...(reservation.refundIds || []), refund.id])];
          reservation.settlementStatus = 'reconciliation_required';
          reservation.updatedAt = new Date().toISOString();
          await hotelRepository.hotelReservations.save(reservation, { id: reservation.id });
        }
      }
    }
    const ticket = await supportRepository.tickets.findOne({ subject: `Refund request ${booking.bookingRef}` });
    if (ticket) {
      Object.assign(ticket, { status: 'closed', resolutionNotes: 'Refund approved', resolvedBy: adminId, resolvedAt: new Date().toISOString() });
      await supportRepository.tickets.save(ticket, { id: ticket.id });
    }
    const notificationService = require('../notification/notificationService');
    await notificationService.refundApproved(booking, refund).catch(() => {});
  }
  await persistRefundWorkflow(booking, refund);
  if (payment && refund.fullRefund) {
    payment.status = 'refunded';
    payment.updatedAt = new Date().toISOString();
    await supportRepository.payments.save(payment, { id: payment.id });
  }
  return refund;
}

async function approveRefund(refundId, adminId = 'admin-system') {
  const refund = await supportRepository.refunds.findOne({ $or: [{ id: refundId }, { bookingRef: refundId }] });
  if (!refund) { const error = new Error('Refund request not found'); error.status = 404; throw error; }
  const booking = await supportRepository.bookings.findOne({ bookingRef: refund.bookingRef });
  if (!booking) { const error = new Error('Booking not found'); error.status = 404; throw error; }
  if (refund.status === 'approved') return refund;
  const provider = await initiateProviderRefund(refund, booking, adminId);
  if (!provider.completed) return supportRepository.refunds.findOne({ id: refund.id });
  return finalizeApprovedRefund(refund, booking, adminId, provider.payment);
}

async function completeProviderRefund(bookingRef, provider = '', providerRefundReference = '') {
  const refund = await supportRepository.refunds.findOne({
    bookingRef,
    status: { $in: ['pending', 'reviewing'] },
    provider: provider || { $nin: ['', null] },
    providerRefundStatus: { $in: ['accepted', 'in_progress', 'reconciliation_required', 'failed', 'completed'] },
    ...(providerRefundReference ? { $or: [{ providerRefundReference }, { providerRefundReference: { $in: ['', null] } }] } : {}),
  });
  if (!refund) return null;
  const booking = await supportRepository.bookings.findOne({ bookingRef });
  const payment = await supportRepository.payments.findOne({ bookingRef, provider: refund.provider, status: { $in: ['successful', 'refunded'] } });
  Object.assign(refund, {
    providerRefundStatus: 'completed',
    providerRefundReference: providerRefundReference || refund.providerRefundReference || '',
    providerRefundCompletedAt: new Date().toISOString(),
    providerRefundError: '',
  });
  await supportRepository.refunds.save(refund, { id: refund.id });
  return finalizeApprovedRefund(refund, booking, 'provider-webhook', payment);
}

async function failProviderRefund(bookingRef, provider = '', providerRefundReference = '', reason = 'Provider refund failed') {
  const refund = await supportRepository.refunds.findOne({ bookingRef, status: { $in: ['pending', 'reviewing'] }, ...(provider ? { provider } : {}), providerRefundStatus: { $in: ['accepted', 'in_progress', 'reconciliation_required'] } });
  if (!refund) return null;
  Object.assign(refund, {
    status: 'reviewing',
    providerRefundStatus: 'failed',
    providerRefundReference: providerRefundReference || refund.providerRefundReference || '',
    providerRefundError: cleanText(reason).slice(0, 500),
  });
  await supportRepository.refunds.save(refund, { id: refund.id });
  return refund;
}

async function rejectRefund(refundId, adminId = 'admin-system', reason = 'Refund rejected after review') {
  const refund = await supportRepository.refunds.findOne({ $or: [{ id: refundId }, { bookingRef: refundId }] });
  if (!refund) { const error = new Error('Refund request not found'); error.status = 404; throw error; }
  if (refund.status === 'approved') { const error = new Error('Approved refunds cannot be rejected'); error.status = 409; throw error; }
  const now = new Date().toISOString();
  Object.assign(refund, { status: 'rejected', reviewedBy: adminId, reviewedAt: now, rejectionReason: cleanText(reason) });
  await supportRepository.refunds.save(refund, { id: refund.id });

  const booking = await supportRepository.bookings.findOne({ bookingRef: refund.bookingRef });
  const otherOpenRefunds = await supportRepository.refunds.list({
    bookingRef: refund.bookingRef,
    id: { $ne: refund.id },
    status: { $in: ['requested', 'pending', 'reviewing'] },
  });
  const nextRefundStatus = otherOpenRefunds.length ? 'requested' : 'rejected';
  if (booking) {
    booking.refundStatus = nextRefundStatus;
    booking.refundIds = [...new Set([...(booking.refundIds || []), refund.id])];
    booking.updatedAt = now;
    await supportRepository.bookings.save(booking, { bookingRef: booking.bookingRef });
    if (booking.serviceType === 'hotel') {
      await hotelRepository.hotelReservations.updateOne({ bookingRef: booking.bookingRef, companyId: booking.companyId }, {
        $set: { refundStatus: nextRefundStatus, updatedAt: now },
        $addToSet: { refundIds: refund.id },
      });
    }
  }

  const ticket = await supportRepository.tickets.findOne({ subject: `Refund request ${refund.bookingRef}` });
  if (ticket) {
    Object.assign(ticket, { status: 'closed', resolutionNotes: refund.rejectionReason, resolvedBy: adminId, resolvedAt: now });
    await supportRepository.tickets.save(ticket, { id: ticket.id });
  }
  return refund;
}

async function createReview({ bookingRef, customerUserId = null, rating = 5, comment = '' } = {}) {
  const booking = await supportRepository.bookings.findOne({ $or: [{ bookingRef }, { id: bookingRef }] });
  if (!booking) { const error = new Error('Booking not found'); error.status = 404; throw error; }
  if (!['checked_in', 'completed'].includes(booking.bookingStatus)) { const error = new Error('Review is available after check-in or completion'); error.status = 409; throw error; }
  const ownerId = customerUserId || booking.customerUserId || booking.guestSnapshot?.email || null;
  const existing = await supportRepository.reviews.findOne({ bookingId: booking.id, customerUserId: ownerId });
  if (existing) return existing;
  const review = {
    id: await nextId('review'), bookingId: booking.id, listingId: booking.listingId, companyId: booking.companyId,
    customerUserId: ownerId, rating: Math.max(1, Math.min(5, Number(rating) || 5)), comment: cleanText(comment),
    status: 'published', createdAt: new Date().toISOString(),
  };
  await supportRepository.reviews.save(review, { id: review.id });
  const listing = await supportRepository.listings.findOne({ id: booking.listingId });
  if (listing) {
    const count = Number(listing.reviewCount || 0);
    const currentTotal = Number(listing.ratingAverage || listing.rating || 0) * count;
    listing.reviewCount = count + 1;
    listing.ratingAverage = Math.round(((currentTotal + review.rating) / listing.reviewCount) * 10) / 10;
    listing.rating = String(listing.ratingAverage);
    await supportRepository.listings.save(listing, { id: listing.id });
  }
  return review;
}

async function moderateReview(reviewId, status = 'hidden') {
  const review = await supportRepository.reviews.findOne({ id: reviewId });
  if (!review) return null;
  Object.assign(review, { status, moderatedAt: new Date().toISOString() });
  await supportRepository.reviews.save(review, { id: review.id });
  return review;
}

module.exports = {
  requestRefund: requestRefundLive,
  requestRefundLive,
  approveRefund,
  completeProviderRefund,
  failProviderRefund,
  rejectRefund,
  createReview,
  moderateReview,
};
