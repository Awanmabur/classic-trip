const { currencyForCountry, normalizeCountry } = require('../../config/countryMarkets');
const crypto = require('crypto');
const toSlug = require('../../utils/slugify');
const { formatRouteLabel } = require('../../utils/routeLabel');
const { ENABLED_BOOKING_TYPES, COMPANY_STATUS, LISTING_STATUS } = require('../../config/constants');
const { nextId } = require('../data/idService');
const { normalizeCompanyType } = require('../../utils/companyServiceType');
const { normalizePermissions, employeePermissions, REQUIRED_DRIVER_PERMISSIONS } = require('../../config/accessControl');
const companyRepository = require('../../repositories/domain/companyOperationsRepository');
const { duplicateKeyFields } = require('../../utils/mongoDuplicate');
const hotelService = require('../hotel/hotelService');
const busSetupService = require('../../modules/bus/services/busSetupService');
const busDepartureService = require('../../modules/bus/services/busDepartureService');
const { getPlatformConfig } = require('../platform/platformConfigService');
const { SERVICE_REGISTRY, normalizeServiceType } = require('../../config/serviceRegistry');
const { partnerProfile, capabilityPolicyFor } = require('../../config/partnerProfiles');
const { evaluateDriverAssignment, evaluateDriverEligibility, evaluatePartnerDriverActivation } = require('./driverEligibilityService');
const { LISTING_DESCRIPTION_MIN_LENGTH, assertPublicDescription, normalizePublicDescription } = require('../../config/contentRules');
const { mediaUrl } = require('../../utils/mediaUrl');

const SERVICE_LABELS = Object.freeze(Object.fromEntries(Object.entries(SERVICE_REGISTRY).map(([key, value]) => [key, value.singular])));
const BRANCH_TYPES = Object.freeze(['terminal', 'branch', 'pickup_point', 'dropoff_point', 'office', 'property', 'front_desk']);
const BRANCH_STATUSES = Object.freeze(['active', 'paused', 'archived']);
const POLICY_TYPES = Object.freeze(['operations', 'hotel', 'bus', 'cancellation', 'refund', 'baggage', 'boarding', 'no_show', 'support', 'check_in', 'check_out', 'housekeeping']);
const POLICY_STATUSES = Object.freeze(['active', 'paused', 'archived']);


function normalize(value) { return String(value || '').toLowerCase().trim(); }
function cleanText(value, max = 2000) { return String(value || '').replace(/<[^>]*>/g, '').trim().replace(/\s+/g, ' ').slice(0, max); }
function moneyValue(value, fallback = 0) { const amount = Number(value); return Number.isFinite(amount) ? amount : fallback; }
function boolValue(value) { return value === true || value === 'true' || value === 'on' || value === '1' || value === 1; }
function parseList(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return Array.from(new Set(values.map((item) => cleanText(item, 120)).filter(Boolean)));
}
function payloadMedia(payload = {}, label = 'Classic Trip media') {
  const asset = payload.mediaAsset || payload.uploadedMedia || payload.asset;
  if (asset && (asset.url || asset.secureUrl)) {
    const url = cleanText(asset.secureUrl || asset.url, 2000);
    return [{
      url, secureUrl: url, publicId: cleanText(asset.publicId || asset.public_id || url, 500),
      resourceType: cleanText(asset.resourceType || asset.resource_type || 'image', 40),
      width: asset.width, height: asset.height, format: cleanText(asset.format, 30),
      alt: cleanText(asset.alt || label, 240), label: cleanText(asset.label || label, 240),
    }];
  }
  const url = cleanText(payload.imageUrl || payload.image || payload.mediaUrl || payload.photoUrl || '', 2000);
  if (!url) return [];
  return [{
    url, secureUrl: url, publicId: cleanText(payload.imagePublicId || payload.publicId || url, 500),
    resourceType: 'image', alt: cleanText(payload.imageAlt || label, 240), label: cleanText(payload.imageLabel || label, 240),
  }];
}
function companyCanPublish(company = {}) { return company.verificationStatus === COMPANY_STATUS.VERIFIED && company.settings?.canPublish !== false; }
function ensureCompanyCanPublish(company) {
  if (companyCanPublish(company)) return;
  const error = new Error('Company must be verified before publishing listings or receiving bookings');
  error.status = 403;
  throw error;
}
function notFound(message) { const error = new Error(message); error.status = 404; return error; }
function validation(message) { const error = new Error(message); error.status = 422; return error; }
function conflict(message) { const error = new Error(message); error.status = 409; return error; }

async function companyOrThrow(identifier) {
  const key = cleanText(identifier, 180);
  const company = await companyRepository.companies.findOne({ $or: [{ id: key }, { slug: key }] });
  if (!company) throw notFound('Company not found');
  return company;
}
async function listingOrThrow(companyId, identifier) {
  const key = cleanText(identifier, 180);
  const listing = await companyRepository.listings.findOne({ companyId, $or: [{ id: key }, { slug: key }] });
  if (!listing) throw notFound('Listing not found for this company');
  return listing;
}
async function branchOrThrow(companyId, identifier) {
  const key = cleanText(identifier, 180);
  if (!key) return null;
  const branch = await companyRepository.branches.findOne({ companyId, id: key, status: { $ne: 'archived' } });
  if (!branch) throw notFound('Branch, terminal, or property desk not found for this company');
  return branch;
}
function branchName(branch) { return branch ? cleanText(branch.name || branch.city || branch.id, 180) : ''; }
async function scheduleOrThrow(companyId, id) {
  const schedule = await companyRepository.schedules.findOne({ companyId, $or: entityIdentityClauses(id) });
  if (!schedule) throw notFound('Schedule not found for this company');
  return schedule;
}
async function vehicleOrThrow(companyId, id) {
  const vehicle = await companyRepository.vehicles.findOne({ companyId, $or: entityIdentityClauses(id) });
  if (!vehicle) throw notFound('Vehicle not found for this company');
  return vehicle;
}
async function employeeOrThrow(companyId, identifier) {
  const key = cleanText(identifier, 180);
  const identities = [{ id: key }, { userId: key }];
  if (/^[a-f0-9]{24}$/i.test(key)) identities.push({ _id: key });
  const employee = await companyRepository.employees.findOne({ companyId, $or: identities });
  if (!employee) throw notFound('Employee not found for this company');
  return employee;
}
async function employeeUser(employee = {}) { return companyRepository.users.findOne({ id: employee.userId }); }
async function hotelPropertyOrThrow(companyId, id) {
  const row = await companyRepository.hotelProperties.findOne({ companyId, id: cleanText(id, 180) });
  if (!row) throw notFound('Hotel property not found for this company');
  return row;
}
async function roomTypeOrThrow(companyId, id) {
  const row = await companyRepository.roomTypes.findOne({ companyId, id: cleanText(id, 180) });
  if (!row) throw notFound('Room type not found for this company');
  return row;
}
async function roomUnitOrThrow(companyId, id) {
  const row = await companyRepository.roomUnits.findOne({ companyId, id: cleanText(id, 180) });
  if (!row) throw notFound('Room unit not found for this company');
  return row;
}

function hasOwn(payload, key) {
  return Object.prototype.hasOwnProperty.call(payload || {}, key);
}

async function validateEmployeeScopes(companyId, payload = {}, current = {}) {
  const branchValue = hasOwn(payload, 'branchId') ? payload.branchId : (hasOwn(payload, 'branch') ? payload.branch : current.branchId);
  const branch = await branchOrThrow(companyId, branchValue);
  const listingIds = hasOwn(payload, 'listingIds') ? parseList(payload.listingIds) : parseList(current.listingIds);
  const scheduleIds = hasOwn(payload, 'scheduleIds') ? parseList(payload.scheduleIds) : parseList(current.scheduleIds);

  let listings = [];
  if (listingIds.length) {
    listings = await companyRepository.listings.list({ companyId, id: { $in: listingIds }, status: { $ne: 'archived' } }, { limit: Math.max(100, listingIds.length) });
    if (listings.length !== listingIds.length) throw validation('One or more selected employee listings do not belong to this company');
  }

  let schedules = [];
  if (scheduleIds.length) {
    schedules = await companyRepository.schedules.list({ companyId, id: { $in: scheduleIds }, status: { $nin: ['archived', 'cancelled'] } }, { limit: Math.max(100, scheduleIds.length) });
    if (schedules.length !== scheduleIds.length) throw validation('One or more selected employee schedules do not belong to this company');
    if (listingIds.length && schedules.some((schedule) => schedule.listingId && !listingIds.includes(schedule.listingId))) {
      throw validation('Every selected employee schedule must belong to one of the selected listings');
    }
  }

  return { branch, listingIds, scheduleIds, listings, schedules };
}
async function uniqueSlug(base, collection, existingId = '') {
  const root = toSlug(base) || `item-${Date.now()}`;
  let slug = root;
  let index = 1;
  while (await collection.findOne({ slug, ...(existingId ? { id: { $ne: existingId } } : {}) })) {
    index += 1;
    slug = `${root}-${index}`;
  }
  return slug;
}
async function writeAudit(actorId, action, target, meta = {}, options = {}) {
  const row = {
    id: await nextId('audit'), actorId: cleanText(actorId || 'system', 180), action: cleanText(action, 180),
    target: cleanText(target, 180), targetId: cleanText(target, 180), entityId: cleanText(target, 180),
    entityType: cleanText(meta.entityType || action.split('.')[0] || 'company', 80), meta, metadata: meta,
    status: 'success', createdAt: new Date().toISOString(),
  };
  await companyRepository.auditLogs.save(row, { id: row.id }, { session: options.session });
  return row;
}
function listingType(serviceType) { return SERVICE_LABELS[serviceType] || serviceType; }
function listingRouteLabel(payload) { return payload.from || payload.to ? formatRouteLabel(payload.from, payload.to) : payload.city || payload.country || ''; }

