'use strict';

const PARTNER_PROFILES = Object.freeze({
  bus_operator: Object.freeze({
    key: 'bus_operator',
    companyType: 'bus',
    label: 'Bus operator',
    accountModel: 'organization',
    ownerLabel: 'Company owner / authorised representative',
    description: 'Licensed bus company operating routes, vehicles, departures and passenger services.',
    requiredFields: ['legalName', 'registrationNumber', 'country', 'city'],
  }),
  hotel_partner: Object.freeze({
    key: 'hotel_partner',
    companyType: 'hotel',
    label: 'Hotel or stay partner',
    accountModel: 'organization',
    ownerLabel: 'Property owner / authorised representative',
    description: 'Hotel, lodge, apartment, guesthouse or other verified accommodation provider.',
    requiredFields: ['legalName', 'country', 'city'],
  }),
  flight_agent: Object.freeze({
    key: 'flight_agent',
    companyType: 'flight',
    label: 'Flight travel agent',
    accountModel: 'agency',
    ownerLabel: 'Agency owner / authorised representative',
    description: 'Accredited travel agency that sells supplier-controlled airline offers and supports travelers.',
    requiredFields: ['legalName', 'agencyLicenceNumber', 'country', 'city'],
  }),
  boda_rider: Object.freeze({
    key: 'boda_rider',
    companyType: 'local_transport',
    label: 'Boda rider',
    accountModel: 'individual_driver',
    ownerLabel: 'Rider',
    description: 'Individual motorcycle rider applying to receive platform-dispatched trips.',
    requiredFields: ['nationalIdNumber', 'driverLicenceNumber', 'driverLicenceExpiry', 'vehicleRegistrationNumber', 'vehicleType', 'vehicleMake', 'vehicleModel', 'vehicleYear', 'vehicleColor', 'insuranceExpiry', 'country', 'city'],
  }),
  car_driver: Object.freeze({
    key: 'car_driver',
    companyType: 'local_transport',
    label: 'Car driver',
    accountModel: 'individual_driver',
    ownerLabel: 'Driver',
    description: 'Individual car driver applying to receive platform-dispatched trips.',
    requiredFields: ['nationalIdNumber', 'driverLicenceNumber', 'driverLicenceExpiry', 'vehicleRegistrationNumber', 'vehicleType', 'vehicleMake', 'vehicleModel', 'vehicleYear', 'vehicleColor', 'insuranceExpiry', 'country', 'city'],
  }),
  fleet_owner: Object.freeze({
    key: 'fleet_owner',
    companyType: 'local_transport',
    label: 'Vehicle, rental or fleet owner',
    accountModel: 'fleet',
    ownerLabel: 'Fleet owner / authorised representative',
    description: 'Owner of one or more motorcycles, rental cars, taxis or vans who assigns verified drivers to approved vehicles.',
    requiredFields: ['legalName', 'fleetSize', 'vehicleTypes', 'country', 'city'],
  }),
  taxi_company: Object.freeze({
    key: 'taxi_company',
    companyType: 'local_transport',
    label: 'Taxi or mobility company',
    accountModel: 'organization',
    ownerLabel: 'Company owner / authorised representative',
    description: 'Registered taxi, airport-transfer or local mobility company operating an approved fleet.',
    requiredFields: ['legalName', 'registrationNumber', 'fleetSize', 'country', 'city'],
  }),
});

const PARTNER_PROFILE_KEYS = Object.freeze(Object.keys(PARTNER_PROFILES));

const PROFILE_CAPABILITIES = Object.freeze({
  bus_operator: Object.freeze({ manageOwnListings: true, manageOwnInventory: true, manageOwnStaff: true, manageOwnPricing: true, managePlatformPricing: false }),
  hotel_partner: Object.freeze({ manageOwnListings: true, manageOwnInventory: true, manageOwnStaff: true, manageOwnPricing: true, managePlatformPricing: false }),
  flight_agent: Object.freeze({ searchSupplierOffers: true, createCustomerQuotes: true, createBookings: true, manageTravelers: true, viewTickets: true, requestChangesAndRefunds: true, manageAirlines: false, manageAircraft: false, manageSeatMaps: false, manageSupplierInventory: false }),
  boda_rider: Object.freeze({ manageOwnDriverProfile: true, manageOwnVehicle: true, updateAvailability: true, acceptAssignedRides: true, viewOwnEarnings: true, manageDrivers: false, manageFareRules: false, manageServiceZones: false, manualDispatch: false }),
  car_driver: Object.freeze({ manageOwnDriverProfile: true, manageOwnVehicle: true, updateAvailability: true, acceptAssignedRides: true, viewOwnEarnings: true, manageDrivers: false, manageFareRules: false, manageServiceZones: false, manualDispatch: false }),
  fleet_owner: Object.freeze({ manageOwnFleet: true, manageOwnDrivers: true, viewFleetRides: true, viewFleetEarnings: true, manageFareRules: false, manageServiceZones: false, manageVehicleClasses: false, manualDispatch: false }),
  taxi_company: Object.freeze({ manageOwnFleet: true, manageOwnDrivers: true, viewCompanyRides: true, viewCompanyEarnings: true, manageDispatchStaff: true, manageFareRules: false, manageServiceZones: false, manageVehicleClasses: false, manualDispatch: false }),
});

function capabilityPolicyFor(value) {
  const key = normalizePartnerProfile(value);
  return key ? { ...PROFILE_CAPABILITIES[key] } : {};
}

function normalizePartnerProfile(value) {
  const key = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return Object.prototype.hasOwnProperty.call(PARTNER_PROFILES, key) ? key : '';
}

function partnerProfile(value) {
  const key = normalizePartnerProfile(value);
  return key ? PARTNER_PROFILES[key] : null;
}

function profilesForService(companyType) {
  return PARTNER_PROFILE_KEYS.map((key) => PARTNER_PROFILES[key]).filter((profile) => profile.companyType === companyType);
}

module.exports = { PARTNER_PROFILES, PARTNER_PROFILE_KEYS, PROFILE_CAPABILITIES, normalizePartnerProfile, partnerProfile, profilesForService, capabilityPolicyFor };
