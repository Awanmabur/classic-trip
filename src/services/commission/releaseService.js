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
    if (commission.companyId && Number(commission.companyAmount || 0) > 0) {
      const existingCompanyRelease=await financeRepository.transactions.findOne({ ownerType:'company', ownerId:commission.companyId, transactionType:'company_earning_released', referenceType:'booking', referenceId:booking.id });
      if (!existingCompanyRelease) await walletService.movePendingToAvailable('company', commission.companyId, currency, commission.companyAmount, {
        transactionType: 'company_earning_released', referenceType: 'booking', referenceId: booking.id,
      });
    }
    if (commission.promoterId && commission.promoterAmount > 0) {
      const existingPromoterRelease=await financeRepository.transactions.findOne({ ownerType:'promoter', ownerId:commission.promoterId, transactionType:'promoter_commission_released', referenceType:'booking', referenceId:booking.id });
      if (!existingPromoterRelease) await walletService.movePendingToAvailable('promoter', commission.promoterId, currency, commission.promoterAmount, {
        transactionType: 'promoter_commission_released', referenceType: 'booking', referenceId: booking.id,
      });
    }
    await ledgerService.updateTransactions({ referenceType: 'booking', referenceId: booking.id, status: 'pending', ownerType: { $ne: 'flight_supplier' } }, { status: 'completed' });
    Object.assign(commission, { status: 'released', releasedAt: new Date().toISOString() });
    await financeRepository.commissions.save(commission, { id: commission.id });
  }
  const supplierPayable=Number(booking.pricing?.split?.supplierPayable || 0);
  let supplierReleased=false;
  if (serviceType === 'flight' && supplierPayable > 0 && !booking.supplierPayableReleasedAt) {
    const supplierId=booking.supplierId || 'platform-flight-supply';
    const existingSupplierRelease=await financeRepository.transactions.findOne({ ownerType:'flight_supplier', ownerId:supplierId, transactionType:'flight_supplier_payable_released', referenceType:'booking', referenceId:booking.id });
    if (!existingSupplierRelease) await walletService.movePendingToAvailable('flight_supplier', supplierId, currency, supplierPayable, {
      transactionType: 'flight_supplier_payable_released', referenceType: 'booking', referenceId: booking.id,
    });
    await ledgerService.updateTransactions({ referenceType: 'booking', referenceId: booking.id, status: 'pending', ownerType: 'flight_supplier' }, { status: 'completed' });
    supplierReleased=true;
  }
  const now = new Date().toISOString();
  let bookingChanged = false;
  if (commissions.length && !booking.earningsReleasedAt) {
    booking.earningsReleasedAt = now;
    bookingChanged = true;
  }
  if (supplierReleased) {
    booking.supplierPayableReleasedAt = now;
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
