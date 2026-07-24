const hotelRepository = require('../../repositories/domain/hotelRepository');
const { sessionOptions } = require('../shared/mongoUnitOfWork');

const OPEN_NIGHT_STATUSES = new Set(['available', 'open']);
const ACTIVE_UNIT_STATUSES = new Set(['available']);
const READY_HOUSEKEEPING_STATUSES = new Set(['clean', 'inspected', 'ready']);

function clean(value) { return String(value || '').trim(); }
function dateOnly(value, label = 'date') {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw Object.assign(new Error(`A valid ${label} is required`), { status: 422 });
  return parsed.toISOString().slice(0, 10);
}
function dateRange(checkInValue, checkOutValue) {
  const checkIn = dateOnly(checkInValue, 'check-in date');
  const checkOut = dateOnly(checkOutValue, 'check-out date');
  const start = new Date(`${checkIn}T00:00:00.000Z`);
  const end = new Date(`${checkOut}T00:00:00.000Z`);
  if (!(end > start)) throw Object.assign(new Error('Check-out must be after check-in'), { status: 422 });
  const nights = [];
  for (let cursor = new Date(start); cursor < end; cursor.setUTCDate(cursor.getUTCDate() + 1)) nights.push(cursor.toISOString().slice(0, 10));
  return { checkIn, checkOut, nights };
}
function nightResourceKey(roomUnitId, date) { return `room-unit-night:${clean(roomUnitId)}:${dateOnly(date, 'night date')}`; }
function nightIsOpen(row = {}) {
  return OPEN_NIGHT_STATUSES.has(clean(row.status || 'available').toLowerCase())
    && Number(row.availableInventory ?? 1) > 0
    && !clean(row.bookingRef);
}
function unitIsReady(unit = {}) {
  return ACTIVE_UNIT_STATUSES.has(clean(unit.status).toLowerCase())
    && READY_HOUSEKEEPING_STATUSES.has(clean(unit.housekeepingStatus || 'clean').toLowerCase());
}

async function resolveRoomTypeAndUnit({ listingId, companyId = '', roomTypeId = '', roomUnitId = '', selectionId = '' } = {}, options = {}) {
  const selected = clean(selectionId);
  let unit = null;
  let roomType = null;
  const unitKey = clean(roomUnitId) || selected;
  if (unitKey) unit = await hotelRepository.roomUnits.findOne({ id: unitKey, ...(listingId ? { listingId } : {}), ...(companyId ? { companyId } : {}), status: { $ne: 'archived' } }, options);
  const typeKey = clean(roomTypeId) || (!unit ? selected : unit.roomTypeId);
  if (typeKey) roomType = await hotelRepository.roomTypes.findOne({ id: typeKey, ...(listingId ? { listingId } : {}), ...(companyId ? { companyId } : {}), status: 'active' }, options);
  if (!roomType && unit?.roomTypeId) roomType = await hotelRepository.roomTypes.findOne({ id: unit.roomTypeId, status: 'active' }, options);
  if (!roomType) throw Object.assign(new Error('Room type not found or unavailable'), { status: 404 });
  if (unit && unit.roomTypeId !== roomType.id) throw Object.assign(new Error('Room unit does not belong to the selected room type'), { status: 422 });
  return { roomType, unit };
}

async function activeHeldKeys(resourceKeys, holdId = '', now = new Date(), options = {}) {
  if (!resourceKeys.length) return new Set();
  const rows = await hotelRepository.inventoryHoldItems.list({
    resourceType: 'room_unit_night',
    resourceKey: { $in: resourceKeys },
    status: 'active',
    expiresAt: { $gt: now },
    ...(holdId ? { holdId: { $ne: holdId } } : {}),
  }, options);
  return new Set(rows.map((row) => row.resourceKey));
}