async function createCompany(payload = {}) {
  const platformConfig = await getPlatformConfig();
  const normalizedCountry = normalizeCountry(payload.country);
  const requestedCurrency = cleanText(currencyForCountry(normalizedCountry), 8).toUpperCase();
  if (!platformConfig.supportedCurrencies.includes(requestedCurrency)) throw validation('Select an operating currency supported by the platform');
  const name = cleanText(payload.name, 180);
  if (!name) throw validation('Company name is required');
  if (!normalizedCountry) throw validation('Select a supported operating country');
  const city = cleanText(payload.city || payload.headOfficeCity || payload.locationCity || '', 140);
  if (!city && !payload.allowIncompleteProfile) throw validation('Company city is required');
  if (!cleanText(payload.phone, 60)) throw validation('Company support phone is required');
  if (!cleanText(payload.email, 254)) throw validation('Company support email is required');
  const maxAttempts = 25;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const company = {
      id: attempt > 5 ? `company-${crypto.randomUUID()}` : await nextId('company'), ownerId: cleanText(payload.ownerId, 180) || null, name,
      slug: await uniqueSlug(payload.slug || name, companyRepository.companies),
      companyType: (() => { const type = normalizeServiceType(payload.companyType || payload.type); if (!type) throw validation('Select a valid company service type'); return type; })(),
      partnerCategory: (() => { const profile = partnerProfile(payload.partnerCategory); return profile?.key || ''; })(),
      accountModel: (() => { const profile = partnerProfile(payload.partnerCategory); return cleanText(payload.accountModel || profile?.accountModel || 'organization', 40); })(),
      onboardingProfile: payload.onboardingProfile && typeof payload.onboardingProfile === 'object' ? payload.onboardingProfile : {},
      complianceProfile: payload.complianceProfile && typeof payload.complianceProfile === 'object' ? payload.complianceProfile : {},
      capabilityPolicy: payload.capabilityPolicy && typeof payload.capabilityPolicy === 'object' ? payload.capabilityPolicy : capabilityPolicyFor(payload.partnerCategory),
      onboardingProgress: { currentStep: 'verification', completedSteps: ['account'], missingFields: [], submittedAt: new Date().toISOString() },
      country: normalizedCountry, city,
      legalName: cleanText(payload.legalName || name, 200), registrationNumber: cleanText(payload.registrationNumber, 120),
      taxNumber: cleanText(payload.taxNumber, 120), headOfficeAddress: cleanText(payload.headOfficeAddress || payload.address, 400),
      website: cleanText(payload.website, 300),
      description: cleanText(payload.description, 2000),
      status: COMPANY_STATUS.PENDING, verificationStatus: COMPANY_STATUS.PENDING, documents: [],
      supportContacts: {
        phone: cleanText(payload.phone, 60), email: cleanText(payload.email, 254).toLowerCase(),
        whatsapp: cleanText(payload.whatsapp || payload.phone, 60),
      },
      ratingAverage: 0, reviewCount: 0, operatingCurrency: requestedCurrency,
      commercialTerms: {
        model: 'percentage_commission',
        commissionPercent: Math.max(0, Math.min(100, Number(payload.commissionPercent ?? platformConfig.partnerCommissionPercent) || 0)),
        promoterFunding: 'platform_commission',
        termsVersion: platformConfig.commercialTermsVersion || 'commission-v1',
        acceptedAt: payload.termsAccepted ? new Date().toISOString() : null,
        acceptedBy: cleanText(payload.ownerId || payload.acceptedBy || '', 180),
        source: typeof payload.commissionPercent !== 'undefined' ? 'admin_override' : 'platform_default',
        updatedAt: new Date().toISOString(),
        updatedBy: cleanText(payload.ownerId || payload.acceptedBy || 'system', 180),
      },
      settings: { instantConfirmation: false, canPublish: false, onboardingStep: 'verification', profileIncomplete: !city, missingProfileFields: city ? [] : ['city'], commercialModel: 'percentage_commission', partnerCategory: cleanText(payload.partnerCategory, 60), accountModel: cleanText(payload.accountModel, 40), platformManagedPricing: normalizeServiceType(payload.companyType || payload.type) === 'local_transport', supplierManagedInventory: normalizeServiceType(payload.companyType || payload.type) === 'flight' }, createdAt: new Date().toISOString(),
    };
    try {
      // Creation must be insert-only. Upsert-by-id could overwrite an existing
      // organization when a stale counter allocates an already-used identifier.
      await companyRepository.companies.insert(company);
      return company;
    } catch (error) {
      if (Number(error?.code) !== 11000) throw error;
      const fields = duplicateKeyFields(error);
      if (fields.includes('id') || fields.includes('slug')) continue;
      const duplicate = conflict('Partner organization setup conflicts with existing organization data. Please review the submitted legal registration details or retry.');
      duplicate.code = 'company_registration_conflict';
      duplicate.duplicateFields = fields;
      throw duplicate;
    }
  }
  const error = new Error('A unique partner organization identifier could not be allocated. Please retry registration.');
  error.status = 503;
  error.code = 'company_identifier_unavailable';
  throw error;
}

async function updateCommercialTerms(identifier, payload = {}, actorId = 'admin-system') {
  const company = await companyOrThrow(identifier);
  const commissionPercent = Number(payload.commissionPercent);
  if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) {
    throw validation('Partner commission must be a percentage between 0 and 100');
  }
  const reason = cleanText(payload.reason || payload.note, 1000);
  if (!reason) throw validation('A reason is required when changing a partner commission percentage');
  const now = new Date().toISOString();
  const current = company.commercialTerms || {};
  company.commercialTerms = {
    model: 'percentage_commission',
    commissionPercent: Number(commissionPercent.toFixed(4)),
    promoterFunding: 'platform_commission',
    termsVersion: `commission-${Date.now()}`,
    acceptedAt: current.acceptedAt || now,
    acceptedBy: current.acceptedBy || company.ownerId || actorId,
    source: 'admin_override',
    updatedAt: now,
    updatedBy: cleanText(actorId, 180),
  };
  company.settings = { ...(company.settings || {}), commercialModel: 'percentage_commission' };
  await companyRepository.withTransaction(async (session) => {
    await companyRepository.companies.save(company, { id: company.id }, { session });
    await writeAudit(actorId, 'company.commission.updated', company.id, {
      entityType: 'company',
      companyId: company.id,
      previousCommissionPercent: Number(current.commissionPercent || 0),
      commissionPercent: company.commercialTerms.commissionPercent,
      partnerPayoutPercent: Number((100 - company.commercialTerms.commissionPercent).toFixed(4)),
      reason,
      termsVersion: company.commercialTerms.termsVersion,
    }, { session });
  });
  return company;
}

async function setVerificationStatus(identifier, status = COMPANY_STATUS.VERIFIED, adminId = 'admin-system', review = {}) {
  if (!Object.values(COMPANY_STATUS).includes(status)) throw validation('Invalid company verification status');
  const company = await companyOrThrow(identifier);
  const reviewedAt = new Date().toISOString();
  Object.assign(company, {
    verificationStatus: status,
    status: status === COMPANY_STATUS.VERIFIED ? 'active' : status,
    settings: { ...(company.settings || {}), canPublish: status === COMPANY_STATUS.VERIFIED, instantConfirmation: status === COMPANY_STATUS.VERIFIED },
    reviewedBy: cleanText(adminId, 180), reviewedAt,
    reviewNotes: cleanText(review.note || review.reviewNotes || company.reviewNotes || '', 2000),
  });
  company.documents = (Array.isArray(company.documents) ? company.documents : []).map((document) => {
    if (status === COMPANY_STATUS.VERIFIED) return { ...document, status: 'approved', reviewedBy: adminId, reviewedAt, reviewNotes: company.reviewNotes };
    if (status === COMPANY_STATUS.REJECTED) return { ...document, status: 'rejected', reviewedBy: adminId, reviewedAt, reviewNotes: company.reviewNotes };
    if (status === COMPANY_STATUS.SUSPENDED) return { ...document, status: document.status === 'approved' ? 'suspended' : document.status || 'pending_review', reviewedBy: adminId, reviewedAt, reviewNotes: company.reviewNotes };
    return document;
  });

  await companyRepository.withTransaction(async (session) => {
    await companyRepository.companies.save(company, { id: company.id }, { session });
    if ([COMPANY_STATUS.REJECTED, COMPANY_STATUS.SUSPENDED].includes(status)) {
      await companyRepository.listings.updateMany(
        { companyId: company.id, status: LISTING_STATUS.ACTIVE },
        { $set: { status: LISTING_STATUS.PAUSED, bookable: false, releaseStatus: 'paused', updatedAt: reviewedAt } },
        { session }
      );
    }
    await writeAudit(adminId, `company.${status}`, company.slug, { companyId: company.id, status, entityType: 'company' }, { session });
  });
  return company;
}

