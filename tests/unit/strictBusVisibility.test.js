'use strict';

const { isPublicListing, hasPublishedDeparture } = require('../../src/services/marketplace/catalogVisibility');

function listing(overrides = {}) {
  return { id: 'listing-1', companyId: 'company-1', serviceType: 'bus', status: 'active', releaseStatus: 'published', bookable: true, ...overrides };
}

function departure(overrides = {}) {
  return { id: 'schedule-1', companyId: 'company-1', listingId: 'listing-1', status: 'published', departAt: new Date(Date.now() + 86400000).toISOString(), ...overrides };
}

test('bus is private without an exact future published departure', () => {
  expect(isPublicListing(listing(), { schedules: [] })).toBe(false);
  expect(isPublicListing(listing(), { schedules: [departure({ status: 'draft' })] })).toBe(false);
  expect(isPublicListing(listing(), { schedules: [departure({ departAt: new Date(Date.now() - 86400000).toISOString() })] })).toBe(false);
});

test('bus becomes public only with exact company/listing ownership', () => {
  const valid = departure();
  expect(hasPublishedDeparture(listing(), { schedules: [valid] })).toBe(true);
  expect(isPublicListing(listing(), { schedules: [valid] })).toBe(true);
  expect(isPublicListing(listing(), { schedules: [departure({ companyId: 'company-2' })] })).toBe(false);
  expect(isPublicListing(listing(), { schedules: [departure({ listingId: 'listing-2' })] })).toBe(false);
});

test('draft or non-bookable listing remains private', () => {
  expect(isPublicListing(listing({ status: 'draft' }), { schedules: [departure()] })).toBe(false);
  expect(isPublicListing(listing({ bookable: false }), { schedules: [departure()] })).toBe(false);
});
