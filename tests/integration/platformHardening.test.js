const request = require('supertest');
const app = require('../../src/app');
const store = require('../../src/services/data/persistentStore');
const bookingService = require('../../src/services/booking/bookingService');
const companyService = require('../../src/services/company/companyService');
const billingService = require('../../src/services/billing/billingService');
const webhookService = require('../../src/services/payment/webhookService');
const walletService = require('../../src/services/wallet/walletService');
const workflowService = require('../../src/services/support/workflowService');
const blogService = require('../../src/services/content/blogService');
const scheduler = require('../../src/jobs/scheduler');
const notificationService = require('../../src/services/notification/notificationService');

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
  expect(adminDashboard.text).toContain('Welcome back');
  expect(adminDashboard.text).toContain('Your dashboard is ready');
  expect(adminDashboard.text).not.toContain('Saved successfully');

  const company = await login('company@classictrip.test');
  const companyDashboard = await company.get('/company/dashboard').expect(200);
  expect(companyDashboard.text).toContain('/company/listings');

  const employee = await login('employee@classictrip.test');
  await employee.get('/company/dashboard').expect(403);
  await employee.post('/company/employees/invite').type('form').send({ email: 'blocked@classictrip.test' }).expect(403);
});

test('auth registration provisions role-specific dashboard records', async () => {
  const promoterRes = await request(app)
    .post('/register')
    .type('form')
    .send({
      role: 'promoter',
      firstName: 'Auth',
      lastName: 'Promoter',
      email: 'auth-promoter-e2e@classictrip.test',
      phone: '+256700910001',
      password: 'Password123',
      confirmPassword: 'Password123',
    })
    .expect(302);
  expect(promoterRes.headers.location).toBe('/promoter/dashboard');
  const promoter = store.findUserByIdentity('auth-promoter-e2e@classictrip.test');
  expect(promoter.role).toBe('promoter');
  expect(promoter.referralCode).toBeTruthy();
  expect(promoter.verificationStatus).toBe('pending');
  expect(walletService.getWallet('promoter', promoter.id)).toBeTruthy();

  const companyRes = await request(app)
    .post('/register')
    .type('form')
    .send({
      role: 'partner',
      firstName: 'Auth',
      lastName: 'Owner',
      email: 'auth-company-e2e@classictrip.test',
      phone: '+256700910002',
      password: 'Password123',
      confirmPassword: 'Password123',
      company: 'Auth Partner Transport 18E',
      businessType: 'Bus company',
      country: 'Uganda',
    })
    .expect(302);
  expect(companyRes.headers.location).toBe('/company/dashboard');
  const companyAdmin = store.findUserByIdentity('auth-company-e2e@classictrip.test');
  const company = store.state.companies.find((row) => row.name === 'Auth Partner Transport 18E');
  expect(companyAdmin.role).toBe('company_admin');
  expect(companyAdmin.companyId).toBe(company.id);
  expect(company.ownerId).toBe(companyAdmin.id);
  expect(company.verificationStatus).toBe('pending');
  expect(company.settings.canPublish).toBe(false);
  expect(walletService.getWallet('company', company.id)).toBeTruthy();

  const employeeRes = await request(app)
    .post('/register')
    .type('form')
    .send({
      role: 'employee',
      firstName: 'Auth',
      lastName: 'Employee',
      email: 'auth-employee-e2e@classictrip.test',
      phone: '+256700910003',
      password: 'Password123',
      confirmPassword: 'Password123',
      company: 'Auth Employee Company 18E',
      businessType: 'Hotel / apartments',
      country: 'Uganda',
    })
    .expect(302);
  expect(employeeRes.headers.location).toBe('/employee/dashboard');
  const employee = store.findUserByIdentity('auth-employee-e2e@classictrip.test');
  const employeeCompany = store.state.companies.find((row) => row.name === 'Auth Employee Company 18E');
  expect(employee.role).toBe('company_employee');
  expect(employee.status).toBe('pending');
  expect(employee.companyId).toBe(employeeCompany.id);
  expect(store.state.companyEmployees.some((row) => row.companyId === employeeCompany.id && row.userId === employee.id && row.status === 'requested')).toBe(true);
});