async function createListing(companyId, payload = {}) {
  const company = await companyOrThrow(companyId);
  const serviceType = normalizeServiceType(payload.serviceType || payload.group || company.companyType);
  const companyType = normalizeCompanyType(company.companyType);
  const supported = ['hotel', 'tour', 'car_rental', 'cargo'];
  if (!supported.includes(serviceType) || companyType !== serviceType) {
    throw validation('Listings can only be created inside the matching approved partner workspace');
  }

  const wantsActive = boolValue(payload.publish) || payload.status === LISTING_STATUS.ACTIVE;
  if (wantsActive) ensureCompanyCanPublish(company);
  const title = cleanText(payload.title, 180);
  if (!title) throw validation(`${SERVICE_LABELS[serviceType] || 'Service'} listing title is required`);
  const requestedStatus = cleanText(payload.status || LISTING_STATUS.DRAFT, 40);
  if (!Object.values(LISTING_STATUS).includes(requestedStatus)) throw validation('Invalid listing status');

  const publicDescription = assertPublicDescription(payload.description || payload.sub || payload.shortDescription, validation);
  const isHotel = serviceType === 'hotel';
  const inventory = Math.max(0, Math.floor(moneyValue(payload.inventory ?? payload.availableInventory ?? payload.capacity, 0)));
  const priceFrom = moneyValue(payload.priceFrom ?? payload.price ?? payload.nightlyPrice, 0);
  const status = isHotel && wantsActive ? LISTING_STATUS.DRAFT : (wantsActive ? LISTING_STATUS.ACTIVE : requestedStatus);
  const bookable = !isHotel && status === LISTING_STATUS.ACTIVE;
  const media = payloadMedia(payload, title);
  const branch = await branchOrThrow(company.id, payload.branchId);
  const listingKinds = { hotel: 'property', tour: 'experience', car_rental: 'rental_vehicle', cargo: 'cargo_service' };
  const availabilityModes = { hotel: 'date_range', tour: 'dated_capacity', car_rental: 'date_range', cargo: 'on_demand' };
  const pricingUnits = { hotel: 'per_night', tour: 'per_person', car_rental: 'per_day', cargo: 'per_shipment' };
  const listing = {
    id: await nextId('listing'), companyId: company.id, companySlug: company.slug, companyName: company.name, branchId: branch?.id || '', branchName: branchName(branch),
    serviceType, group: serviceType, type: listingType(serviceType), listingKind: listingKinds[serviceType], title,
    slug: await uniqueSlug(`${title}-${company.name}`, companyRepository.listings),
    sub: publicDescription, shortDescription: publicDescription.slice(0, 500),
    country: cleanText(branch?.country || company.country, 100), city: cleanText(payload.city || branch?.city || company.city || '', 140),
    address: cleanText(payload.address || branch?.address || '', 300), from: cleanText(payload.from || payload.origin || payload.pickupLocation || '', 140), to: cleanText(payload.to || payload.destination || payload.deliveryLocation || '', 140),
    corridor: cleanText(payload.corridor || listingRouteLabel(payload).toLowerCase().replace(/\s+to\s+/i, '-'), 200),
    price: priceFrom, priceFrom, pricingUnit: cleanText(payload.pricingUnit || pricingUnits[serviceType], 60),
    currency: cleanText(company.operatingCurrency, 8).toUpperCase(), media, img: mediaUrl(media) || '', amenities: parseList(payload.amenities),
    checkInTime: cleanText(payload.checkInTime, 20), checkOutTime: cleanText(payload.checkOutTime, 20), stayType: cleanText(payload.stayType || payload.propertyType || '', 80),
    serviceNotes: cleanText(payload.serviceNotes || '', 2000), contactPhone: cleanText(payload.contactPhone || company.supportContacts?.phone || '', 60),
    pickupInstructions: cleanText(payload.pickupInstructions || '', 1000), dropoffInstructions: cleanText(payload.dropoffInstructions || '', 1000),
    inventory, remainingInventory: inventory, availabilityMode: cleanText(payload.availabilityMode || availabilityModes[serviceType], 40),
    durationMinutes: Math.max(0, Math.floor(moneyValue(payload.durationMinutes ?? payload.durationHours * 60, 0))), maxGuests: Math.max(1, Math.floor(moneyValue(payload.maxGuests || payload.capacity, 1))), minimumAge: Math.max(0, Math.floor(moneyValue(payload.minimumAge, 0))),
    vehicleCategory: cleanText(payload.vehicleCategory || payload.vehicleType || '', 100), transmission: cleanText(payload.transmission || '', 40), fuelType: cleanText(payload.fuelType || '', 40), seatsCount: Math.max(1, Math.floor(moneyValue(payload.seatsCount || payload.seats, 1))),
    cargoTypes: parseList(payload.cargoTypes || payload.cargoType), weightLimitKg: Math.max(0, moneyValue(payload.weightLimitKg || payload.maxWeightKg, 0)), packageLimit: Math.max(1, Math.floor(moneyValue(payload.packageLimit || payload.maxPackages, 1))),
    serviceDetails: payload.serviceDetails && typeof payload.serviceDetails === 'object' ? payload.serviceDetails : {
      meetingPoint: cleanText(payload.meetingPoint || '', 300), included: parseList(payload.included), excluded: parseList(payload.excluded),
      pickupLocation: cleanText(payload.pickupLocation || '', 300), returnLocation: cleanText(payload.returnLocation || '', 300), driverOption: cleanText(payload.driverOption || '', 60),
      deliveryAreas: parseList(payload.deliveryAreas), cargoDescription: cleanText(payload.cargoDescription || '', 1000),
    },
    ratingAverage: 0, rating: '0', reviewCount: 0, isSponsored: false, isFeatured: false,
    isVerified: company.verificationStatus === COMPANY_STATUS.VERIFIED, bookable, releaseStatus: status === LISTING_STATUS.ACTIVE ? 'published' : status === LISTING_STATUS.ARCHIVED ? 'archived' : status === LISTING_STATUS.PAUSED ? 'paused' : 'draft', status,
    policy: cleanText(payload.policy || (bookable ? 'Instant booking after secure payment confirmation.' : 'Draft listing pending publish.'), 2000),
    layout: cleanText(payload.layout || (isHotel ? 'hotel-rooms' : serviceType), 100), taken: [],
    cancellationRules: cleanText(payload.cancellationRules || 'Refund and cancellation rules follow the published partner policy.', 2000), baggageRules: cleanText(payload.baggageRules || '', 2000),
    createdAt: new Date().toISOString(),
  };

  if (!listing.currency || !/^[A-Z]{3}$/.test(listing.currency)) throw validation('Company operating currency is required');
  if (!isHotel && wantsActive) validateGenericListingReadiness(listing);
  await companyRepository.listings.save(listing, { id: listing.id });

  if (isHotel && (payload.roomType || payload.inventory || payload.nightlyPrice)) {
    const property = await hotelService.createProperty(company.id, {
      listingId: listing.id, propertyName: payload.propertyName || listing.title, address: payload.address || listing.address,
      city: payload.city || listing.city, country: listing.country, checkInTime: payload.checkInTime || listing.checkInTime,
      checkOutTime: payload.checkOutTime || listing.checkOutTime, amenities: payload.propertyAmenities || payload.amenities, status: 'active',
      propertyType: payload.stayType || payload.propertyType || 'hotel',
    });
    await hotelService.createRoomType(company.id, {
      listingId: listing.id, propertyId: property.id, name: payload.roomType || 'Standard Room', capacity: payload.capacity || 2,
      basePrice: payload.nightlyPrice || payload.priceFrom || payload.price, defaultInventory: payload.inventory || 1,
      amenities: payload.roomAmenities || payload.amenities, status: 'active',
    });
  }
  if (isHotel && wantsActive) return hotelService.publishHotelListing(company.id, listing.id, payload.actorId || payload.createdBy || 'company-admin');
  return listing;
}

function validateGenericListingReadiness(listing = {}) {
  const serviceType = normalizeServiceType(listing.serviceType);
  if (!['tour', 'car_rental', 'cargo'].includes(serviceType)) throw validation('This listing must use its dedicated publishing workflow');
  if (!cleanText(listing.title, 180)) throw validation('Listing title is required before publishing');
  if (normalizePublicDescription(listing.sub || listing.shortDescription).length < LISTING_DESCRIPTION_MIN_LENGTH) throw validation(`Public description must contain at least ${LISTING_DESCRIPTION_MIN_LENGTH} characters before publishing`);
  if (!(Number(listing.priceFrom) > 0)) throw validation('A price greater than zero is required before publishing');
  if (!cleanText(listing.city || listing.from || listing.address, 300)) throw validation('A service city, address, or pickup location is required before publishing');
  if (['tour', 'car_rental'].includes(serviceType) && !(Number(listing.remainingInventory ?? listing.inventory) > 0)) {
    throw validation(serviceType === 'tour' ? 'Tour capacity is required before publishing' : 'At least one available rental vehicle is required before publishing');
  }
  if (serviceType === 'cargo' && !cleanText(listing.to || listing.serviceDetails?.deliveryAreas?.join(', '), 500)) {
    throw validation('Cargo delivery area or destination is required before publishing');
  }
}

async function updateListing(companyId, listingId, payload = {}) {
  const company = await companyOrThrow(companyId);
  const listing = await listingOrThrow(company.id, listingId);
  const serviceType = normalizeServiceType(listing.serviceType);
  if (normalizeCompanyType(company.companyType) !== serviceType) throw validation('Listing does not belong to this partner service workspace');
  if (typeof payload.branchId !== 'undefined') { const branch = await branchOrThrow(company.id, payload.branchId); listing.branchId = branch?.id || ''; listing.branchName = branchName(branch); }
  const wantsPublish = payload.status === LISTING_STATUS.ACTIVE || boolValue(payload.publish);
  if (wantsPublish) ensureCompanyCanPublish(company);
  const descriptionSupplied = ['description', 'sub', 'shortDescription'].some((field) => typeof payload[field] !== 'undefined');
  if (descriptionSupplied) {
    const publicDescription = assertPublicDescription(payload.description || payload.sub || payload.shortDescription, validation);
    listing.sub = publicDescription;
    listing.shortDescription = publicDescription.slice(0, 500);
  }
  const fields = ['title', 'city', 'country', 'address', 'from', 'to', 'corridor', 'policy', 'layout', 'cancellationRules', 'baggageRules', 'checkInTime', 'checkOutTime', 'stayType', 'serviceNotes', 'contactPhone', 'pickupInstructions', 'dropoffInstructions', 'pricingUnit', 'availabilityMode', 'vehicleCategory', 'transmission', 'fuelType'];
  fields.forEach((field) => { if (typeof payload[field] !== 'undefined') listing[field] = cleanText(payload[field]); });
  if (payload.amenities) listing.amenities = parseList(payload.amenities);
  if (typeof payload.cargoTypes !== 'undefined' || typeof payload.cargoType !== 'undefined') listing.cargoTypes = parseList(payload.cargoTypes || payload.cargoType);
  const media = payloadMedia(payload, listing.title);
  if (media.length) { listing.media = Array.isArray(listing.media) ? listing.media : []; listing.media.push(media[0]); listing.img = listing.img || mediaUrl(media[0]); }
  if (typeof payload.priceFrom !== 'undefined' || typeof payload.price !== 'undefined') { listing.priceFrom = moneyValue(payload.priceFrom ?? payload.price, listing.priceFrom); listing.price = listing.priceFrom; }
  const numericFields = ['inventory', 'remainingInventory', 'durationMinutes', 'maxGuests', 'minimumAge', 'seatsCount', 'weightLimitKg', 'packageLimit'];
  numericFields.forEach((field) => { if (typeof payload[field] !== 'undefined') listing[field] = Math.max(field === 'maxGuests' || field === 'seatsCount' || field === 'packageLimit' ? 1 : 0, moneyValue(payload[field], listing[field])); });
  if (typeof payload.inventory !== 'undefined' && typeof payload.remainingInventory === 'undefined') listing.remainingInventory = Math.max(0, moneyValue(payload.inventory, listing.remainingInventory));
  listing.serviceDetails = {
    ...(listing.serviceDetails || {}),
    ...(payload.serviceDetails && typeof payload.serviceDetails === 'object' ? payload.serviceDetails : {}),
  };
  ['meetingPoint', 'pickupLocation', 'returnLocation', 'driverOption', 'cargoDescription'].forEach((field) => { if (typeof payload[field] !== 'undefined') listing.serviceDetails[field] = cleanText(payload[field]); });
  if (typeof payload.deliveryAreas !== 'undefined') listing.serviceDetails.deliveryAreas = parseList(payload.deliveryAreas);
  if (typeof payload.included !== 'undefined') listing.serviceDetails.included = parseList(payload.included);
  if (typeof payload.excluded !== 'undefined') listing.serviceDetails.excluded = parseList(payload.excluded);
  if (payload.status && !wantsPublish) {
    const nextStatus = cleanText(payload.status, 40);
    if (!Object.values(LISTING_STATUS).includes(nextStatus)) throw validation('Invalid listing status');
    listing.status = nextStatus;
  }
  if (payload.title) listing.slug = await uniqueSlug(`${listing.title}-${company.name}`, companyRepository.listings, listing.id);
  if (!cleanText(company.operatingCurrency, 8)) throw validation('Company operating currency is required');
  listing.currency = cleanText(company.operatingCurrency, 8).toUpperCase();
  listing.isVerified = company.verificationStatus === COMPANY_STATUS.VERIFIED;
  if (!wantsPublish) {
    listing.bookable = false;
    listing.releaseStatus = listing.status === LISTING_STATUS.ARCHIVED ? 'archived' : listing.status === LISTING_STATUS.PAUSED ? 'paused' : 'draft';
  }
  listing.updatedAt = new Date().toISOString();
  await companyRepository.listings.save(listing, { id: listing.id });
  if (wantsPublish) return publishListing(company.id, listing.id, payload.actorId || payload.updatedBy || 'company-admin');
  return listing;
}

