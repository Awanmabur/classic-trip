const { platformCurrency } = require('../../utils/currency');
const walletService = require('../wallet/walletService');
const ledgerService = require('../wallet/ledgerService');
const commissionService = require('./commissionService');
const financeRepository = require('../../repositories/domain/financeRepository');

async function releaseCompletedBooking(bookingRef) {
  const booking = await financeRepository.bookings.findOne({ bookingRef });
  if (!booking) return null;
  const serviceType = String(booking.serviceType || '').trim().toLowerCase();
  const bookingStatus = String(booking.bookingStatus || '').trim().toLowerCase();
  const hotelStayStatus = String(booking.hotelStay?.status || '').trim().toLowerCase();
  const fulfilled = serviceType === 'hotel'
    ? (bookingStatus === 'completed' && ['checked_out', 'completed'].includes(hotelStayStatus))
    : ['checked_in', 'completed'].includes(bookingStatus);
  if (!fulfilled) return null;
  if (!(await financeRepository.commissions.count({ bookingId: booking.id }))) {
    await commissionService.createCommission(booking, Boolean(booking.promoterAttribution), booking.pricing?.split);
  }
  const currency = booking.pricing?.currency || platformCurrency();
  const commissions = await financeRepository.commissions.list({ bookingId: booking.id, status: 'pending' });
  for (const commission of commissions) {
    await walletService.movePendingToAvailable('company', commission.companyId, currency, commission.companyAmount, {
      transactionType: 'company_earning_released', referenceType: 'booking', referenceId: booking.id,
    });
    if (commission.promoterId && commission.promoterAmount > 0) {
      await walletService.movePendingToAvailable('promoter', commission.promoterId, currency, commission.promoterAmount, {
        transactionType: 'promoter_commission_released', referenceType: 'booking', referenceId: booking.id,
      });
    }
    await ledgerService.updateTransactions({ referenceType: 'booking', referenceId: booking.id, status: 'pending' }, { status: 'completed' });
    Object.assign(commission, { status: 'released', releasedAt: new Date().toISOString() });
    await financeRepository.commissions.save(commission, { id: commission.id });
  }
  const now = new Date().toISOString();
  let bookingChanged = false;
  if (commissions.length && !booking.earningsReleasedAt) {
    booking.earningsReleasedAt = now;
    bookingChanged = true;
  }
  if (serviceType === 'hotel' && !['settled', 'refunded'].includes(String(booking.settlementStatus || '').trim().toLowerCase())) {
    booking.settlementStatus = 'eligible';
    booking.settledAt = null;
    bookingChanged = true;
  }
  if (bookingChanged) await financeRepository.bookings.save(booking, { bookingRef: booking.bookingRef });
  return commissions;
}

module.exports = { releaseCompletedBooking };
