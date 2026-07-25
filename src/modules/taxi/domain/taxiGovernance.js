'use strict';

const PLATFORM_MOBILITY_OWNER = 'platform';
const PLATFORM_MOBILITY_LISTING_SLUG = 'classic-trip-local-rides';
const MOBILITY_PARTNER_CATEGORIES = Object.freeze(['boda_rider', 'car_driver', 'fleet_owner', 'taxi_company']);
const INDIVIDUAL_DRIVER_CATEGORIES = Object.freeze(['boda_rider', 'car_driver']);
const FLEET_CATEGORIES = Object.freeze(['fleet_owner', 'taxi_company']);

function isSuperAdmin(actor = {}) {
  return String(actor.role || '') === 'super_admin';
}

function requireSuperAdmin(actor = {}, message = 'Only Super Admin may change platform ride configuration') {
  if (!isSuperAdmin(actor)) {
    const error = new Error(message);
    error.status = 403;
    error.code = 'platform_mobility_admin_required';
    throw error;
  }
}

function partnerCategory(company = {}) {
  return String(company.partnerCategory || company.settings?.partnerCategory || '').trim().toLowerCase();
}

function isMobilityPartner(company = {}) {
  return company.companyType === 'local_transport' && MOBILITY_PARTNER_CATEGORIES.includes(partnerCategory(company));
}

function canManageFleet(company = {}) {
  return FLEET_CATEGORIES.includes(partnerCategory(company));
}

function canManageOwnDriver(company = {}) {
  return INDIVIDUAL_DRIVER_CATEGORIES.includes(partnerCategory(company)) || canManageFleet(company);
}

module.exports = {
  PLATFORM_MOBILITY_OWNER,
  PLATFORM_MOBILITY_LISTING_SLUG,
  MOBILITY_PARTNER_CATEGORIES,
  INDIVIDUAL_DRIVER_CATEGORIES,
  FLEET_CATEGORIES,
  isSuperAdmin,
  requireSuperAdmin,
  partnerCategory,
  isMobilityPartner,
  canManageFleet,
  canManageOwnDriver,
};
