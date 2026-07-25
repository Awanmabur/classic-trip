'use strict';
const express = require('express');
const { requireAuth } = require('../../../middlewares/auth');
const { requireRole } = require('../../../middlewares/roles');
const { enforceCompanyScope, requireVerifiedCompany, requireCompanyService } = require('../../../middlewares/companyAccess');
const { sensitiveActionLimiter } = require('../../../middlewares/rateLimit');
const setup = require('../services/taxiSetupService');
const rideService = require('../services/taxiRideService');
const driverService = require('../services/taxiDriverService');
const router = express.Router();

router.use('/company/taxi', requireAuth, requireRole('company_admin'), enforceCompanyScope, requireVerifiedCompany, requireCompanyService('local_transport'));
router.post('/company/taxi/*', sensitiveActionLimiter);
function actor(req) { return { id: req.session.user.id, userId: req.session.user.id, companyId: req.session.user.companyId, email: req.session.user.email, role: req.session.user.role, actorType: 'mobility_partner', driverProfileId: req.body.driverProfileId || '' }; }
function reply(req, res, data, redirect = '/company/dashboard/taxi-operations') { if (req.xhr || String(req.headers.accept || '').includes('application/json')) return res.json(data); req.flash?.('success', 'Mobility record saved successfully.'); return res.redirect(redirect); }
function action(handler, redirect) { return async (req, res, next) => { try { return reply(req, res, { ok: true, result: await handler(req) }, redirect); } catch (error) { next(error); } }; }

// Partners submit and maintain only their own fleet/driver records. Platform classes,
// zones, prices, verification and dispatch remain under Super Admin/system control.
router.post('/company/taxi/vehicles', action((req) => setup.createVehicle(req.body, actor(req)), '/company/dashboard/taxi-fleet'));
router.post('/company/taxi/vehicles/:id/status', action((req) => setup.updateVehicleStatus(req.params.id, req.body, actor(req)), '/company/dashboard/taxi-fleet'));
router.post('/company/taxi/drivers', action((req) => setup.createDriverProfile(req.body, actor(req)), '/company/dashboard/taxi-drivers'));
router.post('/company/taxi/rides/:id/cancel', action((req) => rideService.cancelRide(req.params.id, req.body.reason, actor(req)), '/company/dashboard/taxi-operations'));
router.post('/company/taxi/incidents', action((req) => driverService.reportIncident(req.body, actor(req)), '/company/dashboard/taxi-incidents'));
module.exports = router;
