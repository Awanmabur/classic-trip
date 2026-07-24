const { platformCurrency } = require('../../utils/currency');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const { env } = require('../../config/env');
const generateBookingRef = require('../../utils/generateBookingRef');
const calculateCommission = require('../../utils/calculateCommission');
const { calculateCustomerFees } = require('../../utils/calculateCustomerFees');
const hotelRepository = require('../../repositories/domain/hotelRepository');
const timelineService = require('../support/timelineService');
const { normalizeLifecycleStatus } = require('../../domain/statuses');
const releaseService = require('../commission/releaseService');
const paymentService = require('../payment/paymentService');
const notificationService = require('../notification/notificationService');
const hotelInventoryService = require('./hotelInventoryService');
const { getCachedPlatformConfig } = require('../platform/platformConfigService');

function clean(value, fallback = '') { return String(value ?? fallback).trim(); }
function num(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function list(value) {
  if (Array.isArray(value)) return value.map((v) => clean(v)).filter(Boolean);
  return String(value || '').split(/[,\n]/).map((v) => clean(v)).filter(Boolean);
}
function bookingGuestIdentity(payload = {}, guests = [], req = {}) {
  const sessionUser = req?.session?.user || {};
  const firstGuest = guests[0] || {};
  const fullName = clean(payload.fullName || firstGuest.fullName || sessionUser.fullName || sessionUser.name);
  const email = clean(payload.email || firstGuest.email || sessionUser.email).toLowerCase();
  const phone = clean(payload.phone || firstGuest.phone || sessionUser.phone);
  if (!fullName) { const error = new Error('Guest full name is required'); error.status = 422; throw error; }
  if (!email && !phone) { const error = new Error('Provide a guest email or phone number'); error.status = 422; throw error; }
  return { fullName, email, phone };
}

function normalizeHotelGuests(payload = {}, buyer = {}, roomCount = 1, occupancy = {}) {
  let supplied = [];
  try {
    supplied = typeof payload.guests === 'string'
      ? JSON.parse(payload.guests || '[]')
      : (payload.guests || payload.guestDetails || []);
  } catch (_) { supplied = []; }
  if (!Array.isArray(supplied)) supplied = [];
  const additionalNames = list(payload.additionalGuestNames || payload.guestNames || payload.occupantNames);
  const rows = supplied.map((guest) => (typeof guest === 'string' ? { fullName: guest } : { ...(guest || {}) }));
  if (!rows.length) rows.push({ ...buyer });
  rows[0] = { ...rows[0], fullName: clean(rows[0].fullName || buyer.fullName), email: clean(rows[0].email || buyer.email), phone: clean(rows[0].phone || buyer.phone) };
  const existingNames = new Set(rows.map((guest) => normalizedKey(guest.fullName)).filter(Boolean));
  additionalNames.forEach((fullName) => {
    const key = normalizedKey(fullName);
    if (key && !existingNames.has(key)) { rows.push({ fullName }); existingNames.add(key); }
  });
  if (rows.length < roomCount) {
    const error = new Error(`Provide at least one named guest for each of the ${roomCount} rooms.`);
    error.status = 422;
    error.code = 'hotel_room_lead_guests_required';
    throw error;
  }
  const adults = Math.max(1, Number(occupancy.adults || 1));
  const children = Math.max(0, Number(occupancy.children || 0));
  return rows.slice(0, 60).map((guest, index) => {
    const requestedRoomIndex = Number(guest.roomIndex);
    const roomIndex = Number.isInteger(requestedRoomIndex) && requestedRoomIndex >= 0 && requestedRoomIndex < roomCount
      ? requestedRoomIndex
      : (index < roomCount ? index : index % roomCount);
    const guestType = ['adult', 'child', 'infant'].includes(clean(guest.guestType).toLowerCase())
      ? clean(guest.guestType).toLowerCase()
      : (index < adults ? 'adult' : (index < adults + children ? 'child' : 'infant'));
    const normalized = {
      roomIndex,
      guestType,
      fullName: clean(guest.fullName || (index === 0 ? buyer.fullName : '')).slice(0, 180),
      email: clean(guest.email || (index === 0 ? buyer.email : '')).toLowerCase().slice(0, 254),
      phone: clean(guest.phone || (index === 0 ? buyer.phone : '')).slice(0, 80),
      identityType: clean(guest.identityType || guest.idType || (index === 0 ? payload.identityType || payload.idType : '')).slice(0, 80),
      identityNumber: clean(guest.identityNumber || guest.documentNumber || (index === 0 ? payload.identityNumber || payload.documentNumber : '')).slice(0, 120),
      nationality: clean(guest.nationality || (index === 0 ? payload.nationality : '')).slice(0, 100),
      dateOfBirth: guest.dateOfBirth || (index === 0 ? payload.dateOfBirth : null) || null,
      sex: clean(guest.sex || (index === 0 ? payload.sex : '')).slice(0, 40),
      emergencyContactName: clean(guest.emergencyContactName || (index === 0 ? payload.emergencyContactName : '')).slice(0, 180),
      emergencyContactPhone: clean(guest.emergencyContactPhone || (index === 0 ? payload.emergencyContactPhone : '')).slice(0, 80),
      specialRequests: clean(guest.specialRequests || (index === 0 ? payload.specialRequests || payload.notes : '')).slice(0, 1200),
    };
    if (!normalized.fullName) {
      const error = new Error(`Guest ${index + 1} requires a full name.`);
      error.status = 422;
      error.code = 'hotel_guest_name_required';
      throw error;
    }
    return normalized;
  });
}

const PROPERTY_STATUSES = new Set(['active', 'paused', 'archived']);
const ROOM_TYPE_STATUSES = new Set(['active', 'paused', 'archived']);
const ROOM_UNIT_STATUSES = new Set(['available', 'occupied', 'maintenance', 'cleaning', 'reserved', 'archived']);
const HOUSEKEEPING_STATUSES = new Set(['clean', 'dirty', 'cleaning', 'inspected', 'maintenance', 'occupied', 'ready']);
const HOUSEKEEPING_TASK_STATUSES = new Set(['', 'open', 'in_progress', 'completed', 'cancelled', 'blocked']);
const BED_TYPES = new Set(['single', 'double', 'twin', 'queen', 'king', 'family', 'suite']);
const PROPERTY_TYPES = new Set(['hotel', 'lodge', 'resort', 'guest_house', 'serviced_apartment', 'hostel', 'camp']);
const PROPERTY_CATEGORIES = new Set(['unrated', 'budget', 'standard', 'premium', 'luxury']);
const MEAL_PLANS = new Set(['room_only', 'breakfast', 'half_board', 'full_board', 'all_inclusive']);
const RATE_PRICING_MODES = new Set(['fixed', 'nightly_inventory']);
const CANCELLATION_PENALTY_TYPES = new Set(['none', 'first_night', 'percentage', 'full_stay']);
const PAYMENT_TIMINGS = new Set(['pay_now']);
function bool(value, fallback = false) { if (typeof value === 'boolean') return value; const normalized = clean(value).toLowerCase(); if (['true','1','yes','on'].includes(normalized)) return true; if (['false','0','no','off'].includes(normalized)) return false; return fallback; }
function normalizedKey(value) { return clean(value).toLowerCase().replace(/\s+/g, ' '); }
function parseMapLocation(value = '') { const parts = clean(value).split(',').map(Number); return parts.length === 2 && parts.every(Number.isFinite) ? { latitude: parts[0], longitude: parts[1] } : {}; }

function enumValue(value, allowed, fallback, label) {
  const normalized = clean(value || fallback).toLowerCase().replace(/[ -]+/g, '_');
  if (!allowed.has(normalized)) {
    const error = new Error(`Invalid ${label}`);
    error.status = 422;
    throw error;
  }
  return normalized;
}

async function propertyForListingOrThrow(companyId, listingId, propertyId) {
  const property = propertyId
    ? await hotelRepository.hotelProperties.findOne({ id: clean(propertyId), companyId, listingId })
    : await hotelRepository.hotelProperties.findOne({ companyId, listingId, status: { $ne: 'archived' } });
  if (!property) {
    const error = new Error('Select an active hotel property that belongs to the selected hotel listing');
    error.status = 422;
    throw error;
  }
  if (property.status === 'archived') {
    const error = new Error('Archived hotel properties cannot receive new room types');
    error.status = 409;
    throw error;
  }
  return property;
}
function isoDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    const error = new Error('A valid date is required');
    error.status = 422;
    throw error;
  }
  return parsed.toISOString().slice(0, 10);
}
function dateRange(checkIn, checkOut) {
  const start = new Date(`${isoDate(checkIn)}T00:00:00.000Z`);
  const end = new Date(`${isoDate(checkOut)}T00:00:00.000Z`);
  if (!(end > start)) {
    const error = new Error('Check-out must be after check-in');
    error.status = 422;
    throw error;
  }
  const days = [];
  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
  return days;
}

async function createProperty(companyId, payload = {}, actorId = 'company-admin') {
  await hotelRepository.companyOrThrow(companyId);
  const listing = await hotelRepository.listingOrThrow(companyId, payload.listingId || payload.slug);
  const propertyName = clean(payload.propertyName || payload.name || listing.title);
  if (!propertyName) throw Object.assign(new Error('Property name is required'), { status: 422 });
  const existingProperty = await hotelRepository.hotelProperties.findOne({ companyId, listingId: listing.id });
  if (existingProperty) {
    const error = new Error(existingProperty.status === 'archived'
      ? 'This hotel listing already has an archived property. Restore or edit that property instead of creating a duplicate.'
      : 'This hotel listing already has a property. Edit the existing property or create a different public hotel listing.');
    error.status = 409;
    error.code = 'hotel_listing_property_exists';
    error.meta = { propertyId: existingProperty.id, listingId: listing.id };
    throw error;
  }
  const geo = parseMapLocation(payload.mapLocation || payload.location || '');
  const property = {
    id: await hotelRepository.nextId('hotel-property'), companyId, listingId: listing.id,
    propertyName, normalizedName: normalizedKey(propertyName),
    propertyType: enumValue(payload.propertyType, PROPERTY_TYPES, 'hotel', 'property type'),
    category: enumValue(payload.category, PROPERTY_CATEGORIES, 'unrated', 'property category'),
    starRating: Math.max(0, Math.min(5, num(payload.starRating, 0))),
    address: clean(payload.address || listing.address), city: clean(payload.city || listing.city), country: clean(payload.country || listing.country),
    timezone: clean(payload.timezone || listing.timezone || 'Africa/Kampala'),
    mapLocation: clean(payload.mapLocation || payload.location || ''), ...geo,
    contactEmail: clean(payload.contactEmail || payload.email || '').toLowerCase(), contactPhone: clean(payload.contactPhone || payload.phone || ''),
    checkInTime: clean(payload.checkInTime || listing.checkInTime || '14:00'), checkOutTime: clean(payload.checkOutTime || listing.checkOutTime || '10:00'),
    amenities: list(payload.amenities || listing.amenities), accessibilityFeatures: list(payload.accessibilityFeatures),
    childPolicy: clean(payload.childPolicy), petPolicy: clean(payload.petPolicy), smokingPolicy: clean(payload.smokingPolicy),
    paymentPolicy: clean(payload.paymentPolicy), depositPolicy: clean(payload.depositPolicy), houseRules: list(payload.houseRules),
    policies: list(payload.policies || listing.policy), taxPercent: Math.max(0, Math.min(100, num(payload.taxPercent, 0))), serviceFeePercent: Math.max(0, Math.min(100, num(payload.serviceFeePercent, 0))),
    taxesAndFees: list(payload.taxesAndFees).map((fee) => ({ label: fee, amount: 0 })),
    status: enumValue(payload.status, new Set(['active', 'paused']), 'active', 'hotel property status'), createdBy: actorId, createdAt: new Date().toISOString(),
  };
  Object.assign(listing, { title: property.propertyName || listing.title, address: property.address || listing.address, city: property.city || listing.city, country: property.country || listing.country, timezone: property.timezone, checkInTime: property.checkInTime, checkOutTime: property.checkOutTime, amenities: property.amenities });
  await hotelRepository.transaction(async (session) => {
    await hotelRepository.hotelProperties.insert(property, { session });
    await hotelRepository.listings.save(listing, { id: listing.id }, { session });
  });
  await hotelRepository.audit({ actorId, action: 'hotel.property.created', targetType: 'hotelProperty', targetId: property.id, meta: { companyId, listingId: listing.id } });
  return property;
}

async function updateProperty(companyId, propertyId, payload = {}, actorId = 'company-admin') {
  const property = await hotelRepository.propertyOrThrow(companyId, propertyId);
  const listing = await hotelRepository.listings.findOne({ id: property.listingId, companyId });
  if (payload.propertyName || payload.name) {
    const propertyName = clean(payload.propertyName || payload.name);
    const normalizedName = normalizedKey(propertyName);
    const duplicate = await hotelRepository.hotelProperties.findOne({ companyId, listingId: property.listingId, normalizedName, id: { $ne: property.id } });
    if (duplicate) throw Object.assign(new Error('A property with this name already exists under the selected listing'), { status: 409 });
    property.propertyName = propertyName; property.normalizedName = normalizedName;
  }
  const stringFields = ['address','city','country','timezone','mapLocation','contactEmail','contactPhone','checkInTime','checkOutTime','childPolicy','petPolicy','smokingPolicy','paymentPolicy','depositPolicy'];
  stringFields.forEach((field) => { if (typeof payload[field] !== 'undefined') property[field] = field === 'contactEmail' ? clean(payload[field]).toLowerCase() : clean(payload[field]); });
  if (typeof payload.mapLocation !== 'undefined') Object.assign(property, parseMapLocation(payload.mapLocation));
  if (payload.propertyType) property.propertyType = enumValue(payload.propertyType, PROPERTY_TYPES, property.propertyType || 'hotel', 'property type');
  if (payload.category) property.category = enumValue(payload.category, PROPERTY_CATEGORIES, property.category || 'unrated', 'property category');
  if (typeof payload.starRating !== 'undefined') property.starRating = Math.max(0, Math.min(5, num(payload.starRating, property.starRating || 0)));
  if (typeof payload.taxPercent !== 'undefined') property.taxPercent = Math.max(0, Math.min(100, num(payload.taxPercent, property.taxPercent || 0)));
  if (typeof payload.serviceFeePercent !== 'undefined') property.serviceFeePercent = Math.max(0, Math.min(100, num(payload.serviceFeePercent, property.serviceFeePercent || 0)));
  if (payload.amenities) property.amenities = list(payload.amenities);
  if (payload.accessibilityFeatures) property.accessibilityFeatures = list(payload.accessibilityFeatures);
  if (payload.houseRules) property.houseRules = list(payload.houseRules);
  if (payload.policies) property.policies = list(payload.policies);
  if (payload.status) {
    const nextStatus = enumValue(payload.status, PROPERTY_STATUSES, property.status || 'active', 'hotel property status');
    if (nextStatus === 'archived' && property.status !== 'archived') throw Object.assign(new Error('Use the dedicated archive action so active reservations and inventory are checked first.'), { status: 409, code: 'hotel_property_archive_action_required' });
    property.status = nextStatus;
  }
  property.updatedBy = actorId; property.updatedAt = new Date().toISOString();
  if (listing) Object.assign(listing, { title: property.propertyName || listing.title, address: property.address || listing.address, city: property.city || listing.city, country: property.country || listing.country, timezone: property.timezone || listing.timezone, checkInTime: property.checkInTime, checkOutTime: property.checkOutTime, amenities: property.amenities });
  await hotelRepository.transaction(async (session) => {
    await hotelRepository.hotelProperties.save(property, { id: property.id }, { session });
    if (listing) await hotelRepository.listings.save(listing, { id: listing.id }, { session });
  });
  await hotelRepository.audit({ actorId, action: 'hotel.property.updated', targetType: 'hotelProperty', targetId: property.id });
  await reconcileHotelListingPublication(companyId, property.listingId, actorId);
  return property;
}

