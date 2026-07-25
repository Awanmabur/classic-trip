'use strict';

const taxiRepo = require('../../modules/taxi/repositories/taxiRepository');
const taxiSetupService = require('../../modules/taxi/services/taxiSetupService');
const sensitive = require('../security/sensitiveFieldService');
const { capabilityPolicyFor } = require('../../config/partnerProfiles');
const { INDIVIDUAL_DRIVER_CATEGORIES } = require('../../modules/taxi/domain/taxiGovernance');

function normalize(value) { return String(value || '').trim().toLowerCase(); }
function clean(value) { return String(value || '').trim(); }
function dateValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function activeClassFor(category, vehicleType) {
  const preferredKeys = category === 'boda_rider'
    ? ['boda_standard', 'boda_saver', 'boda_plus', 'motorcycle']
    : ['car_standard', 'car', 'safe_car'];
  const classes = await taxiRepo.vehicleClasses.list({ companyId: 'platform', status: 'active' }, { sort: { sortOrder: 1, name: 1 }, limit: 100 });
  return classes.find((row) => preferredKeys.includes(normalize(row.key)))
    || classes.find((row) => category === 'boda_rider' ? /boda|motorcycle/i.test(`${row.key} ${row.name}`) : /car|taxi|sedan/i.test(`${row.key} ${row.name}`))
    || classes.find((row) => (row.serviceTypes || []).includes(normalize(vehicleType)))
    || null;
}

function requiredIndividualFields(company) {
  const profile = company.onboardingProfile || {};
  const driver = profile.driver || {};
  const vehicle = profile.vehicle || {};
  const missing = [];
  if (!driver.licenceNumberEncrypted) missing.push('driver licence');
  if (!dateValue(driver.licenceExpiresAt)) missing.push('driver licence expiry');
  if (!clean(vehicle.registrationNumber)) missing.push('vehicle registration');
  if (!clean(vehicle.type)) missing.push('vehicle type');
  if (!clean(vehicle.make)) missing.push('vehicle make');
  if (!clean(vehicle.model)) missing.push('vehicle model');
  if (!Number(vehicle.year)) missing.push('vehicle year');
  if (!clean(vehicle.color)) missing.push('vehicle colour');
  if (!dateValue(vehicle.insuranceExpiresAt)) missing.push('insurance expiry');
  return missing;
}

async function saveProgress(company, { completed = [], missing = [], currentStep = 'verification', materialization = {} } = {}) {
  company.capabilityPolicy = capabilityPolicyFor(company.partnerCategory);
  company.onboardingProgress = {
    ...(company.onboardingProgress || {}),
    currentStep,
    completedSteps: Array.from(new Set([...(company.onboardingProgress?.completedSteps || []), ...completed])),
    missingFields: missing,
    approvedAt: company.verificationStatus === 'verified' ? (company.onboardingProgress?.approvedAt || new Date()) : company.onboardingProgress?.approvedAt,
  };
  company.settings = {
    ...(company.settings || {}),
    partnerCategory: company.partnerCategory,
    accountModel: company.accountModel,
    platformManagedPricing: company.companyType === 'local_transport',
    platformManagedDispatch: company.companyType === 'local_transport',
    supplierManagedInventory: company.companyType === 'flight',
    onboardingMaterialization: materialization,
  };
  company.updatedAt = new Date();
  await taxiRepo.companies.save(company, { id: company.id });
}

