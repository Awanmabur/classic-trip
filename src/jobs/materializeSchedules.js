const store = require('../services/data/persistentStore');
const companyService = require('../services/company/companyService');

// How far ahead a rule's schedules are ever allowed to exist. Each run extends every active
// rule's materialized window by one more day toward this horizon - never a one-time burst.
const HORIZON_DAYS = 45;
const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function combineDateAndTime(date, timeString) {
  const [hours, minutes] = String(timeString || '00:00').split(':').map(Number);
  const combined = new Date(date);
  combined.setHours(Number.isFinite(hours) ? hours : 0, Number.isFinite(minutes) ? minutes : 0, 0, 0);
  return combined;
}

async function materializeRule(rule, horizonEnd, now) {
  const ruleStart = startOfDay(rule.startDate);
  const ruleEnd = rule.endDate ? startOfDay(rule.endDate) : null;
  const watermark = rule.materializedThrough ? startOfDay(rule.materializedThrough) : null;
  const cursorStart = watermark ? new Date(watermark.getTime() + DAY_MS) : ruleStart;
  const cursor = cursorStart < ruleStart ? new Date(ruleStart) : cursorStart;
  const windowEnd = ruleEnd && ruleEnd < horizonEnd ? ruleEnd : horizonEnd;

  if (cursor > windowEnd) return { created: 0, skipped: 0 };

  let created = 0;
  let skipped = 0;
  let day = new Date(cursor);
  while (day <= windowEnd) {
    const matchesWeekday = !rule.daysOfWeek?.length || rule.daysOfWeek.includes(day.getDay());
    if (matchesWeekday) {
      const departAt = combineDateAndTime(day, rule.departureTime);
      if (departAt.getTime() > now.getTime()) {
        const arriveAt = rule.durationMinutes ? new Date(departAt.getTime() + rule.durationMinutes * 60000).toISOString() : undefined;
        try {
          // eslint-disable-next-line no-await-in-loop
          await companyService.createSchedule(rule.companyId, {
            routeId: rule.routeId,
            vehicleId: rule.vehicleId,
            departAt: departAt.toISOString(),
            arriveAt,
            basePrice: rule.basePrice,
            fareClass: rule.fareClass,
            notes: rule.notes,
            blockedSeats: (rule.blockedSeats || []).join(','),
            driverIds: (rule.driverIds || []).join(','),
            vipPriceDelta: rule.vipPriceDelta,
            status: 'active',
            scheduleRuleId: rule.id,
          });
          created += 1;
        } catch (error) {
          // A single day failing (e.g. the vehicle was archived mid-window) shouldn't stall the
          // whole rule's watermark forever - skip that day and keep advancing.
          skipped += 1;
        }
      }
    }
    day = new Date(day.getTime() + DAY_MS);
  }

  await companyService.recordScheduleRuleMaterialization(rule.id, windowEnd.toISOString());
  return { created, skipped };
}

async function run(now = new Date()) {
  const horizonEnd = startOfDay(new Date(now.getTime() + HORIZON_DAYS * DAY_MS));
  const activeRules = store.state.scheduleRules.filter((rule) => rule.status === 'active');
  let totalCreated = 0;
  let totalSkipped = 0;
  const results = [];
  for (const rule of activeRules) {
    // eslint-disable-next-line no-await-in-loop
    const { created, skipped } = await materializeRule(rule, horizonEnd, now);
    totalCreated += created;
    totalSkipped += skipped;
    if (created || skipped) results.push({ ruleId: rule.id, created, skipped });
  }
  return { rulesConsidered: activeRules.length, schedulesCreated: totalCreated, daysSkipped: totalSkipped, results };
}

module.exports = { run, HORIZON_DAYS };
