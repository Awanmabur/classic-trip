const request = require('supertest');
const app = require('../../src/app');
const store = require('../../src/services/data/persistentStore');

test('public search to guest booking to ticket scan route smoke path works', async () => {
  const listing = store.state.listings.find((item) => item.bookable && item.serviceType === 'bus' && item.status === 'active');
  const company = store.findCompany(listing.companyId);
  const schedule = store.schedulesForListing(listing.id)[0];
  const seat = store.seatsForSchedule(schedule.id).find((item) => item.status === 'available');
  const email = `route-smoke-${Date.now()}@example.com`;

  await request(app).get('/').expect(200);
  await request(app).get('/search?serviceType=bus&bookable=true').expect(200);
  await request(app).get(`/companies/${company.slug}`).expect(200);
  await request(app).get(`/book/${listing.serviceType}/${listing.slug}`).expect(200);

  const bookingResponse = await request(app)
    .post('/bookings/guest')
    .type('form')
    .send({
      listingId: listing.id,
      scheduleId: schedule.id,
      seatNumber: seat.seatNumber,
      fullName: 'Route Smoke Guest',
      email,
      phone: '+256700444555',
      provider: 'mock',
      paymentMethod: 'Mobile Money',
      paymentReference: '+256700444555',
    })
    .expect(302);

  expect(bookingResponse.headers.location).toMatch(/^\/booking\/success\/CT-/);
  const bookingRef = bookingResponse.headers.location.split('/').pop();
  const booking = store.findBooking(bookingRef);

  await request(app).get(`/tickets/${bookingRef}?accessCode=${encodeURIComponent(booking.guestLookupCode)}`).expect(200);
  await request(app).post('/api/scanner/validate').send({ qrCodeValue: booking.qrCodeValue }).expect(200);
  await request(app).post('/api/scanner/validate').send({ qrCodeValue: booking.qrCodeValue }).expect(409);
});
