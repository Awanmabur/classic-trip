const companies = require('./seedCompanies');
const listings = require('./seedListings');
const blogs = require('./seedBlogs');
const categories = require('./categories');
const users = require('./admin');
const calculateCommission = require('../utils/calculateCommission');

function buildRoutes(seedListings = listings) {
  return seedListings
    .filter((listing) => listing.serviceType === 'bus')
    .map((listing, index) => ({
      id: `route-${String(index + 1).padStart(3, '0')}`,
      listingId: listing.id,
      companyId: listing.companyId,
      origin: listing.from,
      destination: listing.to,
      corridor: listing.corridor,
      boardingPoints: [`${listing.from} Central`, `${listing.from} Office`, `${listing.from} Terminal`],
      dropoffPoints: [`${listing.to} Central`, `${listing.to} Office`, `${listing.to} Terminal`],
      baggageRules: listing.baggageRules,
      cancellationRules: listing.cancellationRules,
      status: 'active',
    }));
}

function buildVehicleSeats(totalSeats) {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return Array.from({ length: totalSeats }).map((_, index) => {
    const row = Math.floor(index / 4);
    const seatNumber = `${letters[row] || `R${row + 1}`}${(index % 4) + 1}`;
    return {
      id: seatNumber,
      seatNumber,
      row: row + 1,
      col: (index % 4) + 1,
      label: seatNumber,
      isAisle: false,
      isDisabled: false,
    };
  });
}

function buildVehicles(routes, seedListings = listings) {
  return routes.map((route, index) => {
    const listing = seedListings.find((item) => item.id === route.listingId) || {};
    const layoutName = listing.layout === 'bus-2-1' ? '2x1' : listing.layout === 'bus-sleeper' ? 'sleeper' : '2x2';
    const totalSeats = layoutName === '2x1' ? 36 : layoutName === 'sleeper' ? 32 : 48;
    return {
      id: `vehicle-${String(index + 1).padStart(3, '0')}`,
      companyId: route.companyId,
      listingId: route.listingId,
      serviceType: listing.serviceType || 'bus',
      name: `${listing.companyName || listing.partner || 'Partner'} ${listing.type || 'Coach'} ${index + 1}`,
      plateOrCode: `CT-${String(index + 1).padStart(3, '0')}`,
      layoutName,
      rows: Math.ceil(totalSeats / 4),
      cols: 4,
      totalSeats,
      seats: buildVehicleSeats(totalSeats),
      amenities: ['Reclining seats', 'USB charging', 'Ticket scanner'],
      media: listing.media || [],
      status: 'active',
    };
  });
}

function buildSchedules(routes, seedListings = listings, vehicles = []) {
  const dates = [1, 2, 3, 4, 5, 7, 10];
  const schedules = [];
  for (const route of routes) {
    const listing = seedListings.find((item) => item.id === route.listingId);
    const vehicle = vehicles.find((item) => item.listingId === route.listingId && item.companyId === route.companyId);
    dates.slice(0, 3 + (schedules.length % 3)).forEach((offset, i) => {
      const departAt = new Date(Date.UTC(2026, 4, 24 + offset, 5 + i * 4, 30));
      const totalSeats = Number(vehicle?.totalSeats || 48);
      schedules.push({
        id: `schedule-${String(schedules.length + 1).padStart(4, '0')}`,
        routeId: route.id,
        listingId: route.listingId,
        companyId: route.companyId,
        vehicleId: vehicle?.id || '',
        vehicleName: vehicle?.name || '',
        departAt: departAt.toISOString(),
        arriveAt: new Date(departAt.getTime() + 1000 * 60 * 60 * (4 + (i % 8))).toISOString(),
        basePrice: listing.priceFrom + i * 5000,
        currency: 'UGX',
        totalSeats,
        availableSeats: Math.max(9, totalSeats - (i * 6 + schedules.length) % 30),
        status: 'active',
      });
    });
  }
  return schedules;
}

function buildSeats(schedules) {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const seats = [];
  for (const schedule of schedules) {
    for (let localIndex = 0; localIndex < Number(schedule.totalSeats || 0); localIndex += 1) {
      const rowIndex = Math.floor(localIndex / 4);
      const row = letters[rowIndex] || `R${rowIndex + 1}`;
      const index = seats.length;
      seats.push({
        id: `seat-${String(index + 1).padStart(5, '0')}`,
        scheduleId: schedule.id,
        seatNumber: `${row}${(localIndex % 4) + 1}`,
        seatClass: rowIndex < 2 ? 'VIP' : 'Standard',
        priceDelta: rowIndex < 2 ? 15000 : 0,
        status: index % 17 === 0 ? 'taken' : 'available',
        lockedUntil: null,
      });
    }
  }
  return seats;
}

