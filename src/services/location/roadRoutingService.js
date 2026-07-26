'use strict';

const { env } = require('../../config/env');
const {
  estimateRoadDistanceKm,
  estimateDurationMinutes,
  validationError,
} = require('../../modules/taxi/domain/taxiDomain');

function number(value, field, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw validationError(`${field} is invalid`);
  }
  return parsed;
}

function point(row = {}, label = 'Location') {
  return {
    latitude: number(row.latitude, `${label} latitude`, -90, 90),
    longitude: number(row.longitude, `${label} longitude`, -180, 180),
  };
}

function fallbackRoute(pickup, destination, stops = [], serviceType = 'instant', reason = 'routing_provider_unavailable') {
  const chain = [pickup, ...stops, destination].map((row, index) => point(row, `Route point ${index + 1}`));
  const distanceKm = Math.round(estimateRoadDistanceKm(pickup, destination, stops) * 100) / 100;
  return {
    distanceKm,
    durationMinutes: estimateDurationMinutes(distanceKm, serviceType),
    geometry: chain,
    source: 'estimated',
    provider: 'fallback',
    warning: reason,
  };
}

function routeUrl(points) {
  const base = String(env.maps.routingApiUrl || '').replace(/\/+$/, '');
  const profile = String(env.maps.routingProfile || 'driving').replace(/[^a-z0-9_-]/gi, '') || 'driving';
  const coordinates = points.map((row) => `${row.longitude},${row.latitude}`).join(';');
  return `${base}/route/v1/${profile}/${coordinates}?overview=full&geometries=geojson&steps=false&alternatives=false`;
}

async function liveRoute(pickup, destination, stops = []) {
  if (!env.maps.routingApiUrl) return null;
  const points = [pickup, ...stops, destination].map((row, index) => point(row, `Route point ${index + 1}`));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1500, Number(env.maps.routingTimeoutMs || 8000)));
  try {
    const response = await fetch(routeUrl(points), {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': `${env.appName || 'Classic Trip'}/1.0` },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const route = Array.isArray(payload.routes) ? payload.routes[0] : null;
    const coordinates = route?.geometry?.coordinates;
    if (!route || !Array.isArray(coordinates) || coordinates.length < 2) return null;
    const geometry = coordinates
      .map((pair) => ({ latitude: Number(pair?.[1]), longitude: Number(pair?.[0]) }))
      .filter((row) => Number.isFinite(row.latitude) && Number.isFinite(row.longitude));
    if (geometry.length < 2) return null;
    return {
      distanceKm: Math.round((Number(route.distance || 0) / 1000) * 100) / 100,
      durationMinutes: Math.max(1, Math.ceil(Number(route.duration || 0) / 60)),
      geometry,
      source: 'live',
      provider: new URL(env.maps.routingApiUrl).hostname,
      warning: '',
    };
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function planRoute({ pickup, destination, stops = [], serviceType = 'instant' }) {
  const live = await liveRoute(pickup, destination, stops);
  if (live) return live;
  if (env.maps.requireLiveRouting) {
    throw validationError('Live road routing is temporarily unavailable. Please try again shortly.', 503, 'routing_provider_unavailable');
  }
  return fallbackRoute(pickup, destination, stops, serviceType);
}

function publicMapConfig() {
  return {
    tileUrl: env.maps.tileUrl,
    tileAttribution: env.maps.tileAttribution,
    defaultLatitude: env.maps.defaultLatitude,
    defaultLongitude: env.maps.defaultLongitude,
    defaultZoom: env.maps.defaultZoom,
    liveRoutingRequired: env.maps.requireLiveRouting,
  };
}

module.exports = { planRoute, publicMapConfig, fallbackRoute };
