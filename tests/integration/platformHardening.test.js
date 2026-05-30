const request = require('supertest');
const app = require('../../src/app');
const store = require('../../src/services/data/demoStore');
const bookingService = require('../../src/services/booking/bookingService');
const companyService = require('../../src/services/company/companyService');
const webhookService = require('../../src/services/payment/webhookService');
const workflowService = require('../../src/services/support/workflowService');

async function login(email) {
  const agent = request.agent(app);
  await agent
    .post('/login')
    .type('form')
    .send({ identity: email, password: 'Password123' })
    .expect(302);
  return agent;
}

test('role dashboards require authentication and the correct role', async () => {
  const unauthenticated = await request(app).get('/admin');
  expect(unauthenticated.status).toBe(302);
  expect(unauthenticated.headers.location).toContain('/login');

  const customer = await login('amina@classictrip.test');
  await customer.get('/admin').expect(403);

  const admin = await login('admin@classictrip.test');
  const adminDashboard = await admin.get('/admin').expect(200);
  expect(adminDashboard.text).toContain('Super Admin Dashboard');

  const company = await login('company@classictrip.test');
  const companyDashboard = await company.get('/company/dashboard').expect(200);
  expect(companyDashboard.text).toContain('/company/listings');
});

test('signed payment webhook reconciles booking payment once and queues notifications', async () => {
  const listing = store.state.listings.find((item) => item.bookable && item.status === 'active');
  const booking = store.createBooking({
    listingId: listing.id,
    fullName: 'Webhook Guest',
    email: 'webhook@example.com',
    phone: '+256700555010',
  });
  booking.paymentStatus = 'pending';
  booking.bookingStatus = 'pending';
  const payload = {
    bookingRef: booking.bookingRef,
    provider: 'mock',
    providerReference: `PAY-${Date.now()}`,
    amount: booking.pricing.total,
    currency: booking.pricing.currency,
    status: 'successful',
    idempotencyKey: `event-${booking.id}`,
  };

  await request(app).post('/api/webhooks/payments').send(payload).expect(401);

  const notificationsBefore = store.state.notifications.length;
  const signature = webhookService.signPayload(payload);
  const first = await request(app)
    .post('/api/webhooks/payments')
    .set('x-classic-trip-signature', signature)
    .send(payload)
    .expect(200);

  expect(first.body.valid).toBe(true);
  expect(first.body.processed).toBe(true);
  expect(booking.paymentStatus).toBe('successful');
  expect(booking.bookingStatus).toBe('confirmed');
  expect(store.state.notifications.length).toBe(notificationsBefore + 2);

  const paymentsAfterFirst = store.state.payments.length;
  const second = await request(app)
    .post('/api/webhooks/payments')
    .set('x-classic-trip-signature', signature)
    .send(payload)
    .expect(200);

  expect(second.body.idempotent).toBe(true);
  expect(store.state.payments.length).toBe(paymentsAfterFirst);
});

test('booking confirmation and refund approval queue customer notifications', async () => {
  const listing = store.state.listings.find((item) => item.bookable && item.serviceType === 'bus' && item.status === 'active');
  const beforeBookingNotifications = store.state.notifications.length;
  const booking = await bookingService.createGuestBooking({
    listingId: listing.id,
    fullName: 'Notify Guest',
    email: 'notify@example.com',
    phone: '+256700555020',
  });

  expect(store.state.notifications.length).toBe(beforeBookingNotifications + 3);
  expect(store.state.notifications.some((item) => item.referenceId === booking.id && item.channel === 'whatsapp')).toBe(true);

  const refund = workflowService.requestRefund({
    bookingRef: booking.bookingRef,
    requesterId: 'user-customer-notify',
    reason: 'Schedule changed',
  });
  const beforeRefundNotifications = store.state.notifications.length;
  workflowService.approveRefund(refund.id, 'admin-notify');

  expect(store.state.notifications.length).toBe(beforeRefundNotifications + 2);
  expect(store.state.notifications.some((item) => item.referenceId === refund.id && item.title.includes('Refund approved'))).toBe(true);
});

test('company CSV report downloads through the protected dashboard route', async () => {
  const company = await login('company@classictrip.test');
  const response = await company.get('/company/reports/bookings.csv').expect(200);

  expect(response.headers['content-type']).toContain('text/csv');
  expect(response.headers['content-disposition']).toContain('company-bookings');
  expect(response.text.split('\n')[0]).toContain('Booking');
});

