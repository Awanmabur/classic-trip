const calculateCommission = require('../../utils/calculateCommission');
const financeRepository = require('../../repositories/domain/financeRepository');
const { nextId } = require('../data/idService');

function settlementCompanyId(booking = {}) {
  const serviceType = String(booking.serviceType || '').trim().toLowerCase();
  if (serviceType === 'flight') return String(booking.agentCompanyId || '').trim();
  if (serviceType === 'local_transport') return String(booking.providerCompanyId || '').trim();
  return String(booking.companyId || '').trim();
}

async function createCommission(booking, hasValidReferral, existingSplit = null, options = {}) {
  const companyId = settlementCompanyId(booking);
  const duplicate = await financeRepository.commissions.findOne({ bookingId: booking.id }, options);
  if (duplicate) {
    // Taxi partners are assigned after payment. Persist the verified recipient as soon
    // as dispatch is accepted without creating a second commission record.
    if (companyId && String(duplicate.companyId || '') !== companyId) {
      duplicate.companyId = companyId;
      duplicate.updatedAt = new Date().toISOString();
      await financeRepository.commissions.save(duplicate, { bookingId: booking.id }, options);
    }
    return duplicate;
  }
  const split = existingSplit || calculateCommission(booking.pricing.total, hasValidReferral, { commissionPercent: booking.commercialTermsSnapshot?.commissionPercent });
  const commission = {
    id: await nextId('commission'),
    bookingId: booking.id,
    bookingRef: booking.bookingRef,
    promoterId: booking.promoterAttribution?.promoterId || null,
    companyId: companyId || null,
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

module.exports = { createCommission, calculateCommission, settlementCompanyId };