async function archiveProperty(companyId, propertyId, actorId = 'company-admin') {
  const property = await hotelRepository.propertyOrThrow(companyId, propertyId);
  if (property.status === 'archived') return property;
  const today = todayIsoUtc();
  const committed = await hotelRepository.hotelReservations.count({
    companyId,
    propertyId: property.id,
    checkOutDate: { $gte: today },
    status: { $in: ['awaiting_payment', 'confirmed', 'checked_in'] },
  });
  if (committed) {
    const error = new Error('This property has active or future reservations. Cancel, refund, move, or complete those stays before archiving it.');
    error.status = 409;
    error.code = 'hotel_property_has_reservations';
    throw error;
  }
  const now = new Date().toISOString();
  const listing = await hotelRepository.listings.findOne({ id: property.listingId, companyId });
  await hotelRepository.transaction(async (session) => {
    await hotelRepository.hotelProperties.updateOne({ id: property.id, companyId }, { $set: { status: 'archived', updatedBy: actorId, updatedAt: now } }, { session });
    await hotelRepository.roomTypes.updateMany({ companyId, propertyId: property.id, status: { $ne: 'archived' } }, { $set: { status: 'archived', updatedBy: actorId, updatedAt: now } }, { session });
    await hotelRepository.ratePlans.updateMany({ companyId, propertyId: property.id, status: { $ne: 'archived' } }, { $set: { status: 'archived', updatedBy: actorId, updatedAt: now } }, { session });
    await hotelRepository.roomUnits.updateMany({ companyId, propertyId: property.id, status: { $ne: 'archived' } }, { $set: { status: 'archived', updatedBy: actorId, updatedAt: now } }, { session });
    await hotelRepository.roomNightInventories.updateMany({ companyId, propertyId: property.id, date: { $gte: today }, status: { $in: ['available', 'open', 'maintenance', 'cleaning', 'cancelled', 'refunded'] } }, { $set: { status: 'cancelled', availableInventory: 0, notes: 'Property archived', updatedBy: actorId, updatedAt: now } }, { session });
    if (listing) await hotelRepository.listings.updateOne({ id: listing.id, companyId }, { $set: { status: 'paused', releaseStatus: 'paused', bookable: false, unpublishedAt: now, updatedAt: now } }, { session });
  });
  property.status = 'archived'; property.updatedBy = actorId; property.updatedAt = now;
  await hotelRepository.audit({ actorId, action: 'hotel.property.archived', targetType: 'hotelProperty', targetId: property.id, meta: { companyId, listingId: property.listingId } });
  await reconcileHotelListingPublication(companyId, property.listingId, actorId);
  return property;
}

async function createRoomType(companyId, payload = {}, actorId = 'company-admin') {
  const listing = await hotelRepository.listingOrThrow(companyId, payload.listingId || payload.slug);
  const property = await propertyForListingOrThrow(companyId, listing.id, payload.propertyId);
  const name = clean(payload.name || payload.roomType || 'Standard Room');
  const normalizedName = normalizedKey(name);
  const existing = await hotelRepository.roomTypes.findOne({ companyId, propertyId: property.id, normalizedName });
  if (existing) throw Object.assign(new Error(`Room type ${name} already exists for this property`), { status: 409 });
  const capacity = Math.max(1, Math.round(num(payload.capacity, 2)));
  const maxAdults = Math.max(1, Math.min(capacity, Math.round(num(payload.maxAdults, capacity))));
  const maxChildren = Math.max(0, Math.round(num(payload.maxChildren, Math.max(0, capacity - maxAdults))));
  if (maxAdults + maxChildren < capacity) throw Object.assign(new Error('Adult and child occupancy must cover the total room capacity'), { status: 422 });
  const roomTypeId = await hotelRepository.nextId('room-type');
  const ratePlanId = await hotelRepository.nextId('rate-plan');
  const currency = clean(listing.currency || platformCurrency()).toUpperCase();
  const roomType = {
    id: roomTypeId, companyId, listingId: listing.id, propertyId: property.id, name, normalizedName, capacity, maxAdults, maxChildren,
    maxInfants: Math.max(0, Math.round(num(payload.maxInfants, 0))), bedType: enumValue(payload.bedType, BED_TYPES, 'double', 'bed type'),
    bedConfiguration: { single: Math.max(0, Math.round(num(payload.singleBeds, 0))), double: Math.max(0, Math.round(num(payload.doubleBeds, 1))), sofa: Math.max(0, Math.round(num(payload.sofaBeds, 0))) },
    sizeSqm: Math.max(0, num(payload.sizeSqm, 0)), basePrice: Math.max(0, num(payload.basePrice || payload.nightlyPrice || listing.priceFrom, 0)),
    defaultRatePlanId: ratePlanId, mealPlan: enumValue(payload.mealPlan, MEAL_PLANS, 'room_only', 'meal plan'),
    extraAdultFee: Math.max(0, num(payload.extraAdultFee, 0)), extraChildFee: Math.max(0, num(payload.extraChildFee, 0)),
    minStay: Math.max(1, Math.round(num(payload.minStay, 1))), maxStay: Math.max(1, Math.round(num(payload.maxStay, 90))),
    amenities: list(payload.amenities), accessibilityFeatures: list(payload.accessibilityFeatures), policies: list(payload.policies),
    taxesAndFees: list(payload.taxesAndFees).map((fee) => ({ label: fee, amount: 0 })), status: enumValue(payload.status, new Set(['active', 'paused']), 'active', 'room type status'), createdBy: actorId, createdAt: new Date().toISOString(),
  };
  const ratePlan = {
    id: ratePlanId, companyId, listingId: listing.id, propertyId: property.id, roomTypeId, name: clean(payload.ratePlanName || 'Standard flexible'), code: 'STANDARD', currency,
    pricingMode: 'nightly_inventory', basePrice: roomType.basePrice, mealPlan: roomType.mealPlan, refundable: bool(payload.refundable, true),
    cancellationDeadlineHours: Math.max(0, num(payload.cancellationDeadlineHours, 24)), cancellationPenaltyType: enumValue(payload.cancellationPenaltyType, CANCELLATION_PENALTY_TYPES, 'first_night', 'cancellation penalty'), cancellationPenaltyValue: Math.max(0, num(payload.cancellationPenaltyValue, 0)),
    paymentTiming: enumValue(payload.paymentTiming, PAYMENT_TIMINGS, 'pay_now', 'payment timing'), depositType: 'none', depositAmount: 0,
    minStay: roomType.minStay, maxStay: roomType.maxStay, extraAdultFee: roomType.extraAdultFee, extraChildFee: roomType.extraChildFee, includedAdults: maxAdults, includedChildren: maxChildren,
    policySnapshot: { policies: roomType.policies, propertyPolicies: property.policies, childPolicy: property.childPolicy, petPolicy: property.petPolicy }, status: 'active', createdBy: actorId, createdAt: roomType.createdAt,
  };
  if (roomType.maxStay < roomType.minStay) throw Object.assign(new Error('Maximum stay must be greater than or equal to minimum stay'), { status: 422 });
  if (ratePlan.cancellationPenaltyType === 'percentage' && ratePlan.cancellationPenaltyValue > 100) throw Object.assign(new Error('Percentage cancellation penalty cannot exceed 100'), { status: 422 });
  const defaultInventory = Math.max(0, Math.round(num(payload.defaultInventory ?? payload.inventory, 0)));
  const unitPrefix = clean(payload.unitPrefix || name).replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || 'ROOM';
  const units = await Promise.all(Array.from({ length: defaultInventory }, async (_, index) => { const unitNumber = `${unitPrefix}-${String(index + 1).padStart(3, '0')}`; return { id: await hotelRepository.nextId('room-unit'), companyId, listingId: listing.id, propertyId: roomType.propertyId, roomTypeId: roomType.id, unitNumber, normalizedUnitNumber: normalizedKey(unitNumber), floor: clean(payload.floor || ''), wing: clean(payload.wing || ''), status: 'available', housekeepingStatus: 'clean', notes: '', createdBy: actorId, createdAt: roomType.createdAt }; }));
  await hotelRepository.transaction(async (session) => {
    await hotelRepository.roomTypes.insert(roomType, { session });
    await hotelRepository.ratePlans.insert(ratePlan, { session });
    if (units.length) for (const unit of units) await hotelRepository.roomUnits.insert(unit, { session });
    if (!Number(listing.priceFrom || 0) || roomType.basePrice < Number(listing.priceFrom || Infinity)) { listing.priceFrom = roomType.basePrice; listing.price = roomType.basePrice; listing.updatedAt = new Date().toISOString(); await hotelRepository.listings.save(listing, { id: listing.id }, { session }); }
  });
  await hotelRepository.audit({ actorId, action: 'hotel.room_type.created', targetType: 'roomType', targetId: roomType.id, meta: { listingId: listing.id, propertyId: property.id, ratePlanId, units: units.length } });
  return { roomType, ratePlan, units };
}

async function updateRoomType(companyId, roomTypeId, payload = {}, actorId = 'company-admin') {
  const roomType = await hotelRepository.roomTypeOrThrow(companyId, roomTypeId);
  if (payload.name || payload.roomType) {
    const name = clean(payload.name || payload.roomType); const normalizedName = normalizedKey(name);
    const duplicate = await hotelRepository.roomTypes.findOne({ companyId, propertyId: roomType.propertyId, normalizedName, id: { $ne: roomType.id } });
    if (duplicate) throw Object.assign(new Error(`Room type ${name} already exists for this property`), { status: 409 });
    roomType.name = name; roomType.normalizedName = normalizedName;
  }
  const numericFields = ['capacity','maxAdults','maxChildren','maxInfants','sizeSqm','basePrice','extraAdultFee','extraChildFee','minStay','maxStay'];
  numericFields.forEach((field) => { if (typeof payload[field] !== 'undefined' && payload[field] !== '') roomType[field] = Math.max(field === 'capacity' || field === 'maxAdults' || field === 'minStay' || field === 'maxStay' ? 1 : 0, num(payload[field], roomType[field] || 0)); });
  if (payload.nightlyPrice) roomType.basePrice = Math.max(0, num(payload.nightlyPrice, roomType.basePrice || 0));
  if (payload.bedType) roomType.bedType = enumValue(payload.bedType, BED_TYPES, roomType.bedType || 'double', 'bed type');
  if (payload.mealPlan) roomType.mealPlan = enumValue(payload.mealPlan, MEAL_PLANS, roomType.mealPlan || 'room_only', 'meal plan');
  roomType.bedConfiguration = { single: Math.max(0, Math.round(num(payload.singleBeds, roomType.bedConfiguration?.single || 0))), double: Math.max(0, Math.round(num(payload.doubleBeds, roomType.bedConfiguration?.double || 0))), sofa: Math.max(0, Math.round(num(payload.sofaBeds, roomType.bedConfiguration?.sofa || 0))) };
  if (payload.amenities) roomType.amenities = list(payload.amenities); if (payload.accessibilityFeatures) roomType.accessibilityFeatures = list(payload.accessibilityFeatures); if (payload.policies) roomType.policies = list(payload.policies);
  if (payload.status) {
    const nextStatus = enumValue(payload.status, ROOM_TYPE_STATUSES, roomType.status || 'active', 'room type status');
    if (nextStatus === 'archived' && roomType.status !== 'archived') throw Object.assign(new Error('Use the dedicated room-type archive action so assignments and inventory are checked first.'), { status: 409, code: 'hotel_room_type_archive_action_required' });
    roomType.status = nextStatus;
  }
  if (Number(roomType.maxAdults || 1) > Number(roomType.capacity || 1)) throw Object.assign(new Error('Maximum adults cannot exceed total room capacity'), { status: 422 });
  if (Number(roomType.maxChildren || 0) > Number(roomType.capacity || 1)) throw Object.assign(new Error('Maximum children cannot exceed total room capacity'), { status: 422 });
  if (Number(roomType.maxAdults || 1) + Number(roomType.maxChildren || 0) < Number(roomType.capacity || 1)) throw Object.assign(new Error('Adult and child occupancy limits must cover the total room capacity'), { status: 422 });
  if (Number(roomType.maxStay || 1) < Number(roomType.minStay || 1)) throw Object.assign(new Error('Maximum stay must be greater than or equal to minimum stay'), { status: 422 });
  roomType.updatedBy = actorId; roomType.updatedAt = new Date().toISOString();
  await hotelRepository.roomTypes.save(roomType);
  if (roomType.defaultRatePlanId) await hotelRepository.ratePlans.updateOne({ id: roomType.defaultRatePlanId, companyId }, { $set: { basePrice: roomType.basePrice, mealPlan: roomType.mealPlan, minStay: roomType.minStay, maxStay: roomType.maxStay, extraAdultFee: roomType.extraAdultFee, extraChildFee: roomType.extraChildFee, updatedBy: actorId, updatedAt: roomType.updatedAt } });
  await hotelRepository.audit({ actorId, action: 'hotel.room_type.updated', targetType: 'roomType', targetId: roomType.id });
  await reconcileHotelListingPublication(companyId, roomType.listingId, actorId);
  return roomType;
}

async function archiveRoomType(companyId, roomTypeId, actorId = 'company-admin') {
  const roomType = await hotelRepository.roomTypeOrThrow(companyId, roomTypeId);
  if (roomType.status === 'archived') return roomType;
  const today = todayIsoUtc();
  const committed = await hotelRepository.roomAssignments.count({
    companyId,
    roomTypeId: roomType.id,
    checkOutDate: { $gte: today },
    status: { $in: ['awaiting_payment', 'assigned', 'occupied'] },
  });
  if (committed) {
    const error = new Error('This room type has active or future room assignments and cannot be archived.');
    error.status = 409;
    error.code = 'hotel_room_type_has_assignments';
    throw error;
  }
  const now = new Date().toISOString();
  await hotelRepository.transaction(async (session) => {
    await hotelRepository.roomTypes.updateOne({ id: roomType.id, companyId }, { $set: { status: 'archived', updatedBy: actorId, updatedAt: now } }, { session });
    await hotelRepository.ratePlans.updateMany({ companyId, roomTypeId: roomType.id, status: { $ne: 'archived' } }, { $set: { status: 'archived', updatedBy: actorId, updatedAt: now } }, { session });
    await hotelRepository.roomUnits.updateMany({ companyId, roomTypeId: roomType.id, status: { $ne: 'archived' } }, { $set: { status: 'archived', updatedBy: actorId, updatedAt: now } }, { session });
    await hotelRepository.roomNightInventories.updateMany({ companyId, roomTypeId: roomType.id, date: { $gte: today }, status: { $in: ['available', 'open', 'maintenance', 'cleaning', 'cancelled', 'refunded'] } }, { $set: { status: 'cancelled', availableInventory: 0, notes: 'Room type archived', updatedBy: actorId, updatedAt: now } }, { session });
  });
  roomType.status = 'archived'; roomType.updatedBy = actorId; roomType.updatedAt = now;
  await hotelRepository.audit({ actorId, action: 'hotel.room_type.archived', targetType: 'roomType', targetId: roomType.id });
  await reconcileHotelListingPublication(companyId, roomType.listingId, actorId);
  return roomType;
}

async function createRoomUnits(companyId, payload = {}, actorId = 'company-admin') {
  const roomType = await hotelRepository.roomTypeOrThrow(companyId, payload.roomTypeId);
  const unitNumbers = [...new Set(list(payload.unitNumbers || payload.units || payload.roomNumbers).map((value) => clean(value)))];
  if (!unitNumbers.length) throw Object.assign(new Error('At least one room number is required'), { status: 422 });
  const normalizedNumbers = unitNumbers.map(normalizedKey);
  const existing = await hotelRepository.roomUnits.list({ companyId, propertyId: roomType.propertyId, normalizedUnitNumber: { $in: normalizedNumbers } });
  if (existing.length) throw Object.assign(new Error(`Room unit ${existing[0].unitNumber} already exists in this property`), { status: 409 });
  const now = new Date().toISOString();
  const units = await Promise.all(unitNumbers.map(async (unitNumber) => ({ id: await hotelRepository.nextId('room-unit'), companyId, listingId: roomType.listingId, propertyId: roomType.propertyId, roomTypeId: roomType.id, unitNumber, normalizedUnitNumber: normalizedKey(unitNumber), floor: clean(payload.floor), wing: clean(payload.wing), viewType: clean(payload.viewType), accessible: bool(payload.accessible), smokingAllowed: bool(payload.smokingAllowed), connectingRoom: bool(payload.connectingRoom), status: enumValue(payload.status, new Set(['available', 'maintenance', 'cleaning']), 'available', 'room status'), housekeepingStatus: enumValue(payload.housekeepingStatus, HOUSEKEEPING_STATUSES, 'clean', 'housekeeping status'), notes: clean(payload.notes), createdBy: actorId, createdAt: now })));
  await hotelRepository.transaction(async (session) => { for (const unit of units) await hotelRepository.roomUnits.insert(unit, { session }); });
  await hotelRepository.audit({ actorId, action: 'hotel.room_units.created', targetType: 'roomType', targetId: roomType.id, meta: { count: units.length } });
  return units;
}