test('Cloudinary media lifecycle is secured and attaches or deletes company, listing, and blog assets', async () => {
  await request(app)
    .post('/api/uploads')
    .field('target', 'blog')
    .attach('file', Buffer.from('image'), { filename: 'guide.png', contentType: 'image/png' })
    .expect(401);

  const admin = await login('admin@classictrip.test');
  const blog = await blogService.ensureBlog({
    title: `Media guide ${Date.now()}`,
    slug: `media-guide-${Date.now()}`,
    status: 'draft',
  });
  const blogUpload = await admin
    .post('/api/uploads')
    .field('target', 'blog')
    .field('blogId', blog.id)
    .field('alt', 'Classic Trip media guide')
    .attach('file', Buffer.from('png'), { filename: 'guide.png', contentType: 'image/png' })
    .expect(201);

  expect(blog.media.publicId).toBe(blogUpload.body.asset.publicId);
  expect(blog.image).toBe(blogUpload.body.asset.secureUrl);

  await admin
    .post('/api/uploads/delete')
    .send({ target: 'blog', blogId: blog.id, publicId: blog.media.publicId, resourceType: blog.media.resourceType })
    .expect(200);
  expect(blog.media).toBeNull();
  expect(blog.image).toBe('');

  const company = await login('company@classictrip.test');
  await company
    .post('/company/media')
    .field('target', 'companyDocument')
    .field('documentType', 'operator_permit')
    .field('documentReference', 'PERMIT-18E')
    .attach('imageFile', Buffer.from('%PDF-1.4 classic trip permit'), { filename: 'permit.pdf', contentType: 'application/pdf' })
    .expect(302);

  const partner = store.findCompany('company-01');
  const document = partner.documents.find((item) => item.documentReference === 'PERMIT-18E');
  expect(document).toBeTruthy();
  expect(document.status).toBe('pending_review');
  expect(document.resourceType).toBe('raw');

  await company
    .post('/company/media/delete')
    .type('form')
    .send({ target: 'companyDocument', publicId: document.publicId })
    .expect(302);
  expect(partner.documents.some((item) => item.publicId === document.publicId)).toBe(false);

  const listing = await companyService.createListing('company-01', {
    serviceType: 'bus',
    title: `Media route ${Date.now()}`,
    from: 'Kampala',
    to: 'Jinja',
    priceFrom: 30000,
    status: 'active',
  });
  const listingUpload = await company
    .post('/api/uploads')
    .field('target', 'busListing')
    .field('targetId', listing.id)
    .attach('file', Buffer.from('bus image'), { filename: 'bus.png', contentType: 'image/png' })
    .expect(201);
  expect(listing.media.some((item) => item.publicId === listingUpload.body.asset.publicId)).toBe(true);

  await company
    .post('/api/uploads/delete')
    .send({ target: 'busListing', targetId: listing.id, publicId: listingUpload.body.asset.publicId })
    .expect(200);
  expect(listing.media.some((item) => item.publicId === listingUpload.body.asset.publicId)).toBe(false);

  await company
    .post('/api/uploads')
    .field('target', 'companyLogo')
    .field('companyId', 'not-company-01')
    .attach('file', Buffer.from('logo'), { filename: 'logo.png', contentType: 'image/png' })
    .expect(403);
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
  expect(store.state.notifications.length).toBe(notificationsBefore + 4);

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

  expect(store.state.notifications.length).toBe(beforeBookingNotifications + 4);
  expect(store.state.notifications.filter((item) => item.referenceId === booking.id).map((item) => item.channel)).toEqual(expect.arrayContaining(['in_app', 'push', 'email', 'whatsapp']));
  expect(store.state.notifications.filter((item) => item.referenceId === booking.id).every((item) => ['queued', 'skipped', 'sent'].includes(item.deliveryStatus))).toBe(true);

  const refund = workflowService.requestRefund({
    bookingRef: booking.bookingRef,
    requesterId: 'user-customer-notify',
    reason: 'Schedule changed',
  });
  const beforeRefundNotifications = store.state.notifications.length;
  workflowService.approveRefund(refund.id, 'admin-notify');

  expect(store.state.notifications.length).toBe(beforeRefundNotifications + 4);
  expect(store.state.notifications.some((item) => item.referenceId === refund.id && item.title.includes('Refund approved'))).toBe(true);
});



