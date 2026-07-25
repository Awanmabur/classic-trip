'use strict';

const taxiBookingService = require('../../modules/taxi/services/taxiBookingService');

function clean(value, max = 254) {
  return String(value || '').replace(/<[^>]*>/g, '').trim().slice(0, max);
}

async function trackingPage(req, res, next) {
  const bookingRef = clean(req.params.bookingRef, 120);
  const contact = clean(req.query.contact || req.query.email || req.query.phone, 254);
  const accessCode = clean(req.query.accessCode || req.query.code, 80);
  const attempted = Boolean(contact || accessCode);
  let tracking = null;
  let lookupError = '';

  if (attempted) {
    try {
      tracking = await taxiBookingService.publicTracking(bookingRef, { contact, accessCode });
    } catch (error) {
      if ([403, 404].includes(Number(error.status || error.statusCode))) lookupError = error.message;
      else return next(error);
    }
  }

  return res.render('pages/taxi-tracking', {
    seo: {
      title: `${bookingRef || 'Ride'} tracking | Classic Trip`,
      description: 'Securely view the current status, assigned driver, vehicle and pickup details for a Classic Trip local taxi ride.',
    },
    bookingRef,
    contact,
    accessCode,
    attempted,
    lookupError,
    tracking,
  });
}

module.exports = { trackingPage };
