const bookingService = require('../../services/booking/bookingService');
const busBookingService = require('../../modules/bus/services/busBookingService');
const hotelService = require('../../services/hotel/hotelService');
const commerceRepository = require('../../repositories/domain/commerceRepository');
const { stripClientSuppliedIdentity } = require('../../utils/sanitizePublicPayload');
const ticketAccessService = require('../../services/booking/ticketAccessService');

async function create(req, res, next) {
  try {
    const payload = stripClientSuppliedIdentity(req.body);
    const listing = await commerceRepository.listings.findOne({ id: String(payload.listingId || '').trim() });
    if (!listing) throw Object.assign(new Error('Booking listing was not found'), { status: 404 });
    const serviceType = String(listing.serviceType || '').trim().toLowerCase();
    const booking = serviceType === 'bus'
      ? await busBookingService.createGuestBooking(payload, req)
      : serviceType === 'hotel'
        ? await hotelService.createHotelBooking(payload, req)
        : await bookingService.createGuestBooking(payload, req);
    ticketAccessService.grantSessionAccess(req, booking.bookingRef);
    res.status(201).json({ booking, ticketUrl: ticketAccessService.ticketUrl(booking) });
  } catch (error) {
    next(error);
  }
}

async function findBookingFresh(bookingRef) {
  return commerceRepository.bookings.findOne({ bookingRef });
}

function canReadBooking(req, booking = {}) {
  return ticketAccessService.canAccessBooking(req, booking);
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