test('notification API lists, marks read, and stores browser push subscriptions', async () => {
  const agent = await login('amina@classictrip.test');
  const user = store.findUserByIdentity('amina@classictrip.test');
  const rows = await notificationService.queueNotification({
    userId: user.id,
    channels: ['in_app', 'push'],
    title: 'Customer API notification',
    message: 'Your notification center is connected.',
    recipient: { email: user.email, phone: user.phone, name: user.fullName },
    referenceType: 'test_notification',
    referenceId: 'notification-api-test',
  });

  const config = await agent.get('/api/notifications/config').expect(200);
  expect(config.body.push).toHaveProperty('enabled');

  const list = await agent.get('/api/notifications').expect(200);
  expect(list.body.notifications.some((note) => note.id === rows[0].id)).toBe(true);

  const read = await agent.post(`/api/notifications/${rows[0].id}/read`).send({}).expect(200);
  expect(read.body.notification.readAt).toBeTruthy();

  const subscription = {
    endpoint: `https://push.example.test/${Date.now()}`,
    expirationTime: null,
    keys: { p256dh: 'test-p256dh-key', auth: 'test-auth-key' },
  };
  const saved = await agent.post('/api/notifications/subscribe').send({ subscription }).expect(201);
  expect(saved.body.subscription.id).toContain('push-');
  expect(store.state.pushSubscriptions.some((item) => item.endpoint === subscription.endpoint && item.userId === user.id)).toBe(true);
});
test('seo crawler endpoints expose public catalog URLs and block private areas', async () => {
  const robots = await request(app).get('/robots.txt').expect(200);
  expect(robots.text).toContain('User-agent: Googlebot');
  expect(robots.text).toContain('User-agent: Bingbot');
  expect(robots.text).toContain('User-agent: OAI-SearchBot');
  expect(robots.text).toContain('Disallow: /admin');
  expect(robots.text).toContain('Sitemap: http://localhost:5000/sitemap.xml');

  const sitemap = await request(app).get('/sitemap.xml').expect(200);
  expect(sitemap.text).toContain('<urlset');
  expect(sitemap.text).toContain('/listings/');
  expect(sitemap.text).toContain('/companies/');

  const llms = await request(app).get('/llms.txt').expect(200);
  expect(llms.text).toContain('# Classic Trip');
  expect(llms.text).toContain('/sitemap.xml');
});
test('ticket PDF endpoint returns a real downloadable PDF', async () => {
  const listing = store.state.listings.find((item) => item.bookable && item.serviceType === 'bus' && item.status === 'active');
  const booking = await bookingService.createGuestBooking({
    listingId: listing.id,
    fullName: 'PDF Guest',
    email: 'pdf@example.com',
    phone: '+256700555021',
  });

  const response = await request(app)
    .get(`/tickets/${booking.bookingRef}.pdf?accessCode=${encodeURIComponent(booking.guestLookupCode)}`)
    .buffer(true)
    .parse((res, callback) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    })
    .expect(200);

  expect(response.headers['content-type']).toContain('application/pdf');
  expect(response.headers['content-disposition']).toContain(`${booking.bookingRef}.pdf`);
  expect(response.body.slice(0, 4).toString()).toBe('%PDF');
});

