const busOperationsRepository = require('../repositories/domain/busOperationsRepository');
const companyService = require('../services/company/companyService');
const busDepartureService = require('../modules/bus/services/busDepartureService');
const jobLeaseService = require('../services/shared/jobLeaseService');
const logger = require('../config/logger');

// Keep exactly one rolling month of dated departures. Today plus the following
// 29 calendar days is a 30-day window; tomorrow's run adds one new far-end day.
const ROLLING_WINDOW_DAYS = 30;
const HORIZON_DAYS = ROLLING_WINDOW_DAYS - 1;
const DAY_MS = 24 * 60 * 60 * 1000;
const RULE_LEASE_TTL_MS = 20 * 60 * 1000;
const BACKGROUND_BATCH_SIZE = 1;
const BACKGROUND_REPAIR_INTERVAL_MS = 5 * 60 * 1000;
const BACKGROUND_BATCH_PAUSE_MS = 4000;
const PUBLICATION_BLOCKER_COOLDOWN_MS = 5 * 60 * 1000;
const backgroundQueue = new Map();
const rollingCacheInvalidationTimers = new Map();
const publicationBlockerCooldown = new Map();
let backgroundQueueRunning = false;
let backgroundRepairTimer = null;
let backgroundStartupTimer = null;
let backgroundDrainTimer = null;
let backgroundStopped = false;
let backgroundQueueOwner = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function invalidateRollingDashboardCaches(companyId) {
  const tenantId = String(companyId || '').trim();
  if (!tenantId) return;
  // A 30-day rule is completed in several small batches. Invalidating every
  // dashboard role and every page after every three inserted dates made all
  // dashboard requests cold for the entire drain. Debounce and invalidate only
  // pages whose data actually changes when departures are materialized. The timer
  // is longer than the low-priority batch pause, so the cache is cleared once
  // after the whole rolling drain instead of between every dated departure.
  const existing = rollingCacheInvalidationTimers.get(tenantId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    rollingCacheInvalidationTimers.delete(tenantId);
    try {
      const dashboardSnapshotService = require('../services/dashboard/dashboardSnapshotService');
      const tenantPages = ['overview', 'schedules', 'seat-maps'];
      ['company', 'employee', 'driver'].forEach((role) => {
        tenantPages.forEach((activePage) => dashboardSnapshotService.invalidate(role, {
          companyId: tenantId,
          activePage,
          invalidateHead: false,
        }));
      });
      ['overview', 'inventory'].forEach((activePage) => dashboardSnapshotService.invalidate('admin', { activePage }));
    } catch (_) {}
  }, 5000);
  timer.unref?.();
  rollingCacheInvalidationTimers.set(tenantId, timer);
}

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

function isInternalRuntimeFailure(error = {}) {
  const name = String(error.name || '');
  const message = String(error.message || error || '');
  return name === 'TypeError'
    || /cannot read (?:properties|property) of (?:undefined|null)|is not a function/i.test(message);
}

