const { platformCurrency } = require('../../utils/currency');
const { mongoose } = require('../../config/db');
const { runMongoUnitOfWork } = require('../../services/shared/mongoUnitOfWork');
const { clean } = require('../mongoRepository');
const { nextId } = require('../../services/data/idService');
const { MongoCollection } = require('./mongoCollection');

const collections = {
  companies: new MongoCollection('companies'),
  listings: new MongoCollection('listings'),
  hotelProperties: new MongoCollection('hotelProperties'),
  roomTypes: new MongoCollection('roomTypes'),
  roomUnits: new MongoCollection('roomUnits'),
  roomNightInventories: new MongoCollection('roomNightInventories'),
  bookings: new MongoCollection('bookings'),
  payments: new MongoCollection('payments'),
  paymentIntents: new MongoCollection('paymentIntents'),
  serviceAddons: new MongoCollection('serviceAddons'),
  auditLogs: new MongoCollection('auditLogs'),
  commissions: new MongoCollection('commissions'),
  wallets: new MongoCollection('wallets'),
  walletTransactions: new MongoCollection('walletTransactions'),
  inventoryHolds: new MongoCollection('inventoryHolds'),
  inventoryHoldItems: new MongoCollection('inventoryHoldItems'),
  ratePlans: new MongoCollection('ratePlans'),
  hotelReservations: new MongoCollection('hotelReservations'),
  hotelGuests: new MongoCollection('hotelGuests'),
  roomAssignments: new MongoCollection('roomAssignments'),
  housekeepingTasks: new MongoCollection('housekeepingTasks'),
  maintenanceBlocks: new MongoCollection('maintenanceBlocks'),
  bookingItems: new MongoCollection('bookingItems'),
};

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  throw error;
}

async function companyOrThrow(companyId) {
  return (await collections.companies.findOne({ id: companyId })) || notFound('Company not found');
}

async function listingOrThrow(companyId, identifier) {
  const listing = await collections.listings.findOne({ companyId, $or: [{ id: identifier }, { slug: identifier }] });
  if (!listing || listing.serviceType !== 'hotel') notFound('Hotel listing not found');
  return listing;
}

async function publicListingOrThrow(identifier) {
  const listing = await collections.listings.findOne({ serviceType: 'hotel', $or: [{ id: identifier }, { slug: identifier }] });
  if (!listing) notFound('Hotel listing not found');
  if (String(listing.status || '').toLowerCase() !== 'active' || listing.bookable === false) {
    const error = new Error('This hotel is not currently accepting bookings');
    error.status = 409;
    throw error;
  }
  const company = await collections.companies.findOne({ id: listing.companyId });
  const companyStatus = String(company?.status || '').toLowerCase();
  const verification = String(company?.verificationStatus || company?.verification || '').toLowerCase();
  if (!company || ['suspended', 'blocked', 'archived', 'inactive'].includes(companyStatus)) {
    const error = new Error('This hotel partner is not currently available');
    error.status = 409;
    throw error;
  }
  if (company.settings?.canPublish === false || (verification && !['verified', 'approved', 'active'].includes(verification))) {
    const error = new Error('This hotel partner is not approved for public bookings');
    error.status = 403;
    throw error;
  }
  return listing;
}

async function propertyOrThrow(companyId, propertyId) {
  return (await collections.hotelProperties.findOne({ id: propertyId, companyId })) || notFound('Hotel property not found');
}

async function roomTypeOrThrow(companyId, roomTypeId) {
  return (await collections.roomTypes.findOne({ id: roomTypeId, companyId })) || notFound('Room type not found');
}

async function roomUnitOrThrow(companyId, unitId) {
  return (await collections.roomUnits.findOne({ id: unitId, companyId })) || notFound('Room unit not found');
}

async function nightOrThrow(companyId, inventoryId) {
  return (await collections.roomNightInventories.findOne({ id: inventoryId, companyId })) || notFound('Room-night inventory not found');
}

