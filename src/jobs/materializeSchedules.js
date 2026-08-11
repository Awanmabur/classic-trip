const busOperationsRepository = require('../repositories/domain/busOperationsRepository');
const repositories = require('../repositories');
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
const BACKGROUND_REPAIR_INTERVAL_MS = 30 * 60 * 1000;
const BACKGROUND_BATCH_PAUSE_MS = 2000;
const PUBLICATION_BLOCKER_COOLDOWN_MS = 5 * 60 * 1000;
const VEHICLE_CONFLICT_BLOCKER_COOLDOWN_MS = 15 * 60 * 1000;
const FULL_WINDOW_CONFLICT_RECHECK_MS = 6 * 60 * 60 * 1000;
const ROLLING_CONFLICT_LOG_COOLDOWN_MS = 30 * 60 * 1000;
const backgroundQueue = new Map();
const rollingCacheInvalidationTimers = new Map();
const publicationBlockerCooldown = new Map();
const rollingConflictLogCooldown = new Map();
let backgroundQueueRunning = false;
let backgroundRepairTimer = null;
let backgroundStartupTimer = null;
let backgroundDrainTimer = null;
let backgroundStopped = false;
let backgroundQueueOwner = false;
let mongoQueuePauseUntil = 0;
let mongoQueuePauseAttempts = 0;
let mongoQueuePauseLoggedUntil = 0;

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

function isMongoUnavailable(error = {}) {
  const status = Number(error.status || 0);
  const code = String(error.code || '').toLowerCase();
  const message = String(error.message || error || '');
  return code === 'mongodb_unavailable'
    || status === 503
    || /mongodb is unavailable|server selection|getaddrinfo|enotfound|connection pool|wait queue/i.test(message);
}

function isTransientFailure(error = {}) {
  const status = Number(error.status || 0);
  const message = String(error.message || error || '');
  return status >= 500
    || /connection|pool|wait queue|timed out|network|server selection|not primary|write conflict/i.test(message);
}

function pauseMongoQueue(error = {}) {
  mongoQueuePauseAttempts = Math.min(8, mongoQueuePauseAttempts + 1);
  const delayMs = Math.min(5 * 60 * 1000, 15_000 * (2 ** Math.max(0, mongoQueuePauseAttempts - 1)));
  mongoQueuePauseUntil = Math.max(mongoQueuePauseUntil, Date.now() + delayMs);
  if (mongoQueuePauseLoggedUntil < mongoQueuePauseUntil) {
    mongoQueuePauseLoggedUntil = mongoQueuePauseUntil;
    logger.warn('Rolling departure queue paused because MongoDB is unavailable', {
      queuedRules: backgroundQueue.size,
      retryAt: new Date(mongoQueuePauseUntil).toISOString(),
      error: String(error.message || error || 'MongoDB unavailable'),
    });
  }
  return delayMs;
}

