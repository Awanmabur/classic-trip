const toSlug = require('../utils/slugify');
const companies = require('./seedCompanies');
const categories = require('./categories');

const findCompany = (slug) => companies.find((c) => c.slug === slug) || companies[0];
const categoryMap = Object.fromEntries(categories.map((c) => [c.key, c]));

const images = {
  bus: [
    'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&w=1200&q=70',
    'https://images.unsplash.com/photo-1494515843206-f3117d3f51b7?auto=format&fit=crop&w=1200&q=70',
    'https://images.unsplash.com/photo-1505852679233-d9fd70aff56d?auto=format&fit=crop&w=1200&q=70',
  ],
  hotel: [
    'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=70',
    'https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=1200&q=70',
    'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?auto=format&fit=crop&w=1200&q=70',
    'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?auto=format&fit=crop&w=1200&q=70',
  ],
  flight: [
    'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=1200&q=70',
    'https://images.unsplash.com/photo-1483450388369-9ed95738483c?auto=format&fit=crop&w=1200&q=70',
    'https://images.unsplash.com/photo-1540962351504-03099e0a754b?auto=format&fit=crop&w=1200&q=70',
  ],
  train: [
    'https://images.unsplash.com/photo-1474487548417-781cb71495f3?auto=format&fit=crop&w=1200&q=70',
    'https://images.unsplash.com/photo-1532105956626-9569c03602f6?auto=format&fit=crop&w=1200&q=70',
    'https://images.unsplash.com/photo-1495314736024-fa5e4b37b979?auto=format&fit=crop&w=1200&q=70',
  ],
  ferry: ['https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=70'],
  tour: [
    'https://images.unsplash.com/photo-1516426122078-c23e76319801?auto=format&fit=crop&w=1200&q=70',
    'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=1200&q=70',
    'https://images.unsplash.com/photo-1523805009345-7448845a9e53?auto=format&fit=crop&w=1200&q=70',
  ],
  car_rental: ['https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&w=1200&q=70'],
  event: ['https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?auto=format&fit=crop&w=1200&q=70'],
  cargo: ['https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=1200&q=70'],
};

const busRoutes = [
  ['classic-express', 'Kampala', 'Juba', 'Executive Coach', 'ug-ss', 95000, '07:30', '9h 20m', 'bus-2-2'],
  ['lakeline-vip', 'Kampala', 'Nairobi', 'VIP Shuttle', 'ug-ke', 130000, '20:00', '12h', 'bus-2-1'],
  ['northern-star', 'Gulu', 'Kampala', 'Night Coach', 'ug-local', 55000, '21:30', '6h 45m', 'bus-sleeper'],
  ['great-lakes-transit', 'Kampala', 'Kigali', 'Premium Coach', 'ug-rw', 145000, '19:00', '9h 10m', 'bus-2-1'],
  ['coastline-transit', 'Kampala', 'Dar es Salaam', 'Coast Coach', 'ug-tz', 210000, '16:00', '22h', 'bus-sleeper'],
  ['great-lakes-transit', 'Kampala', 'Bujumbura', 'Comfort Coach', 'ug-bi', 165000, '18:30', '13h', 'bus-2-2'],
  ['classic-express', 'Kampala', 'Mbarara', 'Western Express', 'ug-local', 42000, '08:00', '4h 20m', 'bus-2-2'],
  ['northern-star', 'Kampala', 'Arua', 'West Nile Coach', 'ug-local', 68000, '06:40', '8h 10m', 'bus-2-2'],
  ['lakeline-vip', 'Nairobi', 'Arusha', 'Safari Coach', 'ke-tz', 115000, '06:30', '5h 40m', 'bus-2-2'],
  ['coastline-transit', 'Dar es Salaam', 'Dodoma', 'Capital Route', 'tz-local', 76000, '09:15', '7h', 'bus-2-2'],
  ['great-lakes-transit', 'Kigali', 'Goma', 'Lake Connector', 'rw-drc', 84000, '10:30', '4h 30m', 'bus-2-2'],
  ['classic-express', 'Kampala', 'Jinja', 'City Hop', 'ug-local', 18000, '10:00', '2h 10m', 'bus-2-2'],
  ['lakeline-vip', 'Nairobi', 'Mombasa', 'Coastline Express', 'ke-local', 85000, '08:00', '8h 30m', 'bus-2-1'],
  ['northern-star', 'Kampala', 'Lira', 'Northern Connect', 'ug-local', 52000, '14:00', '5h 50m', 'bus-2-2'],
  ['classic-express', 'Entebbe', 'Kampala', 'Airport Link Bus', 'ug-local', 20000, 'Every hour', '1h 15m', 'bus-2-2'],
  ['great-lakes-transit', 'Kigali', 'Bujumbura', 'Lake Route', 'rw-bi', 92000, '05:50', '6h 20m', 'bus-2-2'],
  ['coastline-transit', 'Arusha', 'Dar es Salaam', 'Tanzania Coach', 'tz-local', 125000, '07:45', '10h 20m', 'bus-sleeper'],
  ['classic-express', 'Kampala', 'Fort Portal', 'Tooro Link', 'ug-local', 48000, '06:00', '5h 30m', 'bus-2-2'],
  ['lakeline-vip', 'Kisumu', 'Kampala', 'Lake Victoria Link', 'ke-ug', 93000, '11:30', '7h 15m', 'bus-2-1'],
  ['northern-star', 'Kampala', 'Kitgum', 'Northern Heritage', 'ug-local', 78000, '19:45', '8h 40m', 'bus-sleeper'],
];

