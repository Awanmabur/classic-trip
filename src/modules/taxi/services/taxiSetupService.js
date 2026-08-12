'use strict';

const repo = require('../repositories/taxiRepository');
const sensitive = require('../../../services/security/sensitiveFieldService');
const { platformCurrency } = require('../../../utils/currency');
const {
  cleanText,
  normalize,
  numberValue,
  integerValue,
  boolValue,
  parseList,
  validationError,
  actorId,
  requireEnum,
} = require('../domain/taxiDomain');
const {
  PLATFORM_MOBILITY_OWNER,
  PLATFORM_MOBILITY_LISTING_SLUG,
  requireSuperAdmin,
  isMobilityPartner,
  canManageFleet,
  canManageOwnDriver,
  partnerCategory,
} = require('../domain/taxiGovernance');

const SERVICE_TYPES = ['instant', 'scheduled', 'airport', 'intercity', 'hourly', 'corporate'];
function now() { return new Date(); }

async function company(companyId) {
  const row = await repo.companies.findOne({ id: cleanText(companyId, 180) });
  if (!row) throw validationError('Mobility partner account was not found', 404);
  if (!isMobilityPartner(row)) throw validationError('This account is not an approved local mobility partner', 403);
  return row;
}

async function platformListing(options = {}) {
  let row = await repo.listings.findOne({ companyId: PLATFORM_MOBILITY_OWNER, serviceType: 'local_transport' }, options);
  if (!row) throw validationError('Local rides have not been configured by Super Admin', 503, 'mobility_not_configured');
  return row;
}

async function createVehicleClass(payload, actor = {}) {
  requireSuperAdmin(actor);
  const row = {
    id: await repo.nextId('vehicle-class'),
    companyId: PLATFORM_MOBILITY_OWNER,
    key: normalize(payload.key || payload.name),
    name: cleanText(payload.name, 120),
    description: cleanText(payload.description, 1000),
    passengerCapacity: integerValue(payload.passengerCapacity, 'Passenger capacity', 1, 80),
    luggageCapacity: integerValue(payload.luggageCapacity, 'Luggage capacity', 0, 100, 0),
    serviceTypes: parseList(payload.serviceTypes || SERVICE_TYPES).map(normalize).filter((value) => SERVICE_TYPES.includes(value)),
    icon: cleanText(payload.icon, 80),
    sortOrder: integerValue(payload.sortOrder, 'Sort order', 0, 1000, 0),
    status: requireEnum(payload.status || 'active', ['active', 'paused', 'archived'], 'Vehicle class status'),
    createdAt: now(), updatedAt: now(),
  };
  if (!row.name || !row.key) throw validationError('Ride class name is required');
  await repo.vehicleClasses.save(row, { companyId: row.companyId, key: row.key, status: { $ne: 'archived' } });
  await repo.audit({ actorId: actorId(actor), action: 'mobility.platform.vehicle_class.saved', targetType: 'vehicle_class', targetId: row.id, companyId: PLATFORM_MOBILITY_OWNER });
  return row;
}

