'use strict';
const express = require('express');
const { requireAuth } = require('../../../middlewares/auth');
const { requireRole } = require('../../../middlewares/roles');
const { requirePlatformMfa } = require('../../../middlewares/mfa');
const { sensitiveActionLimiter, ticketLimiter } = require('../../../middlewares/rateLimit');
const setup = require('../services/flightSetupService');
const operations = require('../services/flightOperationsService');
const repo = require('../repositories/flightRepository');
const { PLATFORM_FLIGHT_OWNER } = require('../domain/flightGovernance');
const router = express.Router();
router.use('/admin/flights', requireAuth, requireRole('super_admin'), requirePlatformMfa);
router.post('/admin/flights/*', sensitiveActionLimiter);
function actor(req) { return { id: req.session.user.id, userId: req.session.user.id, role: 'super_admin', actorType: 'super_admin', companyId: PLATFORM_FLIGHT_OWNER }; }
function action(handler, redirect = '/admin/flight-dashboard') { return async (req, res, next) => { try { const result = await handler(req); if (req.xhr || String(req.headers.accept || '').includes('application/json')) return res.json({ ok: true, result }); req.flash?.('success', 'Platform flight configuration saved.'); return res.redirect(redirect); } catch (error) { next(error); } }; }
router.get('/admin/flights/config', async (req, res, next) => { try { const [listing, airlines, suppliers, aircraft, seatMaps, routes, fares, departures, ancillaries, agentQuotes, changes, refunds] = await Promise.all([
  repo.listings.findOne({ companyId: PLATFORM_FLIGHT_OWNER, serviceType: 'flight' }),
  repo.airlines.list({ companyId: PLATFORM_FLIGHT_OWNER }, { sort: { name: 1 }, limit: 300 }),
  repo.suppliers.list({ companyId: PLATFORM_FLIGHT_OWNER }, { sort: { name: 1 }, limit: 300 }),
  repo.aircraft.list({ companyId: PLATFORM_FLIGHT_OWNER }, { limit: 500 }),
  repo.seatMaps.list({ companyId: PLATFORM_FLIGHT_OWNER }, { sort: { createdAt: -1 }, limit: 500 }),
  repo.routes.list({ companyId: PLATFORM_FLIGHT_OWNER }, { limit: 500 }),
  repo.fareFamilies.list({ companyId: PLATFORM_FLIGHT_OWNER }, { limit: 1000 }),
  repo.departures.list({ companyId: PLATFORM_FLIGHT_OWNER }, { sort: { departAt: -1 }, limit: 1000 }),
  repo.ancillaries.list({ companyId: PLATFORM_FLIGHT_OWNER }, { limit: 500 }),
  repo.agentQuotes.list({}, { sort: { createdAt: -1 }, limit: 500 }),
  repo.changeRequests.list({}, { sort: { createdAt: -1 }, limit: 500 }),
  repo.refundRequests.list({}, { sort: { createdAt: -1 }, limit: 500 }),
]); res.json({ listing, airlines, suppliers, aircraft, seatMaps, routes, fares, departures, ancillaries, agentQuotes, changes, refunds }); } catch (error) { next(error); } });
router.post('/admin/flights/listing', action((req) => setup.createPlatformListing(req.body, actor(req))));
router.post('/admin/flights/airlines', action((req) => setup.createAirline(req.body, actor(req))));
router.post('/admin/flights/airlines/:id', action((req) => setup.updateAirline(req.params.id, req.body, actor(req))));
router.post('/admin/flights/suppliers', action((req) => setup.createSupplier(req.body, actor(req))));
router.post('/admin/flights/aircraft', action((req) => setup.createAircraft(req.body, actor(req))));
router.post('/admin/flights/seat-maps', action((req) => setup.createSeatMap(req.body, actor(req))));
router.post('/admin/flights/seat-maps/:id/publish', action((req) => setup.publishSeatMap(req.params.id, actor(req))));
router.post('/admin/flights/routes', action((req) => setup.createRoute(req.body, actor(req))));
router.post('/admin/flights/fare-families', action((req) => setup.createFareFamily(req.body, actor(req))));
router.post('/admin/flights/departures', action((req) => setup.createDeparture(req.body, actor(req))));
router.post('/admin/flights/departures/:id/inventory', action((req) => setup.generateInventory(req.params.id, actor(req))));
router.post('/admin/flights/departures/:id/publish', action((req) => setup.publishDeparture(req.params.id, actor(req))));
router.post('/admin/flights/departures/:id/status', action((req) => operations.updateDeparture(req.params.id, PLATFORM_FLIGHT_OWNER, req.body, actor(req))));
router.post('/admin/flights/ancillaries', action((req) => setup.createAncillary(req.body, actor(req))));
router.post('/admin/flights/departures/:departureId/travelers/:ticketNumber/status', action((req) => operations.transitionTraveler({ companyId: PLATFORM_FLIGHT_OWNER, departureId: req.params.departureId, ticketNumber: req.params.ticketNumber, status: req.body.status, actor: actor(req) })));
router.get('/admin/flights/departures/:departureId/manifest', ticketLimiter, async (req, res, next) => { try { res.json(await operations.manifest(req.params.departureId, PLATFORM_FLIGHT_OWNER)); } catch (error) { next(error); } });
router.post('/admin/flights/change-requests/:id/status', action(async (req) => { const row = await repo.oneOrThrow(repo.changeRequests, { id: req.params.id }, 'Change request was not found'); const status = String(req.body.status || '').trim().toLowerCase(); if (!['under_review','quoted','approved','rejected','completed','cancelled'].includes(status)) { const error = new Error('Change request status is invalid'); error.status = 422; throw error; } row.status = status; row.supplierResponse = { summary: String(req.body.summary || '').trim(), amount: Number(req.body.amount || 0), currency: String(req.body.currency || '').trim().toUpperCase() }; row.reviewedBy = actor(req).id; row.reviewedAt = new Date(); row.updatedAt = new Date(); await repo.changeRequests.save(row, { id: row.id }); return row; }));
router.post('/admin/flights/refund-requests/:id/status', action(async (req) => { const row = await repo.oneOrThrow(repo.refundRequests, { id: req.params.id }, 'Refund request was not found'); const status = String(req.body.status || '').trim().toLowerCase(); if (!['under_review','approved','rejected','processing','refunded','cancelled'].includes(status)) { const error = new Error('Refund request status is invalid'); error.status = 422; throw error; } row.status = status; row.supplierResponse = { summary: String(req.body.summary || '').trim(), providerReference: String(req.body.providerReference || '').trim() }; row.reviewedBy = actor(req).id; row.reviewedAt = new Date(); row.updatedAt = new Date(); await repo.refundRequests.save(row, { id: row.id }); return row; }));
module.exports = router;
