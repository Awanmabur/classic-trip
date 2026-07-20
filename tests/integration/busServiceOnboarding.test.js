const store = require('../../src/services/data/persistentStore');
const companyService = require('../../src/services/company/companyService');
const busServiceOnboarding = require('../../src/services/company/busServiceOnboarding');

function suffix() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function verifiedCompany(name = 'Wizard Partner', operatingCurrency = 'UGX') {
  const company = await companyService.createCompany({
    name: `${name} ${suffix()}`,
    companyType: 'transport',
    country: 'Uganda',
    city: 'Kampala',
    email: 'ops@example.com',
    operatingCurrency,
  });
  await companyService.setVerificationStatus(company.slug, 'verified', 'admin-e2e');
  return company;
}

function fullPayload(overrides = {}) {
  return {
    listing: {
      title: `Wizard route ${suffix()}`,
      from: 'Kampala',
      to: 'Mbarara',
      priceFrom: 45000,
      status: 'active',
      ...overrides.listing,
    },
    vehicle: {
      name: `Wizard Coach ${suffix()}`,
      layoutName: '2x2',
      rows: 3,
      ...overrides.vehicle,
    },
    route: {
      origin: 'Kampala',
      destination: 'Mbarara',
      ...overrides.route,
    },
    schedule: {
      departAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      totalSeats: 12,
      basePrice: 45000,
      ...overrides.schedule,
    },
  };
}

test('createBusService creates a linked listing, vehicle, route, and schedule with seats in one call', async () => {
  const company = await verifiedCompany('Wizard Happy Path', 'KES');
  const payload = fullPayload();

  const result = await busServiceOnboarding.createBusService(company.id, payload, { actorId: 'wizard-test' });

  expect(result.listing.companyId).toBe(company.id);
  expect(result.listing.currency).toBe('KES');
  expect(result.vehicle.listingId).toBe(result.listing.id);
  expect(result.route.listingId).toBe(result.listing.id);
  expect(result.schedule.routeId).toBe(result.route.id);
  expect(result.schedule.vehicleId).toBe(result.vehicle.id);
  expect(result.schedule.currency).toBe('KES');
  expect(result.seats.length).toBe(result.schedule.totalSeats);
  expect(store.findListing(result.listing.id).status).not.toBe('archived');
});

test('createBusService rolls back already-created records when a later step fails', async () => {
  const company = await verifiedCompany('Wizard Rollback Path');
  const payload = fullPayload({ listing: { from: '', to: '' }, route: { origin: '', destination: '' } });

  await expect(busServiceOnboarding.createBusService(company.id, payload, { actorId: 'wizard-test' }))
    .rejects.toThrow('Route origin and destination are required');

  const listings = store.state.listings.filter((item) => item.companyId === company.id);
  const vehicles = store.state.vehicles.filter((item) => item.companyId === company.id);
  expect(listings.length).toBeGreaterThan(0);
  expect(listings.every((item) => item.status === 'archived' && item.bookable === false)).toBe(true);
  expect(vehicles.length).toBeGreaterThan(0);
  expect(vehicles.every((item) => item.status === 'archived')).toBe(true);
  expect(store.state.routes.some((item) => item.companyId === company.id)).toBe(false);
  expect(store.state.schedules.some((item) => item.companyId === company.id)).toBe(false);
});

test('createBusService replays the cached result instead of duplicating on a repeated idempotency key', async () => {
  const company = await verifiedCompany('Wizard Idempotent Path');
  const payload = fullPayload();
  const idempotencyKey = `wizard-idem-${suffix()}`;

  const first = await busServiceOnboarding.createBusService(company.id, payload, { actorId: 'wizard-test', idempotencyKey });
  const second = await busServiceOnboarding.createBusService(company.id, payload, { actorId: 'wizard-test', idempotencyKey });

  expect(second.listing.id).toBe(first.listing.id);
  expect(store.state.listings.filter((item) => item.companyId === company.id).length).toBe(1);
});
