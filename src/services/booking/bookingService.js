const store = require('../data/demoStore');
const { mongoose } = require('../../config/db');

function mongoReady() {
  return mongoose.connection.readyState === 1;
}

async function persistBooking(booking, payload, transactionStartIndex) {
  if (!mongoReady()) return;

  const Booking = require('../../models/Booking');
  const Seat = require('../../models/Seat');
  const TripSchedule = require('../../models/TripSchedule');
  const Room = require('../../models/Room');
  const WalletTransaction = require('../../models/WalletTransaction');
  const Wallet = require('../../models/Wallet');
  const Commission = require('../../models/Commission');

  await Booking.updateOne(
    { bookingRef: booking.bookingRef },
    { $set: booking },
    { upsert: true, runValidators: true }
  );

  const selectedInventory = booking.passengers?.[0]?.seatOrRoom;
  if (booking.serviceType === 'bus' && booking.scheduleId && selectedInventory) {
    await Seat.updateOne(
      { scheduleId: booking.scheduleId, seatNumber: selectedInventory },
      { $set: { status: 'taken', lockedUntil: null, lockId: null } }
    );
    await TripSchedule.updateOne({ id: booking.scheduleId }, { $inc: { availableSeats: -1 } });
  }

  if (booking.serviceType === 'hotel' && payload.roomId) {
    await Room.updateOne({ id: payload.roomId }, { $inc: { inventory: -1 } });
  }

  const newTransactions = store.state.walletTransactions.slice(transactionStartIndex);
  if (newTransactions.length) await WalletTransaction.insertMany(newTransactions, { ordered: false });

  const affectedWalletKeys = new Set(newTransactions.map((txn) => `${txn.ownerType}:${txn.ownerId}`));
  const affectedWallets = store.state.wallets.filter((wallet) => affectedWalletKeys.has(`${wallet.ownerType}:${wallet.ownerId}`));
  if (affectedWallets.length) {
    await Wallet.bulkWrite(affectedWallets.map((wallet) => ({
      updateOne: {
        filter: { ownerType: wallet.ownerType, ownerId: wallet.ownerId },
        update: { $set: wallet },
        upsert: true,
      },
    })));
  }

  const commissions = store.state.commissions.filter((commission) => commission.bookingId === booking.id);
  if (commissions.length) {
    await Commission.bulkWrite(commissions.map((commission) => ({
      updateOne: {
        filter: { id: commission.id },
        update: { $set: commission },
        upsert: true,
      },
    })));
  }
}

async function createGuestBooking(payload, req) {
  const transactionStartIndex = store.state.walletTransactions.length;
  const booking = store.createBooking(payload, req);
  await persistBooking(booking, payload, transactionStartIndex);
  const notificationService = require('../notification/notificationService');
  await notificationService.bookingConfirmed(booking);
  return booking;
}

async function persistCheckIn(booking) {
  if (!mongoReady() || !booking) return;
  const Booking = require('../../models/Booking');
  await Booking.updateOne(
    { bookingRef: booking.bookingRef },
    {
      $set: {
        bookingStatus: booking.bookingStatus,
        checkedInAt: booking.checkedInAt,
        checkedInBy: booking.checkedInBy,
        checkedInByUserId: booking.checkedInByUserId,
        checkInStatus: booking.checkInStatus,
        checkInNote: booking.checkInNote,
        noShowAt: booking.noShowAt,
        noShowBy: booking.noShowBy,
        noShowByUserId: booking.noShowByUserId,
        cancelledAt: booking.cancelledAt,
        cancelReason: booking.cancelReason,
        completedAt: booking.completedAt,
        settlementStatus: booking.settlementStatus,
      },
    }
  );
}

async function persistFinancialRelease(booking, commissions = []) {
  if (!mongoReady() || !booking) return;
  const Wallet = require('../../models/Wallet');
  const WalletTransaction = require('../../models/WalletTransaction');
  const Commission = require('../../models/Commission');
  const Booking = require('../../models/Booking');
  const ownerKeys = new Set([
    `company:${booking.companyId}`,
    booking.promoterAttribution?.promoterId ? `promoter:${booking.promoterAttribution.promoterId}` : '',
  ].filter(Boolean));
  const wallets = store.state.wallets.filter((wallet) => ownerKeys.has(`${wallet.ownerType}:${wallet.ownerId}`));
  if (wallets.length) {
    await Wallet.bulkWrite(wallets.map((wallet) => ({
      updateOne: {
        filter: { ownerType: wallet.ownerType, ownerId: wallet.ownerId },
        update: { $set: wallet },
        upsert: true,
      },
    })));
  }
  const txns = store.state.walletTransactions.filter((txn) => txn.referenceType === 'booking' && txn.referenceId === booking.id);
  if (txns.length) {
    await WalletTransaction.bulkWrite(txns.map((txn) => ({
      updateOne: {
        filter: { id: txn.id },
        update: { $set: txn },
        upsert: true,
      },
    })));
  }
  if (commissions.length) {
    await Commission.bulkWrite(commissions.map((commission) => ({
      updateOne: {
        filter: { id: commission.id },
        update: { $set: commission },
        upsert: true,
      },
    })));
  }
  await Booking.updateOne({ bookingRef: booking.bookingRef }, { $set: { earningsReleasedAt: booking.earningsReleasedAt } });
}

async function validateTicket(value, employeeId = 'employee-system', companyId = '', context = {}) {
  const releaseService = require('../commission/releaseService');
  const result = store.validateTicket(value, employeeId, companyId, context);
  if (result.booking) result.listing = store.findListing(result.booking.listingId);
  if (result.ok) {
    const released = releaseService.releaseCompletedBooking(result.booking.bookingRef) || [];
    result.releasedCommissions = released;
    await persistCheckIn(result.booking);
    await persistFinancialRelease(result.booking, released);
  }
  return result;
}


async function lookupTicket(value, companyId = '', context = {}) {
  return store.lookupTicket(value, companyId, context);
}

async function markNoShow(value, employeeId = 'employee-system', companyId = '', note = '', context = {}) {
  const result = store.markNoShow(value, employeeId, companyId, note, context);
  if (result.ok) await persistCheckIn(result.booking);
  return result;
}

function lookupBooking(bookingRef, contact = '') {
  const booking = store.findBooking(bookingRef);
  if (!booking) return null;
  if (!contact) return booking;
  const key = String(contact).toLowerCase();
  const email = String(booking.guestSnapshot?.email || '').toLowerCase();
  const phone = String(booking.guestSnapshot?.phone || '').toLowerCase();
  return email.includes(key) || phone.includes(key) ? booking : null;
}

function cancelBooking(bookingRef, reason = 'Customer requested cancellation') {
  const booking = store.findBooking(bookingRef);
  if (!booking) return null;
  booking.bookingStatus = 'cancelled';
  booking.cancelReason = reason;
  booking.cancelledAt = new Date().toISOString();
  return booking;
}

module.exports = { createGuestBooking, lookupTicket, validateTicket, markNoShow, lookupBooking, cancelBooking };
