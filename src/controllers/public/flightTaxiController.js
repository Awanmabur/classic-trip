'use strict';

const flightService = require('../../modules/flight/services/flightService');
const taxiService = require('../../modules/taxi/services/taxiService');
const ticketAccessService = require('../../services/booking/ticketAccessService');
const repository = require('../../repositories');
const { stripClientSuppliedIdentity } = require('../../utils/sanitizePublicPayload');

function clean(value) { return String(value || '').trim(); }
function today() { return new Date().toISOString().slice(0, 10); }

async function flights(req, res, next) {
  try {
    const query = req.query || {};
    const hasSearch = Boolean(query.origin && query.destination && query.date);
    const [airports, search] = await Promise.all([
      repository.airports.list({ status: 'active' }, { sort: { country: 1, city: 1 }, limit: 500 }),
      hasSearch ? flightService.searchFlights(query) : Promise.resolve({ results: [], total: 0 }),
    ]);
    return res.render('pages/flight/index', {
      seo: { title: 'Flights across East Africa | Classic Trip', description: 'Search verified airline schedules, compare fare families, choose seats, pay securely and receive electronic tickets.' },
      query,
      airports,
      search,
      today: today(),
    });
  } catch (error) { return next(error); }
}

async function flightOffer(req, res, next) {
  try {
    const offer = await flightService.getFlightOffer(req.params.scheduleId, req.params.fareId);
    const passengerCount = Math.max(1, Math.min(9, Number(req.query.passengers || 1)));
    return res.render('pages/flight/offer', {
      seo: { title: `${offer.schedule.flightNumber} ${offer.origin.iataCode} to ${offer.destination.iataCode} | Classic Trip` },
      offer,
      passengerCount,
    });
  } catch (error) { return next(error); }
}

async function createFlightBooking(req, res, next) {
  try {
    const booking = await flightService.createGuestBooking(stripClientSuppliedIdentity(req.body), req);
    ticketAccessService.grantSessionAccess(req, booking.bookingRef);
    if (booking.checkoutUrl && booking.paymentStatus !== 'successful') return res.redirect(303, booking.checkoutUrl);
    return res.redirect(303, `/booking/success/${encodeURIComponent(booking.bookingRef)}`);
  } catch (error) { return next(error); }
}

async function taxi(req, res, next) {
  try {
    const [listings, zones, airports] = await Promise.all([
      repository.listings.list({ serviceType: 'taxi', status: 'active', bookable: true }, { sort: { isFeatured: -1, title: 1 }, limit: 200 }),
      repository.taxiServiceZones.list({ status: 'active' }, { sort: { country: 1, cityOrDistrict: 1 }, limit: 500 }),
      repository.airports.list({ status: 'active' }, { sort: { country: 1, city: 1 }, limit: 500 }),
    ]);
    return res.render('pages/taxi/index', {
      seo: { title: 'Local taxi and airport transfers | Classic Trip', description: 'Book verified immediate or scheduled taxi rides, airport transfers, district trips and intercity travel.' },
      listings,
      zones,
      airports,
      quote: null,
      form: req.query || {},
      minSchedule: new Date(Date.now() + 30 * 60 * 1000).toISOString().slice(0, 16),
    });
  } catch (error) { return next(error); }
}

async function taxiQuote(req, res, next) {
  try {
    const payload = stripClientSuppliedIdentity(req.body);
    const [quote, listings, zones, airports] = await Promise.all([
      taxiService.quoteRide(payload),
      repository.listings.list({ serviceType: 'taxi', status: 'active', bookable: true }, { sort: { isFeatured: -1, title: 1 }, limit: 200 }),
      repository.taxiServiceZones.list({ status: 'active' }, { sort: { country: 1, cityOrDistrict: 1 }, limit: 500 }),
      repository.airports.list({ status: 'active' }, { sort: { country: 1, city: 1 }, limit: 500 }),
    ]);
    return res.render('pages/taxi/index', {
      seo: { title: `Taxi quote ${quote.pricing.currency} ${quote.pricing.total.toLocaleString()} | Classic Trip` },
      listings,
      zones,
      airports,
      quote,
      form: payload,
      minSchedule: new Date(Date.now() + 30 * 60 * 1000).toISOString().slice(0, 16),
    });
  } catch (error) { return next(error); }
}

async function createTaxiBooking(req, res, next) {
  try {
    const booking = await taxiService.createGuestBooking(stripClientSuppliedIdentity(req.body), req);
    ticketAccessService.grantSessionAccess(req, booking.bookingRef);
    if (booking.trackingToken) {
      req.session.taxiTracking = req.session.taxiTracking || {};
      req.session.taxiTracking[booking.rideRef || booking.bookingLegs?.[0]?.rideRef] = {
        token: booking.trackingToken,
        pickupPin: booking.pickupPin,
        bookingRef: booking.bookingRef,
      };
    }
    if (booking.checkoutUrl && booking.paymentStatus !== 'successful') return res.redirect(303, booking.checkoutUrl);
    const rideRef = booking.rideRef || booking.bookingLegs?.[0]?.rideRef || '';
    return rideRef ? res.redirect(303, `/taxi/rides/${encodeURIComponent(rideRef)}`) : res.redirect(303, `/booking/success/${encodeURIComponent(booking.bookingRef)}`);
  } catch (error) { return next(error); }
}

async function taxiTracking(req, res, next) {
  try {
    const rideRef = clean(req.params.rideRef);
    const sessionAccess = req.session?.taxiTracking?.[rideRef] || {};
    const token = clean(req.query.token || sessionAccess.token);
    if (!token) {
      return res.status(403).render('pages/error', {
        seo: { title: 'Ride access required | Classic Trip' },
        status: 403,
        message: 'Open this ride from the booking confirmation or provide its secure tracking token.',
      });
    }
    const tracking = await taxiService.publicTracking(rideRef, token);
    return res.render('pages/taxi/tracking', {
      seo: { title: `${tracking.rideRef} tracking | Classic Trip` },
      tracking,
      trackingToken: token,
      pickupPin: sessionAccess.pickupPin || '',
    });
  } catch (error) { return next(error); }
}

module.exports = { flights, flightOffer, createFlightBooking, taxi, taxiQuote, createTaxiBooking, taxiTracking };
