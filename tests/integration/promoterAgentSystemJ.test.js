const request = require('supertest');
const app = require('../../src/app');
const store = require('../../src/services/data/persistentStore');
const networkService = require('../../src/services/promoter/promoterNetworkService');

async function login(email) {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ identity: email, password: 'Password123' }).expect(302);
  return agent;
}

function nextAvailableSeat(scheduleId = 'schedule-0001') {
  return store.state.seats.find((seat) => seat.scheduleId === scheduleId && seat.status === 'available')?.seatNumber || 'J9';
}

describe('Master section J - Promoter and agent system', () => {
  test('J is end-to-end: profiles, referral links/cards, clicks, attribution, conversions, commissions, withdrawals, offline sales, fraud review, and reports', async () => {
    const promoter = await login('samuel@classictrip.test');

    await promoter.post('/promoter/agent-profile').type('form').send({
      officeName: 'Section J terminal desk',
      location: 'Kampala terminal',
      permissions: 'offline_sales,referral_links,campaigns',
      payoutMethod: 'mobile_money',
      payoutAccount: '+256700111222',
      offlineSalesEnabled: 'true',
    }).expect(302);
    expect(store.state.agentProfiles.find((row) => row.userId === 'user-promoter-001' && row.offlineSalesEnabled === true)).toBeTruthy();

    await promoter.post('/promoter/links').type('form').send({
      listingId: 'bus-001',
      code: `SECJ-${Date.now()}`,
      sourceChannel: 'whatsapp',
      audience: 'terminal passengers',
      shareTitle: 'Section J referral',
      shareText: 'Book this Classic Trip route',
    }).expect(302);
    const link = store.state.promoterLinks.find((row) => row.code.startsWith('SECJ-'));
    expect(link).toBeTruthy();
    expect(link.sourceChannel).toBe('whatsapp');

    const qrPage = await promoter.get(`/promoter/links/${link.id}/qr-card`).expect(200);
    expect(qrPage.text).toContain('Classic Trip Promoter QR Referral Card');
    expect(qrPage.text).toContain(link.code);
    expect(link.qrCardUrl).toContain('/qr-card');

    networkService.recordClick({ code: link.code, listingId: 'bus-001', req: { ip: '127.0.0.1', headers: { 'user-agent': 'jest-section-j' }, originalUrl: `/listings/bus/demo?ref=${link.code}`, sessionID: 'section-j-session' } });
    expect(store.state.referralClicks.find((row) => row.code === link.code)).toBeTruthy();
    expect(store.state.attributionSessions.find((row) => row.referralCode === link.code && row.status === 'active')).toBeTruthy();

    const booking = store.createBooking({
      listingId: 'bus-001',
      scheduleId: 'schedule-0001',
      seatNumber: nextAvailableSeat(),
      fullName: 'Section J Referral Customer',
      email: `section-j-${Date.now()}@classictrip.test`,
      phone: '+256700333444',
      ref: link.code,
    });
    expect(booking.promoterAttribution.promoterId).toBe('user-promoter-001');
    expect(store.state.campaignConversions.find((row) => row.bookingRef === booking.bookingRef && row.promoterId === 'user-promoter-001')).toBeTruthy();
    expect(store.state.commissions.find((row) => row.bookingId === booking.id && row.promoterId === 'user-promoter-001')).toBeTruthy();

    await promoter.post('/promoter/withdrawals').type('form').send({ amount: '1000', payoutMethod: 'mobile_money', payoutAccount: '+256700111222' }).expect(302);
    expect(store.state.payoutRequests.find((row) => row.ownerType === 'promoter' && row.ownerId === 'user-promoter-001')).toBeTruthy();

    await promoter.post('/promoter/offline-sales').type('form').send({
      listingId: 'bus-001',
      scheduleId: 'schedule-0001',
      seatNumber: nextAvailableSeat(),
      customerName: 'Section J Offline Customer',
      passengerName: 'Section J Offline Passenger',
      phone: '+256700555666',
      email: `section-j-offline-${Date.now()}@classictrip.test`,
      paymentMethod: 'cash',
      amountCollected: '91000',
      paymentReference: 'SEC-J-CASH',
      agentLocation: 'Kampala terminal',
    }).expect(302);
    const sale = store.state.offlineSales.find((row) => row.paymentReference === 'SEC-J-CASH');
    expect(sale).toBeTruthy();
    expect(store.findBooking(sale.bookingRef).bookingChannel).toBe('agent_offline');

    const riskyBooking = store.createBooking({
      listingId: 'bus-001',
      scheduleId: 'schedule-0001',
      seatNumber: nextAvailableSeat(),
      customerUserId: 'user-promoter-001',
      fullName: 'Self Referral Customer',
      email: 'samuel@classictrip.test',
      phone: '+256700000003',
      promoterAttribution: { promoterId: 'user-promoter-001', linkId: link.id, code: link.code },
      agentSale: true,
    });
    expect(store.state.fraudSignals.find((row) => row.bookingRef === riskyBooking.bookingRef && row.severity === 'high')).toBeTruthy();

    const admin = await login('admin@classictrip.test');
    const signal = store.state.fraudSignals.find((row) => row.bookingRef === riskyBooking.bookingRef);
    await admin.post(`/admin/fraud-signals/${signal.id}/review`).type('form').send({ status: 'resolved', resolution: 'Approved after manual Section J review' }).expect(302);
    expect(store.state.fraudSignals.find((row) => row.id === signal.id).status).toBe('resolved');

    await admin.get('/admin/reports/referral-clicks.csv').expect(200).expect((res) => expect(res.text).toContain('Click,Code,Promoter,Listing'));
    await admin.get('/admin/reports/attribution-sessions.csv').expect(200).expect((res) => expect(res.text).toContain('Session,Code,Promoter,Listing'));
    await admin.get('/admin/reports/campaign-conversions.csv').expect(200).expect((res) => expect(res.text).toContain('Conversion,Campaign,Promoter,Booking'));
    await admin.get('/admin/reports/agent-profiles.csv').expect(200).expect((res) => expect(res.text).toContain('Profile,User,Agent code'));
    await admin.get('/admin/reports/fraud-signals.csv').expect(200).expect((res) => expect(res.text).toContain('Signal,Promoter/Agent,Booking'));
    await admin.get('/admin/reports/referral-cards.csv').expect(200).expect((res) => expect(res.text).toContain('Link,Promoter,Code,Listing'));

    const promoterCsv = await promoter.get('/promoter/reports/campaign-conversions.csv').expect(200);
    expect(promoterCsv.text).toContain('Conversion,Campaign,Promoter,Booking');
  });
});
