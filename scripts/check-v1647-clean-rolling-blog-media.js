#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const pkg = require('../package.json');
const { SEEDED_BLOG_IMAGE_FILES, SEEDED_BLOG_IMAGES, resolveBlogImage } = require('../src/utils/blogImage');
let passed = 0;
function check(name, fn) { try { fn(); passed += 1; console.log(`✓ ${name}`); } catch (e) { console.error(`✗ ${name}`); throw e; } }
check('release is v1.6.47 or newer', () => assert(/^1\.6\.(?:4[7-9]|[5-9]\d|\d{3,})$/.test(pkg.version)));
check('npm start is stable and watch is dev-only', () => {
  const source = read('scripts/start.js');
  assert(source.includes("const watch = process.argv.includes('--watch');"));
  assert(!source.includes("|| nodeEnv !== 'production'"));
});
check('all seeded blog source files are bundled', () => {
  assert.strictEqual(Object.keys(SEEDED_BLOG_IMAGE_FILES).length, 7);
  Object.values(SEEDED_BLOG_IMAGE_FILES).forEach((url) => {
    const file = path.join(root, 'public', url.replace(/^\//, ''));
    assert(fs.existsSync(file), file);
    assert(fs.statSync(file).size > 8000, file);
  });
});
check('seeded blog images use dedicated media URLs', () => {
  Object.entries(SEEDED_BLOG_IMAGES).forEach(([slug, url]) => assert.strictEqual(url, `/media/blog/${encodeURIComponent(slug)}`));
  assert(resolveBlogImage({ slug: 'kampala-to-juba-bus-travel-guide', image: '/images/blogs/v1645-kampala-juba.webp' }).startsWith('/media/blog/'));
});
check('public router exposes dedicated blog media endpoint', () => { const routes = read('src/routes/web/public.js'); assert(routes.includes("router.get('/media/blog/:slug', mediaController.blog)")); assert(routes.includes("router.get('/media/operator/:key', mediaController.operator)")); });
check('blog media endpoint sends bundled file without stale cache', () => {
  const source = read('src/controllers/public/mediaController.js');
  assert(source.includes('SEEDED_BLOG_IMAGE_FILES'));
  assert(source.includes("Cache-Control', 'no-cache, no-store, must-revalidate"));
  assert(source.includes('res.sendFile(absolutePath'));
});
check('service worker does not precache seeded blog article images', () => {
  const sw = read('public/sw.js');
  Object.values(SEEDED_BLOG_IMAGE_FILES).forEach((url) => assert(!sw.includes(url)));
});
check('dedicated worker does not start a second rolling timer queue', () => assert(!read('src/worker.js').includes('scheduleMaterializer.startWebFallback')));
check('outbox cron no longer runs every ten seconds', () => {
  const env = read('src/config/env.js');
  const example = read('.env.example');
  assert(env.includes("safeJobCron('JOB_PROCESS_OUTBOX', '* * * * *'"));
  assert(example.includes('JOB_PROCESS_OUTBOX=* * * * *'));
  assert(!example.includes('JOB_PROCESS_OUTBOX=*/10 * * * * *'));
});
check('legacy second-level outbox cron is rejected at runtime', () => {
  const probe = spawnSync(process.execPath, ['-e', "const {env}=require('./src/config/env'); process.stdout.write(env.jobs.processOutbox)"], {
    cwd: root, encoding: 'utf8', env: { ...process.env, JOB_PROCESS_OUTBOX: '*/10 * * * * *' },
  });
  assert.strictEqual(probe.status, 0, probe.stderr);
  assert.strictEqual(probe.stdout, '* * * * *');
});
check('rolling recovery is lightweight fifteen-minute fallback', () => {
  const env = read('src/config/env.js');
  const example = read('.env.example');
  assert(env.includes("safeJobCron('JOB_MATERIALIZE_SCHEDULES', '*/15 * * * *'"));
  assert(example.includes('JOB_MATERIALIZE_SCHEDULES=*/15 * * * *'));
});
check('legacy one-minute rolling cron is rejected at runtime', () => {
  const probe = spawnSync(process.execPath, ['-e', "const {env}=require('./src/config/env'); process.stdout.write(env.jobs.materializeSchedules)"], {
    cwd: root, encoding: 'utf8', env: { ...process.env, JOB_MATERIALIZE_SCHEDULES: '* * * * *' },
  });
  assert.strictEqual(probe.status, 0, probe.stderr);
  assert.strictEqual(probe.stdout, '*/15 * * * *');
});
check('launch seed persists stable blog media URLs', () => {
  const seed = read('scripts/seed-launch-seo-operators.js');
  const media = read('src/utils/seedMedia.js');
  assert(seed.includes('SEEDED_BLOG_IMAGES: BLOG_IMAGES'));
  assert(seed.includes('const image = BLOG_IMAGES[post.slug]'));
  assert(media.includes('`/media/blog/${encodeURIComponent(slug)}`'));
  assert(seed.includes('bus-seat-booking|v1644-|v1645-'));
});
check('worker normalizes dormant legacy rules once on startup', () => {
  const worker = read('src/worker.js');
  assert(worker.includes('scheduleMaterializer.normalizeActiveRules(new Date())'));
  assert(worker.includes('Normalized legacy recurring departure rules'));
});
check('new/updated rolling rule can fill complete month immediately', () => {
  const source = read('src/controllers/company/scheduleController.js');
  assert(source.includes('maxCreates: scheduleMaterializer.ROLLING_WINDOW_DAYS'));
  assert(!source.includes('queued for the background rolling worker'));
});
check('lifecycle outbox fills all missing dates in one pass', () => assert(read('src/services/shared/outboxHandlers.js').includes('maxCreates: materializer.ROLLING_WINDOW_DAYS')));
check('overlapping same-route same-vehicle duplicate rules are normalized', () => {
  const source = read('src/jobs/materializeSchedules.js');
  assert(source.includes('pauseDormantOverlappingRules'));
  assert(source.includes('sameRecurringService'));
  assert(source.includes('recurringTimesOverlap'));
  assert(source.includes('Paused redundant overlapping recurring rule'));
});
check('normalizer never auto-pauses a rule that owns future inventory', () => assert(read('src/jobs/materializeSchedules.js').includes('if (Number(futureCount || 0) > 0)')));
check('conflict logs are compact instead of date-by-date failure spam', () => {
  const source = read('src/jobs/materializeSchedules.js');
  assert(source.includes("failures.add('vehicle_time_conflict')"));
  assert(source.includes('if (conflictDetails.length < 2)'));
  assert(!source.includes('vehicle_time_conflict:${departAt.toISOString()}'));
});
console.log(`\n${passed}/19 v1.6.47 clean rolling/blog media checks passed.`);