async function createZone(payload, actor = {}) {
  requireSuperAdmin(actor);
  const zoneType = requireEnum(payload.zoneType, ['city', 'district', 'airport', 'intercity_corridor', 'national', 'custom_polygon', 'radius'], 'Zone type');
  let polygon = [];
  if (payload.polygonJson) {
    try { polygon = JSON.parse(payload.polygonJson); } catch (_) { throw validationError('Zone polygon JSON is invalid'); }
  }
  const row = {
    id: await repo.nextId('taxi-zone'), companyId: PLATFORM_MOBILITY_OWNER,
    name: cleanText(payload.name, 160), country: cleanText(payload.country, 100),
    countryCode: cleanText(payload.countryCode, 3).toUpperCase(), city: cleanText(payload.city, 100), district: cleanText(payload.district, 100),
    zoneType,
    center: { latitude: numberValue(payload.latitude, 'Center latitude', -90, 90, 0), longitude: numberValue(payload.longitude, 'Center longitude', -180, 180, 0) },
    radiusKm: numberValue(payload.radiusKm, 'Radius', 0, 5000, 0), polygon: Array.isArray(polygon) ? polygon : [],
    airportId: cleanText(payload.airportId, 180),
    supportedServiceTypes: parseList(payload.supportedServiceTypes || SERVICE_TYPES).map(normalize).filter((value) => SERVICE_TYPES.includes(value)),
    status: requireEnum(payload.status || 'active', ['active', 'paused', 'archived'], 'Zone status'),
    createdAt: now(), updatedAt: now(),
  };
  if (!row.name || !row.country || !row.countryCode) throw validationError('Zone name, country and country code are required');
  if (zoneType === 'airport' && !row.airportId) throw validationError('Airport zones require an airport');
  await repo.zones.save(row, { companyId: row.companyId, name: row.name, status: { $ne: 'archived' } });
  await repo.audit({ actorId: actorId(actor), action: 'mobility.platform.zone.saved', targetType: 'taxi_zone', targetId: row.id, companyId: PLATFORM_MOBILITY_OWNER });
  return row;
}

async function createFareRule(payload, actor = {}) {
  requireSuperAdmin(actor);
  const klass = await repo.oneOrThrow(repo.vehicleClasses, { id: cleanText(payload.vehicleClassId, 180), companyId: PLATFORM_MOBILITY_OWNER, status: 'active' }, 'Active platform ride class not found');
  const zoneId = cleanText(payload.serviceZoneId, 180);
  if (zoneId) await repo.oneOrThrow(repo.zones, { id: zoneId, companyId: PLATFORM_MOBILITY_OWNER, status: 'active' }, 'Active platform service zone not found');
  const serviceType = requireEnum(payload.serviceType, SERVICE_TYPES, 'Ride service type');
  const row = {
    id: await repo.nextId('taxi-fare-rule'), companyId: PLATFORM_MOBILITY_OWNER,
    vehicleClassId: klass.id, serviceZoneId: zoneId, serviceType,
    currency: cleanText(payload.currency || platformCurrency(), 3).toUpperCase(),
    baseFare: numberValue(payload.baseFare, 'Base fare', 0, 1e12),
    perKilometer: numberValue(payload.perKilometer, 'Per-kilometre fare', 0, 1e12),
    perMinute: numberValue(payload.perMinute, 'Per-minute fare', 0, 1e12),
    minimumFare: numberValue(payload.minimumFare, 'Minimum fare', 0, 1e12),
    bookingFee: numberValue(payload.bookingFee, 'Booking fee', 0, 1e12, 0),
    airportFee: numberValue(payload.airportFee, 'Airport fee', 0, 1e12, 0),
    scheduledFee: numberValue(payload.scheduledFee, 'Scheduled fee', 0, 1e12, 0),
    intercityMinimumKm: numberValue(payload.intercityMinimumKm, 'Intercity threshold', 0, 5000, 0),
    waitingPerMinute: numberValue(payload.waitingPerMinute, 'Waiting fee', 0, 1e12, 0),
    cancellationFee: numberValue(payload.cancellationFee, 'Cancellation fee', 0, 1e12, 0),
    noShowFee: numberValue(payload.noShowFee, 'No-show fee', 0, 1e12, 0),
    nightMultiplier: numberValue(payload.nightMultiplier, 'Night multiplier', 1, 10, 1),
    surgeMin: numberValue(payload.surgeMin, 'Minimum demand multiplier', 1, 10, 1),
    surgeMax: numberValue(payload.surgeMax, 'Maximum demand multiplier', 1, 10, 1),
    taxPercent: numberValue(payload.taxPercent, 'Tax percent', 0, 100, 0),
    status: requireEnum(payload.status || 'active', ['active', 'paused', 'archived'], 'Fare status'),
    createdAt: now(), updatedAt: now(),
  };
  if (row.surgeMax < row.surgeMin) throw validationError('Maximum demand multiplier cannot be below the minimum');
  await repo.fareRules.save(row, { companyId: row.companyId, vehicleClassId: row.vehicleClassId, serviceZoneId: row.serviceZoneId, serviceType: row.serviceType, status: { $ne: 'archived' } });
  await repo.audit({ actorId: actorId(actor), action: 'mobility.platform.fare_rule.saved', targetType: 'taxi_fare_rule', targetId: row.id, companyId: PLATFORM_MOBILITY_OWNER });
  return row;
}

