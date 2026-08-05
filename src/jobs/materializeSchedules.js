const busOperationsRepository = require('../repositories/domain/busOperationsRepository');
const companyService = require('../services/company/companyService');
const busDepartureService = require('../modules/bus/services/busDepartureService');

// Keep exactly one rolling month of dated departures. Today plus the following
// 29 calendar days is a 30-day window; tomorrow's run adds one new far-end day.
const ROLLING_WINDOW_DAYS = 30;
const HORIZON_DAYS = ROLLING_WINDOW_DAYS - 1;
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

function isTransientFailure(error = {}) {
  const status = Number(error.status || 0);
  const message = String(error.message || error || '');
  return status >= 500
    || /connection|pool|wait queue|timed out|network|server selection|not primary|write conflict/i.test(message);
}

function matchingFutureDates(rule, cursor, windowEnd, now) {
  const dates = [];
  let day = new Date(cursor);
  while (day <= windowEnd) {
    const matchesWeekday = !rule.daysOfWeek?.length || rule.daysOfWeek.includes(day.getDay());
    if (matchesWeekday) {
      const departAt = combineDateAndTime(day, rule.departureTime);
      if (departAt.getTime() > now.getTime()) dates.push(departAt);
    }
    day = new Date(day.getTime() + DAY_MS);
  }
  return dates;
}

function schedulePayload(rule, departAt) {
  const arriveAt = rule.durationMinutes
    ? new Date(departAt.getTime() + rule.durationMinutes * 60000).toISOString()
    : undefined;
  return {
    routeId: rule.routeId,
    vehicleId: rule.vehicleId,
    fareProductId: rule.fareProductId,
    departAt: departAt.toISOString(),
    arriveAt,
    basePrice: rule.basePrice,
    fareClass: rule.fareClass,
    notes: rule.notes,
    blockedSeats: (rule.blockedSeats || []).join(','),
    driverIds: (rule.driverIds || []).join(','),
    vipPriceDelta: rule.vipPriceDelta,
    // Published makes the departure visible immediately when all readiness
    // checks pass. createSchedule safely retains it as Draft otherwise.
    status: 'published',
    scheduleRuleId: rule.id,
  };
}

async function reconcileLegacyActiveSchedules(rule, windowEnd, now) {
  const schedules = await busOperationsRepository.schedules.list({
    companyId: rule.companyId,
    scheduleRuleId: rule.id,
    status: 'active',
    departAt: { $gt: now, $lte: new Date(windowEnd.getTime() + DAY_MS - 1) },
  }, { sort: { departAt: 1 }, limit: ROLLING_WINDOW_DAYS });
  let published = 0;
  let draft = 0;
  for (const schedule of schedules) {
    try {
      // The first publication also reconciles the parent listing. Remaining
      // departures avoid repeating that listing-wide readiness work.
      // eslint-disable-next-line no-await-in-loop
      await busDepartureService.publishSchedule(
        rule.companyId,
        schedule.id,
        'schedule-materializer',
        { schedule, deferListingSync: published > 0 },
      );
      published += 1;
    } catch (error) {
      if (isTransientFailure(error)) throw error;
      // "active" was the old generator's private status. If publication
      // readiness is incomplete, expose the record honestly as a Draft.
      // eslint-disable-next-line no-await-in-loop
      await busOperationsRepository.schedules.updateOne({ id: schedule.id, companyId: rule.companyId }, {
        $set: {
          status: 'draft',
          statusReason: 'Automatic publication deferred until departure readiness is complete',
          updatedAt: new Date(),
        },
      });
      draft += 1;
    }
  }
  return { published, draft };
}

