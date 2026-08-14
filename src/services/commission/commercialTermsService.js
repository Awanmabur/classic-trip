'use strict';

const crypto = require('crypto');
const { getCachedPlatformConfig } = require('../platform/platformConfigService');

const MODELS = new Set(['percentage_commission', 'fixed_per_unit']);
const UNIT_BASES = new Set(['per_booking', 'per_passenger', 'per_ticket', 'per_room', 'per_room_night', 'per_item']);
const ALLOCATION_MODELS = new Set(['none', 'fixed_amount', 'percentage_of_platform']);

function money(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100) / 100) : 0;
}
function percent(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : fallback;
}
function text(value, fallback = '') { return String(value == null ? fallback : value).trim(); }
function currency(value, fallback = '') {
  const code = text(value || fallback).toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : text(fallback).toUpperCase();
}

function platformDefaults(config = getCachedPlatformConfig()) {
  return {
    model: MODELS.has(config.commercialModel) ? config.commercialModel : 'percentage_commission',
    commissionPercent: percent(config.partnerCommissionPercent, 0),
    fixedAmount: money(config.fixedPlatformAmount),
    unitBasis: UNIT_BASES.has(config.fixedUnitBasis) ? config.fixedUnitBasis : 'per_booking',
    currency: currency(config.defaultCurrency, ''),
    promoterFunding: 'platform_commission',
    promoterRewardModel: ALLOCATION_MODELS.has(config.promoterRewardModel) ? config.promoterRewardModel : (money(config.promoterFixedUgx) > 0 ? 'fixed_amount' : 'none'),
    promoterFixedAmount: money(config.promoterFixedAmount ?? config.promoterFixedUgx),
    promoterSharePercent: percent(config.promoterSharePercent, 0),
    customerDiscountFunding: 'platform_commission',
    customerDiscountModel: ALLOCATION_MODELS.has(config.customerDiscountModel) ? config.customerDiscountModel : 'none',
    customerDiscountFixedAmount: money(config.customerDiscountFixedAmount),
    customerDiscountSharePercent: percent(config.customerDiscountSharePercent, 0),
    termsVersion: text(config.commercialTermsVersion, 'commercial-default'),
    source: 'platform_default',
  };
}

function normalizeTerms(input = {}, fallback = platformDefaults(), meta = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const base = fallback && typeof fallback === 'object' ? fallback : platformDefaults();
  const model = MODELS.has(text(source.model)) ? text(source.model) : base.model;
  const unitBasis = UNIT_BASES.has(text(source.unitBasis)) ? text(source.unitBasis) : base.unitBasis;
  const promoterRewardModel = ALLOCATION_MODELS.has(text(source.promoterRewardModel)) ? text(source.promoterRewardModel) : base.promoterRewardModel;
  const customerDiscountModel = ALLOCATION_MODELS.has(text(source.customerDiscountModel)) ? text(source.customerDiscountModel) : base.customerDiscountModel;
  return {
    model,
    commissionPercent: percent(source.commissionPercent, percent(base.commissionPercent, 0)),
    fixedAmount: money(source.fixedAmount ?? base.fixedAmount),
    unitBasis,
    currency: currency(source.currency, base.currency),
    promoterFunding: 'platform_commission',
    promoterRewardModel,
    promoterFixedAmount: money(source.promoterFixedAmount ?? source.promoterFixedUgx ?? base.promoterFixedAmount),
    promoterSharePercent: percent(source.promoterSharePercent, percent(base.promoterSharePercent, 0)),
    customerDiscountFunding: 'platform_commission',
    customerDiscountModel,
    customerDiscountFixedAmount: money(source.customerDiscountFixedAmount ?? base.customerDiscountFixedAmount),
    customerDiscountSharePercent: percent(source.customerDiscountSharePercent, percent(base.customerDiscountSharePercent, 0)),
    termsVersion: text(source.termsVersion || base.termsVersion || `commercial-${Date.now()}`),
    source: text(source.source || meta.source || base.source || 'platform_default'),
    scopeType: text(meta.scopeType || source.scopeType || base.scopeType || 'platform'),
    scopeId: text(meta.scopeId || source.scopeId || base.scopeId || ''),
    updatedAt: source.updatedAt || base.updatedAt || null,
    updatedBy: text(source.updatedBy || base.updatedBy || ''),
  };
}

function hasOverride(value) {
  return Boolean(value && typeof value === 'object' && (value.model || value.termsVersion || value.commissionPercent != null || value.fixedAmount != null));
}

