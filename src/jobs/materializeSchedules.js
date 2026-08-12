const busOperationsRepository = require('../repositories/domain/busOperationsRepository');
const repositories = require('../repositories');
const companyService = require('../services/company/companyService');
const busDepartureService = require('../modules/bus/services/busDepartureService');
const { parseDurationMinutes } = require('../modules/bus/domain/busDomain');
const jobLeaseService = require('../services/shared/jobLeaseService');
const logger = require('../config/logger');
const { env } = require('../config/env');

// Keep exactly one rolling month of dated departures. Today plus the following
// 29 calendar days is a 30-day window; tomorrow's run adds one new far-end day.
const ROLLING_WINDOW_DAYS = 30;
const HORIZON_DAYS = ROLLING_WINDOW_DAYS - 1;
const DAY_MS = 24 * 60 * 60 * 1000;
const RULE_LEASE_TTL_MS = 20 * 60 * 1000;
const BACKGROUND_BATCH_SIZE = ROLLING_WINDOW_DAYS;
const BACKGROUND_REPAIR_INTERVAL_MS = 60 * 60 * 1000;
const BACKGROUND_BATCH_PAUSE_MS = 50;
const PUBLICATION_BLOCKER_COOLDOWN_MS = 5 * 60 * 1000;
const VEHICLE_CONFLICT_BLOCKER_COOLDOWN_MS = 15 * 60 * 1000;
const ROLLING_CONFLICT_LOG_COOLDOWN_MS = 6 * 60 * 60 * 1000;
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


function dateKey(value) {
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : '';
}

function normalizedRuleList(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))].sort();
}

function exactRollingRuleSignature(rule = {}) {
  return JSON.stringify({
    companyId: String(rule.companyId || ''),
    listingId: String(rule.listingId || ''),
    routeId: String(rule.routeId || ''),
    vehicleId: String(rule.vehicleId || ''),
    seatMapVersionId: String(rule.seatMapVersionId || ''),
    fareProductId: String(rule.fareProductId || ''),
    departureTime: String(rule.departureTime || ''),
    daysOfWeek: normalizedRuleList(rule.daysOfWeek).map(Number).sort((a, b) => a - b),
    startDate: dateKey(rule.startDate),
    endDate: dateKey(rule.endDate),
    durationMinutes: Number(rule.durationMinutes || 0),
    fareClass: String(rule.fareClass || ''),
    blockedSeats: normalizedRuleList(rule.blockedSeats),
    driverIds: normalizedRuleList(rule.driverIds),
  });
}

