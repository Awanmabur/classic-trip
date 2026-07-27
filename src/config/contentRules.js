'use strict';

const LISTING_DESCRIPTION_MIN_LENGTH = 125;
const LISTING_DESCRIPTION_MAX_LENGTH = 2000;

function normalizePublicDescription(value = '') {
  return String(value || '').replace(/<[^>]*>/g, '').trim().replace(/\s+/g, ' ').slice(0, LISTING_DESCRIPTION_MAX_LENGTH);
}

function assertPublicDescription(value, errorFactory = (message) => Object.assign(new Error(message), { status: 422 })) {
  const description = normalizePublicDescription(value);
  if (description.length < LISTING_DESCRIPTION_MIN_LENGTH) {
    throw errorFactory(`Public description must contain at least ${LISTING_DESCRIPTION_MIN_LENGTH} characters so customers receive a useful three-line summary.`);
  }
  return description;
}

module.exports = {
  LISTING_DESCRIPTION_MIN_LENGTH,
  LISTING_DESCRIPTION_MAX_LENGTH,
  normalizePublicDescription,
  assertPublicDescription,
};
