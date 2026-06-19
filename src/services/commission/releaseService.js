const walletService = require('../wallet/walletService');
const ledgerService = require('../wallet/ledgerService');
const commissionService = require('./commissionService');
const store = require('../data/persistentStore');

function releaseCompletedBooking(bookingRef) {
  const booking = store.findBooking(bookingRef);
  if (!booking || !['checked_in', 'completed'].includes(booking.bookingStatus)) return null;
  if (!store.state.commissions.some((item) => item.bookingId === booking.id)) {
    commissionService.createCommission(booking, Boolean(booking.promoterAttribution), booking.pricing?.split);
  }
  const commissions = store.state.commissions.filter((item) => item.bookingId === booking.id && item.status === 'pending');
  commissions.forEach((commission) => {
    walletService.movePendingToAvailable('company', commission.companyId, commission.companyAmount, {
      transactionType: 'company_earning_released',
      referenceType: 'booking',
      referenceId: booking.id,
    });
    if (commission.promoterId && commission.promoterAmount > 0) {
      walletService.movePendingToAvailable('promoter', commission.promoterId, commission.promoterAmount, {
        transactionType: 'promoter_commission_released',
        referenceType: 'booking',
        referenceId: booking.id,
      });
    }
    ledgerService.updateTransactions(
      { referenceType: 'booking', referenceId: booking.id, status: 'pending' },
      { status: 'completed' }
    );
    commission.status = 'released';
    commission.releasedAt = new Date().toISOString();
  });
  if (commissions.length) booking.earningsReleasedAt = new Date().toISOString();
  return commissions;
}

module.exports = { releaseCompletedBooking };