async function selectAvailableRoom({ listingId, companyId = '', roomTypeId = '', roomUnitId = '', selectionId = '', checkIn, checkOut, holdId = '' } = {}, options = {}) {
  const range = dateRange(checkIn, checkOut);
  const resolved = await resolveRoomTypeAndUnit({ listingId, companyId, roomTypeId, roomUnitId, selectionId }, options);
  const unitFilter = resolved.unit
    ? { id: resolved.unit.id }
    : { roomTypeId: resolved.roomType.id, status: { $in: [...ACTIVE_UNIT_STATUSES] } };
  const units = resolved.unit ? [resolved.unit] : await hotelRepository.roomUnits.list(unitFilter, { ...options, sort: { unitNumber: 1 }, limit: 500 });
  for (const unit of units) {
    if (!unitIsReady(unit)) continue;
    const rows = await hotelRepository.roomNightInventories.list({
      companyId: resolved.roomType.companyId,
      listingId: resolved.roomType.listingId,
      roomTypeId: resolved.roomType.id,
      roomUnitId: unit.id,
      date: { $in: range.nights },
    }, options);
    const byDate = new Map(rows.map((row) => [row.date, row]));
    const orderedRows = range.nights.map((date) => byDate.get(date)).filter(Boolean);
    if (orderedRows.length !== range.nights.length || !orderedRows.every(nightIsOpen)) continue;
    const keys = orderedRows.map((row) => nightResourceKey(unit.id, row.date));
    if ((await activeHeldKeys(keys, holdId, new Date(), options)).size) continue;
    return {
      roomType: resolved.roomType,
      roomUnit: unit,
      nightRows: orderedRows,
      ...range,
      nightlyTotal: orderedRows.reduce((sum, row) => sum + Number(row.price ?? resolved.roomType.basePrice ?? 0), 0),
    };
  }
  throw Object.assign(new Error('No room unit is available for the selected dates'), { status: 409, code: 'ROOM_UNIT_UNAVAILABLE' });
}

async function claimSelectedRoom(booking, payload = {}, session = null) {
  const item = booking.bookingItems?.[0] || {};
  const selection = await selectAvailableRoom({
    listingId: booking.listingId,
    companyId: booking.companyId,
    roomTypeId: payload.roomTypeId || item.roomTypeId || booking.hotelStay?.roomTypeIds?.[0],
    roomUnitId: payload.roomUnitId || item.roomUnitId || booking.hotelStay?.roomUnitIds?.[0],
    selectionId: payload.roomTypeId || payload.roomUnitId,
    checkIn: payload.checkInDate || payload.checkIn || booking.hotelStay?.checkIn || item.checkIn,
    checkOut: payload.checkOutDate || payload.checkOut || booking.hotelStay?.checkOut || item.checkOut,
    holdId: payload.holdId || booking.holdId || '',
  }, { session });

  const updates = {
    status: 'booked', availableInventory: 0, bookingRef: booking.bookingRef,
    guestName: booking.guestSnapshot?.fullName || 'Guest', checkInStatus: 'not_checked',
    holdId: payload.holdId || '', notes: booking.notes || '', updatedAt: new Date().toISOString(),
  };
  const RoomNightInventory = require('../../models/RoomNightInventory');
  for (const row of selection.nightRows) {
    const updated = await RoomNightInventory.findOneAndUpdate(
      { id: row.id, roomUnitId: selection.roomUnit.id, status: { $in: [...OPEN_NIGHT_STATUSES] }, availableInventory: { $gt: 0 }, $or: [{ bookingRef: '' }, { bookingRef: { $exists: false } }, { bookingRef: null }] },
      { $set: updates },
      sessionOptions(session, { new: true, runValidators: true }),
    ).lean();
    if (!updated) throw Object.assign(new Error('Selected room nights are no longer available'), { status: 409, code: 'ROOM_NIGHT_CLAIM_FAILED' });
  }

  const nightIds = selection.nightRows.map((row) => row.id);
  booking.hotelStay = {
    ...(booking.hotelStay || {}), checkIn: selection.checkIn, checkOut: selection.checkOut,
    nights: selection.nights, roomCount: 1, roomUnitIds: [selection.roomUnit.id], roomTypeIds: [selection.roomType.id], nightIds, status: 'booked',
  };
  booking.bookingItems = (booking.bookingItems?.length ? booking.bookingItems : [{ id: `${booking.bookingRef}-hotel-room-1`, serviceType: 'hotel' }]).map((row, index) => index === 0 ? {
    ...row, serviceType: 'hotel', roomTypeId: selection.roomType.id, roomUnitId: selection.roomUnit.id,
    roomType: selection.roomType.name, checkIn: selection.checkIn, checkOut: selection.checkOut,
    nights: selection.nights, nightIds, unitPrice: Number(selection.roomType.basePrice || 0), status: 'confirmed',
  } : row);
  return selection;
}

