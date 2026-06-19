const bookingService = require('../../services/booking/bookingService');
const store = require('../../services/data/persistentStore');
const { mongoose } = require('../../config/db');

async function create(req, res, next) {
  try {
    const booking = await bookingService.createGuestBooking(req.body, req);
    res.status(201).json({ booking, ticketUrl: `/tickets/${booking.bookingRef}` });
  } catch (error) {
    next(error);
  }
}

async function findBookingFresh(bookingRef) {
  const cached = store.findBooking(bookingRef);
  if (cached) return cached;
  if (mongoose.connection.readyState !== 1) return null;
  const Booking = require('../../models/Booking');
  const row = await Booking.findOne({ bookingRef }).lean();
  if (!row) return null;
  if (!row.id && row._id) row.id = String(row._id);
  delete row._id;
  delete row.__v;
  store.state.bookings.unshift(row);
  return row;
}

function canReadBooking(req, booking = {}) {
  const user = req.session?.user;
  if (user?.role === 'super_admin' || user?.role === 'admin') return true;
  if (user?.companyId && user.companyId === booking.companyId) return true;
  if (user?.id && user.id === booking.customerUserId) return true;
  const contact = String(req.query.contact || req.query.email || req.query.phone || '').toLowerCase().trim();
  if (!contact) return false;
  const email = String(booking.guestSnapshot?.email || booking.buyerSnapshot?.email || '').toLowerCase();
  const phone = String(booking.guestSnapshot?.phone || booking.buyerSnapshot?.phone || '').toLowerCase();
  return Boolean((email && email.includes(contact)) || (phone && phone.includes(contact)));
}

function publicBookingPayload(booking = {}) {
  return {
    bookingRef: booking.bookingRef,
    serviceType: booking.serviceType,
    bookingStatus: booking.bookingStatus,
    paymentStatus: booking.paymentStatus,
    companyId: booking.companyId,
    listingId: booking.listingId,
    scheduleId: booking.scheduleId,
    passengers: (booking.passengers || []).map((pax) => ({
      fullName: pax.fullName,
      seatOrRoom: pax.seatOrRoom,
      seatNumber: pax.seatNumber,
      checkInStatus: pax.checkInStatus,
    })),
    pricing: booking.pricing,
    createdAt: booking.createdAt,
  };
}

async function show(req, res, next) {
  try {
  const booking = await findBookingFresh(req.params.bookingRef);
  if (!booking) return res.status(404).json({ error: 'booking_not_found' });
  if (!canReadBooking(req, booking)) return res.status(403).json({ error: 'booking_contact_or_login_required' });
  return res.json({ booking: publicBookingPayload(booking) });
  } catch (error) {
    return next(error);
  }
}

module.exports = { create, show };
