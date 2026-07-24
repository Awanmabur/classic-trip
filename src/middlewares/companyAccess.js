const { canonicalRole } = require('../config/accessControl');
const { employeeMembershipFresh } = require('./permissions');
const companyRepository = require('../repositories/domain/companyAccessRepository');
const { normalizeCompanyType } = require('../utils/companyServiceType');
const { evaluateDriverEligibility } = require('../services/company/driverEligibilityService');

function wantsJson(req) {
  return String(req.originalUrl || req.path || '').startsWith('/api/') || req.xhr || String(req.headers.accept || '').includes('application/json');
}

function forbidden(req, res, code, message) {
  if (wantsJson(req)) return res.status(403).json({ ok: false, code, message });
  return res.status(403).send(message);
}

function onboardingRestricted(req, res, code, message) {
  if (wantsJson(req)) return res.status(403).json({ ok: false, code, message });
  if (req.flash) req.flash('error', message);
  return res.redirect('/onboarding/status');
}

function normalizeService(value) { return normalizeCompanyType(value); }

function serviceMatches(actual, allowed = []) {
  const normalized = normalizeService(actual);
  const allowedSet = new Set(allowed.map(normalizeService));
  return Boolean(normalized) && allowedSet.has(normalized);
}

async function companyForUser(user = {}) {
  if (!user.companyId) return null;
  const company = await companyRepository.companies.findOne({ id: user.companyId });
  return company || null;
}

function companyIsActive(company = {}) {
  if (!company?.id) return false;
  const status = String(company.status || '').toLowerCase();
  const verification = String(company.verificationStatus || '').toLowerCase();
  return !['suspended', 'blocked', 'inactive'].includes(status) && verification !== 'suspended';
}

function companyIsOperational(company = {}) {
  return Boolean(company?.id)
    && String(company.status || '').toLowerCase() === 'active'
    && String(company.verificationStatus || '').toLowerCase() === 'verified';
}

async function requireCompanyAccess(req, res, next) {
  try {
    const user = req.session?.user;
    if (!user) return res.redirect('/login');
    const role = canonicalRole(user.role);
    if (['super_admin', 'admin'].includes(role)) return next();
    if (!['company_admin', 'company_employee', 'driver'].includes(role) || !user.companyId) return forbidden(req, res, 'company_access_required', 'Company access is required.');
    const company = await companyForUser(user);
    if (!companyIsActive(company)) return forbidden(req, res, 'company_inactive', 'This company workspace is not active.');
    if (['company_employee', 'driver'].includes(role)) {
      if (!companyIsOperational(company)) return onboardingRestricted(req, res, 'company_not_operational', 'Your company must be active and verified before staff operations are available.');
      const membership = await employeeMembershipFresh(user);
      if (!membership || String(membership.status || '').toLowerCase() !== 'active') return onboardingRestricted(req, res, 'employee_membership_inactive', 'Your staff or driver membership is still awaiting approval.');
    }
    req.company = company;
    return next();
  } catch (error) { return next(error); }
}

async function enforceCompanyScope(req, res, next) {
  try {
    const user = req.session?.user || {};
    const role = canonicalRole(user.role);
    if (['super_admin', 'admin'].includes(role)) return next();
    if (!['company_admin', 'company_employee', 'driver'].includes(role)) return next();
    const scoped = user.companyId;
    if (!scoped) return forbidden(req, res, 'company_scope_missing', 'Your user is not attached to a company.');
    const company = req.company || await companyForUser(user);
    if (!companyIsActive(company)) return forbidden(req, res, 'company_inactive', 'This company workspace is not active.');
    if (['company_employee', 'driver'].includes(role)) {
      if (!companyIsOperational(company)) return onboardingRestricted(req, res, 'company_not_operational', 'Your company must be active and verified before staff operations are available.');
      const membership = await employeeMembershipFresh(user);
      if (!membership || String(membership.status || '').toLowerCase() !== 'active') return onboardingRestricted(req, res, 'employee_membership_inactive', 'Your staff or driver membership is still awaiting approval.');
    }
    const requested = req.body?.companyId || req.query?.companyId || req.params?.companyId;
    if (requested && String(requested) !== String(scoped)) return forbidden(req, res, 'company_scope_denied', 'You cannot access another company workspace.');
    req.body = req.body || {};
    req.body.companyId = scoped;
    req.company = company;
    return next();
  } catch (error) { return next(error); }
}


async function requireVerifiedCompany(req, res, next) {
  try {
    const user = req.session?.user || {};
    const role = canonicalRole(user.role);
    if (['super_admin', 'admin'].includes(role)) return next();
    const company = req.company || await companyForUser(user);
    const verified = company && String(company.status || '').toLowerCase() === 'active'
      && String(company.verificationStatus || '').toLowerCase() === 'verified';
    if (!verified) {
      const message = 'Company verification must be approved before operational bookings, check-in, payment, or payout actions.';
      if (wantsJson(req)) return res.status(403).json({ ok: false, code: 'company_verification_required', message });
      if (req.flash) req.flash('error', message);
      return res.redirect(role === 'company_admin' ? '/company/profile#verification' : '/onboarding/status');
    }
    req.company = company;
    return next();
  } catch (error) { return next(error); }
}