const hotels = [
  ['speke-road-stays', 'Kampala', 'Speke Road Business Hotel', 'Business rooms + apartments', 185000, 'hotel-rooms'],
  ['riverside-villas', 'Jinja', 'Jinja Riverside Villas', 'Villa rooms + river view', 260000, 'hotel-house'],
  ['airport-suites', 'Entebbe', 'Entebbe Airport Suites', 'Airport shuttle + early breakfast', 220000, 'hotel-rooms'],
  ['hill-view-rwanda', 'Kigali', 'Kigali Hill View Suites', 'City suites + breakfast option', 280000, 'hotel-rooms'],
  ['speke-road-stays', 'Mbarara', 'Mbarara City Rest House', 'Secure parking + family rooms', 145000, 'hotel-rooms'],
  ['riverside-villas', 'Jinja', 'Jinja River Cottage', 'Private cottage + river view', 230000, 'hotel-house'],
  ['airport-suites', 'Entebbe', 'Lake Victoria Transit Hotel', 'Transit rooms + pickup', 190000, 'hotel-rooms'],
  ['hill-view-rwanda', 'Kigali', 'Nyamirambo Guest Apartments', 'Apartments + self catering', 175000, 'hotel-house'],
  ['speke-road-stays', 'Fort Portal', 'Tooro View Lodge', 'Mountain view + lodge rooms', 210000, 'hotel-rooms'],
  ['riverside-villas', 'Murchison', 'Murchison Safari Camp', 'Camp rooms + tour add-ons', 320000, 'hotel-house'],
  ['airport-suites', 'Kampala', 'Kololo Executive Suites', 'Executive apartments', 360000, 'hotel-rooms'],
  ['hill-view-rwanda', 'Gisenyi', 'Gisenyi Lake Residence', 'Lake stay + family rooms', 240000, 'hotel-house'],
  ['speke-road-stays', 'Mbale', 'Mbale Business Inn', 'Budget business rooms', 120000, 'hotel-rooms'],
  ['riverside-villas', 'Kabale', 'Lake Bunyonyi Cottages', 'Lake cottages + boat trips', 255000, 'hotel-house'],
  ['airport-suites', 'Juba', 'Juba Central Guest House', 'Secure city rooms', 125000, 'hotel-rooms'],
  ['hill-view-rwanda', 'Nairobi', 'Westlands Transit Suites', 'Apartment rooms + workspace', 310000, 'hotel-rooms'],
];

const flights = [
  ['sky-east-airways', 'Entebbe', 'Nairobi', 'Morning Flight', 'ug-ke', 620000, '08:15', '1h 15m'],
  ['regional-air', 'Entebbe', 'Kigali', 'Express Flight', 'ug-rw', 510000, '11:45', '55m'],
  ['regional-air', 'Nairobi', 'Dar es Salaam', 'Coastal Flight', 'ke-tz', 520000, '11:20', '1h 30m'],
  ['sky-east-airways', 'Entebbe', 'Juba', 'Regional Hop', 'ug-ss', 590000, '06:25', '1h 25m'],
  ['island-air', 'Entebbe', 'Zanzibar', 'Holiday Route', 'ug-tz', 750000, '09:50', '2h 35m'],
  ['regional-air', 'Kigali', 'Bujumbura', 'Lake Flight', 'rw-bi', 430000, '13:00', '45m'],
  ['sky-east-airways', 'Nairobi', 'Mombasa', 'Coast Flight', 'ke-local', 300000, '17:10', '1h'],
  ['island-air', 'Dar es Salaam', 'Zanzibar', 'Island Shuttle', 'tz-local', 180000, '12:30', '25m'],
];

