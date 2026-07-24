'use strict';

require('dotenv').config();
const crypto = require('crypto');
const { connectDb, mongoose } = require('../src/config/db');
const { runMongoUnitOfWork } = require('../src/services/shared/mongoUnitOfWork');

const Booking = require('../src/models/Booking');
const BookingItem = require('../src/models/BookingItem');
const HotelReservation = require('../src/models/HotelReservation');
const HotelGuest = require('../src/models/HotelGuest');
const RoomAssignment = require('../src/models/RoomAssignment');
const RoomNightInventory = require('../src/models/RoomNightInventory');
const RoomUnit = require('../src/models/RoomUnit');
const RoomType = require('../src/models/RoomType');
const HotelProperty = require('../src/models/HotelProperty');
const RatePlan = require('../src/models/RatePlan');
const HousekeepingTask = require('../src/models/HousekeepingTask');
const MaintenanceBlock = require('../src/models/MaintenanceBlock');
const Listing = require('../src/models/Listing');
const hotelService = require('../src/services/hotel/hotelService');

const apply = process.argv.includes('--apply');
const limitArg = process.argv.find((value) => value.startsWith('--limit='));
const limit = limitArg ? Math.max(1, Number(limitArg.split('=')[1]) || 1000) : 1000;

function text(value) { return String(value || '').trim(); }
function deterministicId(prefix, ...parts) {
  const digest = crypto.createHash('sha256').update(parts.map(text).join('|')).digest('hex').slice(0, 20);
  return `${prefix}-${digest}`;
}
function reservationStatus(booking = {}) {
  const value = text(booking.hotelStay?.status || booking.bookingStatus).toLowerCase();
  const aliases = { booked: 'confirmed', in_house: 'checked_in', occupied: 'checked_in', pending_payment: 'awaiting_payment', voided: 'cancelled' };
  const normalized = aliases[value] || value;
  return ['awaiting_payment', 'confirmed', 'checked_in', 'checked_out', 'completed', 'cancelled', 'no_show', 'refunded', 'expired', 'failed'].includes(normalized)
    ? normalized
    : (text(booking.paymentStatus).toLowerCase() === 'successful' ? 'confirmed' : 'awaiting_payment');
}
function assignmentStatus(status) {
  return ({ awaiting_payment: 'awaiting_payment', confirmed: 'assigned', checked_in: 'occupied', checked_out: 'checked_out', completed: 'completed', cancelled: 'cancelled', refunded: 'refunded', expired: 'expired', failed: 'expired', no_show: 'cancelled' })[status] || 'awaiting_payment';
}
function itemStatus(status) {
  return ({ awaiting_payment: 'awaiting_payment', confirmed: 'confirmed', checked_in: 'in_progress', checked_out: 'completed', completed: 'completed', cancelled: 'cancelled', refunded: 'refunded', expired: 'expired', failed: 'failed', no_show: 'cancelled' })[status] || 'awaiting_payment';
}
function settlementStatus(booking = {}, status = '') {
  const existing = text(booking.settlementStatus);
  if (['pending_payment', 'pending_fulfillment', 'eligible', 'settled', 'reconciliation_required', 'refunded'].includes(existing)) return existing;
  if (status === 'refunded') return 'refunded';
  return text(booking.paymentStatus).toLowerCase() === 'successful' ? 'pending_fulfillment' : 'pending_payment';
}
function guestRows(booking = {}) {
  const passengers = Array.isArray(booking.passengers) && booking.passengers.length ? booking.passengers : [booking.guestSnapshot || {}];
  return passengers.filter(Boolean).map((guest, index) => ({
    fullName: text(guest.fullName || guest.name || (index === 0 ? booking.guestSnapshot?.fullName : '')) || `Guest ${index + 1}`,
    email: text(guest.email || (index === 0 ? booking.guestSnapshot?.email : '')).toLowerCase(),
    phone: text(guest.phone || (index === 0 ? booking.guestSnapshot?.phone : '')),
    identityType: text(guest.identityType),
    identityNumber: text(guest.identityNumber),
    nationality: text(guest.nationality),
    dateOfBirth: guest.dateOfBirth || null,
    sex: text(guest.sex),
    emergencyContactName: text(guest.emergencyContactName),
    emergencyContactPhone: text(guest.emergencyContactPhone),
    specialRequests: text(guest.specialRequests || guest.specialNotes),
    guestType: ['adult', 'child', 'infant'].includes(text(guest.guestType).toLowerCase()) ? text(guest.guestType).toLowerCase() : 'adult',
    roomIndex: Math.max(0, Number(guest.roomIndex || 0)),
  }));
}

