const express = require('express');
const store = require('../../services/data/demoStore');
const seatLockService = require('../../services/booking/seatLockService');
const roomReservationService = require('../../services/booking/roomReservationService');
const releaseRoadmapService = require('../../services/release/releaseRoadmapService');
const { mongoose } = require('../../config/db');
const router = express.Router();

async function persistSeatHold(hold) {
  if (mongoose.connection.readyState !== 1) return;
  const Seat = require('../../models/Seat');
  await Seat.updateOne(
    { scheduleId: hold.scheduleId, seatNumber: hold.seatNumber },
    { $set: { status: 'locked', lockedUntil: hold.lockedUntil, lockId: hold.id } }
  );
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
      const selected = req.body.selected || req.body.seatNumber || availability.seats.find((seat) => seat.status === 'available')?.seatNumber;
      if (!schedule || !selected) return res.status(409).json({ error: 'no_available_seat' });
      const hold = seatLockService.lockSeat(schedule.id, selected);
      await persistSeatHold(hold);
      return res.status(201).json({ hold: { id: hold.id, type: hold.type, listingId: availability.listing.id, scheduleId: schedule.id, selected, lockedUntil: hold.lockedUntil } });
    }
    if (availability.listing.serviceType === 'hotel') {
      const room = availability.rooms.find((item) => item.id === req.body.roomId) || availability.rooms.find((item) => item.inventory > 0);
      if (!room) return res.status(409).json({ error: 'no_available_room' });
      const hold = roomReservationService.reserveRoom(room.id, req.body.guest || {});
      return res.status(201).json({ hold: { id: hold.id, type: 'room', listingId: availability.listing.id, roomId: room.id, selected: room.roomType, lockedUntil: hold.expiresAt } });
    }
    return res.status(409).json({ error: 'listing_not_bookable' });
  } catch (error) {
    return res.status(409).json({ error: error.message });
  }
});

module.exports = router;