function resetMongoQueuePause() {
  mongoQueuePauseUntil = 0;
  mongoQueuePauseAttempts = 0;
  mongoQueuePauseLoggedUntil = 0;
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


function vehicleConflictFailures(failures = []) {
  return (failures || []).filter((failure) => /vehicle_schedule_conflict|vehicle is already assigned|overlapping departure/i.test(String(failure || '')));
}

function activePersistentBlocker(rule = {}, now = new Date()) {
  const until = rule.materializationBlockedUntil ? new Date(rule.materializationBlockedUntil) : null;
  // Vehicle conflicts are date-specific. One conflicting date must never freeze
  // the whole 30-day rolling window; the materializer rechecks each date and
  // continues to later dates that are free. Older persisted vehicle blockers
  // from v1.6.32 are therefore treated as advisory only.
  if (rule.materializationBlockerCode === 'vehicle_schedule_conflict') return null;
  const requiresAction = rule.materializationRequiresAction === true;
  if (!rule.materializationBlockerCode) return null;
  // Every persisted rolling blocker is time-bounded. A vehicle overlap may be
  // real when discovered, but the conflicting dated departure can later pass,
  // be reassigned, or be edited. Once the cooldown expires the worker must
  // automatically recheck the rule instead of freezing the rolling month until
  // an operator manually resumes it.
  if (until && !Number.isNaN(until.getTime()) && until <= now) return null;
  if (!requiresAction && (!until || Number.isNaN(until.getTime()))) return null;
  return {
    code: rule.materializationBlockerCode,
    reason: rule.materializationBlockerReason || 'Recurring departure materialization is blocked until the rule is corrected',
    failures: Array.isArray(rule.materializationBlockerFailures) ? rule.materializationBlockerFailures : [],
    until: until && !Number.isNaN(until.getTime()) ? until : new Date(now.getTime() + VEHICLE_CONFLICT_BLOCKER_COOLDOWN_MS),
    requiresAction,
    ruleIds: Array.isArray(rule.materializationBlockerRuleIds) ? rule.materializationBlockerRuleIds.filter(Boolean) : [],
  };
}

async function persistVehicleConflictBlocker(rule, failures = []) {
  const conflicts = vehicleConflictFailures(failures);
  if (!conflicts.length) return { blocked: false, persisted: false };
  // Re-read before writing because the queue and cron can discover the same rule.
  // Never extend an existing active blocker: one deterministic overlap gets one
  // cooldown window until the operator edits/resumes the rule.
  const current = await busOperationsRepository.scheduleRules.findOne({ id: rule.id, companyId: rule.companyId });
  const existingBlocker = activePersistentBlocker(current || rule, new Date());
  if (existingBlocker) {
    return {
      blocked: true,
      persisted: false,
      blockedUntil: existingBlocker.until.toISOString(),
      failures: existingBlocker.failures.length ? existingBlocker.failures : conflicts.slice(0, 8),
    };
  }
  const blockedUntil = new Date(Date.now() + VEHICLE_CONFLICT_BLOCKER_COOLDOWN_MS).toISOString();
  const updateResult = await busOperationsRepository.scheduleRules.updateOne({
    id: rule.id,
    companyId: rule.companyId,
    $or: [
      { materializationBlockedUntil: { $exists: false } },
      { materializationBlockedUntil: null },
      { materializationBlockedUntil: { $lte: new Date() } },
    ],
  }, {
    $set: {
      materializationBlockedAt: new Date().toISOString(),
      materializationBlockedUntil: blockedUntil,
      materializationBlockerCode: 'vehicle_schedule_conflict',
      materializationBlockerReason: conflicts[0],
      materializationBlockerFailures: conflicts.slice(0, 8),
      materializationRequiresAction: true,
      materializationStateUpdatedAt: new Date().toISOString(),
    },
  });
  if (!Number(updateResult?.matchedCount || updateResult?.n || 0)) {
    const winner = await busOperationsRepository.scheduleRules.findOne({ id: rule.id, companyId: rule.companyId });
    const winnerBlocker = activePersistentBlocker(winner || {}, new Date());
    if (winnerBlocker) return {
      blocked: true,
      persisted: false,
      blockedUntil: winnerBlocker.until.toISOString(),
      failures: winnerBlocker.failures.length ? winnerBlocker.failures : conflicts.slice(0, 8),
    };
  }
  return { blocked: true, persisted: true, blockedUntil, failures: conflicts.slice(0, 8) };
}


async function persistFullWindowVehicleConflictBlocker(rule, { conflictRuleIds = [], failures = [], scannedMissingDates = 0 } = {}) {
  const blockerRuleIds = [...new Set((conflictRuleIds || []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (!blockerRuleIds.length || !scannedMissingDates) return { blocked: false, persisted: false };
  const blockedUntil = new Date(Date.now() + FULL_WINDOW_CONFLICT_RECHECK_MS).toISOString();
  const reason = blockerRuleIds.length === 1
    ? `Every missing rolling departure conflicts with departures generated by recurring rule ${blockerRuleIds[0]}. Assign another vehicle, move this departure time, or resolve the blocking rule and its already-created departures.`
    : `Every missing rolling departure conflicts with departures generated by recurring rules ${blockerRuleIds.join(', ')}. Resolve the vehicle/time overlap and any already-created departures before this rule can materialize.`;
  await busOperationsRepository.scheduleRules.updateOne(
    { id: rule.id, companyId: rule.companyId },
    {
      $set: {
        materializationBlockedAt: new Date().toISOString(),
        materializationBlockedUntil: blockedUntil,
        materializationBlockerCode: 'vehicle_schedule_conflict_window',
        materializationBlockerReason: reason,
        materializationBlockerFailures: (failures || []).slice(0, 8),
        materializationBlockerRuleIds: blockerRuleIds,
        materializationRequiresAction: true,
        materializationStateUpdatedAt: new Date().toISOString(),
      },
    },
  );
  rule.materializationBlockedUntil = blockedUntil;
  rule.materializationBlockerCode = 'vehicle_schedule_conflict_window';
  rule.materializationBlockerReason = reason;
  rule.materializationBlockerFailures = (failures || []).slice(0, 8);
  rule.materializationBlockerRuleIds = blockerRuleIds;
  rule.materializationRequiresAction = true;
  return { blocked: true, persisted: true, blockedUntil, failures: (failures || []).slice(0, 8), reason, blockerRuleIds };
}

async function clearExpiredOrResolvedBlocker(rule) {
  if (!rule.materializationBlockerCode) return;
  await busOperationsRepository.scheduleRules.updateOne({ id: rule.id, companyId: rule.companyId }, {
    $unset: {
      materializationBlockedAt: '',
      materializationBlockedUntil: '',
      materializationBlockerCode: '',
      materializationBlockerReason: '',
      materializationBlockerFailures: '',
      materializationBlockerRuleIds: '',
      materializationRequiresAction: '',
    },
    $set: { materializationStateUpdatedAt: new Date().toISOString() },
  });
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

// A "rolling 30 days" rule must not slowly lose departure instances as old
// departures pass. The target is the number of operating occurrences that the
// rule had in its original 30-calendar-day window. Daily rules therefore keep
// 30 future departures; weekday/weekly rules keep the equivalent recurrence
// count and extend the far edge by only the few days needed to replace a passed
// occurrence. This preserves the 30-day product semantics without creating 30
// weeks of inventory for a once-a-week service.
function rollingTargetDepartureCount(rule = {}) {
  const ruleStart = startOfDay(rule.startDate || new Date());
  const ruleEnd = rule.endDate ? startOfDay(rule.endDate) : null;
  const referenceEnd = new Date(ruleStart.getTime() + HORIZON_DAYS * DAY_MS);
  const cappedEnd = ruleEnd && ruleEnd < referenceEnd ? ruleEnd : referenceEnd;
  let count = 0;
  let day = new Date(ruleStart);
  while (day <= cappedEnd) {
    if (!rule.daysOfWeek?.length || rule.daysOfWeek.includes(day.getDay())) count += 1;
    day = new Date(day.getTime() + DAY_MS);
  }
  return Math.max(0, Math.min(ROLLING_WINDOW_DAYS, count));
}

function rollingWindowBounds(rule, horizonEnd, now) {
  const ruleStart = startOfDay(rule.startDate);
  const ruleEnd = rule.endDate ? startOfDay(rule.endDate) : null;
  const today = startOfDay(now);
  let cursor = ruleStart > today ? new Date(ruleStart) : today;
  let effectiveHorizonEnd = startOfDay(horizonEnd);
  let replacedDepartedDate = false;
  const todayMatchesRule = ruleStart <= today
    && (!ruleEnd || ruleEnd >= today)
    && (!rule.daysOfWeek?.length || rule.daysOfWeek.includes(today.getDay()));
  if (cursor.getTime() === today.getTime() && todayMatchesRule) {
    const todayDeparture = combineDateAndTime(today, rule.departureTime);
    if (todayDeparture.getTime() <= now.getTime()) {
      cursor = new Date(today.getTime() + DAY_MS);
      effectiveHorizonEnd = new Date(effectiveHorizonEnd.getTime() + DAY_MS);
      replacedDepartedDate = true;
    }
  }
  let windowEnd = ruleEnd && ruleEnd < effectiveHorizonEnd ? ruleEnd : effectiveHorizonEnd;
  const targetDepartureCount = rollingTargetDepartureCount(rule);
  // Keep the original recurrence count stable. A weekly pattern can lose one
  // departure even though the calendar horizon advanced by one day, so extend
  // the far edge just until the replacement matching weekday enters the window.
  // A seven-day recurrence means six extra scan days is normally sufficient;
  // use a bounded 14-day guard for edited legacy rules and unusual start dates.
  let futureCount = matchingFutureDates(rule, cursor, windowEnd, now).length;
  let extensionDays = 0;
  while (futureCount < targetDepartureCount && extensionDays < 14 && (!ruleEnd || windowEnd < ruleEnd)) {
    const nextEnd = new Date(windowEnd.getTime() + DAY_MS);
    windowEnd = ruleEnd && ruleEnd < nextEnd ? ruleEnd : nextEnd;
    extensionDays += 1;
    const matchesWeekday = !rule.daysOfWeek?.length || rule.daysOfWeek.includes(windowEnd.getDay());
    if (matchesWeekday && combineDateAndTime(windowEnd, rule.departureTime).getTime() > now.getTime()) futureCount += 1;
    if (ruleEnd && windowEnd.getTime() >= ruleEnd.getTime()) break;
  }
  return { cursor, windowEnd, replacedDepartedDate, targetDepartureCount, extensionDays };
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

function sameRollingDeparture(schedule = {}, rule = {}, departAt) {
  const sameRoute = String(schedule.routeId || schedule.routeSnapshot?.routeId || '') === String(rule.routeId || '');
  const sameVehicle = String(schedule.vehicleId || '') === String(rule.vehicleId || '');
  const existingTime = new Date(schedule.departAt || 0).getTime();
  return sameRoute && sameVehicle && Number.isFinite(existingTime) && existingTime === departAt.getTime();
}

function vehicleConflictsFromRows(rows = [], departAt, arriveAt) {
  const startMs = new Date(departAt).getTime();
  const endMs = new Date(arriveAt || new Date(startMs + DAY_MS)).getTime();
  return (rows || []).filter((row) => {
    const rowStart = new Date(row.departAt || 0).getTime();
    const rowEnd = row.arriveAt ? new Date(row.arriveAt).getTime() : rowStart + DAY_MS;
    return Number.isFinite(rowStart) && Number.isFinite(rowEnd) && startMs < rowEnd && rowStart < endMs;
  });
}

function rollingConflictSignature(result = {}) {
  const details = Array.isArray(result.conflictDetails) ? result.conflictDetails : [];
  return JSON.stringify({
    pending: Number(result.pending || 0),
    skipped: Number(result.skipped || 0),
    noFreeDateFound: result.noFreeDateFound === true,
    conflicts: details.slice(0, 8).map((item) => [item.requestedDepartAt, item.conflictingScheduleId, item.conflictingRuleId]),
  });
}

function shouldLogRollingConflict(ruleKey, result = {}) {
  const signature = rollingConflictSignature(result);
  const previous = rollingConflictLogCooldown.get(ruleKey);
  const nowMs = Date.now();
  if (previous && previous.signature === signature && previous.expiresAt > nowMs) return false;
  rollingConflictLogCooldown.set(ruleKey, {
    signature,
    expiresAt: nowMs + ROLLING_CONFLICT_LOG_COOLDOWN_MS,
  });
  return true;
}

async function materializeRule(rule, horizonEnd, now, options = {}) {
  // Re-evaluate the complete live window on every run. A watermark-only cursor
  // cannot repair a date that was deleted, cancelled, or skipped after a
  // transient setup conflict. If today's matching departure already left, the
  // far edge also advances one day immediately.
  const { cursor, windowEnd } = rollingWindowBounds(rule, horizonEnd, now);
  if (rule.materializationBlockerCode === 'vehicle_schedule_conflict'
      || (rule.materializationBlockerCode && !activePersistentBlocker(rule, now))) {
    await clearExpiredOrResolvedBlocker(rule);
    rule.materializationBlockerCode = '';
    rule.materializationBlockerReason = '';
    rule.materializationBlockerFailures = [];
    rule.materializationBlockerRuleIds = [];
    rule.materializationBlockedUntil = null;
    rule.materializationRequiresAction = false;
  }
  const persistedBlocker = activePersistentBlocker(rule, now);
  if (persistedBlocker) {
    return {
      created: 0, published: 0, draft: 0, skipped: 0, expected: 0, existing: 0, pending: 0,
      failures: persistedBlocker.failures.length ? persistedBlocker.failures : [persistedBlocker.reason],
      blocked: true, blockedUntil: persistedBlocker.until.toISOString(), blockerCode: persistedBlocker.code,
      blockerReason: persistedBlocker.reason, blockerRuleIds: persistedBlocker.ruleIds || [],
    };
  }
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
  const failures = new Set(draftReconciliation.failures || []);
  const dates = [];
  const conflictDetails = [];
  const recurringConflictRuleIds = new Set();
  let recurringConflictDates = 0;
  let coveredByExistingDeparture = 0;
  let skipped = 0;
  let scannedMissingDates = 0;
  // Preload the vehicle's relevant dated departures once. The old worker issued
  // one overlap query per candidate date and, with maxCreates=1, stopped after
  // the first 10 conflicts. That could permanently starve dates 11-30 even when
  // a later day was free. Scan the complete missing window but still create only
  // the configured small batch size.
  const earliestMissing = missingDates[0] || null;
  const latestMissing = missingDates[missingDates.length - 1] || null;
  const conflictRows = earliestMissing && latestMissing
    ? await busOperationsRepository.schedules.list({
      companyId: rule.companyId,
      vehicleId: rule.vehicleId,
      status: { $in: ['draft', 'active', 'published', 'boarding', 'delayed', 'departed'] },
      departAt: {
        $gt: new Date(earliestMissing.getTime() - (7 * DAY_MS)),
        $lt: new Date(latestMissing.getTime() + DAY_MS),
      },
    }, { sort: { departAt: 1 }, limit: ROLLING_WINDOW_DAYS * 20 })
    : [];
  for (const departAt of missingDates) {
    scannedMissingDates += 1;
    const arriveAt = rule.durationMinutes ? new Date(departAt.getTime() + rule.durationMinutes * 60000) : undefined;
    const conflicts = vehicleConflictsFromRows(conflictRows, departAt, arriveAt);
    const exactExistingDeparture = conflicts.find((schedule) => sameRollingDeparture(schedule, rule, departAt));
    if (exactExistingDeparture) {
      coveredByExistingDeparture += 1;
      continue;
    }
    if (conflicts.length) {
      skipped += 1;
      failures.add(`vehicle_time_conflict:${departAt.toISOString()}`);
      const recurringConflict = conflicts.find((schedule) => String(schedule.scheduleRuleId || '').trim());
      if (recurringConflict) {
        recurringConflictDates += 1;
        recurringConflictRuleIds.add(String(recurringConflict.scheduleRuleId || '').trim());
      }
      if (conflictDetails.length < 8) {
        const conflict = recurringConflict || conflicts[0];
        conflictDetails.push({
          requestedDepartAt: departAt.toISOString(),
          conflictingScheduleId: String(conflict.id || ''),
          conflictingRuleId: String(conflict.scheduleRuleId || ''),
          conflictingRouteId: String(conflict.routeId || conflict.routeSnapshot?.routeId || ''),
          conflictingDepartAt: conflict.departAt ? new Date(conflict.departAt).toISOString() : '',
          conflictingArriveAt: conflict.arriveAt ? new Date(conflict.arriveAt).toISOString() : '',
        });
      }
      continue;
    }
    dates.push(departAt);
    if (maxCreates > 0 && dates.length >= maxCreates) break;
  }
  const pending = Math.max(0, missingDates.length - coveredByExistingDeparture - dates.length);
  let created = 0;
  let published = reconciled.published + draftReconciliation.published;
  let draft = reconciled.draft;

  const canUseInitialContiguousBatch = dates.length
    && existingSchedules.length === 0
    && skipped === 0
    && coveredByExistingDeparture === 0
    && dates.length === missingDates.length;

  if (canUseInitialContiguousBatch) {
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
    // Create/repair only the preflight-approved dates. This branch is also used
    // for a brand-new window when one or more dates were skipped because of a
    // vehicle overlap, so a range batch can never recreate a deliberately
    // skipped conflict date between two valid dates.
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

  const unresolvedPending = pending + Math.max(0, dates.length - created);
  const finalFailures = [...failures].slice(0, 8);
  if (finalFailures.length && draft > 0) {
    publicationBlockerCooldown.set(ruleKey, {
      failures: finalFailures,
      expiresAt: Date.now() + PUBLICATION_BLOCKER_COOLDOWN_MS,
    });
  } else if (!finalFailures.length && published > 0) {
    publicationBlockerCooldown.delete(ruleKey);
  }
  // A conflict on only some dates remains date-specific and never freezes the
  // rolling window. If every missing date is blocked by active recurring rules,
  // however, repeatedly scanning the same 30 dates cannot make progress. Persist
  // a rule-wide action state and automatically clear it when a blocking rule is
  // edited/paused; a six-hour safety expiry also forces a periodic re-check.
  const noFreeDateFound = missingDates.length > 0
    && dates.length === 0
    && skipped > 0
    && scannedMissingDates >= missingDates.length;
  let blockerResult = { blocked: false, persisted: false };
  if (noFreeDateFound && recurringConflictDates === skipped && recurringConflictRuleIds.size > 0) {
    blockerResult = await persistFullWindowVehicleConflictBlocker(rule, {
      conflictRuleIds: [...recurringConflictRuleIds],
      failures: finalFailures,
      scannedMissingDates,
    });
  }
  await companyService.recordScheduleRuleMaterialization(rule.companyId, rule.id, windowEnd.toISOString());
  return {
    created,
    published,
    draft,
    skipped,
    expected: expectedDates.length,
    existing: expectedDates.length - missingDates.length,
    pending: unresolvedPending,
    failures: finalFailures,
    reconciled: reconciled.published + reconciled.draft + draftReconciliation.published,
    blocked: blockerResult.blocked,
    blockerPersisted: blockerResult.persisted,
    blockedUntil: blockerResult.blockedUntil || '',
    blockerCode: blockerResult.blocked ? 'vehicle_schedule_conflict_window' : '',
    blockerReason: blockerResult.reason || '',
    blockerRuleIds: blockerResult.blockerRuleIds || [],
    conflictDetails,
    scannedMissingDates,
    noFreeDateFound,
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
  const activeRules = await busOperationsRepository.scheduleRules.list({ status: 'active' }, { limit: 1000 });
  const blockedRules = activeRules.filter((rule) => activePersistentBlocker(rule, now));
  const eligibleRules = activeRules.filter((rule) => !activePersistentBlocker(rule, now));

  // In the dedicated worker, the low-priority queue owns date creation. The
  // cron callback only discovers and queues eligible rules, so it cannot spend
  // 45 seconds creating departures or compete with dashboard/payment traffic.
  if (backgroundQueueOwner) {
    let queued = 0;
    eligibleRules.forEach((rule) => {
      if (queueRuleMaterialization(rule.companyId, rule.id)) queued += 1;
    });
    return {
      rulesConsidered: activeRules.length,
      rulesBlocked: blockedRules.length,
      rulesQueued: queued,
      rollingWindowDays: ROLLING_WINDOW_DAYS,
      schedulesCreated: 0,
      schedulesPublished: 0,
      schedulesDraft: 0,
      legacySchedulesReconciled: 0,
      daysSkipped: 0,
      results: [],
    };
  }

  // CLI/tests without a queue owner still receive bounded synchronous work.
  const deadline = Date.now() + 25_000;
  let totalCreated = 0;
  let totalPublished = 0;
  let totalDraft = 0;
  let totalSkipped = 0;
  let totalReconciled = 0;
  const results = [];
  for (const rule of eligibleRules) {
    if (Date.now() >= deadline) break;
    // eslint-disable-next-line no-await-in-loop
    const result = await materializeRuleWithLease(rule, horizonEnd, now, { maxCreates: BACKGROUND_BATCH_SIZE });
    const { created = 0, published = 0, draft = 0, skipped = 0, reconciled = 0, pending = 0 } = result;
    totalCreated += created;
    totalPublished += published;
    totalDraft += draft;
    totalSkipped += skipped;
    totalReconciled += reconciled;
    if (created || skipped || reconciled || pending) results.push({ ruleId: rule.id, created, published, draft, skipped, reconciled, pending });
  }
  return {
    rulesConsidered: activeRules.length,
    rulesBlocked: blockedRules.length,
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
  const mongoDelayMs = Math.max(0, mongoQueuePauseUntil - Date.now());
  backgroundDrainTimer = setTimeout(() => {
    backgroundDrainTimer = null;
    drainBackgroundQueue().catch((error) => logger.error('Rolling departure background queue failed', { error: error.message, stack: error.stack }));
  }, Math.max(0, Number(delayMs || 0), mongoDelayMs));
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
      if (mongoQueuePauseUntil > Date.now()) break;
      const [key, job] = backgroundQueue.entries().next().value;
      backgroundQueue.delete(key);
      let result;
      try {
        result = await materializeRuleById(job.companyId, job.ruleId, new Date(), {
          waitForLeaseMs: 5000,
          maxCreates: BACKGROUND_BATCH_SIZE,
        });
      } catch (error) {
        if (isMongoUnavailable(error)) {
          // One Atlas/DNS outage affects every rule. Put the current item back,
          // pause the whole queue once, and never flood the log by retrying each
          // schedule rule separately while the connection is down.
          backgroundQueue.set(key, job);
          pauseMongoQueue(error);
          break;
        }
        job.attempts += 1;
        logger.warn('Rolling departure batch failed and will retry', {
          companyId: job.companyId,
          ruleId: job.ruleId,
          attempts: job.attempts,
          stage: error.rollingStage || 'materialize_rule',
          code: error.code || '',
          error: error.message,
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
      resetMongoQueuePause();
      if (result?.busy) {
        job.attempts += 1;
        if (job.attempts < 8) backgroundQueue.set(key, job);
        await sleep(750);
        continue;
      }
      if (result?.blocked) {
        if (result.blockerPersisted) {
          const fullWindowConflict = result.blockerCode === 'vehicle_schedule_conflict_window';
          logger.warn(
            fullWindowConflict
              ? 'Recurring departure rule needs action; repeated full-window conflict scans are paused'
              : 'Rolling departure rule temporarily paused by a rule-wide blocker',
            {
              companyId: job.companyId,
              ruleId: job.ruleId,
              blockedUntil: result.blockedUntil || '',
              blockingRuleIds: result.blockerRuleIds || [],
              reason: result.blockerReason || '',
              failures: fullWindowConflict ? (result.failures || []).slice(0, 2) : (result.failures || []),
              action: fullWindowConflict
                ? 'Change this vehicle/time, or resolve the blocking recurring rule and its already-created departures; the worker will then retry automatically.'
                : undefined,
            },
          );
        }
        continue;
      }
      const completedSummary = {
        companyId: job.companyId,
        ruleId: job.ruleId,
        created: Number(result?.created || 0),
        published: Number(result?.published || 0),
        draft: Number(result?.draft || 0),
        existing: Number(result?.existing || 0),
        pending: Number(result?.pending || 0),
        skipped: Number(result?.skipped || 0),
      };
      if (completedSummary.skipped && Array.isArray(result?.failures) && result.failures.length) {
        if (shouldLogRollingConflict(key, result)) {
          logger.warn(
            result.noFreeDateFound
              ? 'Rolling window has no free missing date for this vehicle'
              : 'Rolling departure date deferred; later free dates continue materializing',
            {
              ...completedSummary,
              scannedMissingDates: Number(result?.scannedMissingDates || 0),
              conflicts: Array.isArray(result?.conflictDetails) ? result.conflictDetails : [],
              failures: result.failures,
              action: result.noFreeDateFound
                ? 'Assign another vehicle, change the recurring time, or pause the conflicting recurring rule.'
                : 'Conflicting dates stay deferred; the worker continues to the next free missing date.',
            },
          );
        } else {
          logger.debug('Repeated rolling vehicle-conflict warning suppressed during cooldown', {
            ...completedSummary,
            scannedMissingDates: Number(result?.scannedMissingDates || 0),
          });
        }
      } else if (completedSummary.created || completedSummary.published || completedSummary.draft || completedSummary.pending) {
        logger.info('Rolling departure batch completed', completedSummary);
      } else {
        logger.debug('Rolling departure rule already current', completedSummary);
      }
      const pending = Number(result?.pending || 0);
      const created = Number(result?.created || 0);
      const skipped = Number(result?.skipped || 0);
      if (pending > 0 && created > 0) {
        job.attempts = 0;
        backgroundQueue.set(key, job);
      } else if (pending > 0 && skipped > 0) {
        // Permanent validation failures do not hot-loop. Deterministic vehicle
        // overlaps are persisted above and skipped by all repair scans. Other
        // configuration errors wait for the next bounded scan without log spam.
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
    if (backgroundQueue.size) scheduleBackgroundDrain(Math.max(500, mongoQueuePauseUntil - Date.now()));
  }
}

async function queueAllActiveRules() {
  if (!repositories.mongoReady()) {
    pauseMongoQueue(new Error('MongoDB connection is not ready'));
    scheduleBackgroundDrain(mongoQueuePauseUntil - Date.now());
    return 0;
  }
  const activeRules = await busOperationsRepository.scheduleRules.list({ status: 'active' }, { limit: 1000 });
  const now = new Date();
  const eligibleRules = activeRules.filter((rule) => !activePersistentBlocker(rule, now));
  eligibleRules.forEach((rule) => queueRuleMaterialization(rule.companyId, rule.id));
  return eligibleRules.length;
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
  resetMongoQueuePause();
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
  rollingTargetDepartureCount,
  rollingWindowBounds,
  queueRuleMaterialization,
  queueAllActiveRules,
  startWebFallback,
  stopWebFallback,
};
