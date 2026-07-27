'use strict';

const SERVICE_REGISTRY = Object.freeze({
  bus: Object.freeze({ key: 'bus', label: 'Buses', singular: 'Bus', icon: 'fa-bus', status: 'active', bookable: true, description: 'Intercity and regional bus travel with dated departures and live seats.' }),
  hotel: Object.freeze({ key: 'hotel', label: 'Stays', singular: 'Stay', icon: 'fa-house', status: 'active', bookable: true, description: 'Hotels, apartments, entire homes, private rooms, villas, cottages, guest houses and nightly inventory.' }),
  flight: Object.freeze({ key: 'flight', label: 'Flights', singular: 'Flight', icon: 'fa-plane', status: 'active', bookable: true, description: 'Platform-approved airline and certified supplier offers sold directly or with verified flight-agent assistance, including baggage, seats, ticketing and post-booking support.' }),
  local_transport: Object.freeze({ key: 'local_transport', label: 'Local rides', singular: 'Local ride', icon: 'fa-taxi', status: 'active', bookable: true, description: 'Simple boda and car rides with upfront platform pricing, verified drivers, automatic dispatch, airport transfers and scheduled trips.' }),
  tour: Object.freeze({ key: 'tour', label: 'Tours & activities', singular: 'Tour', icon: 'fa-map-location-dot', status: 'active', bookable: true, description: 'Verified guided tours, activities, excursions and destination experiences with dated capacity.' }),
  car_rental: Object.freeze({ key: 'car_rental', label: 'Car rentals', singular: 'Car rental', icon: 'fa-car-side', status: 'active', bookable: true, description: 'Verified self-drive and chauffeured vehicle rentals with pickup, return and live availability.' }),
  cargo: Object.freeze({ key: 'cargo', label: 'Cargo & parcels', singular: 'Cargo', icon: 'fa-box', status: 'active', bookable: true, description: 'Verified parcel, freight and cargo transport with pickup, delivery, weight and package details.' }),
});

const ALL_SERVICE_TYPES = Object.freeze(Object.keys(SERVICE_REGISTRY));
const ACTIVE_SERVICE_TYPES = Object.freeze(ALL_SERVICE_TYPES.filter((key) => SERVICE_REGISTRY[key].status === 'active'));
const COMING_SOON_SERVICE_TYPES = Object.freeze(ALL_SERVICE_TYPES.filter((key) => SERVICE_REGISTRY[key].status === 'coming_soon'));

function normalizeServiceType(value) {
  const key = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return Object.prototype.hasOwnProperty.call(SERVICE_REGISTRY, key) ? key : '';
}

function serviceDefinition(value) {
  const key = normalizeServiceType(value);
  return key ? SERVICE_REGISTRY[key] : null;
}

function isOperationalService(value) {
  const definition = serviceDefinition(value);
  return Boolean(definition && definition.status === 'active');
}

module.exports = { SERVICE_REGISTRY, ALL_SERVICE_TYPES, ACTIVE_SERVICE_TYPES, COMING_SOON_SERVICE_TYPES, normalizeServiceType, serviceDefinition, isOperationalService };