async function materializeIndividualDriver(company, adminActor) {
  const missing = requiredIndividualFields(company);
  const klass = await activeClassFor(company.partnerCategory, company.onboardingProfile?.vehicle?.type);
  if (!klass) missing.push(company.partnerCategory === 'boda_rider' ? 'active platform boda class' : 'active platform car class');
  if (missing.length) {
    await saveProgress(company, {
      completed: ['identity', 'partner_type', 'company_verification'],
      missing,
      currentStep: 'driver_vehicle_completion',
      materialization: { status: 'action_required', reason: 'missing_driver_or_vehicle_fields', checkedAt: new Date() },
    });
    return { createdVehicle: false, createdDriver: false, missing };
  }

  const profile = company.onboardingProfile || {};
  const vehicleProfile = profile.vehicle || {};
  const driverProfile = profile.driver || {};
  const partnerActor = {
    id: adminActor.id || adminActor.userId || 'admin-system',
    userId: company.ownerId,
    role: 'company_admin',
    actorType: 'onboarding_materializer',
    companyId: company.id,
  };

  let vehicle = await taxiRepo.vehicles.findOne({ companyId: company.id, registrationNumber: clean(vehicleProfile.registrationNumber).toUpperCase() });
  let createdVehicle = false;
  if (!vehicle) {
    vehicle = await taxiSetupService.createVehicle({
      vehicleClassId: klass.id,
      registrationNumber: vehicleProfile.registrationNumber,
      make: vehicleProfile.make,
      model: vehicleProfile.model,
      year: vehicleProfile.year,
      color: vehicleProfile.color || '',
      passengerCapacity: klass.passengerCapacity,
      luggageCapacity: klass.luggageCapacity,
      insuranceExpiresAt: vehicleProfile.insuranceExpiresAt,
      inspectionExpiresAt: vehicleProfile.inspectionExpiresAt || '',
      registrationExpiresAt: vehicleProfile.registrationExpiresAt || '',
    }, partnerActor);
    createdVehicle = true;
  }

  let driver = await taxiRepo.drivers.findOne({ companyId: company.id, userId: company.ownerId });
  let createdDriver = false;
  if (!driver) {
    const licenceNumber = sensitive.decrypt(driverProfile.licenceNumberEncrypted, 'partner-driver-licence');
    if (!licenceNumber) {
      await saveProgress(company, {
        completed: ['identity', 'partner_type', 'company_verification', 'vehicle_submission'],
        missing: ['readable encrypted driver licence'],
        currentStep: 'driver_vehicle_completion',
        materialization: { status: 'action_required', reason: 'driver_licence_could_not_be_decrypted', vehicleId: vehicle.id, checkedAt: new Date() },
      });
      return { createdVehicle, createdDriver: false, missing: ['readable encrypted driver licence'] };
    }
    driver = await taxiSetupService.createDriverProfile({
      userId: company.ownerId,
      driverNumber: `${company.partnerCategory}-${company.id}`,
      licenceNumber,
      licenceClass: company.partnerCategory === 'boda_rider' ? 'motorcycle' : 'motor_vehicle',
      licenceExpiresAt: driverProfile.licenceExpiresAt,
      assignedVehicleId: vehicle.id,
    }, partnerActor);
    createdDriver = true;
  }

  await saveProgress(company, {
    completed: ['identity', 'partner_type', 'company_verification', 'vehicle_submission', 'driver_submission'],
    missing: [],
    currentStep: 'safety_review',
    materialization: {
      status: 'submitted_for_platform_review',
      vehicleId: vehicle.id,
      driverId: driver.id,
      createdVehicle,
      createdDriver,
      checkedAt: new Date(),
    },
  });
  return { createdVehicle, createdDriver, vehicleId: vehicle.id, driverId: driver.id, missing: [] };
}

async function materializeApprovedPartner(companyOrId, adminActor = {}) {
  const company = typeof companyOrId === 'object' && companyOrId
    ? companyOrId
    : await taxiRepo.companies.findOne({ $or: [{ id: clean(companyOrId) }, { slug: clean(companyOrId) }] });
  if (!company) throw Object.assign(new Error('Approved partner company was not found'), { status: 404 });
  if (company.verificationStatus !== 'verified' || company.status !== 'active') return { skipped: true, reason: 'company_not_verified' };

  if (company.companyType === 'flight' && company.partnerCategory === 'flight_agent') {
    await saveProgress(company, {
      completed: ['identity', 'partner_type', 'company_verification'],
      missing: [],
      currentStep: 'agent_workspace_ready',
      materialization: { status: 'agent_workspace_ready', supplierInventoryOwnedBy: 'platform', checkedAt: new Date() },
    });
    return { ready: true, mode: 'flight_agent' };
  }

  if (company.companyType === 'local_transport' && INDIVIDUAL_DRIVER_CATEGORIES.includes(company.partnerCategory)) {
    return materializeIndividualDriver(company, adminActor);
  }

  if (company.companyType === 'local_transport') {
    await saveProgress(company, {
      completed: ['identity', 'partner_type', 'company_verification'],
      missing: [],
      currentStep: 'fleet_setup',
      materialization: { status: 'fleet_workspace_ready', platformManagedPricing: true, platformManagedDispatch: true, checkedAt: new Date() },
    });
    return { ready: true, mode: 'fleet' };
  }

  return { skipped: true, reason: 'service_not_materialized' };
}

module.exports = { materializeApprovedPartner };