async function publishListing(companyId, listingId, actorId = 'company-admin') {
  const company = await companyOrThrow(companyId);
  const listing = await listingOrThrow(company.id, listingId);
  if (normalizeServiceType(listing.serviceType) === 'hotel') return hotelService.publishHotelListing(company.id, listing.id, actorId);
  ensureCompanyCanPublish(company);
  if (normalizeCompanyType(company.companyType) !== normalizeServiceType(listing.serviceType)) throw validation('Listing does not belong to this partner service workspace');
  validateGenericListingReadiness(listing);
  Object.assign(listing, {
    status: LISTING_STATUS.ACTIVE, bookable: true, releaseStatus: 'published', isVerified: true,
    publishedAt: listing.publishedAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  await companyRepository.withTransaction(async (session) => {
    await companyRepository.listings.save(listing, { id: listing.id }, { session });
    await writeAudit(actorId, 'listing.published', listing.id, { entityType: 'listing', companyId: company.id, serviceType: listing.serviceType }, { session });
  });
  return listing;
}
async function archiveListing(companyId, listingId) {
  const listing = await listingOrThrow(companyId, listingId);
  Object.assign(listing, { status: LISTING_STATUS.ARCHIVED, bookable: false, releaseStatus: 'archived', updatedAt: new Date().toISOString() });
  await companyRepository.listings.save(listing, { id: listing.id });
  return listing;
}

async function createBranch(companyId, payload = {}, actorId = 'company-admin') {
  const company = await companyOrThrow(companyId);
  const name = cleanText(payload.name || payload.branchName, 180);
  if (!name) throw validation('Branch or terminal name is required');
  const branchType = cleanText(payload.branchType || (company.companyType === 'hotel' ? 'property' : 'terminal'), 80);
  const status = cleanText(payload.status || 'active', 40);
  if (!BRANCH_TYPES.includes(branchType)) throw validation('Invalid branch type');
  if (!BRANCH_STATUSES.includes(status)) throw validation('Invalid branch status');
  const branch = {
    id: await nextId('branch'), companyId: company.id, name, branchType,
    terminalCode: cleanText(payload.terminalCode || payload.code || '', 40), city: cleanText(payload.city || company.city || '', 140), country: cleanText(payload.country || company.country || '', 100),
    address: cleanText(payload.address || '', 300), contactName: cleanText(payload.contactName || '', 180), contactPhone: cleanText(payload.contactPhone || '', 60),
    contactEmail: cleanText(payload.contactEmail || '', 254).toLowerCase(), operatingHours: cleanText(payload.operatingHours || '', 300),
    serviceCategories: parseList(payload.serviceCategories || payload.categories || company.companyType || ''), amenities: parseList(payload.amenities),
    status, createdBy: actorId, createdAt: new Date().toISOString(),
  };
  await companyRepository.withTransaction(async (session) => {
    await companyRepository.branches.save(branch, { id: branch.id }, { session });
    await writeAudit(actorId, 'company.branch.created', branch.id, { companyId: company.id, entityType: 'company_branch' }, { session });
  });
  return branch;
}
async function createPolicy(companyId, payload = {}, actorId = 'company-admin') {
  const company = await companyOrThrow(companyId);
  const title = cleanText(payload.title || payload.policyTitle, 180);
  if (!title) throw validation('Policy title is required');
  const policyType = cleanText(payload.policyType || 'operations', 80);
  const status = cleanText(payload.status || 'active', 40);
  if (!POLICY_TYPES.includes(policyType)) throw validation('Invalid policy type');
  if (!POLICY_STATUSES.includes(status)) throw validation('Invalid policy status');
  const branchIds = parseList(payload.appliesToBranches || payload.branchIds);
  if (branchIds.length) {
    const validBranches = await companyRepository.branches.list({ companyId: company.id, id: { $in: branchIds }, status: { $ne: 'archived' } });
    if (validBranches.length !== branchIds.length) throw validation('One or more selected policy branches do not belong to this company');
  }
  const policy = {
    id: await nextId('policy'), companyId: company.id, title, policyType,
    serviceCategory: cleanText(payload.serviceCategory || payload.serviceType || company.companyType || '', 80), summary: cleanText(payload.summary || payload.description || '', 3000),
    customerVisible: boolValue(payload.customerVisible), appliesToBranches: branchIds,
    status, createdBy: actorId, createdAt: new Date().toISOString(),
  };
  await companyRepository.withTransaction(async (session) => {
    await companyRepository.policies.save(policy, { id: policy.id }, { session });
    await writeAudit(actorId, 'company.policy.created', policy.id, { companyId: company.id, policyType: policy.policyType, entityType: 'company_policy' }, { session });
  });
  return policy;
}

async function updateBranch(companyId, branchId, payload = {}, actorId = 'company-admin') {
  const company = await companyOrThrow(companyId);
  const branch = await companyRepository.branches.findOne({ companyId: company.id, id: cleanText(branchId, 180) });
  if (!branch) throw notFound('Branch, terminal, or property desk not found for this company');
  if (Object.prototype.hasOwnProperty.call(payload, 'name') || Object.prototype.hasOwnProperty.call(payload, 'branchName')) {
    const name = cleanText(payload.name || payload.branchName, 180);
    if (!name) throw validation('Branch or terminal name is required');
    branch.name = name;
  }
  if (payload.branchType) {
    const branchType = cleanText(payload.branchType, 80);
    if (!BRANCH_TYPES.includes(branchType)) throw validation('Invalid branch type');
    branch.branchType = branchType;
  }
  if (payload.status) {
    const status = cleanText(payload.status, 40);
    if (!BRANCH_STATUSES.includes(status)) throw validation('Invalid branch status');
    branch.status = status;
  }
  const textFields = ['terminalCode','city','country','address','contactName','contactPhone','contactEmail','operatingHours'];
  textFields.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) return;
    const max = field === 'address' || field === 'operatingHours' ? 300 : field === 'contactEmail' ? 254 : field === 'terminalCode' ? 40 : 180;
    branch[field] = cleanText(payload[field], max);
    if (field === 'contactEmail') branch[field] = branch[field].toLowerCase();
  });
  if (Object.prototype.hasOwnProperty.call(payload, 'serviceCategories') || Object.prototype.hasOwnProperty.call(payload, 'categories')) branch.serviceCategories = parseList(payload.serviceCategories || payload.categories);
  if (Object.prototype.hasOwnProperty.call(payload, 'amenities')) branch.amenities = parseList(payload.amenities);
  branch.updatedBy = actorId;
  branch.updatedAt = new Date().toISOString();
  await companyRepository.withTransaction(async (session) => {
    await companyRepository.branches.save(branch, { id: branch.id }, { session });
    await writeAudit(actorId, 'company.branch.updated', branch.id, { companyId: company.id, entityType: 'company_branch', status: branch.status }, { session });
  });
  return branch;
}

async function updatePolicy(companyId, policyId, payload = {}, actorId = 'company-admin') {
  const company = await companyOrThrow(companyId);
  const policy = await companyRepository.policies.findOne({ companyId: company.id, id: cleanText(policyId, 180) });
  if (!policy) throw notFound('Company policy not found');
  if (Object.prototype.hasOwnProperty.call(payload, 'title') || Object.prototype.hasOwnProperty.call(payload, 'policyTitle')) {
    const title = cleanText(payload.title || payload.policyTitle, 180);
    if (!title) throw validation('Policy title is required');
    policy.title = title;
  }
  if (payload.policyType) {
    const policyType = cleanText(payload.policyType, 80);
    if (!POLICY_TYPES.includes(policyType)) throw validation('Invalid policy type');
    policy.policyType = policyType;
  }
  if (payload.status) {
    const status = cleanText(payload.status, 40);
    if (!POLICY_STATUSES.includes(status)) throw validation('Invalid policy status');
    policy.status = status;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'serviceCategory') || Object.prototype.hasOwnProperty.call(payload, 'serviceType')) policy.serviceCategory = cleanText(payload.serviceCategory || payload.serviceType, 80);
  if (Object.prototype.hasOwnProperty.call(payload, 'summary') || Object.prototype.hasOwnProperty.call(payload, 'description')) policy.summary = cleanText(payload.summary || payload.description, 3000);
  if (Object.prototype.hasOwnProperty.call(payload, 'customerVisible')) policy.customerVisible = boolValue(payload.customerVisible);
  if (Object.prototype.hasOwnProperty.call(payload, 'appliesToBranches') || Object.prototype.hasOwnProperty.call(payload, 'branchIds')) {
    const branchIds = parseList(payload.appliesToBranches || payload.branchIds);
    if (branchIds.length) {
      const validBranches = await companyRepository.branches.list({ companyId: company.id, id: { $in: branchIds }, status: { $ne: 'archived' } });
      if (validBranches.length !== branchIds.length) throw validation('One or more selected policy branches do not belong to this company');
    }
    policy.appliesToBranches = branchIds;
  }
  policy.updatedBy = actorId;
  policy.updatedAt = new Date().toISOString();
  await companyRepository.withTransaction(async (session) => {
    await companyRepository.policies.save(policy, { id: policy.id }, { session });
    await writeAudit(actorId, 'company.policy.updated', policy.id, { companyId: company.id, policyType: policy.policyType, entityType: 'company_policy', status: policy.status }, { session });
  });
  return policy;
}