async function planBooking(booking) {
  const existing = await HotelReservation.findOne({ bookingRef: booking.bookingRef }).lean();
  if (existing) return { action: 'skip', reason: 'already_normalized' };
  const stay = booking.hotelStay || {};
  const checkIn = text(stay.checkIn || stay.checkInDate);
  const checkOut = text(stay.checkOut || stay.checkOutDate);
  if (!checkIn || !checkOut || !booking.companyId || !booking.listingId) return { action: 'skip', reason: 'missing_booking_scope_or_dates' };

  const nights = await RoomNightInventory.find({ bookingRef: booking.bookingRef }).sort({ roomUnitId: 1, date: 1 }).lean();
  const requestedUnitIds = [...new Set([...(stay.roomUnitIds || []), ...nights.map((row) => row.roomUnitId)].map(text).filter(Boolean))];
  const units = requestedUnitIds.length ? await RoomUnit.find({ companyId: booking.companyId, id: { $in: requestedUnitIds } }).lean() : [];
  if (!units.length) return { action: 'skip', reason: 'no_room_units' };
  const unitById = new Map(units.map((row) => [text(row.id), row]));
  const roomTypeIds = [...new Set(units.map((row) => text(row.roomTypeId)).filter(Boolean))];
  const roomTypes = await RoomType.find({ companyId: booking.companyId, id: { $in: roomTypeIds } }).lean();
  const roomTypeById = new Map(roomTypes.map((row) => [text(row.id), row]));
  const propertyId = text(stay.propertyId || nights[0]?.propertyId || units[0]?.propertyId);
  const property = propertyId
    ? await HotelProperty.findOne({ companyId: booking.companyId, id: propertyId }).lean()
    : await HotelProperty.findOne({ companyId: booking.companyId, listingId: booking.listingId }).lean();
  if (!property) return { action: 'skip', reason: 'no_property' };

  const status = reservationStatus(booking);
  const reservationId = deterministicId('hotel-reservation', booking.bookingRef);
  const groups = units.map((unit, roomIndex) => {
    const unitNights = nights.filter((night) => text(night.roomUnitId) === text(unit.id));
    const roomType = roomTypeById.get(text(unit.roomTypeId)) || {};
    const bookingItemId = deterministicId('booking-item', booking.bookingRef, unit.id);
    const assignmentId = deterministicId('room-assignment', booking.bookingRef, unit.id);
    const embedded = (booking.bookingItems || [])[roomIndex] || {};
    const subtotal = Number(embedded.price || unitNights.reduce((sum, night) => sum + Number(night.price || 0), 0) || 0);
    return {
      roomIndex,
      unit,
      roomType,
      unitNights,
      bookingItem: {
        id: bookingItemId,
        bookingId: booking.id,
        bookingRef: booking.bookingRef,
        companyId: booking.companyId,
        listingId: booking.listingId,
        serviceType: 'hotel',
        domainReservationId: reservationId,
        quantity: 1,
        pricing: { subtotal, fees: 0, addonTotal: 0, total: subtotal, currency: booking.pricing?.currency || 'UGX' },
        priceSnapshot: { roomTypeId: roomType.id, roomTypeName: roomType.name, roomUnitId: unit.id, roomNumber: unit.unitNumber, nightIds: unitNights.map((night) => night.id), nightlyPrices: unitNights.map((night) => ({ date: night.date, price: Number(night.price || 0), ratePlanId: night.ratePlanId || '' })) },
        policySnapshot: {},
        status: itemStatus(status),
      },
      assignment: {
        id: assignmentId,
        reservationId,
        bookingItemId,
        bookingId: booking.id,
        bookingRef: booking.bookingRef,
        companyId: booking.companyId,
        listingId: booking.listingId,
        propertyId: property.id,
        roomTypeId: roomType.id,
        roomUnitId: unit.id,
        roomNumberSnapshot: unit.unitNumber,
        roomTypeSnapshot: roomType.name,
        ratePlanId: text(stay.ratePlanId || roomType.defaultRatePlanId || unitNights[0]?.ratePlanId),
        ratePlanSnapshot: {},
        checkInDate: checkIn,
        checkOutDate: checkOut,
        nightIds: unitNights.map((night) => night.id),
        guestIds: [],
        pricing: { subtotal, fees: 0, addonTotal: 0, total: subtotal, currency: booking.pricing?.currency || 'UGX' },
        status: assignmentStatus(status),
        assignedAt: ['assigned', 'occupied', 'checked_out', 'completed'].includes(assignmentStatus(status)) ? new Date(booking.createdAt || Date.now()) : null,
      },
    };
  });

  const guests = guestRows(booking).map((guest, index) => {
    const roomIndex = Math.min(groups.length - 1, Math.max(0, Number(guest.roomIndex || (index < groups.length ? index : index % groups.length))));
    const id = deterministicId('hotel-guest', booking.bookingRef, index);
    groups[roomIndex].assignment.guestIds.push(id);
    return {
      id,
      reservationId,
      bookingId: booking.id,
      bookingRef: booking.bookingRef,
      companyId: booking.companyId,
      listingId: booking.listingId,
      roomAssignmentId: groups[roomIndex].assignment.id,
      roomIndex,
      guestType: guest.guestType,
      guestIndex: index,
      isLeadGuest: index === 0,
      fullName: guest.fullName,
      email: guest.email,
      phone: guest.phone,
      identityType: guest.identityType,
      identityNumber: guest.identityNumber,
      nationality: guest.nationality,
      dateOfBirth: guest.dateOfBirth,
      sex: guest.sex,
      emergencyContactName: guest.emergencyContactName,
      emergencyContactPhone: guest.emergencyContactPhone,
      specialRequests: guest.specialRequests,
      checkInStatus: status === 'checked_in' ? 'checked_in' : status === 'checked_out' || status === 'completed' ? 'checked_out' : status === 'no_show' ? 'no_show' : 'not_checked',
      checkedInAt: booking.checkedInAt || null,
      checkedOutAt: booking.checkOutAt || booking.completedAt || null,
    };
  });

  const reservation = {
    id: reservationId,
    bookingId: booking.id,
    bookingRef: booking.bookingRef,
    bookingItemIds: groups.map((row) => row.bookingItem.id),
    companyId: booking.companyId,
    listingId: booking.listingId,
    propertyId: property.id,
    customerUserId: booking.customerUserId || null,
    leadGuestId: guests[0]?.id || '',
    checkInDate: checkIn,
    checkOutDate: checkOut,
    actualCheckInAt: booking.checkedInAt || null,
    actualCheckOutAt: booking.checkOutAt || booking.completedAt || null,
    roomCount: Math.max(1, Number(stay.roomCount || groups.length)),
    adults: Math.max(1, Number(stay.adults || guests.filter((guest) => guest.guestType === 'adult').length || 1)),
    children: Math.max(0, Number(stay.children || guests.filter((guest) => guest.guestType === 'child').length || 0)),
    infants: Math.max(0, Number(stay.infants || guests.filter((guest) => guest.guestType === 'infant').length || 0)),
    status,
    paymentStatus: ['pending', 'successful', 'failed', 'expired', 'refunded'].includes(text(booking.paymentStatus)) ? text(booking.paymentStatus) : 'pending',
    settlementStatus: settlementStatus(booking, status),
    refundStatus: booking.refundStatus || 'none',
    refundedAmount: Number(booking.refundedAmount || 0),
    refundIds: booking.refundIds || [],
    pricing: booking.pricing || { subtotal: 0, fees: 0, addonTotal: 0, total: 0, currency: 'UGX' },
    priceSnapshot: { migratedFromLegacyBooking: true },
    policySnapshot: {},
    estimatedArrivalTime: text(stay.estimatedArrivalTime),
    arrivalNotes: text(stay.arrivalNotes),
    departureNotes: text(stay.departureNotes),
    specialRequests: text(stay.specialRequests),
    source: ['web', 'mobile', 'company_manual', 'agent_offline', 'admin_manual'].includes(text(booking.bookingChannel)) ? text(booking.bookingChannel) : 'web',
    checkedInBy: booking.checkedInBy || '',
    checkedOutBy: booking.completedBy || '',
    cancelledAt: booking.cancelledAt || null,
    cancellationReason: text(booking.cancellationReason || booking.cancelReason),
  };
  return { action: 'create', reservation, groups, guests, nights };
}

