'use strict';

function normalize(value) {
  return String(value == null ? '' : value).trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function entityId(row = {}) {
  return String(row?.id == null ? '' : row.id).trim();
}

function sameId(left, right) {
  const a = typeof left === 'object' && left ? entityId(left) : String(left == null ? '' : left).trim();
  const b = typeof right === 'object' && right ? entityId(right) : String(right == null ? '' : right).trim();
  return Boolean(a && b && a === b);
}

function canonicalServiceType(listing = {}) {
  return normalize(listing.serviceType) || 'more';
}

function relatedSchedulesForListing(listing = {}, context = {}) {
  const listingId = entityId(listing);
  const companyId = String(listing.companyId || '').trim();
  if (!listingId || !companyId || !Array.isArray(context.schedules)) return [];
  return context.schedules.filter((schedule) => (
    String(schedule.companyId || '').trim() === companyId
    && String(schedule.listingId || '').trim() === listingId
  ));
}

const PUBLIC_DEPARTURE_STATES = new Set(['published', 'boarding', 'delayed']);

function hasPublishedDeparture(listing = {}, context = {}) {
  const now = Date.now();
  return relatedSchedulesForListing(listing, context).some((schedule) => {
    const status = normalize(schedule.status);
    if (!PUBLIC_DEPARTURE_STATES.has(status)) return false;
    const departAt = new Date(schedule.departAt || 0).getTime();
    const arriveAt = new Date(schedule.arriveAt || schedule.departAt || 0).getTime();
    if (status === 'published') return Number.isFinite(departAt) && departAt > now;
    return Number.isFinite(arriveAt) && arriveAt > now;
  });
}

function publicationState(listing = {}) {
  return [normalize(listing.status), normalize(listing.releaseStatus)].filter(Boolean);
}

function isPublicListing(listing, context = {}) {
  if (!listing) return false;
  if (normalize(listing.status) !== 'active') return false;
  if (normalize(listing.releaseStatus) !== 'published') return false;
  if (canonicalServiceType(listing) === 'bus') {
    return listing.bookable === true && hasPublishedDeparture(listing, context);
  }
  return listing.bookable !== false;
}

module.exports = {
  normalize,
  entityId,
  sameId,
  canonicalServiceType,
  publicationState,
  hasPublishedDeparture,
  relatedSchedulesForListing,
  isPublicListing,
};