async function releaseBookedNights(bookingRef, options = {}) {
  const rows = await hotelRepository.roomNightInventories.list({ bookingRef }, options);
  for (const row of rows) {
    Object.assign(row, { status: 'available', availableInventory: 1, bookingRef: '', guestName: '', checkInStatus: '', holdId: '', updatedAt: new Date().toISOString() });
    await hotelRepository.roomNightInventories.save(row, { id: row.id }, options);
  }
  return rows;
}

async function releaseExpiredPendingBookings(now = new Date(), options = {}) {
  const cutoff = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(cutoff.getTime())) throw Object.assign(new Error('A valid expiry time is required'), { status: 422 });
  const cutoffIso = cutoff.toISOString();
  const candidates = await hotelRepository.bookings.list({
    serviceType: 'hotel',
    paymentStatus: { $in: ['pending', 'created', 'processing'] },
    bookingStatus: 'pending_payment',
    lockedUntil: { $lte: cutoffIso },
  }, { ...options, limit: 500 });
  let released = 0;
  for (const booking of candidates) {
    const result = await hotelRepository.transaction(async (session) => {
      const currentItems = (booking.bookingItems || []).map((item) => ({ ...item, status: 'expired' }));
      const currentLegs = (booking.ticketLegs || []).map((leg) => ({ ...leg, status: 'expired', expiredAt: cutoffIso }));
      const bookingUpdate = await hotelRepository.bookings.updateOne({
        id: booking.id,
        bookingRef: booking.bookingRef,
        serviceType: 'hotel',
        paymentStatus: { $in: ['pending', 'created', 'processing'] },
        bookingStatus: 'pending_payment',
        lockedUntil: { $lte: cutoffIso },
      }, {
        $set: {
          paymentStatus: 'expired',
          bookingStatus: 'voided',
          'hotelStay.status': 'expired',
          bookingItems: currentItems,
          ticketLegs: currentLegs,
          lockedUntil: null,
          expiredAt: cutoffIso,
          updatedAt: cutoffIso,
        },
      }, { session });
      const matched = Number(bookingUpdate?.matchedCount ?? bookingUpdate?.n ?? 0);
      if (!matched) return false;
      const lifecycle = await hotelRepository.applyPaymentLifecycle({
        bookingRef: booking.bookingRef,
        companyId: booking.companyId || '',
        paymentStatus: 'expired',
        reason: 'Hotel payment window expired',
        session,
      });
      // Legacy bookings created before normalized HotelReservation records are
      // still released safely during migration, but all new bookings use the
      // canonical lifecycle above.
      if (!lifecycle?.reservation) {
        await hotelRepository.roomNightInventories.updateMany({
          bookingRef: booking.bookingRef,
          status: { $in: ['reserved', 'held'] },
        }, {
          $set: {
            status: 'available',
            availableInventory: 1,
            bookingRef: '',
            reservationId: '',
            assignmentId: '',
            guestName: '',
            checkInStatus: '',
            updatedAt: cutoffIso,
          },
          $unset: { holdId: '' },
        }, { session });
      }
      await hotelRepository.paymentIntents.updateMany({
        bookingRef: booking.bookingRef,
        status: { $in: ['created', 'pending', 'processing'] },
      }, { $set: { status: 'expired', expiredAt: cutoffIso, updatedAt: cutoffIso } }, { session });
      await hotelRepository.payments.updateMany({
        bookingRef: booking.bookingRef,
        status: { $in: ['created', 'pending', 'processing'] },
      }, { $set: { status: 'expired', expiredAt: cutoffIso, updatedAt: cutoffIso } }, { session });
      return true;
    });
    if (result) released += 1;
  }
  return { released, scanned: candidates.length };
}