function resolveTerms({ company = null, listing = null, fareProduct = null, roomType = null, platformConfig = null } = {}) {
  let terms = platformDefaults(platformConfig || getCachedPlatformConfig());
  if (hasOverride(company?.commercialTerms)) terms = normalizeTerms(company.commercialTerms, terms, { source: company.commercialTerms?.source || 'company_override', scopeType: 'company', scopeId: company.id });
  if (hasOverride(listing?.commercialTermsOverride)) terms = normalizeTerms(listing.commercialTermsOverride, terms, { source: 'listing_override', scopeType: 'listing', scopeId: listing.id });
  if (hasOverride(fareProduct?.commercialTermsOverride)) terms = normalizeTerms(fareProduct.commercialTermsOverride, terms, { source: 'fare_product_override', scopeType: 'fare_product', scopeId: fareProduct.id });
  if (hasOverride(roomType?.commercialTermsOverride)) terms = normalizeTerms(roomType.commercialTermsOverride, terms, { source: 'room_type_override', scopeType: 'room_type', scopeId: roomType.id });
  return terms;
}

function allocationAmount(model, fixedAmount, sharePercent, platformGross, cap) {
  if (model === 'fixed_amount') return Math.min(money(fixedAmount), cap);
  if (model === 'percentage_of_platform') return Math.min(money((platformGross * percent(sharePercent, 0)) / 100), cap);
  return 0;
}

function calculateCommercialSplit({ grossAmount = 0, units = 1, hasReferral = false, terms = {}, currency: bookingCurrency = '', customerServiceFee = 0, customerTaxAmount = 0 } = {}) {
  const gross = money(grossAmount);
  const normalized = normalizeTerms(terms, platformDefaults());
  const unitCount = Math.max(0, Number(units || 0));
  let platformGross = normalized.model === 'fixed_per_unit'
    ? money(normalized.fixedAmount * unitCount)
    : money((gross * normalized.commissionPercent) / 100);
  platformGross = Math.min(platformGross, gross);

  const discountAmount = allocationAmount(
    normalized.customerDiscountModel,
    normalized.customerDiscountFixedAmount,
    normalized.customerDiscountSharePercent,
    platformGross,
    platformGross,
  );
  const afterDiscount = Math.max(0, platformGross - discountAmount);
  const promoterAmount = hasReferral ? allocationAmount(
    normalized.promoterRewardModel,
    normalized.promoterFixedAmount,
    normalized.promoterSharePercent,
    platformGross,
    afterDiscount,
  ) : 0;
  const platformCommissionFee = money(Math.max(0, platformGross - discountAmount - promoterAmount));
  const companyAmount = money(Math.max(0, gross - platformGross));
  const customerFare = money(Math.max(0, gross - discountAmount));
  const serviceFee = money(customerServiceFee);
  const taxAmount = money(customerTaxAmount);
  const platformFee = money(platformCommissionFee + serviceFee + taxAmount);

  return {
    grossAmount: gross,
    commercialModel: normalized.model,
    unitBasis: normalized.unitBasis,
    units: unitCount,
    currency: currency(bookingCurrency, normalized.currency),
    termsVersion: normalized.termsVersion,
    termsSource: normalized.source,
    termsScopeType: normalized.scopeType,
    termsScopeId: normalized.scopeId,
    partnerCommissionPercent: normalized.model === 'percentage_commission' ? normalized.commissionPercent : (gross > 0 ? money((platformGross / gross) * 100) : 0),
    partnerPayoutPercent: gross > 0 ? money((companyAmount / gross) * 100) : 100,
    fixedPlatformAmount: normalized.model === 'fixed_per_unit' ? normalized.fixedAmount : 0,
    totalCommission: platformGross,
    platformGrossCommission: platformGross,
    customerDiscountModel: normalized.customerDiscountModel,
    customerDiscountFixedAmount: normalized.customerDiscountFixedAmount,
    customerDiscountSharePercent: normalized.customerDiscountSharePercent,
    discountAmount,
    promoterRewardModel: normalized.promoterRewardModel,
    promoterFixedAmount: normalized.promoterFixedAmount,
    promoterSharePercent: hasReferral && normalized.promoterRewardModel === 'percentage_of_platform' ? normalized.promoterSharePercent : 0,
    promoterEffectivePercent: gross > 0 ? money((promoterAmount / gross) * 100) : 0,
    promoterAmount,
    platformCommissionFee,
    customerServiceFee: serviceFee,
    customerTaxAmount: taxAmount,
    platformFee,
    platformNetPercent: gross > 0 ? money((platformCommissionFee / gross) * 100) : 0,
    companyAmount,
    partnerAmount: companyAmount,
    customerFare,
    customerTotal: money(customerFare + serviceFee + taxAmount),
  };
}


