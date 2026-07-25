'use strict';
const crypto = require('crypto');
function cleanText(value, max = 1000) { return String(value == null ? '' : value).replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
function normalize(value) { return cleanText(value, 120).toLowerCase().replace(/[\s-]+/g, '_'); }
function numberValue(value, field, min = 0, max = Number.MAX_SAFE_INTEGER, fallback) { if ((value === '' || value == null) && fallback !== undefined) return fallback; const n = Number(value); if (!Number.isFinite(n) || n < min || n > max) throw validationError(`${field} must be between ${min} and ${max}`); return n; }
function integerValue(value, field, min = 0, max = Number.MAX_SAFE_INTEGER, fallback) { return Math.round(numberValue(value, field, min, max, fallback)); }
function boolValue(value, fallback = false) { if (value == null || value === '') return fallback; return ['1','true','on','yes',true,1].includes(value); }
function parseList(value) { return (Array.isArray(value) ? value : String(value || '').split(/[\n,;]+/)).map((v) => cleanText(v, 180)).filter(Boolean); }
function validationError(message, status = 422, code = 'validation_error') { const e = new Error(message); e.status = status; e.code = code; return e; }
function notFoundError(message) { return validationError(message, 404, 'not_found'); }
function conflictError(message, code = 'conflict') { return validationError(message, 409, code); }
function code(prefix, bytes = 6) { return `${prefix}-${crypto.randomBytes(bytes).toString('hex').toUpperCase()}`; }
function randomToken(bytes = 24) { return crypto.randomBytes(bytes).toString('base64url'); }
function hashToken(token) { return crypto.createHash('sha256').update(String(token || '')).digest('hex'); }
function actorId(actor = {}) { return cleanText(actor.id || actor.userId || actor.actorId || actor.email || 'system', 180); }
function requireEnum(value, allowed, field) { const v = normalize(value); if (!allowed.includes(v)) throw validationError(`${field} is invalid`); return v; }
function point(payload = {}, prefix = '') {
  const address = cleanText(payload[`${prefix}Address`] || payload.address || payload.label, 500);
  const latitude = Number(payload[`${prefix}Latitude`] ?? payload.latitude);
  const longitude = Number(payload[`${prefix}Longitude`] ?? payload.longitude);
  const city = cleanText(payload[`${prefix}City`] || payload.city, 180);
  const district = cleanText(payload[`${prefix}District`] || payload.district, 180);
  const country = cleanText(payload[`${prefix}Country`] || payload.country, 180);
  if (!address) throw validationError(`${prefix || 'Location'} address is required`);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw validationError(`${prefix || 'Location'} coordinates are required and must be valid`);
  return { address, latitude, longitude, city, district, country, placeId: cleanText(payload[`${prefix}PlaceId`] || payload.placeId, 240) };
}
function haversineKm(a = {}, b = {}) { const R=6371; const toRad=(v)=>v*Math.PI/180; const dLat=toRad(Number(b.latitude)-Number(a.latitude)); const dLon=toRad(Number(b.longitude)-Number(a.longitude)); const x=Math.sin(dLat/2)**2+Math.cos(toRad(Number(a.latitude)))*Math.cos(toRad(Number(b.latitude)))*Math.sin(dLon/2)**2; return 2*R*Math.atan2(Math.sqrt(x),Math.sqrt(1-x)); }
function estimateRoadDistanceKm(a, b, stops = []) { const chain=[a,...stops,b]; let direct=0; for(let i=1;i<chain.length;i+=1) direct+=haversineKm(chain[i-1],chain[i]); return Math.max(0.5, direct * 1.22); }
function estimateDurationMinutes(distanceKm, serviceType = 'instant') { const speed = serviceType === 'intercity' ? 55 : serviceType === 'airport' ? 40 : 28; return Math.max(5, Math.ceil((distanceKm/speed)*60)); }
function assertTransition(current, next, map) { const allowed=map[normalize(current)]||[]; if(!allowed.includes(normalize(next))) throw conflictError(`Cannot move ride from ${current} to ${next}`, 'invalid_ride_transition'); return normalize(next); }
const RIDE_TRANSITIONS=Object.freeze({ awaiting_payment:['scheduled','dispatch_pending','cancelled','failed'], scheduled:['dispatch_pending','cancelled','failed'], dispatch_pending:['offering','assigned','cancelled','failed'], offering:['assigned','dispatch_pending','cancelled','failed'], assigned:['driver_arriving','cancelled','driver_no_show','safety_hold'], driver_arriving:['driver_arrived','cancelled','driver_no_show','safety_hold'], driver_arrived:['pickup_verified','customer_no_show','cancelled','safety_hold'], pickup_verified:['in_progress','cancelled','safety_hold'], in_progress:['completed','cancelled','safety_hold'], safety_hold:['assigned','driver_arriving','driver_arrived','in_progress','cancelled'], completed:['refunded'], customer_no_show:['refunded'], driver_no_show:['dispatch_pending','cancelled'], cancelled:['refunded'], refunded:[], failed:[] });
module.exports={ cleanText,normalize,numberValue,integerValue,boolValue,parseList,validationError,notFoundError,conflictError,code,randomToken,hashToken,actorId,requireEnum,point,haversineKm,estimateRoadDistanceKm,estimateDurationMinutes,assertTransition,RIDE_TRANSITIONS };
