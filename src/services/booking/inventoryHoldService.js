const store = require('../data/persistentStore');
const repositories = require('../../repositories');

function ensureHolds() {
  if (!Array.isArray(store.state.inventoryHolds)) store.state.inventoryHolds = [];
}

function upsertStateHold(hold) {
  ensureHolds();
  const index = store.state.inventoryHolds.findIndex((item) => item.id === hold.id);
  if (index >= 0) {
    store.state.inventoryHolds[index] = { ...store.state.inventoryHolds[index], ...hold };
    return store.state.inventoryHolds[index];
  }
  store.state.inventoryHolds.unshift(hold);
  return hold;
}

async function persistHold(hold) {
  await repositories.inventoryHolds.upsert(hold);
}

async function recordSeatHold(hold, context = {}) {
  const row = upsertStateHold({
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
    lockedUntil: hold.lockedUntil,
    expiresAt: hold.lockedUntil,
    createdBy: context.createdBy || context.userId || '',
    source: context.source || 'listing_hold',
    meta: context.meta || {},
    createdAt: hold.createdAt || new Date().toISOString(),
  });
  await persistHold(row);
  return row;
}


async function recordGroupedSeatHold(hold, context = {}) {
  const row = upsertStateHold({
    id: hold.id,
    holdType: 'seat',
    type: 'seats',
    serviceType: context.serviceType || 'bus',
    listingId: context.listingId || '',
    companyId: context.companyId || '',
    scheduleId: hold.scheduleId,
    seatNumber: (hold.seatNumbers || [])[0] || hold.seatNumber,
    selectedLabel: (hold.seatNumbers || []).join(', '),
    token: hold.id,
    status: 'active',
    lockedUntil: hold.lockedUntil,
    expiresAt: hold.lockedUntil,
    createdBy: context.createdBy || context.userId || '',
    source: context.source || 'listing_hold',
    meta: { ...(context.meta || {}), seatNumbers: hold.seatNumbers || [], grouped: true },
    createdAt: hold.createdAt || new Date().toISOString(),
  });
  await persistHold(row);
  return row;
}

async function recordRoomHold(reservation, context = {}) {
  const row = upsertStateHold({
    id: reservation.id,
    holdType: 'room',
    type: 'room',
    serviceType: context.serviceType || 'hotel',
    listingId: context.listingId || '',
    companyId: context.companyId || '',
    roomId: reservation.roomId,
    selectedLabel: context.selectedLabel || reservation.roomType || '',
    token: reservation.id,
    guest: reservation.guest || {},
    status: 'active',
    lockedUntil: reservation.expiresAt,
    expiresAt: reservation.expiresAt,
    createdBy: context.createdBy || context.userId || '',
    source: context.source || 'listing_hold',
    meta: context.meta || {},
    createdAt: reservation.createdAt || new Date().toISOString(),
  });
  await persistHold(row);
  return row;
}

async function consumeHold(holdId, booking = {}, context = {}) {
  if (!holdId) return null;
  ensureHolds();
  const hold = store.state.inventoryHolds.find((item) => item.id === holdId);
  const consumedAt = new Date().toISOString();
  const update = {
    status: 'consumed',
    consumedAt,
    consumedBy: context.userId || booking.customerUserId || '',
    bookingId: booking.id || '',
    bookingRef: booking.bookingRef || '',
  };
  if (hold) Object.assign(hold, update);
  await repositories.inventoryHolds.updateOne({ id: holdId }, { $set: update });
  return hold || { id: holdId, ...update };
}

async function releaseHold(holdId, reason = 'released') {
  if (!holdId) return null;
  ensureHolds();
  const hold = store.state.inventoryHolds.find((item) => item.id === holdId);
  const update = { status: 'released', releasedAt: new Date().toISOString(), releaseReason: reason };
  if (hold) Object.assign(hold, update);
  await repositories.inventoryHolds.updateOne({ id: holdId }, { $set: update });
  return hold || { id: holdId, ...update };
}

async function expireActiveHolds(now = new Date()) {
  ensureHolds();
  const nowDate = now instanceof Date ? now : new Date(now);
  let expired = 0;
  store.state.inventoryHolds.forEach((hold) => {
    if (hold.status === 'active' && hold.expiresAt && new Date(hold.expiresAt) <= nowDate) {
      hold.status = 'expired';
      hold.releasedAt = nowDate.toISOString();
      hold.releaseReason = 'expired';
      expired += 1;
    }
  });
  if (repositories.mongoReady()) {
    const result = await repositories.inventoryHolds.updateMany(
      { status: 'active', expiresAt: { $lte: nowDate } },
      { $set: { status: 'expired', releasedAt: nowDate, releaseReason: 'expired' } }
    );
    expired = Math.max(expired, result.modifiedCount || 0);
  }
  return expired;
}

module.exports = {
  recordSeatHold,
  recordGroupedSeatHold,
  recordRoomHold,
  consumeHold,
  releaseHold,
  expireActiveHolds,
};