async function createPlatformListing(payload, actor = {}) {
  requireSuperAdmin(actor);
  const existing = await repo.listings.findOne({ companyId: PLATFORM_MOBILITY_OWNER, serviceType: 'local_transport' });
  const row = existing || { id: await repo.nextId('listing'), createdAt: now() };
  Object.assign(row, {
    companyId: PLATFORM_MOBILITY_OWNER,
    companySlug: 'classic-trip', companyName: 'Classic Trip',
    serviceType: 'local_transport', group: 'local_transport', type: 'local_transport', listingKind: 'platform_ride_marketplace',
    title: cleanText(payload.title || 'Boda and car rides', 180), slug: PLATFORM_MOBILITY_LISTING_SLUG,
    shortDescription: cleanText(payload.shortDescription || payload.description || 'Safe local boda and car rides with verified drivers, upfront pricing and platform dispatch.', 1000),
    country: cleanText(payload.country || 'East Africa', 120), city: cleanText(payload.city || '', 120),
    priceFrom: numberValue(payload.priceFrom, 'Starting price', 0, 1e12, 0), currency: cleanText(payload.currency || platformCurrency(), 3).toUpperCase(),
    amenities: parseList(payload.amenities || ['Verified drivers', 'Upfront fare', 'Pickup PIN', 'Live ride status']),
    serviceNotes: cleanText(payload.serviceNotes, 2000), contactPhone: cleanText(payload.contactPhone, 60),
    bookable: true, releaseStatus: 'published', status: 'active', publication: { public: true, state: 'published', lastStatusChangeAt: now() }, updatedAt: now(),
  });
  await repo.listings.save(row, { id: row.id });
  await repo.audit({ actorId: actorId(actor), action: 'mobility.platform.listing.saved', targetType: 'listing', targetId: row.id, companyId: PLATFORM_MOBILITY_OWNER });
  return row;
}

async function createVehicle(payload, actor = {}) {
  const partner = await company(actor.companyId);
  const klass = await repo.oneOrThrow(repo.vehicleClasses, { id: cleanText(payload.vehicleClassId, 180), companyId: PLATFORM_MOBILITY_OWNER, status: 'active' }, 'Select an active platform ride class');
  const row = {
    id: await repo.nextId('taxi-vehicle'), companyId: partner.id, vehicleClassId: klass.id,
    registrationNumber: cleanText(payload.registrationNumber, 32).toUpperCase(), make: cleanText(payload.make, 80), model: cleanText(payload.model, 80),
    year: integerValue(payload.year, 'Vehicle year', 1980, new Date().getFullYear() + 1), color: cleanText(payload.color, 40),
    passengerCapacity: integerValue(payload.passengerCapacity, 'Passenger capacity', 1, 80, klass.passengerCapacity),
    luggageCapacity: integerValue(payload.luggageCapacity, 'Luggage capacity', 0, 100, klass.luggageCapacity),
    inspectionExpiresAt: payload.inspectionExpiresAt ? new Date(payload.inspectionExpiresAt) : null,
    insuranceExpiresAt: payload.insuranceExpiresAt ? new Date(payload.insuranceExpiresAt) : null,
    registrationExpiresAt: payload.registrationExpiresAt ? new Date(payload.registrationExpiresAt) : null,
    verificationStatus: 'pending', operationalStatus: 'offline', createdAt: now(), updatedAt: now(),
  };
  if (!row.registrationNumber || !row.make || !row.model) throw validationError('Registration, make and model are required');
  await repo.vehicles.save(row, { companyId: row.companyId, registrationNumber: row.registrationNumber, operationalStatus: { $ne: 'archived' } });
  await repo.audit({ actorId: actorId(actor), action: 'mobility.partner.vehicle.submitted', targetType: 'taxi_vehicle', targetId: row.id, companyId: partner.id, metadata: { partnerCategory: partnerCategory(partner) } });
  return row;
}