test('company listing edit and archive routes update marketplace visibility', async () => {
  const agent = await login('company@classictrip.test');
  const listing = await companyService.createListing('company-01', {
    serviceType: 'bus',
    title: `Editable route ${Date.now()}`,
    from: 'Kampala',
    to: 'Gulu',
    priceFrom: 65000,
    status: 'active',
  });

  await agent
    .post(`/company/listings/${listing.id}`)
    .type('form')
    .send({ title: 'Edited Gulu Express', priceFrom: 70000, status: 'active' })
    .expect(302);

  expect(listing.title).toBe('Edited Gulu Express');
  expect(listing.priceFrom).toBe(70000);
  expect(store.searchListings({ q: 'Edited Gulu Express' }).some((item) => item.id === listing.id)).toBe(true);

  await agent.post(`/company/listings/${listing.id}/archive`).type('form').send({}).expect(302);

  expect(listing.status).toBe('archived');
  expect(listing.bookable).toBe(false);
  expect(store.searchListings({ q: 'Edited Gulu Express' }).some((item) => item.id === listing.id)).toBe(false);
});

test('company dashboard route, schedule, and seat forms persist end to end', async () => {
  const agent = await login('company@classictrip.test');
  const listing = await companyService.createListing('company-01', {
    serviceType: 'bus',
    title: `Dashboard bus ${Date.now()}`,
    from: 'Kampala',
    to: 'Arua',
    priceFrom: 62000,
    status: 'active',
  });

  await agent
    .post('/company/routes')
    .type('form')
    .send({ listingId: listing.id, origin: 'Kampala', destination: 'Arua', boardingPoints: 'Namirembe, Bwaise', dropoffPoints: 'Arua Park' })
    .expect(302);

  const route = store.state.routes.find((item) => item.listingId === listing.id && item.origin === 'Kampala' && item.destination === 'Arua');
  expect(route).toBeTruthy();
  const vehicle = await companyService.createVehicle('company-01', {
    listingId: listing.id,
    serviceType: 'bus',
    name: 'Arua Dashboard Coach',
    layoutName: '2x2',
    rows: 2,
  });

  await agent
    .post('/company/schedules')
    .type('form')
    .send({
      routeId: route.id,
      vehicleId: vehicle.id,
      departAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
      totalSeats: 8,
      blockedSeats: 'A1',
      basePrice: 62000,
    })
    .expect(302);

  const schedule = store.state.schedules.find((item) => item.routeId === route.id && item.totalSeats === 8);
  expect(schedule).toBeTruthy();
  expect(schedule.availableSeats).toBe(7);

  await agent
    .post('/company/seats/status')
    .type('form')
    .send({ scheduleId: schedule.id, seatNumber: 'A2', status: 'blocked', seatClass: 'Standard', priceDelta: 0 })
    .expect(302);

  const seat = store.seatsForSchedule(schedule.id).find((item) => item.seatNumber === 'A2');
  expect(seat.status).toBe('blocked');
  expect(schedule.availableSeats).toBe(6);

  await agent.post(`/company/schedules/${schedule.id}`).type('form').send({ basePrice: 64000, status: 'delayed' }).expect(302);
  expect(schedule.basePrice).toBe(64000);
  expect(schedule.status).toBe('delayed');

  await agent.post(`/company/routes/${route.id}`).type('form').send({ origin: 'Kampala Central', destination: 'Arua', status: 'active' }).expect(302);
  expect(route.origin).toBe('Kampala Central');
  expect(listing.from).toBe('Kampala Central');

  const dashboardData = store.dashboardData('company', { companyId: 'company-01' });
  expect(dashboardData.options.routes.some((option) => option.id === route.id)).toBe(true);
  expect(dashboardData.options.schedules.some((option) => option.id === schedule.id)).toBe(true);
  expect(dashboardData.inventory.some((row) => row.at(-1)?.entity === 'schedule' && row.at(-1)?.id === schedule.id)).toBe(true);

  const dashboard = await agent.get('/company/dashboard').expect(200);
  expect(dashboard.text).toContain('/company/seats/status');
  expect(dashboard.text).toContain('/company/reports/inventory.csv');
  expect(dashboard.text).toContain('Create route');
  expect(dashboard.text).toContain('Create vehicle');
  expect(dashboard.text).toContain('Create departure');
  expect(dashboard.text).toContain("name:'imageFile'");
  expect(dashboard.text).toContain('multipart/form-data');
  expect(dashboard.text).toContain("showFor:'hotel'");
  expect(dashboard.text).not.toContain('Route ID');
  expect(dashboard.text).not.toContain('Hotel listing ID');
});