async function updateRoomUnit(companyId, unitId, payload = {}, actorId = 'company-admin') {
  const unit = await hotelRepository.roomUnitOrThrow(companyId, unitId);
  if (payload.unitNumber || payload.roomNumber) {
    const unitNumber = clean(payload.unitNumber || payload.roomNumber); const normalizedUnitNumber = normalizedKey(unitNumber);
    const duplicate = await hotelRepository.roomUnits.findOne({ companyId, propertyId: unit.propertyId, normalizedUnitNumber, id: { $ne: unit.id } });
    if (duplicate) throw Object.assign(new Error(`Room unit ${unitNumber} already exists in this property`), { status: 409 });
    unit.unitNumber = unitNumber; unit.normalizedUnitNumber = normalizedUnitNumber;
  }
  ['floor','wing','viewType','notes'].forEach((field) => { if (typeof payload[field] !== 'undefined') unit[field] = clean(payload[field]); });
  ['accessible','smokingAllowed','connectingRoom'].forEach((field) => { if (typeof payload[field] !== 'undefined') unit[field] = bool(payload[field], unit[field]); });
  if (payload.housekeepingStatus) unit.housekeepingStatus = enumValue(payload.housekeepingStatus, HOUSEKEEPING_STATUSES, unit.housekeepingStatus || 'clean', 'housekeeping status');
  if (payload.status) {
    const nextStatus = enumValue(payload.status, ROOM_UNIT_STATUSES, unit.status || 'available', 'room status');
    if (nextStatus === 'archived' && unit.status !== 'archived') throw Object.assign(new Error('Use the dedicated room archive action so future reservations are checked first.'), { status: 409, code: 'hotel_room_archive_action_required' });
    if (['occupied', 'reserved'].includes(nextStatus) && nextStatus !== unit.status) throw Object.assign(new Error('Occupied and reserved room states are controlled by hotel booking and check-in workflows.'), { status: 409, code: 'hotel_room_status_workflow_owned' });
    unit.status = nextStatus;
  }
  unit.updatedBy = actorId; unit.updatedAt = new Date().toISOString();
  await hotelRepository.roomUnits.save(unit);
  await hotelRepository.audit({ actorId, action: 'hotel.room_unit.updated', targetType: 'roomUnit', targetId: unit.id });
  await reconcileHotelListingPublication(companyId, unit.listingId, actorId);
  return unit;
}

async function archiveRoomUnit(companyId, unitId, actorId = 'company-admin') {
  const unit = await hotelRepository.roomUnitOrThrow(companyId, unitId);
  const today = new Date().toISOString().slice(0, 10);
  const futureCommitted = await hotelRepository.roomNightInventories.count({ companyId, roomUnitId: unit.id, date: { $gte: today }, status: { $in: ['held','reserved','booked','occupied','checked_in'] } });
  if (futureCommitted) throw Object.assign(new Error('This room has current or future reservations and cannot be archived'), { status: 409 });
  const now = new Date().toISOString();
  await hotelRepository.transaction(async (session) => {
    await hotelRepository.roomUnits.updateOne({ id: unit.id, companyId }, { $set: { status: 'archived', updatedBy: actorId, updatedAt: now } }, { session });
    await hotelRepository.roomNightInventories.updateMany({ companyId, roomUnitId: unit.id, date: { $gte: today }, status: { $in: ['available','open','maintenance','cleaning','cancelled','refunded'] } }, { $set: { status: 'cancelled', availableInventory: 0, notes: 'Room unit archived', updatedBy: actorId, updatedAt: now } }, { session });
  });
  unit.status = 'archived'; unit.updatedBy = actorId; unit.updatedAt = now;
  await hotelRepository.audit({ actorId, action: 'hotel.room_unit.archived', targetType: 'roomUnit', targetId: unit.id });
  await reconcileHotelListingPublication(companyId, unit.listingId, actorId);
  return unit;
}

async function createNightInventory(companyId, payload = {}, actorId = 'company-admin') {
  const roomType = await hotelRepository.roomTypeOrThrow(companyId, payload.roomTypeId);
  const nights = dateRange(payload.startDate || payload.checkIn, payload.endDate || payload.checkOut);
  if (nights.length > 366) throw Object.assign(new Error('Room-night inventory may be created for at most 366 nights at a time'), { status: 422 });
  if (nights[0] < todayIsoUtc()) throw Object.assign(new Error('New room-night inventory cannot begin in the past'), { status: 422 });
  const ratePlanId = clean(payload.ratePlanId || roomType.defaultRatePlanId);
  const ratePlan = ratePlanId ? await hotelRepository.ratePlans.findOne({ id: ratePlanId, companyId, roomTypeId: roomType.id, status: 'active' }) : null;
  if (ratePlanId && !ratePlan) throw Object.assign(new Error('Select an active rate plan belonging to this room type'), { status: 422 });
  const requestedUnitIds = list(payload.roomUnitIds);
  const units = requestedUnitIds.length ? await hotelRepository.roomUnits.list({ companyId, id: { $in: requestedUnitIds }, status: { $nin: ['archived', 'maintenance'] } }) : await hotelRepository.roomUnits.list({ companyId, roomTypeId: roomType.id, status: { $nin: ['archived', 'maintenance'] } });
  if (requestedUnitIds.length && (units.some((unit) => unit.roomTypeId !== roomType.id) || units.length !== new Set(requestedUnitIds).size)) throw Object.assign(new Error('Every selected room unit must belong to the selected active room type'), { status: 422 });
  if (!units.length) throw Object.assign(new Error('At least one room unit is required'), { status: 422 });
  const existing = await hotelRepository.roomNightInventories.list({ companyId, roomUnitId: { $in: units.map((unit) => unit.id) }, date: { $in: nights } });
  const byKey = new Map(existing.map((row) => [`${row.roomUnitId}:${row.date}`, row])); const rows = [];
  for (const unit of units) for (const date of nights) {
    const key = `${unit.id}:${date}`; const row = byKey.get(key) || { id: await hotelRepository.nextId('room-night'), companyId, listingId: roomType.listingId, propertyId: roomType.propertyId, roomTypeId: roomType.id, roomUnitId: unit.id, date, createdBy: actorId, createdAt: new Date().toISOString() };
    if (row.bookingRef && ['held','reserved','booked','occupied','checked_in'].includes(clean(row.status))) continue;
    row.ratePlanId = ratePlan?.id || roomType.defaultRatePlanId || ''; row.price = Math.max(0, num(payload.price || payload.nightlyPrice || row.price || ratePlan?.basePrice || roomType.basePrice, roomType.basePrice));
    row.status = enumValue(payload.status, new Set(['available','maintenance','cleaning','open']), row.status || 'available', 'room-night status'); row.availableInventory = ['available','open'].includes(row.status) ? 1 : 0;
    row.closedToArrival = bool(payload.closedToArrival, row.closedToArrival); row.closedToDeparture = bool(payload.closedToDeparture, row.closedToDeparture); row.minStay = Math.max(1, Math.round(num(payload.minStay, row.minStay || ratePlan?.minStay || roomType.minStay || 1))); row.maxStay = Math.max(row.minStay, Math.round(num(payload.maxStay, row.maxStay || ratePlan?.maxStay || roomType.maxStay || 90))); row.notes = clean(payload.notes || row.notes); row.updatedBy = actorId; row.updatedAt = new Date().toISOString(); rows.push(row);
  }
  await hotelRepository.roomNightInventories.saveMany(rows, (row) => ({ roomUnitId: row.roomUnitId, date: row.date }));
  await hotelRepository.audit({ actorId, action: 'hotel.inventory.created', targetType: 'roomType', targetId: roomType.id, meta: { nights: nights.length, units: units.length, ratePlanId: ratePlan?.id || null } }); return rows;
}

async function updateNightStatus(companyId, inventoryId, payload = {}, actorId = 'company-admin') {
  const night = await hotelRepository.nightOrThrow(companyId, inventoryId);
  const current = normalizeLifecycleStatus(night.status || 'available');
  const requested = normalizeLifecycleStatus(payload.status || current);
  const manualStatuses = new Set(['available', 'open', 'maintenance', 'cleaning', 'cancelled']);
  const committedStatuses = new Set(['held', 'reserved', 'booked', 'occupied', 'checked_in']);
  if (!manualStatuses.has(requested)) {
    const error = new Error('Booked, held, occupied, checked-in, checked-out and refunded room nights are controlled by booking, payment, stay and refund workflows.');
    error.status = 409;
    error.code = 'hotel_inventory_workflow_owned';
    throw error;
  }
  if ((night.bookingRef || night.reservationId || night.assignmentId) && committedStatuses.has(current) && requested !== current) {
    const error = new Error('This room night belongs to an active reservation and cannot be changed manually.');
    error.status = 409;
    error.code = 'hotel_inventory_committed';
    throw error;
  }
  const transitions = {
    available: new Set(['available', 'open', 'maintenance', 'cleaning', 'cancelled']),
    open: new Set(['available', 'open', 'maintenance', 'cleaning', 'cancelled']),
    maintenance: new Set(['maintenance', 'available', 'open', 'cancelled']),
    cleaning: new Set(['cleaning', 'available', 'open', 'maintenance', 'cancelled']),
    checked_out: new Set(['cleaning', 'available', 'open', 'maintenance']),
    cancelled: new Set(['cancelled', 'available', 'open', 'maintenance']),
    refunded: new Set(['refunded', 'available', 'open', 'maintenance']),
  };
  if (!(transitions[current] || new Set([current])).has(requested)) {
    const error = new Error(`Room-night status cannot change from ${current} to ${requested} through inventory maintenance.`);
    error.status = 409;
    error.code = 'hotel_inventory_invalid_transition';
    throw error;
  }
  const now = new Date().toISOString();
  Object.assign(night, {
    status: requested,
    availableInventory: ['available', 'open'].includes(requested) ? 1 : 0,
    notes: clean(payload.notes || night.notes || ''),
    updatedBy: actorId,
    updatedAt: now,
  });
  if (['available', 'open'].includes(requested) && !night.bookingRef) {
    night.reservationId = ''; night.assignmentId = ''; night.guestName = ''; night.checkInStatus = '';
  }
  const unit = night.roomUnitId ? await hotelRepository.roomUnits.findOne({ id: night.roomUnitId, companyId }) : null;
  if (unit && !['occupied', 'reserved', 'archived'].includes(normalizeLifecycleStatus(unit.status))) {
    if (requested === 'maintenance') { unit.status = 'maintenance'; unit.housekeepingStatus = 'maintenance'; }
    else if (requested === 'cleaning') { unit.status = 'cleaning'; unit.housekeepingStatus = 'cleaning'; }
    else if (['available', 'open'].includes(requested)) { unit.status = 'available'; if (!['dirty', 'cleaning'].includes(unit.housekeepingStatus)) unit.housekeepingStatus = 'ready'; }
    unit.updatedBy = actorId; unit.updatedAt = now;
  }
  await hotelRepository.transaction(async (session) => {
    await hotelRepository.roomNightInventories.save(night, { id: night.id }, { session });
    if (unit) await hotelRepository.roomUnits.save(unit, { id: unit.id }, { session });
  });
  await hotelRepository.audit({ actorId, action: 'hotel.room_night.status', targetType: 'roomNightInventory', targetId: night.id, meta: { from: current, to: requested } });
  await reconcileHotelListingPublication(companyId, night.listingId, actorId);
  return night;
}

async function archiveNightInventory(companyId, inventoryId, actorId = 'company-admin') {
  return updateNightStatus(companyId, inventoryId, { status: 'cancelled', notes: 'Inventory archived by company administrator' }, actorId);
}

async function availableNightGroups(listingId, checkIn, checkOut, roomTypeId = '', selectedUnitIds = []) {
  const nights = dateRange(checkIn, checkOut);
  const selected = new Set((selectedUnitIds || []).map(String).filter(Boolean));
  const filter = { listingId, date: { $in: nights }, status: { $in: ['available', 'open'] }, availableInventory: { $gt: 0 } };
  if (roomTypeId) filter.roomTypeId = roomTypeId;
  if (selected.size) filter.roomUnitId = { $in: Array.from(selected) };
  const all = await hotelRepository.roomNightInventories.list(filter, { sort: { roomUnitId: 1, date: 1 } });
  const unitIds = [...new Set(all.map((night) => night.roomUnitId).filter(Boolean))];
  const units = unitIds.length ? await hotelRepository.roomUnits.list({ listingId, id: { $in: unitIds }, status: 'available' }) : [];
  const readyUnitIds = new Set(units.filter(hotelInventoryService.unitIsReady).map((unit) => unit.id));
  const byUnit = new Map();
  all.forEach((night) => {
    if (!readyUnitIds.has(night.roomUnitId)) return;
    if (!byUnit.has(night.roomUnitId)) byUnit.set(night.roomUnitId, []);
    byUnit.get(night.roomUnitId).push(night);
  });
  return Array.from(byUnit.values()).filter((rows) => {
    if (rows.length !== nights.length) return false;
    const byDate = new Map(rows.map((night) => [night.date, night]));
    return nights.every((date) => {
      const night = byDate.get(date);
      return night && !night.bookingRef && Number(night.availableInventory ?? 1) > 0;
    });
  });
}

function todayIsoUtc() {
  return new Date().toISOString().slice(0, 10);
}

function assertHotelStayWindow(checkIn, checkOut, nights) {
  if (checkIn < todayIsoUtc()) {
    const error = new Error('Check-in cannot be in the past');
    error.status = 422;
    throw error;
  }
  if (!Array.isArray(nights) || nights.length < 1 || nights.length > 90) {
    const error = new Error('Hotel stays must be between 1 and 90 nights');
    error.status = 422;
    throw error;
  }
  if (checkOut <= checkIn) {
    const error = new Error('Check-out must be after check-in');
    error.status = 422;
    throw error;
  }
}

function hotelAddonMultiplier(chargeBasis, { roomCount, guestCount, nightCount }) {
  if (chargeBasis === 'per_passenger') return guestCount;
  if (chargeBasis === 'per_trip_leg') return roomCount * nightCount;
  if (chargeBasis === 'per_passenger_per_leg') return guestCount * nightCount;
  return 1;
}

async function priceHotelAddons({ listing, selectedIds, roomCount, guestCount, nightCount }) {
  const ids = [...new Set(list(selectedIds))];
  if (ids.length > 20) {
    const error = new Error('No more than 20 hotel add-ons may be selected');
    error.status = 422;
    throw error;
  }
  if (!ids.length) return { addons: [], total: 0 };
  const rows = await hotelRepository.serviceAddons.list({
    id: { $in: ids },
    companyId: listing.companyId,
    listingId: listing.id,
    serviceType: 'hotel',
    status: 'active',
  }, { sort: { sortOrder: 1, name: 1 } });
  if (rows.length !== ids.length) {
    const error = new Error('One or more selected hotel add-ons are unavailable');
    error.status = 422;
    throw error;
  }
  const listingCurrency = clean(listing.currency || platformCurrency()).toUpperCase();
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const addons = ids.map((id) => {
    const row = byId.get(id);
    const currency = clean(row.currency || '').toUpperCase();
    if (currency !== listingCurrency) {
      const error = new Error(`Add-on ${row.name || id} uses a different currency from this hotel`);
      error.status = 422;
      throw error;
    }
    const unitPrice = Math.max(0, num(row.price, 0));
    const quantity = hotelAddonMultiplier(row.chargeBasis || 'per_booking', { roomCount, guestCount, nightCount });
    return {
      id: row.id,
      name: clean(row.name),
      description: clean(row.description),
      category: clean(row.category || 'other'),
      icon: clean(row.icon || 'fa-circle-plus'),
      chargeBasis: clean(row.chargeBasis || 'per_booking'),
      unitPrice,
      quantity,
      currency,
      lineTotal: unitPrice * quantity,
    };
  });
  return { addons, total: addons.reduce((sum, row) => sum + Number(row.lineTotal || 0), 0) };
}

function applyHotelBookingLifecycle(booking, status) {
  const successful = status === 'successful';
  const now = new Date().toISOString();
  booking.bookingItems = (booking.bookingItems || []).map((item) => ({
    ...item,
    status: successful ? 'confirmed' : 'awaiting_payment',
  }));
  booking.ticketLegs = (booking.ticketLegs || []).map((leg) => ({
    ...leg,
    status: successful ? 'valid' : 'pending_payment',
    issuedAt: successful ? (leg.issuedAt || now) : null,
  }));
  booking.hotelStay = {
    ...(booking.hotelStay || {}),
    status: successful ? 'booked' : 'pending_payment',
  };
  booking.bookingStatus = successful ? 'confirmed' : 'pending_payment';
  if (successful) booking.lockedUntil = null;
  return booking;
}