const laterServices = [
  ['train', 'ug-rail-partner', 'Kampala', 'Jinja', 'Standard Train', 'ug-local', 18000, '06:20', '2h 35m', 'train'],
  ['train', 'ug-rail-partner', 'Nairobi', 'Mombasa', 'Intercity Train', 'ke-local', 85000, '08:00', '5h 20m', 'train'],
  ['train', 'ug-rail-partner', 'Dar es Salaam', 'Morogoro', 'Quick Rail', 'tz-local', 65000, '07:15', '2h 10m', 'train'],
  ['train', 'ug-rail-partner', 'Addis Ababa', 'Djibouti', 'Horn Rail', 'et-dj', 180000, '06:20', '12h', 'train'],
  ['ferry', 'lake-ferry-co', 'Entebbe', 'Ssese', 'Island Ferry', 'ug-local', 45000, '09:00', '3h', 'slots'],
  ['ferry', 'lake-ferry-co', 'Zanzibar', 'Dar es Salaam', 'Fast Ferry', 'tz-local', 95000, '10:00', '2h', 'slots'],
  ['tour', 'safarihub', 'Kampala', 'Murchison', 'Weekend Tour', 'ug-local', 390000, 'Friday 06:00', '2 days', 'slots'],
  ['tour', 'safarihub', 'Nairobi', 'Serengeti', 'Safari Package', 'ke-tz', 820000, 'Friday 05:30', '3 days', 'slots'],
  ['tour', 'safarihub', 'Kampala', 'Kigali', 'Culture Tour', 'ug-rw', 510000, 'Thursday 07:00', '2 days', 'slots'],
  ['car_rental', 'drive-east', 'Kampala', 'Uganda', 'Self-drive SUV Rental', 'ug-local', 280000, 'Anytime', '1 day', 'slots'],
  ['car_rental', 'drive-east', 'Kigali', 'Rwanda', 'Kigali City Car Rental', 'rw-local', 240000, 'Anytime', '1 day', 'slots'],
  ['event', 'event-east', 'Kampala', 'Kampala', 'VIP Event Ticket Package', 'ug-local', 75000, 'Saturday 18:00', '1 night', 'slots'],
  ['cargo', 'cargo-link', 'Nairobi', 'Kampala', 'Cargo Slot Reservation', 'ke-ug', 150000, 'Partner set', 'Custom', 'slots'],
  ['cargo', 'cargo-link', 'Kampala', 'Juba', 'Parcel Coach Cargo', 'ug-ss', 90000, 'Daily', '9h', 'slots'],
];

const extraBusRoutes = [
  ['pearl-bus-lines', 'Mbarara', 'Kabale', 'Highland Coach', 'ug-local', 38000, '07:20', '3h 10m', 'bus-2-2'],
  ['pearl-bus-lines', 'Kampala', 'Kabale', 'Gorilla Highlands', 'ug-local', 72000, '06:30', '7h 20m', 'bus-2-1'],
  ['pearl-bus-lines', 'Mbarara', 'Fort Portal', 'Western Loop', 'ug-local', 64000, '09:15', '5h 30m', 'bus-2-2'],
  ['simba-coach', 'Nairobi', 'Kisumu', 'Lake Basin Express', 'ke-local', 68000, '10:40', '6h 10m', 'bus-2-2'],
  ['simba-coach', 'Mombasa', 'Nairobi', 'Night Coastline', 'ke-local', 88000, '21:00', '8h 15m', 'bus-sleeper'],
  ['simba-coach', 'Nairobi', 'Kampala', 'Regional Connect', 'ke-ug', 125000, '18:45', '12h 20m', 'bus-2-1'],
  ['classic-express', 'Kampala', 'Mbale', 'Eastern Express', 'ug-local', 43000, '13:30', '4h 40m', 'bus-2-2'],
  ['great-lakes-transit', 'Goma', 'Kigali', 'Return Connector', 'drc-rw', 84000, '12:15', '4h 35m', 'bus-2-2'],
  ['coastline-transit', 'Dar es Salaam', 'Arusha', 'Northern Safari Coach', 'tz-local', 118000, '06:45', '10h', 'bus-sleeper'],
  ['northern-star', 'Juba', 'Kampala', 'South Sudan Link', 'ss-ug', 112000, '17:30', '10h 30m', 'bus-2-2'],
];

