const request = require('supertest');
const app = require('../../src/app');
const store = require('../../src/services/data/persistentStore');
const timelineService = require('../../src/services/support/timelineService');
const workflowService = require('../../src/services/support/workflowService');

async function login(email) {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ identity: email, password: 'Password123' }).expect(302);
  return agent;
}

function ensureCustomerBooking() {
  const existing = store.state.bookings.find((booking) => booking.customerUserId === 'user-customer-001' && booking.companyId === 'company-01');
  if (existing) return existing;
  return store.createBooking({
    listingId: 'bus-001',
    scheduleId: 'schedule-0001',
    seatNumber: '4',
    fullName: 'Amina Kato',
    email: 'customer@classictrip.test',
    phone: '+256700111222',
    customerUserId: 'user-customer-001',
  });
}

test('customer support, refund, and reschedule actions write one booking timeline visible to all operational dashboards', async () => {
  const booking = ensureCustomerBooking();
  const customer = await login('amina@classictrip.test');

  await customer
    .post('/account/support')
    .type('form')
    .send({ bookingRef: booking.bookingRef, category: 'Payment problem', message: 'Please help with the payment receipt and ticket timeline.' })
    .expect(302);

  await customer
    .post('/account/reschedules')
    .type('form')
    .send({ bookingRef: booking.bookingRef, preferredDate: '2026-07-01', preferredTime: '08:00', reason: 'Passenger needs a later travel date.' })
    .expect(302);

  workflowService.requestRefund({ bookingRef: booking.bookingRef, requesterId: 'user-customer-001', amount: 1000, reason: 'Timeline refund test' });

  const ticket = store.state.supportTickets.find((row) => row.bookingRef === booking.bookingRef && row.subject.includes('Payment problem'));
  const admin = await login('admin@classictrip.test');
  await admin
    .post(`/admin/support/${ticket.id}/reply`)
    .type('form')
    .send({ message: 'Support has linked your case to the booking timeline.', status: 'resolved' })
    .expect(302);

  const reschedule = store.state.rescheduleRequests.find((row) => row.bookingRef === booking.bookingRef && row.status === 'pending');
  await admin
    .post(`/admin/reschedules/${reschedule.id}/approve`)
    .type('form')
    .send({ reviewNote: 'Approved for operations follow-up.' })
    .expect(302);

  const timeline = timelineService.bookingTimeline(booking.bookingRef);
  expect(timeline.map((event) => event.action)).toEqual(expect.arrayContaining([
    'support.case.created',
    'support.reply.added',
    'reschedule.requested',
    'reschedule.approved',
    'refund.requested',
  ]));
  expect(store.findBooking(booking.bookingRef).bookingStatus).toBe('rescheduled');

  const customerPage = await customer.get('/account/support').expect(200);
  expect(customerPage.text).toContain('Booking correspondence timeline');
  expect(customerPage.text).toContain('Request reschedule');

  const adminPage = await admin.get('/admin/support').expect(200);
  expect(adminPage.text).toContain('Correspondence timeline');
  expect(adminPage.text).toContain('Reschedule queue');

  const company = await login('company@classictrip.test');
  const companyPage = await company.get('/company/dashboard').expect(200);
  expect(companyPage.text).toContain('Support timeline');

  const timelineCsv = await admin.get('/admin/reports/timeline.csv').expect(200);
  expect(timelineCsv.headers['content-type']).toContain('text/csv');
  expect(timelineCsv.text).toContain('Booking,Type,Event,Actor,Status,Date');
  expect(timelineCsv.text).toContain(booking.bookingRef);

  const rescheduleCsv = await admin.get('/admin/reports/reschedule.csv').expect(200);
  expect(rescheduleCsv.text).toContain('Request,Booking,Preferred date/schedule,Reason,Status,Updated');
  expect(rescheduleCsv.text).toContain(reschedule.id);
});