async function createRatePlan(companyId, payload = {}, actorId = 'company-admin') {
  const roomType = await hotelRepository.roomTypeOrThrow(companyId, payload.roomTypeId);
  const listing = await hotelRepository.listingOrThrow(companyId, roomType.listingId);
  const code = clean(payload.code || payload.name || 'RATE').toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 40);
  const duplicate = await hotelRepository.ratePlans.findOne({ companyId, roomTypeId: roomType.id, code });
  if (duplicate) throw Object.assign(new Error('This rate-plan code already exists for the selected room type'), { status: 409 });
  const row = { id: await hotelRepository.nextId('rate-plan'), companyId, listingId: roomType.listingId, propertyId: roomType.propertyId, roomTypeId: roomType.id, name: clean(payload.name || 'Flexible rate'), code, currency: clean(listing.currency || platformCurrency()).toUpperCase(), pricingMode: enumValue(payload.pricingMode, RATE_PRICING_MODES, 'nightly_inventory', 'pricing mode'), basePrice: Math.max(0, num(payload.basePrice, roomType.basePrice || 0)), mealPlan: enumValue(payload.mealPlan, MEAL_PLANS, roomType.mealPlan || 'room_only', 'meal plan'), refundable: bool(payload.refundable, true), cancellationDeadlineHours: Math.max(0, num(payload.cancellationDeadlineHours, 24)), cancellationPenaltyType: enumValue(payload.cancellationPenaltyType, CANCELLATION_PENALTY_TYPES, 'first_night', 'cancellation penalty'), cancellationPenaltyValue: Math.max(0, num(payload.cancellationPenaltyValue, 0)), paymentTiming: enumValue(payload.paymentTiming, PAYMENT_TIMINGS, 'pay_now', 'payment timing'), depositType: 'none', depositAmount: 0, minStay: Math.max(1, Math.round(num(payload.minStay, roomType.minStay || 1))), maxStay: Math.max(1, Math.round(num(payload.maxStay, roomType.maxStay || 90))), extraAdultFee: Math.max(0, num(payload.extraAdultFee, roomType.extraAdultFee || 0)), extraChildFee: Math.max(0, num(payload.extraChildFee, roomType.extraChildFee || 0)), includedAdults: Math.max(1, Math.round(num(payload.includedAdults, roomType.maxAdults || 1))), includedChildren: Math.max(0, Math.round(num(payload.includedChildren, roomType.maxChildren || 0))), policySnapshot: { roomPolicies: roomType.policies || [] }, status: enumValue(payload.status, new Set(['active', 'paused']), 'active', 'rate-plan status'), createdBy: actorId, createdAt: new Date().toISOString() };
  if (row.maxStay < row.minStay) throw Object.assign(new Error('Maximum stay must be greater than or equal to minimum stay'), { status: 422 });
  if (row.cancellationPenaltyType === 'percentage' && row.cancellationPenaltyValue > 100) throw Object.assign(new Error('Percentage cancellation penalty cannot exceed 100'), { status: 422 });
  await hotelRepository.ratePlans.insert(row);
  await hotelRepository.audit({ actorId, action: 'hotel.rate_plan.created', targetType: 'ratePlan', targetId: row.id });
  await reconcileHotelListingPublication(companyId, row.listingId, actorId);
  return row;
}

async function updateRatePlan(companyId, ratePlanId, payload = {}, actorId = 'company-admin') {
  const row = await hotelRepository.ratePlans.findOne({ id: ratePlanId, companyId });
  if (!row) throw Object.assign(new Error('Hotel rate plan not found'), { status: 404 });
  if (typeof payload.name !== 'undefined') row.name = clean(payload.name);
  if (typeof payload.pricingMode !== 'undefined') row.pricingMode = enumValue(payload.pricingMode, RATE_PRICING_MODES, row.pricingMode || 'nightly_inventory', 'pricing mode');
  if (typeof payload.cancellationPenaltyType !== 'undefined') row.cancellationPenaltyType = enumValue(payload.cancellationPenaltyType, CANCELLATION_PENALTY_TYPES, row.cancellationPenaltyType || 'first_night', 'cancellation penalty');
  row.paymentTiming = enumValue(payload.paymentTiming, PAYMENT_TIMINGS, 'pay_now', 'payment timing');
  row.depositType = 'none';
  row.depositAmount = 0;
  ['basePrice','cancellationDeadlineHours','cancellationPenaltyValue','extraAdultFee','extraChildFee','includedChildren'].forEach((field) => {
    if (typeof payload[field] !== 'undefined' && payload[field] !== '') row[field] = Math.max(0, num(payload[field], row[field] || 0));
  });
  ['minStay','maxStay','includedAdults'].forEach((field) => {
    if (typeof payload[field] !== 'undefined' && payload[field] !== '') row[field] = Math.max(1, Math.round(num(payload[field], row[field] || 1)));
  });
  if (Number(row.maxStay || 1) < Number(row.minStay || 1)) throw Object.assign(new Error('Maximum stay must be greater than or equal to minimum stay'), { status: 422 });
  if (row.cancellationPenaltyType === 'percentage' && Number(row.cancellationPenaltyValue || 0) > 100) throw Object.assign(new Error('Percentage cancellation penalty cannot exceed 100'), { status: 422 });
  if (payload.mealPlan) row.mealPlan = enumValue(payload.mealPlan, MEAL_PLANS, row.mealPlan || 'room_only', 'meal plan');
  if (typeof payload.refundable !== 'undefined') row.refundable = bool(payload.refundable, row.refundable);
  if (payload.status) {
    const nextStatus = enumValue(payload.status, new Set(['active', 'paused']), row.status || 'active', 'rate-plan status');
    if (nextStatus === 'archived' && row.status !== 'archived') throw Object.assign(new Error('Use the dedicated rate-plan archive action so future reservations and room-night pricing are checked first.'), { status: 409, code: 'hotel_rate_plan_archive_action_required' });
    row.status = nextStatus;
  }
  row.updatedBy = actorId;
  row.updatedAt = new Date().toISOString();
  await hotelRepository.ratePlans.save(row);
  await hotelRepository.audit({ actorId, action: 'hotel.rate_plan.updated', targetType: 'ratePlan', targetId: row.id });
  await reconcileHotelListingPublication(companyId, row.listingId, actorId);
  return row;
}


async function archiveRatePlan(companyId, ratePlanId, actorId = 'company-admin') {
  const row = await hotelRepository.ratePlans.findOne({ id: ratePlanId, companyId });
  if (!row) throw Object.assign(new Error('Hotel rate plan not found'), { status: 404 });
  if (row.status === 'archived') return row;
  const today = todayIsoUtc();
  const committed = await hotelRepository.roomAssignments.count({
    companyId,
    ratePlanId: row.id,
    checkOutDate: { $gte: today },
    status: { $in: ['awaiting_payment', 'assigned', 'occupied'] },
  });
  if (committed) {
    throw Object.assign(new Error('This rate plan is attached to current or future reservations and cannot be archived.'), {
      status: 409,
      code: 'hotel_rate_plan_has_reservations',
    });
  }

  const replacement = await hotelRepository.ratePlans.findOne({
    companyId,
    roomTypeId: row.roomTypeId,
    id: { $ne: row.id },
    status: 'active',
  }, { sort: { createdAt: 1 } });
  const roomType = await hotelRepository.roomTypes.findOne({ id: row.roomTypeId, companyId });
  const now = new Date().toISOString();

  await hotelRepository.transaction(async (session) => {
    await hotelRepository.ratePlans.updateOne({ id: row.id, companyId }, {
      $set: { status: 'archived', updatedBy: actorId, updatedAt: now },
    }, { session });
    if (roomType && roomType.defaultRatePlanId === row.id) {
      await hotelRepository.roomTypes.updateOne({ id: roomType.id, companyId }, {
        $set: { defaultRatePlanId: replacement?.id || '', updatedBy: actorId, updatedAt: now },
      }, { session });
    }
    await hotelRepository.roomNightInventories.updateMany({
      companyId,
      roomTypeId: row.roomTypeId,
      ratePlanId: row.id,
      date: { $gte: today },
      status: { $in: ['available', 'open', 'maintenance', 'cleaning', 'cancelled'] },
    }, {
      $set: { ratePlanId: replacement?.id || '', updatedBy: actorId, updatedAt: now },
    }, { session });
  });

  row.status = 'archived';
  row.updatedBy = actorId;
  row.updatedAt = now;
  await hotelRepository.audit({
    actorId,
    action: 'hotel.rate_plan.archived',
    targetType: 'ratePlan',
    targetId: row.id,
    meta: { roomTypeId: row.roomTypeId, replacementRatePlanId: replacement?.id || null },
  });
  await reconcileHotelListingPublication(companyId, row.listingId, actorId);
  return row;
}

async function buildCanonicalHotelRecords({ booking, listing, property, roomTypes, roomUnits, groups, guests, ratePlan, payload }) {
  const reservationId = await hotelRepository.nextId('hotel-reservation');
  const successful = booking.paymentStatus === 'successful';
  const reservationStatus = successful ? 'confirmed' : 'awaiting_payment';
  const assignmentStatus = successful ? 'assigned' : 'awaiting_payment';
  const bookingItemStatus = successful ? 'confirmed' : 'awaiting_payment';
  const bookingItems = [];
  const roomAssignments = [];
  const hotelGuests = [];

  for (let roomIndex = 0; roomIndex < groups.length; roomIndex += 1) {
    const rows = groups[roomIndex];
    const roomType = roomTypes[roomIndex] || {};
    const roomUnit = roomUnits[roomIndex] || {};
    const item = booking.bookingItems[roomIndex] || {};
    const bookingItemId = await hotelRepository.nextId('booking-item');
    const assignmentId = await hotelRepository.nextId('room-assignment');
    bookingItems.push({
      id: bookingItemId, bookingId: booking.id, bookingRef: booking.bookingRef, companyId: booking.companyId,
      listingId: booking.listingId, serviceType: 'hotel', domainReservationId: reservationId, quantity: 1,
      pricing: { roomSubtotal: Number(item.roomSubtotal || 0), occupancySurcharge: Number(item.occupancySurcharge || 0), subtotal: Number(item.price || 0), fees: 0, addonTotal: 0, total: Number(item.price || 0), currency: booking.pricing.currency },
      priceSnapshot: { roomTypeId: roomType.id, roomTypeName: roomType.name, roomUnitId: roomUnit.id, roomNumber: roomUnit.unitNumber, nightIds: rows.map((night) => night.id), nightlyPrices: rows.map((night) => ({ date: night.date, price: Number(night.price || 0), ratePlanId: night.ratePlanId || ratePlan?.id || '' })), occupancyCharge: item.occupancyChargeSnapshot || {} },
      policySnapshot: ratePlan?.policySnapshot || { roomPolicies: roomType.policies || [], propertyPolicies: property.policies || [] }, status: bookingItemStatus,
    });
    roomAssignments.push({
      id: assignmentId, reservationId, bookingItemId, bookingId: booking.id, bookingRef: booking.bookingRef, companyId: booking.companyId, listingId: booking.listingId,
      propertyId: property.id, roomTypeId: roomType.id, roomUnitId: roomUnit.id, roomNumberSnapshot: roomUnit.unitNumber, roomTypeSnapshot: roomType.name,
      ratePlanId: ratePlan?.id || roomType.defaultRatePlanId || '', ratePlanSnapshot: ratePlan || {}, checkInDate: booking.hotelStay.checkIn, checkOutDate: booking.hotelStay.checkOut,
      nightIds: rows.map((night) => night.id), guestIds: [], pricing: { roomSubtotal: Number(item.roomSubtotal || 0), occupancySurcharge: Number(item.occupancySurcharge || 0), subtotal: Number(item.price || 0), fees: 0, addonTotal: 0, total: Number(item.price || 0), currency: booking.pricing.currency },
      status: assignmentStatus, assignedAt: successful ? new Date() : null,
    });
  }

  for (let guestIndex = 0; guestIndex < guests.length; guestIndex += 1) {
    const guest = guests[guestIndex] || {};
    const roomIndex = Math.max(0, Math.min(roomAssignments.length - 1, Number(guest.roomIndex || 0)));
    const assignment = roomAssignments[roomIndex];
    const guestId = await hotelRepository.nextId('hotel-guest');
    const row = {
      id: guestId, reservationId, bookingId: booking.id, bookingRef: booking.bookingRef, companyId: booking.companyId, listingId: booking.listingId,
      roomAssignmentId: assignment?.id || '', roomIndex, guestType: guest.guestType || 'adult', guestIndex, isLeadGuest: guestIndex === 0,
      fullName: clean(guest.fullName), email: clean(guest.email).toLowerCase(), phone: clean(guest.phone), identityType: clean(guest.identityType), identityNumber: clean(guest.identityNumber), nationality: clean(guest.nationality),
      dateOfBirth: guest.dateOfBirth || null, sex: clean(guest.sex), emergencyContactName: clean(guest.emergencyContactName), emergencyContactPhone: clean(guest.emergencyContactPhone), specialRequests: clean(guest.specialRequests), checkInStatus: 'not_checked',
    };
    hotelGuests.push(row);
    if (assignment) assignment.guestIds.push(guestId);
  }

  const reservation = {
    id: reservationId, bookingId: booking.id, bookingRef: booking.bookingRef, bookingItemIds: bookingItems.map((item) => item.id), companyId: booking.companyId,
    listingId: booking.listingId, propertyId: property.id, customerUserId: booking.customerUserId, leadGuestId: hotelGuests[0]?.id || '', checkInDate: booking.hotelStay.checkIn,
    checkOutDate: booking.hotelStay.checkOut, roomCount: booking.hotelStay.roomCount, adults: booking.hotelStay.adults, children: booking.hotelStay.children, infants: booking.hotelStay.infants || 0,
    status: reservationStatus, paymentStatus: booking.paymentStatus, settlementStatus: successful ? 'pending_fulfillment' : 'pending_payment', pricing: booking.pricing,
    priceSnapshot: { property: { id: property.id, name: property.propertyName, taxes: property.taxPercent, serviceFee: property.serviceFeePercent }, ratePlan: ratePlan || null, occupancyCharges: booking.pricing.occupancyCharges || [], rooms: bookingItems.map((item) => item.priceSnapshot) },
    policySnapshot: { ratePlan: ratePlan?.policySnapshot || {}, propertyPolicies: property.policies || [], childPolicy: property.childPolicy || '', petPolicy: property.petPolicy || '', smokingPolicy: property.smokingPolicy || '', depositPolicy: property.depositPolicy || '' },
    estimatedArrivalTime: clean(payload.estimatedArrivalTime || payload.arrivalTime), arrivalNotes: clean(payload.arrivalNotes), departureNotes: clean(payload.departureNotes),
    specialRequests: booking.hotelStay.specialRequests, source: clean(payload.source || booking.bookingChannel || 'web').toLowerCase().replace(/-/g, '_'),
  };
  return { reservation, bookingItems, roomAssignments, guests: hotelGuests };
}