test('scheduled jobs can be registered and run safely', async () => {
  const started = scheduler.startScheduledJobs({ force: true, active: false });
  expect(started.started).toBe(true);
  expect(started.jobs).toContain('cleanupExpiredLocks');

  const result = await scheduler.runJob('cleanupExpiredLocks');
  expect(result.ok).toBe(true);
  expect(result.result).toHaveProperty('seats');
  expect(scheduler.jobStatus().some((job) => job.name === 'cleanupExpiredLocks' && job.scheduled)).toBe(true);
  scheduler.stopScheduledJobs();
});

test('future services stay searchable but not bookable until release is enabled', async () => {
  const roadmap = await request(app).get('/api/listings/release-roadmap').expect(200);
  expect(roadmap.body.launchNow.some((item) => item.key === 'bus')).toBe(true);
  expect(roadmap.body.architectureReady.some((item) => item.key === 'train')).toBe(true);
  expect(roadmap.body.plannedPlatformFeatures.some((item) => item.key === 'mobile_app')).toBe(true);

  const trainResults = await request(app).get('/api/listings?serviceType=train').expect(200);
  expect(trainResults.body.data.length).toBeGreaterThan(0);
  expect(trainResults.body.data.every((item) => item.bookable === false)).toBe(true);
});

test('company CSV report downloads through the protected dashboard route', async () => {
  const company = await login('company@classictrip.test');
  const response = await company.get('/company/reports/bookings.csv').expect(200);

  expect(response.headers['content-type']).toContain('text/csv');
  expect(response.headers['content-disposition']).toContain('company-bookings');
  expect(response.text.split('\n')[0]).toContain('Booking');
});

test('partner onboarding selects a plan, pays, and activates subscription end to end', async () => {
  const suffix = Date.now();
  const plans = await request(app).get('/pricing').expect(200);
  expect(plans.text).toContain('/partner/onboarding?plan=growth');

  const onboarding = await request(app)
    .post('/partner/onboarding')
    .type('form')
    .send({
      planId: 'growth',
      contactName: 'Billing Owner',
      email: `billing-owner-${suffix}@classictrip.test`,
      phone: '+256700555300',
      name: `Billing Partner ${suffix}`,
      companyType: 'bus',
      country: 'Uganda',
      city: 'Kampala',
      description: 'Regional coach operator onboarding through billing checkout',
    })
    .expect(302);

  expect(onboarding.headers.location).toMatch(/^\/billing\/checkout\/CTPLAN-/);
  const orderRef = onboarding.headers.location.split('/').pop();
  const checkout = await request(app).get(onboarding.headers.location).expect(200);
  expect(checkout.text).toContain(orderRef);
  expect(checkout.text).toContain('Pay UGX 249,000');

  const paid = await request(app)
    .post(`/billing/checkout/${orderRef}/pay`)
    .type('form')
    .send({ provider: 'mock', paymentMethod: 'Mobile Money', paymentReference: '+256700555300' })
    .expect(302);

  expect(paid.headers.location).toBe(`/billing/success/${orderRef}`);
  const success = await request(app).get(paid.headers.location).expect(200);
  expect(success.text).toContain('Your partner plan is active');

  const order = billingService.findOrder(orderRef);
  const subscription = billingService.activeSubscription(order.companyId);
  const company = store.findCompany(order.companyId);
  expect(order.paymentStatus).toBe('successful');
  expect(subscription.planId).toBe('growth');
  expect(company.settings.subscription.planName).toBe('Growth');
  expect(store.state.subscriptionOrders.some((row) => row.orderRef === orderRef && row.status === 'active')).toBe(true);
  expect(store.state.subscriptions.some((row) => row.orderRef === orderRef && row.status === 'active')).toBe(true);
  expect(store.state.payments.some((payment) => payment.bookingRef === orderRef && payment.metadata?.referenceType === 'subscription_order')).toBe(true);
});