function buildRooms(seedListings = listings) {
  const roomTypes = ['Standard Queen', 'Twin Room', 'Executive Suite', 'Family Apartment', 'Villa Room'];
  const rooms = [];
  seedListings.filter((listing) => listing.serviceType === 'hotel').forEach((listing) => {
    roomTypes.forEach((roomType, index) => {
      rooms.push({
        id: `room-${String(rooms.length + 1).padStart(4, '0')}`,
        listingId: listing.id,
        companyId: listing.companyId,
        roomType,
        capacity: index < 2 ? 2 : index === 2 ? 3 : 4,
        nightlyPrice: listing.priceFrom + index * 35000,
        inventory: Math.max(1, 8 - index - (rooms.length % 3)),
        amenities: ['WiFi', 'Breakfast option', 'Private bathroom', index > 1 ? 'Workspace' : 'TV'].filter(Boolean),
        media: listing.media,
        status: 'active',
      });
    });
  });
  return rooms;
}

function buildPromoterLinks(seedListings = listings) {
  const promoter = users.find((u) => u.role === 'promoter');
  return seedListings.filter((item) => item.bookable).slice(0, 12).map((listing, index) => ({
    id: `promoter-link-${String(index + 1).padStart(3, '0')}`,
    promoterId: promoter.id,
    listingId: listing.id,
    code: `${promoter.referralCode}-${index + 1}`,
    referralCode: `${promoter.referralCode}-${index + 1}`,
    url: `/listings/${listing.serviceType}/${listing.slug}?ref=${promoter.referralCode}-${index + 1}`,
    clicks: 120 + index * 31,
    conversions: 4 + index,
    status: 'active',
  }));
}

function buildBookings(seedListings = listings) {
  const sample = seedListings.filter((x) => x.bookable).slice(0, 10);
  return sample.map((listing, index) => {
    const total = listing.priceFrom + 7750;
    const hasReferral = index % 2 === 0;
    const split = calculateCommission(total, hasReferral);
    return {
      id: `booking-${String(index + 1).padStart(4, '0')}`,
      bookingRef: `CT-${listing.serviceType.toUpperCase()}-${1042 + index}`,
      serviceType: listing.serviceType,
      guestSnapshot: { fullName: index % 2 ? 'Brian Okello' : 'Amina Nakanwagi', email: index % 2 ? 'brian@classictrip.test' : 'amina@classictrip.test', phone: '+256700000004' },
      customerUserId: index % 2 ? null : 'user-customer-001',
      companyId: listing.companyId,
      listingId: listing.id,
      scheduleId: null,
      passengers: [{ fullName: index % 2 ? 'Brian Okello' : 'Amina Nakanwagi', seatOrRoom: listing.serviceType === 'bus' ? `A${(index % 4) + 1}` : `Room ${201 + index}` }],
      pricing: { subtotal: listing.priceFrom, fees: 7750, total, currency: 'UGX', split },
      promoterAttribution: hasReferral ? { promoterId: 'user-promoter-001', linkId: `promoter-link-${String(index + 1).padStart(3, '0')}`, code: 'CT-DEMO-1' } : null,
      paymentStatus: 'successful',
      bookingStatus: index % 3 === 0 ? 'completed' : 'confirmed',
      qrCodeValue: `CLASSIC-TRIP:${listing.serviceType}:${1042 + index}`,
      createdAt: new Date(Date.UTC(2026, 4, 10 + index)).toISOString(),
    };
  });
}

function buildWallets(seedCompanies = companies) {
  const wallets = [
    { id: 'wallet-platform-001', ownerType: 'platform', ownerId: 'platform', currency: 'UGX', availableBalance: 8420000, pendingBalance: 0 },
    { id: 'wallet-promoter-001', ownerType: 'promoter', ownerId: 'user-promoter-001', currency: 'UGX', availableBalance: 820000, pendingBalance: 310000 },
  ];
  seedCompanies.forEach((company, index) => wallets.push({
    id: company.walletId,
    ownerType: 'company',
    ownerId: company.id,
    currency: 'UGX',
    availableBalance: 500000 + index * 210000,
    pendingBalance: 100000 + index * 67000,
  }));
  return wallets;
}

