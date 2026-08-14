const commercialTermsService = require('./commercialTermsService');
const financeRepository = require('../../repositories/domain/financeRepository');
const { nextId } = require('../data/idService');

function settlementCompanyId(booking = {}) {
  const serviceType = String(booking.serviceType || '').trim().toLowerCase();
  if (serviceType === 'flight') return String(booking.agentCompanyId || '').trim();
  if (serviceType === 'local_transport') return String(booking.providerCompanyId || '').trim();
  return String(booking.companyId || '').trim();
}


function fallbackSplitForBooking(booking = {}, hasValidReferral = false) {
  const pricing = booking.pricing || {};
  const snapshot = booking.commercialTermsSnapshot || {};
  const components = Array.isArray(snapshot.components) ? snapshot.components : [];
  if (components.length) {
    const rows = components.map((component) => commercialTermsService.calculateCommercialSplit({
      grossAmount: Number(component.grossAmount || 0),
      units: Number(component.units || 1),
      hasReferral: hasValidReferral,
      terms: {
        model: component.commercialModel,
        commissionPercent: component.partnerCommissionPercent,
        fixedAmount: component.fixedPlatformAmount,
        unitBasis: component.unitBasis,
        promoterRewardModel: component.promoterRewardModel,
        promoterFixedAmount: component.promoterFixedAmount,
        promoterSharePercent: component.promoterSharePercent,
        customerDiscountModel: component.customerDiscountModel,
        customerDiscountFixedAmount: component.customerDiscountFixedAmount,
        customerDiscountSharePercent: component.customerDiscountSharePercent,
        termsVersion: component.termsVersion,
        source: component.termsSource,
        scopeType: component.termsScopeType,
        scopeId: component.termsScopeId,
        currency: pricing.currency,
      },
      currency: pricing.currency,
    }));
    return commercialTermsService.combineSplits(rows, {
      customerServiceFee: Number(pricing.serviceFee || 0),
      customerTaxAmount: Number(pricing.taxAmount || 0),
      currency: pricing.currency,
    });
  }
  const grossAmount = Number(pricing.commissionableSubtotal ?? pricing.partnerFareSubtotal ?? pricing.subtotal ?? pricing.total ?? 0);
  const base = commercialTermsService.calculateAgreementComponent({
    grossAmount,
    terms: snapshot,
    counts: { bookingCount: 1, passengerCount: Number(booking.quantity || 1), ticketCount: booking.serviceType === 'bus' ? Number(booking.quantity || 1) : 0, roomCount: Number(booking.hotelStay?.roomCount || 0), roomNightCount: Number(booking.hotelStay?.roomCount || 0) * Number(booking.hotelStay?.nights?.length || 0), itemCount: Number(booking.quantity || 1) },
    hasReferral: hasValidReferral,
    currency: pricing.currency,
  });
  return { ...base, customerServiceFee: Number(pricing.serviceFee || 0), customerTaxAmount: Number(pricing.taxAmount || 0), platformFee: Number(base.platformCommissionFee || 0) + Number(pricing.serviceFee || 0) + Number(pricing.taxAmount || 0) };
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
  const split = existingSplit || fallbackSplitForBooking(booking, hasValidReferral);
  const commission = {
    id: await nextId('commission'),
    bookingId: booking.id,
    bookingRef: booking.bookingRef,
    promoterId: booking.promoterAttribution?.promoterId || null,
    companyId: companyId || null,
    commercialModel: split.commercialModel || booking.commercialTermsSnapshot?.model || 'percentage_commission',
    partnerCommissionPercent: split.partnerCommissionPercent,
    partnerPayoutPercent: split.partnerPayoutPercent,
    promoterSharePercent: split.promoterSharePercent,
    fixedPlatformAmount: Number(split.fixedPlatformAmount || 0),
    unitBasis: split.unitBasis || booking.commercialTermsSnapshot?.unitBasis || 'per_booking',
    termsVersion: split.termsVersion || booking.commercialTermsSnapshot?.termsVersion || '',
    termsSource: split.termsSource || booking.commercialTermsSnapshot?.source || '',
    promoterRewardModel: split.promoterRewardModel || 'none',
    promoterFixedAmount: Number(split.promoterFixedAmount || 0),
    discountAmount: Number(split.discountAmount || 0),
    customerDiscountModel: split.customerDiscountModel || booking.commercialTermsSnapshot?.customerDiscountModel || 'none',
    customerDiscountFixedAmount: Number(split.customerDiscountFixedAmount || 0),
    customerDiscountSharePercent: Number(split.customerDiscountSharePercent || 0),
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

module.exports = { createCommission, fallbackSplitForBooking, settlementCompanyId };
