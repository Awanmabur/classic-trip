const express = require('express');
const { publicReadLimiter, publicWriteLimiter } = require('../../middlewares/rateLimit');
const catalogService = require('../../services/marketplace/catalogService');
const busInventoryService = require('../../modules/bus/services/busInventoryService');
const hotelInventoryService = require('../../services/hotel/hotelInventoryService');

const router = express.Router();

function clean(value) { return String(value || '').trim(); }
function uniqueCsv(value) {
  return [...new Set((Array.isArray(value) ? value : String(value || '').split(','))
    .map((item) => clean(item)).filter(Boolean))];
}
function publicListing(data, identifier) {
  const raw = catalogService.listingFor(data, identifier);
  if (!raw || !catalogService.isPublicListing(raw, data)) return null;
  return { raw, listing: catalogService.catalogItem(data, raw) };
}
function assertBookable(listing) {
  if (!listing?.bookable) throw Object.assign(new Error('This listing is not open for booking'), { status: 409 });
}
function assertFutureStay(checkIn, checkOut) {
  const range = hotelInventoryService.dateRange(checkIn, checkOut);
  const today = new Date().toISOString().slice(0, 10);
  if (range.checkIn < today) throw Object.assign(new Error('Check-in cannot be in the past'), { status: 422 });
  if (range.nights.length > 90) throw Object.assign(new Error('A stay cannot exceed 90 nights'), { status: 422 });
  return range;
}

router.get('/', publicReadLimiter, async (req, res, next) => {
  try {
    const { results, meta } = await catalogService.searchWithMeta(req.query);
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const start = (page - 1) * limit;
    res.json({ data: results.slice(start, start + limit), meta: { ...meta, page, limit, pages: Math.max(1, Math.ceil(results.length / limit)) } });
  } catch (error) { next(error); }
});


router.get('/:listingId/availability', publicReadLimiter, async (req, res, next) => {
  try {
    const data = await catalogService.snapshot();
    const found = publicListing(data, req.params.listingId);
    if (!found) return res.status(404).json({ error: 'Listing not found' });
    const { raw, listing } = found;
    if (listing.serviceType === 'bus') {
      const scheduleId = clean(req.query.scheduleId || listing.scheduleId);
      if (!scheduleId) return res.status(422).json({ error: 'Schedule is required' });
      const availability = await busInventoryService.getAvailability({
        scheduleId,
        originStopId: clean(req.query.originStopId),
        destinationStopId: clean(req.query.destinationStopId),
        holdId: clean(req.query.holdId),
      });
      if (String(availability.schedule.listingId) !== String(raw.id)) return res.status(404).json({ error: 'Schedule not found for this listing' });
      return res.json({ listingId: raw.id, scheduleId, ...availability });
    }
    if (listing.serviceType === 'hotel') {
      if (req.query.checkIn && req.query.checkOut) {
        const range = assertFutureStay(req.query.checkIn, req.query.checkOut);
        const availability = await hotelInventoryService.availabilityForRange(raw.id, range.checkIn, range.checkOut);
        return res.json({ listingId: raw.id, checkIn: availability.checkIn, checkOut: availability.checkOut, nights: availability.nights.length, rooms: availability.rooms });
      }
      const rooms = await hotelInventoryService.inventorySummary(raw.id);
      return res.json({ listingId: raw.id, rooms: rooms.map((room) => ({ id: room.id, roomTypeId: room.id, roomType: room.name || room.roomType, nightlyPrice: Number(room.basePrice || room.nightlyPrice || 0), inventory: Number(room.availableUnits || room.inventory || 0), capacity: Number(room.capacity || 1), bedType: room.bedType || '' })) });
    }
    return res.json({ listingId: raw.id, availability: catalogService.availability(data, listing) });
  } catch (error) { next(error); }
});

router.post('/:listingId/hold', publicWriteLimiter, async (req, res, next) => {
  try {
    const data = await catalogService.snapshot();
    const found = publicListing(data, req.params.listingId);
    if (!found) return res.status(404).json({ error: 'Listing not found' });
    const { raw, listing } = found;
    assertBookable(listing);
    const context = {
      listingId: raw.id,
      companyId: raw.companyId,
      serviceType: listing.serviceType,
      source: 'public_listing_hold',
      createdBy: req.session?.user?.id || '',
      meta: { ip: req.ip || '', userAgent: clean(req.headers['user-agent']).slice(0, 300) },
    };
    if (listing.serviceType === 'bus') {
      const scheduleId = clean(req.body.scheduleId);
      const seatNumbers = uniqueCsv(req.body.selectedSeats || req.body.selected);
      if (!scheduleId || !seatNumbers.length) throw Object.assign(new Error('Schedule and at least one seat are required'), { status: 422 });
      const hold = await busInventoryService.holdSeats({
        scheduleId,
        originStopId: clean(req.body.originStopId),
        destinationStopId: clean(req.body.destinationStopId),
        selectedSeats: seatNumbers,
        context,
      });
      if (String(hold.listingId) !== String(raw.id) || String(hold.companyId) !== String(raw.companyId)) {
        await busInventoryService.releaseHold(hold.id, 'released', 'listing-scope-check');
        throw Object.assign(new Error('Schedule not found for this listing'), { status: 404 });
      }
      return res.status(201).json({ hold: {
        id: hold.id,
        type: hold.holdType,
        scheduleId,
        accessToken: hold.accessToken,
        seatNumbers: hold.seatNumbers,
        itemCount: hold.itemCount,
        lockedUntil: hold.expiresAt,
        journey: hold.journey,
        fare: hold.fare,
      } });
    }
    if (listing.serviceType === 'hotel') {
      throw Object.assign(new Error('A separate hotel hold is not required. Room-night inventory is protected atomically when checkout starts.'), { status: 409, code: 'hotel_checkout_reserves_inventory' });
    }
    throw Object.assign(new Error('Inventory holds are not supported for this service'), { status: 409 });
  } catch (error) { next(error); }
});

router.get('/:serviceType/:slug', publicReadLimiter, async (req, res, next) => {
  try {
    const data = await catalogService.snapshot();
    const raw = catalogService.listingFor(data, req.params.slug, req.params.serviceType);
    if (!raw) return res.status(404).json({ error: 'Listing not found' });
    const listing = catalogService.catalogItem(data, raw);
    res.json({ data: { ...listing, availability: catalogService.availability(data, listing), company: catalogService.companyFor(data, raw.companyId || raw.companySlug) } });
  } catch (error) { next(error); }
});
module.exports = router;
