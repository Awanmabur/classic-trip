'use strict';

const repo = require('../repositories/flightRepository');
const searchService = require('./flightSearchService');
const bookingService = require('./flightBookingService');
const sensitiveFieldService = require('../../../services/security/sensitiveFieldService');
const { FLIGHT_AGENT_CATEGORY, isFlightAgent } = require('../domain/flightGovernance');
const { cleanText, normalize, validationError, code, randomToken, hashToken, immutable, actorId } = require('../domain/flightDomain');

function now() { return new Date(); }
function opts(session) { return session ? { session } : {}; }

async function verifiedAgent(actor = {}, options = {}) {
  const companyId = cleanText(actor.companyId, 180);
  const company = await repo.companies.findOne({ id: companyId, companyType: 'flight', partnerCategory: FLIGHT_AGENT_CATEGORY }, options);
  if (!company || !isFlightAgent(company) || company.status !== 'active' || company.verificationStatus !== 'verified') {
    throw validationError('A verified flight-agent account is required', 403, 'verified_flight_agent_required');
  }
  return company;
}

async function search(payload = {}, actor = {}) {
  await verifiedAgent(actor);
  return searchService.search(payload);
}

async function createQuote(payload = {}, actor = {}) {
  const agent = await verifiedAgent(actor);
  const offer = await searchService.reprice(payload.offerId, payload.offerToken);
  const customerName = cleanText(payload.customerName, 160);
  const customerEmail = cleanText(payload.customerEmail, 180).toLowerCase();
  const customerPhone = cleanText(payload.customerPhone, 60);
  if (!customerName || (!customerEmail && !customerPhone)) throw validationError('Customer name and email or phone are required');
  const rawPublicToken = randomToken(24);
  const expiresAt = new Date(Math.min(new Date(offer.expiresAt).getTime(), Date.now() + 24 * 60 * 60 * 1000));
  const quote = {
    id: await repo.nextId('flight-agent-quote'),
    quoteRef: code('FQ', 5),
    publicTokenHash: hashToken(rawPublicToken),
    publicTokenEncrypted: sensitiveFieldService.encrypt(rawPublicToken, 'flight-agent-share-token'),
    agentCompanyId: agent.id,
    agentUserId: cleanText(actor.userId || actor.id, 180),
    offerId: offer.id,
    offerTokenEncrypted: sensitiveFieldService.encrypt(payload.offerToken, 'flight-agent-offer-token'),
    customerName,
    customerEmail,
    customerPhone,
    travelers: Array.isArray(payload.travelers) ? immutable(payload.travelers).map((row) => ({ passengerType: cleanText(row.passengerType || 'adult', 24), firstName: cleanText(row.firstName, 80), lastName: cleanText(row.lastName, 80) })) : [],
    tripSnapshot: immutable({ tripType: offer.tripType, segments: offer.segments, passengerCounts: offer.passengerCounts, baggage: offer.baggageSnapshot, policy: offer.policySnapshot }),
    supplierPriceSnapshot: immutable(offer.priceSnapshot),
    agentFeeSnapshot: { amount: 0, currency: offer.priceSnapshot?.currency || '', chargedToCustomer: false },
    totalPriceSnapshot: immutable(offer.priceSnapshot),
    notes: cleanText(payload.notes, 1500),
    status: payload.sendNow === true || payload.sendNow === 'true' ? 'sent' : 'draft',
    expiresAt,
    createdAt: now(),
    updatedAt: now(),
  };
  await repo.agentQuotes.save(quote, { id: quote.id });
  await repo.audit({ actorId: actorId(actor), action: 'flight.agent_quote.created', targetType: 'flight_agent_quote', targetId: quote.id, companyId: agent.id, metadata: { quoteRef: quote.quoteRef, offerId: offer.id } });
  return { quote: { ...quote, offerTokenEncrypted: undefined, publicTokenEncrypted: undefined, publicTokenHash: undefined }, publicToken: rawPublicToken, sharePath: `/api/v1/flights/agent-quotes/${encodeURIComponent(quote.quoteRef)}?token=${encodeURIComponent(rawPublicToken)}` };
}

async function readPublicQuote(reference, token) {
  const ref = cleanText(reference, 180);
  const quote = await repo.agentQuotes.findOne({ $or: [{ id: ref }, { quoteRef: ref }] });
  if (!quote || !token || hashToken(token) !== quote.publicTokenHash) throw validationError('Flight quote was not found or the private link is invalid', 404);
  if (new Date(quote.expiresAt).getTime() <= Date.now()) {
    if (quote.status !== 'converted') { quote.status = 'expired'; quote.updatedAt = now(); await repo.agentQuotes.save(quote, { id: quote.id }); }
    throw validationError('This flight quote has expired. Ask the agent to refresh it.', 409, 'flight_quote_expired');
  }
  return { quote: { ...quote, publicTokenHash: undefined, publicTokenEncrypted: undefined, offerTokenEncrypted: undefined } };
}