async function updateVehicleStatus(id, payload, actor = {}) {
  const partner = await company(actor.companyId);
  const row = await repo.oneOrThrow(repo.vehicles, { id: cleanText(id, 180), companyId: partner.id }, 'Vehicle not found');
  if (payload.verificationStatus !== undefined) requireSuperAdmin(actor, 'Vehicle verification is controlled by Super Admin');
  if (payload.operationalStatus !== undefined) {
    const next = requireEnum(payload.operationalStatus, ['offline', 'available', 'maintenance', 'archived'], 'Vehicle status');
    if (next === 'available' && row.verificationStatus !== 'verified') throw validationError('Vehicle approval is required before going available');
    row.operationalStatus = next;
  }
  row.updatedAt = now(); await repo.vehicles.save(row, { id: row.id }); return row;
}

async function reviewVehicle(id, payload, actor = {}) {
  requireSuperAdmin(actor);
  const row = await repo.oneOrThrow(repo.vehicles, { id: cleanText(id, 180) }, 'Vehicle not found');
  row.verificationStatus = requireEnum(payload.verificationStatus, ['verified', 'rejected', 'expired'], 'Verification status');
  row.operationalStatus = row.verificationStatus === 'verified' ? 'offline' : 'suspended';
  row.reviewNotes = cleanText(payload.reviewNotes, 1000); row.reviewedBy = actorId(actor); row.reviewedAt = now(); row.updatedAt = now();
  await repo.vehicles.save(row, { id: row.id });
  await repo.audit({ actorId: actorId(actor), action: 'mobility.vehicle.reviewed', targetType: 'taxi_vehicle', targetId: row.id, companyId: row.companyId, metadata: { status: row.verificationStatus } });
  return row;
}

async function createDriverProfile(payload, actor = {}) {
  const partner = await company(actor.companyId);
  if (!canManageOwnDriver(partner)) throw validationError('This partner account cannot submit drivers', 403);
  const category = partnerCategory(partner);
  const individual = ['boda_rider', 'car_driver'].includes(category);
  const userId = cleanText(payload.userId || (individual ? actor.userId : ''), 180);
  let employee = null;
  if (!individual) employee = await repo.employees.findOne({ companyId: partner.id, $or: [{ userId }, { id: cleanText(payload.employeeId, 180) }] });
  if (!individual && !employee) throw validationError('Create or approve the driver staff membership first');
  if (!userId && !employee?.userId) throw validationError('Driver user account is required');
  const licenceNumber = cleanText(payload.licenceNumber, 120);
  const row = {
    id: await repo.nextId('taxi-driver'), companyId: partner.id, userId: employee?.userId || userId, employeeId: employee?.id || '',
    driverNumber: cleanText(payload.driverNumber || `${category}-${Date.now().toString().slice(-7)}`, 60),
    licenceNumberEncrypted: sensitive.encrypt(licenceNumber, `taxi-driver:${partner.id}`), licenceNumberLast4: licenceNumber.slice(-4),
    licenceClass: cleanText(payload.licenceClass, 40), licenceExpiresAt: payload.licenceExpiresAt ? new Date(payload.licenceExpiresAt) : null,
    identityVerified: false, backgroundCheckStatus: 'pending', safetyTrainingCompletedAt: null,
    assignedVehicleId: cleanText(payload.assignedVehicleId, 180), verificationStatus: 'pending', availabilityStatus: 'offline',
    createdAt: now(), updatedAt: now(),
  };
  if (!row.driverNumber || !row.licenceNumberLast4) throw validationError('Driver licence number is required');
  if (row.assignedVehicleId) await repo.oneOrThrow(repo.vehicles, { id: row.assignedVehicleId, companyId: partner.id }, 'Selected vehicle was not found');
  await repo.drivers.save(row, { companyId: row.companyId, userId: row.userId });
  await repo.availability.save({ id: await repo.nextId('driver-availability'), companyId: partner.id, driverProfileId: row.id, vehicleId: row.assignedVehicleId, status: 'offline', serviceZoneIds: [], serviceTypes: [], lastHeartbeatAt: null, version: 0, createdAt: now(), updatedAt: now() }, { driverProfileId: row.id });
  await repo.audit({ actorId: actorId(actor), action: 'mobility.partner.driver.submitted', targetType: 'taxi_driver', targetId: row.id, companyId: partner.id });
  return row;
}

