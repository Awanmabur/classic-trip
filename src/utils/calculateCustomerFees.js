'use strict';

const { getCachedPlatformConfig } = require('../services/platform/platformConfigService');

function money(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function calculateCustomerFees(subtotalValue, config = getCachedPlatformConfig()) {
  const subtotal = money(subtotalValue);
  const servicePercent = money(config.customerServiceFeePercent);
  const serviceFlat = money(config.customerServiceFeeFlat);
  const taxPercent = money(config.customerTaxPercent);
  const serviceFee = subtotal > 0 ? Math.round(serviceFlat + ((subtotal * servicePercent) / 100)) : 0;
  const taxAmount = subtotal > 0 ? Math.round((subtotal * taxPercent) / 100) : 0;
  return {
    serviceFee,
    taxAmount,
    totalFees: serviceFee + taxAmount,
    total: subtotal + serviceFee + taxAmount,
  };
}

module.exports = { calculateCustomerFees };
