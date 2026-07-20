const walletService = require('../wallet/walletService');
const ledgerService = require('../wallet/ledgerService');
const commissionService = require('./commissionService');
const store = require('../data/persistentStore');

async function releaseCompletedBooking(bookingRef) {
  const booking = store.findBooking(bookingRef);
  if (!booking || !['checked_in', 'completed'].includes(booking.bookingStatus)) return null;
  if (!store.state.commissions.some((item) => item.bookingId === booking.id)) {
    commissionService.createCommission(booking, Boolean(booking.promoterAttribution), booking.pricing?.split);
  }
  const currency = booking.pricing?.currency || 'UGX';
  const commissions = store.state.commissions.filter((item) => item.bookingId === booking.id && item.status === 'pending');
  for (const commission of commissions) {
    await walletService.movePendingToAvailable('company', commission.companyId, currency, commission.companyAmount, {
      transactionType: 'company_earning_released',
      referenceType: 'booking',
      referenceId: booking.id,
    });
    if (commission.promoterId && commission.promoterAmount > 0) {
      await walletService.movePendingToAvailable('promoter', commission.promoterId, currency, commission.promoterAmount, {
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
  }
  if (commissions.length) booking.earningsReleasedAt = new Date().toISOString();
  return commissions;
}

module.exports = { releaseCompletedBooking };
