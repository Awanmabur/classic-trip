const crypto = require('crypto');
const commerceRepository = require('../../repositories/domain/commerceRepository');

function iso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function itemId(holdId, resourceKey) {
  const digest = crypto.createHash('sha256').update(`${holdId}:${resourceKey}`).digest('hex').slice(0, 24);
  return `hold-item-${digest}`;
}

function seatResourceKey(scheduleId, seatNumber) {
  return `schedule-seat:${String(scheduleId)}:${String(seatNumber).trim().toUpperCase()}`;
}

function roomNightResourceKey(roomUnitId, nightDate) {
  const date = new Date(nightDate);
  if (Number.isNaN(date.getTime())) throw Object.assign(new Error('A valid room night date is required'), { status: 422 });
  return `room-unit-night:${String(roomUnitId)}:${date.toISOString().slice(0, 10)}`;
}

async function activeResourceItem(resourceKey, now = new Date(), ignoredHoldId = '') {
  const row = await commerceRepository.holdItems.findOne({ resourceKey, status: 'active' });
  if (!row || row.holdId === ignoredHoldId || new Date(row.expiresAt || 0) <= now) return null;
  return row;
}

async function assertResourcesAvailable(items, ignoredHoldId = '') {
  const now = new Date();
  for (const item of items) {
    const existing = await commerceRepository.holdItems.findOne({
      resourceKey: item.resourceKey,
      status: 'active',
      holdId: { $ne: ignoredHoldId },
      expiresAt: { $gt: now },
    });
    if (existing) {
      const error = new Error('Inventory is temporarily held by another checkout');
      error.status = 409;
      error.resourceKey = item.resourceKey;
      throw error;
    }
  }
}

function seatItem(parent, scheduleId, seatNumber, context = {}) {
  const resourceKey = seatResourceKey(scheduleId, seatNumber);
  return {
    id: itemId(parent.id, resourceKey),
    holdId: parent.id,
    resourceType: 'schedule_seat',
    resourceKey,
    serviceType: parent.serviceType,
    companyId: parent.companyId,
    listingId: parent.listingId,
    scheduleId,
    seatNumber: String(seatNumber),
    selectedLabel: String(seatNumber),
    status: 'active',
    expiresAt: parent.expiresAt,
    metadata: context.meta || {},
    createdAt: parent.createdAt,
  };
}

function roomNightItem(parent, roomUnitId, roomTypeId, nightDate, context = {}) {
  const normalizedDate = new Date(nightDate).toISOString().slice(0, 10);
  const resourceKey = roomNightResourceKey(roomUnitId, normalizedDate);
  return {
    id: itemId(parent.id, resourceKey), holdId: parent.id, resourceType: 'room_unit_night', resourceKey,
    serviceType: parent.serviceType, companyId: parent.companyId, listingId: parent.listingId,
    roomTypeId, roomUnitId, nightDate: normalizedDate, selectedLabel: parent.selectedLabel || '',
    status: 'active', expiresAt: parent.expiresAt,
    metadata: { ...(context.meta || {}), roomTypeId, roomUnitId, nightDate: normalizedDate }, createdAt: parent.createdAt,
  };
}

async function persistParentAndItems(parent, items) {
  await assertResourcesAvailable(items, parent.id);
  parent.itemIds = items.map((item) => item.id);
  parent.itemCount = items.length;
  try {
    await commerceRepository.withTransaction(async (session) => {
      await commerceRepository.holds.save(parent, { id: parent.id }, { session });
      await commerceRepository.holdItems.saveMany(items, (item) => ({ id: item.id }), { session });
    });
  } catch (error) {
    if (error?.code === 11000) {
      const conflict = new Error('Inventory is temporarily held by another checkout');
      conflict.status = 409;
      conflict.cause = error;
      throw conflict;
    }
    throw error;
  }
  return { ...parent, items };
}

async function recordSeatHold(hold, context = {}) {
  const createdAt = hold.createdAt || new Date().toISOString();
  const parent = {
    id: hold.id,
    holdType: 'seat',
    type: 'seat',
    serviceType: context.serviceType || 'bus',
    listingId: context.listingId || '',
    companyId: context.companyId || '',
    scheduleId: hold.scheduleId,
    seatNumber: hold.seatNumber,
    selectedLabel: hold.seatNumber,
    token: hold.id,
    status: 'active',
    lockedUntil: iso(hold.lockedUntil),
    expiresAt: iso(hold.lockedUntil),
    createdBy: context.createdBy || context.userId || '',
    source: context.source || 'listing_hold',
    meta: context.meta || {},
    createdAt,
  };
  return persistParentAndItems(parent, [seatItem(parent, hold.scheduleId, hold.seatNumber, context)]);
}

