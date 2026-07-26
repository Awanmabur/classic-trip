'use strict';

const repo = require('../repositories/taxiRepository');
const placeService = require('../../../services/location/placeService');
const setupService = require('./taxiSetupService');
const roadRoutingService = require('../../../services/location/roadRoutingService');
const { withinZone } = require('../../../services/location/geoFenceService');
const { PLATFORM_MOBILITY_OWNER } = require('../domain/taxiGovernance');
const {
  cleanText, normalize, integerValue, estimateRoadDistanceKm,
  validationError, randomToken, hashToken, safeEqual,
} = require('../domain/taxiDomain');

function now() { return new Date(); }

function serviceTypeFor(payload, pickup, destination, distanceKm) {
  const requested = normalize(payload.serviceType || '');
  if (requested && ['instant', 'scheduled', 'airport', 'intercity', 'hourly', 'corporate'].includes(requested)) return requested;
  if (pickup.type === 'airport' || destination.type === 'airport') return 'airport';
  const text = `${pickup.address} ${pickup.city} ${destination.address} ${destination.city}`.toLowerCase();
  if (/airport|international airport|airfield/.test(text)) return 'airport';
  if (distanceKm >= 50 || (pickup.district && destination.district && normalize(pickup.district) !== normalize(destination.district))) return 'intercity';
  return payload.scheduledPickupAt ? 'scheduled' : 'instant';
}

async function demandMultiplier(rule, pickupAt) {
  const [availableDrivers, waitingRides] = await Promise.all([
    repo.availability.count({ status: 'available', lastHeartbeatAt: { $gte: new Date(Date.now() - 3 * 60 * 1000) } }),
    repo.rides.count({ status: { $in: ['dispatch_pending', 'offering'] }, scheduledPickupAt: { $lte: new Date(Date.now() + 20 * 60 * 1000) } }),
  ]);
  const pressure = availableDrivers > 0 ? waitingRides / availableDrivers : (waitingRides > 0 ? 2 : 0);
  const demand = pressure > 1.5 ? 1.25 : pressure > 0.8 ? 1.1 : 1;
  const hour = pickupAt.getHours();
  const night = hour >= 22 || hour < 5 ? Number(rule.nightMultiplier || 1) : 1;
  return Math.max(Number(rule.surgeMin || 1), Math.min(Number(rule.surgeMax || 1), demand * night));
}

function price(rule, { distanceKm, durationMinutes, serviceType, surgeMultiplier }) {
  const baseFare = Number(rule.baseFare || 0);
  const distanceFare = Number(rule.perKilometer || 0) * distanceKm;
  const timeFare = Number(rule.perMinute || 0) * durationMinutes;
  const airportFee = serviceType === 'airport' ? Number(rule.airportFee || 0) : 0;
  const scheduledFee = serviceType === 'scheduled' ? Number(rule.scheduledFee || 0) : 0;
  const bookingFee = Number(rule.bookingFee || 0);
  const meteredSubtotal = Math.round((baseFare + distanceFare + timeFare) * surgeMultiplier * 100) / 100;
  const subtotal = Math.max(Number(rule.minimumFare || 0), meteredSubtotal + airportFee + scheduledFee + bookingFee);
  const tax = Math.round(subtotal * (Number(rule.taxPercent || 0) / 100) * 100) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;
  return {
    currency: rule.currency,
    baseFare,
    distanceFare: Math.round(distanceFare * 100) / 100,
    timeFare: Math.round(timeFare * 100) / 100,
    airportFee,
    scheduledFee,
    bookingFee,
    demandMultiplier: surgeMultiplier,
    tax,
    total,
    estimated: true,
    controlledBy: 'platform',
  };
}

async function resolveStops(payload = {}) {
  let rows = Array.isArray(payload.stops) ? payload.stops : [];
  if (!rows.length && payload.stopsJson) {
    try { rows = JSON.parse(payload.stopsJson); } catch (_) { throw validationError('Ride stops are invalid'); }
  }
  if (rows.length > 4) throw validationError('A ride may have at most four stops');
  return Promise.all(rows.map((stop) => placeService.resolve(stop, '')));
}

