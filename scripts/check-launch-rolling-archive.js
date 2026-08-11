#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const failures = [];
let passed = 0;

function check(name, condition) {
  if (condition) passed += 1;
  else failures.push(name);
}

const materializer = read('src/jobs/materializeSchedules.js');
const departureService = read('src/modules/bus/services/busDepartureService.js');
const outboxHandlers = read('src/services/shared/outboxHandlers.js');
const outboxJob = read('src/jobs/processOutbox.js');
const scheduler = read('src/jobs/scheduler.js');
const worker = read('src/worker.js');
const archiveHelpers = read('src/models/_helpers.js');
const purge = read('src/jobs/purgeArchivedRecords.js');
const env = read('src/config/env.js');
const db = read('src/config/db.js');
const render = read('render.yaml');
const details = read('src/views/pages/listing-details.ejs');
const homeCss = read('public/css/pages/home.css');
const archiveService = read('src/services/archive/archiveService.js');
const archiveSection = read('src/views/dashboards/shared/sections/archive.ejs');
const shellConfig = read('src/services/dashboard/shellConfig.js');
const workspace = read('src/views/dashboards/shared/workspace.ejs');
const server = read('src/server.js');
const returnSearch = read('src/modules/bus/services/busSearchService.js');

check('Rolling departure window is exactly 30 calendar days', materializer.includes('const ROLLING_WINDOW_DAYS = 30')
  && materializer.includes('const HORIZON_DAYS = ROLLING_WINDOW_DAYS - 1'));
check('Automatically generated departures request public status', /status:\s*'published'/.test(materializer));
check('Automatic publication still preserves incomplete departures as Draft', departureService.includes('publicationDeferred')
  && materializer.includes("status: 'draft'"));
check('Month creation uses the bounded batch path', materializer.includes('createScheduleBatch')
  && departureService.includes('Math.min(4, proposed.length)'));
check('New and resumed rules queue worker-side month creation', departureService.split('ScheduleRuleMaterializationRequested').length >= 5);
check('Legacy active recurring departures are reconciled', materializer.includes('reconcileLegacyActiveSchedules')
  && materializer.includes('legacySchedulesReconciled'));
check('Transient materialization failures keep the watermark retryable', materializer.includes('if (isTransientFailure')
  && materializer.indexOf('if (isTransientFailure') < materializer.lastIndexOf('recordScheduleRuleMaterialization'));

check('Public bus seat preview removes its frame on phones only and remains centred', details.includes('busSeatLayoutBox')
  && homeCss.includes('.listingPreviewPage .busSeatLayoutBox')
  && homeCss.includes('@media(max-width:680px)')
  && homeCss.includes('padding:0;border:0;border-radius:0;background:transparent')
  && homeCss.includes('justify-content:center;overflow-x:auto'));

check('Reverse trips accept canonical branch identity with stop-name fallback', returnSearch.includes('function stopMatches')
  && returnSearch.includes('branchMatches || nameMatches')
  && returnSearch.includes('function journeyForSchedule')
  && returnSearch.includes('routeId: { $in: usableRouteIds }'));

check('Archive writes carry a fixed 30-day retention timestamp', archiveHelpers.includes('const ARCHIVE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000')
  && archiveHelpers.includes('purgeAfter'));
check('Archive cleanup preserves referenced history', purge.includes('dependencyReason')
  && purge.includes('retentionHoldReason')
  && purge.includes('Historical bookings, tickets and financial relationships'));
check('Archive cleanup is bounded and sequential', purge.includes('const BATCH_LIMIT = 50')
  && purge.includes('for (const policy of POLICIES)'));
check('Archive cleanup is registered daily', scheduler.includes('purgeArchivedRecords')
  && env.includes("JOB_PURGE_ARCHIVED_RECORDS || '30 4 * * *'"));
check('Every dashboard receives the shared Archive destination', shellConfig.includes('function injectArchiveItem')
  && shellConfig.includes("page: 'archive', label: 'Archive'")
  && workspace.includes("include('sections/archive'"));
check('Archive records are tenant-scoped and restored only to safe states', archiveService.includes('function scopeFilter')
  && archiveService.includes("status: 'draft'")
  && archiveService.includes("operationalStatus: 'offline'")
  && archiveSection.includes('30-day retention'));

const archiveModels = fs.readdirSync(path.join(root, 'src/models'))
  .filter((file) => file.endsWith('.js') && file !== '_helpers.js')
  .filter((file) => /enum:\s*\[[^\]]*['"]archived['"]/.test(read(`src/models/${file}`)))
  .map((file) => path.basename(file, '.js'));
const policyModels = new Set([...purge.matchAll(/model:\s*'([^']+)'/g)].map((match) => match[1]));
const uncovered = archiveModels.filter((name) => !policyModels.has(name));
check(`Every archive-capable model has a cleanup policy${uncovered.length ? ` (${uncovered.join(', ')})` : ''}`, uncovered.length === 0);

[
  'BusListingPublished',
  'BusDeparturePublished',
  'BusBookingCreated',
  'BusBookingCancelled',
  'BusBookingRefunded',
  'BusInventoryHeld',
  'BusInventoryBooked',
  'BusPassengerCheckedIn',
  'BusIncidentReported',
].forEach((topic) => check(`Known domain event ${topic} is acknowledged once`, outboxHandlers.includes(`${topic}: acknowledgeDomainFact`)));
check('Unknown outbox topics still fail visibly', read('src/services/shared/outboxService.js').includes('No outbox handler registered'));
check('Outbox work uses short pool-friendly batches', outboxJob.includes('env.jobs.outboxBatchSize') && env.includes("number('OUTBOX_BATCH_SIZE', 8)"));
check('Cron jobs cannot overlap themselves', scheduler.includes('runningJobs.has(name)')
  && scheduler.includes("reason: 'previous_run_still_active'"));
check('Worker owns the delayed rolling repair queue after deploy', worker.includes('scheduleMaterializer.startWebFallback')
  && worker.includes('startupDelayMs: 10000')
  && worker.includes('restoreLegacyDemotedBusListings')
  && worker.includes('setImmediate')
  && !server.includes('restoreLegacyDemotedBusListings'));

check('MongoDB connection creation is bounded', db.includes('maxConnecting:')
  && db.includes('heartbeatFrequencyMS: 10000'));
check('Web and worker have separate MongoDB pool budgets', render.includes('MONGO_MAX_POOL_SIZE')
  && render.includes('value: "24"')
  && render.includes('value: "6"'));
check('Production Redis remains mandatory for sessions and cache', render.includes('REDIS_REQUIRED')
  && render.includes('value: "true"'));
check('Atlas startup and pool queue tolerate transient topology changes', db.includes('isRetryableConnectionError')
  && db.includes('retryAttempts')
  && env.includes('MONGO_SERVER_SELECTION_TIMEOUT_MS')
  && env.includes("Math.max(1500, number('MONGO_WAIT_QUEUE_TIMEOUT_MS'"));
check('Web process starts no jobs and warms public discovery only after listening', !server.includes('startScheduledJobs')
  && server.includes('schedulePublicCatalogWarmup')
  && server.indexOf('app.listen') < server.indexOf('schedulePublicCatalogWarmup();')
  && !server.includes('runStartupReadMaintenance'));
check('Reverse discovery ignores outbound chronology but rejects departed services',
  !returnSearch.includes('afterDate')
  && returnSearch.includes('departAt: { $gt: new Date() }'));

if (failures.length) {
  console.error(`Launch lifecycle audit failed (${passed}/${passed + failures.length}).`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(`Launch lifecycle audit passed (${passed}/${passed}).`);
