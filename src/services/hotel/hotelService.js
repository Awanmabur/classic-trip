const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const store = require('../data/persistentStore');
const { env } = require('../../config/env');
const generateBookingRef = require('../../utils/generateBookingRef');
const calculateCommission = require('../../utils/calculateCommission');
const repositories = require('../../repositories');
const timelineService = require('../support/timelineService');
const releaseService = require('../commission/releaseService');
const paymentService = require('../payment/paymentService');
const notificationService = require('../notification/notificationService');

function ensureCollections() {
  ['hotelProperties', 'roomTypes', 'roomUnits', 'roomNightInventories', 'stayRules', 'bookings', 'payments', 'notifications', 'auditLogs'].forEach((key) => {
    if (!Array.isArray(store.state[key])) store.state[key] = [];
  });
}

function clean(value, fallback = '') { return String(value ?? fallback).trim(); }
function num(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function list(value) {
  if (Array.isArray(value)) return value.map((v) => clean(v)).filter(Boolean);
  return String(value || '').split(/[,\n]/).map((v) => clean(v)).filter(Boolean);
}
function nextId(prefix, rows) { return `${prefix}-${String((rows || []).length + 1).padStart(4, '0')}`; }
function isoDate(value) { return new Date(value).toISOString().slice(0, 10); }
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
async function upsert(entity, row) {
  if (repositories.mongoReady && repositories[entity]) await repositories[entity].upsert(row);
}
function companyOrThrow(companyId) {
  const company = store.findCompany(companyId);
  if (!company) { const error = new Error('Company not found'); error.status = 404; throw error; }
  return company;
}
function hotelListingOrThrow(companyId, listingId) {
  const listing = store.state.listings.find((item) => (item.id === listingId || item.slug === listingId) && item.companyId === companyId);
  if (!listing || listing.serviceType !== 'hotel') { const error = new Error('Hotel listing not found'); error.status = 404; throw error; }
  return listing;
}
function inventoryById(id, companyId) {
  const night = store.state.roomNightInventories.find((item) => item.id === id && (!companyId || item.companyId === companyId));
  if (!night) { const error = new Error('Room-night inventory not found'); error.status = 404; throw error; }
  return night;
}

async function createProperty(companyId, payload = {}, actorId = 'company-admin') {
  ensureCollections();
  companyOrThrow(companyId);
  const listing = hotelListingOrThrow(companyId, payload.listingId || payload.slug);
  const property = {
    id: nextId('hotel-property', store.state.hotelProperties),
    companyId,
    listingId: listing.id,
    propertyName: clean(payload.propertyName || payload.name || listing.title),
    address: clean(payload.address || listing.address),
    city: clean(payload.city || listing.city),
    country: clean(payload.country || listing.country || 'Uganda'),
    mapLocation: clean(payload.mapLocation || payload.location || ''),
    checkInTime: clean(payload.checkInTime || listing.checkInTime || '14:00'),
    checkOutTime: clean(payload.checkOutTime || listing.checkOutTime || '10:00'),
    amenities: list(payload.amenities || listing.amenities),
    policies: list(payload.policies || listing.policy),
    taxesAndFees: list(payload.taxesAndFees).map((fee) => ({ label: fee, amount: 0 })),
    status: clean(payload.status || 'active'),
    createdBy: actorId,
    createdAt: new Date().toISOString(),
  };
  listing.address = property.address || listing.address;
  listing.city = property.city || listing.city;
  listing.country = property.country || listing.country;
  listing.checkInTime = property.checkInTime;
  listing.checkOutTime = property.checkOutTime;
  listing.amenities = property.amenities;
  store.state.hotelProperties.push(property);
  await upsert('hotelProperties', property);
  await upsert('listings', listing);
  return property;
}


async function updateProperty(companyId, propertyId, payload = {}, actorId = 'company-admin') {
  ensureCollections();
  const property = store.state.hotelProperties.find((item) => item.id === propertyId && item.companyId === companyId);
  if (!property) { const error = new Error('Hotel property not found'); error.status = 404; throw error; }
  const listing = store.state.listings.find((item) => item.id === property.listingId && item.companyId === companyId) || {};
  if (payload.propertyName || payload.name) property.propertyName = clean(payload.propertyName || payload.name);
  if (payload.address) property.address = clean(payload.address);
  if (payload.city) property.city = clean(payload.city);
  if (payload.country) property.country = clean(payload.country);
  if (payload.mapLocation || payload.location) property.mapLocation = clean(payload.mapLocation || payload.location);
  if (payload.checkInTime) property.checkInTime = clean(payload.checkInTime);
  if (payload.checkOutTime) property.checkOutTime = clean(payload.checkOutTime);
  if (payload.amenities) property.amenities = list(payload.amenities);
  if (payload.policies) property.policies = list(payload.policies);
  if (payload.status) property.status = clean(payload.status);
  property.updatedBy = actorId;
  property.updatedAt = new Date().toISOString();
  if (listing.id) {
    listing.title = property.propertyName || listing.title;
    listing.address = property.address || listing.address;
    listing.city = property.city || listing.city;
    listing.country = property.country || listing.country;
    listing.checkInTime = property.checkInTime;
    listing.checkOutTime = property.checkOutTime;
    listing.amenities = property.amenities;
    await upsert('listings', listing);
  }
  await upsert('hotelProperties', property);
  store.state.auditLogs.unshift({ id: nextId('audit', store.state.auditLogs), actorId, action: 'hotel.property.updated', targetType: 'hotelProperty', targetId: property.id, createdAt: new Date().toISOString() });
  return property;
}

async function archiveProperty(companyId, propertyId, actorId = 'company-admin') {
  return updateProperty(companyId, propertyId, { status: 'archived' }, actorId);
}

async function updateRoomType(companyId, roomTypeId, payload = {}, actorId = 'company-admin') {
  ensureCollections();
  const roomType = store.state.roomTypes.find((item) => item.id === roomTypeId && item.companyId === companyId);
  if (!roomType) { const error = new Error('Room type not found'); error.status = 404; throw error; }
  if (payload.name || payload.roomType) roomType.name = clean(payload.name || payload.roomType);
  if (payload.capacity) roomType.capacity = Math.max(1, Math.round(num(payload.capacity, roomType.capacity || 1)));
  if (payload.basePrice || payload.nightlyPrice) roomType.basePrice = Math.max(0, num(payload.basePrice || payload.nightlyPrice, roomType.basePrice || 0));
  if (payload.amenities) roomType.amenities = list(payload.amenities);
  if (payload.policies) roomType.policies = list(payload.policies);
  if (payload.status) roomType.status = clean(payload.status);
  roomType.updatedBy = actorId;
  roomType.updatedAt = new Date().toISOString();
  const legacyRoom = store.state.rooms.find((room) => room.id === roomType.roomId || room.roomTypeId === roomType.id);
  if (legacyRoom) {
    legacyRoom.roomType = roomType.name;
    legacyRoom.capacity = roomType.capacity;
    legacyRoom.nightlyPrice = roomType.basePrice;
    legacyRoom.amenities = roomType.amenities;
    legacyRoom.status = roomType.status;
    legacyRoom.updatedAt = roomType.updatedAt;
    await upsert('rooms', legacyRoom);
  }
  await upsert('roomTypes', roomType);
  store.state.auditLogs.unshift({ id: nextId('audit', store.state.auditLogs), actorId, action: 'hotel.room_type.updated', targetType: 'roomType', targetId: roomType.id, createdAt: new Date().toISOString() });
  return roomType;
}

async function archiveRoomType(companyId, roomTypeId, actorId = 'company-admin') {
  return updateRoomType(companyId, roomTypeId, { status: 'archived' }, actorId);
}

async function updateRoomUnit(companyId, unitId, payload = {}, actorId = 'company-admin') {
  ensureCollections();
  const unit = store.state.roomUnits.find((item) => item.id === unitId && item.companyId === companyId);
  if (!unit) { const error = new Error('Room unit not found'); error.status = 404; throw error; }
  if (payload.unitNumber || payload.roomNumber) unit.unitNumber = clean(payload.unitNumber || payload.roomNumber);
  if (payload.floor) unit.floor = clean(payload.floor);
  if (payload.wing) unit.wing = clean(payload.wing);
  if (payload.housekeepingStatus) unit.housekeepingStatus = clean(payload.housekeepingStatus);
  if (payload.status) unit.status = clean(payload.status);
  if (payload.notes) unit.notes = clean(payload.notes);
  unit.updatedBy = actorId;
  unit.updatedAt = new Date().toISOString();
  await upsert('roomUnits', unit);
  store.state.auditLogs.unshift({ id: nextId('audit', store.state.auditLogs), actorId, action: 'hotel.room_unit.updated', targetType: 'roomUnit', targetId: unit.id, createdAt: new Date().toISOString() });
  return unit;
}

async function archiveRoomUnit(companyId, unitId, actorId = 'company-admin') {
  return updateRoomUnit(companyId, unitId, { status: 'archived' }, actorId);
}

async function archiveNightInventory(companyId, inventoryId, actorId = 'company-admin') {
  return updateNightStatus(companyId, inventoryId, { status: 'cancelled', notes: 'Archived by company admin' }, actorId);
}

async function createRoomType(companyId, payload = {}, actorId = 'company-admin') {
  ensureCollections();
  const listing = hotelListingOrThrow(companyId, payload.listingId || payload.slug);
  const property = payload.propertyId ? store.state.hotelProperties.find((item) => item.id === payload.propertyId && item.companyId === companyId) : store.state.hotelProperties.find((item) => item.listingId === listing.id);
  const roomType = {
    id: nextId('room-type', store.state.roomTypes),
    companyId,
    listingId: listing.id,
    propertyId: property?.id || '',
    name: clean(payload.name || payload.roomType || 'Standard Room'),
    capacity: Math.max(1, Math.round(num(payload.capacity, 2))),
    basePrice: Math.max(0, num(payload.basePrice || payload.nightlyPrice || listing.priceFrom, 0)),
    amenities: list(payload.amenities),
    policies: list(payload.policies),
    taxesAndFees: list(payload.taxesAndFees).map((fee) => ({ label: fee, amount: 0 })),
    status: clean(payload.status || 'active'),
    createdBy: actorId,
    createdAt: new Date().toISOString(),
  };
  store.state.roomTypes.push(roomType);
  const legacyRoom = {
    id: nextId('room', store.state.rooms),
    listingId: listing.id,
    companyId,
    roomType: roomType.name,
    roomTypeId: roomType.id,
    propertyId: roomType.propertyId,
    capacity: roomType.capacity,
    nightlyPrice: roomType.basePrice,
    inventory: Math.max(1, Math.round(num(payload.defaultInventory, 1))),
    amenities: roomType.amenities,
    status: roomType.status,
    createdAt: roomType.createdAt,
  };
  store.state.rooms.push(legacyRoom);
  roomType.roomId = legacyRoom.id;
  listing.priceFrom = Math.min(...store.roomsForListing(listing.id).map((room) => Number(room.nightlyPrice || listing.priceFrom)).filter(Boolean));
  listing.price = listing.priceFrom;
  await upsert('roomTypes', roomType);
  await upsert('rooms', legacyRoom);
  await upsert('listings', listing);
  return { roomType, room: legacyRoom };
}

async function createRoomUnits(companyId, payload = {}, actorId = 'company-admin') {
  ensureCollections();
  const roomType = store.state.roomTypes.find((item) => item.id === payload.roomTypeId && item.companyId === companyId);
  if (!roomType) { const error = new Error('Room type not found'); error.status = 404; throw error; }
  const existingUnitCount = store.state.roomUnits.length;
  const units = list(payload.unitNumbers || payload.units || payload.roomNumbers).map((unitNumber, index) => ({
    id: `room-unit-${String(existingUnitCount + index + 1).padStart(4, '0')}`,
    companyId,
    listingId: roomType.listingId,
    propertyId: roomType.propertyId,
    roomTypeId: roomType.id,
    roomId: roomType.roomId,
    unitNumber,
    floor: clean(payload.floor || ''),
    wing: clean(payload.wing || ''),
    status: clean(payload.status || 'available'),
    housekeepingStatus: clean(payload.housekeepingStatus || 'clean'),
    notes: clean(payload.notes || ''),
    createdBy: actorId,
    createdAt: new Date().toISOString(),
  }));
  units.forEach((unit) => store.state.roomUnits.push(unit));
  const legacyRoom = store.state.rooms.find((room) => room.id === roomType.roomId);
  if (legacyRoom) legacyRoom.inventory = store.state.roomUnits.filter((unit) => unit.roomTypeId === roomType.id && unit.status !== 'archived').length;
  await Promise.all(units.map((unit) => upsert('roomUnits', unit)));
  if (legacyRoom) await upsert('rooms', legacyRoom);
  return units;
}

async function createNightInventory(companyId, payload = {}, actorId = 'company-admin') {
  ensureCollections();
  const roomType = store.state.roomTypes.find((item) => item.id === payload.roomTypeId && item.companyId === companyId);
  if (!roomType) { const error = new Error('Room type not found'); error.status = 404; throw error; }
  const nights = dateRange(payload.startDate || payload.checkIn, payload.endDate || payload.checkOut);
  const units = payload.roomUnitIds ? list(payload.roomUnitIds).map((id) => store.state.roomUnits.find((unit) => unit.id === id && unit.companyId === companyId)).filter(Boolean) : store.state.roomUnits.filter((unit) => unit.roomTypeId === roomType.id && unit.status !== 'archived');
  if (!units.length) { const error = new Error('At least one room unit is required'); error.status = 422; throw error; }
  const rows = [];
  units.forEach((unit) => {
    nights.forEach((date) => {
      let row = store.state.roomNightInventories.find((item) => item.roomUnitId === unit.id && item.date === date);
      if (!row) {
        row = {
          id: nextId('room-night', store.state.roomNightInventories),
          companyId,
          listingId: roomType.listingId,
          propertyId: roomType.propertyId,
          roomTypeId: roomType.id,
          roomUnitId: unit.id,
          roomId: roomType.roomId,
          date,
          price: Math.max(0, num(payload.price || payload.nightlyPrice || roomType.basePrice, roomType.basePrice)),
          status: clean(payload.status || 'available'),
          createdBy: actorId,
          createdAt: new Date().toISOString(),
        };
        store.state.roomNightInventories.push(row);
      } else {
        row.price = Math.max(0, num(payload.price || payload.nightlyPrice || row.price, row.price));
        row.status = clean(payload.status || row.status);
        row.updatedAt = new Date().toISOString();
      }
      rows.push(row);
    });
  });
  await Promise.all(rows.map((row) => upsert('roomNightInventories', row)));
  return rows;
}

async function updateNightStatus(companyId, inventoryId, payload = {}, actorId = 'company-admin') {
  ensureCollections();
  const allowed = ['available', 'held', 'booked', 'occupied', 'checked-in', 'checked-out', 'maintenance', 'cleaning', 'cancelled', 'refunded', 'reserved'];
  const night = inventoryById(inventoryId, companyId);
  const status = clean(payload.status || night.status);
  if (!allowed.includes(status)) { const error = new Error('Invalid room-night status'); error.status = 422; throw error; }
  night.status = status;
  night.notes = clean(payload.notes || night.notes || '');
  night.updatedBy = actorId;
  night.updatedAt = new Date().toISOString();
  const unit = store.state.roomUnits.find((item) => item.id === night.roomUnitId);
  if (unit && ['maintenance', 'cleaning', 'occupied', 'available'].includes(status)) {
    unit.status = status === 'occupied' ? 'occupied' : status;
    if (payload.housekeepingStatus) unit.housekeepingStatus = clean(payload.housekeepingStatus);
    unit.updatedAt = night.updatedAt;
    await upsert('roomUnits', unit);
  }
  await upsert('roomNightInventories', night);
  store.state.auditLogs.unshift({ id: nextId('audit', store.state.auditLogs), actorId, action: 'hotel.room_night.status', targetType: 'roomNightInventory', targetId: night.id, createdAt: new Date().toISOString(), meta: { status } });
  return night;
}

function availableNightGroups(listingId, checkIn, checkOut, roomTypeId = '', selectedUnitIds = []) {
  const nights = dateRange(checkIn, checkOut);
  const selected = new Set((selectedUnitIds || []).map(String).filter(Boolean));
  const all = store.state.roomNightInventories.filter((night) => night.listingId === listingId && (!roomTypeId || night.roomTypeId === roomTypeId) && (!selected.size || selected.has(String(night.roomUnitId))) && nights.includes(night.date));
  const byUnit = new Map();
  all.forEach((night) => {
    if (!byUnit.has(night.roomUnitId)) byUnit.set(night.roomUnitId, []);
    byUnit.get(night.roomUnitId).push(night);
  });
  return Array.from(byUnit.values()).filter((rows) => rows.length === nights.length && rows.every((night) => night.status === 'available' || night.status === 'reserved'));
}

async function createHotelBooking(payload = {}, req = {}) {
  ensureCollections();
  const listing = store.findListing(payload.listingId || payload.slug, 'hotel') || store.state.listings.find((item) => item.id === payload.listingId && item.serviceType === 'hotel');
  if (!listing) { const error = new Error('Hotel listing not found'); error.status = 404; throw error; }
  const checkIn = isoDate(payload.checkInDate || payload.checkIn || payload.startDate);
  const checkOut = isoDate(payload.checkOutDate || payload.checkOut || payload.endDate);
  const nights = dateRange(checkIn, checkOut);
  const roomCount = Math.max(1, Math.round(num(payload.roomCount || payload.rooms, 1)));
  const roomTypeId = clean(payload.roomTypeId || '');
  const selectedRoomUnitIds = list(payload.roomUnitIds || payload.roomUnitId || payload.selected || '');
  const groups = availableNightGroups(listing.id, checkIn, checkOut, roomTypeId, selectedRoomUnitIds).slice(0, roomCount);
  if (groups.length < roomCount) { const error = new Error('Not enough room-night inventory available'); error.status = 409; throw error; }
  let guests = [];
  try { guests = JSON.parse(payload.guests || payload.guestDetails || '[]'); } catch (error) { guests = []; }
  if (!Array.isArray(guests) || !guests.length) guests = [{ fullName: payload.fullName || 'Hotel Guest', email: payload.email, phone: payload.phone }];
  const selectedRows = groups.flat();
  const subtotal = selectedRows.reduce((total, night) => total + Number(night.price || listing.priceFrom || 0), 0);
  const fees = Math.round(subtotal * 0.045 + 3500);
  const total = subtotal + fees;
  const split = calculateCommission(total, false);
  const bookingRef = generateBookingRef('hotel');
  const roomUnits = groups.map((rows) => store.state.roomUnits.find((unit) => unit.id === rows[0].roomUnitId) || {});
  const roomTypes = groups.map((rows) => store.state.roomTypes.find((type) => type.id === rows[0].roomTypeId) || {});

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
    price: rows.reduce((totalRow, night) => totalRow + Number(night.price || 0), 0),
    status: 'confirmed',
  }));
  const ticketLegs = bookingItems.map((item, index) => ({
    id: `${bookingRef}-ROOM-${index + 1}`,
    serviceType: 'hotel',
    legType: 'stay',
    roomUnitId: item.roomUnitId,
    roomNumber: item.roomNumber,
    checkIn,
    checkOut,
    qrCodeValue: `CLASSIC-TRIP:HOTEL:${bookingRef}:${item.roomUnitId}:${Date.now()}`,
    status: 'confirmed',
  }));
  const booking = {
    id: nextId('booking', store.state.bookings),
    bookingRef,
    guestLookupCode: crypto.randomBytes(6).toString('hex').toUpperCase(),
    serviceType: 'hotel',
    guestSnapshot: { fullName: payload.fullName || guests[0]?.fullName || 'Hotel Guest', email: payload.email || guests[0]?.email || 'guest@example.com', phone: payload.phone || guests[0]?.phone || '+256700000000' },
    customerUserId: payload.customerUserId || req?.session?.user?.id || null,
    companyId: listing.companyId,
    listingId: listing.id,
    passengers: groups.map((rows, index) => ({ id: `guest-${index + 1}`, fullName: guests[index]?.fullName || guests[0]?.fullName || payload.fullName || 'Hotel Guest', email: guests[index]?.email || payload.email, phone: guests[index]?.phone || payload.phone, seatOrRoom: roomUnits[index]?.unitNumber || roomTypes[index]?.name || 'Room', roomNumber: roomUnits[index]?.unitNumber || '', roomType: roomTypes[index]?.name || '' })),
    bookingItems,
    ticketLegs,
    hotelStay: { checkIn, checkOut, nights, roomCount, adults: Math.max(1, Math.round(num(payload.adults, guests.length || 1))), children: Math.max(0, Math.round(num(payload.children, 0))), roomUnitIds: roomUnits.map((unit) => unit.id).filter(Boolean), roomTypeIds: roomTypes.map((type) => type.id).filter(Boolean), status: 'booked', specialRequests: clean(payload.specialRequests || payload.addons || '') },
    pricing: { subtotal, fees, addonTotal: 0, total, currency: listing.currency || 'UGX', split },
    paymentStatus: 'pending',
    bookingStatus: 'pending_payment',
    qrCodeValue: `CLASSIC-TRIP:${bookingRef}:${listing.id}:${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
  const isManualSettlement = payload.paymentStatus === 'successful' || payload.source === 'company_manual';
  let provider;
  let payment;
  if (isManualSettlement) {
    provider = payload.paymentProvider || payload.provider || 'manual';
    payment = {
      provider,
      providerReference: payload.paymentRef || `MANUAL-${bookingRef}`,
      status: 'successful',
      paidAt: new Date().toISOString(),
      checkoutUrl: '',
    };
  } else {
    provider = paymentService.resolveProviderName(payload.provider || payload.paymentProvider);
    payment = await paymentService.initiatePayment({
      provider,
      bookingRef,
      amount: total,
      currency: booking.pricing.currency,
      customer: booking.guestSnapshot,
      callbackUrl: `${env.appUrl}/booking/payment/callback?bookingRef=${encodeURIComponent(bookingRef)}`,
      description: `Classic Trip hotel booking ${bookingRef}`,
    });
  }
  booking.paymentStatus = payment.status || 'pending';
  booking.paymentProvider = payment.provider || provider;
  booking.paymentRef = payment.providerReference || '';
  booking.checkoutUrl = payment.checkoutUrl || '';
  booking.bookingStatus = booking.paymentStatus === 'successful' ? (payload.bookingStatus || 'confirmed') : 'pending_payment';
  selectedRows.forEach((night) => {
    night.status = 'booked';
    night.bookingRef = bookingRef;
    night.guestName = payload.fullName || guests[0]?.fullName || 'Hotel Guest';
    night.checkInStatus = 'not_checked';
    night.updatedAt = new Date().toISOString();
  });
  store.state.bookings.unshift(booking);
  const paymentRow = { id: nextId('payment', store.state.payments), bookingId: booking.id, bookingRef, amount: total, currency: booking.pricing.currency, status: booking.paymentStatus, provider: booking.paymentProvider, providerReference: booking.paymentRef, checkoutUrl: booking.checkoutUrl, createdAt: booking.createdAt, paidAt: booking.paymentStatus === 'successful' ? (payment.paidAt || new Date().toISOString()) : null };
  store.state.payments.unshift(paymentRow);
  if (booking.paymentStatus === 'successful') await store.settleBookingPayment(bookingRef);
  if (booking.paymentStatus === 'successful') {
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
      meta: { bookingRef, checkoutUrl: booking.checkoutUrl },
    });
  }
  const actorId = req?.session?.user?.id || payload.createdByEmployeeId || payload.actorId || 'guest';
  store.state.auditLogs.unshift({ id: nextId('audit', store.state.auditLogs), actorId, action: 'hotel.booking.created', targetType: 'booking', targetId: bookingRef, createdAt: booking.createdAt });
  await timelineService.recordEvent({ bookingRef, companyId: booking.companyId, customerUserId: booking.customerUserId, entityType: 'hotel_booking', entityId: bookingRef, action: 'hotel.booking.created', title: `Hotel booking ${bookingRef} created`, message: `Stay created for ${checkIn} to ${checkOut}.`, status: booking.bookingStatus, actorType: payload.source === 'company_manual' ? 'company' : 'customer', actorId, metadata: { checkIn, checkOut, roomCount, roomTypeId, roomUnitIds: booking.hotelStay.roomUnitIds } });
  await timelineService.recordEvent({ bookingRef, companyId: booking.companyId, customerUserId: booking.customerUserId, entityType: 'room_night_inventory', entityId: booking.hotelStay.roomUnitIds.join(','), action: 'hotel.inventory.booked', title: `Room-night inventory booked for ${bookingRef}`, message: `${selectedRows.length} room-night(s) were converted to booked.`, status: 'booked', actorType: 'system', actorId, metadata: { nights, selectedRoomUnitIds } });
  await timelineService.recordEvent({ bookingRef, companyId: booking.companyId, customerUserId: booking.customerUserId, entityType: 'payment', entityId: paymentRow.id, action: booking.paymentStatus === 'successful' ? 'payment.succeeded' : 'payment.pending', title: booking.paymentStatus === 'successful' ? `Payment received for ${bookingRef}` : `Payment pending for ${bookingRef}`, message: booking.paymentStatus === 'successful' ? 'Hotel voucher and QR are valid for check-in.' : 'Hotel booking is waiting for payment confirmation.', status: booking.paymentStatus, actorType: 'system', actorId });
  await timelineService.recordEvent({ bookingRef, companyId: booking.companyId, customerUserId: booking.customerUserId, entityType: 'hotel_voucher', entityId: ticketLegs[0]?.id || bookingRef, action: 'hotel.voucher.issued', title: `Hotel voucher issued for ${bookingRef}`, message: `${ticketLegs.length} room voucher(s) were created.`, status: 'issued', actorType: 'system', actorId });
  await Promise.all(selectedRows.map((night) => upsert('roomNightInventories', night)));
  await upsert('bookings', booking);
  await upsert('payments', paymentRow);
  return booking;
}

function roomMap(companyId, listingId, startDate, endDate) {
  ensureCollections();
  const listing = hotelListingOrThrow(companyId, listingId);
  const dates = startDate && endDate ? dateRange(startDate, endDate) : [];
  const units = store.state.roomUnits.filter((unit) => unit.companyId === companyId && unit.listingId === listing.id && unit.status !== 'archived');
  return units.map((unit) => {
    const roomType = store.state.roomTypes.find((type) => type.id === unit.roomTypeId) || {};
    const nights = store.state.roomNightInventories.filter((night) => night.roomUnitId === unit.id && (!dates.length || dates.includes(night.date))).sort((a, b) => a.date.localeCompare(b.date));
    const activeNight = nights.find((night) => ['booked', 'occupied', 'checked-in', 'held', 'maintenance', 'cleaning', 'reserved'].includes(night.status)) || nights[0];
    return [roomType.name || 'Room', unit.unitNumber, nights.map((night) => `${night.date}:${night.status}`).join(' | ') || unit.status, activeNight?.bookingRef || '-', activeNight?.guestName || '-', activeNight?.status || unit.status, { entity: 'room_night', id: activeNight?.id || unit.id, label: unit.unitNumber, status: activeNight?.status || unit.status }];
  });
}

function manifestRows(companyId, listingId, mode = 'arrivals') {
  const listing = hotelListingOrThrow(companyId, listingId);
  const bookings = store.state.bookings.filter((booking) => booking.companyId === companyId && booking.listingId === listing.id && booking.serviceType === 'hotel');
  return bookings.filter((booking) => {
    const status = booking.hotelStay?.status || booking.bookingStatus;
    if (mode === 'in-house') return ['checked-in', 'occupied', 'in_house'].includes(status);
    if (mode === 'departures') return ['checked-in', 'occupied', 'confirmed', 'checked-out', 'completed'].includes(status) || booking.bookingStatus === 'completed';
    return ['confirmed', 'booked', 'checked-in', 'completed'].includes(booking.bookingStatus) || ['booked', 'checked-in', 'checked-out', 'completed'].includes(status);
  }).map((booking) => [booking.bookingRef, booking.guestSnapshot?.fullName || '-', (booking.passengers || []).map((guest) => guest.seatOrRoom).join(', '), booking.hotelStay?.checkIn || '-', booking.hotelStay?.checkOut || '-', booking.hotelStay?.status || booking.bookingStatus, { entity: 'hotel_booking', id: booking.bookingRef, label: booking.bookingRef, status: booking.bookingStatus }]);
}

async function markStay(companyId, bookingRef, status, actorId = 'company-admin') {
  ensureCollections();
  const booking = store.state.bookings.find((item) => item.bookingRef === bookingRef && item.companyId === companyId && item.serviceType === 'hotel');
  if (!booking) { const error = new Error('Hotel booking not found'); error.status = 404; throw error; }
  const normalized = status === 'check-in' ? 'checked-in' : status === 'check-out' ? 'checked-out' : status;
  booking.hotelStay = booking.hotelStay || {};
  booking.hotelStay.status = normalized;
  booking.bookingStatus = normalized === 'checked-out' ? 'completed' : normalized;
  if (normalized === 'checked-out') {
    booking.completedAt = new Date().toISOString();
    booking.checkOutAt = booking.completedAt;
    booking.settlementStatus = booking.settlementStatus || 'eligible';
  }
  if (normalized === 'checked-in') {
    booking.checkedInAt = new Date().toISOString();
    booking.checkInStatus = 'checked_in';
  }
  const nightStatus = normalized === 'checked-in' ? 'occupied' : normalized;
  const affectedNights = store.state.roomNightInventories.filter((night) => night.bookingRef === bookingRef);
  affectedNights.forEach((night) => {
    night.status = nightStatus;
    night.checkInStatus = normalized;
    night.updatedAt = new Date().toISOString();
    const unit = store.state.roomUnits.find((item) => item.id === night.roomUnitId && item.companyId === companyId);
    if (unit && normalized === 'checked-in') {
      unit.status = 'occupied';
      unit.housekeepingStatus = 'occupied';
      unit.updatedAt = night.updatedAt;
    }
    if (unit && normalized === 'checked-out') {
      unit.status = 'cleaning';
      unit.housekeepingStatus = 'dirty';
      unit.housekeepingTaskStatus = 'open';
      unit.housekeepingPriority = 'normal';
      unit.housekeepingDueAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      unit.lastGuestBookingRef = bookingRef;
      unit.updatedAt = night.updatedAt;
    }
  });
  store.state.auditLogs.unshift({ id: nextId('audit', store.state.auditLogs), actorId, action: `hotel.stay.${normalized}`, targetType: 'booking', targetId: bookingRef, createdAt: new Date().toISOString(), meta: { affectedNights: affectedNights.length } });
  await timelineService.recordEvent({ bookingRef, companyId: booking.companyId, customerUserId: booking.customerUserId, entityType: 'hotel_stay', entityId: bookingRef, action: `hotel.stay.${normalized}`, title: normalized === 'checked-in' ? `Guest checked in for ${bookingRef}` : normalized === 'checked-out' ? `Guest checked out for ${bookingRef}` : `Hotel stay updated for ${bookingRef}`, message: normalized === 'checked-in' ? 'Guest arrival was confirmed and room state changed to occupied.' : normalized === 'checked-out' ? 'Guest departure was confirmed and stay was completed.' : `Stay status changed to ${normalized}.`, status: normalized, actorType: 'company', actorId, metadata: { roomUnitIds: booking.hotelStay.roomUnitIds || [], checkIn: booking.hotelStay.checkIn, checkOut: booking.hotelStay.checkOut } });
  let releasedCommissions = [];
  if (normalized === 'checked-out') {
    releasedCommissions = (await releaseService.releaseCompletedBooking(bookingRef)) || [];
    booking.earningsReleasedAt = booking.earningsReleasedAt || (releasedCommissions.length ? new Date().toISOString() : booking.earningsReleasedAt);
    booking.settlementStatus = releasedCommissions.length ? 'available' : booking.settlementStatus;
    store.state.auditLogs.unshift({ id: nextId('audit', store.state.auditLogs), actorId, action: 'hotel.stay.earnings_released', targetType: 'booking', targetId: bookingRef, createdAt: new Date().toISOString(), meta: { releasedCommissions: releasedCommissions.length } });
    await timelineService.recordEvent({ bookingRef, companyId: booking.companyId, customerUserId: booking.customerUserId, entityType: 'settlement', entityId: bookingRef, action: 'hotel.settlement.eligible', title: `Hotel stay settlement updated for ${bookingRef}`, message: releasedCommissions.length ? 'Stay completion released eligible company/promoter earnings.' : 'Stay completion marked this booking settlement-eligible.', status: booking.settlementStatus || 'eligible', actorType: 'system', actorId, metadata: { releasedCommissions: releasedCommissions.length } });
  }
  await upsert('bookings', booking);
  await Promise.all(affectedNights.map((night) => upsert('roomNightInventories', night)));
  await Promise.all(store.state.roomUnits.filter((unit) => (booking.hotelStay.roomUnitIds || []).includes(unit.id)).map((unit) => upsert('roomUnits', unit)));
  await Promise.all(releasedCommissions.map((commission) => upsert('commissions', commission)));
  return booking;
}


async function updateHousekeeping(companyId, unitId, payload = {}, actorId = 'company-admin') {
  ensureCollections();
  const unit = store.state.roomUnits.find((item) => item.id === unitId && item.companyId === companyId);
  if (!unit) { const error = new Error('Room unit not found'); error.status = 404; throw error; }
  const status = clean(payload.housekeepingStatus || unit.housekeepingStatus || 'clean');
  const roomStatus = clean(payload.status || unit.status || 'available');
  unit.housekeepingStatus = status;
  unit.status = roomStatus;
  unit.housekeepingTaskStatus = ['clean', 'inspected'].includes(status) ? 'closed' : clean(payload.taskStatus || unit.housekeepingTaskStatus || 'open');
  unit.housekeepingPriority = clean(payload.priority || unit.housekeepingPriority || 'normal');
  unit.housekeepingAssignedTo = clean(payload.assignedTo || unit.housekeepingAssignedTo || '');
  unit.housekeepingDueAt = payload.dueAt || unit.housekeepingDueAt || null;
  unit.notes = clean(payload.notes || unit.notes || '');
  unit.updatedBy = actorId;
  unit.updatedAt = new Date().toISOString();
  const activeNights = store.state.roomNightInventories.filter((night) => night.roomUnitId === unit.id && ['cleaning','maintenance','occupied','checked-out'].includes(clean(night.status)));
  if (status === 'clean' || status === 'inspected') {
    unit.status = roomStatus === 'maintenance' ? 'maintenance' : 'available';
    activeNights.filter((night) => ['cleaning','checked-out'].includes(clean(night.status))).forEach((night) => {
      night.status = 'available';
      night.housekeepingStatus = status;
      night.updatedAt = unit.updatedAt;
    });
  }
  if (status === 'cleaning') {
    unit.status = 'cleaning';
    activeNights.forEach((night) => { if (night.status !== 'maintenance') night.status = 'cleaning'; night.housekeepingStatus = status; night.updatedAt = unit.updatedAt; });
  }
  if (status === 'maintenance') {
    unit.status = 'maintenance';
    activeNights.forEach((night) => { night.status = 'maintenance'; night.housekeepingStatus = status; night.updatedAt = unit.updatedAt; });
  }
  await upsert('roomUnits', unit);
  await Promise.all(activeNights.map((night) => upsert('roomNightInventories', night)));
  store.state.auditLogs.unshift({ id: nextId('audit', store.state.auditLogs), actorId, action: 'hotel.housekeeping.updated', targetType: 'roomUnit', targetId: unit.id, createdAt: unit.updatedAt, meta: { housekeepingStatus: unit.housekeepingStatus, roomStatus: unit.status, taskStatus: unit.housekeepingTaskStatus } });
  return unit;
}

function toCsv(headers, rows) {
  const esc = (value) => { const text = String(value ?? ''); return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
  return [headers, ...rows.map((row) => row.filter((cell) => typeof cell !== 'object'))].map((row) => row.map(esc).join(',')).join('\n');
}
async function pdfBuffer(title, rows) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36, info: { Title: title } });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(16).text(title, { underline: true });
    doc.moveDown();
    rows.forEach((row) => doc.fontSize(9).text(row.filter((cell) => typeof cell !== 'object').join(' | ')));
    doc.end();
  });
}

module.exports = {
  createProperty,
  updateProperty,
  archiveProperty,
  createRoomType,
  updateRoomType,
  archiveRoomType,
  createRoomUnits,
  updateRoomUnit,
  archiveRoomUnit,
  createNightInventory,
  updateNightStatus,
  archiveNightInventory,
  createHotelBooking,
  roomMap,
  manifestRows,
  markStay,
  updateHousekeeping,
  toCsv,
  pdfBuffer,
};
