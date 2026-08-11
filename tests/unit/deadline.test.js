const { withDeadline } = require('../../src/services/shared/deadline');

test('returns work completed before the deadline', async () => {
  expect(await withDeadline(Promise.resolve('ready'), 50)).toBe('ready');
});

test('rejects a stalled operation with the supplied controlled error', async () => {
  const startedAt = Date.now();
  let failure;
  try {
    await withDeadline(new Promise(() => {}), 20, () => Object.assign(new Error('catalog deadline'), {
      status: 503,
      code: 'public_catalog_temporarily_unavailable',
    }));
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeDefined();
  expect(failure.status).toBe(503);
  expect(failure.code).toBe('public_catalog_temporarily_unavailable');
  expect(Boolean(Date.now() - startedAt < 500)).toBe(true);
});