async function bookingOrThrow(companyId, bookingRef) {
  return (await collections.bookings.findOne({ bookingRef, companyId, serviceType: 'hotel' })) || notFound('Hotel booking not found');
}

async function audit({ actorId, action, targetType, targetId, meta = {} }) {
  const row = {
    id: await nextId('audit'),
    actorId,
    action,
    targetType,
    targetId,
    meta,
    status: 'success',
    createdAt: new Date().toISOString(),
  };
  await collections.auditLogs.save(row);
  return row;
}


function model(name) {
  require(`../../models/${name}`);
  return mongoose.model(name);
}

async function commitHotelBooking({ selectedRows, booking, paymentRow, paymentIntentRow = null, canonical = {} }) {
  return transaction(async (session) => {
    const RoomNightInventory = model('RoomNightInventory');
    const Booking = model('Booking');
    const BookingItem = model('BookingItem');
    const HotelReservation = model('HotelReservation');
    const HotelGuest = model('HotelGuest');
    const RoomAssignment = model('RoomAssignment');
    const Payment = model('Payment');
    const PaymentIntent = paymentIntentRow ? model('PaymentIntent') : null;
    const claimed = [];
    const inventoryStatus = booking.paymentStatus === 'successful' ? 'booked' : 'reserved';
    const assignments = Array.isArray(canonical.roomAssignments) ? canonical.roomAssignments : [];
    for (const selected of selectedRows) {
      const assignment = assignments.find((row) => Array.isArray(row.nightIds) && row.nightIds.includes(selected.id));
      const row = await RoomNightInventory.findOneAndUpdate(
        {
          id: selected.id,
          companyId: selected.companyId,
          status: { $in: ['available', 'open'] },
          $or: [{ bookingRef: { $exists: false } }, { bookingRef: '' }, { bookingRef: null }],
        },
        {
          $set: {
            status: inventoryStatus,
            availableInventory: 0,
            bookingRef: booking.bookingRef,
            reservationId: canonical.reservation?.id || '',
            assignmentId: assignment?.id || '',
            guestName: booking.guestSnapshot?.fullName || '',
            checkInStatus: 'not_checked',
            updatedAt: new Date(),
          },
        },
        { new: true, session, runValidators: true }
      ).lean();
      if (!row) {
        const error = new Error('One or more room nights are no longer available');
        error.status = 409;
        throw error;
      }
      claimed.push(clean(row));
    }
    await Booking.updateOne(
      { bookingRef: booking.bookingRef },
      { $set: booking },
      { upsert: true, runValidators: true, session }
    );
    for (const item of canonical.bookingItems || []) {
      await BookingItem.updateOne({ id: item.id }, { $set: item }, { upsert: true, runValidators: true, session });
    }
    if (canonical.reservation) {
      await HotelReservation.updateOne({ id: canonical.reservation.id }, { $set: canonical.reservation }, { upsert: true, runValidators: true, session });
    }
    for (const guest of canonical.guests || []) {
      await HotelGuest.updateOne({ id: guest.id }, { $set: guest }, { upsert: true, runValidators: true, session });
    }
    for (const assignment of assignments) {
      await RoomAssignment.updateOne({ id: assignment.id }, { $set: assignment }, { upsert: true, runValidators: true, session });
    }
    await Payment.updateOne(
      { idempotencyKey: paymentRow.idempotencyKey },
      { $set: paymentRow },
      { upsert: true, runValidators: true, session }
    );
    if (paymentIntentRow) {
      await PaymentIntent.updateOne(
        { idempotencyKey: paymentIntentRow.idempotencyKey },
        { $set: paymentIntentRow },
        { upsert: true, runValidators: true, session }
      );
    }
    return { booking, paymentRow, paymentIntentRow, nights: claimed, canonical };
  });
}

