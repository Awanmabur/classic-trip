const request = require('supertest');
const app = require('../../src/app');
const store = require('../../src/services/data/persistentStore');
const authService = require('../../src/services/auth/authService');
const webhookService = require('../../src/services/payment/webhookService');
const securityService = require('../../src/services/security/securityService');

async function login(email) {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ identity: email, password: 'Password123' }).expect(302);
  return agent;
}

describe('Master section M - security and reliability', () => {
  test('M is end-to-end: login/reset secrets are audited, masked, hashed, and device sessions are tracked', async () => {
    const beforeFailures = store.state.loginAudits.length;
    await request(app).post('/login').type('form').send({ identity: 'admin@classictrip.test', password: 'wrong-password' }).expect(302);
    expect(store.state.loginAudits.length).toBeGreaterThan(beforeFailures);
    expect(store.state.loginAudits[0].result).toBe('failure');
    expect(store.state.loginAudits[0].identity).toContain('***');

    const agent = await login('admin@classictrip.test');
    expect(store.state.loginAudits.some((row) => row.userId && row.result === 'success')).toBe(true);
    expect(store.state.deviceSessions.some((row) => row.status === 'active')).toBe(true);

    await agent.post('/logout').type('form').send({}).expect(302);
    expect(store.state.deviceSessions.some((row) => row.status === 'revoked')).toBe(true);

    const reset = await authService.requestPasswordReset('admin@classictrip.test');
    const admin = store.findUserByIdentity('admin@classictrip.test');
    expect(reset.token).toBeTruthy();
    expect(admin.passwordReset.token).toBeUndefined();
    expect(admin.passwordReset.tokenHash).toBe(securityService.sha256(reset.token));
    expect(admin.passwordReset.tokenPreview).toContain('...');
  });

  test('M protects payment webhooks with signatures and idempotency records', async () => {
    const listing = store.state.listings.find((item) => item.bookable && item.status === 'active');
    const booking = store.createBooking({ listingId: listing.id, fullName: 'Security Webhook Guest', email: 'security-webhook@example.com', phone: '+256700999001' });
    booking.paymentStatus = 'pending';
    booking.bookingStatus = 'pending';
    const payload = {
      bookingRef: booking.bookingRef,
      provider: 'mock',
      providerReference: `PAY-M-${Date.now()}`,
      amount: booking.pricing.total,
      currency: booking.pricing.currency,
      status: 'successful',
      idempotencyKey: `section-m-${booking.id}`,
    };

    const securityEventsBefore = store.state.securityEvents.length;
    await request(app).post('/api/webhooks/payments').send(payload).expect(401);
    expect(store.state.securityEvents.length).toBeGreaterThan(securityEventsBefore);
    expect(store.state.securityEvents[0].eventType).toBe('payment_webhook_signature_failed');

    const signature = webhookService.signPayload(payload);
    const first = await request(app).post('/api/webhooks/payments').set('x-classic-trip-signature', signature).send(payload).expect(200);
    expect(first.body.processed).toBe(true);
    const record = store.state.idempotencyKeyRecords.find((row) => row.key === payload.idempotencyKey && row.scope === 'payment_webhook');
    expect(record).toBeTruthy();
    expect(record.status).toBe('completed');

    const second = await request(app).post('/api/webhooks/payments').set('x-classic-trip-signature', signature).send(payload).expect(200);
    expect(second.body.idempotent).toBe(true);
  });

  test('M enforces upload validation and exposes security reports', async () => {
    const company = await login('company@classictrip.test');
    await company
      .post('/company/media')
      .field('target', 'companyLogo')
      .attach('imageFile', Buffer.from('not really an image'), { filename: 'malware.exe', contentType: 'image/png' })
      .expect(415);

    const admin = await login('admin@classictrip.test');
    const loginAuditCsv = await admin.get('/admin/reports/login-audits.csv').expect(200);
    expect(loginAuditCsv.text).toContain('Audit,User/Identity,Role,Result');
    const securityCsv = await admin.get('/admin/reports/security-events.csv').expect(200);
    expect(securityCsv.text).toContain('Event,Type,Severity,Actor');
    const deviceCsv = await admin.get('/admin/reports/device-sessions.csv').expect(200);
    expect(deviceCsv.text).toContain('Session,User,Role,Device fingerprint');
  });

  test('M blocks invalid explicit state transitions and writes a high severity security event', async () => {
    const fakeEntity = { id: 'booking-transition-test', bookingStatus: 'refunded' };
    await expect(securityService.assertStateTransition({
      entity: fakeEntity,
      entityType: 'booking',
      entityId: fakeEntity.id,
      field: 'bookingStatus',
      to: 'checked_in',
      allowed: { refunded: ['archived'] },
      actorId: 'admin-test',
      reason: 'section-m-test',
    })).rejects.toThrow(/Invalid booking/);
    expect(store.state.securityEvents.some((event) => event.eventType === 'invalid_state_transition' && event.severity === 'high')).toBe(true);
  });
});
