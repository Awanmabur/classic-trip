'use strict';

const SERVICE_REGISTRY = Object.freeze({
  bus: Object.freeze({ key: 'bus', label: 'Buses', singular: 'Bus', icon: 'fa-bus', status: 'active', bookable: true, description: 'Intercity and regional bus travel with dated departures and live seats.' }),
  hotel: Object.freeze({ key: 'hotel', label: 'Hotels & stays', singular: 'Hotel', icon: 'fa-hotel', status: 'active', bookable: true, description: 'Hotels, apartments, rooms and nightly inventory.' }),
  flight: Object.freeze({ key: 'flight', label: 'Flights', singular: 'Flight', icon: 'fa-plane', status: 'coming_soon', bookable: false, description: 'Airline schedules, fares and flight bookings are coming soon.' }),
  train: Object.freeze({ key: 'train', label: 'Trains', singular: 'Train', icon: 'fa-train', status: 'coming_soon', bookable: false, description: 'Rail routes, classes and train reservations are coming soon.' }),
  local_transport: Object.freeze({ key: 'local_transport', label: 'Local transport', singular: 'Local transport', icon: 'fa-taxi', status: 'coming_soon', bookable: false, description: 'Taxis, shuttles, boda, local buses and transfers are coming soon.' }),
  tour: Object.freeze({ key: 'tour', label: 'Tours & activities', singular: 'Tour', icon: 'fa-map-location-dot', status: 'coming_soon', bookable: false, description: 'Guided tours, activities and destination experiences are coming soon.' }),
  car_rental: Object.freeze({ key: 'car_rental', label: 'Car rentals', singular: 'Car rental', icon: 'fa-car-side', status: 'coming_soon', bookable: false, description: 'Self-drive and chauffeured vehicle rentals are coming soon.' }),
  cargo: Object.freeze({ key: 'cargo', label: 'Cargo & parcels', singular: 'Cargo', icon: 'fa-box', status: 'coming_soon', bookable: false, description: 'Parcel, freight and cargo movement services are coming soon.' }),
  ferry: Object.freeze({ key: 'ferry', label: 'Ferries', singular: 'Ferry', icon: 'fa-ship', status: 'coming_soon', bookable: false, description: 'Water transport routes and ferry reservations are coming soon.' }),
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
