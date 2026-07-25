'use strict';
const { COUNTRY_MARKETS, normalizeCountry, currencyForCountry, timezoneForCountry } = require('../../src/config/countryMarkets');

describe('East Africa country market intelligence', () => {
  test('every supported market has a unique country, ISO currency and timezone', () => {
    expect(COUNTRY_MARKETS).toHaveLength(8);
    expect(new Set(COUNTRY_MARKETS.map((market) => market.name)).size).toBe(COUNTRY_MARKETS.length);
    COUNTRY_MARKETS.forEach((market) => {
      expect(market.currency).toMatch(/^[A-Z]{3}$/);
      expect(market.timezone).toContain('/');
    });
  });

  test.each([
    ['Uganda', 'Uganda', 'UGX', 'Africa/Kampala'],
    ['KE', 'Kenya', 'KES', 'Africa/Nairobi'],
    ['South Sudan', 'South Sudan', 'SSP', 'Africa/Juba'],
    ['DRC', 'DR Congo', 'CDF', 'Africa/Kinshasa'],
  ])('%s resolves to the correct market', (input, country, currency, timezone) => {
    expect(normalizeCountry(input)).toBe(country);
    expect(currencyForCountry(input)).toBe(currency);
    expect(timezoneForCountry(input)).toBe(timezone);
  });

  test('unsupported country input fails closed', () => {
    expect(normalizeCountry('Unknown market')).toBe('');
    expect(currencyForCountry('Unknown market')).toBe('');
  });
});
