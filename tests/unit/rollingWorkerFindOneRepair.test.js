'use strict';

const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const materializerPath = path.join(root, 'src/jobs/materializeSchedules.js');

function installStub(file, exports) {
  const id = require.resolve(file);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

function loadMaterializer({ createScheduleBatch }) {
  // Use local calendar constructors so this fixture is deterministic on both
  // Render (UTC) and East Africa/Windows development machines.
  const existingDeparture = new Date(2026, 7, 6, 12, 0, 0, 0).toISOString();
  installStub(path.join(root, 'src/repositories/index.js'), {
    mongoReady() { return true; },
  });
  installStub(path.join(root, 'src/repositories/domain/busOperationsRepository.js'), {
    schedules: {
      async list(filter = {}) {
        if (filter.status === 'active' || filter.status === 'draft') return [];
        // The materializer makes two different schedule reads: one for this
        // rule's already-created departures, and another for vehicle overlaps.
        // Do not return the rule's existing departure as a fake overlap row.
        if (filter.vehicleId) return [];
        return [{ id: 'schedule-existing', companyId: 'company-2', routeId: 'route-1', vehicleId: 'vehicle-1', scheduleRuleId: 'schedule-rule-11', departAt: existingDeparture }];
      },
    },
    scheduleRules: { async list() { return []; }, async findOne() { return null; }, async updateOne() { return true; } },
    routes: { async findOne() { return null; } },
  });
  installStub(path.join(root, 'src/services/company/companyService.js'), {
    createScheduleBatch,
    async createSchedule() { throw new Error('isolated initial fallback should not run'); },
    async recordScheduleRuleMaterialization() { return true; },
  });
  installStub(path.join(root, 'src/modules/bus/services/busDepartureService.js'), {
    async publishSchedule() { throw new Error('draft reconciliation should not run in this fixture'); },
    async createScheduleSeries() { throw new Error('legacy series repair path must not run'); },
  });
  installStub(path.join(root, 'src/services/shared/jobLeaseService.js'), {
    async acquire() { return { acquired: true, release: async () => true }; },
    keepAlive() { return () => {}; },
  });
  installStub(path.join(root, 'src/config/logger.js'), {
    info() {}, warn() {}, error() {},
  });
  delete require.cache[require.resolve(materializerPath)];
  return require(materializerPath);
}

function activeRule() {
  return {
    id: 'schedule-rule-11',
    companyId: 'company-2',
    routeId: 'route-1',
    vehicleId: 'vehicle-1',
    fareProductId: 'fare-1',
    startDate: '2026-08-06T00:00:00.000Z',
    departureTime: '12:00',
    daysOfWeek: [],
    driverIds: [],
    blockedSeats: [],
    status: 'active',
  };
}

describe('rolling worker repair after the first dated departure', () => {
  test('uses the proven single-date batch path and keeps creating Draft dates', async () => {
    const calls = [];
    const materializer = loadMaterializer({
      async createScheduleBatch(companyId, payload) {
        calls.push({ companyId, payload });
        return {
          count: 1,
          publishedCount: 0,
          draftCount: 1,
          publicationDeferred: [{ failures: ['operator_permit_missing_or_expired'] }],
        };
      },
    });

    const result = await materializer.materializeRule(
      activeRule(),
      new Date(2026, 7, 8, 0, 0, 0, 0),
      new Date(2026, 7, 6, 8, 0, 0, 0),
      { maxCreates: 1 },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].companyId).toBe('company-2');
    expect(calls[0].payload.repeatUntil).toBe('2026-08-07');
    expect(result.created).toBe(1);
    expect(result.draft).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.pending > 0).toBe(true);
    expect(result.failures).toContain('operator_permit_missing_or_expired');
  });

  test('does not misclassify undefined.findOne as a permanent skipped date', async () => {
    const materializer = loadMaterializer({
      async createScheduleBatch() {
        throw new TypeError("Cannot read properties of undefined (reading 'findOne')");
      },
    });

    let failure;
    try {
      await materializer.materializeRule(
        activeRule(),
        new Date('2026-08-08T00:00:00.000Z'),
        new Date('2026-08-06T08:00:00.000Z'),
        { maxCreates: 1 },
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeDefined();
    expect(failure.code).toBe('rolling_internal_runtime_failure');
    expect(failure.rollingStage).toBe('repair_existing_window_create');
  });
});
