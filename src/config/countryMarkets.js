'use strict';

const COUNTRY_MARKETS = Object.freeze([
  Object.freeze({ name: 'Uganda', code: 'UG', currency: 'UGX', callingCode: '+256', timezone: 'Africa/Kampala' }),
  Object.freeze({ name: 'Kenya', code: 'KE', currency: 'KES', callingCode: '+254', timezone: 'Africa/Nairobi' }),
  Object.freeze({ name: 'Rwanda', code: 'RW', currency: 'RWF', callingCode: '+250', timezone: 'Africa/Kigali' }),
  Object.freeze({ name: 'Tanzania', code: 'TZ', currency: 'TZS', callingCode: '+255', timezone: 'Africa/Dar_es_Salaam' }),
  Object.freeze({ name: 'South Sudan', code: 'SS', currency: 'SSP', callingCode: '+211', timezone: 'Africa/Juba' }),
  Object.freeze({ name: 'DR Congo', code: 'CD', currency: 'CDF', callingCode: '+243', timezone: 'Africa/Kinshasa' }),
  Object.freeze({ name: 'Burundi', code: 'BI', currency: 'BIF', callingCode: '+257', timezone: 'Africa/Bujumbura' }),
  Object.freeze({ name: 'Somalia', code: 'SO', currency: 'SOS', callingCode: '+252', timezone: 'Africa/Mogadishu' }),
]);

const ALIASES = Object.freeze({
  ug: 'Uganda', uganda: 'Uganda',
  ke: 'Kenya', kenya: 'Kenya',
  rw: 'Rwanda', rwanda: 'Rwanda',
  tz: 'Tanzania', tanzania: 'Tanzania',
  ss: 'South Sudan', southsudan: 'South Sudan', south_sudan: 'South Sudan',
  cd: 'DR Congo', drc: 'DR Congo', drcongo: 'DR Congo', dr_congo: 'DR Congo', democraticrepublicofthecongo: 'DR Congo', congo_kinshasa: 'DR Congo',
  bi: 'Burundi', burundi: 'Burundi',
  so: 'Somalia', somalia: 'Somalia',
});

function key(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function marketForCountry(value = '') {
  const normalized = key(value);
  const alias = ALIASES[normalized] || ALIASES[normalized.replace(/_/g, '')] || '';
  return COUNTRY_MARKETS.find((market) => market.name === alias || key(market.name) === normalized || market.code.toLowerCase() === normalized) || null;
}

function normalizeCountry(value = '') {
  return marketForCountry(value)?.name || '';
}

function currencyForCountry(value = '') {
  return marketForCountry(value)?.currency || '';
}

function timezoneForCountry(value = '') {
  return marketForCountry(value)?.timezone || '';
}

function publicMarkets() {
  return COUNTRY_MARKETS.map((market) => ({ ...market }));
}

module.exports = { COUNTRY_MARKETS, marketForCountry, normalizeCountry, currencyForCountry, timezoneForCountry, publicMarkets };