function tagRollingFailure(error, stage) {
  const failure = error instanceof Error ? error : new Error(String(error || 'Rolling departure operation failed'));
  if (!failure.rollingStage) failure.rollingStage = stage;
  if (!failure.code && isInternalRuntimeFailure(failure)) failure.code = 'rolling_internal_runtime_failure';
  return failure;
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

async function reconcileDraftSchedules(rule, windowEnd, now) {
  const drafts = await busOperationsRepository.schedules.list({
    companyId: rule.companyId,
    scheduleRuleId: rule.id,
    status: 'draft',
    departAt: { $gt: now, $lte: new Date(windowEnd.getTime() + DAY_MS - 1) },
  }, { sort: { departAt: 1 }, limit: ROLLING_WINDOW_DAYS });
  let published = 0;
  const failures = new Set();
  for (const schedule of drafts) {
    try {
      // The first successful publication reconciles listing readiness once. All
      // remaining dates share the same rule context and can skip that repeated
      // listing-wide read while still validating their own departure state.
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
      const readinessFailures = error?.validation?.failures || [];
      if (readinessFailures.length) readinessFailures.forEach((failure) => failures.add(String(failure)));
      else failures.add(String(error.message || error || 'Departure publication readiness is incomplete'));
      // Every future date in one rule shares company, listing, route, vehicle,
      // seat-map and fare readiness. Avoid repeating the same expensive failed
      // validation across the remaining month; the next worker pass retries it.
      if (published === 0) break;
    }
  }
  return { published, failures: [...failures] };
}

async function materializeRule(rule, horizonEnd, now, options = {}) {
  const ruleStart = startOfDay(rule.startDate);
  const ruleEnd = rule.endDate ? startOfDay(rule.endDate) : null;
  const today = startOfDay(now);
  // Re-evaluate the complete live window on every run. A watermark-only cursor
  // cannot repair a date that was deleted, cancelled, or skipped after a
  // transient setup conflict.
  const cursor = ruleStart > today ? new Date(ruleStart) : today;
  const windowEnd = ruleEnd && ruleEnd < horizonEnd ? ruleEnd : horizonEnd;
  const ruleKey = queuedRuleKey(rule.companyId, rule.id);
  const blocker = publicationBlockerCooldown.get(ruleKey);
  if (blocker && blocker.expiresAt <= Date.now()) publicationBlockerCooldown.delete(ruleKey);
  const activeBlocker = publicationBlockerCooldown.get(ruleKey);
  // A missing permit/insurance/inspection applies to every date in this rule.
  // Do not repeat the same expensive failed publication validation for each
  // one-date background batch. Continue creating Draft dates, then retry once
  // at the next five-minute repair scan after the operator fixes the document.
  const reconciled = activeBlocker
    ? { published: 0, draft: 0 }
    : await reconcileLegacyActiveSchedules(rule, windowEnd, now);
  const draftReconciliation = activeBlocker
    ? { published: 0, failures: activeBlocker.failures || [] }
    : await reconcileDraftSchedules(rule, windowEnd, now);
  if (!activeBlocker && draftReconciliation.failures?.length) {
    publicationBlockerCooldown.set(ruleKey, {
      failures: [...draftReconciliation.failures],
      expiresAt: Date.now() + PUBLICATION_BLOCKER_COOLDOWN_MS,
    });
  } else if (!draftReconciliation.failures?.length && !reconciled.draft) {
    publicationBlockerCooldown.delete(ruleKey);
  }

  if (cursor > windowEnd) {
    return {
      created: 0,
      published: reconciled.published + draftReconciliation.published,
      draft: reconciled.draft,
      skipped: 0,
      expected: 0,
      existing: 0,
      failures: draftReconciliation.failures,
      reconciled: reconciled.published + reconciled.draft + draftReconciliation.published,
    };
  }

  const expectedDates = matchingFutureDates(rule, cursor, windowEnd, now);
  const existingSchedules = await busOperationsRepository.schedules.list({
    companyId: rule.companyId,
    scheduleRuleId: rule.id,
    status: { $nin: ['archived', 'cancelled'] },
    departAt: { $gt: now, $lte: new Date(windowEnd.getTime() + DAY_MS - 1) },
  }, { sort: { departAt: 1 }, limit: ROLLING_WINDOW_DAYS * 2 });
  const existingTimes = new Set(existingSchedules
    .map((schedule) => new Date(schedule.departAt).getTime())
    .filter(Number.isFinite));
  const missingDates = expectedDates.filter((date) => !existingTimes.has(date.getTime()));
  const maxCreates = Math.max(0, Number(options.maxCreates || 0));
  const dates = maxCreates > 0 ? missingDates.slice(0, maxCreates) : missingDates;
  const pending = Math.max(0, missingDates.length - dates.length);
  let created = 0;
  let published = reconciled.published + draftReconciliation.published;
  let draft = reconciled.draft;
  let skipped = 0;
  const failures = new Set(draftReconciliation.failures || []);

  if (dates.length && existingSchedules.length === 0) {
    try {
      // One batch resolves the company, route, vehicle, seat map and fare once,
      // then writes one departure at a time. This avoids a burst of
      // repeated relationship reads that used to exhaust the MongoDB pool.
      const result = await companyService.createScheduleBatch(rule.companyId, {
        ...schedulePayload(rule, dates[0]),
        repeatUntil: dates[dates.length - 1].toISOString().slice(0, 10),
        repeatDays: Array.isArray(rule.daysOfWeek) ? rule.daysOfWeek.map(String) : [],
      });
      created = Number(result.count || 0);
      published += Number(result.publishedCount || 0);
      draft += Number(result.draftCount || 0);
      (result.publicationDeferred || []).flatMap((item) => item.failures || []).forEach((failure) => failures.add(String(failure)));
    } catch (batchError) {
      if (isTransientFailure(batchError) || isInternalRuntimeFailure(batchError)) {
        throw tagRollingFailure(batchError, 'initial_window_batch_create');
      }
      // A conflict on one calendar date must not block every other day in the
      // month. Fall back to isolated creation; the next run rechecks any gap.
      for (const departAt of dates) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const result = await companyService.createSchedule(rule.companyId, schedulePayload(rule, departAt));
          created += 1;
          if (result.schedule?.status === 'published') published += 1;
          else {
            draft += 1;
            (result.publicationDeferred?.failures || []).forEach((failure) => failures.add(String(failure)));
          }
        } catch (error) {
          if (isTransientFailure(error) || isInternalRuntimeFailure(error)) {
            throw tagRollingFailure(error, 'initial_window_isolated_create');
          }
          skipped += 1;
          failures.add(String(error.message || error || 'Departure creation failed'));
        }
      }
    }
  } else if (dates.length) {
    // Repair an existing rolling window through the same single-date batch path
    // that creates the first departure. The former createScheduleSeries path
    // reused a context across the repair transaction and, with real Atlas data,
    // could surface an unscoped `undefined.findOne` TypeError after day one. A
    // one-date batch keeps all ownership/readiness checks, creates Draft dates
    // despite publication blockers, and is already bounded by the background
    // queue's one-date batch size and two-second yield.
    for (const departAt of dates) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await companyService.createScheduleBatch(rule.companyId, {
          ...schedulePayload(rule, departAt),
          repeatUntil: departAt.toISOString().slice(0, 10),
          repeatDays: [String(departAt.getDay())],
        });
        const batchCreated = Number(result.count || 0);
        if (batchCreated < 1) {
          throw Object.assign(new Error('Rolling departure repair batch created no dated departure'), {
            code: 'rolling_batch_no_progress',
          });
        }
        created += batchCreated;
        published += Number(result.publishedCount || 0);
        draft += Number(result.draftCount || 0);
        (result.publicationDeferred || [])
          .flatMap((item) => item.failures || [])
          .forEach((failure) => failures.add(String(failure)));
      } catch (error) {
        if (isTransientFailure(error) || isInternalRuntimeFailure(error) || error?.code === 'rolling_batch_no_progress') {
          throw tagRollingFailure(error, 'repair_existing_window_create');
        }
        skipped += 1;
        failures.add(String(error.message || error || 'Departure creation failed'));
      }
    }
  }

  const finalFailures = [...failures].slice(0, 8);
  if (finalFailures.length && draft > 0) {
    publicationBlockerCooldown.set(ruleKey, {
      failures: finalFailures,
      expiresAt: Date.now() + PUBLICATION_BLOCKER_COOLDOWN_MS,
    });
  } else if (!finalFailures.length && published > 0) {
    publicationBlockerCooldown.delete(ruleKey);
  }
  await companyService.recordScheduleRuleMaterialization(rule.companyId, rule.id, windowEnd.toISOString());
  return {
    created,
    published,
    draft,
    skipped,
    expected: expectedDates.length,
    existing: expectedDates.length - missingDates.length,
    pending,
    failures: finalFailures,
    reconciled: reconciled.published + reconciled.draft + draftReconciliation.published,
  };
}

