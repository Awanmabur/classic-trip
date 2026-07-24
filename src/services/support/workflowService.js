const { platformCurrency } = require('../../utils/currency');
const supportRepository = require('../../repositories/domain/supportRepository');
const walletService = require('../wallet/walletService');
const ledgerService = require('../wallet/ledgerService');
const timelineService = require('./timelineService');
const { nextId } = require('../data/idService');
const hotelRepository = require('../../repositories/domain/hotelRepository');

function cleanText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

async function requestRefundLive({ bookingRef, requesterId = 'guest', amount, reason = 'Customer requested refund', companyId = '', actorType = 'customer' } = {}) {
  const booking = await supportRepository.bookings.findOne({ $or: [{ bookingRef }, { id: bookingRef }] });
  if (!booking || (companyId && String(booking.companyId) !== String(companyId))) {
    const error = new Error('Booking not found');
    error.status = 404;
    throw error;
  }
  const existing = await supportRepository.refunds.findOne({ bookingRef: booking.bookingRef, status: { $in: ['pending', 'reviewing'] } });
  if (existing) return existing;
  const cleanReason = cleanText(reason) || 'Customer requested refund';
  const bookingTotal = Number(booking.pricing?.total || 0);
  const parsedAmount = Number(Array.isArray(amount) ? NaN : amount);
  const safeAmount = Number.isFinite(parsedAmount) && parsedAmount > 0 ? Math.min(parsedAmount, bookingTotal || parsedAmount) : bookingTotal;
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
  const ticket = {
    id: await nextId('support'), ownerType: actorType === 'employee' ? 'company' : 'customer',
    ownerId: actorType === 'employee' ? booking.companyId : requesterId, userId: booking.customerUserId || requesterId,
    companyId: booking.companyId, bookingId: booking.id, bookingRef: booking.bookingRef,
    subject: `Refund request ${booking.bookingRef}`, category: 'Refund request', message: cleanReason,
    priority: safeAmount > 500000 ? 'high' : 'medium', status: 'open', assignedTo: actorType === 'employee' ? requesterId : '',
    createdBy: requesterId, createdAt: now,
  };
  const timeline = {
    id: await nextId('timeline'), bookingId: booking.id, bookingRef: booking.bookingRef, companyId: booking.companyId,
    customerUserId: booking.customerUserId || requesterId, entityType: 'refund_request', entityId: refund.id,
    action: 'refund.requested', title: `Refund requested for ${booking.bookingRef}`, message: cleanReason, status: 'pending',
    actorType: ['employee', 'company', 'admin', 'promoter', 'customer'].includes(actorType) ? actorType : 'system', actorId: requesterId,
    metadata: { amount: safeAmount, currency: refund.currency }, createdAt: now,
  };
  await supportRepository.withTransaction(async (session) => {
    await supportRepository.refunds.save(refund, { id: refund.id }, { session });
    await supportRepository.tickets.save(ticket, { id: ticket.id }, { session });
    await supportRepository.timelineEvents.save(timeline, { id: timeline.id }, { session });
    booking.refundStatus = 'requested';
    booking.refundIds = [...new Set([...(booking.refundIds || []), refund.id])];
    await supportRepository.bookings.save(booking, { bookingRef: booking.bookingRef }, { session });
    if (booking.serviceType === 'hotel') {
      await hotelRepository.hotelReservations.updateOne({ bookingRef: booking.bookingRef, companyId: booking.companyId }, {
        $set: { refundStatus: 'requested', updatedAt: new Date() },
        $addToSet: { refundIds: refund.id },
      }, { session });
    }
  });
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
  const fullRefund = ratio >= 0.999;
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
      refundedAmount: roundMoney(Number(commission.refundedAmount || 0) + (Number(commission.promoterAmount || 0) * ratio)),
      refundId: refund.id, refundedAt: new Date().toISOString(), status: fullRefund ? 'cancelled' : 'partially_refunded',
    });
    await supportRepository.commissions.save(commission, { id: commission.id });
  }
  if (fullRefund) await ledgerService.updateTransactions({ referenceType: 'booking', referenceId: booking.id, status: 'pending' }, { status: 'rejected', refundId: refund.id });
  Object.assign(refund, { reversals, refundRatio: ratio, fullRefund });
  return reversals;
}

async function approveRefund(refundId, adminId = 'admin-system') {
  const refund = await supportRepository.refunds.findOne({ $or: [{ id: refundId }, { bookingRef: refundId }] });
  if (!refund) { const error = new Error('Refund request not found'); error.status = 404; throw error; }
  const booking = await supportRepository.bookings.findOne({ bookingRef: refund.bookingRef });
  if (refund.status === 'approved') return refund;
  Object.assign(refund, { status: 'approved', approvedBy: adminId, approvedAt: new Date().toISOString() });
  if (booking) {
    await applyRefundReversals(booking, refund, adminId);
    const fullRefund = refund.fullRefund !== false;
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
    await walletService.creditAvailable('customer', booking.customerUserId || refund.requesterId || booking.guestSnapshot?.email || 'guest', refund.currency || booking.pricing?.currency || platformCurrency(), refund.amount, { transactionType: 'refund_credit', referenceType: 'refund', referenceId: refund.id });
    const ticket = await supportRepository.tickets.findOne({ subject: `Refund request ${booking.bookingRef}` });
    if (ticket) {
      Object.assign(ticket, { status: 'closed', resolutionNotes: 'Refund approved', resolvedBy: adminId, resolvedAt: new Date().toISOString() });
      await supportRepository.tickets.save(ticket, { id: ticket.id });
    }
    const notificationService = require('../notification/notificationService');
    await notificationService.refundApproved(booking, refund).catch(() => {});
  }
  await persistRefundWorkflow(booking, refund);
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

module.exports = { requestRefund: requestRefundLive, requestRefundLive, approveRefund, rejectRefund, createReview, moderateReview };