async function createHotelBooking(payload = {}, req = {}, options = {}) {
  const listing = await hotelRepository.publicListingOrThrow(payload.listingId || payload.slug);
  const checkIn = isoDate(payload.checkInDate || payload.checkIn || payload.startDate);
  const checkOut = isoDate(payload.checkOutDate || payload.checkOut || payload.endDate);
  const nights = dateRange(checkIn, checkOut);
  assertHotelStayWindow(checkIn, checkOut, nights);

  const rawRoomCount = num(payload.roomCount || payload.rooms, 1);
  const rawAdults = num(payload.adults, 1);
  const rawChildren = num(payload.children, 0);
  if (!Number.isInteger(rawRoomCount) || rawRoomCount < 1 || rawRoomCount > 10) throw Object.assign(new Error('Room count must be between 1 and 10'), { status: 422 });
  if (!Number.isInteger(rawAdults) || rawAdults < 1 || rawAdults > 40) throw Object.assign(new Error('Adults must be between 1 and 40'), { status: 422 });
  if (!Number.isInteger(rawChildren) || rawChildren < 0 || rawChildren > 40) throw Object.assign(new Error('Children must be between 0 and 40'), { status: 422 });
  const roomCount = rawRoomCount;
  const adults = rawAdults;
  const children = rawChildren;
  const roomTypeId = clean(payload.roomTypeId || '').slice(0, 180);
  if (!roomTypeId) {
    const error = new Error('Select a room type');
    error.status = 422;
    throw error;
  }
  const selectedRoomUnitIds = [...new Set(list(payload.roomUnitIds || payload.roomUnitId || payload.selected || '').slice(0, 10).map((id) => id.slice(0, 180)))];
  const preferredGroups = selectedRoomUnitIds.length
    ? await availableNightGroups(listing.id, checkIn, checkOut, roomTypeId, selectedRoomUnitIds)
    : [];
  const allGroups = await availableNightGroups(listing.id, checkIn, checkOut, roomTypeId, []);
  const preferredUnits = new Set(preferredGroups.map((rows) => rows[0]?.roomUnitId));
  const groups = [...preferredGroups, ...allGroups.filter((rows) => !preferredUnits.has(rows[0]?.roomUnitId))].slice(0, roomCount);
  if (groups.length < roomCount) {
    const error = new Error('Not enough room-night inventory is available for the selected dates');
    error.status = 409;
    throw error;
  }

  let rawGuests = [];
  try { rawGuests = typeof payload.guests === 'string' ? JSON.parse(payload.guests || '[]') : (payload.guests || payload.guestDetails || []); } catch (_) { rawGuests = []; }
  if (!Array.isArray(rawGuests)) rawGuests = [];
  const buyer = bookingGuestIdentity(payload, rawGuests, req);
  const infants = Math.max(0, Math.round(num(payload.infants, 0)));
  const guests = normalizeHotelGuests(payload, buyer, roomCount, { adults, children, infants });
  const expectedGuestCount = adults + children + infants;
  if (guests.length !== expectedGuestCount) {
    const error = new Error(`Provide one guest name for every traveler (${expectedGuestCount} total, including the lead guest).`);
    error.status = 422;
    error.code = 'hotel_complete_guest_manifest_required';
    throw error;
  }

  const selectedRows = groups.flat();
  const unitIds = groups.map((rows) => rows[0].roomUnitId);
  const typeIds = [...new Set(groups.map((rows) => rows[0].roomTypeId))];
  const unitRows = await hotelRepository.roomUnits.list({ companyId: listing.companyId, listingId: listing.id, id: { $in: unitIds }, status: { $ne: 'archived' } });
  const typeRows = await hotelRepository.roomTypes.list({ companyId: listing.companyId, listingId: listing.id, id: { $in: typeIds }, status: 'active' });
  const blockedUnit = unitRows.find((unit) => !hotelInventoryService.unitIsReady(unit));
  if (unitRows.length !== unitIds.length || typeRows.length !== typeIds.length || blockedUnit) {
    const error = new Error('One or more selected rooms are no longer bookable');
    error.status = 409;
    throw error;
  }
  const unitsById = new Map(unitRows.map((unit) => [unit.id, unit]));
  const typesById = new Map(typeRows.map((type) => [type.id, type]));
  const roomUnits = groups.map((rows) => unitsById.get(rows[0].roomUnitId) || {});
  const roomTypes = groups.map((rows) => typesById.get(rows[0].roomTypeId) || {});
  const propertyId = roomTypes[0]?.propertyId || selectedRows[0]?.propertyId;
  const property = await hotelRepository.hotelProperties.findOne({ id: propertyId, companyId: listing.companyId, listingId: listing.id, status: 'active' });
  if (!property) throw Object.assign(new Error('The selected room type is not attached to an active hotel property'), { status: 409 });
  const selectedRatePlanId = clean(payload.ratePlanId || roomTypes[0]?.defaultRatePlanId || selectedRows[0]?.ratePlanId);
  const ratePlan = selectedRatePlanId ? await hotelRepository.ratePlans.findOne({ id: selectedRatePlanId, companyId: listing.companyId, roomTypeId, status: 'active' }) : null;
  if (selectedRatePlanId && !ratePlan) throw Object.assign(new Error('The selected rate plan is no longer active'), { status: 409 });
  const minStay = Math.max(1, Number(ratePlan?.minStay || roomTypes[0]?.minStay || 1));
  const maxStay = Math.max(minStay, Number(ratePlan?.maxStay || roomTypes[0]?.maxStay || 90));
  if (nights.length < minStay || nights.length > maxStay) throw Object.assign(new Error(`This rate requires a stay between ${minStay} and ${maxStay} nights`), { status: 422 });
  const restrictedStay = groups.some((rows) => {
    const ordered = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return Boolean(ordered[0]?.closedToArrival || ordered[ordered.length - 1]?.closedToDeparture);
  });
  if (restrictedStay) throw Object.assign(new Error('The selected rate is closed for arrival or departure on these dates'), { status: 409 });
  const totalCapacity = roomTypes.reduce((sum, roomType) => sum + Math.max(1, Number(roomType.capacity || 1)), 0);
  if (adults + children > totalCapacity) {
    const error = new Error(`The selected room${roomCount > 1 ? 's' : ''} can accommodate at most ${totalCapacity} guest${totalCapacity === 1 ? '' : 's'}`);
    error.status = 422;
    throw error;
  }
  const roomOccupancyCharges = roomTypes.map((roomType, roomIndex) => {
    const assigned = guests.filter((guest) => Number(guest.roomIndex || 0) === roomIndex);
    const adultCount = assigned.filter((guest) => guest.guestType === 'adult').length;
    const childCount = assigned.filter((guest) => guest.guestType === 'child').length;
    const infantCount = assigned.filter((guest) => guest.guestType === 'infant').length;
    const capacity = Math.max(1, Number(roomType.capacity || 1));
    const maxAdults = Math.max(1, Number(roomType.maxAdults || capacity));
    const maxChildren = Math.max(0, Number(roomType.maxChildren || 0));
    const maxInfants = Math.max(0, Number(roomType.maxInfants || 0));
    if (adultCount < 1 || adultCount > maxAdults || childCount > maxChildren || infantCount > maxInfants || adultCount + childCount > capacity) {
      const roomLabel = roomUnits[roomIndex]?.unitNumber || roomType.name || `Room ${roomIndex + 1}`;
      const error = new Error(`${roomLabel} does not support the assigned adult, child, and infant occupancy.`);
      error.status = 422;
      error.code = 'hotel_room_occupancy_exceeded';
      throw error;
    }
    const includedAdults = Math.max(1, Number(ratePlan?.includedAdults ?? roomType.maxAdults ?? 1));
    const includedChildren = Math.max(0, Number(ratePlan?.includedChildren ?? roomType.maxChildren ?? 0));
    const extraAdults = Math.max(0, adultCount - includedAdults);
    const extraChildren = Math.max(0, childCount - includedChildren);
    const extraAdultFee = Math.max(0, Number(ratePlan?.extraAdultFee ?? roomType.extraAdultFee ?? 0));
    const extraChildFee = Math.max(0, Number(ratePlan?.extraChildFee ?? roomType.extraChildFee ?? 0));
    const perNight = Number((extraAdults * extraAdultFee + extraChildren * extraChildFee).toFixed(2));
    return {
      roomIndex,
      roomUnitId: roomUnits[roomIndex]?.id || '',
      roomTypeId: roomType.id || '',
      adultCount,
      childCount,
      infantCount,
      includedAdults,
      includedChildren,
      extraAdults,
      extraChildren,
      extraAdultFee,
      extraChildFee,
      perNight,
      nights: nights.length,
      total: Number((perNight * nights.length).toFixed(2)),
    };
  });

  const currency = clean(listing.currency || platformCurrency()).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    const error = new Error('The hotel has an invalid booking currency');
    error.status = 422;
    throw error;
  }
  const roomSubtotal = selectedRows.reduce((total, night) => total + Number(night.price ?? listing.priceFrom ?? 0), 0);
  const occupancySurcharge = Number(roomOccupancyCharges.reduce((sum, row) => sum + Number(row.total || 0), 0).toFixed(2));
  const addonPricing = await priceHotelAddons({
    listing,
    selectedIds: payload.addons,
    roomCount,
    guestCount: adults + children,
    nightCount: nights.length,
  });
  const taxableRoomTotal = roomSubtotal + occupancySurcharge;
  const propertyTax = Number((taxableRoomTotal * Math.max(0, Number(property.taxPercent || 0)) / 100).toFixed(2));
  const propertyServiceFee = Number((taxableRoomTotal * Math.max(0, Number(property.serviceFeePercent || 0)) / 100).toFixed(2));
  const subtotal = taxableRoomTotal + addonPricing.total + propertyTax + propertyServiceFee;
  const customerFees = calculateCustomerFees(subtotal);
  const fees = customerFees.totalFees;
  const total = customerFees.total;
  const company = await hotelRepository.companyOrThrow(listing.companyId);
  const split = calculateCommission(total, Boolean(payload.promoterAttribution?.promoterId || payload.referralCode), { commissionPercent: company?.commercialTerms?.commissionPercent });
  const requestedSourceForPricing = clean(payload.source).toLowerCase().replace(/-/g, '_');
  if (requestedSourceForPricing === 'agent_offline') {
    const trustedOfflinePricing = options.trustedOffline === true && String(options.companyId || '') === String(listing.companyId || '') && clean(options.actorId);
    if (!trustedOfflinePricing) throw Object.assign(new Error('Offline hotel cash sales may be created only by an approved promoter workflow'), { status: 403, code: 'untrusted_offline_hotel_sale' });
    const amountCollected = Number(payload.amountCollected || payload.total || 0);
    if (!Number.isFinite(amountCollected) || amountCollected + 0.0001 < total) {
      throw Object.assign(new Error(`Collected amount is below the computed booking total of ${currency} ${total}`), { status: 422, code: 'offline_amount_below_total' });
    }
  }
  const bookingRef = generateBookingRef('hotel');
  const createdAt = new Date().toISOString();

  const bookingItems = groups.map((rows, index) => ({
    id: `hotel-room-${index + 1}`,
    serviceType: 'hotel',
    listingId: listing.id,
    roomTypeId: rows[0].roomTypeId,
    roomUnitId: rows[0].roomUnitId,
    roomNumber: roomUnits[index]?.unitNumber || '',
    checkIn,
    checkOut,
    nights: rows.map((night) => night.date),
    nightIds: rows.map((night) => night.id),
    roomSubtotal: rows.reduce((sum, night) => sum + Number(night.price ?? listing.priceFrom ?? 0), 0),
    occupancySurcharge: Number(roomOccupancyCharges[index]?.total || 0),
    occupancyChargeSnapshot: roomOccupancyCharges[index] || {},
    price: Number((rows.reduce((sum, night) => sum + Number(night.price ?? listing.priceFrom ?? 0), 0) + Number(roomOccupancyCharges[index]?.total || 0)).toFixed(2)),
    status: 'awaiting_payment',
  }));
  const ticketLegs = bookingItems.map((item, index) => ({
    id: `${bookingRef}-ROOM-${index + 1}`,
    serviceType: 'hotel',
    legType: 'stay',
    roomTypeId: item.roomTypeId,
    roomUnitId: item.roomUnitId,
    roomNumber: item.roomNumber,
    checkIn,
    checkOut,
    qrCodeValue: `CLASSIC-TRIP:HOTEL:${bookingRef}:${item.roomUnitId}:${Date.now()}`,
    status: 'pending_payment',
  }));
  const booking = {
    id: await hotelRepository.nextId('booking'),
    bookingRef,
    guestLookupCode: crypto.randomBytes(6).toString('hex').toUpperCase(),
    serviceType: 'hotel',
    guestSnapshot: { ...buyer },
    customerUserId: clean(payload.customerUserId) || (['agent_offline', 'company_manual', 'admin_manual'].includes(clean(payload.source).toLowerCase().replace(/-/g, '_')) ? null : (req?.session?.user?.id || null)),
    promoterAttribution: payload.promoterAttribution || null,
    referralCode: clean(payload.referralCode || payload.promoterAttribution?.code || ''),
    companyId: listing.companyId,
    tenantId: listing.companyId,
    listingId: listing.id,
    passengers: guests.map((guest, index) => {
      const roomIndex = Math.max(0, Math.min(roomUnits.length - 1, Number(guest.roomIndex || 0)));
      return {
        id: `guest-${index + 1}`, fullName: clean(guest.fullName), email: clean(guest.email).toLowerCase(), phone: clean(guest.phone),
        identityType: clean(guest.identityType), identityNumber: clean(guest.identityNumber), nationality: clean(guest.nationality), dateOfBirth: guest.dateOfBirth || null,
        sex: clean(guest.sex), emergencyContactName: clean(guest.emergencyContactName), emergencyContactPhone: clean(guest.emergencyContactPhone), guestType: guest.guestType,
        specialNotes: clean(guest.specialRequests), roomIndex, seatOrRoom: roomUnits[roomIndex]?.unitNumber || roomTypes[roomIndex]?.name || '', roomNumber: roomUnits[roomIndex]?.unitNumber || '',
        roomType: roomTypes[roomIndex]?.name || '', roomTypeId: roomTypes[roomIndex]?.id || '', roomUnitId: roomUnits[roomIndex]?.id || '',
      };
    }),
    bookingItems,
    ticketLegs,
    addons: addonPricing.addons,
    hotelStay: {
      checkIn,
      checkOut,
      nights,
      nightIds: selectedRows.map((night) => night.id),
      propertyId: property.id,
      ratePlanId: ratePlan?.id || '',
      roomCount,
      adults,
      children,
      infants,
      roomUnitIds: roomUnits.map((unit) => unit.id).filter(Boolean),
      roomTypeIds: roomTypes.map((type) => type.id).filter(Boolean),
      status: 'pending_payment',
      estimatedArrivalTime: clean(payload.estimatedArrivalTime || payload.arrivalTime).slice(0, 80),
      arrivalNotes: clean(payload.arrivalNotes).slice(0, 1200),
      departureNotes: clean(payload.departureNotes).slice(0, 1200),
      specialRequests: clean(payload.specialRequests || payload.notes || '').slice(0, 1200),
    },
    commercialTermsSnapshot: { model: 'percentage_commission', commissionPercent: split.partnerCommissionPercent, partnerPayoutPercent: split.partnerPayoutPercent, promoterSharePercent: split.promoterSharePercent, termsVersion: company?.commercialTerms?.termsVersion || getCachedPlatformConfig().commercialTermsVersion || 'commission-v1' },
    pricing: {
      roomSubtotal,
      occupancySurcharge,
      occupancyCharges: roomOccupancyCharges,
      taxableRoomTotal,
      propertyTax,
      propertyServiceFee,
      subtotal,
      fees,
      addonTotal: addonPricing.total,
      addons: addonPricing.addons,
      total,
      currency,
      split,
    },
    grossAmount: total,
    paymentStatus: 'pending',
    bookingStatus: 'pending_payment',
    bookingChannel: clean(payload.source || 'web').toLowerCase().replace(/-/g, '_'),
    settlementStatus: 'pending_payment',
    checkInStatus: 'not_checked',
    qrCodeValue: `CLASSIC-TRIP:${bookingRef}:${listing.id}:${Date.now()}`,
    createdAt,
  };

  const trustedCompanyManual = options.trustedManual === true && String(options.companyId || '') === String(listing.companyId || '');
  const trustedAgentOffline = options.trustedOffline === true && String(options.companyId || '') === String(listing.companyId || '') && clean(options.actorId);
  const requestedSource = clean(payload.source).toLowerCase().replace(/-/g, '_');
  const requestedManual = requestedSource === 'company_manual';
  const requestedOffline = requestedSource === 'agent_offline';
  if (requestedManual && !trustedCompanyManual) {
    const error = new Error('Manual hotel payment status can be set only from the verified partner dashboard');
    error.status = 403;
    error.code = 'untrusted_manual_payment';
    throw error;
  }
  if (requestedOffline && !trustedAgentOffline) {
    const error = new Error('Offline hotel cash sales may be created only by an approved promoter workflow');
    error.status = 403;
    error.code = 'untrusted_offline_hotel_sale';
    throw error;
  }
  let provider;
  let payment;
  if ((trustedCompanyManual && requestedManual) || (trustedAgentOffline && requestedOffline)) {
    const requested = clean(payload.paymentProvider || payload.provider || 'cash').toLowerCase().replace(/-/g, '_');
    provider = ['cash', 'bank_transfer', 'card', 'mobile_money'].includes(requested) ? requested : 'cash';
    const requestedStatus = clean(payload.paymentStatus || (requestedOffline ? 'successful' : 'pending')).toLowerCase();
    if (!['successful', 'pending'].includes(requestedStatus)) {
      const error = new Error('Manual hotel bookings may be recorded only as paid or pending');
      error.status = 422;
      throw error;
    }
    payment = {
      provider,
      providerReference: payload.paymentRef || `${requestedOffline ? 'OFFLINE' : 'MANUAL'}-${bookingRef}`,
      status: requestedStatus,
      paidAt: requestedStatus === 'successful' ? new Date().toISOString() : null,
      checkoutUrl: '',
    };
  } else {
    provider = paymentService.resolveProviderName(payload.provider || payload.paymentProvider);
    payment = await paymentService.initiatePayment({
      provider,
      bookingRef,
      amount: total,
      currency,
      customer: booking.guestSnapshot,
      callbackUrl: `${env.appUrl}/booking/payment/callback?bookingRef=${encodeURIComponent(bookingRef)}`,
      description: `Classic Trip hotel booking ${bookingRef}`,
    });
  }

  const providerStatus = clean(payment.status || 'pending').toLowerCase();
  if (providerStatus === 'failed') {
    const error = new Error(payment.message || payment.failureReason || 'Payment could not be started');
    error.status = 402;
    error.code = 'payment_failed';
    throw error;
  }
  booking.paymentStatus = providerStatus === 'successful' ? 'successful' : 'pending';
  booking.paymentProvider = payment.provider || provider;
  booking.paymentRef = payment.providerReference || '';
  booking.checkoutUrl = payment.checkoutUrl || '';
  applyHotelBookingLifecycle(booking, booking.paymentStatus);
  booking.settlementStatus = booking.paymentStatus === 'successful' ? 'pending_fulfillment' : 'pending_payment';

  const holdMinutes = Math.max(1, Math.min(180, Number(getCachedPlatformConfig().holdMinutes || 10)));
  const expiresAt = booking.paymentStatus === 'successful' ? null : new Date(Date.now() + holdMinutes * 60 * 1000);
  booking.lockedUntil = expiresAt ? expiresAt.toISOString() : null;
  const paymentRow = {
    id: await hotelRepository.nextId('payment'),
    bookingId: booking.id,
    bookingRef,
    companyId: booking.companyId,
    customerUserId: booking.customerUserId,
    amount: total,
    grossAmount: total,
    currency,
    status: booking.paymentStatus,
    provider: booking.paymentProvider,
    providerReference: booking.paymentRef,
    paymentRef: booking.paymentRef,
    checkoutUrl: booking.checkoutUrl,
    idempotencyKey: `hotel:${bookingRef}`,
    metadata: { listingId: listing.id, checkIn, checkOut, roomUnitIds: booking.hotelStay.roomUnitIds, addonIds: addonPricing.addons.map((row) => row.id) },
    createdAt,
    paidAt: booking.paymentStatus === 'successful' ? (payment.paidAt || createdAt) : null,
  };
  const paymentIntentRow = booking.paymentStatus === 'successful' ? null : {
    id: await hotelRepository.nextId('payment-intent'),
    intentRef: `hotel-intent-${bookingRef}`,
    bookingId: booking.id,
    bookingRef,
    companyId: booking.companyId,
    customerUserId: booking.customerUserId,
    provider: booking.paymentProvider,
    ...(booking.paymentRef ? { providerReference: booking.paymentRef } : {}),
    idempotencyKey: `hotel-intent:${bookingRef}`,
    amount: total,
    currency,
    status: ['created', 'pending', 'processing'].includes(providerStatus) ? providerStatus : 'pending',
    checkoutUrl: booking.checkoutUrl,
    expiresAt,
    metadata: { listingId: listing.id, serviceType: 'hotel', roomUnitIds: booking.hotelStay.roomUnitIds, nightIds: booking.hotelStay.nightIds },
    createdAt,
  };

  const canonical = await buildCanonicalHotelRecords({ booking, listing, property, roomTypes, roomUnits, groups, guests, ratePlan, payload });
  await hotelRepository.commitHotelBooking({ selectedRows, booking, paymentRow, paymentIntentRow, canonical });
  if (booking.paymentStatus === 'successful') {
    try {
      await hotelRepository.settleSuccessfulBooking({ booking, split });
    } catch (error) {
      booking.settlementStatus = 'reconciliation_required';
      booking.settlementError = clean(error.message || 'Settlement creation failed');
      await hotelRepository.bookings.save(booking);
    }
    await notificationService.bookingConfirmed(booking);
  } else {
    await notificationService.queueNotification({
      userId: booking.customerUserId || null,
      channels: ['email', 'sms'],
      title: `Payment pending ${bookingRef}`,
      message: `${bookingRef} is waiting for payment confirmation for ${checkIn} to ${checkOut}.`,
      recipient: { email: booking.guestSnapshot.email, phone: booking.guestSnapshot.phone, name: booking.guestSnapshot.fullName },
      referenceType: 'booking',
      referenceId: booking.id,
      meta: { bookingRef, checkoutUrl: booking.checkoutUrl, expiresAt: booking.lockedUntil },
    });
  }

  const actorId = req?.session?.user?.id || payload.createdByEmployeeId || payload.actorId || 'guest';
  await hotelRepository.audit({ actorId, action: 'hotel.booking.created', targetType: 'booking', targetId: bookingRef });
  const sourceActorType = requestedOffline ? 'promoter' : requestedManual ? 'company' : 'customer';
  await timelineService.recordEvent({ bookingRef, companyId: booking.companyId, customerUserId: booking.customerUserId, entityType: 'hotel_booking', entityId: bookingRef, action: 'hotel.booking.created', title: `Hotel booking ${bookingRef} created`, message: `Stay created for ${checkIn} to ${checkOut}.`, status: booking.bookingStatus, actorType: sourceActorType, actorId, metadata: { checkIn, checkOut, roomCount, roomTypeId, roomUnitIds: booking.hotelStay.roomUnitIds } });
  await timelineService.recordEvent({ bookingRef, companyId: booking.companyId, customerUserId: booking.customerUserId, entityType: 'room_night_inventory', entityId: booking.hotelStay.roomUnitIds.join(','), action: booking.paymentStatus === 'successful' ? 'hotel.inventory.booked' : 'hotel.inventory.reserved_for_payment', title: booking.paymentStatus === 'successful' ? `Room-night inventory booked for ${bookingRef}` : `Room-night inventory reserved for ${bookingRef}`, message: booking.paymentStatus === 'successful' ? `${selectedRows.length} room-night(s) were booked.` : `${selectedRows.length} room-night(s) are protected while payment is completed.`, status: booking.paymentStatus === 'successful' ? 'booked' : 'pending_payment', actorType: 'system', actorId, metadata: { nights, selectedRoomUnitIds, expiresAt: booking.lockedUntil } });
  await timelineService.recordEvent({ bookingRef, companyId: booking.companyId, customerUserId: booking.customerUserId, entityType: 'payment', entityId: paymentRow.id, action: booking.paymentStatus === 'successful' ? 'payment.succeeded' : 'payment.pending', title: booking.paymentStatus === 'successful' ? `Payment received for ${bookingRef}` : `Payment pending for ${bookingRef}`, message: booking.paymentStatus === 'successful' ? 'Hotel voucher and QR are valid for check-in.' : 'Hotel booking is waiting for payment confirmation.', status: booking.paymentStatus, actorType: 'system', actorId });
  if (booking.paymentStatus === 'successful') {
    await timelineService.recordEvent({ bookingRef, companyId: booking.companyId, customerUserId: booking.customerUserId, entityType: 'hotel_voucher', entityId: ticketLegs[0]?.id || bookingRef, action: 'hotel.voucher.issued', title: `Hotel voucher issued for ${bookingRef}`, message: `${ticketLegs.length} room voucher(s) were created.`, status: 'issued', actorType: 'system', actorId });
  }
  return booking;
}

