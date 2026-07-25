'use strict';

const PLATFORM_FLIGHT_OWNER = 'platform';
const PLATFORM_FLIGHT_LISTING_SLUG = 'classic-trip-flights';
const FLIGHT_AGENT_CATEGORY = 'flight_agent';

function isSuperAdmin(actor = {}) {
  return String(actor.role || '') === 'super_admin';
}

function requireSuperAdmin(actor = {}, message = 'Only Super Admin may change airline and supplier inventory') {
  if (!isSuperAdmin(actor)) {
    const error = new Error(message);
    error.status = 403;
    error.code = 'platform_flight_admin_required';
    throw error;
  }
}

function isFlightAgent(company = {}) {
  return company.companyType === 'flight' && String(company.partnerCategory || company.settings?.partnerCategory || '') === FLIGHT_AGENT_CATEGORY;
}

module.exports = { PLATFORM_FLIGHT_OWNER, PLATFORM_FLIGHT_LISTING_SLUG, FLIGHT_AGENT_CATEGORY, isSuperAdmin, requireSuperAdmin, isFlightAgent };