async function applyPlan(plan) {
  await runMongoUnitOfWork(async (session) => {
    const options = { upsert: true, runValidators: true, ...(session ? { session } : {}) };
    await HotelReservation.updateOne({ bookingRef: plan.reservation.bookingRef }, { $setOnInsert: plan.reservation }, options);
    for (const row of plan.groups) {
      await BookingItem.updateOne({ id: row.bookingItem.id }, { $setOnInsert: row.bookingItem }, options);
      await RoomAssignment.updateOne({ id: row.assignment.id }, { $setOnInsert: row.assignment }, options);
      if (row.unitNights.length) {
        await RoomNightInventory.updateMany({ id: { $in: row.unitNights.map((night) => night.id) }, bookingRef: plan.reservation.bookingRef }, { $set: { reservationId: plan.reservation.id, assignmentId: row.assignment.id } }, session ? { session } : {});
      }
    }
    for (const guest of plan.guests) await HotelGuest.updateOne({ id: guest.id }, { $setOnInsert: guest }, options);
  });
}



function canonicalPropertyOrder(left = {}, right = {}) {
  const statusRank = { active: 0, paused: 1, archived: 2 };
  const statusDiff = (statusRank[text(left.status)] ?? 9) - (statusRank[text(right.status)] ?? 9);
  if (statusDiff) return statusDiff;
  const leftDate = new Date(left.createdAt || 0).getTime();
  const rightDate = new Date(right.createdAt || 0).getTime();
  if (leftDate !== rightDate) return leftDate - rightDate;
  return text(left.id).localeCompare(text(right.id));
}

