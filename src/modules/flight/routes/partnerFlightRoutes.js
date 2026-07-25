'use strict';
const express = require('express');
const { requireAuth } = require('../../../middlewares/auth');
const { requireRole } = require('../../../middlewares/roles');
const { enforceCompanyScope, requireVerifiedCompany, requireCompanyService } = require('../../../middlewares/companyAccess');
const { publicWriteLimiter, sensitiveActionLimiter } = require('../../../middlewares/rateLimit');
const agentService = require('../services/flightAgentService');
const travelPayment = require('../../../services/payment/travelDomainPaymentService');
const repo = require('../repositories/flightRepository');
const router = express.Router();
router.use('/company/flights', requireAuth, requireRole('company_admin', 'company_employee', 'partner'), enforceCompanyScope, requireVerifiedCompany, requireCompanyService('flight'));
router.post('/company/flights/*', sensitiveActionLimiter);
function actor(req) { return { id: req.session.user.id, userId: req.session.user.id, companyId: req.session.user.companyId, email: req.session.user.email, role: req.session.user.role, actorType: 'flight_agent' }; }
function reply(req, res, data, redirect = '/company/dashboard/flight-quotes') { if (req.xhr || String(req.headers.accept || '').includes('application/json')) return res.json(data); req.flash?.('success', 'Flight-agent record saved successfully.'); return res.redirect(redirect); }
function action(handler, redirect) { return async (req, res, next) => { try { return reply(req, res, { ok: true, result: await handler(req) }, redirect); } catch (error) { next(error); } }; }
router.post('/company/flights/search', publicWriteLimiter, action((req) => agentService.search(req.body, actor(req)), '/company/dashboard/flight-search'));
router.post('/company/flights/quotes', action((req) => agentService.createQuote(req.body, actor(req)), '/company/dashboard/flight-quotes'));
router.post('/company/flights/quotes/:id/orders', action((req) => agentService.createOrderFromQuote(req.params.id, { ...req.body, idempotencyKey: req.headers['idempotency-key'] || req.body.idempotencyKey }, actor(req)), '/company/dashboard/bookings'));
router.post('/company/flights/orders/:bookingRef/payment', action(async (req) => { const a = actor(req); await repo.oneOrThrow(repo.orders, { bookingRef: req.params.bookingRef, agentCompanyId: a.companyId }, 'Flight order was not found for this agency'); return travelPayment.initiate('flight', req.params.bookingRef, { ...req.body, idempotencyKey: req.headers['idempotency-key'] || req.body.idempotencyKey }, a); }, '/company/dashboard/bookings'));
router.get('/company/flights/workspace', async (req, res, next) => { try { res.json(await agentService.workspace(actor(req))); } catch (error) { next(error); } });
router.post('/company/flights/orders/:id/changes', action((req) => agentService.createChangeRequest(req.params.id, req.body, actor(req)), '/company/dashboard/flight-changes'));
router.post('/company/flights/orders/:id/refunds', action((req) => agentService.createRefundRequest(req.params.id, req.body, actor(req)), '/company/dashboard/flight-refunds'));
module.exports = router;
