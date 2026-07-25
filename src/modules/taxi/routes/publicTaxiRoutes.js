'use strict';
const express=require('express');
const {publicReadLimiter,publicWriteLimiter,paymentLimiter,ticketLimiter}=require('../../../middlewares/rateLimit');
const quoteService=require('../services/taxiQuoteService');
const rideService=require('../services/taxiRideService');
const travelPayment=require('../../../services/payment/travelDomainPaymentService');
const router=express.Router();
function actor(req){return{userId:req.session?.user?.id||'',id:req.session?.user?.id||'guest',bookingChannel:'web',referralCode:req.referral?.code||'',idempotencyKey:req.headers['idempotency-key']||req.body?.idempotencyKey||'',actorType:'customer'};}
router.post('/quotes',publicWriteLimiter,async(req,res,next)=>{try{res.json(await quoteService.createQuotes(req.body));}catch(e){next(e);}});
router.post('/rides',paymentLimiter,async(req,res,next)=>{try{const result=await rideService.createRide({...req.body,idempotencyKey:req.headers['idempotency-key']||req.body.idempotencyKey},actor(req));res.status(result.replayed?200:201).json(result);}catch(e){next(e);}});
router.post('/rides/:bookingRef/payment',paymentLimiter,async(req,res,next)=>{try{res.json(await travelPayment.initiate('local_transport',req.params.bookingRef,{...req.body,idempotencyKey:req.headers['idempotency-key']||req.body.idempotencyKey},actor(req)));}catch(e){next(e);}});
router.get('/rides/:reference',ticketLimiter,async(req,res,next)=>{try{res.json(await rideService.getPublicRide(req.params.reference,req.query.lookupCode,actor(req)));}catch(e){next(e);}});
router.get('/rides/:reference/tracking',publicReadLimiter,async(req,res,next)=>{try{const result=await rideService.getPublicRide(req.params.reference,req.query.lookupCode,actor(req));res.json({booking:result.booking,ride:result.ride,driver:result.driver,vehicle:result.vehicle,vehicleClass:result.vehicleClass,location:result.location,events:result.events});}catch(e){next(e);}});
router.post('/rides/:reference/cancel',publicWriteLimiter,async(req,res,next)=>{try{res.json(await rideService.cancelRide(req.params.reference,req.body.reason,{...actor(req),lookupCode:req.body.lookupCode}));}catch(e){next(e);}});
module.exports=router;