async function createOrderFromQuote(quoteId, payload = {}, actor = {}) {
  const agent = await verifiedAgent(actor);
  const quote = await repo.oneOrThrow(repo.agentQuotes, { id: cleanText(quoteId, 180), agentCompanyId: agent.id }, 'Flight quote was not found');
  if (!['draft', 'sent', 'accepted'].includes(quote.status)) throw validationError('This quote cannot be converted into a booking', 409);
  if (new Date(quote.expiresAt).getTime() <= Date.now()) throw validationError('This quote has expired. Search and quote again.', 409, 'flight_quote_expired');
  const offerToken = sensitiveFieldService.decrypt(quote.offerTokenEncrypted, 'flight-agent-offer-token');
  if (!offerToken) throw validationError('The protected supplier offer token could not be recovered', 409);
  const result = await bookingService.createOrder({
    ...payload,
    offerId: quote.offerId,
    offerToken,
    agentQuoteId: quote.id,
    contactName: payload.contactName || quote.customerName,
    email: payload.email || quote.customerEmail,
    phone: payload.phone || quote.customerPhone,
  }, {
    ...actor,
    actorType: 'flight_agent',
    agentCompanyId: agent.id,
    bookingChannel: 'flight_agent',
  });
  quote.status = 'converted';
  quote.convertedOrderId = result.order.id;
  quote.updatedAt = now();
  await repo.agentQuotes.save(quote, { id: quote.id });
  return result;
}

async function createChangeRequest(orderId, payload = {}, actor = {}) {
  const agent = await verifiedAgent(actor);
  const order = await repo.oneOrThrow(repo.orders, { id: cleanText(orderId, 180), agentCompanyId: agent.id }, 'Flight order was not found for this agency');
  const requestType = normalize(payload.requestType || 'other');
  if (!['date_change', 'route_change', 'name_correction', 'seat_change', 'baggage_change', 'other'].includes(requestType)) throw validationError('Change request type is invalid');
  const details = { summary: cleanText(payload.summary || payload.details, 1800), preferredDate: payload.preferredDate || null, preferredFlight: cleanText(payload.preferredFlight, 80), travelerId: cleanText(payload.travelerId, 180) };
  if (!details.summary) throw validationError('Describe the requested flight change');
  const row = { id: await repo.nextId('flight-change-request'), requestRef: code('FCR', 5), orderId: order.id, bookingRef: order.bookingRef, agentCompanyId: agent.id, requestedByUserId: cleanText(actor.userId || actor.id, 180), requestType, details, status: 'submitted', createdAt: now(), updatedAt: now() };
  await repo.changeRequests.save(row, { id: row.id });
  await repo.audit({ actorId: actorId(actor), action: 'flight.agent_change.submitted', targetType: 'flight_change_request', targetId: row.id, companyId: agent.id, metadata: { orderId: order.id } });
  return row;
}

async function createRefundRequest(orderId, payload = {}, actor = {}) {
  const agent = await verifiedAgent(actor);
  const order = await repo.oneOrThrow(repo.orders, { id: cleanText(orderId, 180), agentCompanyId: agent.id }, 'Flight order was not found for this agency');
  const reason = cleanText(payload.reason, 1800);
  if (!reason) throw validationError('Refund reason is required');
  const maxAmount = Number(order.pricing?.total || order.priceSnapshot?.total || 0);
  const requestedAmount = payload.requestedAmount === '' || payload.requestedAmount == null ? maxAmount : Number(payload.requestedAmount);
  if (!Number.isFinite(requestedAmount) || requestedAmount < 0 || requestedAmount > maxAmount) throw validationError('Requested refund amount is invalid');
  const row = { id: await repo.nextId('flight-refund-request'), requestRef: code('FRR', 5), orderId: order.id, bookingRef: order.bookingRef, agentCompanyId: agent.id, requestedByUserId: cleanText(actor.userId || actor.id, 180), reason, requestedAmount, currency: order.pricing?.currency || order.priceSnapshot?.currency || '', status: 'submitted', createdAt: now(), updatedAt: now() };
  await repo.refundRequests.save(row, { id: row.id });
  await repo.audit({ actorId: actorId(actor), action: 'flight.agent_refund.submitted', targetType: 'flight_refund_request', targetId: row.id, companyId: agent.id, metadata: { orderId: order.id, requestedAmount } });
  return row;
}

async function workspace(actor = {}) {
  const agent = await verifiedAgent(actor);
  const [quotes, orders, tickets, changes, refunds] = await Promise.all([
    repo.agentQuotes.list({ agentCompanyId: agent.id }, { sort: { createdAt: -1 }, limit: 200 }),
    repo.orders.list({ agentCompanyId: agent.id }, { sort: { createdAt: -1 }, limit: 200 }),
    repo.tickets.list({ agentCompanyId: agent.id }, { sort: { createdAt: -1 }, limit: 500 }),
    repo.changeRequests.list({ agentCompanyId: agent.id }, { sort: { createdAt: -1 }, limit: 200 }),
    repo.refundRequests.list({ agentCompanyId: agent.id }, { sort: { createdAt: -1 }, limit: 200 }),
  ]);
  return { agent: { id: agent.id, name: agent.name, partnerCategory: agent.partnerCategory }, quotes: quotes.map((row) => { const token = sensitiveFieldService.decrypt(row.publicTokenEncrypted, 'flight-agent-share-token'); return { ...row, offerTokenEncrypted: undefined, publicTokenHash: undefined, publicTokenEncrypted: undefined, sharePath: token ? `/api/v1/flights/agent-quotes/${encodeURIComponent(row.quoteRef)}?token=${encodeURIComponent(token)}` : '' }; }), orders, tickets, changes, refunds };
}

module.exports = { verifiedAgent, search, createQuote, readPublicQuote, createOrderFromQuote, createChangeRequest, createRefundRequest, workspace };