test('signed payment webhook can activate a pending subscription order', async () => {
  const suffix = Date.now();
  const { order } = await billingService.createOnboardingOrder({
    planId: 'starter',
    contactName: 'Webhook Billing',
    email: `billing-webhook-${suffix}@classictrip.test`,
    phone: '+256700555301',
    name: `Webhook Billing Partner ${suffix}`,
    companyType: 'hotel',
    country: 'Uganda',
    city: 'Entebbe',
  });
  const payload = {
    orderRef: order.orderRef,
    provider: 'mock',
    providerReference: `SUB-${suffix}`,
    amount: order.amount,
    currency: order.currency,
    status: 'successful',
    idempotencyKey: `sub-event-${order.id}`,
  };
  const signature = webhookService.signPayload(payload);

  const response = await request(app)
    .post('/api/webhooks/payments')
    .set('x-classic-trip-signature', signature)
    .send(payload)
    .expect(200);

  expect(response.body.valid).toBe(true);
  expect(response.body.processed).toBe(true);
  expect(billingService.activeSubscription(order.companyId).planId).toBe('starter');
  expect(billingService.findOrder(order.orderRef).paymentStatus).toBe('successful');
});

test('company billing upgrade creates a checkout order and activates upgraded plan', async () => {
  const agent = await login('company@classictrip.test');
  const dashboard = await agent.get('/company/dashboard').expect(200);
  expect(dashboard.text).toContain('Plans & Billing');
  expect(dashboard.text).toContain('/company/billing/upgrade');

  const upgrade = await agent
    .post('/company/billing/upgrade')
    .type('form')
    .send({ planId: 'scale' })
    .expect(302);

  expect(upgrade.headers.location).toMatch(/^\/billing\/checkout\/CTPLAN-/);
  const orderRef = upgrade.headers.location.split('/').pop();
  await agent.get(upgrade.headers.location).expect(200);
  await agent
    .post(`/billing/checkout/${orderRef}/pay`)
    .type('form')
    .send({ provider: 'mock', paymentMethod: 'Card', paymentReference: '4242' })
    .expect(302);

  const subscription = billingService.activeSubscription('company-01');
  expect(subscription.planId).toBe('scale');
  expect(store.findCompany('company-01').settings.subscription.planName).toBe('Scale');
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
      blockedSeats: '1',
      basePrice: 62000,
    })
    .expect(302);

  const schedule = store.state.schedules.find((item) => item.routeId === route.id && item.totalSeats === 8);
  expect(schedule).toBeTruthy();
  expect(schedule.availableSeats).toBe(7);

  await agent
    .post('/company/seats/status')
    .type('form')
    .send({ scheduleId: schedule.id, seatNumber: '2', status: 'blocked', seatClass: 'Standard', priceDelta: 0 })
    .expect(302);

  const seat = store.seatsForSchedule(schedule.id).find((item) => item.seatNumber === '2');
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

  const qr = await agent.get(`/company/bookings/${deskBooking.bookingRef}/qr.svg`).expect(200);
  expect(qr.headers['content-type']).toContain('image/svg+xml');
  expect((qr.text || qr.body.toString())).toContain('<svg');

  const lookup = await agent
    .post('/company/scanner/lookup')
    .set('Accept', 'application/json')
    .type('form')
    .send({ qrCodeValue: deskBooking.qrCodeValue })
    .expect(200);
  expect(lookup.body.canCheckIn).toBe(true);

  await agent
    .post('/company/scanner/validate')
    .set('Accept', 'application/json')
    .type('form')
    .send({ qrCodeValue: deskBooking.qrCodeValue, note: 'Company scanner test' })
    .expect(200);
  expect(deskBooking.bookingStatus).toBe('checked_in');

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
  const dashboard = await agent.get('/employee/dashboard').expect(200);
  expect(dashboard.text).toContain('Your staff workspace is ready');
  expect(dashboard.text).toContain('/employee/bookings');
  expect(dashboard.text).toContain('/employee/support/notice');
  expect(dashboard.text).toContain('/employee/handovers');
  expect(dashboard.text).toContain('id="handover"');
  expect(dashboard.text).toContain('id="profile"');
  expect(dashboard.text).toContain('id="employeeHandoversTable"');
  expect(dashboard.text).toContain('id="driver-ops"');
  expect(dashboard.text).toContain('id="driver-manifest"');
  expect(dashboard.text).toContain('id="driver-incidents"');
  expect(dashboard.text).toContain('id="driverManifestTable"');
  expect(dashboard.text).not.toContain('/admin/finance/release-eligible');
  expect(dashboard.text).not.toContain('Saved successfully');
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
    seatNumber: '1',
    fullName: 'Employee Desk Guest',
    email: 'employee-desk@example.com',
    phone: '+256700555200',
  }).expect(302);
  const booking = store.state.bookings.find((item) => item.guestSnapshot?.email === 'employee-desk@example.com');
  expect(booking).toBeTruthy();
  expect(booking.source).toBe('employee_manual');

  await agent.post('/employee/inventory').type('form').send({ scheduleId: schedule.id, seatNumber: '2', status: 'blocked' }).expect(302);
  expect(store.seatsForSchedule(schedule.id).find((seat) => seat.seatNumber === '2').status).toBe('blocked');

  await agent.post('/employee/schedules/delay').type('form').send({ scheduleId: schedule.id, priority: 'high', message: 'Departure delayed by 20 minutes' }).expect(302);
  expect(schedule.status).toBe('delayed');

  await agent.post('/employee/payments').type('form').send({ bookingRef: booking.bookingRef, method: 'cash', amount: 48000, status: 'successful' }).expect(302);
  expect(store.state.payments.some((payment) => payment.bookingRef === booking.bookingRef && payment.provider === 'cash')).toBe(true);

  await agent.post('/employee/refunds').type('form').send({ bookingRef: booking.bookingRef, amount: 12000, reason: 'Customer requested partial refund' }).expect(302);
  expect(store.state.refundRequests.some((refund) => refund.bookingRef === booking.bookingRef && refund.companyId === 'company-01')).toBe(true);

  await agent.post('/employee/support/notice').type('form').send({ bookingRef: booking.bookingRef, priority: 'normal', message: 'Customer should arrive 30 minutes before departure' }).expect(302);
  expect(store.state.supportTickets.some((ticket) => ticket.companyId === 'company-01' && ticket.message === 'Customer should arrive 30 minutes before departure')).toBe(true);

  await agent.post('/employee/handovers').type('form').send({ shift: 'Morning shift', nextStaff: 'Evening team', note: '2 is blocked pending manager review.' }).expect(302);
  expect(store.state.shiftHandovers.some((handover) => handover.note === '2 is blocked pending manager review.')).toBe(true);

  await agent.post('/employee/profile').type('form').send({ fullName: 'Gate Scanner Updated', roleTitle: 'Ticket Checker', branch: 'Kampala Gate', shift: 'Morning shift', notes: 'Updated from test' }).expect(302);
  expect(store.state.users.find((user) => user.id === 'user-employee-001').fullName).toBe('Gate Scanner Updated');

  const employeeProfile = store.state.companyEmployees.find((item) => item.companyId === 'company-01' && item.userId === 'user-employee-001');
  const assignmentsBefore = {
    roleTitle: employeeProfile.roleTitle,
    branch: employeeProfile.branch,
    permissions: [...(employeeProfile.permissions || [])],
  };
  await agent.post('/employee/profile').type('form').send({
    fullName: 'Gate Scanner Secure',
    roleTitle: 'Finance Staff',
    branch: 'Head office',
    permissions: 'approve_refunds,edit_prices,manage_staff',
    shift: 'Evening shift',
    notes: 'Attempted self-assignment change',
  }).expect(302);
  expect(store.state.users.find((user) => user.id === 'user-employee-001').fullName).toBe('Gate Scanner Secure');
  expect(employeeProfile.roleTitle).toBe(assignmentsBefore.roleTitle);
  expect(employeeProfile.branch).toBe(assignmentsBefore.branch);
  expect(employeeProfile.permissions).toEqual(assignmentsBefore.permissions);

  const report = await agent.get('/employee/reports/checkins.csv').expect(200);
  expect(report.headers['content-type']).toContain('text/csv');
  expect(report.text.split('\n')[0]).toContain('Booking');
});