function buildOperations() {
  return {
    supportTickets: [
      { id: 'support-001', subject: 'Passenger cannot find ticket', ownerType: 'customer', status: 'open', priority: 'high' },
      { id: 'support-002', subject: 'Partner wants route boost', ownerType: 'company', status: 'pending', priority: 'medium' },
      { id: 'support-003', subject: 'Promoter withdrawal proof', ownerType: 'promoter', status: 'resolved', priority: 'low' },
    ],
    refundRequests: [
      { id: 'refund-001', bookingRef: 'CT-BUS-1044', amount: 55000, status: 'reviewing', reason: 'Operator schedule changed' },
      { id: 'refund-002', bookingRef: 'CT-HOTEL-1047', amount: 185000, status: 'approved', reason: 'Guest cancellation within window' },
    ],
    promotionCampaigns: [
      { id: 'campaign-001', companyId: 'company-01', listingId: 'bus-001', name: 'Juba route boost', placement: 'route_boost', budget: 800000, clicks: 1240, bookings: 32, status: 'active' },
      { id: 'campaign-002', companyId: 'company-06', listingId: 'hotel-021', name: 'Kampala hotel feature', placement: 'homepage_feature', budget: 500000, clicks: 870, bookings: 18, status: 'active' },
    ],
    auditLogs: [
      { id: 'audit-001', actorId: 'user-admin-001', action: 'company.approved', target: 'company-01', createdAt: new Date().toISOString() },
      { id: 'audit-002', actorId: 'user-employee-001', action: 'ticket.scanned', target: 'CT-BUS-1042', createdAt: new Date().toISOString() },
    ],
  };
}

function buildSeedData() {
  const routes = buildRoutes();
  const vehicles = buildVehicles(routes);
  const schedules = buildSchedules(routes, listings, vehicles);
  const seats = buildSeats(schedules);
  const rooms = buildRooms();
  const promoterLinks = buildPromoterLinks();
  const bookings = buildBookings();
  const wallets = buildWallets();
  const operations = buildOperations();
  return {
    categories,
    users,
    companies,
    listings,
    routes,
    vehicles,
    schedules,
    seats,
    rooms,
    companyEmployees: [],
    bookings,
    payments: [],
    wallets,
    walletTransactions: [],
    promoterLinks,
    referralClicks: [],
    commissions: [],
    blogs,
    reviews: [],
    notifications: [],
    ...operations,
  };
}

async function seedMongo() {
  const { connectDb, mongoose } = require('../config/db');
  await connectDb();
  if (mongoose.connection.readyState !== 1) {
    console.log('MongoDB not connected. Seed data is available through the in-memory store.');
    return;
  }
  const data = buildSeedData();
  const modelNames = [
    'User',
    'Company',
    'ServiceCategory',
    'Listing',
    'Route',
    'Vehicle',
    'TripSchedule',
    'Seat',
    'Room',
    'CompanyEmployee',
    'Booking',
    'Payment',
    'Wallet',
    'WalletTransaction',
    'PromoterLink',
    'ReferralClick',
    'Commission',
    'BlogPost',
    'SupportTicket',
    'RefundRequest',
    'PromotionCampaign',
    'AuditLog',
    'Review',
    'Notification',
  ];
  for (const name of modelNames) require(`../models/${name}`);
  const map = {
    User: data.users,
    Company: data.companies,
    ServiceCategory: data.categories,
    Listing: data.listings,
    Route: data.routes,
    Vehicle: data.vehicles,
    TripSchedule: data.schedules,
    Seat: data.seats,
    Room: data.rooms,
    CompanyEmployee: data.companyEmployees || [],
    Booking: data.bookings,
    Payment: data.payments || [],
    Wallet: data.wallets,
    WalletTransaction: data.walletTransactions,
    PromoterLink: data.promoterLinks,
    ReferralClick: data.referralClicks,
    Commission: data.commissions,
    BlogPost: data.blogs,
    SupportTicket: data.supportTickets,
    RefundRequest: data.refundRequests,
    PromotionCampaign: data.promotionCampaigns,
    AuditLog: data.auditLogs,
    Review: data.reviews || [],
    Notification: data.notifications || [],
  };
  for (const [name, rows] of Object.entries(map)) {
    const Model = mongoose.model(name);
    await Model.deleteMany({});
    await Model.insertMany(rows, { ordered: false });
    console.log(`Seeded ${rows.length} ${name} records`);
  }
  await mongoose.disconnect();
}

module.exports = { buildSeedData };

if (require.main === module) {
  seedMongo().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