async function materializeRule(rule, horizonEnd, now) {
  const ruleStart = startOfDay(rule.startDate);
  const ruleEnd = rule.endDate ? startOfDay(rule.endDate) : null;
  const watermark = rule.materializedThrough ? startOfDay(rule.materializedThrough) : null;
  const cursorStart = watermark ? new Date(watermark.getTime() + DAY_MS) : ruleStart;
  const cursor = cursorStart < ruleStart ? new Date(ruleStart) : cursorStart;
  const windowEnd = ruleEnd && ruleEnd < horizonEnd ? ruleEnd : horizonEnd;
  const reconciled = await reconcileLegacyActiveSchedules(rule, windowEnd, now);

  if (cursor > windowEnd) {
    return {
      created: 0,
      published: reconciled.published,
      draft: reconciled.draft,
      skipped: 0,
      reconciled: reconciled.published + reconciled.draft,
    };
  }

  const dates = matchingFutureDates(rule, cursor, windowEnd, now);
  let created = 0;
  let published = reconciled.published;
  let draft = reconciled.draft;
  let skipped = 0;

  if (dates.length) {
    try {
      // One batch resolves the company, route, vehicle, seat map and fare once,
      // then writes at most two departures concurrently. This avoids a burst of
      // repeated relationship reads that used to exhaust the MongoDB pool.
      const result = await companyService.createScheduleBatch(rule.companyId, {
        ...schedulePayload(rule, dates[0]),
        repeatUntil: windowEnd.toISOString().slice(0, 10),
        repeatDays: Array.isArray(rule.daysOfWeek) ? rule.daysOfWeek.map(String) : [],
      });
      created = Number(result.count || 0);
      published += Number(result.publishedCount || 0);
      draft += Number(result.draftCount || 0);
    } catch (batchError) {
      if (isTransientFailure(batchError)) throw batchError;
      // A conflict on one calendar date must not block every other day in the
      // month. Fall back to isolated creation and keep transient DB failures
      // retryable by leaving the watermark untouched.
      for (const departAt of dates) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const result = await companyService.createSchedule(rule.companyId, schedulePayload(rule, departAt));
          created += 1;
          if (result.schedule?.status === 'published') published += 1;
          else draft += 1;
        } catch (error) {
          if (isTransientFailure(error)) throw error;
          skipped += 1;
        }
      }
    }
  }

  await companyService.recordScheduleRuleMaterialization(rule.companyId, rule.id, windowEnd.toISOString());
  return {
    created,
    published,
    draft,
    skipped,
    reconciled: reconciled.published + reconciled.draft,
  };
}

async function run(now = new Date()) {
  const horizonEnd = startOfDay(new Date(now.getTime() + HORIZON_DAYS * DAY_MS));
  const activeRules = await busOperationsRepository.scheduleRules.list({ status: 'active' });
  let totalCreated = 0;
  let totalPublished = 0;
  let totalDraft = 0;
  let totalSkipped = 0;
  let totalReconciled = 0;
  const results = [];
  for (const rule of activeRules) {
    // eslint-disable-next-line no-await-in-loop
    const {
      created, published, draft, skipped, reconciled = 0,
    } = await materializeRule(rule, horizonEnd, now);
    totalCreated += created;
    totalPublished += published;
    totalDraft += draft;
    totalSkipped += skipped;
    totalReconciled += reconciled;
    if (created || skipped || reconciled) {
      results.push({
        ruleId: rule.id, created, published, draft, skipped, reconciled,
      });
    }
  }
  return {
    rulesConsidered: activeRules.length,
    rollingWindowDays: ROLLING_WINDOW_DAYS,
    schedulesCreated: totalCreated,
    schedulesPublished: totalPublished,
    schedulesDraft: totalDraft,
    legacySchedulesReconciled: totalReconciled,
    daysSkipped: totalSkipped,
    results,
  };
}

async function materializeRuleById(companyId, ruleId, now = new Date()) {
  const rule = await busOperationsRepository.scheduleRules.findOne({
    id: String(ruleId || ''),
    companyId: String(companyId || ''),
    status: 'active',
  });
  if (!rule) return { created: 0, published: 0, draft: 0, skipped: 0, ignored: true };
  const horizonEnd = startOfDay(new Date(now.getTime() + HORIZON_DAYS * DAY_MS));
  return materializeRule(rule, horizonEnd, now);
}

module.exports = {
  run,
  materializeRule,
  materializeRuleById,
  ROLLING_WINDOW_DAYS,
  HORIZON_DAYS,
};
