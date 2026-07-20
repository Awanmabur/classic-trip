const store = require('../../src/services/data/persistentStore');
const companyService = require('../../src/services/company/companyService');
const materializeSchedules = require('../../src/jobs/materializeSchedules');

function suffix() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function verifiedBusSetup(name = 'Rule Partner') {
  const company = await companyService.createCompany({
    name: `${name} ${suffix()}`,
    companyType: 'transport',
    country: 'Uganda',
    city: 'Kampala',
    email: 'ops@example.com',
  });
  await companyService.setVerificationStatus(company.slug, 'verified', 'admin-e2e');
  const listing = await companyService.createListing(company.id, {
    serviceType: 'bus',
    title: `Rule route ${suffix()}`,
    from: 'Kampala',
    to: 'Fort Portal',
    priceFrom: 40000,
    status: 'active',
  });
  const route = await companyService.createRoute(company.id, {
    listingId: listing.id,
    origin: 'Kampala',
    destination: 'Fort Portal',
  });
  const vehicle = await companyService.createVehicle(company.id, {
    listingId: listing.id,
    serviceType: 'bus',
    name: `Rule Coach ${suffix()}`,
    layoutName: '2x2',
    rows: 3,
  });
  return { company, listing, route, vehicle };
}

function tomorrowDateOnly() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

test('createScheduleRule validates route/vehicle linkage and departure time format', async () => {
  const { company, route, vehicle } = await verifiedBusSetup('Rule Validation Partner');

  await expect(companyService.createScheduleRule(company.id, {
    routeId: route.id,
    vehicleId: vehicle.id,
    departureTime: 'not-a-time',
    startDate: tomorrowDateOnly(),
  })).rejects.toMatchObject({ status: 422 });

  const rule = await companyService.createScheduleRule(company.id, {
    routeId: route.id,
    vehicleId: vehicle.id,
    departureTime: '07:30',
    startDate: tomorrowDateOnly(),
    basePrice: 40000,
  });
  expect(rule.status).toBe('active');
  expect(rule.departureTime).toBe('07:30');
  expect(rule.materializedThrough).toBeNull();
});

test('materializeSchedules.run() extends a rule\'s window to the horizon and never duplicates on a same-day re-run', async () => {
  const { company, route, vehicle } = await verifiedBusSetup('Rule Materializer Partner');
  const rule = await companyService.createScheduleRule(company.id, {
    routeId: route.id,
    vehicleId: vehicle.id,
    departureTime: '08:00',
    startDate: tomorrowDateOnly(),
    basePrice: 40000,
  });

  const schedulesBefore = store.state.schedules.filter((item) => item.scheduleRuleId === rule.id).length;
  expect(schedulesBefore).toBe(0);

  const firstRun = await materializeSchedules.run();
  const created = store.state.schedules.filter((item) => item.scheduleRuleId === rule.id);
  expect(created.length).toBe(materializeSchedules.HORIZON_DAYS);
  expect(firstRun.schedulesCreated).toBeGreaterThanOrEqual(created.length);
  const updatedRule = store.state.scheduleRules.find((item) => item.id === rule.id);
  expect(updatedRule.materializedThrough).toBeTruthy();

  const secondRun = await materializeSchedules.run();
  const afterSecondRun = store.state.schedules.filter((item) => item.scheduleRuleId === rule.id);
  expect(afterSecondRun.length).toBe(created.length);
  const secondRunForThisRule = secondRun.results.find((row) => row.ruleId === rule.id);
  expect(secondRunForThisRule).toBeUndefined();
}, 30000);

test('pausing a rule stops future materialization without touching already-materialized schedules', async () => {
  const { company, route, vehicle } = await verifiedBusSetup('Rule Pause Partner');
  const rule = await companyService.createScheduleRule(company.id, {
    routeId: route.id,
    vehicleId: vehicle.id,
    departureTime: '09:00',
    startDate: tomorrowDateOnly(),
    basePrice: 40000,
  });

  await materializeSchedules.run();
  const materializedCount = store.state.schedules.filter((item) => item.scheduleRuleId === rule.id).length;
  expect(materializedCount).toBeGreaterThan(0);

  const paused = await companyService.pauseScheduleRule(company.id, rule.id, 'admin-e2e');
  expect(paused.status).toBe('paused');

  const runAfterPause = await materializeSchedules.run();
  expect(runAfterPause.results.some((row) => row.ruleId === rule.id)).toBe(false);
  expect(store.state.schedules.filter((item) => item.scheduleRuleId === rule.id).length).toBe(materializedCount);
  expect(store.state.schedules.filter((item) => item.scheduleRuleId === rule.id).every((item) => item.status !== 'archived')).toBe(true);
}, 30000);