async function createQuotes(payload = {}) {
  const [pickup, destination, stops, listing] = await Promise.all([
    placeService.resolve(payload, 'pickup'),
    placeService.resolve(payload, 'destination'),
    resolveStops(payload),
    setupService.platformListing(),
  ]);
  const preliminaryDistanceKm = Math.round(estimateRoadDistanceKm(pickup, destination, stops) * 100) / 100;
  const serviceType = serviceTypeFor(payload, pickup, destination, preliminaryDistanceKm);
  const route = await roadRoutingService.planRoute({ pickup, destination, stops, serviceType });
  const distanceKm = route.distanceKm;
  const durationMinutes = route.durationMinutes;
  const passengerCount = integerValue(payload.passengerCount, 'Passengers', 1, 20, 1);
  const luggageCount = integerValue(payload.luggageCount, 'Luggage', 0, 30, 0);
  const pickupAt = payload.scheduledPickupAt ? new Date(payload.scheduledPickupAt) : now();
  if (Number.isNaN(pickupAt.getTime())) throw validationError('Pickup time is invalid');
  if (['scheduled', 'airport', 'intercity', 'corporate'].includes(serviceType) && pickupAt.getTime() < Date.now() + 15 * 60 * 1000) {
    throw validationError('Scheduled, airport and intercity rides must be booked at least 15 minutes ahead');
  }

  const zones = await repo.zones.list({ companyId: PLATFORM_MOBILITY_OWNER, status: 'active', supportedServiceTypes: serviceType }, { limit: 200 });
  const matchingZone = zones.find((zone) => withinZone(zone, pickup));
  if (!matchingZone) throw validationError('Local rides are not yet available from this pickup area', 422, 'pickup_outside_service_area');
  const classes = await repo.vehicleClasses.list({
    companyId: PLATFORM_MOBILITY_OWNER,
    status: 'active', serviceTypes: serviceType,
    passengerCapacity: { $gte: passengerCount }, luggageCapacity: { $gte: luggageCount },
  }, { sort: { sortOrder: 1, name: 1 }, limit: 50 });

  const quotes = [];
  for (const klass of classes) {
    const rule = await repo.fareRules.findOne({
      companyId: PLATFORM_MOBILITY_OWNER, vehicleClassId: klass.id, status: 'active', serviceType,
      $or: [{ serviceZoneId: matchingZone.id }, { serviceZoneId: '' }, { serviceZoneId: null }],
    });
    if (!rule) continue;
    const multiplier = await demandMultiplier(rule, pickupAt);
    const priceSnapshot = price(rule, { distanceKm, durationMinutes, serviceType, surgeMultiplier: multiplier });
    const token = randomToken();
    const quote = {
      id: await repo.nextId('ride-quote'), publicTokenHash: hashToken(token),
      companyId: PLATFORM_MOBILITY_OWNER, platformManaged: true,
      listingId: listing.id, vehicleClassId: klass.id, fareRuleId: rule.id, serviceType,
      pickup, destination, stops, scheduledPickupAt: pickupAt, distanceKm, durationMinutes, routeSnapshot: route,
      priceSnapshot, surgeMultiplier: multiplier, status: 'quoted', expiresAt: new Date(Date.now() + 5 * 60 * 1000), createdAt: now(), updatedAt: now(),
    };
    await repo.quotes.save(quote, { id: quote.id });
    quotes.push({
      quoteId: quote.id, quoteToken: token, expiresAt: quote.expiresAt, serviceType,
      pickup, destination, stops, distanceKm, durationMinutes, route, scheduledPickupAt: pickupAt,
      listing: { id: listing.id, slug: listing.slug, title: listing.title, companyName: listing.companyName, primaryImage: listing.primaryImage || listing.image || null },
      vehicleClass: klass, price: priceSnapshot,
      zone: { id: matchingZone.id, name: matchingZone.name, zoneType: matchingZone.zoneType },
    });
  }
  if (!quotes.length) throw validationError('No approved ride class is configured for this trip yet', 422, 'ride_class_unavailable');
  return { criteria: { pickup, destination, stops, distanceKm, durationMinutes, route, serviceType, scheduledPickupAt: pickupAt, passengerCount, luggageCount }, quotes };
}

async function readQuote(id, token) {
  const quote = await repo.oneOrThrow(repo.quotes, { id: cleanText(id, 180), companyId: PLATFORM_MOBILITY_OWNER }, 'Ride quote was not found');
  if (!token || !safeEqual(hashToken(token), quote.publicTokenHash)) throw validationError('Ride quote token is invalid', 403, 'invalid_quote_token');
  if (new Date(quote.expiresAt).getTime() <= Date.now()) {
    quote.status = 'expired'; await repo.quotes.save(quote, { id: quote.id });
    throw validationError('Ride quote expired. Request a new estimate.', 409, 'quote_expired');
  }
  if (quote.status !== 'quoted') throw validationError('Ride quote is no longer available', 409, 'quote_unavailable');
  return quote;
}

module.exports = { createQuotes, readQuote, price, withinZone, serviceTypeFor, demandMultiplier };