function settlementRows(booking, split) {
  const currency = booking.pricing?.currency || platformCurrency();
  const rows = [
    { ownerType: 'platform', ownerId: 'platform', amount: Number(split.platformFee || 0), balanceField: 'availableBalance', transactionType: 'platform_fee', status: 'completed' },
    { ownerType: 'company', ownerId: booking.companyId, amount: Number(split.companyAmount || 0), balanceField: 'pendingBalance', transactionType: 'company_earning_pending', status: 'pending' },
  ];
  if (booking.promoterAttribution?.promoterId && Number(split.promoterAmount || 0) > 0) {
    rows.push({ ownerType: 'promoter', ownerId: booking.promoterAttribution.promoterId, amount: Number(split.promoterAmount || 0), balanceField: 'pendingBalance', transactionType: 'promoter_commission_pending', status: 'pending' });
  }
  return rows.map((row) => ({ ...row, currency }));
}

function safeId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 100);
}

async function settleSuccessfulBooking({ booking, split }) {
  if (!booking || booking.paymentStatus !== 'successful') return booking;
  const existing = await collections.commissions.findOne({ bookingId: booking.id });
  if (existing) {
    if (!['pending_fulfillment', 'eligible', 'settled'].includes(booking.settlementStatus)) {
      booking.settlementStatus = 'pending_fulfillment';
      booking.settledAt = null;
      await collections.bookings.save(booking);
    }
    return booking;
  }
  const now = new Date().toISOString();
  const commission = {
    id: `commission-${safeId(booking.id)}`,
    bookingId: booking.id,
    bookingRef: booking.bookingRef,
    promoterId: booking.promoterAttribution?.promoterId || null,
    companyId: booking.companyId,
    platformFee: Number(split.platformFee || 0),
    promoterAmount: Number(split.promoterAmount || 0),
    companyAmount: Number(split.companyAmount || 0),
    status: 'pending',
    releasedAt: null,
    createdAt: now,
  };
  const entries = settlementRows(booking, split);

  const result = await transaction(async (session) => {
    const Commission = model('Commission');
    const Wallet = model('Wallet');
    const WalletTransaction = model('WalletTransaction');
    const Booking = model('Booking');
    const duplicate = await Commission.findOne({ bookingId: booking.id }).session(session).lean();
    if (duplicate) return booking;
    await Commission.create([commission], { session });
    for (const entry of entries) {
      const walletId = `wallet-${safeId(entry.ownerType)}-${safeId(entry.ownerId)}-${safeId(entry.currency)}`;
      const transactionId = `wallet-txn-${safeId(booking.id)}-${safeId(entry.transactionType)}`;
      const transactionExists = await WalletTransaction.exists({ id: transactionId }).session(session);
      if (transactionExists) continue;
      const wallet = await Wallet.findOneAndUpdate(
        { ownerType: entry.ownerType, ownerId: entry.ownerId, currency: entry.currency },
        { $setOnInsert: { id: walletId, ownerType: entry.ownerType, ownerId: entry.ownerId, currency: entry.currency }, $inc: { [entry.balanceField]: entry.amount } },
        { upsert: true, new: true, runValidators: true, session }
      ).lean();
      const transactionRow = {
        id: transactionId,
        walletId: wallet.id || walletId,
        ownerType: entry.ownerType,
        ownerId: entry.ownerId,
        transactionType: entry.transactionType,
        direction: 'credit',
        amount: entry.amount,
        currency: entry.currency,
        status: entry.status,
        referenceType: 'booking',
        referenceId: booking.id,
        createdAt: now,
      };
      await WalletTransaction.create([transactionRow], { session });
    }
    booking.settlementStatus = 'pending_fulfillment';
    booking.settledAt = null;
    await Booking.updateOne({ bookingRef: booking.bookingRef }, { $set: { settlementStatus: 'pending_fulfillment', settledAt: null } }, { session, runValidators: true });
    return booking;
  });
  return result;
}