async function availabilityForRange(listingId, checkIn, checkOut, options = {}) {
  const range = dateRange(checkIn, checkOut);
  const [types, units, nights] = await Promise.all([
    hotelRepository.roomTypes.list({ listingId, status: 'active' }, options),
    hotelRepository.roomUnits.list({ listingId, status: { $in: [...ACTIVE_UNIT_STATUSES] } }, options),
    hotelRepository.roomNightInventories.list({ listingId, date: { $in: range.nights } }, options),
  ]);
  const rowsByUnit = new Map();
  nights.forEach((row) => {
    if (!rowsByUnit.has(row.roomUnitId)) rowsByUnit.set(row.roomUnitId, []);
    rowsByUnit.get(row.roomUnitId).push(row);
  });
  const resourceKeys = nights.map((row) => nightResourceKey(row.roomUnitId, row.date));
  const blockedKeys = await activeHeldKeys(resourceKeys, '', new Date(), options);
  const unitsByType = new Map();
  units.forEach((unit) => {
    if (!unitsByType.has(unit.roomTypeId)) unitsByType.set(unit.roomTypeId, []);
    unitsByType.get(unit.roomTypeId).push(unit);
  });
  const rooms = types.map((roomType) => {
    const candidates = (unitsByType.get(roomType.id) || []).map((unit) => {
      const rows = (rowsByUnit.get(unit.id) || []).sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const complete = rows.length === range.nights.length && range.nights.every((date) => rows.some((row) => row.date === date));
      const available = unitIsReady(unit) && complete && rows.every((row) => nightIsOpen(row) && !blockedKeys.has(nightResourceKey(unit.id, row.date)));
      return { unit, rows, available, stayPrice: rows.reduce((sum, row) => sum + Number(row.price ?? roomType.basePrice ?? 0), 0) };
    });
    const available = candidates.filter((candidate) => candidate.available);
    return {
      id: roomType.id,
      roomTypeId: roomType.id,
      roomType: roomType.name,
      nightlyPrice: Number(roomType.basePrice || 0),
      stayPrice: available.length ? Math.min(...available.map((candidate) => candidate.stayPrice)) : Number(roomType.basePrice || 0) * range.nights.length,
      inventory: available.length,
      availableUnits: available.length,
      capacity: Number(roomType.capacity || 1),
      bedType: roomType.bedType || '',
      amenities: roomType.amenities || [],
    };
  });
  return { ...range, rooms };
}
async function inventorySummary(listingId, options = {}) {
  const [types, units] = await Promise.all([
    hotelRepository.roomTypes.list({ listingId, status: 'active' }, options),
    hotelRepository.roomUnits.list({ listingId, status: { $in: [...ACTIVE_UNIT_STATUSES] } }, options),
  ]);
  const unitsByType = new Map();
  units.filter(unitIsReady).forEach((unit) => unitsByType.set(unit.roomTypeId, (unitsByType.get(unit.roomTypeId) || 0) + 1));
  return types.map((roomType) => ({
    ...roomType,
    roomType: roomType.name,
    nightlyPrice: Number(roomType.basePrice || 0),
    inventory: unitsByType.get(roomType.id) || 0,
    availableUnits: unitsByType.get(roomType.id) || 0,
  }));
}

module.exports = {
  OPEN_NIGHT_STATUSES, ACTIVE_UNIT_STATUSES, READY_HOUSEKEEPING_STATUSES, dateRange, nightResourceKey, nightIsOpen, unitIsReady,
  resolveRoomTypeAndUnit, selectAvailableRoom, claimSelectedRoom,
  releaseBookedNights, releaseExpiredPendingBookings, availabilityForRange, inventorySummary,
};