function migratedLabel(value, id) {
  return `${text(value) || 'Migrated'} (migrated ${text(id).slice(-6) || 'record'})`;
}

async function consolidateDuplicateProperties(summary) {
  const groups = await HotelProperty.aggregate([
    { $group: { _id: { companyId: '$companyId', listingId: '$listingId' }, count: { $sum: 1 }, ids: { $push: '$id' } } },
    { $match: { count: { $gt: 1 } } },
  ]);
  summary.duplicatePropertyGroups = groups.length;
  summary.duplicatePropertiesToRemove = 0;
  summary.roomTypesToRename = 0;
  summary.roomUnitsToRename = 0;
  summary.duplicatePropertyGroupsProcessed = 0;

  for (const group of groups) {
    const companyId = text(group._id?.companyId);
    const listingId = text(group._id?.listingId);
    const properties = await HotelProperty.find({ companyId, listingId }).sort({ createdAt: 1, id: 1 }).lean();
    if (properties.length < 2) continue;
    properties.sort(canonicalPropertyOrder);
    const canonical = properties[0];
    const duplicates = properties.slice(1);
    summary.duplicatePropertiesToRemove += duplicates.length;

    const existingRoomTypeNames = new Set((await RoomType.find({ companyId, propertyId: canonical.id }).select({ normalizedName: 1 }).lean()).map((row) => text(row.normalizedName).toLowerCase()));
    const existingUnitNumbers = new Set((await RoomUnit.find({ companyId, propertyId: canonical.id }).select({ normalizedUnitNumber: 1 }).lean()).map((row) => text(row.normalizedUnitNumber).toLowerCase()));
    const plans = [];

    for (const duplicate of duplicates) {
      const roomTypes = await RoomType.find({ companyId, propertyId: duplicate.id }).sort({ createdAt: 1, id: 1 }).lean();
      const roomUnits = await RoomUnit.find({ companyId, propertyId: duplicate.id }).sort({ createdAt: 1, id: 1 }).lean();
      const roomTypeUpdates = [];
      const roomUnitUpdates = [];

      for (const roomType of roomTypes) {
        let normalizedName = text(roomType.normalizedName).toLowerCase();
        let name = roomType.name;
        if (!normalizedName || existingRoomTypeNames.has(normalizedName)) {
          name = migratedLabel(roomType.name, roomType.id);
          normalizedName = `${text(roomType.normalizedName || roomType.name).toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'room-type'}-migrated-${text(roomType.id).slice(-8).toLowerCase()}`;
          summary.roomTypesToRename += 1;
        }
        existingRoomTypeNames.add(normalizedName);
        roomTypeUpdates.push({ id: roomType.id, name, normalizedName });
      }

      for (const roomUnit of roomUnits) {
        let normalizedUnitNumber = text(roomUnit.normalizedUnitNumber).toLowerCase();
        let unitNumber = roomUnit.unitNumber;
        if (!normalizedUnitNumber || existingUnitNumbers.has(normalizedUnitNumber)) {
          unitNumber = migratedLabel(roomUnit.unitNumber, roomUnit.id);
          normalizedUnitNumber = `${text(roomUnit.normalizedUnitNumber || roomUnit.unitNumber).toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'room'}-migrated-${text(roomUnit.id).slice(-8).toLowerCase()}`;
          summary.roomUnitsToRename += 1;
        }
        existingUnitNumbers.add(normalizedUnitNumber);
        roomUnitUpdates.push({ id: roomUnit.id, unitNumber, normalizedUnitNumber });
      }
      plans.push({ duplicate, roomTypeUpdates, roomUnitUpdates });
    }

    if (apply) {
      await runMongoUnitOfWork(async (session) => {
        const opts = session ? { session } : {};
        for (const plan of plans) {
          for (const row of plan.roomTypeUpdates) {
            await RoomType.updateOne({ companyId, id: row.id }, { $set: { propertyId: canonical.id, name: row.name, normalizedName: row.normalizedName, updatedAt: new Date() } }, opts);
          }
          for (const row of plan.roomUnitUpdates) {
            await RoomUnit.updateOne({ companyId, id: row.id }, { $set: { propertyId: canonical.id, unitNumber: row.unitNumber, normalizedUnitNumber: row.normalizedUnitNumber, updatedAt: new Date() } }, opts);
          }
          const duplicateId = plan.duplicate.id;
          const scope = { companyId, propertyId: duplicateId };
          const update = { $set: { propertyId: canonical.id, updatedAt: new Date() } };
          await Promise.all([
            RatePlan.updateMany(scope, update, opts),
            RoomNightInventory.updateMany(scope, update, opts),
            HotelReservation.updateMany(scope, update, opts),
            RoomAssignment.updateMany(scope, update, opts),
            HousekeepingTask.updateMany(scope, update, opts),
            MaintenanceBlock.updateMany(scope, update, opts),
          ]);
          await HotelProperty.deleteOne({ companyId, id: duplicateId }, opts);
        }
      });
    }
    summary.duplicatePropertyGroupsProcessed += 1;
  }
}