function hotelPaymentLifecycleState(paymentStatus = 'pending') {
  const normalized = String(paymentStatus || 'pending').trim().toLowerCase();
  if (normalized === 'successful') return {
    paymentStatus: 'successful', reservationStatus: 'confirmed', bookingItemStatus: 'confirmed', assignmentStatus: 'assigned', settlementStatus: 'pending_fulfillment', releaseInventory: false,
  };
  if (normalized === 'refunded') return {
    paymentStatus: 'refunded', reservationStatus: 'refunded', bookingItemStatus: 'refunded', assignmentStatus: 'refunded', settlementStatus: 'refunded', releaseInventory: true,
  };
  if (normalized === 'expired') return {
    paymentStatus: 'expired', reservationStatus: 'expired', bookingItemStatus: 'expired', assignmentStatus: 'expired', settlementStatus: 'pending_payment', releaseInventory: true,
  };
  if (['failed', 'cancelled'].includes(normalized)) return {
    paymentStatus: 'failed', reservationStatus: normalized === 'cancelled' ? 'cancelled' : 'failed', bookingItemStatus: normalized === 'cancelled' ? 'cancelled' : 'failed', assignmentStatus: 'cancelled', settlementStatus: 'pending_payment', releaseInventory: true,
  };
  return {
    paymentStatus: 'pending', reservationStatus: 'awaiting_payment', bookingItemStatus: 'awaiting_payment', assignmentStatus: 'awaiting_payment', settlementStatus: 'pending_payment', releaseInventory: false,
  };
}

async function applyPaymentLifecycle({ bookingRef, companyId = '', paymentStatus = 'pending', reason = '', session = null } = {}) {
  const safeBookingRef = String(bookingRef || '').trim();
  if (!safeBookingRef) return { reservation: null, nightsUpdated: 0, inventoryReleased: 0 };
  const HotelReservation = model('HotelReservation');
  const HotelGuest = model('HotelGuest');
  const RoomAssignment = model('RoomAssignment');
  const BookingItem = model('BookingItem');
  const RoomNightInventory = model('RoomNightInventory');
  const state = hotelPaymentLifecycleState(paymentStatus);
  const filter = { bookingRef: safeBookingRef, ...(companyId ? { companyId } : {}) };
  const reservation = await HotelReservation.findOne(filter).session(session || null).lean();
  if (!reservation) return { reservation: null, nightsUpdated: 0, inventoryReleased: 0 };

  const operational = ['checked_in', 'checked_out', 'completed'].includes(String(reservation.status || '').toLowerCase())
    || Boolean(reservation.actualCheckInAt);
  const now = new Date();
  const updateOptions = { runValidators: true, ...(session ? { session } : {}) };
  const nextReservationStatus = operational && state.paymentStatus === 'successful'
    ? reservation.status
    : state.reservationStatus;
  const nextSettlementStatus = ['eligible', 'settled'].includes(String(reservation.settlementStatus || '').toLowerCase()) && state.paymentStatus === 'successful'
    ? reservation.settlementStatus
    : state.settlementStatus;

  await HotelReservation.updateOne(filter, {
    $set: {
      status: nextReservationStatus,
      paymentStatus: state.paymentStatus,
      settlementStatus: nextSettlementStatus,
      ...(state.releaseInventory && !operational ? { cancelledAt: reservation.cancelledAt || now, cancellationReason: String(reason || reservation.cancellationReason || state.reservationStatus).slice(0, 500) } : {}),
      updatedAt: now,
    },
  }, updateOptions);

  await BookingItem.updateMany({ bookingRef: safeBookingRef, companyId: reservation.companyId, serviceType: 'hotel' }, {
    $set: { status: operational && state.paymentStatus === 'successful' ? 'in_progress' : state.bookingItemStatus, updatedAt: now },
  }, updateOptions);
  await RoomAssignment.updateMany({ bookingRef: safeBookingRef, companyId: reservation.companyId }, {
    $set: {
      status: operational && state.paymentStatus === 'successful' ? 'occupied' : state.assignmentStatus,
      ...(state.assignmentStatus === 'assigned' ? { assignedAt: now } : {}),
      ...(state.releaseInventory && !operational ? { releasedAt: now } : {}),
      updatedAt: now,
    },
  }, updateOptions);

  let nightsUpdated = 0;
  let inventoryReleased = 0;
  if (state.paymentStatus === 'successful') {
    const result = await RoomNightInventory.updateMany({
      bookingRef: safeBookingRef,
      companyId: reservation.companyId,
      status: { $in: ['held', 'reserved', 'available', 'open'] },
    }, {
      $set: { status: 'booked', availableInventory: 0, checkInStatus: 'not_checked', updatedAt: now },
    }, updateOptions);
    nightsUpdated = Number(result.modifiedCount ?? result.nModified ?? 0);
  } else if (['pending'].includes(state.paymentStatus)) {
    const result = await RoomNightInventory.updateMany({
      bookingRef: safeBookingRef,
      companyId: reservation.companyId,
      status: { $in: ['held', 'reserved'] },
    }, {
      $set: { status: 'reserved', availableInventory: 0, updatedAt: now },
    }, updateOptions);
    nightsUpdated = Number(result.modifiedCount ?? result.nModified ?? 0);
  } else if (state.releaseInventory && !operational) {
    const result = await RoomNightInventory.updateMany({
      bookingRef: safeBookingRef,
      companyId: reservation.companyId,
      status: { $nin: ['occupied', 'checked_in', 'checked_out', 'cleaning', 'maintenance'] },
    }, {
      $set: { status: 'available', availableInventory: 1, bookingRef: '', reservationId: '', assignmentId: '', guestName: '', checkInStatus: '', updatedAt: now },
      $unset: { holdId: '' },
    }, updateOptions);
    inventoryReleased = Number(result.modifiedCount ?? result.nModified ?? 0);
    nightsUpdated = inventoryReleased;
  }

  return {
    reservation: await HotelReservation.findOne(filter).session(session || null).lean(),
    nightsUpdated,
    inventoryReleased,
  };
}

