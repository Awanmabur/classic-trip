'use strict';

const flightBookingService = require('../modules/flight/services/flightBookingService');
const taxiBookingService = require('../modules/taxi/services/taxiBookingService');

async function run() {
  const now = new Date();
  return {
    flightSeatHolds: await flightBookingService.expireSeatHolds(now),
    taxiScheduledDispatch: await taxiBookingService.dispatchScheduledRides(now),
    taxiExpiredOffers: await taxiBookingService.expireOffers(now),
  };
}

module.exports = { run };