async function roomMap(companyId, listingId, startDate, endDate) {
  const listing = await hotelRepository.listingOrThrow(companyId, listingId);
  const dates = startDate && endDate ? dateRange(startDate, endDate) : [];
  const units = await hotelRepository.roomUnits.list({ companyId, listingId: listing.id, status: { $ne: 'archived' } });
  const roomTypes = await hotelRepository.roomTypes.list({ id: { $in: units.map((unit) => unit.roomTypeId) } });
  const typesById = new Map(roomTypes.map((type) => [type.id, type]));
  const nightFilter = { roomUnitId: { $in: units.map((unit) => unit.id) } };
  if (dates.length) nightFilter.date = { $in: dates };
  const allNights = await hotelRepository.roomNightInventories.list(nightFilter, { sort: { date: 1 } });
  const byUnit = new Map();
  allNights.forEach((night) => {
    if (!byUnit.has(night.roomUnitId)) byUnit.set(night.roomUnitId, []);
    byUnit.get(night.roomUnitId).push(night);
  });
  return units.map((unit) => {
    const roomType = typesById.get(unit.roomTypeId) || {};
    const nights = byUnit.get(unit.id) || [];
    const activeNight = nights.find((night) => ['booked', 'occupied', 'checked_in', 'held', 'maintenance', 'cleaning', 'reserved'].includes(night.status)) || nights[0];
    return [roomType.name || 'Room', unit.unitNumber, nights.map((night) => `${night.date}:${night.status}`).join(' | ') || unit.status, activeNight?.bookingRef || '-', activeNight?.guestName || '-', activeNight?.status || unit.status, { entity: 'room_night', id: activeNight?.id || unit.id, label: unit.unitNumber, status: activeNight?.status || unit.status }];
  });
}

async function manifestRecords(companyId, listingId = '', mode = 'arrivals', dateValue = '') {
  const targetDate = dateValue ? isoDate(dateValue) : new Date().toISOString().slice(0, 10);
  const normalizedMode = clean(mode || 'arrivals').toLowerCase().replace(/_/g, '-');
  const rawListingId = clean(listingId);
  const requestedListingId = rawListingId.toLowerCase() === 'all' ? '' : rawListingId;
  const listings = requestedListingId
    ? [await hotelRepository.listingOrThrow(companyId, requestedListingId)]
    : await hotelRepository.listings.list({ companyId, serviceType: 'hotel', status: { $ne: 'archived' } }, { sort: { title: 1 } });
  if (!listings.length) return [];

  const listingIds = listings.map((row) => row.id);
  const listingById = new Map(listings.map((row) => [row.id, row]));
  const reservationFilter = { companyId, ...(requestedListingId ? { listingId: requestedListingId } : { listingId: { $in: listingIds } }) };
  const reservations = await hotelRepository.hotelReservations.list(reservationFilter);
  const reservationIds = reservations.map((row) => row.id);
  const [guests, assignments, properties, roomTypes, roomUnits] = await Promise.all([
    reservationIds.length ? hotelRepository.hotelGuests.list({ companyId, reservationId: { $in: reservationIds } }) : [],
    reservationIds.length ? hotelRepository.roomAssignments.list({ companyId, reservationId: { $in: reservationIds } }) : [],
    hotelRepository.hotelProperties.list({ companyId, listingId: { $in: listingIds } }),
    hotelRepository.roomTypes.list({ companyId, listingId: { $in: listingIds } }),
    hotelRepository.roomUnits.list({ companyId, listingId: { $in: listingIds } }),
  ]);

  const guestsByReservation = new Map();
  guests.forEach((guest) => {
    if (!guestsByReservation.has(guest.reservationId)) guestsByReservation.set(guest.reservationId, []);
    guestsByReservation.get(guest.reservationId).push(guest);
  });
  guestsByReservation.forEach((rows) => rows.sort((a, b) => Number(Boolean(b.isLeadGuest)) - Number(Boolean(a.isLeadGuest)) || Number(a.guestIndex || 0) - Number(b.guestIndex || 0)));
  const assignmentsByReservation = new Map();
  assignments.forEach((row) => {
    if (!assignmentsByReservation.has(row.reservationId)) assignmentsByReservation.set(row.reservationId, []);
    assignmentsByReservation.get(row.reservationId).push(row);
  });
  const propertyById = new Map(properties.map((row) => [row.id, row]));
  const roomTypeById = new Map(roomTypes.map((row) => [row.id, row]));
  const roomUnitById = new Map(roomUnits.map((row) => [row.id, row]));

  function included(row) {
    const status = normalizeLifecycleStatus(row.status || row.bookingStatus);
    if (['cancelled', 'refunded', 'expired', 'failed', 'voided'].includes(status)) return normalizedMode === 'history';
    if (normalizedMode === 'arrivals') return row.checkInDate === targetDate && ['awaiting_payment', 'confirmed', 'checked_in'].includes(status);
    if (normalizedMode === 'departures') return row.checkOutDate === targetDate && ['checked_in', 'checked_out', 'completed'].includes(status);
    if (normalizedMode === 'in-house') return row.checkInDate <= targetDate && row.checkOutDate > targetDate && status === 'checked_in';
    if (normalizedMode === 'history') return true;
    return true;
  }

  const canonicalRows = reservations.filter(included).map((reservation) => {
    const reservationGuests = guestsByReservation.get(reservation.id) || [];
    const guest = reservationGuests[0] || {};
    const assigned = assignmentsByReservation.get(reservation.id) || [];
    const listing = listingById.get(reservation.listingId) || {};
    const property = propertyById.get(reservation.propertyId) || {};
    const roomTypeNames = [...new Set(assigned.map((row) => roomTypeById.get(row.roomTypeId)?.name || row.roomTypeSnapshot).filter(Boolean))];
    const roomNumbers = assigned.map((row) => roomUnitById.get(row.roomUnitId)?.unitNumber || row.roomNumberSnapshot).filter(Boolean);
    const maskedIdentity = guest.identityNumber ? `${guest.identityType || 'ID'} ••••${String(guest.identityNumber).slice(-4)}` : '';
    const guestNames = reservationGuests.map((row) => row.fullName).filter(Boolean);
    const guestLabel = guestNames.length > 1 ? `${guestNames[0]} +${guestNames.length - 1}` : (guestNames[0] || '-');
    return {
      bookingRef: reservation.bookingRef,
      reservationId: reservation.id,
      listingId: reservation.listingId,
      listingTitle: listing.title || property.propertyName || 'Hotel',
      guestName: guestLabel,
      guestNames,
      guestCount: reservationGuests.length,
      phone: guest.phone || '',
      email: guest.email || '',
      identity: maskedIdentity,
      nationality: guest.nationality || '',
      emergencyContact: [guest.emergencyContactName, guest.emergencyContactPhone].filter(Boolean).join(' · '),
      property: property.propertyName || listing.title || '-',
      roomType: roomTypeNames.join(', ') || '-',
      roomNumbers: roomNumbers.join(', ') || 'Assignment pending',
      occupancy: `${reservation.adults || 1}A / ${reservation.children || 0}C${reservation.infants ? ` / ${reservation.infants}I` : ''}`,
      checkIn: reservation.checkInDate,
      checkOut: reservation.checkOutDate,
      estimatedArrivalTime: reservation.estimatedArrivalTime || '',
      actualCheckIn: reservation.actualCheckInAt || '',
      actualCheckOut: reservation.actualCheckOutAt || '',
      paymentStatus: reservation.paymentStatus,
      settlementStatus: reservation.settlementStatus,
      status: reservation.status,
      specialRequests: [reservation.specialRequests, reservation.arrivalNotes].filter(Boolean).join(' · '),
      action: { entity: 'hotel_reservation', id: reservation.bookingRef, label: reservation.bookingRef, status: reservation.status },
    };
  });

  // Compatibility is read-only: legacy bookings remain visible until the hotel
  // normalization migration creates their canonical reservation records.
  const canonicalRefs = new Set(reservations.map((row) => String(row.bookingRef)));
  const legacyBookings = await hotelRepository.bookings.list({
    companyId,
    serviceType: 'hotel',
    ...(requestedListingId ? { listingId: requestedListingId } : { listingId: { $in: listingIds } }),
  });
  const legacyRows = legacyBookings.filter((booking) => !canonicalRefs.has(String(booking.bookingRef))).map((booking) => {
    const legacyGuests = Array.isArray(booking.passengers) ? booking.passengers : [];
    const lead = legacyGuests[0] || {};
    const identityNumber = clean(lead.identityNumber || booking.guestSnapshot?.identityNumber);
    return {
      bookingRef: booking.bookingRef,
      reservationId: '',
      listingId: booking.listingId,
      listingTitle: listingById.get(booking.listingId)?.title || 'Hotel',
      guestName: booking.guestSnapshot?.fullName || lead.fullName || lead.name || '-',
      guestNames: legacyGuests.map((row) => row.fullName || row.name).filter(Boolean),
      guestCount: Math.max(1, Number(legacyGuests.length || booking.hotelStay?.adults || 1)),
      phone: booking.guestSnapshot?.phone || lead.phone || '',
      email: booking.guestSnapshot?.email || lead.email || '',
      identity: identityNumber ? `${lead.identityType || booking.guestSnapshot?.identityType || 'ID'} ••••${identityNumber.slice(-4)}` : '',
      nationality: lead.nationality || booking.guestSnapshot?.nationality || '',
      emergencyContact: [lead.emergencyContactName, lead.emergencyContactPhone].filter(Boolean).join(' · '),
      property: listingById.get(booking.listingId)?.title || '-',
      roomType: legacyGuests.map((row) => row.roomType).filter(Boolean).join(', ') || '-',
      roomNumbers: legacyGuests.map((row) => row.roomNumber || row.seatOrRoom).filter(Boolean).join(', ') || 'Assignment pending',
      occupancy: `${booking.hotelStay?.adults || 1}A / ${booking.hotelStay?.children || 0}C${booking.hotelStay?.infants ? ` / ${booking.hotelStay.infants}I` : ''}`,
      checkIn: booking.hotelStay?.checkIn || '',
      checkOut: booking.hotelStay?.checkOut || '',
      estimatedArrivalTime: booking.hotelStay?.estimatedArrivalTime || '',
      actualCheckIn: booking.checkedInAt || '',
      actualCheckOut: booking.checkOutAt || booking.completedAt || '',
      paymentStatus: booking.paymentStatus,
      settlementStatus: booking.settlementStatus,
      status: normalizeLifecycleStatus(booking.hotelStay?.status || booking.bookingStatus),
      specialRequests: [booking.hotelStay?.specialRequests, booking.hotelStay?.arrivalNotes].filter(Boolean).join(' · '),
      action: { entity: 'hotel_booking', id: booking.bookingRef, label: booking.bookingRef, status: booking.hotelStay?.status || booking.bookingStatus },
    };
  }).filter((row) => included({ ...row, checkInDate: row.checkIn, checkOutDate: row.checkOut }));

  return [...canonicalRows, ...legacyRows].sort((a, b) => String(a.checkIn || '').localeCompare(String(b.checkIn || '')) || String(a.property || '').localeCompare(String(b.property || '')) || String(a.bookingRef || '').localeCompare(String(b.bookingRef || '')));
}