async function cancelReservation({ bookingRef, companyId = '', reason = 'Booking cancelled', actorId = 'customer', session = null } = {}) {
  const safeBookingRef = String(bookingRef || '').trim();
  if (!safeBookingRef) return { reservation: null, inventoryReleased: 0 };
  const HotelReservation = model('HotelReservation');
  const RoomAssignment = model('RoomAssignment');
  const BookingItem = model('BookingItem');
  const RoomNightInventory = model('RoomNightInventory');
  const filter = { bookingRef: safeBookingRef, ...(companyId ? { companyId } : {}) };
  const reservation = await HotelReservation.findOne(filter).session(session || null).lean();
  if (!reservation) return { reservation: null, inventoryReleased: 0 };
  if (['checked_in', 'checked_out', 'completed'].includes(String(reservation.status || '').toLowerCase()) || reservation.actualCheckInAt) {
    const error = new Error('A checked-in or completed hotel stay cannot be cancelled through the reservation workflow');
    error.status = 409;
    throw error;
  }
  const now = new Date();
  const options = { runValidators: true, ...(session ? { session } : {}) };
  const paid = String(reservation.paymentStatus || '').toLowerCase() === 'successful';
  await HotelReservation.updateOne(filter, { $set: {
    status: 'cancelled',
    settlementStatus: paid ? 'reconciliation_required' : 'pending_payment',
    cancelledAt: now,
    cancellationReason: String(reason || 'Booking cancelled').slice(0, 500),
    updatedAt: now,
  } }, options);
  await BookingItem.updateMany({ bookingRef: safeBookingRef, companyId: reservation.companyId, serviceType: 'hotel' }, { $set: { status: 'cancelled', updatedAt: now } }, options);
  await RoomAssignment.updateMany({ bookingRef: safeBookingRef, companyId: reservation.companyId }, { $set: { status: 'cancelled', releasedAt: now, updatedAt: now } }, options);
  const result = await RoomNightInventory.updateMany({
    bookingRef: safeBookingRef,
    companyId: reservation.companyId,
    status: { $nin: ['occupied', 'checked_in', 'checked_out', 'cleaning', 'maintenance'] },
  }, {
    $set: { status: 'available', availableInventory: 1, bookingRef: '', reservationId: '', assignmentId: '', guestName: '', checkInStatus: '', updatedAt: now },
    $unset: { holdId: '' },
  }, options);
  return {
    reservation: await HotelReservation.findOne(filter).session(session || null).lean(),
    inventoryReleased: Number(result.modifiedCount ?? result.nModified ?? 0),
    actorId,
  };
}

