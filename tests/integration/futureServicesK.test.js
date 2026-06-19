const request = require('supertest');
const app = require('../../src/app');
const store = require('../../src/services/data/persistentStore');
const futureServiceArchitecture = require('../../src/services/release/futureServiceArchitecture');

async function login(email) {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ identity: email, password: 'Password123' }).expect(302);
  return agent;
}

describe('Master section K - future services architecture', () => {
  test('K is end-to-end: all future modules are architecture-ready, read-only, reported, and guarded from checkout', async () => {
    const modules = futureServiceArchitecture.modules();
    const keys = modules.map((module) => module.key);
    expect(keys).toEqual(expect.arrayContaining(['flight', 'train', 'tour', 'car_rental', 'event', 'cargo', 'insurance', 'corporate_travel', 'loyalty']));

    const flight = futureServiceArchitecture.findModule('flight');
    expect(flight.entities).toEqual(expect.arrayContaining(['airline', 'airport', 'flight_offer', 'flight_segment', 'pnr', 'passenger', 'baggage', 'ancillary', 'booking', 'payment', 'ticket', 'refund', 'notification', 'support']));
    expect(flight.checkoutEnabled).toBe(false);

    expect(futureServiceArchitecture.findModule('train').entities).toEqual(expect.arrayContaining(['station', 'route', 'coach', 'seat', 'schedule', 'ticket', 'check_in', 'boarding', 'manifest']));
    expect(futureServiceArchitecture.findModule('tour').entities).toEqual(expect.arrayContaining(['package', 'tour_date', 'capacity', 'guide', 'pickup_point', 'participant', 'voucher', 'check_in']));
    expect(futureServiceArchitecture.findModule('car_rental').entities).toEqual(expect.arrayContaining(['vehicle', 'location', 'availability', 'driver_option', 'renter_documents', 'deposit', 'pickup', 'return', 'inspection', 'damage']));
    expect(futureServiceArchitecture.findModule('event').entities).toEqual(expect.arrayContaining(['venue', 'event', 'ticket_tier', 'seat_map', 'qr_entry', 'promoter_link']));
    expect(futureServiceArchitecture.findModule('cargo').entities).toEqual(expect.arrayContaining(['shipment', 'sender', 'receiver', 'route', 'waybill', 'tracking', 'payment', 'delivery_proof']));
    expect(futureServiceArchitecture.findModule('insurance').entities).toEqual(expect.arrayContaining(['policy', 'coverage', 'premium', 'beneficiary', 'claim_link']));
    expect(futureServiceArchitecture.findModule('corporate_travel').entities).toEqual(expect.arrayContaining(['company_account', 'employee_traveler', 'approval_workflow', 'monthly_invoice', 'travel_policy']));
    expect(futureServiceArchitecture.findModule('loyalty').entities).toEqual(expect.arrayContaining(['points', 'wallet_credit', 'coupon', 'tier', 'referral_reward']));

    const futureListing = store.state.listings.find((listing) => listing.serviceType === 'flight' && listing.bookable === false);
    expect(futureListing).toBeTruthy();

    const bookingPage = await request(app).get(`/book/${futureListing.serviceType}/${futureListing.slug}`).expect(409);
    expect(bookingPage.text).toContain('Coming soon / read-only');
    expect(bookingPage.text).toContain('Flights');

    expect(() => store.createBooking({ listingId: futureListing.id, fullName: 'Section K Customer', email: 'section-k@classictrip.test', phone: '+256700999000' })).toThrow(/not currently open for booking|not fully bookable|coming soon/i);

    const publicJson = await request(app).get('/future-services.json').expect(200);
    expect(publicJson.body.modules.length).toBeGreaterThanOrEqual(9);
    expect(publicJson.body.modules.find((module) => module.key === 'cargo').checkoutEnabled).toBe(false);

    const detailPage = await request(app).get('/future-services/cargo').expect(200);
    expect(detailPage.text).toContain('waybill');
    expect(detailPage.text).toContain('delivery_proof');

    const admin = await login('admin@classictrip.test');
    const adminJson = await admin.get('/admin/future-services.json').expect(200);
    expect(adminJson.body.status).toBe('section-k-architecture-ready');
    expect(adminJson.body.checkoutEnabledServices).toEqual(['bus', 'hotel']);
    expect(adminJson.body.futureServices.find((module) => module.key === 'loyalty').bookable).toBe(false);

    await admin.get('/admin/reports/future-services.csv').expect(200).expect((res) => {
      expect(res.text).toContain('Service,Label,Release status,Bookable,Entities,Workflows,Readiness checklist');
      expect(res.text).toContain('corporate_travel');
      expect(res.text).toContain('loyalty');
    });
  });
});
