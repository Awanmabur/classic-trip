'use strict';
const { MongoCollection } = require('../../repositories/domain/mongoCollection');
const { cleanText, validationError } = require('../../modules/taxi/domain/taxiDomain');
const places = new MongoCollection('places');

function publicPlace(row = {}) {
  return {
    id: row.id,
    name: row.name,
    shortName: row.shortName || row.name,
    type: row.type,
    country: row.country,
    countryCode: row.countryCode,
    city: row.city,
    district: row.district,
    address: row.address || row.name,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
  };
}

async function search(query, options = {}) {
  const text = cleanText(query, 100);
  if (text.length < 2) return [];
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const filter = {
    status: 'active',
    $or: [
      { name: { $regex: escaped, $options: 'i' } },
      { shortName: { $regex: escaped, $options: 'i' } },
      { city: { $regex: escaped, $options: 'i' } },
      { district: { $regex: escaped, $options: 'i' } },
      { address: { $regex: escaped, $options: 'i' } },
      { searchableTerms: { $regex: escaped, $options: 'i' } },
    ],
  };
  if (options.countryCode) filter.countryCode = cleanText(options.countryCode, 3).toUpperCase();
  const rows = await places.list(filter, { sort: { priority: -1, name: 1 }, limit: Math.min(Number(options.limit || 12), 30) });
  return rows.map(publicPlace);
}

async function get(id) {
  const row = await places.findOne({ id: cleanText(id, 180), status: 'active' });
  if (!row) throw validationError('Selected place is no longer available', 404, 'place_not_found');
  return publicPlace(row);
}

async function resolve(payload = {}, prefix = '') {
  const placeId = cleanText(payload[`${prefix}PlaceId`] || payload.placeId, 180);
  if (placeId && placeId !== 'current-location') {
    const place = await get(placeId);
    return {
      address: place.address || place.name,
      latitude: place.latitude,
      longitude: place.longitude,
      city: place.city,
      district: place.district,
      country: place.country,
      countryCode: place.countryCode,
      placeId: place.id,
      type: place.type,
    };
  }
  const address = cleanText(payload[`${prefix}Address`] || payload.address || payload.label, 500);
  const latitude = Number(payload[`${prefix}Latitude`] ?? payload.latitude);
  const longitude = Number(payload[`${prefix}Longitude`] ?? payload.longitude);
  if (!address) throw validationError(`${prefix || 'Location'} address is required`);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw validationError(`Choose a valid ${prefix || 'location'} from the suggestions or use current location`);
  }
  return {
    address, latitude, longitude,
    city: cleanText(payload[`${prefix}City`] || payload.city, 180),
    district: cleanText(payload[`${prefix}District`] || payload.district, 180),
    country: cleanText(payload[`${prefix}Country`] || payload.country, 180),
    countryCode: cleanText(payload[`${prefix}CountryCode`] || payload.countryCode, 3).toUpperCase(),
    placeId: placeId || 'current-location',
    type: placeId === 'current-location' ? 'current_location' : 'address',
  };
}

module.exports = { search, get, resolve, publicPlace };
