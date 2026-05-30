const store = require('../data/demoStore');
const walletService = require('../wallet/walletService');

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
  const refund = {
    id: `refund-${store.state.refundRequests.length + 1}`,
    bookingId: booking.id,
    bookingRef: booking.bookingRef,
    requesterId,
    amount: Number(amount || booking.pricing?.total || 0),
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
    subject: `Refund request ${booking.bookingRef}`,
    message: cleanReason,
    priority: refund.amount > 500000 ? 'high' : 'medium',
    status: 'open',
    createdAt: new Date().toISOString(),
  });
  return refund;
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
    booking.bookingStatus = 'refunded';
    booking.paymentStatus = 'refunded';
    walletService.creditAvailable('customer', booking.customerUserId || refund.requesterId || booking.guestSnapshot?.email || 'guest', refund.amount, {
      currency: refund.currency || booking.pricing?.currency || 'UGX',
      transactionType: 'refund_credit',
      referenceType: 'refund',
      referenceId: refund.id,
    });
    const notificationService = require('../notification/notificationService');
    notificationService.refundApproved(booking, refund).catch(() => {});
  }
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

module.exports = { requestRefund, approveRefund, createReview, moderateReview };