async function commitNoShow({ companyId, bookingRef, actorId = 'company-admin', reason = 'Guest did not arrive', now = new Date().toISOString() } = {}) {
  return transaction(async (session) => {
    const Booking = model('Booking');
    const HotelReservation = model('HotelReservation');
    const HotelGuest = model('HotelGuest');
    const RoomAssignment = model('RoomAssignment');
    const BookingItem = model('BookingItem');
    const RoomNightInventory = model('RoomNightInventory');
    const updateOptions = { runValidators: true, session };
    const booking = await Booking.findOneAndUpdate({
      companyId,
      bookingRef,
      serviceType: 'hotel',
      paymentStatus: 'successful',
      bookingStatus: { $in: ['confirmed', 'booked'] },
      'hotelStay.status': { $in: ['booked', 'confirmed'] },
    }, {
      $set: {
        bookingStatus: 'no_show',
        'hotelStay.status': 'no_show',
        checkInStatus: 'no_show',
        noShowAt: now,
        noShowBy: actorId,
        noShowNote: String(reason || 'Guest did not arrive').slice(0, 1000),
        settlementStatus: 'reconciliation_required',
        settlementError: 'Hotel no-show requires cancellation-policy and refund reconciliation.',
        lockedUntil: null,
        updatedAt: now,
      },
    }, { new: true, runValidators: true, session }).lean();
    if (!booking) {
      const error = new Error('Only a paid, confirmed hotel arrival that has not checked in can be marked no-show');
      error.status = 409;
      error.code = 'hotel_no_show_not_allowed';
      throw error;
    }

    const reservationResult = await HotelReservation.updateOne({
      companyId,
      bookingRef,
      paymentStatus: 'successful',
      status: { $in: ['confirmed'] },
    }, { $set: {
      status: 'no_show',
      settlementStatus: 'reconciliation_required',
      cancellationReason: String(reason || 'Guest did not arrive').slice(0, 500),
      updatedAt: now,
    } }, updateOptions);
    const reservationMatched = Number(reservationResult.matchedCount ?? reservationResult.n ?? 0);
    if (!reservationMatched) {
      const error = new Error('The canonical hotel reservation is missing or is not eligible for no-show processing');
      error.status = 409;
      error.code = 'hotel_reservation_no_show_not_allowed';
      throw error;
    }

    await HotelGuest.updateMany({ companyId, bookingRef, checkInStatus: 'not_checked' }, {
      $set: { checkInStatus: 'no_show', updatedAt: now },
    }, updateOptions);
    await RoomAssignment.updateMany({ companyId, bookingRef, status: { $in: ['assigned', 'awaiting_payment'] } }, {
      $set: { status: 'no_show', releasedAt: now, updatedAt: now },
    }, updateOptions);
    await BookingItem.updateMany({ companyId, bookingRef, serviceType: 'hotel', status: { $in: ['confirmed', 'awaiting_payment'] } }, {
      $set: { status: 'no_show', updatedAt: now },
    }, updateOptions);
    const inventoryResult = await RoomNightInventory.updateMany({
      companyId,
      bookingRef,
      status: { $in: ['booked', 'reserved', 'held'] },
    }, {
      $set: {
        status: 'available',
        availableInventory: 1,
        bookingRef: '',
        reservationId: '',
        assignmentId: '',
        guestName: '',
        checkInStatus: 'no_show',
        notes: String(reason || 'Guest did not arrive').slice(0, 500),
        updatedAt: now,
      },
      $unset: { holdId: '' },
    }, updateOptions);
    return {
      booking,
      inventoryReleased: Number(inventoryResult.modifiedCount ?? inventoryResult.nModified ?? 0),
    };
  });
}