test('customer dashboard actions persist saved trips wallet security and promoter onboarding', async () => {
  const user = store.upsertUser({
    id: 'user-customer-dashboard-e2e',
    role: 'customer',
    fullName: 'Dashboard Customer',
    email: 'dashboard-customer@classictrip.test',
    phone: '+256700555801',
    status: 'active',
    isVerified: true,
  });
  const listing = store.state.listings.find((item) => item.bookable && item.status === 'active');
  const agent = await login(user.email);
  const customerDashboard = await agent.get('/account').expect(200);
  expect(customerDashboard.text).toContain('id="passengers"');
  expect(customerDashboard.text).toContain('id="customer-profile"');
  expect(customerDashboard.text).toContain('id="customerPassengersTable"');
  expect(customerDashboard.text).toContain('id="customerWalletTable"');
  expect(customerDashboard.text).toContain('id="customerSupportTable"');
  expect(customerDashboard.text).toContain('/account/profile');

  await agent.post('/account/saved').type('form').send({ listingId: listing.id, notes: 'Save for later' }).expect(302);
  expect(store.state.savedListings.some((row) => row.userId === user.id && row.listingId === listing.id)).toBe(true);

  // Top-ups must never credit spendable balance directly from a client-supplied amount — that
  // would let anyone mint their own wallet funds. It should only create a pending request that
  // finance/admin must approve before the balance moves.
  const beforeWallet = walletService.getOrCreateWallet('customer', user.id).availableBalance;
  const beforePending = walletService.getWallet('customer', user.id).pendingBalance;
  await agent.post('/account/wallet/top-up').type('form').send({ amount: 12345, currency: 'UGX', method: 'mobile_money', paymentReference: 'TEST-TOPUP-1' }).expect(302);
  expect(walletService.getWallet('customer', user.id).availableBalance).toBe(beforeWallet);
  expect(walletService.getWallet('customer', user.id).pendingBalance).toBe(beforePending + 12345);

  const topUpRequest = store.state.walletTransactions.find((txn) => txn.transactionType === 'wallet_top_up_request' && txn.ownerId === user.id);
  expect(topUpRequest.status).toBe('pending');
  walletService.reviewTopUpRequest(topUpRequest.id, 'approved', 'admin-test');
  expect(walletService.getWallet('customer', user.id).availableBalance).toBe(beforeWallet + 12345);

  await agent.post('/account/security').type('form').send({ twoFactorEnabled: 'on', loginAlertsEnabled: 'on', recoveryEmail: 'recovery@example.com' }).expect(302);
  expect(user.twoFactorEnabled).toBe(true);
  expect(user.recoveryEmail).toBe('recovery@example.com');

  await agent.post('/account/promoter').type('form').send({ referralCode: 'DASH-18E', payoutMethod: 'Mobile Money', payoutAccount: '+256700555801' }).expect(302);
  expect(user.role).toBe('promoter');
  expect(user.referralCode).toBe('DASH-18E');
  expect(walletService.getWallet('promoter', user.id)).toBeTruthy();
  await agent.get('/promoter/dashboard').expect(200);
});

