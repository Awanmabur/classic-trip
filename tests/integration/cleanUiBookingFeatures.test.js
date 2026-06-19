const request = require('supertest');
const app = require('../../src/app');
const store = require('../../src/services/data/persistentStore');

async function login(email) {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ identity: email, password: 'Password123' }).expect(302);
  return agent;
}

describe('Clean dashboard chrome and visible booking features', () => {
  test('all role dashboards use stable admin-style sidebar and no right gutter override', async () => {
    const admin = await login('admin@classictrip.test');
    const adminPage = await admin.get('/admin').expect(200);
    expect(adminPage.text).toContain('Clean dashboard chrome');
    expect(adminPage.text).toContain('transform:none !important');
    expect(adminPage.text).toContain('padding:12px 0 20px 10px !important');
    expect(adminPage.text).toContain('navLogout');

    const company = await login('company@classictrip.test');
    const companyPage = await company.get('/company/dashboard').expect(200);
    expect(companyPage.text).toContain('dashboardShellSidebar');
    expect(companyPage.text).toContain('Clean dashboard chrome');
    expect(companyPage.text).toContain('transform:none !important');
    expect(companyPage.text).toContain('padding:12px 0 20px 10px !important');
    expect(companyPage.text).toContain('navLogout');

    const customer = await login('amina@classictrip.test');
    const customerPage = await customer.get('/account').expect(200);
    expect(customerPage.text).toContain('dashboardShellSidebar');
    expect(customerPage.text).toContain('Clean dashboard chrome');
  });

  test('bus booking UI exposes multi-seat and two-way ticket controls', async () => {
    const listing = store.state.listings.find((item) => item.serviceType === 'bus' && item.bookable);
    const schedule = store.schedulesForListing(listing.id)[0];
    const seats = store.seatsForSchedule(schedule.id).filter((seat) => seat.status === 'available').slice(0, 2);
    expect(seats.length).toBeGreaterThanOrEqual(2);

    const detail = await request(app).get(`/listings/${listing.serviceType}/${listing.slug}`).expect(200);
    expect(detail.text).toContain('Multi-ticket mode is on');
    expect(detail.text).toContain('Two-way / return ticket');
    expect(detail.text).toContain('data-return-seat');
    expect(detail.text).toContain('selectedSeats');

    const checkout = await request(app)
      .get(`/book/${listing.serviceType}/${listing.slug}`)
      .query({
        scheduleId: schedule.id,
        selectedSeats: seats.map((seat) => seat.seatNumber).join(','),
        selected: seats.map((seat) => seat.seatNumber).join(','),
        passengerCount: '2',
        returnScheduleId: schedule.id,
        returnSeats: seats.map((seat) => seat.seatNumber).reverse().join(','),
      })
      .expect(200);

    expect(checkout.text).toContain('name="selectedSeats"');
    expect(checkout.text).toContain('name="returnScheduleId"');
    expect(checkout.text).toContain('Buyer information first');
    expect(checkout.text.indexOf('User information')).toBeLessThan(checkout.text.indexOf('Confirm seats'));
    expect(checkout.text.indexOf('Confirm seats')).toBeLessThan(checkout.text.indexOf('data-booking-step-panel="payment"'));
    expect(checkout.text).toContain('data-booking-step-panel="buyer"');
    expect(checkout.text).toContain('data-booking-seat=');
    expect(checkout.text).toContain('Ticket 1 / Seat');
    expect(checkout.text).toContain('Extra ticket details');
    expect(checkout.text).toContain('window.__busSelectedSeats');
    expect((checkout.text.match(/data-passenger-row/g) || []).length).toBeGreaterThanOrEqual(1);
  });

  test('buyer information is saved and linked to multi-seat bookings', () => {
    const listing = store.state.listings.find((item) => item.serviceType === 'bus' && item.bookable);
    const schedule = store.schedulesForListing(listing.id)[0];
    const seats = store.seatsForSchedule(schedule.id).filter((seat) => seat.status === 'available').slice(0, 2);
    expect(seats).toHaveLength(2);

    const booking = store.createBooking({
      listingId: listing.id,
      scheduleId: schedule.id,
      selectedSeats: seats.map((seat) => seat.seatNumber).join(','),
      passengerCount: '2',
      fullName: 'Buyer First Tester',
      email: 'buyer-first@classictrip.test',
      phone: '+256700515151',
      idType: 'Passport',
      documentNumber: 'P-515151',
      notes: 'Needs front boarding help',
      passengers: JSON.stringify([
        { fullName: 'Passenger One', phone: '+256700515152' },
        { fullName: 'Passenger Two', phone: '+256700515153' },
      ]),
    });

    expect(booking.buyerSnapshot).toMatchObject({
      fullName: 'Buyer First Tester',
      email: 'buyer-first@classictrip.test',
      phone: '+256700515151',
      idType: 'Passport',
      documentNumber: 'P-515151',
      notes: 'Needs front boarding help',
    });
    expect(booking.guestSnapshot.fullName).toBe('Buyer First Tester');
    expect(booking.passengers).toHaveLength(2);
    expect(booking.bookingItems.map((item) => item.seatNumber)).toEqual(seats.map((seat) => seat.seatNumber));
  });

  test('company dashboard data and labels are separated by service category', async () => {
    const pureCompany = (type) => store.state.companies.find((company) => {
      const companyType = company.companyType || company.type;
      const listingTypes = new Set(store.state.listings.filter((listing) => listing.companyId === company.id).map((listing) => listing.serviceType));
      return companyType === type && listingTypes.size === 1 && listingTypes.has(type);
    });
    const busCompany = pureCompany('bus');
    const hotelCompany = pureCompany('hotel');
    const flightCompany = pureCompany('flight');
    expect(busCompany).toBeTruthy();
    expect(hotelCompany).toBeTruthy();
    expect(flightCompany).toBeTruthy();

    const busDashboard = store.dashboardData('company', { companyId: busCompany.id });
    expect(busDashboard.serviceProfile.supportsBus).toBe(true);
    expect(busDashboard.serviceProfile.supportsHotel).toBe(false);
    expect(busDashboard.routes.length).toBeGreaterThan(0);
    expect(busDashboard.vehicles.length).toBeGreaterThan(0);
    expect(busDashboard.seatMaps.length).toBeGreaterThan(0);
    expect(busDashboard.roomVisualMaps).toHaveLength(0);
    expect(busDashboard.serviceProfile.pageMeta.seatrooms[0]).toBe('Seat maps');

    const hotelDashboard = store.dashboardData('company', { companyId: hotelCompany.id });
    expect(hotelDashboard.serviceProfile.supportsHotel).toBe(true);
    expect(hotelDashboard.serviceProfile.supportsBus).toBe(false);
    expect(hotelDashboard.routes).toHaveLength(0);
    expect(hotelDashboard.vehicles).toHaveLength(0);
    expect(hotelDashboard.seatMaps).toHaveLength(0);
    expect(hotelDashboard.roomVisualMaps.length).toBeGreaterThan(0);
    expect(hotelDashboard.serviceProfile.pageMeta.seatrooms[0]).toBe('Rooms');

    const flightDashboard = store.dashboardData('company', { companyId: flightCompany.id });
    expect(flightDashboard.serviceProfile.supportsFlight).toBe(true);
    expect(flightDashboard.serviceProfile.visiblePages).not.toContain('seatrooms');
    expect(flightDashboard.seatMaps).toHaveLength(0);
    expect(flightDashboard.roomVisualMaps).toHaveLength(0);

    const company = await login('company@classictrip.test');
    const companyPage = await company.get('/company/dashboard').expect(200);
    expect(companyPage.text).toContain('Bus Operations Dashboard');
    expect(companyPage.text).toContain('data-service-panel="bus"');
    expect(companyPage.text).not.toContain('Company Admin');
    expect(companyPage.text).not.toContain('Employee / Scanner');
    expect(companyPage.text).not.toContain('Partner Company Dashboard');
  });
});
