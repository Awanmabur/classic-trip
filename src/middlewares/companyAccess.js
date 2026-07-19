function wantsJson(req) {
  return String(req.originalUrl || req.path || '').startsWith('/api/') || req.xhr || String(req.headers.accept || '').includes('application/json');
}

function forbidden(req, res, code, message) {
  if (wantsJson(req)) return res.status(403).json({ ok: false, code, message });
  return res.status(403).send(message);
}

function requireCompanyAccess(req, res, next) {
  const user = req.session?.user;
  if (!user) return res.redirect('/login');
  if (user.role === 'super_admin' || user.companyId || user.role === 'company_admin' || user.role === 'company_employee') return next();
  return forbidden(req, res, 'company_access_required', 'Company access is required.');
}

function enforceCompanyScope(req, res, next) {
  const user = req.session?.user || {};
  if (['super_admin', 'admin'].includes(user.role)) return next();
  const requested = req.body?.companyId || req.query?.companyId || req.params?.companyId;
  const isCompanyRole = ['company_admin', 'company_employee', 'partner'].includes(user.role);
  const scoped = user.companyId;
  if (!isCompanyRole) return next();
  if (!scoped) return forbidden(req, res, 'company_scope_missing', 'Your user is not attached to a company.');
  if (requested && String(requested) !== String(scoped)) {
    return forbidden(req, res, 'company_scope_denied', 'You cannot access another company workspace.');
  }
  req.body = req.body || {};
  req.body.companyId = scoped;
  return next();
}

const { normalizeCompanyType } = require('../utils/companyServiceType');

// Keyword-aware: a company record whose type was saved as free text ("Bus company",
// "Hotel / apartments") normalizes to the same canonical key ('bus', 'hotel') that listing
// forms submit, instead of becoming a literal "bus_company" that never matches anything.
function normalizeService(value) {
  return normalizeCompanyType(value);
}

function serviceMatches(actual, allowed = []) {
  const normalized = normalizeService(actual);
  const allowedSet = new Set(allowed.map(normalizeService));
  if (allowedSet.has(normalized)) return true;
  if (allowedSet.has('transport') && ['bus', 'train', 'flight', 'cargo', 'car_rental'].includes(normalized)) return true;
  return false;
}

function companyForUser(user = {}) {
  try {
    const store = require('../services/data/persistentStore');
    const companyId = user.companyId;
    return (store.state.companies || []).find((company) => String(company.id || company._id || company.slug) === String(companyId)) || {};
  } catch (error) {
    return {};
  }
}

function rowBelongsToCompany(row = {}, companyId) {
  if (!row || !companyId) return false;
  return String(row.companyId || row.ownerId || '') === String(companyId);
}