test('promoter dashboard campaign and verification forms persist to dashboard data', async () => {
  const promoter = store.state.users.find((item) => item.email === 'samuel@classictrip.test') || store.upsertUser({
    id: 'user-promoter-dashboard-e2e',
    role: 'promoter',
    fullName: 'Dashboard Promoter',
    email: 'dashboard-promoter@classictrip.test',
    phone: '+256700555802',
    status: 'active',
    isVerified: true,
    referralCode: 'DASHPROMO',
  });
  const listing = store.state.listings.find((item) => item.bookable && item.status === 'active');
  const agent = await login(promoter.email);
  const promoterDashboard = await agent.get('/promoter/dashboard').expect(200);
  expect(promoterDashboard.text).toContain('id="links"');
  expect(promoterDashboard.text).toContain('id="withdrawals"');
  expect(promoterDashboard.text).toContain('id="promoter-profile"');
  expect(promoterDashboard.text).toContain('id="promoterCommissionsTable"');
  expect(promoterDashboard.text).toContain('id="promoterWithdrawalsTable"');

  await agent.post('/promoter/campaigns').type('form').send({ listingId: listing.id, name: 'Promoter 18E campaign', placement: 'social', budget: 50000 }).expect(302);
  expect(store.state.promotionCampaigns.some((row) => row.promoterId === promoter.id && row.name === 'Promoter 18E campaign')).toBe(true);

  await agent.post('/promoter/verification').type('form').send({ documentType: 'national_id', documentReference: 'NIN-18E', payoutMethod: 'Mobile Money', payoutAccount: '+256700555802' }).expect(302);
  expect(promoter.verificationStatus).toBe('pending');
  expect(promoter.verificationReference).toBe('NIN-18E');
  expect(promoter.payoutAccount.account).toBe('+256700555802');
});