test('company dashboard room forms persist inventory and archive actions end to end', async () => {
  const agent = await login('company@classictrip.test');
  const listing = await companyService.createListing('company-01', {
    serviceType: 'hotel',
    title: `Dashboard hotel ${Date.now()}`,
    city: 'Entebbe',
    priceFrom: 210000,
    status: 'active',
  });

  await agent
    .post('/company/rooms')
    .type('form')
    .send({ listingId: listing.id, roomType: 'Family Suite', capacity: 4, nightlyPrice: 260000, inventory: 3, amenities: 'Wi-Fi, Breakfast' })
    .expect(302);

  const room = store.state.rooms.find((item) => item.listingId === listing.id && item.roomType === 'Family Suite');
  expect(room).toBeTruthy();
  expect(room.inventory).toBe(3);

  await agent
    .post(`/company/rooms/${room.id}/inventory`)
    .type('form')
    .send({ roomType: 'Family Suite Plus', capacity: 5, nightlyPrice: 275000, inventory: 4, amenities: 'Wi-Fi, Breakfast, Parking', status: 'active' })
    .expect(302);

  expect(room.roomType).toBe('Family Suite Plus');
  expect(room.capacity).toBe(5);
  expect(room.inventory).toBe(4);
  expect(room.amenities).toEqual(['Wi-Fi', 'Breakfast', 'Parking']);

  const dashboardData = store.dashboardData('company', { companyId: 'company-01' });
  expect(dashboardData.options.rooms.some((option) => option.id === room.id)).toBe(true);
  expect(dashboardData.inventory.some((row) => row.at(-1)?.entity === 'room' && row.at(-1)?.id === room.id)).toBe(true);

  await agent.post(`/company/rooms/${room.id}/archive`).type('form').send({}).expect(302);
  expect(room.status).toBe('archived');
});

test('company dashboard workflow actions persist settings, payouts, notices, bookings, and review replies', async () => {
  const agent = await login('company@classictrip.test');
  const listing = await companyService.createListing('company-01', {
    serviceType: 'bus',
    title: `Company workflow route ${Date.now()}`,
    from: 'Kampala',
    to: 'Mbale',
    priceFrom: 52000,
    status: 'active',
  });
  const route = await companyService.createRoute('company-01', {
    listingId: listing.id,
    origin: 'Kampala',
    destination: 'Mbale',
  });
  const vehicle = await companyService.createVehicle('company-01', {
    listingId: listing.id,
    serviceType: 'bus',
    name: 'Company Workflow Coach',
    rows: 2,
  });
  await companyService.createSchedule('company-01', {
    routeId: route.id,
    vehicleId: vehicle.id,
    totalSeats: 6,
    basePrice: 52000,
  });

  await agent
    .post('/company/settings')
    .type('form')
    .send({
      name: 'Classic Express Operations',
      companyType: 'bus',
      defaultCurrency: 'UGX',
      payoutAccount: 'Stanbic 2109',
      supportEmail: 'ops@classic.example',
      supportPhone: '+256700123123',
      supportMessage: 'Operations desk support',
    })
    .expect(302);

  const company = store.findCompany('company-01');
  expect(company.name).toBe('Classic Express Operations');
  expect(company.settings.payoutAccount).toBe('Stanbic 2109');
  expect(company.supportContacts.email).toBe('ops@classic.example');

  await agent.post('/company/payouts').type('form').send({ amount: 1000, payoutMethod: 'bank', payoutAccount: 'Stanbic 2109' }).expect(302);
  expect(store.state.walletTransactions.some((txn) => txn.ownerType === 'company' && txn.ownerId === 'company-01' && txn.transactionType === 'withdrawal_request')).toBe(true);

  await agent.post('/company/support/notices').type('form').send({ audience: 'Customers', priority: 'High', message: 'Boarding gate moved to lane 2' }).expect(302);
  const notice = store.state.supportTickets.find((ticket) => ticket.companyId === 'company-01' && ticket.message === 'Boarding gate moved to lane 2');
  expect(notice).toBeTruthy();

  await agent.post('/company/bookings').type('form').send({ listingId: listing.id, fullName: 'Company Desk Guest', email: 'company-desk@example.com', phone: '+256700555100' }).expect(302);
  const deskBooking = store.state.bookings.find((booking) => booking.guestSnapshot?.email === 'company-desk@example.com');
  expect(deskBooking.source).toBe('employee_manual');

  await bookingService.validateTicket(deskBooking.qrCodeValue, 'employee-company-review');
  const review = workflowService.createReview({
    bookingRef: deskBooking.bookingRef,
    customerUserId: 'user-company-review',
    rating: 5,
    comment: 'Desk booking was smooth',
  });
  await agent.post(`/company/reviews/${review.id}/reply`).type('form').send({ reply: 'Thank you for travelling with us.', status: 'replied' }).expect(302);
  expect(review.companyReply.message).toBe('Thank you for travelling with us.');

  const customReport = await agent.post('/company/reports/custom').type('form').send({ type: 'support' }).expect(200);
  expect(customReport.headers['content-type']).toContain('text/csv');
});

