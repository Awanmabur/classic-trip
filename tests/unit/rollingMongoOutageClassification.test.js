const { isMongoUnavailable } = require('../../src/jobs/materializeSchedules');

test('classifies the reported Atlas socket timeout as one database outage', () => {
  const error = Object.assign(
    new Error('connection 118 to 159.41.95.25:27017 timed out'),
    { name: 'MongoNetworkTimeoutError' },
  );
  expect(isMongoUnavailable(error)).toBe(true);
});

test('does not pause every rolling rule for an ordinary validation failure', () => {
  const error = Object.assign(new Error('Departure time is required'), { name: 'ValidationError', status: 422 });
  expect(isMongoUnavailable(error)).toBe(false);
});
