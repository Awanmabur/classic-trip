const request = require('supertest');
const app = require('../../src/app');
const store = require('../../src/services/data/persistentStore');
const companyService = require('../../src/services/company/companyService');
const hotelService = require('../../src/services/hotel/hotelService');

async function login(email) {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ identity: email, password: 'Password123' }).expect(302);
  return agent;
}

describe('Master section D - Hotel and room booking', () => {
  test('D is end-to-end: property, room types, units, nightly inventory, multi-room booking, room map, stay detail, manifests and reports', async () => {
    const stamp = Date.now();
    const companyId = 'company-01';
    const companyAgent = await login('company@classictrip.test');

    const listing = await companyService.createListing(companyId, {
      serviceType: 'hotel',
      title: `D Hotel ${stamp}`,
      city: 'Entebbe',
      country: 'Uganda',
      address: 'Lake Road',
      priceFrom: 220000,
      amenities: 'WiFi,Breakfast,Airport shuttle',
      checkInTime: '14:00',
      checkOutTime: '10:00',
      cancellationRules: 'Free cancellation until 24 hours before arrival.',
      status: 'active',
    });

    await companyAgent.post('/company/hotels/properties').type('form').send({
      listingId: listing.id,
      propertyName: `D Lake Hotel ${stamp}`,
      address: 'Lake Road Entebbe',
      city: 'Entebbe',
      country: 'Uganda',
      mapLocation: '0.0500,32.4600',
      checkInTime: '14:00',
      checkOutTime: '10:00',
      amenities: 'WiFi,Breakfast,Airport shuttle',
      policies: 'No smoking,ID required',
      taxesAndFees: 'VAT,Service charge',
    }).expect(302);
    const property = store.state.hotelProperties.find((item) => item.listingId === listing.id && item.propertyName === `D Lake Hotel ${stamp}`);
    expect(property).toBeTruthy();
    expect(property.checkInTime).toBe('14:00');

    await companyAgent.post('/company/hotels/room-types').type('form').send({
      listingId: listing.id,
      propertyId: property.id,
      name: `D Deluxe ${stamp}`,
      capacity: 2,
      basePrice: 240000,
      amenities: 'King bed,Lake view,WiFi',
      policies: 'Breakfast included',
      taxesAndFees: 'VAT',
      defaultInventory: 2,
    }).expect(302);
    const roomType = store.state.roomTypes.find((item) => item.listingId === listing.id && item.name === `D Deluxe ${stamp}`);
    expect(roomType).toBeTruthy();

    await companyAgent.post('/company/hotels/room-units').type('form').send({
      roomTypeId: roomType.id,
      unitNumbers: `1301-${stamp},1302-${stamp},1303-${stamp}`,
      floor: '1',
      wing: 'Lake',
      housekeepingStatus: 'clean',
    }).expect(302);
    const units = store.state.roomUnits.filter((item) => item.roomTypeId === roomType.id);
    expect(units).toHaveLength(3);

    const checkIn = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
    const checkOut = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);
    await companyAgent.post('/company/hotels/inventory').type('form').send({
      roomTypeId: roomType.id,
      startDate: checkIn,
      endDate: checkOut,
      price: 250000,
      status: 'available',
    }).expect(302);
    const nights = store.state.roomNightInventories.filter((item) => item.roomTypeId === roomType.id);
    expect(nights).toHaveLength(6);
    expect(nights.every((night) => night.status === 'available')).toBe(true);

    await companyAgent.post(`/company/hotels/inventory/${nights[0].id}/status`).type('form').send({ status: 'maintenance', notes: 'AC repair' }).expect(302);
    expect(nights[0].status).toBe('maintenance');
    await companyAgent.post(`/company/hotels/inventory/${nights[0].id}/status`).type('form').send({ status: 'available' }).expect(302);
    expect(nights[0].status).toBe('available');

    const bookingResponse = await request(app).post('/bookings/hotel').type('form').send({
      listingId: listing.id,
      roomTypeId: roomType.id,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      roomCount: 2,
      fullName: 'D Hotel Buyer',
      email: `d-buyer-${stamp}@classictrip.test`,
      phone: '+256703400001',
      guests: JSON.stringify([
        { fullName: 'D Guest One', phone: '+256703400002' },
        { fullName: 'D Guest Two', phone: '+256703400003' },
      ]),
    }).expect(302);
    expect(bookingResponse.headers.location).toContain('/booking/success/');
    const bookingRef = bookingResponse.headers.location.split('/').pop();
    const booking = store.findBooking(bookingRef);
    expect(booking.serviceType).toBe('hotel');
    expect(booking.bookingItems).toHaveLength(2);
    expect(booking.ticketLegs).toHaveLength(2);
    expect(booking.hotelStay.nights).toHaveLength(2);
    expect(booking.passengers.map((guest) => guest.fullName)).toEqual(expect.arrayContaining(['D Guest One', 'D Guest Two']));
    expect(store.state.roomNightInventories.filter((night) => night.bookingRef === bookingRef)).toHaveLength(4);

    const roomMapRows = hotelService.roomMap(companyId, listing.id, checkIn, checkOut);
    expect(roomMapRows.some((row) => row[3] === bookingRef)).toBe(true);

    const detailPage = await companyAgent.get(`/driver/tickets/${bookingRef}`).expect(200);
    expect(detailPage.text).toContain(bookingRef);
    expect(detailPage.text).toContain('D Guest One');

    await companyAgent.post(`/company/hotels/bookings/${bookingRef}/check-in`).type('form').send({}).expect(302);
    expect(booking.hotelStay.status).toBe('checked-in');
    expect(store.state.roomNightInventories.filter((night) => night.bookingRef === bookingRef).every((night) => night.status === 'occupied')).toBe(true);

    await companyAgent.post(`/company/hotels/bookings/${bookingRef}/check-out`).type('form').send({}).expect(302);
    expect(booking.hotelStay.status).toBe('checked-out');

    const dashboard = store.dashboardData('company', { companyId });
    expect(dashboard.hotelProperties.some((row) => row[0] === property.propertyName)).toBe(true);
    expect(dashboard.roomTypes.some((row) => row[0] === roomType.name)).toBe(true);
    expect(dashboard.roomUnits.some((row) => row[1] === roomType.name)).toBe(true);
    expect(dashboard.roomNightInventory.some((row) => row[4] === bookingRef)).toBe(true);
    expect(dashboard.hotelDepartures.some((row) => row[0] === bookingRef)).toBe(true);

    const manifest = await companyAgent.get(`/company/hotels/${listing.id}/manifest?mode=departures`).expect(200);
    expect(manifest.text).toContain(bookingRef);
    expect(manifest.text).toContain('Hotel departures manifest');

    const manifestCsv = await companyAgent.get(`/company/hotels/${listing.id}/manifest.csv?mode=departures`).expect(200);
    expect(manifestCsv.text).toContain(bookingRef);
    const manifestPdf = await companyAgent.get(`/company/hotels/${listing.id}/manifest.pdf?mode=departures`).expect(200);
    expect(manifestPdf.headers['content-type']).toContain('application/pdf');

    const roomsCsv = await companyAgent.get('/company/reports/room-types.csv').expect(200);
    expect(roomsCsv.text).toContain(roomType.name);
    const inventoryCsv = await companyAgent.get('/company/reports/room-night-inventory.csv').expect(200);
    expect(inventoryCsv.text).toContain(bookingRef);
    const arrivalsCsv = await companyAgent.get('/company/reports/hotel-arrivals.csv').expect(200);
    expect(arrivalsCsv.text).toContain(bookingRef);
  });
});
