const store = require('../../src/services/data/persistentStore');
const companyService = require('../../src/services/company/companyService');

function suffix() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function verifiedCompany(name = '18E Partner') {
  const company = await companyService.createCompany({
    name: `${name} ${suffix()}`,
    companyType: 'transport',
    country: 'Uganda',
    city: 'Kampala',
    email: 'ops@example.com',
  });
  await companyService.setVerificationStatus(company.slug, 'verified', 'admin-e2e');
  return company;
}

test('company verification gates listing publishing and bookings', async () => {
  const company = await companyService.createCompany({
    name: `Pending Hotel ${suffix()}`,
    companyType: 'hotel',
    city: 'Entebbe',
  });
  const listing = await companyService.createListing(company.id, {
    serviceType: 'hotel',
    title: `Pending rooms ${suffix()}`,
    status: 'draft',
    priceFrom: 120000,
  });

  await expect(companyService.publishListing(company.id, listing.id)).rejects.toMatchObject({ status: 403 });
  await expect(store.createBooking({ listingId: listing.id, fullName: 'Blocked Guest', email: 'blocked@example.com', phone: '+256700101010' })).rejects.toThrow('This listing is not currently open for booking');

  await companyService.setVerificationStatus(company.slug, 'verified', 'admin-e2e');
  const published = await companyService.publishListing(company.id, listing.id);
  const room = await companyService.createRoom(company.id, {
    listingId: listing.id,
    roomType: 'Lake View Room',
    nightlyPrice: 140000,
    inventory: 1,
  });
  const booking = await store.createBooking({
    listingId: published.id,
    roomId: room.id,
    fullName: 'Verified Guest',
    email: 'verified@example.com',
    phone: '+256700202020',
  });

  expect(company.settings.canPublish).toBe(true);
  expect(published.status).toBe('active');
  expect(published.bookable).toBe(true);
  expect(booking.bookingStatus).toBe('confirmed');

  await companyService.setVerificationStatus(company.id, 'suspended', 'admin-e2e');
  expect(company.verificationStatus).toBe('suspended');
  expect(published.status).toBe('paused');
  expect(published.bookable).toBe(false);
});

test('company listing updates, media attachment, and archive flow work end to end', async () => {
  const company = await verifiedCompany('Listing CRUD Partner');
  const listing = await companyService.createListing(company.id, {
    serviceType: 'bus',
    title: `CRUD route ${suffix()}`,
    from: 'Kampala',
    to: 'Masaka',
    priceFrom: 35000,
    status: 'active',
  });

  const updated = await companyService.updateListing(company.id, listing.id, {
    title: `${listing.title} Express`,
    priceFrom: 42000,
    baggageRules: '<b>One main bag included</b>',
  });
  await companyService.attachMedia({
    companyId: company.id,
    target: 'companyLogo',
    asset: { url: 'https://cdn.example.com/logo.png', publicId: 'logo-public-id', width: 160, height: 160, format: 'png' },
  });
  await companyService.attachMedia({
    companyId: company.id,
    target: 'listingMedia',
    targetId: listing.id,
    asset: { url: 'https://cdn.example.com/bus.png', publicId: 'bus-public-id', width: 1200, height: 800, format: 'png' },
  });

  expect(updated.priceFrom).toBe(42000);
  expect(updated.baggageRules).toBe('One main bag included');
  expect(company.logo.publicId).toBe('logo-public-id');
  expect(updated.media).toHaveLength(1);
  expect(store.searchListings({ q: updated.title }).some((item) => item.id === listing.id)).toBe(true);

  const archived = await companyService.archiveListing(company.id, listing.id);
  expect(archived.status).toBe('archived');
  expect(archived.bookable).toBe(false);
  expect(store.searchListings({ q: updated.title }).some((item) => item.id === listing.id)).toBe(false);
});

test('bus route and schedule creation generates seat inventory', async () => {
  const company = await verifiedCompany('Bus Inventory Partner');
  const listing = await companyService.createListing(company.id, {
    serviceType: 'bus',
    title: `Seat route ${suffix()}`,
    from: 'Kampala',
    to: 'Mbarara',
    priceFrom: 55000,
    status: 'active',
  });
  const route = await companyService.createRoute(company.id, {
    listingId: listing.id,
    origin: 'Kampala',
    destination: 'Mbarara',
    boardingPoints: 'Namirembe, Nateete',
    dropoffPoints: 'Mbarara Park',
  });
  const vehicle = await companyService.createVehicle(company.id, {
    listingId: listing.id,
    serviceType: 'bus',
    name: 'Mbarara Coach',
    layoutName: '2x2',
    rows: 3,
  });
  const { schedule, seats } = await companyService.createSchedule(company.id, {
    routeId: route.id,
    vehicleId: vehicle.id,
    departAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    totalSeats: 10,
    blockedSeats: '1,2',
    basePrice: 55000,
  });

  expect(route.corridor).toBe('kampala-mbarara');
  expect(schedule.totalSeats).toBe(10);
  expect(schedule.availableSeats).toBe(8);
  expect(seats).toHaveLength(10);
  expect(seats.filter((seat) => seat.status === 'blocked').map((seat) => seat.seatNumber)).toEqual(['1', '2']);
  expect(store.getAvailability(listing.id).seats.some((seat) => seat.scheduleId === schedule.id)).toBe(true);
});

