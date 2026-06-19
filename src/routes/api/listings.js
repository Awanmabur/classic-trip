const express = require('express');
const store = require('../../services/data/persistentStore');
const seatLockService = require('../../services/booking/seatLockService');
const roomReservationService = require('../../services/booking/roomReservationService');
const releaseRoadmapService = require('../../services/release/releaseRoadmapService');
const router = express.Router();

function cleanSeatToken(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withoutPrefix = raw.replace(/^seat\s*(no\.?|number)?\s*/i, '').trim();
  const legacy = withoutPrefix.match(/^[A-Za-z](\d+)$/);
  return legacy ? legacy[1] : withoutPrefix;
}

function seatList(value) {
  if (Array.isArray(value)) return value.flatMap((item) => seatList(item));
  return String(value || '').split(',').map((seat) => cleanSeatToken(seat)).filter(Boolean);
}

router.get('/', (req, res) => {
  const data = store.searchListings(req.query);
  res.json({ data, meta: store.marketplaceInfo(data) });
});
router.get('/featured', (req, res) => res.json({ data: store.state.listings.filter((item) => item.isFeatured).slice(0, 24) }));
router.get('/release-roadmap', (req, res) => res.json(releaseRoadmapService.roadmap()));
router.get('/:id/availability', (req, res) => {
  const availability = store.getAvailability(req.params.id);
  if (!availability) return res.status(404).json({ error: 'listing_not_found' });
  return res.json(availability);
});
router.post('/:id/hold', async (req, res) => {
  try {
    const availability = store.getAvailability(req.params.id);
    if (!availability) return res.status(404).json({ error: 'listing_not_found' });
    if (availability.listing.serviceType === 'bus') {
      const schedule = availability.schedules.find((item) => item.id === req.body.scheduleId) || availability.schedules[0];
      const requestedSeats = seatList(req.body.selectedSeats || req.body.selected || req.body.seatNumber);
      const selectedSeats = requestedSeats.length ? requestedSeats : [availability.seats.find((seat) => seat.status === 'available')?.seatNumber].filter(Boolean);
      if (!schedule || !selectedSeats.length) return res.status(409).json({ error: 'no_available_seat' });
      const hold = await seatLockService.lockSeatsPersistent(schedule.id, selectedSeats, 10, {
        listingId: availability.listing.id,
        companyId: availability.listing.companyId,
        serviceType: availability.listing.serviceType,
        createdBy: req.session?.user?.id || '',
      });
      return res.status(201).json({ hold: { id: hold.id, type: hold.type, listingId: availability.listing.id, scheduleId: schedule.id, selected: selectedSeats[0], selectedSeats, lockedUntil: hold.lockedUntil } });
    }
    if (availability.listing.serviceType === 'hotel') {
      const room = availability.rooms.find((item) => item.id === req.body.roomId) || availability.rooms.find((item) => item.inventory > 0);
      if (!room) return res.status(409).json({ error: 'no_available_room' });
      const hold = await roomReservationService.reserveRoomPersistent(room.id, req.body.guest || {}, 10, {
        listingId: availability.listing.id,
        companyId: availability.listing.companyId,
        serviceType: availability.listing.serviceType,
        selectedLabel: room.roomType,
        createdBy: req.session?.user?.id || '',
      });
      return res.status(201).json({ hold: { id: hold.id, type: 'room', listingId: availability.listing.id, roomId: room.id, selected: room.roomType, lockedUntil: hold.expiresAt } });
    }
    return res.status(409).json({ error: 'listing_not_bookable' });
  } catch (error) {
    return res.status(409).json({ error: error.message });
  }
});

module.exports = router;
