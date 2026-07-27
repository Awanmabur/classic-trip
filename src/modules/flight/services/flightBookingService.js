'use strict';

const crypto = require('crypto');
const repo = require('../repositories/flightRepository');
const searchService = require('./flightSearchService');
const { adapterFor } = require('./flightSupplierRegistry');
const securityService = require('../../../services/security/securityService');
const paymentSettlementService = require('../../../services/booking/paymentSettlementService');
const refundWorkflowService = require('../../../services/support/workflowService');
const calculateCommission = require('../../../utils/calculateCommission');
const generateBookingRef = require('../../../utils/generateBookingRef');
const { env } = require('../../../config/env');
const { cleanText, normalize, validationError, conflictError, code, randomToken, hashToken, safeEqual, immutable, actorId } = require('../domain/flightDomain');

function now() { return new Date(); }
function roundMoney(value) { return Math.round((Number(value) || 0) * 100) / 100; }
function boundedPercent(value, fallback = 5) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(30, number)) : fallback;
}
async function flightCommercialSplit(total, listing, agentCompanyId, hasReferral, session) {
  const amount = roundMoney(total);
  const base = calculateCommission(amount, hasReferral, { commissionPercent: listing.commissionPercent });
  if (!agentCompanyId) {
    return {
      ...base,
      commercialModel: 'flight_direct_supplier',
      companyAmount: 0,
      agentCommissionPercent: 0,
      agentCommissionAmount: 0,
      supplierPayable: roundMoney(Math.max(0, amount - base.platformFee - base.promoterAmount)),
    };
  }
  const agent = await repo.oneOrThrow(repo.companies, { id: agentCompanyId, companyType: 'flight', partnerCategory: 'flight_agent', verificationStatus: 'verified', status: 'active' }, 'Verified flight agent was not found', opts(session));
  const agentPercent = boundedPercent(agent.settings?.flightAgentCommissionPercent ?? agent.commercialTerms?.commissionPercent, 5);
  const agentCommissionAmount = roundMoney((amount * agentPercent) / 100);
  const supplierPayable = roundMoney(Math.max(0, amount - base.platformFee - base.promoterAmount - agentCommissionAmount));
  return {
    ...base,
    commercialModel: 'flight_agent_distribution',
    companyAmount: agentCommissionAmount,
    agentCommissionPercent: agentPercent,
    agentCommissionAmount,
    supplierPayable,
    totalCommission: roundMoney(base.platformFee + base.promoterAmount + agentCommissionAmount),
  };
}
function opts(session) { return session ? { session } : {}; }
function encryptDocument(value) {
  const text = cleanText(value, 120);
  if (!text) return '';
  const key = crypto.createHash('sha256').update(String(env.sessionSecret || 'classic-trip')).digest();
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}
function travelerRows(payload = {}, expected) {
  let rows = Array.isArray(payload.travelers) ? payload.travelers : [];
  if (!rows.length && payload.travelersJson) { try { rows = JSON.parse(payload.travelersJson); } catch (_) { throw validationError('Traveler details JSON is invalid'); } }
  if (rows.length !== expected) throw validationError(`Enter exactly ${expected} traveler records`);
  return rows.map((item, index) => {
    const firstName = cleanText(item.firstName, 80); const lastName = cleanText(item.lastName, 80);
    if (!firstName || !lastName) throw validationError(`Traveler ${index + 1} first and last name are required`);
    const passengerType = normalize(item.passengerType || 'adult'); if (!['adult','child','infant'].includes(passengerType)) throw validationError(`Traveler ${index + 1} passenger type is invalid`);
    const documentType = normalize(item.documentType || 'national_id'); if (!['passport','national_id','travel_document'].includes(documentType)) throw validationError(`Traveler ${index + 1} document type is invalid`);
    const documentNumber = cleanText(item.documentNumber, 120); if (!documentNumber) throw validationError(`Traveler ${index + 1} document number is required`);
    const expiry = item.documentExpiry ? new Date(item.documentExpiry) : null; if (expiry && (Number.isNaN(expiry.getTime()) || expiry <= now())) throw validationError(`Traveler ${index + 1} travel document must be valid on the travel date`);
    return { passengerType, title: cleanText(item.title, 20), firstName, lastName, sex: cleanText(item.sex, 24), nationality: cleanText(item.nationality, 80), documentType, documentNumberEncrypted: encryptDocument(documentNumber), documentNumberLast4: documentNumber.slice(-4), documentExpiry: expiry, documentIssuingCountry: cleanText(item.documentIssuingCountry, 80), frequentFlyerNumber: cleanText(item.frequentFlyerNumber, 80), specialAssistance: Array.isArray(item.specialAssistance) ? item.specialAssistance.map((v)=>cleanText(v,120)).filter(Boolean) : [] };
  });
}
function seatRequests(payload = {}) {
  let rows = Array.isArray(payload.seats) ? payload.seats : [];
  if (!rows.length && payload.seatsJson) { try { rows = JSON.parse(payload.seatsJson); } catch (_) { throw validationError('Seat selection JSON is invalid'); } }
  return rows.map((row) => ({ travelerIndex: Number(row.travelerIndex), departureId: cleanText(row.departureId, 180), seatNumber: cleanText(row.seatNumber, 12).toUpperCase() }));
}
async function selectSeats({ offer, travelers, requests, orderId, session }) {
  const assignments = [];
  const segments = offer.segments || [];
  for (const segment of segments) {
    const segmentRequests = requests.filter((item) => item.departureId === segment.departureId);
    const selectedNumbers = new Set(segmentRequests.map((item) => item.seatNumber));
    if (selectedNumbers.size !== segmentRequests.length) throw validationError('A seat cannot be assigned to more than one traveler');
    const need = travelers.filter((traveler) => traveler.passengerType !== 'infant').length;
    if (segmentRequests.length && segmentRequests.length !== need) throw validationError(`Select ${need} seats for flight ${segment.flightNumber}`);
    let inventory = [];
    if (segmentRequests.length) inventory = await repo.seatInventory.list({ departureId: segment.departureId, seatNumber: { $in: Array.from(selectedNumbers) }, cabinClass: segment.cabinClass, status: 'available' }, opts(session));
    else inventory = await repo.seatInventory.list({ departureId: segment.departureId, cabinClass: segment.cabinClass, status: 'available' }, { ...opts(session), sort: { seatNumber: 1 }, limit: need });
    if (inventory.length !== need) throw conflictError(`Selected seats for ${segment.flightNumber} are no longer available`, 'flight_seat_unavailable');
    const inventoryByNumber = new Map(inventory.map((seat)=>[seat.seatNumber,seat]));
    const nonInfants = travelers.map((traveler,index)=>({traveler,index})).filter((row)=>row.traveler.passengerType!=='infant');
    for (let i=0;i<nonInfants.length;i+=1) {
      const travelerRow = nonInfants[i]; const requested = segmentRequests.find((row)=>row.travelerIndex===travelerRow.index); const seat = requested ? inventoryByNumber.get(requested.seatNumber) : inventory[i];
      if (!seat) throw conflictError('A selected flight seat is no longer available', 'flight_seat_unavailable');
      const claimed = await repo.seatInventory.updateOne({ id: seat.id, status: 'available', version: Number(seat.version||0) }, { $set: { status: 'held', orderId, travelerId: travelerRow.traveler.id, heldUntil: new Date(Date.now()+15*60*1000), updatedAt: now() }, $inc: { version: 1 } }, opts(session));
      if (!claimed || Number(claimed.modifiedCount || claimed.nModified || 0) !== 1) throw conflictError(`Seat ${seat.seatNumber} was selected by another traveler`, 'flight_seat_conflict');
      const assignment = { id: await repo.nextId('flight-seat-assignment'), companyId: offer.companyId, orderId, travelerId: travelerRow.traveler.id, departureId: segment.departureId, inventoryId: seat.id, seatNumber: seat.seatNumber, cabinClass: seat.cabinClass, chargeAmount: 0, currency: offer.priceSnapshot.currency, status: 'held', createdAt: now(), updatedAt: now() };
      await repo.seatAssignments.save(assignment,{id:assignment.id},opts(session)); assignments.push(assignment);
    }
  }
  return assignments;
}
async function createOrder(payload = {}, actor = {}) {
  const agentCompanyId = cleanText(actor.agentCompanyId || (actor.actorType === 'flight_agent' ? actor.companyId : ''), 180);
  const agentUserId = agentCompanyId ? cleanText(actor.userId || actor.id, 180) : '';
  const agentQuoteId = cleanText(payload.agentQuoteId, 180);
  const customerUserId = actor.actorType === 'flight_agent' ? cleanText(payload.customerUserId, 180) : cleanText(actor.userId || actor.id, 180);
  const offer = await searchService.readOffer(payload.offerId, payload.offerToken);
  const repriced = await searchService.reprice(offer.id, payload.offerToken);
  const counts = repriced.passengerCounts || {}; const travelersInput = travelerRows(payload, Number(counts.totalTravelers || 1));
  const contact = { fullName: cleanText(payload.contactName || `${travelersInput[0].firstName} ${travelersInput[0].lastName}`,120), email: cleanText(payload.email,180).toLowerCase(), phone: cleanText(payload.phone,60), emergencyPhone: cleanText(payload.emergencyPhone,60) };
  if (!contact.email || !contact.phone) throw validationError('Flight booking email and phone are required');
  const idempotencyKey = cleanText(payload.idempotencyKey || actor.idempotencyKey, 240); if (!idempotencyKey) throw conflictError('Idempotency key is required', 'idempotency_key_required');
  const claim = await securityService.claimIdempotencyKey({ key:idempotencyKey, scope:'flight_order_create', entityType:'flight_offer', entityId:repriced.id, payload:{offerId:repriced.id,contact,travelers:travelersInput.map(t=>({...t,documentNumberEncrypted:'protected'}))} });
  const existing = await repo.orders.findOne({ offerId: repriced.id, idempotencyKey });
  if (claim.replayed && existing) return { order: existing, booking: await repo.bookings.findOne({id:existing.bookingId}), replayed:true };
  const result = await repo.withTransaction(async (session) => {
    const bookingRef = generateBookingRef('flight'); const bookingId = await repo.nextId('booking'); const bookingItemId=await repo.nextId('booking-item'); const orderId=await repo.nextId('flight-order');
    const persistedTravelers=[];
    for (const row of travelersInput) { const traveler={...row,id:await repo.nextId('flight-traveler'),orderId,bookingId,bookingRef,companyId:repriced.companyId,agentCompanyId,status:'pending',createdAt:now(),updatedAt:now()}; await repo.travelers.save(traveler,{id:traveler.id},opts(session)); persistedTravelers.push(traveler); }
    const assignments=await selectSeats({offer:repriced,travelers:persistedTravelers,requests:seatRequests(payload),orderId,session});
    const listing=await repo.oneOrThrow(repo.listings,{id:repriced.listingId,companyId:repriced.companyId},'Flight listing was not found',opts(session));
    const split=await flightCommercialSplit(repriced.priceSnapshot.total,listing,agentCompanyId,Boolean(actor.referralCode),session);
    const pricing={...immutable(repriced.priceSnapshot),split};
    const order={id:orderId,orderRef:code('FO'),bookingId,bookingRef,bookingItemId,companyId:repriced.companyId,agentCompanyId,agentUserId,agentQuoteId,supplierId:repriced.supplierId||'',listingId:repriced.listingId,offerId:repriced.id,customerUserId,contactSnapshot:contact,segmentSnapshot:immutable(repriced.segments),pricing,priceSnapshot:immutable(repriced.priceSnapshot),policySnapshot:immutable(repriced.policySnapshot),status:'awaiting_payment',paymentStatus:'pending',ticketingStatus:'not_requested',settlementStatus:'pending_payment',idempotencyKey,createdAt:now(),updatedAt:now()};
    const passengerSnapshots=persistedTravelers.map((traveler)=>({id:traveler.id,fullName:`${traveler.firstName} ${traveler.lastName}`,name:`${traveler.firstName} ${traveler.lastName}`,nationality:traveler.nationality,sex:traveler.sex,identityType:traveler.documentType,identityNumber:`••••${traveler.documentNumberLast4}`,seatNumber:assignments.find(a=>a.travelerId===traveler.id)?.seatNumber||'',seatOrRoom:assignments.find(a=>a.travelerId===traveler.id)?.seatNumber||'',checkInStatus:'not_checked'}));
    const booking={id:bookingId,bookingRef,guestLookupCode:randomToken(8),serviceType:'flight',customerUserId,companyId:repriced.companyId,supplierId:repriced.supplierId||'',agentCompanyId,createdByAgentId:agentUserId,tenantId:repriced.companyId,listingId:repriced.listingId,passengers:passengerSnapshots,bookingItems:[{id:bookingItemId,serviceType:'flight',domainReservationId:orderId,quantity:persistedTravelers.length}],bookingLegs:immutable(repriced.segments),ticketLegs:[],quantity:persistedTravelers.length,pricing,grossAmount:pricing.total,buyerSnapshot:contact,guestSnapshot:contact,paymentStatus:'pending',refundStatus:'none',bookingChannel:actor.bookingChannel||'web',bookingStatus:'awaiting_payment',settlementStatus:'pending_payment',commercialTermsSnapshot:{commissionPercent:split.partnerCommissionPercent,agentCommissionPercent:split.agentCommissionPercent||0,commercialModel:split.commercialModel},referralCode:actor.referralCode||'',qrCodeValue:'',auditTrail:[{at:now(),action:'flight_order_created',actorId:actorId(actor)}],createdAt:now(),updatedAt:now()};
    const item={id:bookingItemId,bookingId,bookingRef,companyId:repriced.companyId,agentCompanyId,supplierId:repriced.supplierId||'',listingId:repriced.listingId,serviceType:'flight',domainReservationId:orderId,quantity:persistedTravelers.length,pricing,priceSnapshot:immutable(repriced.priceSnapshot),policySnapshot:immutable(repriced.policySnapshot),status:'awaiting_payment',createdAt:now(),updatedAt:now()};
    await repo.orders.save(order,{id:order.id},opts(session)); await repo.bookings.save(booking,{id:booking.id},opts(session)); await repo.bookingItems.save(item,{id:item.id},opts(session));
    repriced.status='used'; repriced.updatedAt=now(); await repo.offers.save(repriced,{id:repriced.id},opts(session));
    await repo.audit({actorId:actorId(actor),action:'flight.order.created',targetType:'flight_order',targetId:order.id,companyId:order.companyId,metadata:{bookingRef},session});
    return {order,booking,bookingItem:item,travelers:persistedTravelers,seatAssignments:assignments};
  });
  await securityService.completeIdempotency(claim.record,{orderId:result.order.id,bookingRef:result.booking.bookingRef});
  return result;
}
async function supplierForOrder(order, session) {
  if (!order.supplierId) return {id:'',mode:'native_inventory',status:'active',capabilities:['order','ticket','refund']};
  return repo.oneOrThrow(repo.suppliers,{id:order.supplierId,companyId:order.companyId},'Flight supplier was not found',opts(session));
}
async function confirmPayment(bookingRef, payment = {}) {
  return repo.withTransaction(async(session)=>{
    const booking=await repo.oneOrThrow(repo.bookings,{bookingRef,serviceType:'flight'},'Flight booking was not found',opts(session));
    const order=await repo.oneOrThrow(repo.orders,{bookingId:booking.id,companyId:booking.companyId},'Flight order was not found',opts(session));
    if (order.paymentStatus==='successful' && ['confirmed','ticketed','checked_in','boarded','completed'].includes(order.status)) return booking;
    const supplier=await supplierForOrder(order,session);
    let supplierResult={supplierOrderRef:'',supplierBookingReference:code('PNR',3)};
    if(supplier.mode!=='native_inventory'){const adapter=adapterFor(supplier,'order');supplierResult=await adapter.order({order,booking});if(!supplierResult?.confirmed)throw conflictError('Flight supplier did not confirm the order','supplier_order_unconfirmed');}
    order.paymentStatus='successful';order.status='confirmed';order.supplierOrderRef=supplierResult.supplierOrderRef||order.supplierOrderRef||'';order.supplierBookingReference=supplierResult.supplierBookingReference||order.supplierBookingReference||code('PNR',3);order.confirmedAt=now();order.ticketingStatus='pending';order.settlementStatus='pending_fulfillment';order.updatedAt=now();
    const travelers=await repo.travelers.list({orderId:order.id},opts(session));const assignments=await repo.seatAssignments.list({orderId:order.id},opts(session));const tickets=[];const ticketLegs=[];
    for(const traveler of travelers){let supplierTicket='';if(supplier.mode!=='native_inventory'){const adapter=adapterFor(supplier,'ticket');const issued=await adapter.ticket({order,booking,traveler,assignments:assignments.filter(a=>a.travelerId===traveler.id)});if(!issued?.ticketNumber)throw conflictError('Flight supplier did not issue a ticket','supplier_ticket_failed');supplierTicket=issued.ticketNumber;}
      const rawQr=randomToken(32);const ticket={id:await repo.nextId('flight-ticket'),ticketNumber:supplierTicket||String(Date.now()).slice(-9)+String(Math.floor(Math.random()*1000)).padStart(3,'0'),orderId:order.id,bookingId:booking.id,bookingRef:booking.bookingRef,companyId:order.companyId,agentCompanyId:order.agentCompanyId||'',supplierId:order.supplierId||'',travelerId:traveler.id,passengerName:`${traveler.firstName} ${traveler.lastName}`,supplierTicketNumber:supplierTicket,coupons:(order.segmentSnapshot||[]).map(seg=>({departureId:seg.departureId,flightNumber:seg.flightNumber,originAirportId:seg.originAirportId,destinationAirportId:seg.destinationAirportId,seatNumber:assignments.find(a=>a.travelerId===traveler.id&&a.departureId===seg.departureId)?.seatNumber||'',status:'open'})),qrTokenHash:hashToken(rawQr),status:'issued',issuedAt:now(),createdAt:now(),updatedAt:now()};await repo.tickets.save(ticket,{id:ticket.id},opts(session));tickets.push(ticket);ticketLegs.push(...ticket.coupons.map(c=>({...c,ticketId:ticket.id,ticketNumber:ticket.ticketNumber,passengerName:ticket.passengerName,qrToken:rawQr,qrTokenHash:ticket.qrTokenHash,type:'flight'})));}
    await repo.seatAssignments.updateMany({orderId:order.id,status:'held'},{$set:{status:'confirmed',updatedAt:now()}},opts(session));await repo.seatInventory.updateMany({orderId:order.id,status:'held'},{$set:{status:'booked',heldUntil:null,updatedAt:now()}},opts(session));await repo.travelers.updateMany({orderId:order.id,status:'pending'},{$set:{status:'confirmed',updatedAt:now()}},opts(session));
    order.status='ticketed';order.ticketingStatus='issued';order.ticketedAt=now();await repo.orders.save(order,{id:order.id},opts(session));
    booking.paymentStatus='successful';booking.paymentProvider=payment.provider||booking.paymentProvider||'';booking.paymentRef=payment.providerReference||booking.paymentRef||'';booking.bookingStatus='confirmed';booking.settlementStatus='pending_fulfillment';booking.ticketLegs=ticketLegs;booking.qrCodeValue=ticketLegs[0]?.qrToken||'';booking.updatedAt=now();booking.auditTrail=[...(booking.auditTrail||[]),{at:now(),action:'flight_payment_confirmed_and_tickets_issued',source:payment.source||'payment'}];await repo.bookings.save(booking,{id:booking.id},opts(session));await repo.bookingItems.updateMany({bookingId:booking.id,serviceType:'flight'},{$set:{status:'confirmed',updatedAt:now()}},opts(session));
    await repo.outbox({eventType:'FlightTicketIssued',aggregateType:'flight_order',aggregateId:order.id,companyId:order.companyId,payload:{bookingRef:booking.bookingRef,ticketNumbers:tickets.map(t=>t.ticketNumber)},session});return booking;
  }).then(async booking=>paymentSettlementService.settleBookingPayment(booking,{source:payment.source||'flight_payment'}));
}
async function failPayment(bookingRef, reason='Flight payment failed', payment={}) {
  return repo.withTransaction(async(session)=>{const booking=await repo.bookings.findOne({bookingRef,serviceType:'flight'},opts(session));if(!booking)return null;const order=await repo.orders.findOne({bookingId:booking.id},opts(session));if(order){await repo.seatAssignments.updateMany({orderId:order.id,status:'held'},{$set:{status:'cancelled',updatedAt:now()}},opts(session));await repo.seatInventory.updateMany({orderId:order.id,status:'held'},{$set:{status:'available',orderId:'',travelerId:'',heldUntil:null,updatedAt:now()},$inc:{version:1}},opts(session));order.status='failed';order.paymentStatus='failed';order.ticketingStatus='failed';order.updatedAt=now();await repo.orders.save(order,{id:order.id},opts(session));}
    booking.paymentStatus='failed';booking.bookingStatus='failed';booking.settlementStatus='pending_payment';booking.paymentProvider=payment.provider||booking.paymentProvider||'';booking.paymentRef=payment.providerReference||booking.paymentRef||'';booking.notes=reason;booking.updatedAt=now();await repo.bookings.save(booking,{id:booking.id},opts(session));await repo.bookingItems.updateMany({bookingId:booking.id,serviceType:'flight'},{$set:{status:'failed',updatedAt:now()}},opts(session));return booking;});
}
function assertCustomerAccess(booking, lookupCode = '', actor = {}) {
  if (actor.actorType === 'system' || actor.companyId) return;
  const authenticatedUserId = cleanText(actor.userId, 180);
  if (authenticatedUserId && String(booking.customerUserId || '') === authenticatedUserId) return;
  if (!lookupCode || !safeEqual(lookupCode, booking.guestLookupCode || '')) {
    throw validationError('Flight booking lookup code is required or invalid', 403);
  }
}
async function cancelOrder(reference, reason, actor={}) {
  return repo.withTransaction(async(session)=>{
    const ref=cleanText(reference,180);
    const cancellationReason=cleanText(reason,1000);if(cancellationReason.length<5)throw validationError('Provide a clear cancellation reason');
    const booking=await repo.oneOrThrow(repo.bookings,{serviceType:'flight',$or:[{bookingRef:ref},{id:ref}]},'Flight booking was not found',opts(session));
    assertCustomerAccess(booking, actor.lookupCode, actor);
    const order=await repo.oneOrThrow(repo.orders,{bookingId:booking.id,companyId:booking.companyId},'Flight order was not found',opts(session));
    if(['completed','cancelled','refunded'].includes(order.status))throw conflictError('This flight order cannot be cancelled in its current state','flight_cancellation_not_allowed');
    const firstDeparture=order.segmentSnapshot?.[0]?.departAt?new Date(order.segmentSnapshot[0].departAt):null;
    if(firstDeparture&&firstDeparture.getTime()-Date.now()<2*60*60*1000)throw conflictError('Online cancellation closes two hours before departure. Contact support.','flight_cancellation_window_closed');
    const supplier=await supplierForOrder(order,session);
    if(supplier.mode!=='native_inventory'){
      const adapter=adapterFor(supplier,'refund');
      const result=await adapter.refund({order,booking,reason});
      if(!result?.accepted)throw conflictError('Flight supplier did not accept the cancellation','supplier_refund_unconfirmed');
    }
    await repo.seatAssignments.updateMany({orderId:order.id,status:{$in:['held','confirmed']}},{$set:{status:'cancelled',updatedAt:now()}},opts(session));
    await repo.seatInventory.updateMany({orderId:order.id,status:{$in:['held','booked']}},{$set:{status:'available',orderId:'',travelerId:'',ticketId:'',heldUntil:null,updatedAt:now()},$inc:{version:1}},opts(session));
    await repo.tickets.updateMany({orderId:order.id,status:{$in:['pending','issued']}},{$set:{status:'voided',voidedAt:now(),updatedAt:now()}},opts(session));
    order.status='cancelled';order.ticketingStatus='voided';order.cancelledAt=now();order.cancellationReason=cancellationReason;order.updatedAt=now();
    await repo.orders.save(order,{id:order.id},opts(session));
    booking.bookingStatus='cancelled';booking.cancelledAt=now();booking.cancellationReason=order.cancellationReason;booking.refundStatus=booking.paymentStatus==='successful'?'requested':'none';booking.updatedAt=now();
    await repo.bookings.save(booking,{id:booking.id},opts(session));
    await repo.bookingItems.updateMany({bookingId:booking.id},{$set:{status:'cancelled',updatedAt:now()}},opts(session));
    let refund=null;
    if(booking.paymentStatus==='successful'){
      refund=await refundWorkflowService.requestRefundLive({bookingRef:booking.bookingRef,requesterId:actorId(actor),reason:order.cancellationReason||'Customer cancelled flight order',companyId:booking.companyId,actorType:actor.actorType||'customer',session});
      booking.refundIds=[...new Set([...(booking.refundIds||[]),refund.id])];
    }
    await repo.audit({actorId:actorId(actor),action:'flight.order.cancelled',targetType:'flight_order',targetId:order.id,companyId:order.companyId,metadata:{reason:order.cancellationReason,refundId:refund?.id||''},session});
    return {...booking,refundRequest:refund?{id:refund.id,status:refund.status,amount:refund.amount,currency:refund.currency}:null};
  });
}
async function getPublicOrder(reference, lookupCode='', actor={}) {
  const ref=cleanText(reference,180);
  const booking=await repo.bookings.findOne({serviceType:'flight',$or:[{bookingRef:ref},{id:ref}]});
  if(!booking)throw validationError('Flight booking was not found',404);
  assertCustomerAccess(booking,lookupCode,actor);
  const [order,travelers,tickets,assignments]=await Promise.all([
    repo.orders.findOne({bookingId:booking.id,companyId:booking.companyId}),
    repo.travelers.list({bookingId:booking.id,companyId:booking.companyId}),
    repo.tickets.list({bookingId:booking.id,companyId:booking.companyId}),
    repo.seatAssignments.list({orderId:order?.id||'',companyId:booking.companyId}),
  ]);
  const publicBooking={...booking,guestLookupCode:undefined};
  return{booking:publicBooking,order,travelers:travelers.map(t=>({...t,documentNumberEncrypted:undefined})),tickets:tickets.map(t=>({...t,qrTokenHash:undefined})),assignments};
}
module.exports={createOrder,confirmPayment,failPayment,cancelOrder,getPublicOrder};
