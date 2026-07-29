'use strict';

const { isPublicListing, hasPublishedDeparture } = require('../../src/services/marketplace/catalogVisibility');

function listing(overrides = {}) {
  return { id: 'listing-1', companyId: 'company-1', serviceType: 'bus', status: 'active', releaseStatus: 'published', bookable: true, ...overrides };
}

function departure(overrides = {}) {
  return { id: 'schedule-1', companyId: 'company-1', listingId: 'listing-1', status: 'published', departAt: new Date(Date.now() + 86400000).toISOString(), ...overrides };
}

test('published bus listing remains discoverable between dated departures', () => {
  expect(isPublicListing(listing(), { schedules: [] })).toBe(true);
  expect(isPublicListing(listing(), { schedules: [departure({ status: 'draft' })] })).toBe(true);
  expect(isPublicListing(listing(), { schedules: [departure({ departAt: new Date(Date.now() - 86400000).toISOString() })] })).toBe(true);
});

test('departure availability still requires exact company/listing ownership', () => {
  const valid = departure();
  expect(hasPublishedDeparture(listing(), { schedules: [valid] })).toBe(true);
  expect(isPublicListing(listing(), { schedules: [valid] })).toBe(true);
  expect(hasPublishedDeparture(listing(), { schedules: [departure({ companyId: 'company-2' })] })).toBe(false);
  expect(hasPublishedDeparture(listing(), { schedules: [departure({ listingId: 'listing-2' })] })).toBe(false);
});

test('draft listing remains private while published non-bookable listing remains discoverable', () => {
  expect(isPublicListing(listing({ status: 'draft' }), { schedules: [departure()] })).toBe(false);
  expect(isPublicListing(listing({ bookable: false }), { schedules: [departure()] })).toBe(true);
});
