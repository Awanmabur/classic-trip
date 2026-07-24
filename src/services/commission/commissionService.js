const calculateCommission = require('../../utils/calculateCommission');
const financeRepository = require('../../repositories/domain/financeRepository');
const { nextId } = require('../data/idService');

async function createCommission(booking, hasValidReferral, existingSplit = null, options = {}) {
  const duplicate = await financeRepository.commissions.findOne({ bookingId: booking.id }, options);
  if (duplicate) return duplicate;
  const split = existingSplit || calculateCommission(booking.pricing.total, hasValidReferral, { commissionPercent: booking.commercialTermsSnapshot?.commissionPercent });
  const commission = {
    id: await nextId('commission'),
    bookingId: booking.id,
    bookingRef: booking.bookingRef,
    promoterId: booking.promoterAttribution?.promoterId || null,
    companyId: booking.companyId,
    commercialModel: 'percentage_commission',
    partnerCommissionPercent: split.partnerCommissionPercent,
    partnerPayoutPercent: split.partnerPayoutPercent,
    promoterSharePercent: split.promoterSharePercent,
    totalCommission: split.totalCommission,
    platformFee: split.platformFee,
    promoterAmount: split.promoterAmount,
    companyAmount: split.companyAmount,
    status: 'pending',
    releasedAt: null,
    createdAt: new Date().toISOString(),
  };
  await financeRepository.commissions.save(commission, { bookingId: booking.id }, options);
  return commission;
}

module.exports = { createCommission, calculateCommission };
