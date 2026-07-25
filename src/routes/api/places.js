'use strict';
const express = require('express');
const { publicReadLimiter } = require('../../middlewares/rateLimit');
const placeService = require('../../services/location/placeService');
const router = express.Router();
router.get('/search', publicReadLimiter, async (req, res, next) => {
  try { res.json({ places: await placeService.search(req.query.q, { countryCode: req.query.countryCode, limit: req.query.limit }) }); }
  catch (error) { next(error); }
});
router.get('/:id', publicReadLimiter, async (req, res, next) => {
  try { res.json({ place: await placeService.get(req.params.id) }); }
  catch (error) { next(error); }
});
module.exports = router;
