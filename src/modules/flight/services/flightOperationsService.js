'use strict';
const repo=require('../repositories/flightRepository');
const {cleanText,normalize,validationError,conflictError,actorId}=require('../domain/flightDomain');
function now(){return new Date();} function opts(session){return session?{session}:{};}
async function manifest(departureId,companyId){const departure=await repo.oneOrThrow(repo.departures,{id:departureId,companyId},'Flight departure was not found');const inventory=await repo.seatInventory.list({departureId,companyId,status:{$in:['booked','checked_in','boarded']}},{sort:{seatNumber:1},limit:1500});const travelerIds=inventory.map(s=>s.travelerId).filter(Boolean);const travelers=travelerIds.length?await repo.travelers.list({id:{$in:travelerIds},companyId}):[];const tickets=travelerIds.length?await repo.tickets.list({travelerId:{$in:travelerIds},companyId}):[];const map=new Map(travelers.map(t=>[t.id,t]));return{departure,rows:inventory.map(seat=>{const t=map.get(seat.travelerId)||{};const ticket=tickets.find(x=>x.travelerId===t.id);return{seatNumber:seat.seatNumber,passengerName:`${t.firstName||''} ${t.lastName||''}`.trim(),passengerType:t.passengerType||'',nationality:t.nationality||'',documentLast4:t.documentNumberLast4||'',status:t.status||'',ticketNumber:ticket?.ticketNumber||''};})};}
async function transitionTraveler({companyId,departureId,ticketNumber,status,actor={}}){status=normalize(status);if(!['checked_in','boarded','no_show','completed'].includes(status))throw validationError('Flight traveler status is invalid');return repo.withTransaction(async(session)=>{const ticket=await repo.oneOrThrow(repo.tickets,{ticketNumber:cleanText(ticketNumber,80),companyId},'Flight ticket was not found',opts(session));const coupon=(ticket.coupons||[]).find(c=>c.departureId===departureId);if(!coupon)throw validationError('Ticket is not valid for this departure',403);const traveler=await repo.oneOrThrow(repo.travelers,{id:ticket.travelerId,companyId},'Flight traveler was not found',opts(session));const assignment=await repo.seatAssignments.findOne({travelerId:traveler.id,departureId,companyId},opts(session));const inventory=assignment?await repo.seatInventory.findOne({id:assignment.inventoryId,companyId},opts(session)):null;
    if(status==='checked_in'){if(!['confirmed','checked_in'].includes(traveler.status))throw conflictError('Traveler cannot be checked in');traveler.status='checked_in';ticket.status='checked_in';coupon.status='checked_in';if(assignment)assignment.status='checked_in';if(inventory)inventory.status='checked_in';}
    if(status==='boarded'){if(traveler.status!=='checked_in')throw conflictError('Traveler must check in before boarding');traveler.status='boarded';ticket.status='partially_used';coupon.status='boarded';if(assignment)assignment.status='boarded';if(inventory)inventory.status='boarded';}
    if(status==='no_show'){traveler.status='no_show';coupon.status='no_show';}
    if(status==='completed'){if(!['boarded','checked_in'].includes(traveler.status))throw conflictError('Only checked-in or boarded travelers can be completed');coupon.status='flown';ticket.status=(ticket.coupons||[]).every(c=>c.status==='flown')?'used':'partially_used';}
    traveler.updatedAt=now();ticket.updatedAt=now();await repo.travelers.save(traveler,{id:traveler.id},opts(session));await repo.tickets.save(ticket,{id:ticket.id},opts(session));if(assignment)await repo.seatAssignments.save(assignment,{id:assignment.id},opts(session));if(inventory)await repo.seatInventory.save(inventory,{id:inventory.id},opts(session));await repo.audit({actorId:actorId(actor),action:`flight.traveler.${status}`,targetType:'flight_ticket',targetId:ticket.id,companyId,metadata:{departureId},session});return{ticket,traveler,assignment};});}
