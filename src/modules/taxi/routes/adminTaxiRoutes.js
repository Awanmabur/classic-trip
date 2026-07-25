'use strict';
const express = require('express');
const { requireAuth } = require('../../../middlewares/auth');
const { requireRole } = require('../../../middlewares/roles');
const { requirePlatformMfa } = require('../../../middlewares/mfa');
const { sensitiveActionLimiter } = require('../../../middlewares/rateLimit');
const setup = require('../services/taxiSetupService');
const dispatch = require('../services/taxiDispatchService');
const rideService = require('../services/taxiRideService');
const repo = require('../repositories/taxiRepository');
const { PLATFORM_MOBILITY_OWNER } = require('../domain/taxiGovernance');
const router = express.Router();
router.use('/admin/mobility', requireAuth, requireRole('super_admin'), requirePlatformMfa);
router.post('/admin/mobility/*', sensitiveActionLimiter);
function actor(req) { return { id: req.session.user.id, userId: req.session.user.id, role: 'super_admin', actorType: 'super_admin', companyId: PLATFORM_MOBILITY_OWNER }; }
function action(handler, redirect = '/admin/mobility-dashboard') { return async (req, res, next) => { try { const result = await handler(req); if (req.xhr || String(req.headers.accept || '').includes('application/json')) return res.json({ ok: true, result }); req.flash?.('success', 'Platform mobility configuration saved.'); return res.redirect(redirect); } catch (error) { next(error); } }; }
router.get('/admin/mobility/config', async (req, res, next) => { try { res.json({ listing: await repo.listings.findOne({ companyId: PLATFORM_MOBILITY_OWNER, serviceType: 'local_transport' }), vehicleClasses: await repo.vehicleClasses.list({ companyId: PLATFORM_MOBILITY_OWNER }, { sort: { sortOrder: 1 }, limit: 100 }), zones: await repo.zones.list({ companyId: PLATFORM_MOBILITY_OWNER }, { sort: { country: 1, name: 1 }, limit: 500 }), fareRules: await repo.fareRules.list({ companyId: PLATFORM_MOBILITY_OWNER }, { limit: 1000 }) }); } catch (error) { next(error); } });
router.post('/admin/mobility/listing', action((req) => setup.createPlatformListing(req.body, actor(req))));
router.post('/admin/mobility/vehicle-classes', action((req) => setup.createVehicleClass(req.body, actor(req))));
router.post('/admin/mobility/zones', action((req) => setup.createZone(req.body, actor(req))));
router.post('/admin/mobility/fare-rules', action((req) => setup.createFareRule(req.body, actor(req))));
router.post('/admin/mobility/vehicles/:id/review', action((req) => setup.reviewVehicle(req.params.id, req.body, actor(req))));
router.post('/admin/mobility/drivers/:id/review', action((req) => setup.verifyDriver(req.params.id, req.body, actor(req))));
router.post('/admin/mobility/partners/:id/payout-policy', action((req) => setup.updatePartnerPayoutPolicy(req.params.id, req.body, actor(req))));
router.post('/admin/mobility/rides/:id/dispatch', action((req) => dispatch.dispatchRide(req.params.id, actor(req))));
router.post('/admin/mobility/rides/:id/cancel', action((req) => rideService.cancelRide(req.params.id, req.body.reason, actor(req))));
module.exports = router;