async function manifestRows(companyId, listingId = '', mode = 'arrivals', dateValue = '') {
  const records = await manifestRecords(companyId, listingId, mode, dateValue);
  return records.map((row) => [row.bookingRef, row.guestName, row.phone || row.email || '-', row.identity || '-', row.property, row.roomType, row.roomNumbers, row.occupancy, row.checkIn, row.checkOut, row.paymentStatus, row.status, row.action]);
}

async function markStay(companyId, bookingRef, status, actorId = 'company-admin', options = {}) {
  const booking = await hotelRepository.bookingOrThrow(companyId, bookingRef);
  const normalized = normalizeLifecycleStatus(status);
  if (!['checked_in', 'checked_out'].includes(normalized)) {
    const error = new Error('Hotel stays may only be checked in or checked out from this action');
    error.status = 422;
    throw error;
  }

  const currentStayStatus = normalizeLifecycleStatus(booking.hotelStay?.status || booking.bookingStatus);
  if (normalized === 'checked_in' && ['checked_in', 'occupied', 'in_house'].includes(currentStayStatus)) return booking;
  if (normalized === 'checked_out' && ['checked_out', 'completed'].includes(currentStayStatus)) return booking;
  if (clean(booking.paymentStatus).toLowerCase() !== 'successful') {
    const error = new Error('Payment must be confirmed before a hotel guest can check in or check out');
    error.status = 409;
    error.code = 'hotel_payment_not_confirmed';
    throw error;
  }
  if (['cancelled', 'refunded', 'voided', 'failed', 'expired', 'no_show'].includes(normalizeLifecycleStatus(booking.bookingStatus))) {
    const error = new Error('This hotel booking is no longer valid for check-in or check-out');
    error.status = 409;
    error.code = 'hotel_booking_inactive';
    throw error;
  }
  if (normalized === 'checked_in' && !['confirmed', 'booked'].includes(normalizeLifecycleStatus(booking.bookingStatus))) {
    const error = new Error('Only a confirmed hotel booking can be checked in');
    error.status = 409;
    error.code = 'hotel_checkin_not_allowed';
    throw error;
  }
  if (normalized === 'checked_out' && !['checked_in', 'occupied', 'in_house'].includes(currentStayStatus)) {
    const error = new Error('Check the guest in before checking the stay out');
    error.status = 409;
    error.code = 'hotel_checkout_not_allowed';
    throw error;
  }
  const property = booking.hotelStay?.propertyId ? await hotelRepository.hotelProperties.findOne({ id: booking.hotelStay.propertyId, companyId }) : null;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: property?.timezone || 'Africa/Kampala' });
  const expectedDate = normalized === 'checked_in' ? booking.hotelStay?.checkIn : booking.hotelStay?.checkOut;
  if (expectedDate && expectedDate !== today && !clean(options.overrideReason)) {
    const error = new Error(`${normalized === 'checked_in' ? 'Check-in' : 'Check-out'} is scheduled for ${expectedDate}. Provide an override reason for an early or late transition.`);
    error.status = 409; error.code = 'hotel_stay_date_override_required'; throw error;
  }

  const affectedNights = await hotelRepository.roomNightInventories.list({ bookingRef, companyId });
  if (!affectedNights.length) {
    const error = new Error('This booking has no room-night inventory and cannot change stay status');
    error.status = 409;
    error.code = 'hotel_inventory_missing';
    throw error;
  }
  const allowedNightStatuses = normalized === 'checked_in'
    ? new Set(['booked', 'checked_in', 'occupied'])
    : new Set(['occupied', 'checked_in']);
  if (!affectedNights.every((night) => allowedNightStatuses.has(normalizeLifecycleStatus(night.status)))) {
    const error = new Error(normalized === 'checked_in'
      ? 'All room nights must be paid and booked before check-in'
      : 'All room nights must be occupied before check-out');
    error.status = 409;
    error.code = 'hotel_inventory_transition_not_allowed';
    throw error;
  }

  const now = new Date().toISOString();
  const unitIds = Array.from(new Set(affectedNights.map((night) => night.roomUnitId).filter(Boolean)));
  const transitionedBooking = await hotelRepository.commitStayTransition({
    companyId,
    bookingRef,
    normalized,
    actorId,
    now,
    unitIds,
  });

  await timelineService.recordEvent({
    bookingRef,
    companyId: transitionedBooking.companyId,
    customerUserId: transitionedBooking.customerUserId,
    entityType: 'hotel_stay',
    entityId: bookingRef,
    action: `hotel.stay.${normalized}`,
    title: normalized === 'checked_in' ? `Guest checked in for ${bookingRef}` : `Guest checked out for ${bookingRef}`,
    message: normalized === 'checked_in'
      ? 'Payment and room-night inventory were verified before the guest was checked in.'
      : 'The occupied stay was checked out and rooms were moved to housekeeping.',
    status: normalized,
    actorType: 'company',
    actorId,
    metadata: {
      roomUnitIds: unitIds,
      checkIn: transitionedBooking.hotelStay?.checkIn,
      checkOut: transitionedBooking.hotelStay?.checkOut,
      paymentStatus: transitionedBooking.paymentStatus,
    },
  });

  let releasedCommissions = [];
  if (normalized === 'checked_out') {
    releasedCommissions = (await releaseService.releaseCompletedBooking(bookingRef)) || [];
    transitionedBooking.earningsReleasedAt = transitionedBooking.earningsReleasedAt || (releasedCommissions.length ? now : null);
    // Fulfillment releases pending earnings into an eligible wallet balance. A
    // booking is only "settled" after it is included in a completed provider payout.
    transitionedBooking.settlementStatus = 'eligible';
    await hotelRepository.bookings.save(transitionedBooking, { bookingRef, companyId });
    await timelineService.recordEvent({
      bookingRef,
      companyId: transitionedBooking.companyId,
      customerUserId: transitionedBooking.customerUserId,
      entityType: 'settlement',
      entityId: bookingRef,
      action: 'hotel.settlement.eligible',
      title: `Hotel stay settlement updated for ${bookingRef}`,
      message: releasedCommissions.length
        ? 'Stay completion released eligible company and promoter earnings.'
        : 'Stay completion marked this paid booking settlement-eligible.',
      status: transitionedBooking.settlementStatus,
      actorType: 'system',
      actorId,
      metadata: { releasedCommissions: releasedCommissions.length },
    });
  }

  await hotelRepository.audit({
    actorId,
    action: `hotel.stay.${normalized}`,
    targetType: 'booking',
    targetId: bookingRef,
    meta: { affectedNights: affectedNights.length, paymentStatus: transitionedBooking.paymentStatus, overrideReason: clean(options.overrideReason) },
  });
  return transitionedBooking;
}

async function markNoShow(companyId, bookingRef, actorId = 'company-admin', options = {}) {
  const booking = await hotelRepository.bookingOrThrow(companyId, bookingRef);
  const status = normalizeLifecycleStatus(booking.hotelStay?.status || booking.bookingStatus);
  if (['no_show', 'cancelled', 'refunded', 'failed', 'expired'].includes(status)) return booking;
  if (['checked_in', 'occupied', 'in_house', 'checked_out', 'completed'].includes(status) || booking.checkedInAt) {
    const error = new Error('A checked-in or completed hotel stay cannot be marked no-show');
    error.status = 409;
    error.code = 'hotel_no_show_after_checkin';
    throw error;
  }
  if (clean(booking.paymentStatus).toLowerCase() !== 'successful') {
    const error = new Error('Only a paid, confirmed hotel arrival can be marked no-show');
    error.status = 409;
    error.code = 'hotel_no_show_payment_required';
    throw error;
  }
  const property = booking.hotelStay?.propertyId
    ? await hotelRepository.hotelProperties.findOne({ id: booking.hotelStay.propertyId, companyId })
    : null;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: property?.timezone || 'Africa/Kampala' });
  const scheduledCheckIn = clean(booking.hotelStay?.checkIn);
  const overrideReason = clean(options.overrideReason || options.reason);
  if (scheduledCheckIn && scheduledCheckIn > today && !overrideReason) {
    const error = new Error(`This arrival is scheduled for ${scheduledCheckIn}. Provide an override reason to mark it no-show early.`);
    error.status = 409;
    error.code = 'hotel_no_show_date_override_required';
    throw error;
  }
  const reason = clean(options.reason || options.note || overrideReason || 'Guest did not arrive', 'Guest did not arrive').slice(0, 1000);
  const result = await hotelRepository.commitNoShow({ companyId, bookingRef, actorId, reason, now: new Date().toISOString() });
  const transitionedBooking = result.booking;
  await timelineService.recordEvent({
    bookingRef,
    companyId,
    customerUserId: transitionedBooking.customerUserId,
    entityType: 'hotel_stay',
    entityId: bookingRef,
    action: 'hotel.stay.no_show',
    title: `Hotel no-show recorded for ${bookingRef}`,
    message: `The guest did not check in. ${result.inventoryReleased} room-night record(s) were released and the payment was sent for policy reconciliation.`,
    status: 'no_show',
    actorType: 'company',
    actorId,
    metadata: { reason, inventoryReleased: result.inventoryReleased, scheduledCheckIn, overrideReason },
  });
  await hotelRepository.audit({
    actorId,
    action: 'hotel.stay.no_show',
    targetType: 'booking',
    targetId: bookingRef,
    companyId,
    meta: { reason, inventoryReleased: result.inventoryReleased, scheduledCheckIn, overrideReason },
  });
  await notificationService.queueNotification({
    userId: transitionedBooking.customerUserId || null,
    channels: ['in_app', 'push', 'email'],
    title: `Hotel no-show recorded ${bookingRef}`,
    message: `Booking ${bookingRef} was marked no-show. Any refund or cancellation charge will be reviewed under the booked rate policy.`,
    recipient: {
      name: transitionedBooking.guestSnapshot?.fullName || '',
      email: transitionedBooking.guestSnapshot?.email || '',
      phone: transitionedBooking.guestSnapshot?.phone || '',
    },
    referenceType: 'booking',
    referenceId: transitionedBooking.id,
    meta: { bookingRef, companyId, status: 'no_show' },
  });
  return transitionedBooking;
}

async function operationalVoucher(companyId, bookingRef) {
  const booking = await hotelRepository.bookingOrThrow(companyId, bookingRef);
  const reservation = await hotelRepository.hotelReservations.findOne({ companyId, bookingRef });
  if (!reservation) {
    const error = new Error('This hotel booking has no canonical reservation. Run the hotel-domain migration before opening the operational voucher.');
    error.status = 409;
    error.code = 'hotel_reservation_missing';
    throw error;
  }
  const [guests, assignments, listing, property, timeline] = await Promise.all([
    hotelRepository.hotelGuests.list({ companyId, reservationId: reservation.id }, { sort: { roomIndex: 1, guestIndex: 1 } }),
    hotelRepository.roomAssignments.list({ companyId, reservationId: reservation.id }, { sort: { roomNumberSnapshot: 1 } }),
    hotelRepository.listings.findOne({ companyId, id: reservation.listingId, serviceType: 'hotel' }),
    hotelRepository.hotelProperties.findOne({ companyId, id: reservation.propertyId }),
    timelineService.bookingTimeline(bookingRef, { includeInternal: true }),
  ]);
  const roomTypeIds = [...new Set(assignments.map((row) => row.roomTypeId).filter(Boolean))];
  const roomUnitIds = [...new Set(assignments.map((row) => row.roomUnitId).filter(Boolean))];
  const ratePlanIds = [...new Set(assignments.map((row) => row.ratePlanId).filter(Boolean))];
  const [roomTypes, roomUnits, ratePlans] = await Promise.all([
    roomTypeIds.length ? hotelRepository.roomTypes.list({ companyId, id: { $in: roomTypeIds } }) : [],
    roomUnitIds.length ? hotelRepository.roomUnits.list({ companyId, id: { $in: roomUnitIds } }) : [],
    ratePlanIds.length ? hotelRepository.ratePlans.list({ companyId, id: { $in: ratePlanIds } }) : [],
  ]);
  const roomTypeById = new Map(roomTypes.map((row) => [String(row.id), row]));
  const roomUnitById = new Map(roomUnits.map((row) => [String(row.id), row]));
  const ratePlanById = new Map(ratePlans.map((row) => [String(row.id), row]));
  const normalizedAssignments = assignments.map((assignment) => ({
    ...assignment,
    roomType: roomTypeById.get(String(assignment.roomTypeId)) || null,
    roomUnit: roomUnitById.get(String(assignment.roomUnitId)) || null,
    ratePlan: ratePlanById.get(String(assignment.ratePlanId)) || null,
    guests: guests.filter((guest) => String(guest.roomAssignmentId || '') === String(assignment.id) || Number(guest.roomIndex) === Number(assignments.indexOf(assignment))),
  }));
  const ticketReady = clean(booking.paymentStatus).toLowerCase() === 'successful'
    && !['cancelled', 'refunded', 'failed', 'expired'].includes(normalizeLifecycleStatus(booking.bookingStatus));
  return { booking, reservation, guests, assignments: normalizedAssignments, listing: listing || {}, property: property || {}, timeline, ticketReady };
}