function rollingRuleCreatedTime(rule = {}) {
  const value = new Date(rule.createdAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function recurringMinutes(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return (hour * 60) + minute;
}

function recurringDaysOverlap(left = {}, right = {}) {
  const a = Array.isArray(left.daysOfWeek) && left.daysOfWeek.length ? new Set(left.daysOfWeek.map(Number)) : new Set([0,1,2,3,4,5,6]);
  const b = Array.isArray(right.daysOfWeek) && right.daysOfWeek.length ? new Set(right.daysOfWeek.map(Number)) : new Set([0,1,2,3,4,5,6]);
  return [...a].some((day) => b.has(day));
}

function recurringDateRangesOverlap(left = {}, right = {}) {
  const aStart = startOfDay(left.startDate || 0).getTime();
  const bStart = startOfDay(right.startDate || 0).getTime();
  const aEnd = left.endDate ? startOfDay(left.endDate).getTime() : Number.POSITIVE_INFINITY;
  const bEnd = right.endDate ? startOfDay(right.endDate).getTime() : Number.POSITIVE_INFINITY;
  return aStart <= bEnd && bStart <= aEnd;
}

function recurringTimesOverlap(left = {}, right = {}) {
  const aStart = recurringMinutes(left.departureTime);
  const bStart = recurringMinutes(right.departureTime);
  if (aStart === null || bStart === null) return false;
  const aDuration = Math.max(1, Number(left.durationMinutes || 0));
  const bDuration = Math.max(1, Number(right.durationMinutes || 0));
  for (const shiftedB of [bStart - 1440, bStart, bStart + 1440]) {
    if (aStart < shiftedB + bDuration && shiftedB < aStart + aDuration) return true;
  }
  return false;
}

function sameRecurringService(left = {}, right = {}) {
  return String(left.companyId || '') === String(right.companyId || '')
    && String(left.listingId || '') === String(right.listingId || '')
    && String(left.routeId || '') === String(right.routeId || '')
    && String(left.vehicleId || '') === String(right.vehicleId || '');
}

async function pauseDormantOverlappingRules(activeRules = [], now = new Date()) {
  // A partner can accidentally create a second rolling rule a few minutes away
  // from an existing rule for the same route and physical vehicle. If the newer
  // rule owns no future departures, it is redundant setup noise, not a second
  // service. Pause it once instead of scanning/conflicting against all 30 dates.
  const rules = [...(activeRules || [])];
  for (const rule of rules) {
    // eslint-disable-next-line no-await-in-loop
    await hydrateLegacyRuleDuration(rule);
  }
  rules.sort((a, b) => rollingRuleCreatedTime(a) - rollingRuleCreatedTime(b) || String(a.id || '').localeCompare(String(b.id || '')));
  const kept = [];
  const pausedIds = new Set();
  for (const candidate of rules) {
    const canonical = kept.find((existing) => sameRecurringService(existing, candidate)
      && recurringDaysOverlap(existing, candidate)
      && recurringDateRangesOverlap(existing, candidate)
      && recurringTimesOverlap(existing, candidate));
    if (!canonical) {
      kept.push(candidate);
      continue;
    }
    // Never auto-pause a rule that already owns future inventory. That may carry
    // bookings and requires an operator decision. The repair only removes a
    // dormant duplicate that has not created a real future trip.
    // eslint-disable-next-line no-await-in-loop
    const futureCount = await busOperationsRepository.schedules.count({
      companyId: candidate.companyId,
      scheduleRuleId: candidate.id,
      status: { $nin: ['archived', 'cancelled', 'completed'] },
      departAt: { $gt: now },
    });
    if (Number(futureCount || 0) > 0) {
      kept.push(candidate);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    await busOperationsRepository.scheduleRules.updateOne({ id: candidate.id, companyId: candidate.companyId, status: 'active' }, {
      $set: {
        status: 'paused',
        statusReason: `Automatically paused because it overlaps recurring rule ${canonical.id} for the same route and vehicle`,
        updatedBy: 'rolling-rule-normalizer',
        updatedAt: new Date().toISOString(),
        materializationStateUpdatedAt: new Date().toISOString(),
      },
      $unset: {
        materializationBlockedAt: '',
        materializationBlockedUntil: '',
        materializationBlockerCode: '',
        materializationBlockerReason: '',
        materializationBlockerFailures: '',
        materializationBlockerRuleIds: '',
        materializationRequiresAction: '',
      },
    });
    pausedIds.add(String(candidate.id || ''));
    logger.warn('Paused redundant overlapping recurring rule', {
      companyId: candidate.companyId,
      pausedRuleId: candidate.id,
      canonicalRuleId: canonical.id,
      routeId: candidate.routeId,
      vehicleId: candidate.vehicleId,
    });
  }
  return rules.filter((rule) => !pausedIds.has(String(rule.id || '')));
}

async function hydrateLegacyRuleDuration(rule = {}) {
  const currentDuration = Number(rule.durationMinutes || 0);
  if (currentDuration > 0 || !rule.routeId || !rule.companyId) return rule;
  const route = await busOperationsRepository.routes.findOne({ id: rule.routeId, companyId: rule.companyId });
  if (!route) return rule;
  const routeDuration = Number(route.estimatedDurationMinutes || parseDurationMinutes(route.estimatedDuration, 0) || 0);
  if (!(routeDuration > 0)) return rule;
  await busOperationsRepository.scheduleRules.updateOne({ id: rule.id, companyId: rule.companyId }, {
    $set: {
      durationMinutes: routeDuration,
      materializationStateUpdatedAt: new Date().toISOString(),
    },
  });
  rule.durationMinutes = routeDuration;
  return rule;
}

async function pauseDormantExactDuplicateRules(activeRules = [], now = new Date()) {
  const groups = new Map();
  (activeRules || []).forEach((rule) => {
    const signature = exactRollingRuleSignature(rule);
    if (!groups.has(signature)) groups.set(signature, []);
    groups.get(signature).push(rule);
  });
  const pausedIds = new Set();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => rollingRuleCreatedTime(a) - rollingRuleCreatedTime(b) || String(a.id || '').localeCompare(String(b.id || '')));
    const canonical = group[0];
    for (const duplicate of group.slice(1)) {
      // Only auto-pause a provably redundant legacy rule that owns no live
      // future departures. Anything with its own dated inventory is left for an
      // operator because moving/deleting booked schedules automatically is unsafe.
      // eslint-disable-next-line no-await-in-loop
      const futureCount = await busOperationsRepository.schedules.count({
        companyId: duplicate.companyId,
        scheduleRuleId: duplicate.id,
        status: { $nin: ['archived', 'cancelled', 'completed'] },
        departAt: { $gt: now },
      });
      if (Number(futureCount || 0) > 0) continue;
      // eslint-disable-next-line no-await-in-loop
      await busOperationsRepository.scheduleRules.updateOne({ id: duplicate.id, companyId: duplicate.companyId, status: 'active' }, {
        $set: {
          status: 'paused',
          updatedBy: 'rolling-rule-normalizer',
          updatedAt: new Date().toISOString(),
          materializationStateUpdatedAt: new Date().toISOString(),
        },
        $unset: {
          materializationBlockedAt: '',
          materializationBlockedUntil: '',
          materializationBlockerCode: '',
          materializationBlockerReason: '',
          materializationBlockerFailures: '',
          materializationBlockerRuleIds: '',
          materializationRequiresAction: '',
        },
      });
      // eslint-disable-next-line no-await-in-loop
      await busOperationsRepository.audit({
        actorId: 'rolling-rule-normalizer',
        action: 'bus.schedule_rule.legacy_duplicate_paused',
        targetId: duplicate.id,
        meta: { companyId: duplicate.companyId, canonicalRuleId: canonical.id },
      }).catch(() => null);
      pausedIds.add(String(duplicate.id || ''));
      logger.warn('Paused dormant duplicate recurring rule; canonical rolling rule remains active', {
        companyId: duplicate.companyId,
        duplicateRuleId: duplicate.id,
        canonicalRuleId: canonical.id,
      });
    }
  }
  return (activeRules || []).filter((rule) => !pausedIds.has(String(rule.id || '')));
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
  if (String(rule.materializationBlockerCode || '').startsWith('vehicle_schedule_conflict')) return null;
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
    conflicts: details.slice(0, 2).map((item) => [item.requestedDepartAt, item.conflictingScheduleId, item.conflictingRuleId]),
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
  await hydrateLegacyRuleDuration(rule);
  // Re-evaluate the complete live window on every run. A watermark-only cursor
  // cannot repair a date that was deleted, cancelled, or skipped after a
  // transient setup conflict. If today's matching departure already left, the
  // far edge also advances one day immediately.
  const { cursor, windowEnd } = rollingWindowBounds(rule, horizonEnd, now);
  if (String(rule.materializationBlockerCode || '').startsWith('vehicle_schedule_conflict')
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
      failures.add('vehicle_time_conflict');
      const recurringConflict = conflicts.find((schedule) => String(schedule.scheduleRuleId || '').trim());
      if (recurringConflict) {
        recurringConflictDates += 1;
        recurringConflictRuleIds.add(String(recurringConflict.scheduleRuleId || '').trim());
      }
      if (conflictDetails.length < 2) {
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
  // Vehicle overlaps remain date-specific. Never freeze the recurring rule for
  // hours: a blocking departure can pass, be edited, or be reassigned at any
  // time. The one-minute scheduler plus five-minute repair scan re-evaluates the
  // gap automatically, while a real overlap is still rejected for safety.
  const noFreeDateFound = missingDates.length > 0
    && dates.length === 0
    && skipped > 0
    && scannedMissingDates >= missingDates.length;
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
    blocked: false,
    blockerPersisted: false,
    blockedUntil: '',
    blockerCode: '',
    blockerReason: '',
    blockerRuleIds: [...recurringConflictRuleIds],
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

async function normalizeActiveRules(now = new Date()) {
  const before = await busOperationsRepository.scheduleRules.list({ status: 'active' }, { limit: 1000 });
  let activeRules = await pauseDormantExactDuplicateRules(before, now);
  activeRules = await pauseDormantOverlappingRules(activeRules, now);
  return {
    activeRules,
    activeBefore: before.length,
    activeAfter: activeRules.length,
    paused: Math.max(0, before.length - activeRules.length),
  };
}

async function run(now = new Date()) {
  const horizonEnd = startOfDay(new Date(now.getTime() + HORIZON_DAYS * DAY_MS));
  const normalized = await normalizeActiveRules(now);
  const activeRules = normalized.activeRules;
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
  for (const rule of eligibleRules.slice(0, env.jobs.materializeRuleBatchSize)) {
    if (Date.now() >= deadline) break;
    // eslint-disable-next-line no-await-in-loop
    const result = await materializeRuleWithLease(rule, horizonEnd, now, { maxCreates: 2 });
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
          logger.warn('Rolling departure rule temporarily paused by a non-vehicle rule-wide blocker', {
            companyId: job.companyId,
            ruleId: job.ruleId,
            blockedUntil: result.blockedUntil || '',
            reason: result.blockerReason || '',
            failures: result.failures || [],
          });
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
        // A real vehicle overlap cannot be auto-created safely. Do not hot-loop,
        // but do not freeze the rule either: the five-minute recovery scan will
        // re-evaluate it after the conflicting trip passes or is edited.
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
  const now = new Date();
  let activeRules = await busOperationsRepository.scheduleRules.list({ status: 'active' }, { limit: 1000 });
  activeRules = await pauseDormantExactDuplicateRules(activeRules, now);
  activeRules = await pauseDormantOverlappingRules(activeRules, now);
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
  exactRollingRuleSignature,
  pauseDormantExactDuplicateRules,
  pauseDormantOverlappingRules,
  normalizeActiveRules,
  queueRuleMaterialization,
  queueAllActiveRules,
  startWebFallback,
  stopWebFallback,
};