test('employee dashboard workflow actions persist bookings, inventory, payments, refunds, support, handovers, profile, and reports', async () => {
  const agent = await login('employee@classictrip.test');
  const listing = await companyService.createListing('company-01', {
    serviceType: 'bus',
    title: `Employee workflow route ${Date.now()}`,
    from: 'Kampala',
    to: 'Hoima',
    priceFrom: 48000,
    status: 'active',
  });
  const route = await companyService.createRoute('company-01', {
    listingId: listing.id,
    origin: 'Kampala',
    destination: 'Hoima',
  });
  const vehicle = await companyService.createVehicle('company-01', {
    listingId: listing.id,
    serviceType: 'bus',
    name: 'Employee Workflow Coach',
    rows: 2,
  });
  const { schedule } = await companyService.createSchedule('company-01', {
    routeId: route.id,
    vehicleId: vehicle.id,
    totalSeats: 6,
    basePrice: 48000,
  });

  await agent.post('/employee/bookings').type('form').send({
    listingId: listing.id,
    scheduleId: schedule.id,
    seatNumber: 'A1',
    fullName: 'Employee Desk Guest',
    email: 'employee-desk@example.com',
    phone: '+256700555200',
  }).expect(302);
  const booking = store.state.bookings.find((item) => item.guestSnapshot?.email === 'employee-desk@example.com');
  expect(booking).toBeTruthy();
  expect(booking.source).toBe('employee_manual');

  await agent.post('/employee/inventory').type('form').send({ scheduleId: schedule.id, seatNumber: 'A2', status: 'blocked' }).expect(302);
  expect(store.seatsForSchedule(schedule.id).find((seat) => seat.seatNumber === 'A2').status).toBe('blocked');

  await agent.post('/employee/schedules/delay').type('form').send({ scheduleId: schedule.id, priority: 'high', message: 'Departure delayed by 20 minutes' }).expect(302);
  expect(schedule.status).toBe('delayed');

  await agent.post('/employee/payments').type('form').send({ bookingRef: booking.bookingRef, method: 'cash', amount: 48000, status: 'successful' }).expect(302);
  expect(store.state.payments.some((payment) => payment.bookingRef === booking.bookingRef && payment.provider === 'cash')).toBe(true);

  await agent.post('/employee/refunds').type('form').send({ bookingRef: booking.bookingRef, amount: 12000, reason: 'Customer requested partial refund' }).expect(302);
  expect(store.state.refundRequests.some((refund) => refund.bookingRef === booking.bookingRef && refund.companyId === 'company-01')).toBe(true);

  await agent.post('/employee/support/notice').type('form').send({ bookingRef: booking.bookingRef, priority: 'normal', message: 'Customer should arrive 30 minutes before departure' }).expect(302);
  expect(store.state.supportTickets.some((ticket) => ticket.companyId === 'company-01' && ticket.message === 'Customer should arrive 30 minutes before departure')).toBe(true);

  await agent.post('/employee/handovers').type('form').send({ shift: 'Morning shift', nextStaff: 'Evening team', note: 'A2 is blocked pending manager review.' }).expect(302);
  expect(store.state.shiftHandovers.some((handover) => handover.note === 'A2 is blocked pending manager review.')).toBe(true);

  await agent.post('/employee/profile').type('form').send({ fullName: 'Gate Scanner Updated', roleTitle: 'Ticket Checker', branch: 'Kampala Gate', shift: 'Morning shift', notes: 'Updated from test' }).expect(302);
  expect(store.state.users.find((user) => user.id === 'user-employee-001').fullName).toBe('Gate Scanner Updated');

  const report = await agent.get('/employee/reports/checkins.csv').expect(200);
  expect(report.headers['content-type']).toContain('text/csv');
  expect(report.text.split('\n')[0]).toContain('Booking');
});
