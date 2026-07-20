const request = require('supertest');
const app = require('../../src/app');
const store = require('../../src/services/data/persistentStore');
const manifestService = require('../../src/services/operations/manifestService');

async function login(email) {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ identity: email, password: 'Password123' }).expect(302);
  return agent;
}

async function ensureScheduleBooking() {
  let booking = store.state.bookings.find((row) => row.scheduleId === 'schedule-0001' && row.companyId === 'company-01');
  if (booking) return booking;
  return store.createBooking({
    listingId: 'bus-001',
    scheduleId: 'schedule-0001',
    seatNumber: '2',
    fullName: 'Manifest Passenger',
    passengerName: 'Manifest Passenger',
    email: 'manifest-passenger@example.com',
    phone: '+256700333111',
  });
}

test('driver can open print-ready manifest, ticket detail, CSV, and PDF for assigned company schedule', async () => {
  const booking = await ensureScheduleBooking();
  const employee = await login('employee@classictrip.test');

  const manifestPage = await employee.get('/driver/schedules/schedule-0001/manifest').expect(200);
  expect(manifestPage.text).toContain('Trip Manifest');
  expect(manifestPage.text).toContain(booking.bookingRef);
  expect(manifestPage.text).toContain('Print manifest');

  const ticketPage = await employee.get(`/driver/tickets/${booking.bookingRef}`).expect(200);
  expect(ticketPage.text).toContain('Operational Ticket Detail');
  expect(ticketPage.text).toContain(booking.bookingRef);

  const seatTicketPage = await employee.get('/driver/seats/schedule-0001/2/ticket').expect(200);
  expect(seatTicketPage.text).toContain(booking.bookingRef);

  const csv = await employee.get('/driver/schedules/schedule-0001/manifest.csv').expect(200);
  expect(csv.headers['content-type']).toContain('text/csv');
  expect(csv.text).toContain('Booking,Passenger,Seat,Contact');
  expect(csv.text).toContain(booking.bookingRef);

  const pdf = await employee.get('/driver/schedules/schedule-0001/manifest.pdf').expect(200);
  expect(pdf.headers['content-type']).toContain('application/pdf');
  expect(Number(pdf.headers['content-length'])).toBeGreaterThan(1000);
});

test('driver manifest service blocks cross-company schedules and empty booked seats', async () => {
  await ensureScheduleBooking();
  expect(() => manifestService.buildManifest('company-02', 'schedule-0001')).toThrow('Schedule not found for this company');
  expect(() => manifestService.bookingForSeat('company-01', 'schedule-0001', '3')).toThrow('No booked ticket found for this seat');
});

test('customer cannot access protected driver print pages', async () => {
  const customer = await login('amina@classictrip.test');
  await customer.get('/driver/schedules/schedule-0001/manifest').expect(403);
});