function unitsForBasis(basis, counts = {}) {
  const bookingCount = Math.max(1, Number(counts.bookingCount || 1));
  const passengerCount = Math.max(0, Number(counts.passengerCount || 0));
  const ticketCount = Math.max(0, Number(counts.ticketCount || 0));
  const roomCount = Math.max(0, Number(counts.roomCount || 0));
  const roomNightCount = Math.max(0, Number(counts.roomNightCount || 0));
  const itemCount = Math.max(0, Number(counts.itemCount || 0));
  if (basis === 'per_passenger') return passengerCount || ticketCount || itemCount || bookingCount;
  if (basis === 'per_ticket') return ticketCount || passengerCount || itemCount || bookingCount;
  if (basis === 'per_room') return roomCount || itemCount || bookingCount;
  if (basis === 'per_room_night') return roomNightCount || roomCount || itemCount || bookingCount;
  if (basis === 'per_item') return itemCount || ticketCount || roomCount || passengerCount || bookingCount;
  return bookingCount;
}

function calculateAgreementComponent({ grossAmount = 0, terms = {}, counts = {}, hasReferral = false, currency = '' } = {}) {
  const normalized = normalizeTerms(terms, platformDefaults());
  return calculateCommercialSplit({
    grossAmount,
    units: unitsForBasis(normalized.unitBasis, counts),
    hasReferral,
    terms: normalized,
    currency,
  });
}

function combineSplits(splits = [], { customerServiceFee = 0, customerTaxAmount = 0, currency: bookingCurrency = '' } = {}) {
  const rows = Array.isArray(splits) ? splits.filter(Boolean) : [];
  const sum = (field) => money(rows.reduce((total, row) => total + Number(row[field] || 0), 0));
  const gross = sum('grossAmount') || sum('customerFare') + sum('discountAmount');
  const platformGross = sum('platformGrossCommission');
  const discountAmount = sum('discountAmount');
  const promoterAmount = sum('promoterAmount');
  const companyAmount = sum('companyAmount');
  const platformCommissionFee = sum('platformCommissionFee');
  const serviceFee = money(customerServiceFee);
  const taxAmount = money(customerTaxAmount);
  return {
    grossAmount: gross,
    commercialModel: rows.length === 1 ? rows[0].commercialModel : 'mixed_agreement',
    unitBasis: rows.length === 1 ? rows[0].unitBasis : 'mixed',
    fixedPlatformAmount: rows.length === 1 ? Number(rows[0].fixedPlatformAmount || 0) : 0,
    promoterRewardModel: rows.length === 1 ? rows[0].promoterRewardModel : (rows.length ? 'mixed' : 'none'),
    promoterFixedAmount: rows.length === 1 ? Number(rows[0].promoterFixedAmount || 0) : 0,
    promoterSharePercent: rows.length === 1 ? Number(rows[0].promoterSharePercent || 0) : 0,
    customerDiscountModel: rows.length === 1 ? rows[0].customerDiscountModel : (rows.length ? 'mixed' : 'none'),
    customerDiscountFixedAmount: rows.length === 1 ? Number(rows[0].customerDiscountFixedAmount || 0) : 0,
    customerDiscountSharePercent: rows.length === 1 ? Number(rows[0].customerDiscountSharePercent || 0) : 0,
    units: rows.reduce((total, row) => total + Number(row.units || 0), 0),
    currency: currency(bookingCurrency, rows[0]?.currency || ''),
    termsVersion: rows.map((row) => row.termsVersion).filter(Boolean).join('|') || `commercial-${crypto.randomUUID()}`,
    termsSource: rows.length === 1 ? rows[0].termsSource : 'mixed_scope',
    partnerCommissionPercent: gross > 0 ? money((platformGross / gross) * 100) : 0,
    partnerPayoutPercent: gross > 0 ? money((companyAmount / gross) * 100) : 100,
    totalCommission: platformGross,
    platformGrossCommission: platformGross,
    discountAmount,
    promoterAmount,
    promoterEffectivePercent: gross > 0 ? money((promoterAmount / gross) * 100) : 0,
    platformCommissionFee,
    customerServiceFee: serviceFee,
    customerTaxAmount: taxAmount,
    platformFee: money(platformCommissionFee + serviceFee + taxAmount),
    platformNetPercent: gross > 0 ? money((platformCommissionFee / gross) * 100) : 0,
    companyAmount,
    partnerAmount: companyAmount,
    customerFare: money(gross - discountAmount),
    customerTotal: money(gross - discountAmount + serviceFee + taxAmount),
    components: rows,
  };
}

function snapshotTerms(terms = {}) {
  const normalized = normalizeTerms(terms, platformDefaults());
  return Object.freeze({ ...normalized });
}

module.exports = {
  MODELS,
  UNIT_BASES,
  ALLOCATION_MODELS,
  platformDefaults,
  normalizeTerms,
  resolveTerms,
  calculateCommercialSplit,
  calculateAgreementComponent,
  unitsForBasis,
  combineSplits,
  snapshotTerms,
};
