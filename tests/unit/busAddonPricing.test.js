'use strict';

const { addonChargeMultiplier } = require('../../src/modules/bus/services/busBookingService');

describe('bus optional add-on charge basis', () => {
  test.each([
    ['per_booking', 3, 2, 1],
    ['per_passenger', 3, 2, 3],
    ['per_trip_leg', 3, 2, 2],
    ['per_passenger_per_leg', 3, 2, 6],
  ])('%s uses the correct multiplier', (basis, passengers, legs, expected) => {
    expect(addonChargeMultiplier(basis, passengers, legs)).toBe(expected);
  });

  test('invalid counts never produce a zero multiplier', () => {
    expect(addonChargeMultiplier('per_passenger_per_leg', 0, 0)).toBe(1);
  });
});
