'use strict';

const express = require('express');
const { publicReadLimiter, publicWriteLimiter } = require('../../../middlewares/rateLimit');
const inventoryService = require('../services/busInventoryService');
const searchService = require('../services/busSearchService');

const router = express.Router();
function clean(value) { return String(value || '').trim(); }
function uniqueCsv(value) {
  return [...new Set((Array.isArray(value) ? value : String(value || '').split(','))
    .map((item) => clean(item)).filter(Boolean))];
}

router.get('/departures/:scheduleId/availability', publicReadLimiter, async (req, res, next) => {
  try {
    const holdId = clean(req.query.holdId);
    if (holdId) {
      const holdToken = clean(req.headers['x-hold-token']);
      if (!holdToken) throw Object.assign(new Error('Seat-hold access token is required'), { status: 403 });
      const hold = await inventoryService.assertActiveHold(holdId, holdToken);
      if (hold.scheduleId !== clean(req.params.scheduleId)) throw Object.assign(new Error('Seat hold belongs to another departure'), { status: 403 });
    }
    const availability = await inventoryService.getAvailability({
      scheduleId: clean(req.params.scheduleId),
      originStopId: clean(req.query.originStopId),
      destinationStopId: clean(req.query.destinationStopId),
      holdId,
    });
    return res.json(availability);
  } catch (error) { return next(error); }
});

router.get('/departures/:scheduleId/returns', publicReadLimiter, async (req, res, next) => {
  try {
    const result = await searchService.findReturnsForDeparture({
      scheduleId: clean(req.params.scheduleId),
      originStopId: clean(req.query.originStopId),
      destinationStopId: clean(req.query.destinationStopId),
    });
    return res.json(result);
  } catch (error) { return next(error); }
});

router.delete('/holds/:holdId', publicWriteLimiter, async (req, res, next) => {
  try {
    const token = clean(req.body?.holdToken || req.headers['x-hold-token']);
    if (!token) throw Object.assign(new Error('Seat-hold access token is required'), { status: 403 });
    const hold = await inventoryService.assertActiveHold(clean(req.params.holdId), token);
    await inventoryService.releaseHold(hold.id, 'traveler_selection_changed', req.session?.user?.id || 'guest');
    return res.json({ released: true, holdId: hold.id });
  } catch (error) { return next(error); }
});

router.post('/departures/:scheduleId/holds', publicWriteLimiter, async (req, res, next) => {
  try {
    const selectedSeats = uniqueCsv(req.body.selectedSeats || req.body.selected);
    if (!selectedSeats.length) throw Object.assign(new Error('Select at least one seat'), { status: 422 });
    const hold = await inventoryService.holdSeats({
      scheduleId: clean(req.params.scheduleId),
      originStopId: clean(req.body.originStopId),
      destinationStopId: clean(req.body.destinationStopId),
      selectedSeats,
      context: {
        source: 'public_bus_departure_hold',
        createdBy: req.session?.user?.id || '',
        ip: req.ip || '',
        userAgent: clean(req.headers['user-agent']).slice(0, 300),
        requestId: req.id || clean(req.headers['x-request-id']),
      },
    });
    return res.status(201).json({ hold: {
      id: hold.id,
      type: hold.holdType,
      listingId: hold.listingId,
      companyId: hold.companyId,
      scheduleId: hold.scheduleId,
      accessToken: hold.accessToken,
      seatNumbers: hold.seatNumbers,
      itemCount: hold.itemCount,
      lockedUntil: hold.expiresAt,
      journey: {
        originStopId: hold.originStopId,
        destinationStopId: hold.destinationStopId,
        originOrder: hold.originOrder,
        destinationOrder: hold.destinationOrder,
        segmentIds: hold.segmentIds,
      },
    } });
  } catch (error) { return next(error); }
});

module.exports = router;