const extraHotels = [
  ['nile-grand-hotel', 'Jinja', 'Nile Grand Riverside Hotel', 'Executive river rooms', 240000, 'hotel-rooms'],
  ['nile-grand-hotel', 'Jinja', 'Nile Grand Family Cottages', 'Family cottages with breakfast', 310000, 'hotel-house'],
  ['serengeti-stays', 'Arusha', 'Arusha Safari Lodge', 'Safari lodge rooms', 300000, 'hotel-rooms'],
  ['serengeti-stays', 'Moshi', 'Kilimanjaro View Apartments', 'Apartments and long-stay rooms', 270000, 'hotel-house'],
  ['airport-suites', 'Entebbe', 'Entebbe Crew Rest Suites', 'Late arrival and crew rooms', 205000, 'hotel-rooms'],
  ['hill-view-rwanda', 'Kigali', 'Kigali Conference Residence', 'Conference-linked apartments', 330000, 'hotel-house'],
  ['speke-road-stays', 'Kampala', 'Nakasero Work Suites', 'Workspace rooms and apartments', 295000, 'hotel-rooms'],
  ['riverside-villas', 'Jinja', 'Source of the Nile Retreat', 'Retreat rooms and villa units', 275000, 'hotel-house'],
];

const extraFlights = [
  ['horn-air-connect', 'Addis Ababa', 'Djibouti', 'Horn Connector', 'et-dj', 610000, '07:20', '1h 20m'],
  ['horn-air-connect', 'Addis Ababa', 'Mogadishu', 'Somalia Link', 'et-so', 720000, '10:35', '2h'],
  ['horn-air-connect', 'Addis Ababa', 'Asmara', 'Northern Hop', 'et-er', 580000, '15:15', '1h 10m'],
  ['island-air', 'Zanzibar', 'Nairobi', 'Island Return', 'tz-ke', 640000, '14:30', '1h 40m'],
];

const extraLaterServices = [
  ['train', 'east-rail-link', 'Nairobi', 'Kisumu', 'Lake Rail', 'ke-local', 52000, '06:00', '6h', 'train'],
  ['train', 'east-rail-link', 'Mombasa', 'Nairobi', 'Coast Rail', 'ke-local', 78000, '15:00', '5h 40m', 'train'],
  ['ferry', 'blue-lake-ferries', 'Entebbe', 'Kalangala', 'Island Morning Ferry', 'ug-local', 50000, '08:00', '3h 30m', 'slots'],
  ['ferry', 'blue-lake-ferries', 'Mwanza', 'Bukoba', 'Lake Victoria Ferry', 'tz-local', 105000, '19:00', '8h', 'slots'],
  ['airport_transfer', 'airport-connect', 'Entebbe', 'Kampala', 'Airport Shuttle Seat', 'ug-local', 45000, 'Every 30 min', '1h 20m', 'slots'],
  ['airport_transfer', 'airport-connect', 'Entebbe', 'Jinja', 'Private Transfer', 'ug-local', 260000, 'On request', '2h 30m', 'slots'],
  ['visa', 'border-pass-assist', 'Kampala', 'Nairobi', 'Border Document Support', 'ug-ke', 65000, 'Office hours', '1 day', 'slots'],
  ['visa', 'border-pass-assist', 'Kampala', 'Kigali', 'Visa and Border Guide', 'ug-rw', 70000, 'Office hours', '1 day', 'slots'],
  ['insurance', 'safe-journey-cover', 'Kampala', 'Nairobi', 'Bus Trip Cover', 'ug-ke', 18000, 'Instant quote', 'Trip period', 'slots'],
  ['insurance', 'safe-journey-cover', 'Entebbe', 'Kigali', 'Flight Travel Cover', 'ug-rw', 35000, 'Instant quote', 'Trip period', 'slots'],
  ['package', 'safarihub', 'Kampala', 'Murchison', 'Bus Plus Safari Stay', 'ug-local', 620000, 'Friday 06:00', '3 days', 'slots'],
  ['package', 'serengeti-stays', 'Arusha', 'Serengeti', 'Safari Lodge Package', 'tz-local', 980000, 'Friday 07:00', '3 days', 'slots'],
  ['event', 'conference-east', 'Kigali', 'Kigali', 'Conference Pass and Stay', 'rw-local', 280000, 'Event date', '2 days', 'slots'],
  ['cargo', 'regional-parcel', 'Juba', 'Kampala', 'Cross-Border Parcel Slot', 'ss-ug', 130000, 'Daily', '10h', 'slots'],
  ['cargo', 'regional-parcel', 'Juba', 'Gulu', 'Northern Parcel Coach', 'ss-ug', 85000, 'Daily', '7h', 'slots'],
];