async function verifyDriver(id, payload, actor = {}) {
  requireSuperAdmin(actor, 'Driver verification, background checks and safety training approval are controlled by Super Admin');
  const row = await repo.oneOrThrow(repo.drivers, { id: cleanText(id, 180) }, 'Driver not found');
  const decision = requireEnum(payload.verificationStatus || 'verified', ['verified', 'rejected', 'suspended', 'expired'], 'Verification decision');
  const reviewNotes = cleanText(payload.reviewNotes, 800);

  if (decision !== 'verified') {
    row.verificationStatus = decision;
    row.availabilityStatus = 'suspended';
    row.backgroundCheckStatus = decision === 'rejected' ? requireEnum(payload.backgroundCheckStatus || 'failed', ['clear', 'review', 'failed'], 'Background check status') : (row.backgroundCheckStatus || 'review');
    row.reviewNotes = reviewNotes;
    row.reviewedBy = actorId(actor);
    row.reviewedAt = now();
    row.updatedAt = now();
    await repo.drivers.save(row, { id: row.id });
    await repo.availability.updateOne({ driverProfileId: row.id }, { $set: { status: 'suspended', updatedAt: now() } });
    await repo.audit({ actorId: actorId(actor), action: `mobility.driver.${decision}`, targetType: 'taxi_driver', targetId: row.id, companyId: row.companyId, metadata: { reviewNotes } });
    return row;
  }

  const vehicle = await repo.oneOrThrow(repo.vehicles, { id: cleanText(payload.assignedVehicleId || row.assignedVehicleId, 180), companyId: row.companyId }, 'Select a verified vehicle before approving this driver');
  if (vehicle.verificationStatus !== 'verified') throw validationError('Assigned vehicle must be verified first');
  if (row.licenceExpiresAt && new Date(row.licenceExpiresAt) <= now()) throw validationError('Driver licence is expired');
  row.identityVerified = boolValue(payload.identityVerified, true);
  row.backgroundCheckStatus = requireEnum(payload.backgroundCheckStatus || 'clear', ['clear', 'review', 'failed'], 'Background check status');
  row.safetyTrainingCompletedAt = payload.safetyTrainingCompletedAt ? new Date(payload.safetyTrainingCompletedAt) : now();
  if (!row.identityVerified || row.backgroundCheckStatus !== 'clear' || !row.safetyTrainingCompletedAt) throw validationError('Identity, background check and safety training must all pass');
  row.assignedVehicleId = vehicle.id;
  row.verificationStatus = 'verified';
  row.availabilityStatus = 'offline';
  row.reviewNotes = reviewNotes;
  row.reviewedBy = actorId(actor);
  row.reviewedAt = now();
  row.updatedAt = now();
  await repo.drivers.save(row, { id: row.id });
  await repo.availability.updateOne({ driverProfileId: row.id }, { $set: { vehicleId: vehicle.id, status: 'offline', updatedAt: now() } });
  await repo.audit({ actorId: actorId(actor), action: 'mobility.driver.verified', targetType: 'taxi_driver', targetId: row.id, companyId: row.companyId, metadata: { reviewNotes } });
  return row;
}

