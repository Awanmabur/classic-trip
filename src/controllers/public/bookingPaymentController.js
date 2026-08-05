'use strict';

const commerceRepository = require('../../repositories/domain/commerceRepository');
const bookingPaymentService = require('../../services/payment/bookingPaymentService');
const ticketAccessService = require('../../services/booking/ticketAccessService');
const { safePaymentRedirect } = require('../../utils/paymentRedirect');

function ticketStatusUrl(bookingRef, result = '') {
  const query = new URLSearchParams({ bookingRef });
  if (result) query.set('paymentRetry', result);
  return `/tickets?${query.toString()}`;
}

async function retry(req, res, next) {
  let booking;
  try {
    const bookingRef = String(req.params.bookingRef || '').trim().slice(0, 180);
    booking = await commerceRepository.bookings.findOne({ bookingRef });
    if (!booking) return res.status(404).send('Booking was not found');
    if (!ticketAccessService.canAccessBooking(req, booking)) {
      return res.status(403).send('Payment retry requires the booking contact, access code, or an authorized account.');
    }

    ticketAccessService.grantSessionAccess(req, booking.bookingRef);
    const result = await bookingPaymentService.initiate(booking.bookingRef, {
      provider: req.body?.provider || booking.paymentProvider || undefined,
    }, {
      accessGranted: true,
      bookingRef: booking.bookingRef,
      idempotencyKey: req.headers['idempotency-key'] || `public-retry-${booking.bookingRef}`,
      actorType: req.session?.user ? 'customer' : 'guest',
      ...(req.session?.user || {}),
    });

    if (result.alreadyPaid) return res.redirect(303, `/booking/success/${encodeURIComponent(booking.bookingRef)}`);
    if (result.checkoutUrl) {
      return res.redirect(303, safePaymentRedirect(result.checkoutUrl, ticketStatusUrl(booking.bookingRef, 'unavailable')));
    }
    return res.redirect(303, ticketStatusUrl(booking.bookingRef, result.payment?.status === 'failed' ? 'declined' : 'pending'));
  } catch (error) {
    if (booking && Number(error.status || 500) >= 500) {
      ticketAccessService.grantSessionAccess(req, booking.bookingRef);
      return res.redirect(303, ticketStatusUrl(booking.bookingRef, 'unavailable'));
    }
    return next(error);
  }
}

module.exports = { retry, ticketStatusUrl };
