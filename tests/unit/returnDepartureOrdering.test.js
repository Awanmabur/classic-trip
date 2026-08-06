'use strict';

const path = require('node:path');

const root = path.resolve(__dirname, '../..');

function installStub(file, exports) {
  const id = require.resolve(file);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

describe('return departure chronology', () => {
  test('queries only departures strictly after the outbound threshold', async () => {
    let capturedFilter = null;
    installStub(path.join(root, 'src/modules/bus/repositories/busRepository.js'), {
      schedules: {
        async list(filter) { capturedFilter = filter; return []; },
        async findOne() { return null; },
      },
      routes: { async list() { return []; } },
      routeStops: { async list() { return []; } },
    });

    const servicePath = path.join(root, 'src/modules/bus/services/busSearchService.js');
    delete require.cache[require.resolve(servicePath)];
    const service = require(servicePath);
    const threshold = '2026-08-07T12:30:00.000Z';

    const rows = await service.findReturnDepartures({
      companyId: 'company-2',
      originName: 'Juba',
      destinationName: 'Kampala',
      afterDepartureAt: threshold,
    });

    expect(rows).toEqual([]);
    expect(capturedFilter.departAt.$gt instanceof Date).toBe(true);
    expect(capturedFilter.departAt.$gt.toISOString()).toBe(threshold);
  });
});
