const request = require('supertest');
const app = require('../../src/app');
const store = require('../../src/services/data/persistentStore');

function ensureUser(user) {
  const existing = store.state.users.find((item) => item.email === user.email || item.id === user.id);
  if (existing) return existing;
  store.state.users.push({ status: 'active', isVerified: true, ...user });
  return user;
}

async function login(email) {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ identity: email, password: 'Password123' }).expect(302);
  return agent;
}

describe('company dashboard route smoke tests', () => {
  test('bus company dashboard pages render without server errors and keep bus scope', async () => {
    const bus = await login('company@classictrip.test');
    const pages = [
      '/company/dashboard',
      '/company/bus-listings',
      '/company/routes-stops',
      '/company/vehicles',
      '/company/schedules-fares',
      '/company/seat-maps',
      '/company/passenger-manifests',
      '/company/boarding-checkins',
      '/company/revenue',
      '/company/settlement',
      '/company/reports',
    ];

    for (const page of pages) {
      const response = await bus.get(page).expect(200);
      expect(response.text).toContain('Classic Trip');
      expect(response.text).not.toContain('ReferenceError');
      expect(response.text).not.toContain('Use the marketplace navigation to continue.');
    }

    const seatMaps = await bus.get('/company/seat-maps').expect(200);
    expect(seatMaps.text).toContain('Seat Maps');
    expect(seatMaps.text).toContain('Visual seat preview');
    expect(seatMaps.text).toContain('Seat No');
  });

  test('hotel company dashboard pages render without server errors and keep hotel scope', async () => {
    ensureUser({
      id: 'user-company-hotel-smoke',
      role: 'company_admin',
      fullName: 'Hotel Smoke Admin',
      email: 'hotel-company@classictrip.test',
      phone: '+256700000206',
      companyId: 'company-06',
    });

    const hotel = await login('hotel-company@classictrip.test');
    const pages = [
      '/company/dashboard',
      '/company/hotel-properties',
      '/company/room-types',
      '/company/room-units',
      '/company/room-calendar',
      '/company/housekeeping',
      '/company/arrivals',
      '/company/in-house-guests',
      '/company/departures',
      '/company/revenue',
      '/company/settlement',
      '/company/reports',
    ];

    for (const page of pages) {
      const response = await hotel.get(page).expect(200);
      expect(response.text).toContain('Classic Trip');
      expect(response.text).not.toContain('ReferenceError');
      expect(response.text).not.toContain('Use the marketplace navigation to continue.');
    }

    const rooms = await hotel.get('/company/room-calendar').expect(200);
    expect(rooms.text).toContain('Room-night calendar');
    expect(rooms.text).toContain('Housekeeping');
  });

  test('POST action failures return to dashboard with flash instead of raw 500 page', async () => {
    const bus = await login('company@classictrip.test');
    const response = await bus
      .post('/company/schedules/does-not-exist/publish')
      .type('form')
      .send({})
      .set('Referer', '/company/schedules-fares')
      .expect(302);

    expect(response.headers.location).toBe('/company/schedules-fares');
    const follow = await bus.get('/company/schedules-fares').expect(200);
    expect(follow.text).toContain('Action needs attention');
  });
});
