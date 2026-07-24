const repositories = require('../../src/repositories');

test('repository registry covers every uploaded production entity', () => {
  const requiredEntities = [
    'users',
    'companies',
    'companyEmployees',
    'listings',
    'routes',
    'vehicles',
    'schedules',
    'seats',
    'hotelProperties',
    'roomTypes',
    'roomUnits',
    'roomNightInventories',
    'holds',
    'bookings',
    'passengers',
    'payments',
    'ticketScans',
    'wallets',
    'walletLedgerEntries',
    'commissions',
    'promoterLinks',
    'referralClicks',
    'campaigns',
    'notifications',
    'supportTickets',
    'refunds',
    'reviews',
    'auditLogs',
    'platformSettings',
    'rateLimitCounters',
  ];

  for (const entity of requiredEntities) {
    expect(repositories.repositoryFor(entity).entity).toBe(entity);
  }
});

test('repository registry rejects unknown entities', () => {
  expect(() => repositories.repositoryFor('not-a-real-entity')).toThrow('Unknown repository entity');
});


test('repositories expose the readiness contract used by dashboards', () => {
  const repository = repositories.repositoryFor('companies');
  expect(typeof repository.isReady).toBe('function');
  expect(typeof repository.assertReady).toBe('function');
  expect(repository.isReady()).toBe(repositories.mongoReady());
});

test('dashboard repository readiness fails with a service-unavailable error when MongoDB is disconnected', () => {
  if (repositories.mongoReady()) return;
  expect(() => repositories.readyRepository('companies')).toThrow('MongoDB is unavailable for dashboard entity: companies');
  try {
    repositories.readyRepository('companies');
  } catch (error) {
    expect(error.status).toBe(503);
    expect(error.code).toBe('mongodb_unavailable');
  }
});