async function updateEmployeeRole(companyId, employeeId, payload = {}, actorId = 'company-admin') {
  const employee = await employeeOrThrow(companyId, employeeId);
  const user = await employeeUser(employee);
  const scopes = await validateEmployeeScopes(companyId, payload, employee);
  if (hasOwn(payload, 'fullName') || hasOwn(payload, 'name')) {
    const fullName = cleanText(payload.fullName || payload.name, 180);
    if (!fullName) throw validation('Employee name is required');
    employee.fullName = fullName;
    if (user) user.fullName = fullName;
  }
  if (hasOwn(payload, 'email')) {
    const email = cleanText(payload.email, 254).toLowerCase();
    if (!email) throw validation('Employee email is required');
    const duplicate = await companyRepository.users.findOne({ email, ...(user?.id ? { id: { $ne: user.id } } : {}) });
    if (duplicate) throw conflict('Another account already uses this email address');
    employee.email = email;
    if (user) user.email = email;
  }
  if (hasOwn(payload, 'phone')) {
    const phone = cleanText(payload.phone, 80);
    employee.phone = phone;
    if (user) user.phone = phone;
  }
  if (payload.roleTitle) employee.roleTitle = cleanText(payload.roleTitle, 120);
  employee.branchId = scopes.branch?.id || '';
  employee.branchName = branchName(scopes.branch);
  employee.branch = employee.branchName;
  employee.listingIds = scopes.listingIds;
  employee.scheduleIds = scopes.scheduleIds;
  if (payload.permissions !== undefined) employee.permissions = employeePermissions(employee.roleTitle, payload.permissions);
  if (payload.serviceCategories) employee.serviceCategories = parseList(payload.serviceCategories);
  if (hasOwn(payload, 'shift')) employee.shift = cleanText(payload.shift, 120);
  if (hasOwn(payload, 'notes') || hasOwn(payload, 'note')) employee.notes = cleanText(payload.notes || payload.note, 2000);
  if (payload.status) {
    const allowed = ['requested', 'invited', 'pending_verification', 'active', 'suspended', 'rejected', 'revoked'];
    const nextStatus = cleanText(payload.status, 40);
    if (!allowed.includes(nextStatus)) throw validation('Invalid employee status');
    const employeeIsDriver = normalize(user?.role) === 'driver' || /driver/i.test(employee.roleTitle || '');
    if (nextStatus === 'active') {
      employee.status = 'active';
      employee.approvedAt = employee.approvedAt || new Date().toISOString();
      employee.approvedBy = actorId;
      if (employeeIsDriver) {
        employee.permissions = normalizePermissions([...(employee.permissions || []), ...REQUIRED_DRIVER_PERMISSIONS]);
        employee.serviceCategories = Array.from(new Set([...(employee.serviceCategories || []), 'driver', 'bus']));
      }
      if (user) {
        user.status = 'active';
        user.companyId = companyId;
        user.role = employeeIsDriver ? 'driver' : (user.role || 'company_employee');
        user.verificationStatus = employeeIsDriver ? 'company_verified' : (user.verificationStatus || 'company_verified');
        user.onboardingStatus = user.passwordHash ? 'complete' : 'account_setup_pending';
      }
    } else {
      employee.status = nextStatus;
      if (user) {
        user.status = nextStatus === 'suspended' ? 'suspended' : ['rejected', 'revoked'].includes(nextStatus) ? 'blocked' : 'pending';
        if (nextStatus !== 'suspended') user.onboardingStatus = nextStatus;
      }
    }
  }
  employee.updatedBy = actorId; employee.updatedAt = new Date().toISOString();
  if (user) user.permissionsLabel = (employee.permissions || []).join(', ');
  await companyRepository.withTransaction(async (session) => {
    await companyRepository.employees.save(employee, { id: employee.id }, { session });
    if (user) await companyRepository.users.save(user, { id: user.id }, { session });
    await writeAudit(actorId, 'company.employee.role_updated', employee.id, { companyId, roleTitle: employee.roleTitle, entityType: 'company_employee' }, { session });
  });
  return { employee, user: user || {} };
}
async function updateDriverProfile(companyId, employeeId, payload = {}, actorId = 'company-admin') {
  const normalizedPayload = { ...payload, roleTitle: payload.roleTitle || 'Driver' };
  const { employee, user } = await updateEmployeeRole(companyId, employeeId, normalizedPayload, actorId);
  employee.licenseNumber = cleanText(payload.licenseNumber || employee.licenseNumber || '', 120);
  employee.licenseClass = cleanText(payload.licenseClass || employee.licenseClass || '', 80);
  employee.licenseExpiresAt = payload.licenseExpiresAt ? new Date(payload.licenseExpiresAt).toISOString() : employee.licenseExpiresAt;
  employee.safetyStatus = cleanText(payload.safetyStatus || employee.safetyStatus || 'pending_review', 40);
  if (!['not_submitted', 'pending_review', 'cleared', 'rejected'].includes(employee.safetyStatus)) throw validation('Invalid driver safety status');
  if (hasOwn(payload, 'vehicleId') || hasOwn(payload, 'assignedFleetId')) {
    const selectedVehicleId = cleanText(payload.vehicleId || payload.assignedFleetId || '', 180);
    employee.assignedFleetId = selectedVehicleId ? (await vehicleOrThrow(companyId, selectedVehicleId)).id : '';
  }
  employee.driverProfileUpdatedAt = new Date().toISOString();
  employee.documents = Array.isArray(employee.documents) ? employee.documents : [];
  if (payload.documentReference || payload.documentUrl || payload.documentType) employee.documents.push({
    documentType: cleanText(payload.documentType || 'driver_license', 80), documentReference: cleanText(payload.documentReference || payload.licenseNumber || '', 200),
    documentUrl: cleanText(payload.documentUrl || '', 2000), status: cleanText(payload.documentStatus || 'pending_review', 40), uploadedBy: actorId, uploadedAt: new Date().toISOString(),
  });
  await companyRepository.withTransaction(async (session) => {
    await companyRepository.employees.save(employee, { id: employee.id }, { session });
    await writeAudit(actorId, 'company.driver.profile_updated', employee.id, { companyId, safetyStatus: employee.safetyStatus, entityType: 'company_employee' }, { session });
  });
  return { employee, user };
}

async function archiveBranch(companyId, branchId, actorId = 'company-admin') {
  return updateBranch(companyId, branchId, { status: 'archived' }, actorId);
}

async function archivePolicy(companyId, policyId, actorId = 'company-admin') {
  return updatePolicy(companyId, policyId, { status: 'archived' }, actorId);
}

async function revokeEmployee(companyId, employeeId, actorId = 'company-admin') {
  return updateEmployeeRole(companyId, employeeId, { status: 'revoked' }, actorId);
}


async function activateDriverByCompany(companyId, employeeId, payload = {}, actorId = 'company-admin') {
  const company = await companyOrThrow(companyId);
  if (normalize(company.status) !== 'active' || normalize(company.verificationStatus) !== 'verified') {
    throw conflict('Super Admin must approve the partner company before its Partner Admin can activate employees');
  }

  const employee = await employeeOrThrow(companyId, employeeId);
  const user = await employeeUser(employee);
  if (hasOwn(payload, 'licenseNumber')) employee.licenseNumber = cleanText(payload.licenseNumber, 120);
  if (hasOwn(payload, 'licenseClass')) employee.licenseClass = cleanText(payload.licenseClass, 80);
  if (payload.licenseExpiresAt) {
    const licenseExpiry = new Date(payload.licenseExpiresAt);
    if (Number.isNaN(licenseExpiry.getTime())) throw validation('Enter a valid driver licence expiry date');
    employee.licenseExpiresAt = licenseExpiry.toISOString();
  }
  employee.documents = Array.isArray(employee.documents) ? employee.documents : [];
  if (payload.documentReference) {
    const reference = cleanText(payload.documentReference, 500);
    const existing = employee.documents.some((document) => cleanText(document.documentReference || document.reference || document.url || '', 500) === reference);
    if (!existing) employee.documents.unshift({
      documentType: 'driver_license', documentReference: reference, status: 'company_approved',
      uploadedBy: actorId, uploadedAt: new Date().toISOString(),
    });
  }

  const now = new Date().toISOString();
  employee.roleTitle = 'Driver';
  employee.permissions = normalizePermissions([...(employee.permissions || []), ...REQUIRED_DRIVER_PERMISSIONS]);
  employee.serviceCategories = Array.from(new Set([...(employee.serviceCategories || []), 'driver', 'bus']));
  employee.status = cleanText(payload.status || 'active', 40);
  if (!['active', 'suspended', 'pending_verification', 'invited', 'requested'].includes(employee.status)) employee.status = 'active';
  employee.safetyStatus = cleanText(payload.safetyStatus || (employee.status === 'active' ? 'cleared' : employee.safetyStatus || 'pending_review'), 40);
  if (!['not_submitted', 'pending_review', 'cleared', 'rejected'].includes(employee.safetyStatus)) employee.safetyStatus = 'pending_review';
  employee.approvedAt = employee.status === 'active' ? now : employee.approvedAt;
  employee.approvedBy = actorId;
  employee.verifiedAt = employee.status === 'active' ? now : employee.verifiedAt;
  employee.verifiedBy = actorId;
  employee.onboardingStatus = user?.passwordHash ? 'complete' : 'account_setup_pending';
  employee.notes = cleanText(payload.note || employee.notes || '', 2000);
  employee.updatedAt = now;

  if (user) {
    user.companyId = companyId;
    user.role = 'driver';
    user.status = employee.status === 'suspended' ? 'suspended' : 'active';
    user.isVerified = true;
    user.verificationStatus = 'company_verified';
    user.onboardingStatus = user.passwordHash ? 'complete' : 'account_setup_pending';
    user.updatedAt = now;
  }

  await companyRepository.withTransaction(async (session) => {
    await companyRepository.employees.save(employee, { id: employee.id }, { session });
    if (user) await companyRepository.users.save(user, { id: user.id }, { session });
    await writeAudit(actorId, 'company.driver.status_updated', employee.id, {
      companyId, userId: user?.id || '', status: employee.status, safetyStatus: employee.safetyStatus,
      approvalOwner: 'partner_admin', entityType: 'company_employee',
    }, { session });
  });
  return { employee, user: user || {}, eligibility: evaluateDriverEligibility(employee, user || {}) };
}

async function assignDriver(companyId, employeeId, payload = {}, actorId = 'company-admin') {
  const employee = await employeeOrThrow(companyId, employeeId);
  const user = await employeeUser(employee) || {};
  const vehicle = payload.vehicleId ? await vehicleOrThrow(companyId, payload.vehicleId) : null;
  const schedule = payload.scheduleId ? await scheduleOrThrow(companyId, payload.scheduleId) : null;
  if (!vehicle && !schedule) throw validation('Select a vehicle or schedule for the driver assignment');
  const driverAssignment = evaluateDriverAssignment(employee, user);
  if (!driverAssignment.assignable) {
    throw validation(`Selected employee cannot be assigned as a driver: ${driverAssignment.reasons.join('; ')}`);
  }
  const assignment = {
    id: await nextId('driver-assignment'), companyId, employeeId: employee.id, driverUserId: employee.userId,
    vehicleId: vehicle?.id || cleanText(payload.vehicleId || '', 180), scheduleId: schedule?.id || cleanText(payload.scheduleId || '', 180),
    routeId: schedule?.routeId || cleanText(payload.routeId || '', 180), listingId: schedule?.listingId || vehicle?.listingId || cleanText(payload.listingId || '', 180),
    assignmentType: schedule ? 'schedule' : 'vehicle', startsAt: payload.startsAt ? new Date(payload.startsAt).toISOString() : schedule?.departAt || '',
    endsAt: payload.endsAt ? new Date(payload.endsAt).toISOString() : '', safetyStatus: cleanText(payload.safetyStatus || employee.safetyStatus || 'pending_review', 40),
    status: cleanText(payload.status || 'active', 40), note: cleanText(payload.note || '', 1000), assignedBy: actorId, createdAt: new Date().toISOString(),
  };
  employee.assignedFleetId = vehicle?.id || employee.assignedFleetId || ''; employee.lastAssignedAt = assignment.createdAt;
  if (vehicle) Object.assign(vehicle, { assignedDriverId: employee.id, assignedDriverUserId: employee.userId, assignedDriverName: user.fullName || user.email || employee.id, updatedAt: assignment.createdAt });
  if (schedule) Object.assign(schedule, {
    driverEmployeeId: employee.id, driverUserId: employee.userId,
    driverIds: Array.from(new Set([...(Array.isArray(schedule.driverIds) ? schedule.driverIds : parseList(schedule.driverIds)), employee.id, employee.userId].filter(Boolean))),
    driverName: user.fullName || user.email || schedule.driverName || employee.id, assignmentStatus: assignment.status, updatedAt: assignment.createdAt,
  });
  await companyRepository.withTransaction(async (session) => {
    await companyRepository.driverAssignments.save(assignment, { id: assignment.id }, { session });
    await companyRepository.employees.save(employee, { id: employee.id }, { session });
    if (vehicle) await companyRepository.vehicles.save(vehicle, { id: vehicle.id }, { session });
    if (schedule) await companyRepository.schedules.save(schedule, { id: schedule.id }, { session });
    await writeAudit(actorId, 'company.driver.assigned', assignment.id, { companyId, employeeId: employee.id, scheduleId: assignment.scheduleId, vehicleId: assignment.vehicleId, entityType: 'driver_assignment' }, { session });
  });
  return assignment;
}
async function assertDriverAssignedToSchedule(companyId, schedule, driverUserId, actorRole) {
  if (actorRole !== 'driver') return;
  const assignments = await companyRepository.driverAssignments.list({ companyId }, { limit: 5000 });
  if (!assignments.length) throw Object.assign(new Error('No active driver assignment exists for this company'), { status: 403 });
  const isAssigned = assignments.some((row) => row.driverUserId === driverUserId && !['cancelled', 'archived', 'revoked'].includes(row.status) && (row.scheduleId === schedule.id || (row.vehicleId && row.vehicleId === schedule.vehicleId)));
  if (!isAssigned) throw Object.assign(new Error('You are not assigned to this trip'), { status: 403 });
}
async function updateTripStatus(companyId, scheduleId, payload = {}, actorId = 'driver', actorRole = '') {
  const schedule = await scheduleOrThrow(companyId, scheduleId);
  await assertDriverAssignedToSchedule(companyId, schedule, actorId, actorRole);
  const status = normalize(payload.status);
  const permittedDriverStatuses = ['boarding', 'departed', 'delayed', 'arrived', 'completed'];
  if (!permittedDriverStatuses.includes(status)) throw validation('Select a permitted trip status');
  const safeCount = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
  };
  const now = new Date().toISOString();
  const update = {
    id: await nextId('trip-status'), companyId, scheduleId: schedule.id, vehicleId: schedule.vehicleId || '', driverUserId: actorId,
    status, location: cleanText(payload.location || '', 300), note: cleanText(payload.note || '', 1000),
    passengerCount: safeCount(payload.passengerCount), checkedInCount: safeCount(payload.checkedInCount), noShowCount: safeCount(payload.noShowCount),
    createdBy: actorId, createdAt: now,
  };
  Object.assign(schedule, { tripStatus: status, tripStatusLocation: update.location, tripStatusNote: update.note, tripStatusUpdatedAt: now, updatedAt: now });
  await companyRepository.withTransaction(async (session) => {
    await companyRepository.tripStatusUpdates.save(update, { id: update.id }, { session });
    await companyRepository.schedules.save(schedule, { id: schedule.id }, { session });
    await writeAudit(actorId, 'driver.trip_status.updated', schedule.id, { companyId, status, entityType: 'trip_schedule' }, { session });
  });
  return { schedule, update };
}
async function createDriverIncident(companyId, payload = {}, actorId = 'driver', actorRole = '') {
  const schedule = payload.scheduleId ? await scheduleOrThrow(companyId, payload.scheduleId) : null;
  if (schedule) await assertDriverAssignedToSchedule(companyId, schedule, actorId, actorRole);
  const title = cleanText(payload.title || payload.description || 'Driver incident', 240);
  if (!title) throw validation('Incident title or description is required');
  const category = cleanText(payload.category || 'general', 40);
  const severity = cleanText(payload.severity || 'normal', 40);
  const incidentCategories = ['general', 'vehicle', 'safety', 'passenger', 'route', 'security', 'operations'];
  const incidentSeverities = ['low', 'medium', 'normal', 'high', 'critical'];
  const incident = {
    id: await nextId('driver-incident'), companyId, scheduleId: schedule?.id || cleanText(payload.scheduleId || '', 180), bookingRef: cleanText(payload.bookingRef || '', 180),
    vehicleId: cleanText(payload.vehicleId || schedule?.vehicleId || '', 180), driverUserId: actorId,
    category: incidentCategories.includes(category) ? category : 'general', severity: incidentSeverities.includes(severity) ? severity : 'normal',
    title, description: cleanText(payload.description || payload.note || title, 3000), location: cleanText(payload.location || '', 300), status: 'open',
    auditTrail: [{ actorId, action: 'created', at: new Date().toISOString() }], createdAt: new Date().toISOString(),
  };
  await companyRepository.withTransaction(async (session) => {
    await companyRepository.driverIncidents.save(incident, { id: incident.id }, { session });
    await writeAudit(actorId, 'driver.incident.created', incident.id, { companyId, scheduleId: incident.scheduleId, severity: incident.severity, entityType: 'driver_incident' }, { session });
  });
  return incident;
}