async function updateDeparture(departureId,companyId,payload={},actor={}){
  const settledBookings=[];
  const departure=await repo.withTransaction(async(session)=>{
    const options=opts(session);
    const row=await repo.oneOrThrow(repo.departures,{id:departureId,companyId},'Flight departure was not found',options);
    const status=normalize(payload.status||row.operationalStatus);
    const allowed=['scheduled','check_in_open','boarding','departed','arrived','delayed','cancelled','completed'];
    if(!allowed.includes(status))throw validationError('Flight operational status is invalid');
    row.operationalStatus=status;row.delayMinutes=Math.max(0,Number(payload.delayMinutes||row.delayMinutes||0));row.gate=cleanText(payload.gate||row.gate,40);row.statusNote=cleanText(payload.statusNote,1000);
    if(status==='cancelled')row.publicationStatus='cancelled';if(status==='completed')row.publicationStatus='completed';row.updatedAt=now();
    await repo.departures.save(row,{id:row.id},options);
    if(status==='completed'){
      const tickets=await repo.tickets.list({companyId,'coupons.departureId':row.id},{...options,limit:2000});
      const orderIds=new Set();
      for(const ticket of tickets){
        ticket.coupons=(ticket.coupons||[]).map((coupon)=>coupon.departureId===row.id&&['checked_in','boarded','confirmed','issued'].includes(normalize(coupon.status))?{...coupon,status:'flown',flownAt:now()}:coupon);
        ticket.status=(ticket.coupons||[]).every((coupon)=>normalize(coupon.status)==='flown')?'used':'partially_used';ticket.updatedAt=now();
        await repo.tickets.save(ticket,{id:ticket.id},options);orderIds.add(ticket.orderId);
      }
      await repo.seatAssignments.updateMany({companyId,departureId:row.id,status:{$in:['checked_in','boarded','confirmed']}},{$set:{status:'boarded',updatedAt:now()}},options);
      await repo.seatInventory.updateMany({companyId,departureId:row.id,status:{$in:['checked_in','boarded','booked']}},{$set:{status:'boarded',updatedAt:now()}},options);
      for(const orderId of orderIds){
        const order=await repo.orders.findOne({id:orderId,companyId},options);if(!order)continue;
        const segmentIds=(order.segmentSnapshot||[]).map((segment)=>segment.departureId).filter(Boolean);
        const segmentDepartures=segmentIds.length?await repo.departures.list({id:{$in:segmentIds},companyId},{...options,limit:20}):[];
        if(segmentDepartures.length!==segmentIds.length||segmentDepartures.some((segment)=>!['completed','cancelled'].includes(normalize(segment.operationalStatus))))continue;
        order.status='completed';order.settlementStatus='eligible';order.completedAt=now();order.updatedAt=now();await repo.orders.save(order,{id:order.id},options);
        await repo.travelers.updateMany({orderId:order.id,companyId,status:{$in:['checked_in','confirmed']}},{$set:{status:'boarded',updatedAt:now()}},options);
        const booking=await repo.bookings.findOne({id:order.bookingId,companyId},options);if(!booking)continue;
        booking.bookingStatus='completed';booking.completedAt=now();booking.settlementStatus='eligible';booking.ticketLegs=(booking.ticketLegs||[]).map((leg)=>({...leg,status:'completed',completedAt:now()}));booking.updatedAt=now();
        await repo.bookings.save(booking,{id:booking.id},options);await repo.bookingItems.updateMany({bookingId:booking.id,serviceType:'flight'},{$set:{status:'completed',updatedAt:now()}},options);settledBookings.push(booking);
      }
    }
    await repo.outbox({eventType:'FlightScheduleChanged',aggregateType:'flight_departure',aggregateId:row.id,companyId,payload:{status,delayMinutes:row.delayMinutes,gate:row.gate},session});
    await repo.audit({actorId:actorId(actor),action:'flight.departure.status_updated',targetType:'flight_departure',targetId:row.id,companyId,metadata:{status},session});return row;
  });
  if(settledBookings.length){const paymentSettlementService=require('../../../services/booking/paymentSettlementService');for(const booking of settledBookings)await paymentSettlementService.settleBookingPayment(booking,{source:'flight_departure_completed'});}
  return departure;
}
module.exports={manifest,transitionTraveler,updateDeparture};
