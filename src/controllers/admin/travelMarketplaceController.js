'use strict';

const flightSetupService = require('../../modules/flight/services/flightSetupService');
const taxiSetupService = require('../../modules/taxi/services/taxiSetupService');
const taxiBookingService = require('../../modules/taxi/services/taxiBookingService');

function actorId(req) { return req.session?.user?.id || 'super-admin'; }
function respond(req, res, data, fallback = '/admin/travel-marketplace') {
  if (req.accepts(['html', 'json']) === 'json' || req.xhr) return res.json({ data });
  if (req.flash) req.flash('success', 'Travel marketplace control updated successfully.');
  return res.redirect(req.get('referer') || fallback);
}

async function bootstrapAirports(req, res, next) { try { return respond(req, res, await flightSetupService.bootstrapAirports(actorId(req))); } catch (error) { return next(error); } }
async function createFlightSupplier(req, res, next) { try { return respond(req, res, await flightSetupService.createPlatformSupplier(req.body, actorId(req))); } catch (error) { return next(error); } }
async function reviewFlightAgency(req, res, next) { try { return respond(req, res, await flightSetupService.reviewAgencyProfile(req.params.companyId, req.body, actorId(req))); } catch (error) { return next(error); } }
async function grantFlightSupplierAccess(req, res, next) { try { return respond(req, res, await flightSetupService.grantSupplierAccess(req.params.companyId, req.body, actorId(req))); } catch (error) { return next(error); } }
async function importFlightOffer(req, res, next) { try { return respond(req, res, await flightSetupService.importSupplierOffer(req.params.companyId, req.body, actorId(req))); } catch (error) { return next(error); } }
async function publishFlightOffer(req, res, next) { try { return respond(req, res, await flightSetupService.publishImportedOffer(req.params.companyId, req.params.departureId, actorId(req))); } catch (error) { return next(error); } }
async function transitionFlightOffer(req, res, next) { try { return respond(req, res, await flightSetupService.transitionImportedOffer(req.params.companyId, req.params.departureId, req.body.status, actorId(req))); } catch (error) { return next(error); } }

async function saveTaxiMarketplace(req, res, next) { try { return respond(req, res, await taxiSetupService.createMarketplaceListing(req.body, actorId(req))); } catch (error) { return next(error); } }
async function createTaxiZone(req, res, next) { try { return respond(req, res, await taxiSetupService.createPlatformZone(req.body, actorId(req))); } catch (error) { return next(error); } }
async function createTaxiFare(req, res, next) { try { return respond(req, res, await taxiSetupService.createPlatformFareRule(req.body, actorId(req))); } catch (error) { return next(error); } }
async function reviewTaxiFleet(req, res, next) { try { return respond(req, res, await taxiSetupService.reviewFleetProfile(req.params.companyId, req.body, actorId(req))); } catch (error) { return next(error); } }
async function reviewTaxiVehicle(req, res, next) { try { return respond(req, res, await taxiSetupService.reviewVehicle(req.params.companyId, req.params.vehicleId, req.body, actorId(req))); } catch (error) { return next(error); } }
async function dispatchTaxiRide(req, res, next) { try { return respond(req, res, await taxiBookingService.dispatchRide('platform', req.params.rideId, actorId(req))); } catch (error) { return next(error); } }
async function transitionTaxiRide(req, res, next) { try { return respond(req, res, await taxiBookingService.transitionRide('platform', req.params.rideId, req.body.status, { actorId: actorId(req), platformOverride: true, reason: req.body.reason })); } catch (error) { return next(error); } }

module.exports = {
  bootstrapAirports, createFlightSupplier, reviewFlightAgency, grantFlightSupplierAccess,
  importFlightOffer, publishFlightOffer, transitionFlightOffer,
  saveTaxiMarketplace, createTaxiZone, createTaxiFare, reviewTaxiFleet, reviewTaxiVehicle,
  dispatchTaxiRide, transitionTaxiRide,
};
