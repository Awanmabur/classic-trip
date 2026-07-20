const request = require('supertest');
const app = require('../../src/app');
const store = require('../../src/services/data/persistentStore');

async function login(email) {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ identity: email, password: 'Password123' }).expect(302);
  return agent;
}

function suffix() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function wizardForm(overrides = {}) {
  const stamp = suffix();
  return {
    idempotencyKey: `http-wizard-${stamp}`,
    listing: { title: `HTTP wizard route ${stamp}`, from: 'Kampala', to: 'Jinja', priceFrom: '30000', status: 'active' },
    vehicle: { name: `HTTP Wizard Coach ${stamp}`, layoutName: '2x2', rows: '3' },
    route: { origin: 'Kampala', destination: 'Jinja' },
    schedule: { departAt: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(), basePrice: '30000' },
    ...overrides,
  };
}

test('POST /company/bus-services creates a full linked bus service through the real HTTP stack', async () => {
  const agent = await login('company@classictrip.test');
  const form = wizardForm();
  const listingsBefore = store.state.listings.length;

  await agent.post('/company/bus-services').type('form').send(form).expect(302);

  expect(store.state.listings.length).toBe(listingsBefore + 1);
  const listing = store.state.listings.find((item) => item.title === form.listing.title);
  expect(listing).toBeTruthy();
  expect(listing.companyId).toBe('company-01');
  const vehicle = store.state.vehicles.find((item) => item.listingId === listing.id);
  const route = store.state.routes.find((item) => item.listingId === listing.id);
  const schedule = store.state.schedules.find((item) => item.listingId === listing.id);
  expect(vehicle).toBeTruthy();
  expect(route).toBeTruthy();
  expect(schedule).toBeTruthy();
  expect(schedule.vehicleId).toBe(vehicle.id);
  expect(schedule.routeId).toBe(route.id);
});

test('POST /company/bus-services does not create a duplicate when the same idempotency key is submitted twice (double-submit guard)', async () => {
  const agent = await login('company@classictrip.test');
  const form = wizardForm();

  await agent.post('/company/bus-services').type('form').send(form).expect(302);
  const listingsAfterFirst = store.state.listings.filter((item) => item.title === form.listing.title).length;

  await agent.post('/company/bus-services').type('form').send(form).expect(302);
  const listingsAfterSecond = store.state.listings.filter((item) => item.title === form.listing.title).length;

  expect(listingsAfterFirst).toBe(1);
  expect(listingsAfterSecond).toBe(1);
});

test('POST /company/bus-services requires company access and rejects unrelated roles', async () => {
  const agent = await login('amina@classictrip.test');
  const form = wizardForm();

  const response = await agent.post('/company/bus-services').type('form').send(form);
  expect(response.status).not.toBe(302);
});
