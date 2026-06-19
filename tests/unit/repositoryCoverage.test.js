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
    'rooms',
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
    'subscriptionOrders',
    'subscriptions',
    'notifications',
    'supportTickets',
    'refunds',
    'reviews',
    'auditLogs',
    'settings',
  ];

  for (const entity of requiredEntities) {
    expect(repositories.repositoryFor(entity).entity).toBe(entity);
  }
});

test('repository registry rejects unknown entities', () => {
  expect(() => repositories.repositoryFor('not-a-real-entity')).toThrow('Unknown repository entity');
});