async function normalizeRatePlans(summary) {
  const unsupported = await RatePlan.find({ $or: [{ paymentTiming: { $ne: 'pay_now' } }, { depositType: { $ne: 'none' } }, { depositAmount: { $gt: 0 } }] }).lean();
  summary.ratePlansScanned = unsupported.length;
  summary.ratePlansNormalized = unsupported.length;
  if (apply && unsupported.length) {
    await RatePlan.updateMany({ id: { $in: unsupported.map((row) => row.id) } }, { $set: { paymentTiming: 'pay_now', depositType: 'none', depositAmount: 0, updatedAt: new Date() } });
  }
}

async function reconcileListings(summary) {
  const listings = await Listing.find({ serviceType: 'hotel', releaseStatus: { $in: ['live', 'published'] } }).lean();
  summary.publicHotelListingsScanned = listings.length;
  summary.publicHotelListingsPublished = 0;
  summary.publicHotelListingsPaused = 0;
  summary.publicHotelListingFailures = {};
  for (const listing of listings) {
    let readiness;
    try {
      readiness = await hotelService.hotelListingReadiness(listing.companyId, listing.id);
    } catch (error) {
      readiness = { ready: false, failures: [error.code || 'readiness_error'] };
    }
    if (readiness.ready) {
      summary.publicHotelListingsPublished += 1;
      if (apply) await Listing.updateOne({ id: listing.id, companyId: listing.companyId }, { $set: { status: 'active', releaseStatus: 'published', bookable: true, publishedAt: listing.publishedAt || new Date(), unpublishedAt: null, updatedAt: new Date() } });
    } else {
      summary.publicHotelListingsPaused += 1;
      for (const reason of readiness.failures || ['not_ready']) summary.publicHotelListingFailures[reason] = (summary.publicHotelListingFailures[reason] || 0) + 1;
      if (apply) await Listing.updateOne({ id: listing.id, companyId: listing.companyId }, { $set: { status: 'paused', releaseStatus: 'paused', bookable: false, unpublishedAt: new Date(), updatedAt: new Date() } });
    }
  }
}

async function main() {
  await connectDb();
  const bookings = await Booking.find({ serviceType: 'hotel' }).sort({ createdAt: 1 }).limit(limit).lean();
  const summary = { mode: apply ? 'apply' : 'dry-run', scanned: bookings.length, create: 0, skipped: 0, reasons: {} };
  await consolidateDuplicateProperties(summary);
  for (const booking of bookings) {
    const plan = await planBooking(booking);
    if (plan.action !== 'create') {
      summary.skipped += 1;
      summary.reasons[plan.reason] = (summary.reasons[plan.reason] || 0) + 1;
      continue;
    }
    summary.create += 1;
    if (apply) await applyPlan(plan);
  }
  await normalizeRatePlans(summary);
  await reconcileListings(summary);
  console.log(JSON.stringify(summary, null, 2));
  if (!apply && (summary.create || summary.duplicatePropertiesToRemove || summary.ratePlansNormalized || summary.publicHotelListingsPaused)) console.log('Dry run only. Back up the database, then rerun with --apply.');
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
}).finally(async () => {
  await mongoose.disconnect().catch(() => {});
});
