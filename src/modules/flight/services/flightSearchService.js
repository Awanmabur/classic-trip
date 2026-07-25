'use strict';

const repo = require('../repositories/flightRepository');
const { cleanText, normalize, integerValue, dateValue, validationError, conflictError, randomToken, hashToken, immutable } = require('../domain/flightDomain');
const { adapterFor } = require('./flightSupplierRegistry');

const CABINS = ['economy', 'premium_economy', 'business', 'first'];
function now() { return new Date(); }
function endOfDay(value) { const d = new Date(value); d.setHours(23, 59, 59, 999); return d; }
function startOfDay(value) { const d = new Date(value); d.setHours(0, 0, 0, 0); return d; }
function passengerCounts(payload = {}) {
  const adults = integerValue(payload.adults, 'Adults', 1, 9, 1);
  const children = integerValue(payload.children, 'Children', 0, 8, 0);
  const infants = integerValue(payload.infants, 'Infants', 0, adults, 0);
  if (adults + children + infants > 9) throw validationError('A flight booking may contain at most 9 travelers');
  return { adults, children, infants, totalSeats: adults + children, totalTravelers: adults + children + infants };
}
async function airport(value, label) {
  const code = cleanText(value, 180).toUpperCase();
  const row = await repo.airports.findOne({ status: 'active', $or: [{ id: code }, { iataCode: code }] });
  if (!row) throw validationError(`${label} airport was not found`, 404);
  return row;
}
async function supplierForDeparture(departure) {
  if (!departure.supplierId) return { id: '', mode: 'native_inventory', status: 'active', capabilities: ['search','reprice','seat_map','order','ticket','refund','exchange','schedule_change'] };
  return repo.oneOrThrow(repo.suppliers, { id: departure.supplierId, companyId: departure.companyId }, 'Flight supplier was not found');
}
function totalPrice(fare, counts, ancillaryTotal = 0) {
  const adultBase = Number(fare.basePrice || 0) * counts.adults;
  const childBase = Number(fare.basePrice || 0) * 0.75 * counts.children;
  const infantBase = Number(fare.basePrice || 0) * 0.1 * counts.infants;
  const base = Math.round((adultBase + childBase + infantBase) * 100) / 100;
  const taxes = Math.round(base * 0.12 * 100) / 100;
  const serviceFee = Math.round(Math.max(0, base * 0.025) * 100) / 100;
  const total = Math.round((base + taxes + serviceFee + Number(ancillaryTotal || 0)) * 100) / 100;
  return { base, taxes, serviceFee, ancillaryTotal: Number(ancillaryTotal || 0), total, currency: fare.currency, breakdown: { adults: counts.adults, children: counts.children, infants: counts.infants } };
}
async function nativeOffersForLeg({ origin, destination, date, cabinClass, counts }) {
  const departures = await repo.departures.list({
    originAirportId: origin.id,
    destinationAirportId: destination.id,
    publicationStatus: 'published',
    operationalStatus: { $in: ['scheduled', 'check_in_open', 'delayed'] },
    departAt: { $gte: startOfDay(date), $lte: endOfDay(date) },
  }, { sort: { departAt: 1 }, limit: 250 });
  const results = [];
  for (const departure of departures) {
    const supplier = await supplierForDeparture(departure);
    if (supplier.mode !== 'native_inventory') {
      const adapter = adapterFor(supplier, 'search');
      const external = await adapter.search({ departure, origin, destination, date, cabinClass, counts });
      results.push(...(Array.isArray(external) ? external : []));
      continue;
    }
    const available = await repo.seatInventory.count({ departureId: departure.id, cabinClass, status: 'available' });
    if (available < counts.totalSeats) continue;
    const fares = await repo.fareFamilies.list({ companyId: departure.companyId, airlineId: departure.airlineId, cabinClass, status: 'active', $or: [{ routeId: departure.routeId }, { routeId: '' }, { routeId: null }] }, { sort: { basePrice: 1 } });
    const listing = await repo.listings.findOne({ id: departure.listingId, companyId: departure.companyId, bookable: true });
    const airline = await repo.airlines.findOne({ id: departure.airlineId, companyId: departure.companyId, status: 'active' });
    if (!listing || !airline) continue;
    for (const fare of fares) {
      const token = randomToken();
      const priceSnapshot = totalPrice(fare, counts);
      const offer = {
        id: await repo.nextId('flight-offer'), publicTokenHash: hashToken(token), companyId: departure.companyId,
        supplierId: departure.supplierId || '', supplierOfferRef: '', listingId: departure.listingId, tripType: 'one_way',
        segments: [{ departureId: departure.id, flightNumber: departure.flightNumber, airlineId: departure.airlineId, originAirportId: origin.id, destinationAirportId: destination.id, departAt: departure.departAt, arriveAt: departure.arriveAt, aircraftId: departure.aircraftId, cabinClass, fareFamilyId: fare.id }],
        passengerCounts: immutable(counts), fareFamilyId: fare.id, priceSnapshot: immutable(priceSnapshot),
        baggageSnapshot: { checkedKg: fare.checkedBaggageKg || 0, cabinKg: fare.cabinBaggageKg || 0 },
        policySnapshot: { refundable: Boolean(fare.refundable), changeable: Boolean(fare.changeable), changeFee: Number(fare.changeFee || 0), cancellationFee: Number(fare.cancellationFee || 0), noShowFee: Number(fare.noShowFee || 0), terms: fare.policySnapshot?.terms || '' },
        sourceMode: 'native_inventory', status: 'verified', expiresAt: new Date(Date.now() + 10 * 60 * 1000), verifiedAt: now(), createdAt: now(), updatedAt: now(),
      };
      await repo.offers.save(offer, { id: offer.id });
      results.push({ offerId: offer.id, offerToken: token, expiresAt: offer.expiresAt, sourceMode: offer.sourceMode, listing: { id: listing.id, slug: listing.slug, title: listing.title, companyName: listing.companyName, primaryImage: listing.primaryImage || listing.image || null }, airline: { id: airline.id, name: airline.name, iataCode: airline.iataCode, logo: airline.logo || null }, origin, destination, departure, fare: { id: fare.id, code: fare.code, name: fare.name, cabinClass: fare.cabinClass, mealIncluded: fare.mealIncluded, seatSelectionIncluded: fare.seatSelectionIncluded }, availableSeats: available, baggage: offer.baggageSnapshot, policy: offer.policySnapshot, price: priceSnapshot });
    }
  }
  return results;
}
async function search(payload = {}) {
  const origin = await airport(payload.originAirportId || payload.origin, 'Origin');
  const destination = await airport(payload.destinationAirportId || payload.destination, 'Destination');
  if (origin.id === destination.id) throw validationError('Origin and destination airports must be different');
  const departureDate = dateValue(payload.departureDate || payload.departAt, 'Departure date');
  if (endOfDay(departureDate).getTime() < Date.now()) throw validationError('Departure date cannot be in the past');
  const cabinClass = normalize(payload.cabinClass || 'economy');
  if (!CABINS.includes(cabinClass)) throw validationError('Cabin class is invalid');
  const counts = passengerCounts(payload);
  const outbound = await nativeOffersForLeg({ origin, destination, date: departureDate, cabinClass, counts });
  let inbound = [];
  let roundTrips = [];
  const tripType = normalize(payload.tripType || (payload.returnDate ? 'round_trip' : 'one_way'));
  if (tripType === 'round_trip') {
    if (!payload.returnDate) throw validationError('Return date is required for a round trip');
    const returnDate = dateValue(payload.returnDate, 'Return date');
    if (startOfDay(returnDate) < startOfDay(departureDate)) throw validationError('Return date cannot be before departure date');
    inbound = await nativeOffersForLeg({ origin: destination, destination: origin, date: returnDate, cabinClass, counts });
    const combinations = [];
    for (const out of outbound.slice(0, 30)) {
      for (const back of inbound.slice(0, 30)) {
        if (String(out.departure?.companyId || '') !== String(back.departure?.companyId || '')) continue;
        if (String(out.listing?.id || '') !== String(back.listing?.id || '')) continue;
        combinations.push({ out, back, total: Number(out.price?.total || 0) + Number(back.price?.total || 0) });
      }
    }
    combinations.sort((a, b) => a.total - b.total);
    for (const pair of combinations.slice(0, 80)) {
      const [outOffer, backOffer] = await Promise.all([
        repo.offers.findOne({ id: pair.out.offerId }),
        repo.offers.findOne({ id: pair.back.offerId }),
      ]);
      if (!outOffer || !backOffer || outOffer.sourceMode !== backOffer.sourceMode) continue;
      const token = randomToken();
      const priceSnapshot = {
        currency: outOffer.priceSnapshot.currency,
        base: Number(outOffer.priceSnapshot.base || 0) + Number(backOffer.priceSnapshot.base || 0),
        taxes: Number(outOffer.priceSnapshot.taxes || 0) + Number(backOffer.priceSnapshot.taxes || 0),
        serviceFee: Number(outOffer.priceSnapshot.serviceFee || 0) + Number(backOffer.priceSnapshot.serviceFee || 0),
        ancillaryTotal: Number(outOffer.priceSnapshot.ancillaryTotal || 0) + Number(backOffer.priceSnapshot.ancillaryTotal || 0),
        total: Number(outOffer.priceSnapshot.total || 0) + Number(backOffer.priceSnapshot.total || 0),
        breakdown: immutable(counts),
      };
      const combined = {
        id: await repo.nextId('flight-offer'), publicTokenHash: hashToken(token), companyId: outOffer.companyId,
        supplierId: outOffer.supplierId || '', supplierOfferRef: '', listingId: outOffer.listingId, tripType: 'round_trip',
        segments: [...(outOffer.segments || []), ...(backOffer.segments || [])], passengerCounts: immutable(counts),
        fareFamilyId: outOffer.fareFamilyId, priceSnapshot: immutable(priceSnapshot),
        baggageSnapshot: { outbound: immutable(outOffer.baggageSnapshot || {}), inbound: immutable(backOffer.baggageSnapshot || {}) },
        policySnapshot: { outbound: immutable(outOffer.policySnapshot || {}), inbound: immutable(backOffer.policySnapshot || {}) },
        sourceMode: outOffer.sourceMode, status: 'verified', expiresAt: new Date(Math.min(new Date(outOffer.expiresAt).getTime(), new Date(backOffer.expiresAt).getTime())), verifiedAt: now(), createdAt: now(), updatedAt: now(),
      };
      await repo.offers.save(combined, { id: combined.id });
      roundTrips.push({
        offerId: combined.id, offerToken: token, expiresAt: combined.expiresAt, sourceMode: combined.sourceMode,
        listing: pair.out.listing, airline: pair.out.airline, origin, destination,
        departure: pair.out.departure, returnDeparture: pair.back.departure,
        segments: combined.segments, fare: pair.out.fare,
        availableSeats: Math.min(Number(pair.out.availableSeats || 0), Number(pair.back.availableSeats || 0)),
        baggage: combined.baggageSnapshot, policy: combined.policySnapshot, price: combined.priceSnapshot, tripType: 'round_trip',
      });
    }
  }
  return { criteria: { origin, destination, departureDate, returnDate: payload.returnDate || null, cabinClass, counts, tripType }, outbound, inbound, roundTrips };
}
async function readOffer(offerId, offerToken) {
  const offer = await repo.oneOrThrow(repo.offers, { id: cleanText(offerId, 180) }, 'Flight offer was not found');
  if (!offerToken || hashToken(offerToken) !== offer.publicTokenHash) throw validationError('Flight offer token is invalid', 403, 'invalid_offer_token');
  if (new Date(offer.expiresAt).getTime() <= Date.now()) { offer.status = 'expired'; await repo.offers.save(offer, { id: offer.id }); throw conflictError('Flight offer has expired. Search again for current availability and pricing.', 'offer_expired'); }
  if (!['created', 'verified'].includes(offer.status)) throw conflictError('Flight offer is no longer bookable', 'offer_unavailable');
  return offer;
}
async function reprice(offerId, offerToken) {
  const offer = await readOffer(offerId, offerToken);
  if (offer.sourceMode !== 'native_inventory') {
    const supplier = await repo.oneOrThrow(repo.suppliers, { id: offer.supplierId, companyId: offer.companyId }, 'Flight supplier was not found');
    const adapter = adapterFor(supplier, 'reprice');
    const result = await adapter.reprice({ offer });
    if (!result || !Number.isFinite(Number(result.priceSnapshot?.total))) throw conflictError('Flight supplier did not return a valid repriced offer', 'supplier_reprice_failed');
    offer.priceSnapshot = immutable(result.priceSnapshot); offer.verifiedAt = now(); offer.expiresAt = new Date(Date.now() + 10 * 60 * 1000); offer.status = 'verified';
    await repo.offers.save(offer, { id: offer.id }); return offer;
  }
  const segments = Array.isArray(offer.segments) ? offer.segments : [];
  if (!segments.length) throw conflictError('Flight offer has no bookable segments', 'flight_offer_invalid');
  const legPrices = [];
  for (const segment of segments) {
    const departure = await repo.oneOrThrow(repo.departures, { id: segment.departureId, companyId: offer.companyId, publicationStatus: 'published' }, 'Flight departure is no longer available');
    const fare = await repo.oneOrThrow(repo.fareFamilies, { id: segment.fareFamilyId || offer.fareFamilyId, companyId: offer.companyId, status: 'active' }, 'Flight fare is no longer available');
    const available = await repo.seatInventory.count({ departureId: departure.id, cabinClass: segment.cabinClass, status: 'available' });
    if (available < Number(offer.passengerCounts?.totalSeats || 1)) throw conflictError(`Not enough seats remain for flight ${segment.flightNumber || ''}`.trim(), 'flight_inventory_unavailable');
    legPrices.push(totalPrice(fare, offer.passengerCounts || { adults: 1, children: 0, infants: 0 }));
  }
  offer.priceSnapshot = immutable(legPrices.reduce((sum, row) => ({
    currency: sum.currency || row.currency,
    base: sum.base + Number(row.base || 0), taxes: sum.taxes + Number(row.taxes || 0),
    serviceFee: sum.serviceFee + Number(row.serviceFee || 0), ancillaryTotal: sum.ancillaryTotal + Number(row.ancillaryTotal || 0),
    total: sum.total + Number(row.total || 0), breakdown: immutable(offer.passengerCounts || {}),
  }), { currency: '', base: 0, taxes: 0, serviceFee: 0, ancillaryTotal: 0, total: 0, breakdown: {} }));
  offer.verifiedAt = now(); offer.expiresAt = new Date(Date.now() + 10 * 60 * 1000); offer.status = 'verified';
  await repo.offers.save(offer, { id: offer.id }); return offer;
}
async function seatMap(departureId, cabinClass = '') {
  const departure = await repo.oneOrThrow(repo.departures, { id: cleanText(departureId, 180), publicationStatus: 'published' }, 'Flight departure was not found');
  const supplier = await supplierForDeparture(departure);
  if (supplier.mode !== 'native_inventory') {
    const adapter = adapterFor(supplier, 'seat_map');
    return adapter.seatMap({ departure, cabinClass: normalize(cabinClass) });
  }
  const seatMapVersion = await repo.oneOrThrow(repo.seatMaps, { id: departure.seatMapVersionId, companyId: departure.companyId, status: 'published' }, 'Published seat map was not found');
  const filter = { departureId: departure.id };
  if (cabinClass) filter.cabinClass = normalize(cabinClass);
  const inventory = await repo.seatInventory.list(filter, { sort: { seatNumber: 1 }, limit: 1500 });
  const publicSeats = inventory.map((seat) => ({ id: seat.id, seatNumber: seat.seatNumber, cabinClass: seat.cabinClass, seatType: seat.seatType, status: seat.status === 'available' ? 'available' : 'unavailable' }));
  return { departure: { id: departure.id, flightNumber: departure.flightNumber, departAt: departure.departAt, arriveAt: departure.arriveAt, originAirportId: departure.originAirportId, destinationAirportId: departure.destinationAirportId }, seatMap: { id: seatMapVersion.id, name: seatMapVersion.name, version: seatMapVersion.version, layoutCode: seatMapVersion.layoutCode, deckCount: seatMapVersion.deckCount }, seats: publicSeats };
}
async function listAirports(query = '') {
  const text = cleanText(query, 80);
  const filter = { status: 'active' };
  if (text) filter.$or = [{ iataCode: text.toUpperCase() }, { name: { $regex: text, $options: 'i' } }, { city: { $regex: text, $options: 'i' } }, { country: { $regex: text, $options: 'i' } }];
  return repo.airports.list(filter, { sort: { country: 1, city: 1 }, limit: 100 });
}
module.exports = { search, readOffer, reprice, seatMap, listAirports, passengerCounts, totalPrice };