test('vehicle creation feeds trip schedules without manual seat entry', async () => {
  const company = await verifiedCompany('Vehicle Trip Partner');
  const listing = await companyService.createListing(company.id, {
    serviceType: 'bus',
    title: `Vehicle route ${suffix()}`,
    from: 'Kampala',
    to: 'Jinja',
    priceFrom: 28000,
    status: 'active',
  });
  const route = await companyService.createRoute(company.id, {
    listingId: listing.id,
    origin: 'Kampala',
    destination: 'Jinja',
  });
  const vehicle = await companyService.createVehicle(company.id, {
    listingId: listing.id,
    serviceType: 'bus',
    name: 'Dashboard Coach A',
    plateOrCode: 'UAX 100A',
    layoutName: '2x2',
    rows: 3,
  });
  const { schedule, seats } = await companyService.createSchedule(company.id, {
    routeId: route.id,
    vehicleId: vehicle.id,
    departAt: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
    blockedSeats: '1',
    basePrice: 28000,
  });
  const dashboardData = store.dashboardData('company', { companyId: company.id });

  expect(vehicle.totalSeats).toBe(12);
  expect(schedule.vehicleId).toBe(vehicle.id);
  expect(schedule.vehicleName).toBe('Dashboard Coach A');
  expect(schedule.totalSeats).toBe(12);
  expect(schedule.availableSeats).toBe(11);
  expect(seats).toHaveLength(12);
  expect(dashboardData.options.vehicles.some((option) => option.id === vehicle.id)).toBe(true);
  expect(dashboardData.vehicles.some((row) => row.at(-1)?.entity === 'vehicle' && row.at(-1)?.id === vehicle.id)).toBe(true);
  expect(dashboardData.schedules.some((row) => row[3] === 'Dashboard Coach A')).toBe(true);
});

test('hotel listing creation saves image and first room without route or departure logic', async () => {
  const company = await verifiedCompany('Smart Hotel Partner');
  const listing = await companyService.createListing(company.id, {
    serviceType: 'hotel',
    title: `Smart hotel ${suffix()}`,
    city: 'Entebbe',
    address: 'Airport Road',
    imageUrl: 'https://cdn.example.com/hotel.jpg',
    checkInTime: '15:00',
    checkOutTime: '10:00',
    priceFrom: 175000,
    status: 'active',
    roomType: 'Airport Suite',
    nightlyPrice: 210000,
    inventory: 3,
    amenities: 'Wi-Fi, Breakfast',
  });
  const room = store.roomsForListing(listing.id).find((item) => item.roomType === 'Airport Suite');

  expect(listing.media[0].url).toBe('https://cdn.example.com/hotel.jpg');
  expect(listing.checkInTime).toBe('15:00');
  expect(listing.checkOutTime).toBe('10:00');
  expect(room).toBeTruthy();
  expect(room.inventory).toBe(3);
  await expect(companyService.createRoute(company.id, {
    listingId: listing.id,
    origin: 'Entebbe',
    destination: 'Kampala',
  })).rejects.toMatchObject({ status: 422 });
});

test('departure creation requires a selected vehicle and rejects hotel-style inventory', async () => {
  const company = await verifiedCompany('Departure Guard Partner');
  const listing = await companyService.createListing(company.id, {
    serviceType: 'bus',
    title: `Guarded route ${suffix()}`,
    from: 'Kampala',
    to: 'Gulu',
    priceFrom: 60000,
    status: 'active',
  });
  const route = await companyService.createRoute(company.id, {
    listingId: listing.id,
    origin: 'Kampala',
    destination: 'Gulu',
  });

  await expect(companyService.createSchedule(company.id, {
    routeId: route.id,
    departAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  })).rejects.toMatchObject({ status: 422 });

  await expect(companyService.createVehicle(company.id, {
    serviceType: 'hotel',
    name: 'Hotel room block',
  })).rejects.toMatchObject({ status: 422 });
});

test('hotel room inventory updates and booking consumption are connected', async () => {
  const company = await verifiedCompany('Room Inventory Partner');
  const listing = await companyService.createListing(company.id, {
    serviceType: 'hotel',
    title: `Inventory hotel ${suffix()}`,
    city: 'Jinja',
    priceFrom: 180000,
    status: 'active',
  });
  const room = await companyService.createRoom(company.id, {
    listingId: listing.id,
    roomType: 'River Suite',
    nightlyPrice: 220000,
    inventory: 2,
    amenities: 'Wi-Fi, Breakfast',
  });
  const updated = await companyService.updateRoomInventory(company.id, room.id, { inventory: 1 });

  const booking = await store.createBooking({
    listingId: listing.id,
    roomId: room.id,
    fullName: 'Room Guest',
    email: 'room@example.com',
    phone: '+256700303030',
  });

  expect(updated.inventory).toBe(0);
  expect(booking.passengers[0].seatOrRoom).toBe('River Suite');
  await expect(store.createBooking({ listingId: listing.id, roomId: room.id, fullName: 'Late Guest', email: 'late@example.com', phone: '+256700404040' })).rejects.toThrow('Selected room is no longer available');
});

test('employee invite creates user, company access, and dashboard staff row', async () => {
  const company = await verifiedCompany('Staff Partner');
  const { user, employee } = await companyService.inviteEmployee(company.id, {
    fullName: '18E Ticket Checker',
    email: `checker-${suffix()}@classictrip.test`,
    roleTitle: 'Ticket Checker',
    branch: 'Kampala Gate',
    permissions: 'check_in,view_bookings',
  });
  const staffRows = store.dashboardData('company', { companyId: company.id }).staff;

  expect(user.role).toBe('company_employee');
  expect(user.companyId).toBe(company.id);
  expect(employee.permissions).toEqual(['check_in', 'view_bookings']);
  expect(staffRows.some((row) => row[0] === '18E Ticket Checker' && row[1] === 'Ticket Checker')).toBe(true);
});