async function inviteEmployee(companyId, payload = {}) {
  const company = await companyOrThrow(companyId);
  const email = cleanText(payload.email, 254).toLowerCase();
  if (!email) throw validation('Employee email is required');
  const existingUser = await companyRepository.users.findOne({ email });
  if (existingUser) throw conflict('An account already uses this email. Use the secure existing-account linking workflow instead of overwriting it.');
  const scopes = await validateEmployeeScopes(company.id, payload, {});
  const invitationService = require('../onboarding/invitationService');
  const { employeePermissions } = require('../../config/accessControl');
  const roleTitle = cleanText(payload.roleTitle || 'Staff member', 180);
  const requestedPermissions = normalizePermissions(payload.permissions || []);
  const driverOnlyPermissions = new Set(['checkin.assist', 'trip.status.update', 'incident.create']);
  const isDriverRole = /driver/i.test(roleTitle) || requestedPermissions.some((permission) => driverOnlyPermissions.has(permission));
  return invitationService.createInvitation({
    type: isDriverRole ? 'driver' : 'staff',
    fullName: payload.fullName || payload.name,
    email,
    phone: payload.phone,
    companyId: company.id,
    companyName: company.name,
    roleTitle,
    permissions: employeePermissions(isDriverRole ? 'Driver' : roleTitle, payload.permissions || []),
    branchId: scopes.branch?.id || '',
    listingIds: scopes.listingIds,
    scheduleIds: scopes.scheduleIds,
    serviceCategories: parseList(payload.serviceCategories || company.companyType || ''),
    shift: cleanText(payload.shift, 120),
    notes: cleanText(payload.notes || payload.note, 2000),
    termsSummary: 'Access is limited to the assigned company, branch, listings, schedules, and permissions.',
    validDays: 7,
  }, payload.invitedBy || company.ownerId || 'company-admin', 'company_staff');
}