async function requireOperationalDriver(req, res, next) {
  try {
    const user = req.session?.user || {};
    const role = canonicalRole(user.role);
    if (role === 'super_admin') return next();
    if (role !== 'driver') return forbidden(req, res, 'driver_role_required', 'A verified driver account is required.');
    const membership = await employeeMembershipFresh(user);
    const eligibility = evaluateDriverEligibility(membership || {}, user);
    if (!eligibility.eligible) {
      const message = `Driver onboarding is incomplete: ${eligibility.reasons.join('; ') || 'verification is required'}.`;
      return onboardingRestricted(req, res, 'driver_not_operational', message);
    }
    req.driverMembership = membership;
    req.driverEligibility = eligibility;
    return next();
  } catch (error) { return next(error); }
}

function rowBelongsToCompany(row = {}, companyId) {
  return Boolean(row && companyId && String(row.companyId || row.ownerId || '') === String(companyId));
}

async function ownedRequestServiceMatches(req, companyId, allowedServices) {
  if (!companyId) return false;
  const body = req.body || {};
  const query = req.query || {};
  const params = req.params || {};
  const path = String(req.path || req.originalUrl || '');

  const listingId = body.listingId || query.listingId || params.listingId || body.slug || query.slug || params.slug;
  const listing = listingId ? await companyRepository.listings.findOne({ companyId, $or: [{ id: String(listingId) }, { slug: String(listingId) }] }) : null;
  if (listing && serviceMatches(listing.serviceType || listing.group || listing.type, allowedServices)) return true;

  const routeId = body.routeId || query.routeId || params.routeId;
  const route = routeId ? await companyRepository.routes.findOne({ id: String(routeId), companyId }) : null;
  if (route) {
    const routeListing = await companyRepository.listings.findOne({ id: route.listingId, companyId });
    if (routeListing && serviceMatches(routeListing.serviceType || routeListing.group || routeListing.type, allowedServices)) return true;
  }

  const scheduleId = body.scheduleId || query.scheduleId || params.scheduleId || (path.includes('/company/schedules/') ? params.id : '');
  const schedule = scheduleId ? await companyRepository.schedules.findOne({ id: String(scheduleId), companyId }) : null;
  if (schedule) {
    const scheduleListing = schedule.listingId ? await companyRepository.listings.findOne({ id: schedule.listingId, companyId }) : null;
    if (serviceMatches(schedule.serviceType || scheduleListing?.serviceType || scheduleListing?.group, allowedServices)) return true;
  }

  const vehicleId = body.vehicleId || query.vehicleId || params.vehicleId;
  const vehicle = vehicleId ? await companyRepository.vehicles.findOne({ id: String(vehicleId), companyId }) : null;
  if (vehicle && serviceMatches(vehicle.serviceType || vehicle.type, allowedServices)) return true;

  const bookingRef = body.bookingRef || query.bookingRef || params.bookingRef;
  const booking = bookingRef ? await companyRepository.bookings.findOne({ bookingRef: String(bookingRef), companyId }) : null;
  if (booking && serviceMatches(booking.serviceType, allowedServices)) return true;

  const hotelIds = [body.propertyId, query.propertyId, params.propertyId, body.roomTypeId, query.roomTypeId, params.roomTypeId, body.roomUnitId, query.roomUnitId, params.roomUnitId, body.unitId, query.unitId, params.unitId, body.inventoryId, query.inventoryId, params.inventoryId, path.includes('/company/hotels/') ? params.id : ''].filter(Boolean).map(String);
  if (hotelIds.length && serviceMatches('hotel', allowedServices)) {
    for (const collection of ['hotelProperties', 'roomTypes', 'roomUnits', 'roomNightInventories']) {
      const found = await companyRepository[collection].findOne({ id: { $in: hotelIds }, companyId });
      if (found) return true;
    }
  }
  return false;
}

function requireCompanyOwnService(fieldName = 'serviceType') {
  return async (req, res, next) => {
    try {
      const user = req.session?.user || {};
      if (['super_admin', 'admin'].includes(canonicalRole(user.role))) return next();
      const company = req.company || await companyForUser(user);
      if (!companyIsActive(company)) return forbidden(req, res, 'company_inactive', 'This company workspace is not active.');
      const companyType = normalizeService(user.companyType || company.companyType || company.type || company.serviceType || '');
      if (!companyType) return forbidden(req, res, 'company_service_missing', 'Your company account has no service type configured.');
      req.body = req.body || {};
      const submitted = normalizeService(req.body[fieldName] || req.body.group || req.body.service || '');
      if (!submitted) { req.body[fieldName] = companyType; return next(); }
      if (submitted === companyType) { req.body[fieldName] = companyType; return next(); }
      return forbidden(req, res, 'company_service_mismatch', `This company account can only create or edit ${companyType} service records.`);
    } catch (error) { return next(error); }
  };
}

function requireCompanyService(...allowedServices) {
  return async (req, res, next) => {
    try {
      const user = req.session?.user || {};
      if (['super_admin', 'admin'].includes(canonicalRole(user.role))) return next();
      const company = req.company || await companyForUser(user);
      if (!companyIsActive(company)) return forbidden(req, res, 'company_inactive', 'This company workspace is not active.');
      const companyType = user.companyType || company.companyType || company.type || company.serviceType;
      if (serviceMatches(companyType, allowedServices)) return next();
      if (await ownedRequestServiceMatches(req, user.companyId, allowedServices)) return next();
      return forbidden(req, res, 'company_service_denied', `This action is only available for ${allowedServices.join(', ')} company accounts.`);
    } catch (error) { return next(error); }
  };
}

module.exports = { requireCompanyAccess, requireVerifiedCompany, requireOperationalDriver, enforceCompanyScope, requireCompanyService, requireCompanyOwnService, companyForUser, companyIsActive, companyIsOperational, serviceMatches };
