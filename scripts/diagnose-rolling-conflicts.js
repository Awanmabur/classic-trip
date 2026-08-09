#!/usr/bin/env node
'use strict';

const { validateEnv } = require('../src/config/env');
const { connectDb, mongoose } = require('../src/config/db');
const busRepo = require('../src/repositories/domain/busOperationsRepository');
const busDepartureService = require('../src/modules/bus/services/busDepartureService');
const { rollingWindowBounds, matchingFutureDates, HORIZON_DAYS } = require('../src/jobs/materializeSchedules');

const DAY_MS = 24 * 60 * 60 * 1000;

async function main() {
  const args = process.argv.slice(2).filter((value) => !value.startsWith('--'));
  const companyId = String(args[0] || '').trim();
  const requestedRules = args.slice(1).map(String).filter(Boolean);
  if (!companyId) {
    console.error('Usage: npm run rolling:diagnose -- <companyId> [ruleId ...]');
    process.exitCode = 1;
    return;
  }

  validateEnv();
  await connectDb();

  const filter = { companyId, status: 'active' };
  if (requestedRules.length) filter.id = { $in: requestedRules };
  const rules = await busRepo.scheduleRules.list(filter, { sort: { departureTime: 1 }, limit: 200 });
  if (!rules.length) {
    console.log(`No active recurring rules found for ${companyId}${requestedRules.length ? ` matching ${requestedRules.join(', ')}` : ''}.`);
    return;
  }

  const now = new Date();
  const horizonEnd = new Date(now.getTime() + HORIZON_DAYS * DAY_MS);
  console.log(`Rolling conflict diagnosis for ${companyId} at ${now.toISOString()}`);
  console.log('');

  for (const rule of rules) {
    const [vehicle, route] = await Promise.all([
      busRepo.vehicles.findOne({ id: rule.vehicleId, companyId }),
      busRepo.routes.findOne({ id: rule.routeId, companyId }),
    ]);
    const { cursor, windowEnd } = rollingWindowBounds(rule, horizonEnd, now);
    const dates = cursor <= windowEnd ? matchingFutureDates(rule, cursor, windowEnd, now) : [];
    const conflicts = [];
    let freeDates = 0;

    for (const departAt of dates) {
      const arriveAt = rule.durationMinutes ? new Date(departAt.getTime() + Number(rule.durationMinutes) * 60000) : undefined;
      // eslint-disable-next-line no-await-in-loop
      const rows = await busDepartureService.findVehicleConflicts(companyId, rule.vehicleId, departAt, arriveAt);
      const sameRuleDate = rows.find((row) => String(row.scheduleRuleId || '') === String(rule.id || '') && new Date(row.departAt || 0).getTime() === departAt.getTime());
      const otherRows = rows.filter((row) => row !== sameRuleDate);
      if (!otherRows.length) {
        freeDates += 1;
        continue;
      }
      const first = otherRows[0];
      conflicts.push({
        date: departAt.toISOString(),
        scheduleId: first.id || '',
        ruleId: first.scheduleRuleId || '',
        routeId: first.routeId || first.routeSnapshot?.routeId || '',
        departAt: first.departAt || '',
        arriveAt: first.arriveAt || '',
      });
    }

    console.log(`Rule ${rule.id}`);
    console.log(`  Vehicle: ${vehicle?.registrationNumber || vehicle?.plateNumber || rule.vehicleId || 'unknown'} (${rule.vehicleId || 'no id'})`);
    console.log(`  Route: ${route?.origin || '?'} ⇄ ${route?.destination || '?'} (${rule.routeId || 'no route id'})`);
    console.log(`  Time: ${rule.departureTime || 'unknown'} · window dates checked: ${dates.length}`);
    console.log(`  Free dates: ${freeDates} · conflicted dates: ${conflicts.length}`);
    conflicts.slice(0, 12).forEach((item) => {
      console.log(`    - ${item.date} conflicts with schedule=${item.scheduleId || '?'} rule=${item.ruleId || 'manual/one-off'} route=${item.routeId || '?'} depart=${item.departAt || '?'} arrive=${item.arriveAt || '?'}`);
    });
    if (conflicts.length > 12) console.log(`    ... ${conflicts.length - 12} more conflict(s)`);
    console.log('');
  }
}

main()
  .catch((error) => { console.error(`✖ ${error.message}`); process.exitCode = 1; })
  .finally(async () => { await mongoose.disconnect().catch(() => {}); });