async function materializeRuleWithLease(rule, horizonEnd, now, options = {}) {
  const waitForLeaseMs = Math.max(0, Math.min(Number(options.waitForLeaseMs || 0), 10000));
  const startedAt = Date.now();
  let lease;
  do {
    // A controller request, the outbox worker, and the daily scheduler can all
    // discover the same rule. A per-rule lease prevents duplicate month-sized
    // inventory creation while the unique schedule index remains the final guard.
    // eslint-disable-next-line no-await-in-loop
    lease = await jobLeaseService.acquire(`schedule-rule-materialize:${rule.companyId}:${rule.id}`, RULE_LEASE_TTL_MS);
    if (lease.acquired) break;
    if (Date.now() - startedAt >= waitForLeaseMs) break;
    // eslint-disable-next-line no-await-in-loop
    await sleep(250);
  } while (true);

  if (!lease?.acquired) {
    return {
      created: 0, published: 0, draft: 0, skipped: 0, expected: 0,
      existing: 0, failures: [], busy: true,
    };
  }
  const stopKeepAlive = jobLeaseService.keepAlive(lease, RULE_LEASE_TTL_MS);
  try {
    const result = await materializeRule(rule, horizonEnd, now, options);
    if (Number(result.created || 0) || Number(result.published || 0) || Number(result.draft || 0) || Number(result.reconciled || 0)) {
      invalidateRollingDashboardCaches(rule.companyId);
    }
    return result;
  } finally {
    stopKeepAlive();
    await lease.release().catch(() => false);
  }
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
      created, published, draft, skipped, reconciled = 0, pending = 0,
    } = await materializeRuleWithLease(rule, horizonEnd, now, { maxCreates: BACKGROUND_BATCH_SIZE });
    totalCreated += created;
    totalPublished += published;
    totalDraft += draft;
    totalSkipped += skipped;
    totalReconciled += reconciled;
    if (pending > 0 && created > 0) queueRuleMaterialization(rule.companyId, rule.id);
    if (created || skipped || reconciled || pending) {
      results.push({
        ruleId: rule.id, created, published, draft, skipped, reconciled, pending,
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

async function materializeRuleById(companyId, ruleId, now = new Date(), options = {}) {
  const rule = await busOperationsRepository.scheduleRules.findOne({
    id: String(ruleId || ''),
    companyId: String(companyId || ''),
    status: 'active',
  });
  if (!rule) return {
    created: 0, published: 0, draft: 0, skipped: 0, expected: 0, existing: 0, failures: [], ignored: true,
  };
  const horizonEnd = startOfDay(new Date(now.getTime() + HORIZON_DAYS * DAY_MS));
  return materializeRuleWithLease(rule, horizonEnd, now, options);
}

function queuedRuleKey(companyId, ruleId) {
  return `${String(companyId || '').trim()}:${String(ruleId || '').trim()}`;
}

function scheduleBackgroundDrain(delayMs = 0) {
  if (backgroundStopped || backgroundQueueRunning || backgroundDrainTimer) return;
  backgroundDrainTimer = setTimeout(() => {
    backgroundDrainTimer = null;
    drainBackgroundQueue().catch((error) => logger.error('Rolling departure background queue failed', { error: error.message, stack: error.stack }));
  }, Math.max(0, Number(delayMs || 0)));
  backgroundDrainTimer.unref?.();
}

function queueRuleMaterialization(companyId, ruleId, options = {}) {
  const cleanCompanyId = String(companyId || '').trim();
  const cleanRuleId = String(ruleId || '').trim();
  if (!cleanCompanyId || !cleanRuleId || !backgroundQueueOwner) return false;
  const key = queuedRuleKey(cleanCompanyId, cleanRuleId);
  if (options.resetPublicationBlocker === true) publicationBlockerCooldown.delete(key);
  const existing = backgroundQueue.get(key) || { companyId: cleanCompanyId, ruleId: cleanRuleId, attempts: 0 };
  // Re-queueing an already pending rule must not accidentally reset its retry
  // count. A caller may provide an explicit lower retry count only for a fresh
  // operator-triggered retry after the previous job has left the queue.
  if (!backgroundQueue.has(key) && Number.isFinite(Number(options.attempts))) {
    existing.attempts = Math.max(0, Number(options.attempts));
  }
  backgroundQueue.set(key, existing);
  if (!backgroundQueueRunning) scheduleBackgroundDrain(Number(options.delayMs || 0));
  return true;
}

async function drainBackgroundQueue() {
  if (backgroundStopped || backgroundQueueRunning) return;
  backgroundQueueRunning = true;
  try {
    while (!backgroundStopped && backgroundQueue.size) {
      const [key, job] = backgroundQueue.entries().next().value;
      backgroundQueue.delete(key);
      let result;
      try {
        result = await materializeRuleById(job.companyId, job.ruleId, new Date(), {
          waitForLeaseMs: 5000,
          maxCreates: BACKGROUND_BATCH_SIZE,
        });
      } catch (error) {
        job.attempts += 1;
        logger.warn('Rolling departure batch failed and will retry', {
          companyId: job.companyId,
          ruleId: job.ruleId,
          attempts: job.attempts,
          stage: error.rollingStage || 'materialize_rule',
          code: error.code || '',
          error: error.message,
          stack: error.stack,
        });
        if (job.attempts < 8 && (
          isTransientFailure(error)
          || isInternalRuntimeFailure(error)
          || error.code === 'rolling_batch_no_progress'
        )) {
          backgroundQueue.set(key, job);
          await sleep(Math.min(5000, 500 * job.attempts));
        }
        continue;
      }
      if (result?.busy) {
        job.attempts += 1;
        if (job.attempts < 8) backgroundQueue.set(key, job);
        await sleep(750);
        continue;
      }
      logger.info('Rolling departure batch completed', {
        companyId: job.companyId,
        ruleId: job.ruleId,
        created: Number(result?.created || 0),
        published: Number(result?.published || 0),
        draft: Number(result?.draft || 0),
        existing: Number(result?.existing || 0),
        pending: Number(result?.pending || 0),
        skipped: Number(result?.skipped || 0),
      });
      const pending = Number(result?.pending || 0);
      const created = Number(result?.created || 0);
      const skipped = Number(result?.skipped || 0);
      if (pending > 0 && created > 0) {
        job.attempts = 0;
        backgroundQueue.set(key, job);
      } else if (pending > 0 && skipped > 0) {
        // A permanent configuration or validation error can leave the earliest
        // dates missing. Do not hot-loop over those same dates every 250 ms. The
        // five-minute repair scan will retry after an operator fixes the blocker.
        logger.warn('Rolling departure queue paused until the next repair scan', {
          companyId: job.companyId,
          ruleId: job.ruleId,
          pending,
          skipped,
          failures: result.failures || [],
        });
      } else if (pending > 0) {
        // Never silently abandon an incomplete window when a repository/batch
        // returns no progress and no permanent validation error. Retry a bounded
        // number of times, then leave it to the five-minute recovery scan rather
        // than spinning forever or pretending the remaining dates completed.
        job.attempts += 1;
        if (job.attempts < 8) {
          backgroundQueue.set(key, job);
          await sleep(Math.min(5000, 500 * job.attempts));
        } else {
          logger.warn('Rolling departure queue made no progress and will resume at the next repair scan', {
            companyId: job.companyId,
            ruleId: job.ruleId,
            pending,
          });
        }
      }
      // A single global queue and a small pause prevent one month-sized rule from
      // monopolising the MongoDB pool while still completing the rolling window.
      await sleep(BACKGROUND_BATCH_PAUSE_MS);
    }
  } finally {
    backgroundQueueRunning = false;
    if (backgroundQueue.size) scheduleBackgroundDrain(500);
  }
}

async function queueAllActiveRules() {
  const activeRules = await busOperationsRepository.scheduleRules.list({ status: 'active' }, { limit: 1000 });
  activeRules.forEach((rule) => queueRuleMaterialization(rule.companyId, rule.id));
  return activeRules.length;
}

function startWebFallback(options = {}) {
  backgroundStopped = false;
  backgroundQueueOwner = true;
  if (backgroundRepairTimer || backgroundStartupTimer) return;
  const startupDelayMs = Math.max(100, Math.min(30_000, Number(options.startupDelayMs || 1500)));
  backgroundStartupTimer = setTimeout(() => {
    backgroundStartupTimer = null;
    queueAllActiveRules().catch((error) => logger.warn('Initial rolling departure repair scan failed', { error: error.message }));
  }, startupDelayMs);
  backgroundStartupTimer.unref?.();
  backgroundRepairTimer = setInterval(() => {
    queueAllActiveRules().catch((error) => logger.warn('Rolling departure repair scan failed', { error: error.message }));
  }, BACKGROUND_REPAIR_INTERVAL_MS);
  backgroundRepairTimer.unref?.();
}

function stopWebFallback() {
  backgroundStopped = true;
  backgroundQueueOwner = false;
  if (backgroundStartupTimer) clearTimeout(backgroundStartupTimer);
  if (backgroundRepairTimer) clearInterval(backgroundRepairTimer);
  if (backgroundDrainTimer) clearTimeout(backgroundDrainTimer);
  backgroundStartupTimer = null;
  backgroundRepairTimer = null;
  backgroundDrainTimer = null;
  backgroundQueue.clear();
  for (const timer of rollingCacheInvalidationTimers.values()) clearTimeout(timer);
  rollingCacheInvalidationTimers.clear();
  publicationBlockerCooldown.clear();
}

module.exports = {
  run,
  materializeRule,
  materializeRuleWithLease,
  materializeRuleById,
  ROLLING_WINDOW_DAYS,
  HORIZON_DAYS,
  startOfDay,
  matchingFutureDates,
  queueRuleMaterialization,
  queueAllActiveRules,
  startWebFallback,
  stopWebFallback,
};
