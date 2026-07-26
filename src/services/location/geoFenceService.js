'use strict';

const { normalize, haversineKm } = require('../../modules/taxi/domain/taxiDomain');

function finitePoint(row = {}) {
  const latitude = Number(row.latitude);
  const longitude = Number(row.longitude);
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

function pointInPolygon(point = {}, polygon = []) {
  if (!finitePoint(point) || !Array.isArray(polygon) || polygon.length < 3) return false;
  const x = Number(point.longitude);
  const y = Number(point.latitude);
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = Number(polygon[i]?.longitude);
    const yi = Number(polygon[i]?.latitude);
    const xj = Number(polygon[j]?.longitude);
    const yj = Number(polygon[j]?.latitude);
    if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
    const intersects = ((yi > y) !== (yj > y))
      && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function withinZone(zone = {}, pickup = {}) {
  if (!finitePoint(pickup)) return false;
  const zoneType = normalize(zone.zoneType || '');
  const polygon = Array.isArray(zone.polygon) ? zone.polygon : [];
  const hasPolygon = polygon.length >= 3;
  const hasRadius = finitePoint(zone.center) && Number(zone.radiusKm || 0) > 0;

  if (hasPolygon && !pointInPolygon(pickup, polygon)) return false;
  if (hasRadius && haversineKm(zone.center, pickup) > Number(zone.radiusKm)) return false;

  const countryCodeMatches = zone.countryCode && pickup.countryCode
    ? normalize(zone.countryCode) === normalize(pickup.countryCode)
    : null;
  const countryMatches = zone.country && pickup.country
    ? normalize(zone.country) === normalize(pickup.country)
    : null;
  if (countryCodeMatches === false || countryMatches === false) return false;

  if (zone.city && pickup.city && normalize(zone.city) !== normalize(pickup.city)
    && !['national', 'intercity_corridor'].includes(zoneType)) return false;
  if (zone.district && pickup.district && normalize(zone.district) !== normalize(pickup.district)
    && zoneType === 'district') return false;

  if (hasPolygon || hasRadius) return true;

  // Text-only zones are valid for trusted place records only. Unknown GPS
  // coordinates must never fall into an arbitrary first zone.
  if (zone.countryCode && countryCodeMatches !== true && zone.country && countryMatches !== true) return false;
  if (zoneType === 'district' && zone.district && !pickup.district) return false;
  if (['city', 'airport'].includes(zoneType) && zone.city && !pickup.city) return false;
  if (['national', 'intercity_corridor'].includes(zoneType) && !pickup.countryCode && !pickup.country) return false;
  return true;
}

module.exports = { finitePoint, pointInPolygon, withinZone };