async function updateHousekeeping(companyId, unitId, payload = {}, actorId = 'company-admin') {
  const unit = await hotelRepository.roomUnitOrThrow(companyId, unitId);
  const status = enumValue(payload.housekeepingStatus, HOUSEKEEPING_STATUSES, unit.housekeepingStatus || 'clean', 'housekeeping status');
  const rawTaskStatus = enumValue(payload.taskStatus, HOUSEKEEPING_TASK_STATUSES, unit.housekeepingTaskStatus || (['clean', 'inspected', 'ready'].includes(status) ? 'completed' : 'open'), 'housekeeping task status');
  const taskStatus = rawTaskStatus === 'closed' ? 'completed' : (rawTaskStatus || 'open');
  const now = new Date().toISOString();
  const today = new Date().toISOString().slice(0, 10);
  const targetDate = payload.targetDate ? isoDate(payload.targetDate) : today;
  const requestedTaskId = clean(payload.taskId);
  const requestedInventoryId = clean(payload.inventoryId);
  const terminalCleanState = ['clean', 'inspected', 'ready'].includes(status);

  return hotelRepository.transaction(async (session) => {
    let task = requestedTaskId
      ? await hotelRepository.housekeepingTasks.findOne({ id: requestedTaskId, companyId, roomUnitId: unit.id }, { session })
      : await hotelRepository.housekeepingTasks.findOne({ companyId, roomUnitId: unit.id, status: { $in: ['open', 'in_progress', 'blocked'] } }, { sort: { createdAt: 1 }, session });
    const taskTargetDate = task?.targetDate || targetDate;
    const taskNightIds = [...new Set([
      ...(Array.isArray(task?.nightIds) ? task.nightIds : []),
      ...(requestedInventoryId ? [requestedInventoryId] : []),
    ].map((id) => clean(id)).filter(Boolean))];

    let affectedNights = [];
    if (status === 'maintenance') {
      const startDate = payload.startDate ? isoDate(payload.startDate) : taskTargetDate;
      const endDate = payload.endDate ? isoDate(payload.endDate) : new Date(new Date(`${startDate}T00:00:00.000Z`).getTime() + 86400000).toISOString().slice(0, 10);
      if (endDate <= startDate) throw Object.assign(new Error('Maintenance end date must be after the start date'), { status: 422 });
      const committed = await hotelRepository.roomNightInventories.count({ companyId, roomUnitId: unit.id, date: { $gte: startDate, $lt: endDate }, status: { $in: ['held', 'reserved', 'booked', 'occupied', 'checked_in'] } }, { session });
      if (committed) throw Object.assign(new Error('Move or cancel affected reservations before placing this room into maintenance'), { status: 409 });
      const existingBlock = await hotelRepository.maintenanceBlocks.findOne({ companyId, roomUnitId: unit.id, status: 'active', startDate: { $lte: startDate }, endDate: { $gte: endDate } }, { session });
      if (!existingBlock) {
        await hotelRepository.maintenanceBlocks.insert({
          id: await hotelRepository.nextId('maintenance-block'), companyId, listingId: unit.listingId, propertyId: unit.propertyId,
          roomUnitId: unit.id, startDate, endDate, reason: clean(payload.notes || 'Maintenance'), status: 'active', createdBy: actorId, createdAt: now,
        }, { session });
      }
      affectedNights = await hotelRepository.roomNightInventories.list({ companyId, roomUnitId: unit.id, date: { $gte: startDate, $lt: endDate }, status: { $in: ['available', 'open', 'cleaning', 'checked_out', 'maintenance'] } }, { session });
      affectedNights.forEach((night) => Object.assign(night, { status: 'maintenance', availableInventory: 0, housekeepingStatus: 'maintenance', updatedBy: actorId, updatedAt: now }));
      unit.status = 'maintenance';
    } else {
      const nightFilter = taskNightIds.length
        ? { companyId, roomUnitId: unit.id, id: { $in: taskNightIds } }
        : { companyId, roomUnitId: unit.id, date: taskTargetDate, status: { $in: ['cleaning', 'checked_out', 'maintenance'] } };
      affectedNights = await hotelRepository.roomNightInventories.list(nightFilter, { session });

      if (terminalCleanState) {
        const activeBlocks = await hotelRepository.maintenanceBlocks.list({ companyId, roomUnitId: unit.id, status: 'active', startDate: { $lte: taskTargetDate }, endDate: { $gt: taskTargetDate } }, { session });
        for (const block of activeBlocks) {
          Object.assign(block, { status: 'completed', completedBy: actorId, completedAt: now });
          await hotelRepository.maintenanceBlocks.save(block, { id: block.id }, { session });
        }
        affectedNights.filter((night) => ['cleaning', 'checked_out', 'maintenance'].includes(clean(night.status))).forEach((night) => {
          Object.assign(night, {
            status: 'available', availableInventory: 1, housekeepingStatus: status,
            bookingRef: '', reservationId: '', assignmentId: '', guestName: '', checkInStatus: '', updatedBy: actorId, updatedAt: now,
          });
          delete night.holdId;
        });
        const currentOperationalNight = await hotelRepository.roomNightInventories.findOne({
          companyId, roomUnitId: unit.id, date: today, status: { $in: ['booked', 'reserved', 'occupied', 'checked_in', 'maintenance'] },
        }, { session });
        unit.status = currentOperationalNight
          ? (['occupied', 'checked_in'].includes(clean(currentOperationalNight.status)) ? 'occupied' : clean(currentOperationalNight.status))
          : 'available';
      } else if (['cleaning', 'dirty'].includes(status)) {
        affectedNights.filter((night) => ['cleaning', 'checked_out'].includes(clean(night.status))).forEach((night) => {
          Object.assign(night, { status: 'cleaning', availableInventory: 0, housekeepingStatus: status, updatedBy: actorId, updatedAt: now });
        });
        unit.status = 'cleaning';
      }
    }

    Object.assign(unit, {
      housekeepingStatus: status,
      housekeepingTaskStatus: terminalCleanState ? 'closed' : (taskStatus === 'completed' ? 'closed' : taskStatus),
      housekeepingPriority: clean(payload.priority || unit.housekeepingPriority || 'normal'),
      housekeepingAssignedTo: clean(payload.assignedTo || unit.housekeepingAssignedTo || ''),
      housekeepingDueAt: payload.dueAt || unit.housekeepingDueAt || null,
      notes: clean(payload.notes || unit.notes || ''),
      updatedBy: actorId,
      updatedAt: now,
    });
    await hotelRepository.roomUnits.save(unit, { id: unit.id }, { session });
    if (affectedNights.length) await hotelRepository.roomNightInventories.saveMany(affectedNights, (row) => ({ id: row.id }), { session });

    if (!task) {
      task = {
        id: await hotelRepository.nextId('housekeeping-task'), companyId, listingId: unit.listingId, propertyId: unit.propertyId,
        roomUnitId: unit.id, taskType: status === 'maintenance' ? 'maintenance_followup' : 'manual', createdBy: actorId, createdAt: now,
      };
    }
    Object.assign(task, {
      targetDate: taskTargetDate,
      nightIds: [...new Set([...(task.nightIds || []), ...affectedNights.map((night) => night.id)])],
      status: terminalCleanState ? 'completed' : taskStatus,
      priority: unit.housekeepingPriority || 'normal', assignedTo: unit.housekeepingAssignedTo || '', dueAt: unit.housekeepingDueAt || null,
      notes: unit.notes || '', startedAt: taskStatus === 'in_progress' ? (task.startedAt || now) : task.startedAt,
      completedAt: terminalCleanState || taskStatus === 'completed' ? now : null, updatedBy: actorId, updatedAt: now,
    });
    await hotelRepository.housekeepingTasks.save(task, { id: task.id }, { session });

    await hotelRepository.audit({
      actorId, action: 'hotel.housekeeping.updated', targetType: 'roomUnit', targetId: unit.id,
      meta: { housekeepingStatus: unit.housekeepingStatus, roomStatus: unit.status, taskStatus: task.status, taskId: task.id, targetDate: task.targetDate, affectedNightIds: task.nightIds || [] },
    });
    return unit;
  });
}


async function roomTypeSummary(roomType) {
  const units = await hotelRepository.roomUnits.list({ roomTypeId: roomType.id, status: { $ne: 'archived' } });
  const availableUnits = units.filter((unit) => clean(unit.status).toLowerCase() === 'available' && ['clean', 'inspected', 'ready'].includes(clean(unit.housekeepingStatus).toLowerCase())).length;
  return { ...roomType, roomType: roomType.name, nightlyPrice: roomType.basePrice, inventory: units.length, availableUnits };
}

async function setRoomTypeInventory(companyId, roomTypeId, payload = {}, actorId = 'company-admin') {
  const roomType = await updateRoomType(companyId, roomTypeId, {
    name: payload.name || payload.roomType,
    basePrice: payload.basePrice ?? payload.nightlyPrice,
    capacity: payload.capacity,
    amenities: payload.amenities,
    status: payload.status,
  }, actorId);
  if (typeof payload.inventory !== 'undefined') {
    const desired = Math.max(0, Math.round(num(payload.inventory, 0)));
    const active = await hotelRepository.roomUnits.list({ roomTypeId: roomType.id, companyId, status: { $ne: 'archived' } }, { sort: { createdAt: 1 } });
    if (active.length < desired) {
      const all = await hotelRepository.roomUnits.list({ roomTypeId: roomType.id, companyId });
      const existingNumbers = new Set(all.map((row) => clean(row.unitNumber).toLowerCase()));
      const names = [];
      let sequence = all.length + 1;
      while (names.length < desired - active.length) {
        const candidate = `${clean(roomType.name).replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || 'ROOM'}-${String(sequence++).padStart(3, '0')}`;
        if (!existingNumbers.has(candidate.toLowerCase())) { existingNumbers.add(candidate.toLowerCase()); names.push(candidate); }
      }
      await createRoomUnits(companyId, { roomTypeId: roomType.id, unitNumbers: names }, actorId);
    } else if (active.length > desired) {
      const toArchive = active.slice(desired);
      for (const unit of toArchive) await archiveRoomUnit(companyId, unit.id, actorId);
    }
  }
  return roomTypeSummary(roomType);
}


async function hotelListingReadiness(companyId, listingId) {
  const [company, listing] = await Promise.all([
    hotelRepository.companyOrThrow(companyId),
    hotelRepository.listingOrThrow(companyId, listingId),
  ]);
  const failures = [];
  const warnings = [];
  if (clean(listing.serviceType).toLowerCase() !== 'hotel') failures.push('listing_is_not_hotel');
  if (clean(company.status).toLowerCase() !== 'active' || clean(company.verificationStatus).toLowerCase() !== 'verified' || company.settings?.canPublish === false) failures.push('company_not_active_and_verified');
  if (!clean(listing.title)) failures.push('listing_title_missing');
  if (!clean(listing.sub)) failures.push('listing_description_missing');
  if (!/^[A-Z]{3}$/.test(clean(listing.currency).toUpperCase())) failures.push('listing_currency_invalid');
  const media = Array.isArray(listing.media) ? listing.media : [];
  if (!media.some((asset) => clean(asset?.secureUrl || asset?.url))) failures.push('listing_media_missing');

  const properties = await hotelRepository.hotelProperties.list({ companyId, listingId: listing.id, status: 'active' });
  if (properties.length !== 1) failures.push(properties.length ? 'multiple_active_properties_for_listing' : 'active_property_missing');
  const property = properties[0] || null;
  if (property) {
    if (!clean(property.address) || !clean(property.city) || !clean(property.country)) failures.push('property_location_incomplete');
    if (!clean(property.timezone) || !clean(property.checkInTime) || !clean(property.checkOutTime)) failures.push('property_operating_times_incomplete');
    if (!clean(property.contactEmail) && !clean(property.contactPhone)) failures.push('property_contact_missing');
  }

  const roomTypes = property ? await hotelRepository.roomTypes.list({ companyId, listingId: listing.id, propertyId: property.id, status: 'active' }) : [];
  if (!roomTypes.length) failures.push('active_room_type_missing');
  const roomTypeIds = roomTypes.map((row) => row.id);
  const [ratePlans, roomUnits, futureInventory] = roomTypeIds.length ? await Promise.all([
    hotelRepository.ratePlans.list({ companyId, listingId: listing.id, roomTypeId: { $in: roomTypeIds }, status: 'active' }),
    hotelRepository.roomUnits.list({ companyId, listingId: listing.id, roomTypeId: { $in: roomTypeIds }, status: { $nin: ['archived'] } }),
    hotelRepository.roomNightInventories.list({ companyId, listingId: listing.id, roomTypeId: { $in: roomTypeIds }, date: { $gte: todayIsoUtc() }, status: { $nin: ['cancelled', 'maintenance'] } }, { limit: 5000 }),
  ]) : [[], [], []];

  roomTypes.forEach((roomType) => {
    const prefix = clean(roomType.name || roomType.id).replace(/\s+/g, '_').toLowerCase();
    if (!(Number(roomType.capacity) >= 1) || !(Number(roomType.maxAdults) >= 1) || !(Number(roomType.basePrice) >= 0)) failures.push(`room_type_${prefix}_occupancy_or_price_invalid`);
    const plans = ratePlans.filter((row) => String(row.roomTypeId) === String(roomType.id));
    if (!plans.length) failures.push(`room_type_${prefix}_rate_plan_missing`);
    if (plans.some((plan) => clean(plan.paymentTiming || 'pay_now').toLowerCase() !== 'pay_now')) failures.push(`room_type_${prefix}_unsupported_payment_timing`);
    const units = roomUnits.filter((row) => String(row.roomTypeId) === String(roomType.id) && !['archived'].includes(clean(row.status).toLowerCase()));
    if (!units.length) failures.push(`room_type_${prefix}_unit_missing`);
    const readyUnits = units.filter(hotelInventoryService.unitIsReady);
    if (units.length && !readyUnits.length) failures.push(`room_type_${prefix}_ready_unit_missing`);
    const readyUnitIds = new Set(readyUnits.map((row) => String(row.id)));
    const activePlanIds = new Set(plans.map((row) => String(row.id)));
    const inventory = futureInventory.filter((row) => String(row.roomTypeId) === String(roomType.id)
      && readyUnitIds.has(String(row.roomUnitId))
      && Number(row.price) >= 0
      && (!clean(row.ratePlanId) || activePlanIds.has(String(row.ratePlanId))));
    if (!inventory.length) failures.push(`room_type_${prefix}_future_inventory_missing`);
    if (inventory.length && !inventory.some((row) => ['available', 'open'].includes(clean(row.status).toLowerCase()) && Number(row.availableInventory ?? 1) > 0 && !clean(row.bookingRef))) failures.push(`room_type_${prefix}_future_sellable_inventory_missing`);
  });

  return {
    ready: failures.length === 0,
    failures: [...new Set(failures)],
    warnings: [...new Set(warnings)],
    company,
    listing,
    property,
    roomTypes,
    ratePlans,
    roomUnits,
    futureInventory,
  };
}

function hotelReadinessMessage(readiness = {}) {
  const labels = {
    listing_is_not_hotel: 'Select a hotel listing.',
    company_not_active_and_verified: 'Complete company verification before publishing.',
    listing_title_missing: 'Add the public hotel title.',
    listing_description_missing: 'Add a clear public hotel description.',
    listing_currency_invalid: 'Set a valid three-letter operating currency.',
    listing_media_missing: 'Upload at least one hotel image.',
    multiple_active_properties_for_listing: 'Keep exactly one active property for this public listing.',
    active_property_missing: 'Create and activate the hotel property.',
    property_location_incomplete: 'Complete the property address, city, and country.',
    property_operating_times_incomplete: 'Set the property timezone, check-in time, and check-out time.',
    property_contact_missing: 'Add a working property email or phone for guest and operations contact.',
    active_room_type_missing: 'Create at least one active room type.',
  };
  return (readiness.failures || []).map((code) => {
    if (labels[code]) return labels[code];
    if (/_rate_plan_missing$/.test(code)) return 'Add an active rate plan to every active room type.';
    if (/_ready_unit_missing$/.test(code)) return 'Mark at least one physical room as available and clean, inspected, or ready for every active room type.';
    if (/_unit_missing$/.test(code)) return 'Add at least one physical room unit to every active room type.';
    if (/_future_sellable_inventory_missing$/.test(code)) return 'Open at least one future room night with available inventory for every active room type.';
    if (/_future_inventory_missing$/.test(code)) return 'Create future dated room inventory for every active room type and connect it to a ready room.';
    if (/_unsupported_payment_timing$/.test(code)) return 'Use the completed pay-now payment timing for every active hotel rate plan.';
    if (/_occupancy_or_price_invalid$/.test(code)) return 'Correct room occupancy and base-price settings.';
    return code.replace(/_/g, ' ');
  });
}

async function publishHotelListing(companyId, listingId, actorId = 'company-admin') {
  const readiness = await hotelListingReadiness(companyId, listingId);
  if (!readiness.ready) {
    const error = new Error(`Hotel service cannot be published: ${hotelReadinessMessage(readiness).join(' ')}`);
    error.status = 422;
    error.code = 'hotel_listing_not_ready';
    error.meta = { failures: readiness.failures, warnings: readiness.warnings };
    throw error;
  }
  const now = new Date().toISOString();
  const listing = readiness.listing;
  Object.assign(listing, {
    status: 'active',
    releaseStatus: 'published',
    bookable: true,
    isVerified: true,
    publishedAt: listing.publishedAt || now,
    unpublishedAt: null,
    updatedAt: now,
  });
  await hotelRepository.transaction(async (session) => {
    await hotelRepository.listings.save(listing, { id: listing.id }, { session });
    await hotelRepository.audit({
      actorId,
      action: 'hotel.listing.published',
      targetType: 'listing',
      targetId: listing.id,
      companyId,
      meta: { propertyId: readiness.property?.id || '', roomTypeIds: readiness.roomTypes.map((row) => row.id), warnings: readiness.warnings },
      session,
    });
  });
  return listing;
}

async function reconcileHotelListingPublication(companyId, listingId, actorId = 'system') {
  const listing = await hotelRepository.listings.findOne({ id: clean(listingId), companyId, serviceType: 'hotel' });
  if (!listing || clean(listing.releaseStatus).toLowerCase() !== 'published') return listing;
  const readiness = await hotelListingReadiness(companyId, listing.id);
  if (readiness.ready) return listing;
  const now = new Date().toISOString();
  Object.assign(listing, { status: 'paused', releaseStatus: 'paused', bookable: false, unpublishedAt: now, updatedAt: now });
  await hotelRepository.listings.save(listing, { id: listing.id });
  await hotelRepository.audit({ actorId, action: 'hotel.listing.auto_paused', targetType: 'listing', targetId: listing.id, companyId, meta: { failures: readiness.failures } });
  return listing;
}

function toCsv(headers, rows) {
  const esc = (value) => { const text = String(value ?? ''); return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
  const values = rows.map((row) => Array.isArray(row) ? row.filter((cell) => typeof cell !== 'object') : headers.map((header) => row[header.key]));
  const labels = headers.map((header) => typeof header === 'string' ? header : header.label);
  return [labels, ...values].map((row) => row.map(esc).join(',')).join('\n');
}

async function pdfBuffer(title, rows, columns = []) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30, info: { Title: title } }); const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    doc.fontSize(16).text(title, { underline: true }); doc.moveDown();
    const selected = columns.length ? columns : [{ key: 'bookingRef', label: 'Booking' }, { key: 'guestName', label: 'Guest' }, { key: 'roomNumbers', label: 'Room' }, { key: 'checkIn', label: 'Check-in' }, { key: 'checkOut', label: 'Check-out' }, { key: 'paymentStatus', label: 'Payment' }, { key: 'status', label: 'Status' }];
    doc.fontSize(8).text(selected.map((column) => column.label).join(' | ')); doc.moveDown(.4);
    rows.forEach((row) => doc.fontSize(8).text((Array.isArray(row) ? row.filter((cell) => typeof cell !== 'object') : selected.map((column) => row[column.key] || '-')).join(' | ')));
    doc.end();
  });
}

module.exports = {
  createProperty,
  updateProperty,
  archiveProperty,
  createRoomType,
  createRatePlan,
  updateRatePlan,
  archiveRatePlan,
  updateRoomType,
  archiveRoomType,
  createRoomUnits,
  updateRoomUnit,
  archiveRoomUnit,
  createNightInventory,
  updateNightStatus,
  archiveNightInventory,
  createHotelBooking,
  hotelListingReadiness,
  publishHotelListing,
  reconcileHotelListingPublication,
  roomMap,
  manifestRecords,
  manifestRows,
  markStay,
  markNoShow,
  operationalVoucher,
  updateHousekeeping,
  setRoomTypeInventory,
  toCsv,
  pdfBuffer,
};
