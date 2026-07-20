const request = require('supertest');
const app = require('../../src/app');
const store = require('../../src/services/data/persistentStore');
const correspondenceService = require('../../src/services/support/correspondenceService');

async function login(email) {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ identity: email, password: 'Password123' }).expect(302);
  return agent;
}

async function ensureBooking() {
  const existing = store.state.bookings.find((booking) => booking.customerUserId === 'user-customer-001' && booking.companyId === 'company-01');
  if (existing) return existing;
  return store.createBooking({
    listingId: 'bus-001',
    scheduleId: 'schedule-0001',
    seatNumber: 'H1',
    fullName: 'Amina Kato',
    email: 'customer@classictrip.test',
    phone: '+256700111222',
    customerUserId: 'user-customer-001',
  });
}

test('section H correspondence center links support, internal notes, delivery attempts, and visible timelines', async () => {
  const booking = await ensureBooking();
  const customer = await login('amina@classictrip.test');
  await customer
    .post('/account/support')
    .type('form')
    .send({ bookingRef: booking.bookingRef, category: 'Ticket issue', message: 'Please update my boarding assistance record.' })
    .expect(302);

  const ticket = store.state.supportTickets.find((row) => row.bookingRef === booking.bookingRef && row.subject.includes('Ticket issue'));
  expect(ticket).toBeTruthy();
  expect(store.state.correspondenceMessages.some((message) => message.supportTicketId === ticket.id && message.visibility === 'shared')).toBe(true);

  const admin = await login('admin@classictrip.test');
  await admin
    .post(`/admin/support/${ticket.id}/reply`)
    .type('form')
    .send({ message: 'Support has responded by email, SMS, WhatsApp, and in-app.', status: 'open', visibility: 'shared' })
    .expect(302);

  await admin
    .post('/admin/internal-notes')
    .type('form')
    .send({ bookingRef: booking.bookingRef, supportTicketId: ticket.id, subject: 'Internal escalation', message: 'Call the driver before departure.', visibility: 'internal' })
    .expect(302);

  await correspondenceService.createMessage({
    bookingRef: booking.bookingRef,
    refundId: 'refund-test-h',
    agreementId: 'agreement-test-h',
    verificationId: 'verification-test-h',
    driverId: 'employee-driver-001',
    customerId: 'user-customer-001',
    supportTicketId: ticket.id,
    subject: 'Linked correspondence coverage',
    message: 'This message proves booking, ticket, refund, agreement, verification, driver, and customer link fields are supported.',
    actorType: 'admin',
    actorId: 'admin-test',
    visibility: 'shared',
    channels: ['in_app', 'email', 'sms', 'whatsapp'],
  });

  const publicMessages = correspondenceService.messageRows({ bookingRef: booking.bookingRef });
  expect(publicMessages.some((message) => message.visibility === 'internal')).toBe(false);
  const allMessages = correspondenceService.messageRows({ bookingRef: booking.bookingRef }, { includeInternal: true });
  expect(allMessages.some((message) => message.visibility === 'internal')).toBe(true);
  expect(store.state.notificationDeliveryAttempts.map((attempt) => attempt.channel)).toEqual(expect.arrayContaining(['in_app', 'email', 'sms', 'whatsapp']));
  expect(store.state.bookingTimelineEvents.map((event) => event.action)).toEqual(expect.arrayContaining(['correspondence.message.sent', 'correspondence.internal_note.added']));

  const customerPage = await customer.get('/account/support').expect(200);
  expect(customerPage.text).toContain('Booking correspondence timeline');

  const company = await login('company@classictrip.test');
  const companyPage = await company.get('/company/support').expect(200);
  expect(companyPage.text).toContain('Support timeline');

  const correspondenceCsv = await admin.get('/admin/reports/correspondence.csv').expect(200);
  expect(correspondenceCsv.text).toContain('Message,Linked item,Subject,Visibility,Channels,Status,Date');
  expect(correspondenceCsv.text).toContain('Linked correspondence coverage');

  const deliveryCsv = await admin.get('/admin/reports/delivery-attempts.csv').expect(200);
  expect(deliveryCsv.text).toContain('Attempt,Message/notification,Booking/reference,Channel,Status,Provider,Attempted');
  expect(deliveryCsv.text).toContain('whatsapp');
});