function ownedRequestServiceMatches(req, companyId, allowedServices) {
  if (!companyId) return false;
  try {
    const store = require('../services/data/persistentStore');
    const body = req.body || {};
    const query = req.query || {};
    const params = req.params || {};
    const path = String(req.path || req.originalUrl || '');

    const listingId = body.listingId || query.listingId || params.listingId || body.slug || query.slug || params.slug;
    const listing = listingId ? (store.state.listings || []).find((item) => (String(item.id) === String(listingId) || String(item.slug) === String(listingId)) && rowBelongsToCompany(item, companyId)) : null;
    if (listing && serviceMatches(listing.serviceType || listing.group || listing.type, allowedServices)) return true;

    const routeId = body.routeId || query.routeId || params.routeId;
    const route = routeId ? (store.state.routes || []).find((item) => String(item.id) === String(routeId) && rowBelongsToCompany(item, companyId)) : null;
    const routeListing = route ? (store.state.listings || []).find((item) => String(item.id) === String(route.listingId) && rowBelongsToCompany(item, companyId)) : null;
    if (routeListing && serviceMatches(routeListing.serviceType || routeListing.group || routeListing.type, allowedServices)) return true;

    const scheduleId = body.scheduleId || query.scheduleId || params.scheduleId || (path.includes('/company/schedules/') ? params.id : '');
    const schedule = scheduleId ? (store.state.schedules || []).find((item) => String(item.id) === String(scheduleId) && rowBelongsToCompany(item, companyId)) : null;
    const scheduleListing = schedule ? (store.state.listings || []).find((item) => String(item.id) === String(schedule.listingId) && rowBelongsToCompany(item, companyId)) : null;
    if (schedule && serviceMatches(schedule.serviceType || scheduleListing?.serviceType || scheduleListing?.group, allowedServices)) return true;

    const vehicleId = body.vehicleId || query.vehicleId || params.vehicleId;
    const vehicle = vehicleId ? (store.state.vehicles || []).find((item) => String(item.id) === String(vehicleId) && rowBelongsToCompany(item, companyId)) : null;
    if (vehicle && serviceMatches(vehicle.serviceType || vehicle.type, allowedServices)) return true;

    const bookingRef = body.bookingRef || query.bookingRef || params.bookingRef;
    const booking = bookingRef ? (store.state.bookings || []).find((item) => String(item.bookingRef) === String(bookingRef) && rowBelongsToCompany(item, companyId)) : null;
    if (booking && serviceMatches(booking.serviceType, allowedServices)) return true;

    const hotelIds = [
      body.propertyId, query.propertyId, params.propertyId,
      body.roomTypeId, query.roomTypeId, params.roomTypeId,
      body.roomUnitId, query.roomUnitId, params.roomUnitId,
      body.unitId, query.unitId, params.unitId,
      body.inventoryId, query.inventoryId, params.inventoryId,
      path.includes('/company/hotels/') ? params.id : '',
    ].filter(Boolean).map(String);
    if (hotelIds.length && serviceMatches('hotel', allowedServices)) {
      const hotelCollections = ['hotelProperties', 'roomTypes', 'roomUnits', 'roomNightInventories'];
      const ownsHotelEntity = hotelCollections.some((key) => (store.state[key] || []).some((item) => hotelIds.includes(String(item.id)) && rowBelongsToCompany(item, companyId)));
      if (ownsHotelEntity) return true;
    }
  } catch (error) {
    return false;
  }
  return false;
}

function requireCompanyOwnService(fieldName = 'serviceType') {
  return (req, res, next) => {
    const user = req.session?.user || {};
    if (['super_admin', 'admin'].includes(user.role)) return next();
    const company = companyForUser(user);
    const companyType = normalizeService(user.companyType || company.companyType || company.type || company.serviceType || '');
    if (!companyType) {
      return forbidden(req, res, 'company_service_missing', 'Your company account has no service type configured.');
    }
    req.body = req.body || {};
    const submitted = normalizeService(req.body[fieldName] || req.body.group || req.body.service || '');
    if (!submitted) {
      req.body[fieldName] = companyType;
      return next();
    }
    if (submitted === companyType) {
      req.body[fieldName] = companyType;
      return next();
    }
    return forbidden(
      req,
      res,
      'company_service_mismatch',
      `This company account can only create or edit ${companyType} service records.`
    );
  };
}

function requireCompanyService(...allowedServices) {
  return (req, res, next) => {
    const user = req.session?.user || {};
    if (['super_admin', 'admin'].includes(user.role)) return next();
    const company = companyForUser(user);
    const companyType = user.companyType || company.companyType || company.type || company.serviceType;
    if (serviceMatches(companyType, allowedServices)) return next();
    if (ownedRequestServiceMatches(req, user.companyId, allowedServices)) return next();
    return forbidden(
      req,
      res,
      'company_service_denied',
      `This action is only available for ${allowedServices.join(', ')} company accounts.`
    );
  };
}

module.exports = { requireCompanyAccess, enforceCompanyScope, requireCompanyService, requireCompanyOwnService };
