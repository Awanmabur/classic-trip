const calculateCommission = require('../../utils/calculateCommission');
const store = require('../data/demoStore');

function createCommission(booking, hasValidReferral, existingSplit = null) {
  const duplicate = store.state.commissions.find((item) => item.bookingId === booking.id);
  if (duplicate) return duplicate;
  const split = existingSplit || calculateCommission(booking.pricing.total, hasValidReferral);
  const commission = {
    id: `commission-${store.state.commissions.length + 1}`,
    bookingId: booking.id,
    bookingRef: booking.bookingRef,
    promoterId: booking.promoterAttribution?.promoterId || null,
    companyId: booking.companyId,
    platformFee: split.platformFee,
    promoterAmount: split.promoterAmount,
    companyAmount: split.companyAmount,
    status: 'pending',
    releasedAt: null,
    createdAt: new Date().toISOString(),
  };
  store.state.commissions.push(commission);
  return commission;
}

module.exports = { createCommission, calculateCommission };
