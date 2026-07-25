'use strict';

const COUNTRY_CURRENCY = Object.freeze({
  Uganda: 'UGX',
  Kenya: 'KES',
  Rwanda: 'RWF',
  Tanzania: 'TZS',
  'South Sudan': 'SSP',
  'DR Congo': 'CDF',
  'Democratic Republic of the Congo': 'CDF',
  Burundi: 'BIF',
  Somalia: 'SOS',
});

const CURRENCY_LABELS = Object.freeze({
  UGX: 'UGX (USh)',
  KES: 'KES (KSh)',
  RWF: 'RWF',
  TZS: 'TZS (TSh)',
  SSP: 'SSP',
  CDF: 'CDF',
  BIF: 'BIF',
  SOS: 'SOS',
  USD: 'USD',
});

function normalizeCountry(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

const NORMALIZED = Object.freeze(Object.fromEntries(
  Object.entries(COUNTRY_CURRENCY).map(([country, currency]) => [normalizeCountry(country), currency])
));

function currencyForCountry(country, fallback = '') {
  return NORMALIZED[normalizeCountry(country)] || String(fallback || '').trim().toUpperCase();
}

function currencyLabel(code) {
  const normalized = String(code || '').trim().toUpperCase();
  return CURRENCY_LABELS[normalized] || normalized;
}

function countryCurrencyMap() {
  return { ...COUNTRY_CURRENCY };
}

module.exports = {
  COUNTRY_CURRENCY,
  CURRENCY_LABELS,
  currencyForCountry,
  currencyLabel,
  countryCurrencyMap,
};
