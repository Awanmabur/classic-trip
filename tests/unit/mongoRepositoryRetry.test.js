const { retryableReadError } = require('../../src/repositories/mongoRepository');

test('does not retry a spent Mongo network socket timeout', () => {
  const error = Object.assign(
    new Error('connection 154 to 159.41.95.25:27017 timed out'),
    { name: 'MongoNetworkTimeoutError' },
  );
  expect(retryableReadError(error)).toBe(false);
});

test('keeps one retry for a short pool checkout interruption', () => {
  const error = Object.assign(
    new Error('Timed out while checking out a connection from connection pool'),
    { name: 'MongoWaitQueueTimeoutError' },
  );
  expect(retryableReadError(error)).toBe(true);
});
