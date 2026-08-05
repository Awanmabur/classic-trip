#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { renderRole } = require('./check-platform-experience-final');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.frontend-audit');
fs.mkdirSync(output, { recursive: true });

const money = (amount, currency = 'UGX') => `${currency} ${Number(amount || 0).toLocaleString('en-GB')}`;
const toScriptJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
const platformConfig = {
  defaultCurrency: 'UGX', supportedCurrencies: ['UGX', 'KES', 'USD'], holdMinutes: 15,
  partnerCommissionPercent: 10, partnerPayoutPercent: 90, promoterSharePercent: 10,
  customerServiceFeePercent: 5, customerServiceFeeFlat: 0, customerTaxPercent: 0,
};
const baseLocals = {
  seo: { title: 'Classic Trip frontend audit', description: 'Deterministic frontend audit fixture.' },
  seoConfig: { siteUrl: 'http://127.0.0.1:4173', defaultTitle: 'Classic Trip' },
  siteUrl: 'http://127.0.0.1:4173', appName: 'Classic Trip', currentPath: '/', currentUser: null,
  dashboardUrl: '/customer/dashboard', flashMessages: [], cspNonce: 'frontend-audit', csrfToken: 'frontend-audit',
  platformConfig, money, toScriptJson,
};
const image = '/images/launch-lockup-512.png';
const serviceInfo = {
  bus: ['Regional Express', 'Kampala → Nairobi', 85000, 'fa-bus'],
  hotel: ['Lake Victoria Garden Villa', 'Munyonyo, Kampala', 185000, 'fa-house'],
  flight: ['Entebbe to Nairobi Flight', 'EBB → NBO', 920000, 'fa-plane'],
  local_transport: ['Kampala Safe Ride', 'Kampala and Entebbe', 35000, 'fa-taxi'],
  tour: ['Murchison Falls Experience', 'Murchison Falls', 250000, 'fa-map-location-dot'],
  car_rental: ['Compact SUV Rental', 'Kampala pickup', 180000, 'fa-car-side'],
  cargo: ['Regional Parcel Delivery', 'Kampala → Juba', 45000, 'fa-box'],
};

function listing(serviceType, index = 0) {
  const [title, location, priceFrom] = serviceInfo[serviceType];
  const suffix = index ? ` ${index + 1}` : '';
  return {
    id: `${serviceType}-${index + 1}`, slug: `${serviceType}-audit-${index + 1}`, serviceType, group: serviceType,
    title: `${title}${suffix}`, type: serviceType === 'hotel' ? 'Entire villa' : serviceType,
    typeLabel: serviceType === 'hotel' ? 'Entire home' : undefined, stayType: serviceType === 'hotel' ? 'entire_home' : '',
    sub: `Verified ${serviceType.replace('_', ' ')} service with clear availability, pricing and booking information for frontend testing.`,
    description: `Verified ${serviceType.replace('_', ' ')} service with clear availability, pricing and booking information for frontend testing.`,
    location, from: serviceType === 'bus' || serviceType === 'cargo' || serviceType === 'flight' ? location.split(/ → /)[0] : location,
    to: serviceType === 'bus' || serviceType === 'cargo' || serviceType === 'flight' ? location.split(/ → /)[1] : location,
    routeLabel: location, partner: 'Classic Trip Audit Partner', companyName: 'Classic Trip Audit Partner', companySlug: 'audit-partner',
    img: image, media: [{ url: image }], priceFrom: priceFrom + (index * 5000), currency: 'UGX', ratingAverage: 4.6,
    remainingInventory: Math.max(1, 12 - index), availability: Math.max(1, 12 - index), bookable: true,
    bookingUrl: `/listings/${serviceType}/${serviceType}-audit-${index + 1}`, url: `/listings/${serviceType}/${serviceType}-audit-${index + 1}`,
    corridor: serviceType === 'bus' ? 'Kampala–Nairobi' : 'regional', instantConfirmation: true,
    serviceDetails: { meetingPoint: 'Main visitor centre' }, maxGuests: 20, pricingUnit: serviceType === 'cargo' ? 'per_package' : '',
  };
}