function takenFor(layout, index) {
  if (layout === 'hotel-rooms' || layout === 'hotel-house') return ['101', '203', 'Villa 2', 'R4'].slice(0, 2 + (index % 3));
  if (layout === 'flight') return ['1A', '2C', '4F', '6D'].slice(0, 2 + (index % 2));
  if (layout === 'train') return ['A1', 'B3', 'D4'].slice(0, 2 + (index % 2));
  if (layout === 'slots') return ['S2', 'S5', 'S8'].slice(0, 2 + (index % 2));
  return ['A1', 'B2', 'C3', 'D4', 'F2'].slice(0, 3 + (index % 2));
}

function groupFor(serviceType) {
  if (serviceType === 'bus') return 'bus';
  if (serviceType === 'hotel') return 'hotel';
  if (serviceType === 'flight') return 'flight';
  if (serviceType === 'train') return 'train';
  return 'more';
}

function labelFor(serviceType) {
  return categoryMap[serviceType]?.label || serviceType;
}

function buildListing(serviceType, companySlug, from, to, suffix, corridor, price, time, duration, layout, index) {
  const company = findCompany(companySlug);
  const title = serviceType === 'hotel' ? suffix : `${from} to ${to} ${suffix}`;
  const slug = toSlug(`${title}-${company.slug}`);
  const imageList = images[serviceType] || images.tour;
  const isBookable = serviceType === 'bus' || serviceType === 'hotel';
  const rating = (4.1 + ((index + company.name.length) % 9) / 10).toFixed(1);
  return {
    id: `${serviceType}-${String(index + 1).padStart(3, '0')}`,
    companyId: company.id,
    companySlug: company.slug,
    companyName: company.name,
    partner: company.name,
    serviceType,
    group: groupFor(serviceType),
    type: labelFor(serviceType),
    title,
    slug,
    sub: serviceType === 'hotel' ? `${to} - ${suffix}` : `${company.name} - ${suffix}`,
    country: company.country,
    city: serviceType === 'hotel' ? to : from,
    address: `${serviceType === 'hotel' ? to : from} central terminal`,
    from,
    to,
    corridor,
    route: `${from} to ${to}`,
    time,
    duration,
    priceFrom: price,
    price,
    currency: 'UGX',
    media: [{ url: imageList[index % imageList.length], publicId: `classic-trip/listings/${serviceType}/${slug}`, alt: title }],
    img: imageList[index % imageList.length],
    ratingAverage: Number(rating),
    rating,
    reviewCount: 30 + index * 7,
    isSponsored: index % 5 === 0,
    isFeatured: index % 4 === 0,
    isVerified: company.verificationStatus === 'verified',
    status: company.verificationStatus === 'verified' ? 'active' : 'draft',
    bookable: isBookable,
    releaseStatus: isBookable ? 'live' : serviceType === 'flight' ? 'teaser' : 'planned',
    policy: isBookable ? 'Instant - refundable rules apply' : 'Availability preview - booking not open yet',
    layout,
    taken: takenFor(layout, index),
    availability: serviceType === 'hotel' ? 12 - (index % 5) : 48 - (index % 17),
    instantConfirmation: isBookable,
    cancellationRules: isBookable ? 'Free cancellation before operator cutoff. Refund rules vary by partner.' : 'Read-only teaser until provider integration.',
    baggageRules: serviceType === 'bus' ? 'One main bag + one cabin bag included.' : '',
    createdAt: new Date(Date.UTC(2026, 4, 1 + (index % 20))).toISOString(),
  };
}

let index = 0;
const listings = [];
for (const r of busRoutes) listings.push(buildListing('bus', ...r, index++));
for (const h of hotels) listings.push(buildListing('hotel', h[0], h[1], h[1], h[2], `${h[1].toLowerCase().replace(/\s+/g, '-')}-local`, h[4], 'Check-in 14:00', '1 night', h[5], index++));
for (const f of flights) listings.push(buildListing('flight', ...f, 'flight', index++));
for (const s of laterServices) listings.push(buildListing(...s, index++));
for (const r of extraBusRoutes) listings.push(buildListing('bus', ...r, index++));
for (const h of extraHotels) listings.push(buildListing('hotel', h[0], h[1], h[1], h[2], `${h[1].toLowerCase().replace(/\s+/g, '-')}-local`, h[4], 'Check-in 14:00', '1 night', h[5], index++));
for (const f of extraFlights) listings.push(buildListing('flight', ...f, 'flight', index++));
for (const s of extraLaterServices) listings.push(buildListing(...s, index++));

module.exports = listings;
