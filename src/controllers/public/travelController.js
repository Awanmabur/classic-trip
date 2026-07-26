'use strict';

const roadRoutingService = require('../../services/location/roadRoutingService');

function flightPage(req, res) {
  return res.render('pages/flights', {
    seo: {
      title: 'Book flights across East Africa | Classic Trip',
      description: 'Compare verified flight offers, baggage, fare conditions and available seats, then book securely with support from accredited flight agents.',
      canonicalPath: '/flights',
      schema: { '@type': 'Service', name: 'East Africa flight booking', serviceType: 'Flight search and agent-supported booking', areaServed: 'East Africa' },
    },
    initialQuery: req.query || {},
  });
}

function flightOrderPage(req, res) {
  return res.render('pages/flight-order', {
    seo: {
      title: `${req.params.reference} flight booking | Classic Trip`,
      description: 'Retrieve a protected Classic Trip flight order, e-ticket, seats, and booking status.',
      robots: 'noindex,nofollow',
    },
    reference: String(req.params.reference || '').trim(),
    lookupCode: String(req.query.lookupCode || req.query.code || '').trim(),
  });
}

function taxiPage(req, res) {
  return res.render('pages/taxi', {
    seo: {
      title: 'Safe boda and car rides across East Africa | Classic Trip',
      description: 'Request verified boda and car rides with upfront pricing for everyday journeys, airports, offices, districts and intercity travel.',
      canonicalPath: '/taxi',
      schema: { '@type': 'Service', name: 'Safe local mobility', serviceType: 'Boda, car, airport and intercity rides', areaServed: 'East Africa' },
    },
    initialQuery: req.query || {},
    mapConfig: roadRoutingService.publicMapConfig(),
  });
}

function taxiRidePage(req, res) {
  return res.render('pages/taxi-track', {
    seo: {
      title: `${req.params.reference} local ride | Classic Trip`,
      description: 'Securely track a Classic Trip local taxi ride and view the assigned driver and vehicle.',
      robots: 'noindex,nofollow',
    },
    reference: String(req.params.reference || '').trim(),
    lookupCode: String(req.query.lookupCode || req.query.code || '').trim(),
    mapConfig: roadRoutingService.publicMapConfig(),
  });
}

module.exports = { flightPage, flightOrderPage, taxiPage, taxiRidePage };