const categories = Object.entries(serviceInfo).map(([key, value]) => ({ key, label: key === 'hotel' ? 'Stays' : key.replace('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase()), icon: value[3] }));
const listings = Object.keys(serviceInfo).flatMap((type) => Array.from({ length: type === 'bus' ? 5 : 3 }, (_, index) => listing(type, index)));
listings[0].isSponsored = true;
const corridorStats = [{ corridor: 'Kampala–Nairobi', label: 'Kampala–Nairobi', seats: 39 }, { corridor: 'Kampala–Juba', label: 'Kampala–Juba', seats: 24 }];

async function renderPage(template, name, locals) {
  const html = await ejs.renderFile(path.join(root, 'src/views', template), { ...baseLocals, ...locals });
  fs.writeFileSync(path.join(output, `${name}.html`), html);
}

async function render() {
  await renderPage('pages/home.ejs', 'home', {
    bootstrap: {
      listings,
      heroStats: { totalServices: 7, liveRoutes: 18, verifiedPartners: 12, bookableInventory: 68, availableNow: 83, departuresNext24h: 14 },
      blogs: [{ title: 'Booking East Africa with confidence', excerpt: 'A practical guide to verified services and secure tickets.', tag: 'Booking guide', url: '/blogs/booking-guide', image }],
    },
    serviceCatalog: {}, comingSoonServiceTypes: [],
  });

  await renderPage('pages/search.ejs', 'search-results', {
    currentPath: '/search', query: {}, categories, corridorStats, results: listings,
    searchMeta: {
      marketplace: { stats: { liveListings: listings.length, availableNow: 83, partners: 12, departuresNext24h: 14 } },
      typeStats: categories.map((category) => ({ type: category.key, label: category.label, count: listings.filter((item) => item.serviceType === category.key).length, remainingSeats: 12 })),
    },
  });
  await renderPage('pages/search.ejs', 'search-empty', {
    currentPath: '/search', query: { serviceType: 'bus', origin: 'Nowhere' }, categories, corridorStats, results: [],
    searchMeta: { marketplace: { stats: {} }, typeStats: [] },
  });

  const auditBlog = {
    slug: 'booking-east-africa', title: 'Booking East Africa with confidence',
    excerpt: 'A practical guide to verified services, clear pricing and secure travel documents.',
    body: 'Compare the complete journey, confirm the provider, review the final price and keep your protected ticket or voucher available throughout the trip.',
    tag: 'Booking guide', image,
  };
  const auditCompany = {
    id: 'company-audit', slug: 'classic-trip-audit-partner', name: 'Classic Trip Audit Partner',
    description: 'A verified regional partner with public services, clear support details and bookable inventory.',
    companyType: 'travel_partner', city: 'Kampala', country: 'Uganda', verificationStatus: 'verified',
    coverImage: { url: image }, logo: { url: image }, activeListingsCount: listings.length,
    bookableListingsCount: listings.length, sponsoredListingsCount: 1, ratingAverage: 4.7, reviewCount: 28,
    supportContacts: { phone: '+256 700 000 000', email: 'support@example.test', whatsapp: '+256 700 000 000' },
  };
  const publicRoutes = [
    { id: 'route-audit-1', origin: 'Kampala', destination: 'Nairobi', corridor: 'Kampala–Nairobi', boardingPoints: ['Kampala', 'Jinja'], scheduleCount: 3, availableSeats: 39, nextDepartAt: '2026-08-06T08:00:00Z', listing: listings[0], listingUrl: listings[0].url, bookingUrl: listings[0].bookingUrl },
    { id: 'route-audit-2', origin: 'Kampala', destination: 'Juba', corridor: 'Kampala–Juba', boardingPoints: ['Kampala', 'Gulu'], scheduleCount: 2, availableSeats: 24, nextDepartAt: '2026-08-06T11:00:00Z', listing: listings[1], listingUrl: listings[1].url, bookingUrl: listings[1].bookingUrl },
  ];
  const publicCorridors = corridorStats.map((row, index) => ({ ...row, routes: index + 2, minPrice: 75000 + (index * 10000) }));
  const campaigns = [{ name: 'Regional travel week', placement: 'Marketplace', listing: listings[0] }];

  await renderPage('pages/blogs.ejs', 'blogs', { currentPath: '/blogs', blogs: [auditBlog, { ...auditBlog, slug: 'secure-tickets', title: 'How protected tickets work', tag: 'Ticket guide' }] });
  await renderPage('pages/blog-post.ejs', 'blog-post', { currentPath: `/blogs/${auditBlog.slug}`, blog: auditBlog });
  await renderPage('pages/companies.ejs', 'companies', { currentPath: '/companies', companies: [auditCompany], stats: { verified: 1, bookable: listings.length, campaigns: campaigns.length } });
  await renderPage('pages/company-profile.ejs', 'company-profile', { currentPath: `/companies/${auditCompany.slug}`, company: auditCompany, listings: listings.slice(0, 6), routes: publicRoutes, campaigns });
  await renderPage('pages/how-it-works.ejs', 'how-it-works', { currentPath: '/how-it-works' });
  await renderPage('pages/partner-commission.ejs', 'partner-commission', { currentPath: '/partner-commission' });
  await renderPage('pages/promoters.ejs', 'promoters', { currentPath: '/promoters', topListings: listings.slice(0, 6), campaigns, stats: { promotableListings: listings.length, activeCampaigns: campaigns.length } });
  await renderPage('pages/routes.ejs', 'routes', { currentPath: '/routes', query: {}, corridorStats: publicCorridors, routes: publicRoutes });
  await renderPage('pages/services.ejs', 'services', {
    currentPath: '/services', comingSoon: [],
    stats: categories.map((category) => ({ key: category.key, listingsCount: listings.filter((row) => row.serviceType === category.key).length, bookableListingsCount: listings.filter((row) => row.serviceType === category.key && row.bookable).length, sponsoredListingsCount: listings.filter((row) => row.serviceType === category.key && row.isSponsored).length })),
    grouped: categories.map((category) => {
      const rows = listings.filter((row) => row.serviceType === category.key);
      return { key: category.key, label: category.label, icon: category.icon, bookable: true, listings: rows.slice(0, 3), stats: { activeListingsCount: rows.length, bookableListingsCount: rows.filter((row) => row.bookable).length } };
    }),
  });
  await renderPage('pages/support.ejs', 'support-public', { currentPath: '/support', submitted: false });
  await renderPage('pages/terms.ejs', 'terms', { currentPath: '/terms' });
  await renderPage('pages/privacy.ejs', 'privacy', { currentPath: '/privacy' });
  await renderPage('pages/error.ejs', 'error', { currentPath: '/missing', status: 404, message: 'The requested page could not be found.' });
  await renderPage('pages/flights.ejs', 'flights', { currentPath: '/flights', initialQuery: {} });
  await renderPage('pages/taxi.ejs', 'taxi', { currentPath: '/taxi', initialQuery: {}, mapConfig: { center: [0.3476, 32.5825], zoom: 12, tileUrl: '' } });
  await renderPage('pages/taxi-track.ejs', 'taxi-track', { currentPath: '/taxi/track/CT-RIDE-1001', reference: 'CT-RIDE-1001', lookupCode: 'AUDIT-1234', mapConfig: { center: [0.3476, 32.5825], zoom: 12, tileUrl: '' } });

  await renderPage('pages/auth/login.ejs', 'auth', {
    next: '', partnerForm: {}, flashMessages: [],
    countryMarkets: [
      { name: 'Uganda', currency: 'UGX', callingCode: '+256' },
      { name: 'Kenya', currency: 'KES', callingCode: '+254' },
      { name: 'South Sudan', currency: 'SSP', callingCode: '+211' },
    ],
  });
  const auditUser = { id: 'user-audit', fullName: 'Frontend Audit User', email: 'audit@example.test', phone: '+256 700 000 000', role: 'driver', verificationStatus: 'pending', phoneVerifiedAt: null };
  await renderPage('pages/auth/mfa-challenge.ejs', 'auth-mfa-challenge', { currentPath: '/auth/mfa/challenge', identity: 'audit@example.test' });
  await renderPage('pages/auth/mfa-setup.ejs', 'auth-mfa-setup', { currentPath: '/auth/mfa/setup', qrDataUrl: image, setup: { secret: 'AUDITMFASECRET123456' }, recoveryCodes: [] });
  await renderPage('pages/auth/onboarding-status.ejs', 'auth-onboarding', { currentPath: '/onboarding/status', user: auditUser, company: { name: 'Classic Trip Audit Partner' }, membership: { roleTitle: 'Verified driver', status: 'pending' }, review: { status: 'pending', checklist: [{ key: 'identity', label: 'Identity check', status: 'pending', notes: 'Awaiting review' }] } });
  await renderPage('pages/auth/phone-verification.ejs', 'auth-phone-verification', { currentPath: '/account/phone-verification', user: auditUser });
  await renderPage('pages/auth/reset-password.ejs', 'auth-reset-password', { currentPath: '/reset-password', token: 'frontend-audit-token' });
  await renderPage('pages/auth/verify-email.ejs', 'auth-verify-email', { currentPath: '/verify-email', error: null });
  await renderPage('pages/invite-accept.ejs', 'invite-accept', {
    currentPath: '/invite/frontend-audit', inviteToken: 'frontend-audit', formData: {}, formError: '',
    invitation: { type: 'company', fullName: 'Audit Partner Owner', email: 'owner@example.test', phone: '+256 700 000 000', companyName: 'Classic Trip Audit Partner', role: 'company_admin', roleTitle: 'Partner administrator', termsSummary: 'Manage verified company services.', expiresAt: '2026-08-20T10:00:00Z' },
  });

  const bus = listing('bus');
  const busSchedules = [
    { id: 'schedule-standard', listingId: bus.id, vehicleClass: 'standard', departureLabel: '06 Aug 2026, 08:00 · Regional Coach', departAt: '2026-08-06T08:00:00Z', basePrice: 85000, currency: 'UGX', status: 'published' },
    { id: 'schedule-vip', listingId: bus.id, vehicleClass: 'vip', departureLabel: '06 Aug 2026, 09:30 · VIP Coach', departAt: '2026-08-06T09:30:00Z', basePrice: 125000, currency: 'UGX', status: 'published' },
  ];
  const returnSchedules = [
    { id: 'return-standard', listingId: bus.id, vehicleClass: 'standard', departureLabel: '09 Aug 2026, 15:00 · Return Coach', departAt: '2026-08-09T15:00:00Z', originStopId: 'nairobi', destinationStopId: 'kampala' },
    { id: 'return-vip', listingId: bus.id, vehicleClass: 'vip', departureLabel: '09 Aug 2026, 17:00 · Return VIP', departAt: '2026-08-09T17:00:00Z', originStopId: 'nairobi', destinationStopId: 'kampala' },
  ];
  const seats = Array.from({ length: 24 }, (_, index) => ({ seatNumber: String(index + 1), row: Math.floor(index / 4) + 1, column: (index % 4) + 1, status: index === 5 ? 'booked' : index === 7 ? 'held' : 'available', priceDelta: index < 4 ? 10000 : 0 }));
  const busAvailability = {
    scheduleId: 'schedule-standard', schedule: busSchedules[0], schedules: busSchedules, returnSchedules, seats,
    stops: [{ id: 'kampala', name: 'Kampala', stopOrder: 1 }, { id: 'jinja', name: 'Jinja', stopOrder: 2 }, { id: 'nairobi', name: 'Nairobi', stopOrder: 3 }],
    journey: { originStopId: 'kampala', destinationStopId: 'nairobi', originName: 'Kampala', destinationName: 'Nairobi' },
    fare: { baseAmountPerSeat: 85000, currency: 'UGX' }, layoutName: '2x2',
  };
  const busPreview = { currency: 'UGX', previewSeats: seats, firstSeat: '1', selectedPreview: 'Seat No 1', serviceIcon: 'fa-bus', partnerName: bus.partner, supportPhone: '+256 700 000 000', ticketAccess: 'Ticket issued after payment', policy: 'Changes allowed before departure', addons: [] };
  await renderPage('pages/listing-details.ejs', 'listing-bus', { currentPath: bus.url, listing: bus, company: { name: bus.partner, supportContacts: { phone: '+256 700 000 000' } }, availability: busAvailability, preview: busPreview, referralCode: '' });
  await renderPage('pages/booking-form.ejs', 'booking-bus', {
    currentPath: `${bus.url}/book`, listing: bus, availability: busAvailability, returnAvailability: { schedule: returnSchedules[0], seats, fare: { baseAmountPerSeat: 85000 }, journey: { originName: 'Nairobi', destinationName: 'Kampala' } }, preview: busPreview,
    selectedOption: '1,2', selectedSeats: '1,2', passengerCount: 2, selectedScheduleId: 'schedule-standard', bookingDraftId: 'audit-draft', holdId: 'audit-hold',
    selectedOriginStopId: 'kampala', selectedDestinationStopId: 'nairobi', returnScheduleId: 'return-standard', returnHoldId: 'audit-return-hold', returnSeats: '1,2', returnOriginStopId: 'nairobi', returnDestinationStopId: 'kampala', referralCode: '', selectedAddonIds: [],
  });

  const stay = listing('hotel');
  const rooms = [
    { id: 'deluxe', roomType: 'Deluxe Garden Room', nightlyPrice: 185000, inventory: 4, availableUnits: 4, capacity: 2, bedType: 'Queen bed', amenities: ['Breakfast', 'Garden view'] },
    { id: 'family', roomType: 'Family Suite', nightlyPrice: 320000, inventory: 2, availableUnits: 2, capacity: 5, bedType: 'Two beds', amenities: ['Kitchen', 'Lake view'] },
    { id: 'rooftop', roomType: 'Rooftop Studio', nightlyPrice: 210000, inventory: 0, availableUnits: 0, capacity: 2, bedType: 'King bed', amenities: ['Balcony'] },
  ];
  const stayPreview = { currency: 'UGX', previewRooms: rooms, firstRoom: 'deluxe', selectedPreview: 'Deluxe Garden Room', partnerName: stay.partner, supportPhone: '+256 700 000 000', addons: [] };
  await renderPage('pages/listing-details.ejs', 'listing-stay', { currentPath: stay.url, listing: stay, company: { name: stay.partner, supportContacts: { phone: '+256 700 000 000' } }, availability: { rooms }, preview: stayPreview, referralCode: '' });
  await renderPage('pages/booking-form.ejs', 'booking-stay', { currentPath: `${stay.url}/book`, listing: stay, availability: { rooms }, preview: stayPreview, selectedOption: 'deluxe', selectedCheckIn: '2026-08-06', selectedCheckOut: '2026-08-09', selectedRoomCount: 1, selectedAdults: 2, selectedChildren: 0, selectedAddonIds: [], referralCode: '' });

  for (const serviceType of ['tour', 'car_rental', 'cargo']) {
    const serviceListing = listing(serviceType);
    const genericPreview = { currency: 'UGX', selectedPreview: serviceListing.id, partnerName: serviceListing.partner, supportPhone: '+256 700 000 000', addons: [], paymentMethods: ['Mobile money', 'Card'] };
    await renderPage('pages/listing-details.ejs', `listing-${serviceType}`, { currentPath: serviceListing.url, listing: serviceListing, company: { name: serviceListing.partner, supportContacts: { phone: '+256 700 000 000' } }, availability: {}, preview: genericPreview, referralCode: '' });
    await renderPage('pages/booking-form.ejs', `booking-${serviceType}`, { currentPath: `${serviceListing.url}/book`, listing: serviceListing, availability: {}, preview: genericPreview, selectedOption: serviceListing.id, selectedAddonIds: [], referralCode: '' });
  }

  const booking = {
    bookingRef: 'CT-AUDIT-1001', serviceType: 'bus', bookingStatus: 'confirmed', paymentStatus: 'successful', tripType: 'round_trip',
    guestSnapshot: { fullName: 'Frontend Audit Guest', email: 'guest@example.test', phone: '+256 700 000 000' },
    passengers: [{ fullName: 'Frontend Audit Guest', email: 'guest@example.test', phone: '+256 700 000 000', seatOrRoom: '1' }],
    pricing: { total: 340000, currency: 'UGX' }, bookingLegs: [{ origin: 'Kampala', destination: 'Nairobi' }, { origin: 'Nairobi', destination: 'Kampala' }],
    publicTicketPdfUrl: '/tickets/CT-AUDIT-1001.pdf', createdAt: '2026-08-05T10:00:00Z',
  };
  await renderPage('pages/ticket.ejs', 'ticket', { currentPath: '/tickets/CT-AUDIT-1001', booking, listing: bus, qrDataUrl: '', ticketReady: true, ticketLegs: [] });
  await renderPage('pages/booking-success.ejs', 'booking-success', { currentPath: '/booking/success/CT-AUDIT-1001', booking: { ...booking, qrCodeValue: 'CT-AUDIT-1001', publicTicketUrl: '/tickets/CT-AUDIT-1001' }, listing: bus, qrDataUrl: '' });
  await renderPage('pages/ticket-lookup.ejs', 'ticket-lookup', { currentPath: '/tickets', query: {}, booking: null, listing: null, qrDataUrl: '', lookupAttempted: false, ticketReady: false });
  await renderPage('pages/my-bookings.ejs', 'my-bookings', {
    currentPath: '/booking', currentUser: { id: 'customer-audit', fullName: 'Frontend Audit Guest' },
    bookings: [{ code: booking.bookingRef, status: 'Confirmed', title: bus.title, type: 'Bus', serviceType: 'bus', selected: 'Seat No 1 · Return ticket', total: money(booking.pricing.total, booking.pricing.currency), date: '06 Aug 2026', customer: 'Frontend Audit Guest', customerLabel: 'Passenger', channel: 'Web', ticketUrl: '/tickets/CT-AUDIT-1001', lookupUrl: '/tickets?bookingRef=CT-AUDIT-1001' }],
  });
  await renderPage('pages/saved.ejs', 'saved', { currentPath: '/saved', currentUser: { id: 'customer-audit', fullName: 'Frontend Audit Guest' }, savedListings: listings.slice(0, 5).map((row) => ({ ...row, type: row.serviceType === 'hotel' ? 'Stay' : row.serviceType === 'bus' ? 'Bus' : row.serviceType, typeLabel: row.serviceType === 'hotel' ? 'Stay' : row.serviceType.replace('_', ' '), price: row.priceFrom, rating: row.ratingAverage, nextDepartLabel: row.serviceType === 'bus' ? '06 Aug 2026, 08:00' : 'Flexible dates' })) });

  const roleFixtures = [
    ['admin', ''], ['customer', ''], ['promoter', ''], ['support', ''], ['finance', ''], ['operations', ''], ['content', ''],
    ['employee', 'bus'], ['driver', 'bus'], ['company', 'bus'], ['company', 'hotel'], ['company', 'flight'], ['company', 'local_transport'], ['company', 'tour'], ['company', 'car_rental'], ['company', 'cargo'],
  ];
  for (const [role, serviceType] of roleFixtures) {
    const html = await renderRole(role, serviceType ? { serviceType } : {});
    fs.writeFileSync(path.join(output, `dashboard-${role}${serviceType ? `-${serviceType}` : ''}.html`), html);
  }

  const hotelAuditOptions = {
    hotelListings: [{ id: 'hotel-listing-1', title: 'Lake Victoria Garden Villa' }],
    hotelProperties: [{ id: 'property-1', title: 'Lake Victoria Garden Villa' }],
    roomTypes: [{ id: 'room-type-deluxe', title: 'Deluxe Garden Room' }, { id: 'room-type-family', title: 'Family Suite' }],
    ratePlans: [{ id: 'rate-flex', title: 'Flexible breakfast rate' }],
    roomUnits: [{ id: 'room-101', title: 'Room 101' }, { id: 'room-102', title: 'Room 102' }, { id: 'room-201', title: 'Room 201' }],
    roomNights: [{ id: 'night-1', title: '06 Aug 2026' }],
  };
  const hotelRoomsHtml = await renderRole('company', {
    serviceType: 'hotel',
    activePage: 'hotel-rooms',
    options: hotelAuditOptions,
    dataOverrides: {
      hotelProperties: [
        ['Lake Victoria Garden Villa', 'Entire villa', 'Garden Villa stay', 'Munyonyo, Kampala', '14:00 / 11:00', 'Pool, Wi-Fi, parking', 'active', { entity: 'hotel_property', id: 'property-1' }],
      ],
      roomTypes: [
        ['Deluxe Garden Room', 'Lake Victoria Garden Villa', '2 guests', 'Queen bed', 'UGX 185,000', '2', 'active', { entity: 'room_type', id: 'room-type-deluxe' }],
        ['Family Suite', 'Lake Victoria Garden Villa', '5 guests', 'Two beds', 'UGX 320,000', '1', 'active', { entity: 'room_type', id: 'room-type-family' }],
      ],
      ratePlans: [
        ['Flexible breakfast rate', 'Deluxe Garden Room', 'Lake Victoria Garden Villa', 'Breakfast included', 'Free until 24h', 'UGX 185,000', '1–14 nights', 'active', { entity: 'rate_plan', id: 'rate-flex' }],
      ],
      roomUnits: [
        ['Room 101', 'Deluxe Garden Room', 'Lake Victoria Garden Villa', 'Floor 1 · Garden wing', 'Garden', 'clean', 'available', { entity: 'room_unit', id: 'room-101' }],
        ['Room 102', 'Deluxe Garden Room', 'Lake Victoria Garden Villa', 'Floor 1 · Garden wing', 'Garden', 'cleaning', 'cleaning', { entity: 'room_unit', id: 'room-102' }],
        ['Room 201', 'Family Suite', 'Lake Victoria Garden Villa', 'Floor 2 · Lake wing', 'Lake', 'clean', 'occupied', { entity: 'room_unit', id: 'room-201' }],
      ],
      roomNightInventory: [
        ['2026-08-06', 'Room 101', 'Deluxe Garden Room', 'Flexible breakfast rate', 'available', '—', '—', 'UGX 185,000', { entity: 'room_night', id: 'night-1' }],
        ['2026-08-06', 'Room 201', 'Family Suite', 'Flexible breakfast rate', 'booked', 'CT-STAY-1001', 'Amina N.', 'UGX 320,000', { entity: 'room_night', id: 'night-2' }],
      ],
      hotelArrivals: [['CT-STAY-1002']],
      hotelInHouse: [['CT-STAY-1001']],
      hotelDepartures: [['CT-STAY-0998']],
      hotelHousekeepingTasks: [
        ['Room 102', 'Deluxe Garden Room', 'Lake Victoria Garden Villa', 'Turnover clean', 'normal', 'Housekeeping team', '12:30', 'in_progress', { entity: 'housekeeping_task', id: 'task-1' }],
      ],
      roomVisualMaps: [{
        propertyName: 'Lake Victoria Garden Villa', roomTypeName: 'Stay room map', listingTitle: 'Garden Villa stay', status: 'active',
        rooms: [
          { roomUnitId: 'room-101', unitNumber: '101', floor: '1', wing: 'Garden wing', status: 'available', housekeepingStatus: 'clean' },
          { roomUnitId: 'room-102', unitNumber: '102', floor: '1', wing: 'Garden wing', status: 'cleaning', housekeepingStatus: 'cleaning' },
          { roomUnitId: 'room-201', unitNumber: '201', floor: '2', wing: 'Lake wing', status: 'occupied', housekeepingStatus: 'clean', guestName: 'Amina N.', bookingRef: 'CT-STAY-1001' },
        ],
      }],
    },
  });
  fs.writeFileSync(path.join(output, 'dashboard-company-hotel-rooms.html'), hotelRoomsHtml);

  process.stdout.write(`${output}\n`);
}

render().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
