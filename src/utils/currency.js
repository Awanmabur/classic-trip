'use strict';

function cleanCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : '';
}

function platformCurrency() {
  // Lazy import avoids a model/config circular dependency during Mongoose boot.
  const { getCachedPlatformConfig, SYSTEM_DEFAULTS } = require('../services/platform/platformConfigService');
  return cleanCode(getCachedPlatformConfig().defaultCurrency) || cleanCode(SYSTEM_DEFAULTS.defaultCurrency);
}

function supportedCurrencies() {
  const { getCachedPlatformConfig } = require('../services/platform/platformConfigService');
  const values = Array.isArray(getCachedPlatformConfig().supportedCurrencies)
    ? getCachedPlatformConfig().supportedCurrencies.map(cleanCode).filter(Boolean)
    : [];
  return [...new Set(values.length ? values : [platformCurrency()])];
}

function resolveCurrency(...values) {
  for (const value of values) {
    const code = cleanCode(value);
    if (code) return code;
  }
  return platformCurrency();
}

function requireCurrency(value, label = 'Currency') {
  const code = cleanCode(value);
  if (!code) {
    const error = new Error(`${label} must be a valid three-letter ISO currency code`);
    error.status = 422;
    error.code = 'invalid_currency';
    throw error;
  }
  const supported = supportedCurrencies();
  if (!supported.includes(code)) {
    const error = new Error(`${label} ${code} is not enabled in Platform Settings`);
    error.status = 422;
    error.code = 'unsupported_currency';
    throw error;
  }
  return code;
}

module.exports = { cleanCode, platformCurrency, supportedCurrencies, resolveCurrency, requireCurrency };