function normalizeMediaAsset(asset = {}, target = '', metadata = {}) {
  const url = cleanText(asset.secureUrl || asset.url || '', 2000);
  return {
    id: cleanText(metadata.id || asset.id || asset.publicId || asset.public_id || `media-${Date.now()}`, 500), url, secureUrl: url,
    publicId: cleanText(asset.publicId || asset.public_id || url, 500), alt: cleanText(metadata.alt || asset.alt || '', 240), label: cleanText(metadata.label || asset.label || '', 240),
    width: asset.width, height: asset.height, format: cleanText(asset.format, 30), resourceType: cleanText(asset.resourceType || asset.resource_type || 'image', 40),
    target, uploadedBy: cleanText(metadata.uploadedBy || '', 180), uploadedAt: metadata.uploadedAt || new Date().toISOString(),
  };
}
function readableDocumentLabel(value) { return cleanText(value).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function decorateDocumentMedia(media = {}, metadata = {}, fallbackType = 'document') {
  const documentType = cleanText(metadata.documentType || media.documentType || fallbackType, 80);
  const label = cleanText(metadata.label || media.label || readableDocumentLabel(documentType) || 'Document', 240);
  return { ...media, label, alt: cleanText(metadata.alt || media.alt || label, 240), documentType, documentReference: cleanText(metadata.documentReference || media.documentReference || '', 300), note: cleanText(metadata.note || media.note || '', 1000), status: cleanText(metadata.status || media.status || 'pending_review', 40), reviewedBy: cleanText(metadata.reviewedBy || media.reviewedBy || '', 180), reviewedAt: metadata.reviewedAt || media.reviewedAt || '' };
}
function mediaMatches(media = {}, publicId = '') { const key = cleanText(publicId, 2000); return key && [media.publicId, media.public_id, media.url, media.secureUrl, media.id].some((value) => cleanText(value, 2000) === key); }

async function attachMedia({ companyId, target, targetId, asset, metadata = {} }) {
  const company = await companyOrThrow(companyId);
  const media = normalizeMediaAsset(asset, target, metadata);
  if (!media.url) throw validation('Uploaded media URL is required');
  const actor = metadata.uploadedBy || 'system';
  if (target === 'companyLogo' || target === 'companyCover') {
    media.label = media.label || `${company.name} ${target === 'companyLogo' ? 'logo' : 'cover image'}`;
    company[target === 'companyLogo' ? 'logo' : 'coverImage'] = media;
    await companyRepository.withTransaction(async (session) => {
      await companyRepository.companies.save(company, { id: company.id }, { session });
      await writeAudit(actor, 'company.media.attached', company.id, { target, publicId: media.publicId, entityType: 'company' }, { session });
    });
    return { target: 'company', company, media };
  }
  if (target === 'companyDocument' || target === 'companyVerificationDocument') {
    company.documents = Array.isArray(company.documents) ? company.documents : [];
    const documentMedia = decorateDocumentMedia(media, metadata, target === 'companyVerificationDocument' ? 'verification_document' : 'business_license');
    company.documents.push(documentMedia);
    await companyRepository.withTransaction(async (session) => {
      await companyRepository.companies.save(company, { id: company.id }, { session });
      await writeAudit(actor, 'company.document.uploaded', company.id, { publicId: documentMedia.publicId, documentType: documentMedia.documentType, entityType: 'company' }, { session });
    });
    await require('../onboarding/verificationService').submitCompanyChecklist(company.id, { documentReference: documentMedia.documentReference, supportPhone: company.supportContacts?.phone, supportEmail: company.supportContacts?.email }, actor);
    return { target: 'company', company, media: documentMedia };
  }
  if (['listingMedia', 'busListing', 'hotelListing'].includes(target)) {
    const listing = await listingOrThrow(company.id, targetId); listing.media = Array.isArray(listing.media) ? listing.media : []; media.label = media.label || listing.title; listing.media.push(media); listing.img = listing.img || mediaUrl(media);
    await companyRepository.withTransaction(async (session) => { await companyRepository.listings.save(listing, { id: listing.id }, { session }); await writeAudit(actor, 'listing.media.attached', listing.id, { target, publicId: media.publicId, entityType: 'listing' }, { session }); });
    return { target: 'listing', listing, media };
  }
  if (target === 'vehiclePhoto' || target === 'vehicleDocument') {
    const vehicle = await vehicleOrThrow(company.id, targetId || metadata.targetId); vehicle.media = Array.isArray(vehicle.media) ? vehicle.media : [];
    const vehicleMedia = target === 'vehicleDocument' ? decorateDocumentMedia(media, metadata, 'vehicle_document') : { ...media, label: media.label || vehicle.name || 'Vehicle photo' }; vehicle.media.push(vehicleMedia);
    await companyRepository.withTransaction(async (session) => { await companyRepository.vehicles.save(vehicle, { id: vehicle.id }, { session }); await writeAudit(actor, target === 'vehicleDocument' ? 'vehicle.document.uploaded' : 'vehicle.media.uploaded', vehicle.id, { companyId: company.id, publicId: vehicleMedia.publicId, entityType: 'vehicle' }, { session }); });
    return { target: 'vehicle', vehicle, media: vehicleMedia };
  }
  if (target === 'driverDocument') {
    const driver = await employeeOrThrow(company.id, targetId || metadata.targetId); driver.documents = Array.isArray(driver.documents) ? driver.documents : [];
    const driverMedia = decorateDocumentMedia(media, metadata, 'driver_license'); driver.documents.unshift(driverMedia); driver.safetyStatus = 'pending_review';
    await companyRepository.withTransaction(async (session) => { await companyRepository.employees.save(driver, { id: driver.id }, { session }); await writeAudit(actor, 'driver.document.uploaded', driver.id, { companyId: company.id, publicId: driverMedia.publicId, entityType: 'company_employee' }, { session }); });
    await require('../onboarding/verificationService').submitDriverChecklist(driver.id, { documentType: driverMedia.documentType, documentReference: driverMedia.documentReference, licenseNumber: driver.licenseNumber }, actor, company.id);
    return { target: 'driver', driver, media: driverMedia };
  }
  if (target === 'hotelPropertyMedia') {
    const property = await hotelPropertyOrThrow(company.id, targetId || metadata.targetId); property.media = Array.isArray(property.media) ? property.media : [];
    const propertyMedia = /document|license|permit/i.test(metadata.documentType || '') ? decorateDocumentMedia(media, metadata, 'hotel_property_document') : { ...media, label: media.label || property.propertyName || 'Hotel property media' }; property.media.push(propertyMedia);
    await companyRepository.withTransaction(async (session) => { await companyRepository.hotelProperties.save(property, { id: property.id }, { session }); await writeAudit(actor, 'hotel.property.media.uploaded', property.id, { companyId: company.id, publicId: propertyMedia.publicId, entityType: 'hotel_property' }, { session }); });
    return { target: 'hotelProperty', property, media: propertyMedia };
  }
  if (target === 'roomTypeMedia') {
    const roomType = await roomTypeOrThrow(company.id, targetId || metadata.targetId); roomType.images = Array.isArray(roomType.images) ? roomType.images : [];
    const roomTypeMedia = { ...media, label: media.label || roomType.name || 'Room type media' }; roomType.images.push(roomTypeMedia);
    await companyRepository.withTransaction(async (session) => { await companyRepository.roomTypes.save(roomType, { id: roomType.id }, { session }); await writeAudit(actor, 'hotel.room_type.media.uploaded', roomType.id, { companyId: company.id, publicId: roomTypeMedia.publicId, entityType: 'room_type' }, { session }); });
    return { target: 'roomType', roomType, media: roomTypeMedia };
  }
  if (target === 'roomUnitMedia' || target === 'guestDocument') {
    const roomUnit = await roomUnitOrThrow(company.id, targetId || metadata.targetId); roomUnit.media = Array.isArray(roomUnit.media) ? roomUnit.media : []; roomUnit.documents = Array.isArray(roomUnit.documents) ? roomUnit.documents : [];
    const unitMedia = target === 'guestDocument' ? decorateDocumentMedia(media, metadata, 'guest_identity_document') : { ...media, label: media.label || roomUnit.unitNumber || 'Room unit media' };
    if (target === 'guestDocument') roomUnit.documents.unshift(unitMedia); else roomUnit.media.push(unitMedia);
    await companyRepository.withTransaction(async (session) => { await companyRepository.roomUnits.save(roomUnit, { id: roomUnit.id }, { session }); await writeAudit(actor, target === 'guestDocument' ? 'hotel.guest.document.uploaded' : 'hotel.room_unit.media.uploaded', roomUnit.id, { companyId: company.id, publicId: unitMedia.publicId, entityType: 'room_unit' }, { session }); });
    return { target: 'roomUnit', roomUnit, media: unitMedia };
  }
  throw validation('Unsupported media target');
}

async function removeMedia({ companyId, target, targetId, publicId, actorId = 'system' }) {
  const company = await companyOrThrow(companyId); let removedMedia = null;
  if (target === 'companyLogo' || target === 'companyCover') {
    const key = target === 'companyLogo' ? 'logo' : 'coverImage';
    if (company[key] && (!publicId || mediaMatches(company[key], publicId))) { removedMedia = company[key]; company[key] = null; }
    await companyRepository.withTransaction(async (session) => { await companyRepository.companies.save(company, { id: company.id }, { session }); await writeAudit(actorId, 'company.media.deleted', company.id, { target, publicId: removedMedia?.publicId || publicId, entityType: 'company' }, { session }); });
    return { target: 'company', company, media: removedMedia };
  }
  if (target === 'companyDocument' || target === 'companyVerificationDocument') {
    company.documents = (company.documents || []).filter((document) => { const match = mediaMatches(document, publicId); if (match) removedMedia = document; return !match; });
    await companyRepository.withTransaction(async (session) => { await companyRepository.companies.save(company, { id: company.id }, { session }); await writeAudit(actorId, 'company.document.deleted', company.id, { publicId: removedMedia?.publicId || publicId, entityType: 'company' }, { session }); });
    return { target: 'company', company, media: removedMedia };
  }
  const configs = {
    listingMedia: [companyRepository.listings, () => listingOrThrow(company.id, targetId), 'media', 'listing.media.deleted', 'listing'],
    busListing: [companyRepository.listings, () => listingOrThrow(company.id, targetId), 'media', 'listing.media.deleted', 'listing'],
    hotelListing: [companyRepository.listings, () => listingOrThrow(company.id, targetId), 'media', 'listing.media.deleted', 'listing'],
    vehiclePhoto: [companyRepository.vehicles, () => vehicleOrThrow(company.id, targetId), 'media', 'vehicle.media.deleted', 'vehicle'],
    vehicleDocument: [companyRepository.vehicles, () => vehicleOrThrow(company.id, targetId), 'media', 'vehicle.media.deleted', 'vehicle'],
    driverDocument: [companyRepository.employees, () => employeeOrThrow(company.id, targetId), 'documents', 'driver.document.deleted', 'company_employee'],
    hotelPropertyMedia: [companyRepository.hotelProperties, () => hotelPropertyOrThrow(company.id, targetId), 'media', 'hotel.property.media.deleted', 'hotel_property'],
    roomTypeMedia: [companyRepository.roomTypes, () => roomTypeOrThrow(company.id, targetId), 'images', 'hotel.room_type.media.deleted', 'room_type'],
    roomUnitMedia: [companyRepository.roomUnits, () => roomUnitOrThrow(company.id, targetId), 'media', 'hotel.room_unit.media.deleted', 'room_unit'],
    guestDocument: [companyRepository.roomUnits, () => roomUnitOrThrow(company.id, targetId), 'documents', 'hotel.guest.document.deleted', 'room_unit'],
  };
  const config = configs[target]; if (!config) throw validation('Unsupported media target');
  const [collection, resolve, field, action, entityType] = config; const row = await resolve();
  row[field] = (row[field] || []).filter((item) => { const match = mediaMatches(item, publicId); if (match) removedMedia = item; return !match; });
  if (entityType === 'listing' && removedMedia && row.img === mediaUrl(removedMedia)) row.img = mediaUrl(row.media) || '';
  await companyRepository.withTransaction(async (session) => { await collection.save(row, { id: row.id }, { session }); await writeAudit(actorId, action, row.id, { target, publicId: removedMedia?.publicId || publicId, entityType }, { session }); });
  return { target: entityType, [entityType === 'company_employee' ? 'driver' : entityType.replace(/_([a-z])/g, (_, c) => c.toUpperCase())]: row, media: removedMedia };
}


async function isBusCompany(companyId) {
  const company = await companyOrThrow(companyId);
  return normalizeCompanyType(company.companyType || company.type || '') === 'bus';
}

async function isBusListing(companyId, listingId) {
  const key = cleanText(listingId, 180);
  if (!key) return false;
  const identities = [{ id: key }, { slug: key }];
  if (/^[a-f0-9]{24}$/i.test(key)) identities.push({ _id: key });
  const listing = await companyRepository.listings.findOne({ companyId, $or: identities });
  if (!listing) return false;
  return normalize(listing.serviceType || '') === 'bus';
}

function entityIdentityClauses(value) {
  const key = cleanText(value, 180);
  const clauses = [{ id: key }];
  if (/^[a-f0-9]{24}$/i.test(key)) clauses.push({ _id: key });
  return clauses;
}

async function isBusRoute(companyId, routeId) {
  const route = await companyRepository.routes.findOne({ companyId, $or: entityIdentityClauses(routeId) });
  if (!route) return false;
  if (route.listingId) return isBusListing(companyId, route.listingId);
  return isBusCompany(companyId);
}

async function isBusVehicle(companyId, vehicleId) {
  const vehicle = await companyRepository.vehicles.findOne({ companyId, $or: entityIdentityClauses(vehicleId) });
  if (!vehicle) return false;
  return normalize(vehicle.serviceType || 'bus') === 'bus' && (vehicle.listingId ? isBusListing(companyId, vehicle.listingId) : isBusCompany(companyId));
}

async function isBusSchedule(companyId, scheduleId) {
  const identities = entityIdentityClauses(scheduleId);
  let schedule = await companyRepository.schedules.findOne({ companyId, $or: identities });
  if (schedule) return normalize(schedule.serviceType || 'bus') === 'bus';

  // Older departures can remain visible through their linked listing/route while
  // activation fails because companyId is missing or contains a stale legacy value.
  // Repair it only when every resolvable linked bus entity proves current ownership.
  schedule = await companyRepository.schedules.findOne({ $or: identities });
  if (!schedule) return false;

  const ownershipChecks = [];
  if (schedule.listingId) {
    const listing = await companyRepository.listings.findOne({ $or: [{ id: cleanText(schedule.listingId, 180) }, { slug: cleanText(schedule.listingId, 180) }] });
    if (listing) ownershipChecks.push(String(listing.companyId || '') === String(companyId) && normalize(listing.serviceType || '') === 'bus');
  }
  if (schedule.routeId) {
    const route = await companyRepository.routes.findOne({ $or: entityIdentityClauses(schedule.routeId) });
    if (route) ownershipChecks.push(String(route.companyId || '') === String(companyId));
  }
  if (schedule.vehicleId) {
    const vehicle = await companyRepository.vehicles.findOne({ $or: entityIdentityClauses(schedule.vehicleId) });
    if (vehicle) ownershipChecks.push(String(vehicle.companyId || '') === String(companyId) && normalize(vehicle.serviceType || 'bus') === 'bus');
  }
  if (!ownershipChecks.length || ownershipChecks.some((result) => !result)) return false;

  const scheduleKey = cleanText(schedule.id || schedule._id, 180);
  if (!scheduleKey) return false;
  schedule.companyId = companyId;
  schedule.serviceType = 'bus';
  schedule.updatedAt = new Date().toISOString();
  schedule.ownershipRepairedAt = schedule.updatedAt;
  await companyRepository.withTransaction(async (session) => {
    await companyRepository.schedules.save(schedule, { $or: identities }, { session });
    await companyRepository.seats.updateMany({ scheduleId: scheduleKey, $or: [{ companyId: { $exists: false } }, { companyId: '' }, { companyId: null }] }, { $set: { companyId } }, { session });
    await companyRepository.busSeatSegmentInventories.updateMany({ scheduleId: scheduleKey, $or: [{ companyId: { $exists: false } }, { companyId: '' }, { companyId: null }] }, { $set: { companyId } }, { session });
  });
  return true;
}

async function createListingDispatch(companyId, payload = {}) {
  const serviceType = normalize(payload.serviceType || payload.group || 'bus').replace(/-/g, '_');
  if (serviceType === 'bus') return busSetupService.createBusListing(companyId, payload, payload.actorId || payload.createdBy || 'company-admin');
  return createListing(companyId, payload);
}

async function updateListingDispatch(companyId, listingId, payload = {}) {
  if (await isBusListing(companyId, listingId)) return busSetupService.updateBusListing(companyId, listingId, payload, payload.actorId || payload.updatedBy || 'company-admin');
  return updateListing(companyId, listingId, payload);
}

async function publishListingDispatch(companyId, listingId, actor = 'company-admin') {
  if (await isBusListing(companyId, listingId)) return busSetupService.smartPublishBusListing(companyId, listingId, actor);
  return publishListing(companyId, listingId, actor);
}

async function archiveListingDispatch(companyId, listingId, actor = 'company-admin') {
  if (await isBusListing(companyId, listingId)) return busSetupService.archiveBusListing(companyId, listingId, actor);
  return archiveListing(companyId, listingId);
}

async function assertBusCompany(companyId) {
  if (!await isBusCompany(companyId)) throw validation('This operation is available only in a bus company workspace');
}
async function assertBusListing(companyId, listingId) {
  if (!await isBusListing(companyId, listingId)) throw validation('Select a bus listing that belongs to this company');
}
async function assertBusRoute(companyId, routeId) {
  if (!await isBusRoute(companyId, routeId)) throw validation('Select a bus route that belongs to this company');
}
async function assertBusVehicle(companyId, vehicleId) {
  if (!await isBusVehicle(companyId, vehicleId)) throw validation('Select a bus vehicle that belongs to this company');
}
async function assertBusSchedule(companyId, scheduleId) {
  if (!await isBusSchedule(companyId, scheduleId)) throw validation('Select a bus departure that belongs to this company');
}

async function createRouteDispatch(companyId, payload = {}) { await assertBusCompany(companyId); return busSetupService.createRoute(companyId, payload, payload.actorId || payload.createdBy || 'company-admin'); }
async function updateRouteDispatch(companyId, routeId, payload = {}) { await assertBusRoute(companyId, routeId); return busSetupService.updateRoute(companyId, routeId, payload, payload.actorId || payload.updatedBy || 'company-admin'); }
async function archiveRouteDispatch(companyId, routeId, actor = 'company-admin') { await assertBusRoute(companyId, routeId); return busSetupService.archiveRoute(companyId, routeId, actor); }
async function createRouteStopDispatch(companyId, routeId, payload = {}, actor = 'company-admin') { await assertBusRoute(companyId, routeId); return busSetupService.createRouteStop(companyId, routeId, payload, actor); }
async function updateRouteStopDispatch(companyId, stopId, payload = {}, actor = 'company-admin') { const stop = await companyRepository.routeStops.findOne({ companyId, id: cleanText(stopId, 180) }); if (!stop) throw validation('Route stop was not found'); await assertBusRoute(companyId, stop.routeId); return busSetupService.updateRouteStop(companyId, stopId, payload, actor); }
async function archiveRouteStopDispatch(companyId, stopId, actor = 'company-admin') { const stop = await companyRepository.routeStops.findOne({ companyId, id: cleanText(stopId, 180) }); if (!stop) throw validation('Route stop was not found'); await assertBusRoute(companyId, stop.routeId); return busSetupService.archiveRouteStop(companyId, stopId, actor); }
async function moveRouteStopDispatch(companyId, stopId, direction = 'up', actor = 'company-admin') { const stop = await companyRepository.routeStops.findOne({ companyId, id: cleanText(stopId, 180) }); if (!stop) throw validation('Route stop was not found'); await assertBusRoute(companyId, stop.routeId); return busSetupService.moveRouteStop(companyId, stopId, direction, actor); }

async function createVehicleDispatch(companyId, payload = {}) { await assertBusCompany(companyId); return busSetupService.createVehicle(companyId, payload, payload.actorId || payload.createdBy || 'company-admin'); }
async function updateVehicleDispatch(companyId, vehicleId, payload = {}) { await assertBusVehicle(companyId, vehicleId); return busSetupService.updateVehicle(companyId, vehicleId, payload, payload.actorId || payload.updatedBy || 'company-admin'); }
async function archiveVehicleDispatch(companyId, vehicleId, actor = 'company-admin') { await assertBusVehicle(companyId, vehicleId); return busSetupService.archiveVehicle(companyId, vehicleId, actor); }
async function updateVehicleSeatTemplateDispatch(companyId, vehicleId, payload = {}, actor = 'company-admin') { await assertBusVehicle(companyId, vehicleId); return busSetupService.updateVehicleSeatTemplate(companyId, vehicleId, payload, actor); }
async function updateVehicleStatusDispatch(companyId, vehicleId, payload = {}, actor = 'company-admin') { await assertBusVehicle(companyId, vehicleId); return busSetupService.updateVehicleStatus(companyId, vehicleId, payload, actor); }

async function createScheduleBatchDispatch(companyId, payload = {}) { await assertBusCompany(companyId); if (payload.listingId) await assertBusListing(companyId, payload.listingId); return busDepartureService.createScheduleBatch(companyId, payload, payload.actorId || payload.createdBy || 'company-admin'); }
async function preflightSchedulePublicationDispatch(companyId, payload = {}) { await assertBusCompany(companyId); if (payload.listingId) await assertBusListing(companyId, payload.listingId); if (payload.routeId) await assertBusRoute(companyId, payload.routeId); return busDepartureService.preflightSchedulePublication(companyId, payload); }
async function createScheduleDispatch(companyId, payload = {}) { await assertBusCompany(companyId); if (payload.listingId) await assertBusListing(companyId, payload.listingId); if (payload.routeId) await assertBusRoute(companyId, payload.routeId); return busDepartureService.createSchedule(companyId, payload, payload.actorId || payload.createdBy || 'company-admin'); }
async function repairScheduleInventoryDispatch(companyId, scheduleId, actor = 'company-admin') { await assertBusCompany(companyId); return busDepartureService.repairScheduleInventory(companyId, scheduleId, actor); }
async function updateScheduleDispatch(companyId, scheduleId, payload = {}) { await assertBusSchedule(companyId, scheduleId); return busDepartureService.updateSchedule(companyId, scheduleId, payload, payload.actorId || payload.updatedBy || 'company-admin'); }
async function publishScheduleDispatch(companyId, scheduleId, actor = 'company-admin') { await assertBusSchedule(companyId, scheduleId); return busDepartureService.publishSchedule(companyId, scheduleId, actor); }
async function publishReadyDraftSchedulesDispatch(companyId, payload = {}, actor = 'company-admin') { await assertBusCompany(companyId); return busDepartureService.publishReadyDraftSchedules(companyId, payload, actor); }
async function archiveScheduleDispatch(companyId, scheduleId, actor = 'company-admin') { await assertBusSchedule(companyId, scheduleId); return busDepartureService.archiveSchedule(companyId, scheduleId, actor); }
async function transitionScheduleDispatch(companyId, scheduleId, payload = {}, actor = 'company-admin') { await assertBusSchedule(companyId, scheduleId); return busDepartureService.transitionSchedule(companyId, scheduleId, payload, actor); }
async function completeScheduleDispatch(companyId, scheduleId, payload = {}, actor = 'company-admin') { await assertBusSchedule(companyId, scheduleId); return busDepartureService.completeSchedule(companyId, scheduleId, payload, actor); }
async function duplicateScheduleDispatch(companyId, scheduleId, payload = {}, actor = 'company-admin') { await assertBusSchedule(companyId, scheduleId); return busDepartureService.duplicateSchedule(companyId, scheduleId, payload, actor); }
async function updateSeatStatusDispatch(companyId, payload = {}, actor = 'company-admin') { await assertBusSchedule(companyId, payload.scheduleId); return busDepartureService.updateSeatStatus(companyId, payload, actor); }
async function createScheduleRuleDispatch(companyId, payload = {}, actor = 'company-admin') { await assertBusCompany(companyId); if (payload.listingId) await assertBusListing(companyId, payload.listingId); return busDepartureService.createScheduleRule(companyId, payload, actor); }
async function updateScheduleRuleDispatch(companyId, id, payload = {}, actor = 'company-admin') { await assertBusCompany(companyId); return busDepartureService.updateScheduleRule(companyId, id, payload, actor); }
async function pauseScheduleRuleDispatch(companyId, id, actor = 'company-admin') { await assertBusCompany(companyId); return busDepartureService.pauseScheduleRule(companyId, id, actor); }
async function resumeScheduleRuleDispatch(companyId, id, actor = 'company-admin') { await assertBusCompany(companyId); return busDepartureService.resumeScheduleRule(companyId, id, actor); }
async function cancelScheduleRuleDispatch(companyId, id, actor = 'company-admin') { await assertBusCompany(companyId); return busDepartureService.cancelScheduleRule(companyId, id, actor); }

module.exports = {
  createCompany, updateCommercialTerms, setVerificationStatus, createListing: createListingDispatch, updateListing: updateListingDispatch, publishListing: publishListingDispatch, archiveListing: archiveListingDispatch,
  createRoute: createRouteDispatch, updateRoute: updateRouteDispatch, archiveRoute: archiveRouteDispatch,
  createRouteStop: createRouteStopDispatch, updateRouteStop: updateRouteStopDispatch, archiveRouteStop: archiveRouteStopDispatch, moveRouteStop: moveRouteStopDispatch,
  createVehicle: createVehicleDispatch, updateVehicle: updateVehicleDispatch, archiveVehicle: archiveVehicleDispatch,
  updateVehicleSeatTemplate: updateVehicleSeatTemplateDispatch, updateVehicleStatus: updateVehicleStatusDispatch,
  createSchedule: createScheduleDispatch, createScheduleBatch: createScheduleBatchDispatch, preflightSchedulePublication: preflightSchedulePublicationDispatch, createScheduleRule: createScheduleRuleDispatch, updateScheduleRule: updateScheduleRuleDispatch,
  pauseScheduleRule: pauseScheduleRuleDispatch, resumeScheduleRule: resumeScheduleRuleDispatch, cancelScheduleRule: cancelScheduleRuleDispatch,
  recordScheduleRuleMaterialization: busDepartureService.recordScheduleRuleMaterialization, repairScheduleInventory: repairScheduleInventoryDispatch, updateSchedule: updateScheduleDispatch,
  publishSchedule: publishScheduleDispatch, publishReadyDraftSchedules: publishReadyDraftSchedulesDispatch, archiveSchedule: archiveScheduleDispatch, transitionSchedule: transitionScheduleDispatch,
  completeSchedule: completeScheduleDispatch, duplicateSchedule: duplicateScheduleDispatch, updateSeatStatus: updateSeatStatusDispatch,
  createFareProduct: busSetupService.createFareProduct, updateFareProduct: busSetupService.updateFareProduct, archiveFareProduct: busSetupService.archiveFareProduct,
  upsertSegmentFare: busSetupService.upsertSegmentFare, archiveSegmentFare: busSetupService.archiveSegmentFare,
  createServiceAddon: busSetupService.createServiceAddon, updateServiceAddon: busSetupService.updateServiceAddon, archiveServiceAddon: busSetupService.archiveServiceAddon, busReadinessReport: busSetupService.readinessReport,
  setRoomTypeInventory: hotelService.setRoomTypeInventory,
  createBranch, updateBranch, archiveBranch, createPolicy, updatePolicy, archivePolicy, inviteEmployee, updateEmployeeRole, revokeEmployee, updateDriverProfile, activateDriverByCompany, assignDriver, updateTripStatus, createDriverIncident,
  attachMedia, removeMedia, companyCanPublish,
};