test('admin dashboard actions create operational records and exports', async () => {
  const agent = await login('admin@classictrip.test');
  const dashboard = await agent.get('/admin/dashboard').expect(200);
  expect(dashboard.text).toContain('data-type="bus listing"');
  expect(dashboard.text).toContain('data-type="event listing"');
  const listing = store.state.listings.find((item) => item.bookable && item.status === 'active');
  const wallet = walletService.creditAvailable('promoter', 'user-promoter-001', 25000, { currency: 'UGX', referenceType: 'test_seed', referenceId: 'admin-payout-e2e' });
  const withdrawal = walletService.requestWithdrawal('promoter', 'user-promoter-001', 1000, { currency: wallet.currency, referenceType: 'withdrawal', referenceId: 'admin-payout-e2e' }).transaction;

  await agent.post('/admin/listings').type('form').send({ companyId: 'company-01', title: 'Admin event category listing', serviceType: 'event', from: 'Kampala', to: 'Expo Hall', priceFrom: 120000 }).expect(302);
  expect(store.state.listings.some((row) => row.title === 'Admin event category listing' && row.serviceType === 'event')).toBe(true);

  await agent.post('/admin/promotions').type('form').send({ listingId: listing.id, name: 'Admin 18E campaign', placement: 'marketplace_top', budget: 75000 }).expect(302);
  expect(store.state.promotionCampaigns.some((row) => row.name === 'Admin 18E campaign')).toBe(true);

  await agent.post('/admin/notices').type('form').send({ audience: 'customers', priority: 'high', message: 'Admin dashboard notice test' }).expect(302);
  expect(store.state.supportTickets.some((row) => row.category === 'platform_notice' && row.message === 'Admin dashboard notice test')).toBe(true);

  await agent.post('/admin/admin-users').type('form').send({ fullName: 'Finance 18E', email: 'finance-e2e@classictrip.test', role: 'finance_admin' }).expect(302);
  expect(store.state.users.some((row) => row.email === 'finance-e2e@classictrip.test' && row.role === 'finance_admin')).toBe(true);

  await agent.post('/admin/payouts/run').type('form').send({ transactionId: withdrawal.id, note: '18E payout run' }).expect(302);
  expect(withdrawal.status).toBe('completed');

  await agent.post('/admin/settings').type('form').send({ platformFeePercent: 8, promoterCommissionPercent: 4, partnerPayoutPercent: 88, holdMinutes: 12, defaultCurrency: 'UGX' }).expect(302);
  expect(store.state.platformSettings.financeRules.platformFeePercent).toBe(8);

  const report = await agent.post('/admin/reports/custom').type('form').send({ type: 'support' }).expect(200);
  expect(report.headers['content-type']).toContain('text/csv');
  expect(report.text.split('\n')[0]).toContain('Case');
});

