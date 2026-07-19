const store = require('../data/persistentStore');
const walletService = require('../wallet/walletService');
const ledgerService = require('../wallet/ledgerService');
const timelineService = require('./timelineService');
const repositories = require('../../repositories');

function cleanText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

function requestRefund({ bookingRef, requesterId = 'guest', amount, reason = 'Customer requested refund' } = {}) {
  const booking = store.findBooking(bookingRef);
  if (!booking) {
    const error = new Error('Booking not found');
    error.status = 404;
    throw error;
  }
  const existing = store.state.refundRequests.find((item) => item.bookingRef === booking.bookingRef && item.status === 'pending');
  if (existing) return existing;
  const cleanReason = cleanText(reason) || 'Customer requested refund';
  const parsedAmount = Number(Array.isArray(amount) ? NaN : amount);
  const safeAmount = Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : Number(booking.pricing?.total || 0);
  const refund = {
    id: `refund-${store.state.refundRequests.length + 1}`,
    bookingId: booking.id,
    bookingRef: booking.bookingRef,
    requesterId,
    amount: safeAmount,
    currency: booking.pricing?.currency || 'UGX',
    reason: cleanReason,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  store.state.refundRequests.push(refund);
  store.state.supportTickets.push({
    id: `support-${store.state.supportTickets.length + 1}`,
    ownerType: 'customer',
    ownerId: requesterId,
    companyId: booking.companyId,
    bookingId: booking.id,
    bookingRef: booking.bookingRef,
    subject: `Refund request ${booking.bookingRef}`,
    message: cleanReason,
    priority: refund.amount > 500000 ? 'high' : 'medium',
    status: 'open',
    createdAt: new Date().toISOString(),
  });
  timelineService.recordEvent({
    bookingRef: booking.bookingRef,
    companyId: booking.companyId,
    customerUserId: booking.customerUserId || requesterId,
    entityType: 'refund_request',
    entityId: refund.id,
    action: 'refund.requested',
    title: `Refund requested for ${booking.bookingRef}`,
    message: cleanReason,
    status: 'pending',
    actorType: 'customer',
    actorId: requesterId,
    metadata: { amount: refund.amount, currency: refund.currency },
  }).catch(() => {});
  if (repositories.mongoReady()) repositories.refundRequests.upsert(refund).catch(() => {});
  return refund;
}


async function persistRefundWorkflow(booking, refund) {
  if (!repositories.mongoReady()) return;
  await repositories.refundRequests.upsert(refund);
  if (booking?.bookingRef) await repositories.bookings.upsert(booking);
  const seatClaims = (booking?.bookingItems || []).filter((item) => item.scheduleId && item.seatNumber);
  if (booking?.serviceType === 'bus' && refund.fullRefund && seatClaims.length && booking.checkInStatus !== 'checked_in') {
    await repositories.seats.updateMany(
      { $or: seatClaims.map((claim) => ({ scheduleId: claim.scheduleId, seatNumber: claim.seatNumber })) },
      { $set: { status: 'available' }, $unset: { lockedUntil: '', lockId: '' } }
    );
    const scheduleCounts = seatClaims.reduce((acc, claim) => { acc[claim.scheduleId] = (acc[claim.scheduleId] || 0) + 1; return acc; }, {});
    await repositories.schedules.Model.bulkWrite(Object.entries(scheduleCounts).map(([id, count]) => ({ updateOne: { filter: { id }, update: { $inc: { availableSeats: count } } } })), { ordered: false });
  }
}

function releaseRefundInventory(booking = {}, refund = {}) {
  if (!booking || !refund.fullRefund) return;
  if (booking.serviceType === 'bus' && booking.checkInStatus !== 'checked_in') {
    const seatClaims = (booking.bookingItems || []).filter((item) => item.scheduleId && item.seatNumber);
    seatClaims.forEach((claim) => {
      const seat = store.state.seats.find((item) => item.scheduleId === claim.scheduleId && item.seatNumber === claim.seatNumber);
      if (seat && seat.status === 'taken') {
        seat.status = 'available';
        seat.lockedUntil = null;
        seat.lockId = null;
      }
      const schedule = store.state.schedules.find((item) => item.id === claim.scheduleId);
      if (schedule) schedule.availableSeats = Number(schedule.availableSeats || 0) + 1;
    });
  }
  (booking.ticketLegs || []).forEach((leg) => {
    leg.status = 'refunded';
    leg.checkInStatus = 'refunded';
    leg.refundId = refund.id;
  });
  (booking.passengers || []).forEach((passenger) => {
    passenger.checkInStatus = 'refunded';
    passenger.refundId = refund.id;
  });
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function refundRatio(booking, refund) {
  const total = Number(booking?.pricing?.total || 0);
  if (!total) return 1;
  return Math.max(0, Math.min(1, Number(refund.amount || 0) / total));
}

function applyRefundReversals(booking, refund, adminId) {
  const ratio = refundRatio(booking, refund);
  const fullRefund = ratio >= 0.999;
  const split = booking.pricing?.split || {};
  const currency = refund.currency || booking.pricing?.currency || 'UGX';
  const reversals = [];

  const reverse = (ownerType, ownerId, amount, transactionType) => {
    if (!ownerId || amount <= 0) return null;
    const result = walletService.reverseEarning(ownerType, ownerId, amount, {
      currency,
      transactionType,
      referenceType: 'refund',
      referenceId: refund.id,
      sourceReferenceType: 'booking',
      sourceReferenceId: booking.id,
      approvedBy: adminId,
    });
    reversals.push({
      ownerType,
      ownerId,
      amount,
      transactionId: result.transaction?.id,
      status: result.transaction?.status,
      pendingDebit: result.transaction?.pendingDebit || 0,
      availableDebit: result.transaction?.availableDebit || 0,
      uncoveredAmount: result.transaction?.uncoveredAmount || 0,
    });
    return result;
  };

  reverse('platform', 'platform', roundMoney(Number(split.platformFee || 0) * ratio), 'refund_platform_debit');
  reverse('company', booking.companyId, roundMoney(Number(split.companyAmount || 0) * ratio), 'refund_company_debit');
  if (booking.promoterAttribution?.promoterId) {
    reverse('promoter', booking.promoterAttribution.promoterId, roundMoney(Number(split.promoterAmount || 0) * ratio), 'refund_promoter_debit');
  }

  const commissions = store.state.commissions.filter((item) => item.bookingId === booking.id);
  commissions.forEach((commission) => {
    commission.refundedAmount = roundMoney((Number(commission.refundedAmount || 0)) + (Number(commission.promoterAmount || 0) * ratio));
    commission.refundId = refund.id;
    commission.refundedAt = new Date().toISOString();
    commission.status = fullRefund ? 'cancelled' : 'partially_refunded';
  });

  if (fullRefund) {
    ledgerService.updateTransactions(
      { referenceType: 'booking', referenceId: booking.id, status: 'pending' },
      { status: 'reversed', refundId: refund.id }
    );
  }

  refund.reversals = reversals;
  refund.refundRatio = ratio;
  refund.fullRefund = fullRefund;
  return reversals;
}

function approveRefund(refundId, adminId = 'admin-system') {
  const refund = store.state.refundRequests.find((item) => item.id === refundId || item.bookingRef === refundId);
  if (!refund) {
    const error = new Error('Refund request not found');
    error.status = 404;
    throw error;
  }
  const booking = store.findBooking(refund.bookingRef);
  if (refund.status === 'approved') return refund;
  refund.status = 'approved';
  refund.approvedBy = adminId;
  refund.approvedAt = new Date().toISOString();
  if (booking) {
    applyRefundReversals(booking, refund, adminId);
    const fullRefund = refund.fullRefund !== false;
    releaseRefundInventory(booking, refund);
    booking.bookingStatus = fullRefund ? 'refunded' : 'partially_refunded';
    booking.paymentStatus = fullRefund ? 'refunded' : 'partially_refunded';
    booking.refundedAt = new Date().toISOString();
    booking.refundId = refund.id;
    walletService.creditAvailable('customer', booking.customerUserId || refund.requesterId || booking.guestSnapshot?.email || 'guest', refund.amount, {
      currency: refund.currency || booking.pricing?.currency || 'UGX',
      transactionType: 'refund_credit',
      referenceType: 'refund',
      referenceId: refund.id,
    });
    // Fire-and-forget refund to original payment provider (non-blocking).
    if (booking.payment?.providerReference || booking.payment?.transactionRef) {
      const paymentService = require('../payment/paymentService');
      paymentService.initiateRefund({
        amount: refund.amount,
        currency: refund.currency || booking.pricing?.currency || 'UGX',
        bookingRef: booking.bookingRef,
        refundId: refund.id,
        originalProviderReference: booking.payment?.providerReference || booking.payment?.transactionRef,
        provider: booking.payment?.provider,
      }).then((result) => {
        refund.providerRefundReference = result?.refundReference;
        refund.providerRefundStatus = result?.status;
      }).catch(() => {});
    }
    const ticket = store.state.supportTickets.find((item) => item.subject === `Refund request ${booking.bookingRef}`);
    if (ticket) {
      ticket.status = 'closed';
      ticket.resolution = 'Refund approved';
      ticket.resolvedBy = adminId;
      ticket.resolvedAt = new Date().toISOString();
    }
    const notificationService = require('../notification/notificationService');
    notificationService.refundApproved(booking, refund).catch(() => {});
  }
  persistRefundWorkflow(booking, refund).catch(() => {});
  return refund;
}

async function rejectRefund(refundId, adminId = 'admin-system', reason = 'Refund rejected after review') {
  const refund = store.state.refundRequests.find((item) => item.id === refundId || item.bookingRef === refundId);
  if (!refund) {
    const error = new Error('Refund request not found');
    error.status = 404;
    throw error;
  }
  if (refund.status === 'approved') {
    const error = new Error('Approved refunds cannot be rejected');
    error.status = 409;
    throw error;
  }
  refund.status = 'rejected';
  refund.reviewedBy = adminId;
  refund.reviewedAt = new Date().toISOString();
  refund.rejectionReason = cleanText(reason);
  const ticket = store.state.supportTickets.find((item) => item.subject === `Refund request ${refund.bookingRef}`);
  if (ticket) {
    ticket.status = 'closed';
    ticket.resolution = refund.rejectionReason;
    ticket.resolvedBy = adminId;
    ticket.resolvedAt = new Date().toISOString();
  }
  if (repositories.mongoReady()) await repositories.refundRequests.upsert(refund);
  return refund;
}

function createReview({ bookingRef, customerUserId = null, rating = 5, comment = '' } = {}) {
  if (!Array.isArray(store.state.reviews)) store.state.reviews = [];
  const booking = store.findBooking(bookingRef);
  if (!booking) {
    const error = new Error('Booking not found');
    error.status = 404;
    throw error;
  }
  if (!['checked_in', 'completed'].includes(booking.bookingStatus)) {
    const error = new Error('Review is available after check-in or completion');
    error.status = 409;
    throw error;
  }
  const listing = store.findListing(booking.listingId);
  const ownerId = customerUserId || booking.customerUserId || booking.guestSnapshot?.email || null;
  const existing = store.state.reviews.find((item) => item.bookingId === booking.id && item.customerUserId === ownerId);
  if (existing) return existing;
  const review = {
    id: `review-${store.state.reviews.length + 1}`,
    bookingId: booking.id,
    listingId: booking.listingId,
    companyId: booking.companyId,
    customerUserId: ownerId,
    rating: Math.max(1, Math.min(5, Number(rating) || 5)),
    comment: cleanText(comment),
    status: 'published',
    createdAt: new Date().toISOString(),
  };
  store.state.reviews.push(review);
  if (listing) {
    const count = Number(listing.reviewCount || 0);
    const currentTotal = Number(listing.ratingAverage || listing.rating || 0) * count;
    listing.reviewCount = count + 1;
    listing.ratingAverage = Math.round(((currentTotal + review.rating) / listing.reviewCount) * 10) / 10;
    listing.rating = String(listing.ratingAverage);
  }
  return review;
}

function moderateReview(reviewId, status = 'hidden') {
  const review = store.state.reviews.find((item) => item.id === reviewId);
  if (!review) return null;
  review.status = status;
  review.moderatedAt = new Date().toISOString();
  return review;
}

module.exports = { requestRefund, approveRefund, rejectRefund, createReview, moderateReview };
