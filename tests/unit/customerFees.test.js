'use strict';

const { calculateCustomerFees } = require('../../src/utils/calculateCustomerFees');

test('customer fees default to zero and do not invent charges', () => {
  expect(calculateCustomerFees(100000, {
    customerServiceFeePercent: 0,
    customerServiceFeeFlat: 0,
    customerTaxPercent: 0,
  })).toEqual({ serviceFee: 0, taxAmount: 0, totalFees: 0, total: 100000 });
});

test('central settings apply percentage, flat, and tax fees once', () => {
  expect(calculateCustomerFees(100000, {
    customerServiceFeePercent: 2,
    customerServiceFeeFlat: 1000,
    customerTaxPercent: 5,
  })).toEqual({ serviceFee: 3000, taxAmount: 5000, totalFees: 8000, total: 108000 });
});
