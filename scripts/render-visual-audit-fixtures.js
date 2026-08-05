#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.visual-audit');
fs.mkdirSync(output, { recursive: true });

const money = (amount, currency = 'UGX') => `${currency} ${Number(amount || 0).toLocaleString('en-US')}`;
const toScriptJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
const shared = {
  seo: { title: 'Stay visual audit', description: 'Classic Trip stay visual audit fixture.' },
  seoConfig: { siteUrl: 'http://terminal.local:4173', defaultTitle: 'Classic Trip' },
  appName: 'Classic Trip',
  currentPath: '/listings/hotel/lake-victoria-villa',
  currentUser: null,
  dashboardUrl: '/company/dashboard',
  flashMessages: [],
  cspNonce: 'visual-audit',
  csrfToken: 'visual-audit',
  referralCode: '',
  toScriptJson,
  money,
};

const listing = {
  id: 'stay-1',
  slug: 'lake-victoria-villa',
  serviceType: 'hotel',
  type: 'Entire villa',
  title: 'Lake Victoria Garden Villa',
  sub: 'Private lakeside stay with breakfast, gardens and airport transfer options.',
  companySlug: 'kampala-stay-hosts',
  img: '/images/launch-lockup-512.png',
  media: [],
  partner: 'Kampala Stay Hosts',
  location: 'Munyonyo, Kampala',
  from: 'Munyonyo, Kampala',
  priceFrom: 185000,
  currency: 'UGX',
  bookable: true,
};

const rooms = [
  { id: 'deluxe-garden', roomType: 'Deluxe Garden Room', nightlyPrice: 185000, inventory: 4, availableUnits: 4, capacity: 2, bedType: '1 queen bed', amenities: ['Breakfast', 'Garden view'] },
  { id: 'family-suite', roomType: 'Family Two-Bedroom Suite', nightlyPrice: 320000, inventory: 2, availableUnits: 2, capacity: 5, bedType: '2 beds', amenities: ['Kitchen', 'Lake view'] },
  { id: 'entire-villa', roomType: 'Entire Four-Bedroom Villa', nightlyPrice: 780000, inventory: 1, availableUnits: 1, capacity: 8, bedType: '4 bedrooms', amenities: ['Private compound', 'Airport transfer'] },
  { id: 'rooftop-studio', roomType: 'Rooftop Studio', nightlyPrice: 210000, inventory: 0, availableUnits: 0, capacity: 2, bedType: '1 king bed', amenities: ['Balcony', 'City view'] },
];

const listingLocals = {
  ...shared,
  listing,
  company: { name: 'Kampala Stay Hosts', supportContacts: { phone: '+256 700 000 000' } },
  availability: { rooms },
  preview: {
    currency: 'UGX',
    previewRooms: rooms,
    firstRoom: 'deluxe-garden',
    selectedPreview: 'Deluxe Garden Room',
    serviceFee: 9250,
    totalEstimate: 194250,
    serviceIcon: 'fa-house-chimney',
    partnerName: 'Kampala Stay Hosts',
    supportPhone: '+256 700 000 000',
    ticketAccess: 'Voucher issued after confirmed payment',
    policy: 'Free cancellation until 48 hours before check-in',
    addons: [
      { id: 'breakfast', name: 'Breakfast', description: 'Daily breakfast for each guest.', price: 25000, currency: 'UGX', chargeBasis: 'per_passenger_per_leg', icon: 'fa-mug-hot' },
      { id: 'airport', name: 'Airport transfer', description: 'Private one-way airport pickup.', price: 90000, currency: 'UGX', chargeBasis: 'per_booking', icon: 'fa-car-side' },
    ],
  },
  platformConfig: { defaultCurrency: 'UGX', customerServiceFeePercent: 5, customerServiceFeeFlat: 0, customerTaxPercent: 0 },
};

const dashboardData = {
  hotelSubview: 'properties',
  options: { hotelListings: [{ id: 'stay-1', title: listing.title }] },
  hotelProperties: [{ id: 'property-1', propertyName: listing.title }],
  roomTypes: rooms.slice(0, 3),
  ratePlans: [{ id: 'rate-1', name: 'Flexible breakfast' }, { id: 'rate-2', name: 'Non-refundable' }],
  roomUnits: Array.from({ length: 10 }, (_, index) => ({ id: `unit-${index + 1}` })),
  roomNightInventory: Array.from({ length: 14 }, (_, index) => ({ id: `night-${index + 1}` })),
  hotelArrivals: [{ id: 'arrival-1' }, { id: 'arrival-2' }],
  hotelInHouse: [{ id: 'stay-live-1' }],
  hotelDepartures: [{ id: 'departure-1' }],
  hotelHousekeepingTasks: [{ status: 'open', taskType: 'cleaning' }, { status: 'blocked', taskType: 'maintenance' }],
  roomVisualMaps: [{
    roomTypeId: 'deluxe-garden', roomTypeName: 'Deluxe Garden Room', propertyName: listing.title,
    listingId: listing.id, listingTitle: listing.title, status: 'active',
    rooms: [
      { roomUnitId: '101', unitNumber: '101', floor: '1', wing: 'Garden', housekeepingStatus: 'clean', status: 'available' },
      { roomUnitId: '102', unitNumber: '102', floor: '1', wing: 'Garden', housekeepingStatus: 'clean', status: 'booked', bookingRef: 'CT-1002', guestName: 'Booked guest' },
      { roomUnitId: '201', unitNumber: '201', floor: '2', wing: 'Lake', housekeepingStatus: 'cleaning', status: 'cleaning' },
      { roomUnitId: '202', unitNumber: '202', floor: '2', wing: 'Lake', housekeepingStatus: 'maintenance', status: 'maintenance' },
      { roomUnitId: '301', unitNumber: '301', floor: '3', wing: 'Rooftop', housekeepingStatus: 'inspected', status: 'reserved', bookingRef: 'CT-1005' },
    ],
  }],
};

async function render() {
  const stayHtml = await ejs.renderFile(path.join(root, 'src/views/pages/listing-details.ejs'), listingLocals, { async: false });
  fs.writeFileSync(path.join(output, 'stay.html'), stayHtml);

  const hotelSection = await ejs.renderFile(path.join(root, 'src/views/dashboards/shared/sections/hotel-rooms.ejs'), {
    dashboardData,
    isCompanyDashboard: true,
    companySupportsHotel: true,
  }, { async: false });
  const dashboardHtml = `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stay dashboard visual audit</title><link rel="stylesheet" href="/css/base.css"><link rel="stylesheet" href="/css/components.css"><link rel="stylesheet" href="/css/dashboard-workspace.css"><link rel="stylesheet" href="/css/dashboard-service-additions.css"><link rel="stylesheet" href="/css/completion-fixes.css"><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css"><style>.section{display:block!important}</style></head><body class="dashboardBody"><main class="main" style="max-width:1320px;margin:0 auto;padding:14px">${hotelSection}</main></body></html>`;
  fs.writeFileSync(path.join(output, 'hotel-dashboard.html'), dashboardHtml);
  process.stdout.write(`${output}\n`);
}

render().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