async function commitStayTransition({ companyId, bookingRef, normalized, actorId = 'company-admin', now = new Date().toISOString(), unitIds = [] }) {
  if (!['checked_in', 'checked_out'].includes(normalized)) {
    const error = new Error('Unsupported hotel stay transition');
    error.status = 422;
    throw error;
  }
  return transaction(async (session) => {
    const Booking = model('Booking');
    const RoomNightInventory = model('RoomNightInventory');
    const RoomUnit = model('RoomUnit');
    const HotelReservation = model('HotelReservation');
    const HotelGuest = model('HotelGuest');
    const RoomAssignment = model('RoomAssignment');
    const BookingItem = model('BookingItem');
    const HousekeepingTask = model('HousekeepingTask');
    const options = { new: true, runValidators: true };
    const updateOptions = { runValidators: true };
    if (session) { options.session = session; updateOptions.session = session; }

    const bookingFilter = {
      bookingRef,
      companyId,
      serviceType: 'hotel',
      paymentStatus: 'successful',
      ...(normalized === 'checked_in'
        ? {
            bookingStatus: { $in: ['confirmed', 'booked'] },
            'hotelStay.status': { $in: ['booked', 'confirmed'] },
          }
        : {
            bookingStatus: 'checked_in',
            'hotelStay.status': { $in: ['checked_in', 'occupied', 'in_house'] },
          }),
    };
    const bookingUpdate = normalized === 'checked_in'
      ? {
          $set: {
            bookingStatus: 'checked_in',
            'hotelStay.status': 'checked_in',
            checkedInAt: now,
            checkedInBy: actorId,
            checkInStatus: 'checked_in',
          },
        }
      : {
          $set: {
            bookingStatus: 'completed',
            'hotelStay.status': 'checked_out',
            completedAt: now,
            checkOutAt: now,
            completedBy: actorId,
            settlementStatus: 'eligible',
          },
        };
    const transitionedBooking = await Booking.findOneAndUpdate(bookingFilter, bookingUpdate, options).lean();
    if (!transitionedBooking) {
      const error = new Error(normalized === 'checked_in'
        ? 'Only a paid, confirmed hotel booking can be checked in'
        : 'Only a paid, currently checked-in hotel stay can be checked out');
      error.status = 409;
      error.code = normalized === 'checked_in' ? 'hotel_checkin_not_allowed' : 'hotel_checkout_not_allowed';
      throw error;
    }

    const nightFilter = {
      companyId,
      bookingRef,
      status: normalized === 'checked_in'
        ? { $in: ['booked', 'checked_in', 'occupied'] }
        : { $in: ['occupied', 'checked_in'] },
    };
    const nightUpdate = normalized === 'checked_in'
      ? { $set: { status: 'occupied', checkInStatus: 'checked_in', updatedAt: now } }
      : { $set: { status: 'checked_out', checkInStatus: 'checked_out', updatedAt: now } };
    const nightResult = await RoomNightInventory.updateMany(nightFilter, nightUpdate, updateOptions);
    const changedNights = Number(nightResult.modifiedCount ?? nightResult.nModified ?? 0);
    const matchedNights = Number(nightResult.matchedCount ?? nightResult.n ?? 0);
    if (!matchedNights && !changedNights) {
      const error = new Error('The hotel booking has no valid room-night inventory for this transition');
      error.status = 409;
      error.code = 'hotel_inventory_transition_not_allowed';
      throw error;
    }

    const safeUnitIds = [...new Set((unitIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
    const reservationUpdate = normalized === 'checked_in'
      ? { $set: { status: 'checked_in', actualCheckInAt: now, checkedInBy: actorId, settlementStatus: 'pending_fulfillment' } }
      : { $set: { status: 'completed', actualCheckOutAt: now, checkedOutBy: actorId, settlementStatus: 'eligible' } };
    await HotelReservation.updateOne({ companyId, bookingRef }, reservationUpdate, updateOptions);
    await HotelGuest.updateMany({ companyId, bookingRef }, normalized === 'checked_in'
      ? { $set: { checkInStatus: 'checked_in', checkedInAt: now } }
      : { $set: { checkInStatus: 'checked_out', checkedOutAt: now } }, updateOptions);
    await RoomAssignment.updateMany({ companyId, bookingRef }, normalized === 'checked_in'
      ? { $set: { status: 'occupied', assignedAt: now } }
      : { $set: { status: 'completed', releasedAt: now } }, updateOptions);
    await BookingItem.updateMany({ companyId, bookingRef, serviceType: 'hotel' }, normalized === 'checked_in'
      ? { $set: { status: 'in_progress' } }
      : { $set: { status: 'completed' } }, updateOptions);

    if (safeUnitIds.length) {
      const unitFilter = { companyId, id: { $in: safeUnitIds }, status: { $ne: 'archived' } };
      const unitUpdate = normalized === 'checked_in'
        ? {
            $set: {
              status: 'occupied',
              housekeepingStatus: 'occupied',
              updatedBy: actorId,
              updatedAt: now,
            },
          }
        : {
            $set: {
              status: 'cleaning',
              housekeepingStatus: 'dirty',
              housekeepingTaskStatus: 'open',
              housekeepingPriority: 'normal',
              housekeepingDueAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
              lastGuestBookingRef: bookingRef,
              updatedBy: actorId,
              updatedAt: now,
            },
          };
      await RoomUnit.updateMany(unitFilter, unitUpdate, updateOptions);
      if (normalized === 'checked_out') {
        const existingTasks = await HousekeepingTask.find({ companyId, roomUnitId: { $in: safeUnitIds }, bookingRef, status: { $in: ['open', 'in_progress', 'blocked'] } }).session(session).lean();
        const existingUnits = new Set(existingTasks.map((task) => String(task.roomUnitId)));
        const assignments = await RoomAssignment.find({ companyId, bookingRef, roomUnitId: { $in: safeUnitIds } }).session(session).lean();
        const assignmentByUnit = new Map(assignments.map((row) => [String(row.roomUnitId), row]));
        const tasks = safeUnitIds.filter((unitId) => !existingUnits.has(String(unitId))).map((unitId) => ({
          id: `housekeeping-${safeId(bookingRef)}-${safeId(unitId)}`,
          companyId,
          listingId: transitionedBooking.listingId,
          propertyId: assignmentByUnit.get(String(unitId))?.propertyId || '',
          roomUnitId: unitId,
          bookingRef,
          assignmentId: assignmentByUnit.get(String(unitId))?.id || '',
          targetDate: transitionedBooking.hotelStay?.checkOut || new Date().toISOString().slice(0, 10),
          nightIds: assignmentByUnit.get(String(unitId))?.nightIds || [],
          taskType: 'checkout_clean',
          status: 'open',
          priority: 'normal',
          dueAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
          createdBy: actorId,
          createdAt: now,
        }));
        if (tasks.length) await HousekeepingTask.insertMany(tasks, { session, ordered: false });
      }
    }
    return clean(transitionedBooking);
  });
}

async function transaction(work) {
  return runMongoUnitOfWork(work);
}

module.exports = {
  ...collections,
  nextId,
  companyOrThrow,
  listingOrThrow,
  publicListingOrThrow,
  propertyOrThrow,
  roomTypeOrThrow,
  roomUnitOrThrow,
  nightOrThrow,
  bookingOrThrow,
  audit,
  transaction,
  commitHotelBooking,
  commitNoShow,
  commitStayTransition,
  settleSuccessfulBooking,
  applyPaymentLifecycle,
  cancelReservation,
};