async function recordGroupedSeatHold(hold, context = {}) {
  const seatNumbers = [...new Set([].concat(hold.seatNumbers || hold.seatNumber || []).map((seat) => String(seat).trim()).filter(Boolean))];
  if (!seatNumbers.length) throw Object.assign(new Error('At least one seat is required for a grouped hold'), { status: 422 });
  const createdAt = hold.createdAt || new Date().toISOString();
  const parent = {
    id: hold.id,
    holdType: 'seat',
    type: 'seats',
    serviceType: context.serviceType || 'bus',
    listingId: context.listingId || '',
    companyId: context.companyId || '',
    scheduleId: hold.scheduleId,
    seatNumber: seatNumbers[0],
    selectedLabel: seatNumbers.join(', '),
    token: hold.id,
    status: 'active',
    lockedUntil: iso(hold.lockedUntil),
    expiresAt: iso(hold.lockedUntil),
    createdBy: context.createdBy || context.userId || '',
    source: context.source || 'listing_hold',
    meta: { ...(context.meta || {}), seatNumbers, grouped: true },
    createdAt,
  };
  return persistParentAndItems(parent, seatNumbers.map((seatNumber) => seatItem(parent, hold.scheduleId, seatNumber, context)));
}

async function recordRoomHold(reservation, context = {}) {
  const roomUnitId = reservation.roomUnitId || context.roomUnitId;
  const roomTypeId = reservation.roomTypeId || context.roomTypeId || '';
  const nightDates = [...new Set([].concat(reservation.nightDates || context.nightDates || []).map((value) => new Date(value).toISOString().slice(0, 10)))];
  if (!roomUnitId || !nightDates.length) throw Object.assign(new Error('Room holds require a room unit and at least one night'), { status: 422 });
  const createdAt = reservation.createdAt || new Date().toISOString();
  const parent = {
    id: reservation.id, holdType: 'room', type: 'room_nights', serviceType: context.serviceType || 'hotel',
    listingId: context.listingId || '', companyId: context.companyId || '', roomTypeId, roomUnitIds: [roomUnitId],
    startDate: nightDates[0], endDate: nightDates[nightDates.length - 1], selectedLabel: context.selectedLabel || reservation.roomType || '',
    token: reservation.id, guest: reservation.guest || {}, status: 'active', lockedUntil: iso(reservation.expiresAt), expiresAt: iso(reservation.expiresAt),
    createdBy: context.createdBy || context.userId || '', source: context.source || 'listing_hold',
    meta: { ...(context.meta || {}), roomTypeId, roomUnitId, nightDates }, createdAt,
  };
  return persistParentAndItems(parent, nightDates.map((date) => roomNightItem(parent, roomUnitId, roomTypeId, date, context)));
}

async function updateHoldAndItems(holdId, update, context = {}) {
  const [hold, items] = await Promise.all([
    commerceRepository.holds.findOne({ id: holdId }),
    commerceRepository.holdItems.list({ holdId, ...(context.onlyActive === false ? {} : { status: 'active' }) }),
  ]);
  if (hold) Object.assign(hold, update);
  items.forEach((item) => {
    const itemBooking = context.itemBookings?.[item.resourceKey] || {};
    Object.assign(item, update, itemBooking);
  });


  await commerceRepository.withTransaction(async (session) => {
    if (hold) await commerceRepository.holds.save(hold, { id: hold.id }, { session });
    if (items.length) await commerceRepository.holdItems.saveMany(items, (item) => ({ id: item.id }), { session });
  });
  return hold || { id: holdId, ...update };
}

async function consumeHold(holdId, booking = {}, context = {}) {
  if (!holdId) return null;
  return updateHoldAndItems(holdId, {
    status: 'consumed',
    consumedAt: new Date().toISOString(),
    consumedBy: context.userId || booking.customerUserId || '',
    bookingId: booking.id || '',
    bookingRef: booking.bookingRef || booking.groupRef || '',
  }, context);
}

async function releaseHold(holdId, reason = 'released', context = {}) {
  if (!holdId) return null;
  return updateHoldAndItems(holdId, {
    status: 'released',
    releasedAt: new Date().toISOString(),
    releaseReason: reason,
  }, context);
}

async function expireActiveHolds(now = new Date()) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowIso = nowDate.toISOString();
  const [holds, items] = await Promise.all([
    commerceRepository.holds.list({ status: 'active', expiresAt: { $lte: nowDate } }),
    commerceRepository.holdItems.list({ status: 'active', expiresAt: { $lte: nowDate } }),
  ]);
  const update = { status: 'expired', releasedAt: nowIso, releaseReason: 'expired' };
  holds.forEach((hold) => Object.assign(hold, update));
  items.forEach((item) => Object.assign(item, update));
  await commerceRepository.withTransaction(async (session) => {
    if (holds.length) await commerceRepository.holds.saveMany(holds, (hold) => ({ id: hold.id }), { session });
    if (items.length) await commerceRepository.holdItems.saveMany(items, (item) => ({ id: item.id }), { session });
  });
  return new Set([...holds.map((hold) => hold.id), ...items.map((item) => item.holdId)]).size;
}

module.exports = {
  seatResourceKey,
  roomNightResourceKey,
  activeResourceItem,
  recordSeatHold,
  recordGroupedSeatHold,
  recordRoomHold,
  consumeHold,
  releaseHold,
  expireActiveHolds,
};