async function reviewIncident(id, payload = {}, actor = {}) {
  requireSuperAdmin(actor, 'Only Super Admin may review mobility safety incidents');
  const incident = await repo.oneOrThrow(repo.incidents, { id: cleanText(id, 180) }, 'Mobility incident not found');
  const status = requireEnum(payload.status || incident.status || 'under_review', ['open', 'under_review', 'escalated', 'resolved', 'closed'], 'Incident status');
  const severity = payload.severity
    ? requireEnum(payload.severity, ['low', 'medium', 'high', 'critical'], 'Incident severity')
    : (incident.severity || 'medium');
  const resolutionNotes = cleanText(payload.resolutionNotes || payload.reviewNotes, 2000);
  if (['resolved', 'closed'].includes(status) && !resolutionNotes) throw validationError('Resolution notes are required before closing an incident');
  incident.status = status;
  incident.severity = severity;
  incident.assignedTo = cleanText(payload.assignedTo || incident.assignedTo, 180);
  incident.resolutionNotes = resolutionNotes || incident.resolutionNotes || '';
  incident.reviewedBy = actorId(actor);
  incident.reviewedAt = now();
  incident.updatedAt = now();
  await repo.withTransaction(async (session) => {
    await repo.incidents.save(incident, { id: incident.id }, { session });
    if (incident.rideId) {
      const ride = await repo.rides.findOne({ id: incident.rideId }, { session });
      if (ride) {
        ride.safetyState = {
          ...(ride.safetyState || {}),
          status,
          incidentId: incident.id,
          reviewedAt: now(),
          reviewedBy: actorId(actor),
        };
        ride.updatedAt = now();
        await repo.rides.save(ride, { id: ride.id }, { session });
      }
    }
    await repo.audit({ actorId: actorId(actor), action: 'mobility.incident.reviewed', targetType: 'taxi_incident', targetId: incident.id, companyId: incident.companyId || incident.providerCompanyId || '', metadata: { status, severity }, session });
  });
  return incident;
}

async function updatePartnerPayoutPolicy(companyId, payload = {}, actor = {}) {
  requireSuperAdmin(actor, 'Only Super Admin may change mobility partner payout policy');
  const partner = await company(companyId);
  const category = partnerCategory(partner);
  const individual = ['boda_rider', 'car_driver'].includes(category);
  const driverPayoutPercent = individual
    ? 100
    : numberValue(payload.driverPayoutPercent, 'Driver payout percent', 0, 100, 80);
  const reviewNotes = cleanText(payload.reviewNotes, 800);
  partner.settings = {
    ...(partner.settings || {}),
    driverPayoutPercent,
    driverPayoutPolicy: {
      controlledBy: 'super_admin',
      reviewedBy: actorId(actor),
      reviewedAt: now(),
      reviewNotes,
    },
  };
  partner.updatedAt = now();
  await repo.companies.save(partner, { id: partner.id });
  await repo.audit({
    actorId: actorId(actor),
    action: 'mobility.partner.payout_policy.updated',
    targetType: 'company',
    targetId: partner.id,
    companyId: partner.id,
    metadata: { partnerCategory: category, driverPayoutPercent, reviewNotes },
  });
  return { id: partner.id, name: partner.name, partnerCategory: category, driverPayoutPercent };
}

async function partnerSetupSummary(companyId) {
  const partner = await company(companyId);
  const [vehicles, drivers, platformClasses] = await Promise.all([
    repo.vehicles.list({ companyId: partner.id }, { sort: { createdAt: -1 }, limit: 200 }),
    repo.drivers.list({ companyId: partner.id }, { sort: { createdAt: -1 }, limit: 200 }),
    repo.vehicleClasses.list({ companyId: PLATFORM_MOBILITY_OWNER, status: 'active' }, { sort: { sortOrder: 1, name: 1 }, limit: 50 }),
  ]);
  return { partner, vehicles, drivers, platformClasses, canManageFleet: canManageFleet(partner), platformManagedPricing: true, platformManagedDispatch: true };
}

module.exports = {
  company, platformListing, partnerSetupSummary,
  createVehicleClass, createZone, createFareRule, createPlatformListing,
  createVehicle, updateVehicleStatus, reviewVehicle,
  createDriverProfile, verifyDriver, reviewIncident, updatePartnerPayoutPolicy,
  // Compatibility aliases remain admin-only at the service layer.
  createTransferListing: createPlatformListing,
  publishListing: createPlatformListing,
};
