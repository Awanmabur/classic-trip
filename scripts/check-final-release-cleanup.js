#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const render = fs.readFileSync(path.join(root, 'render.yaml'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'public', 'sw.js'), 'utf8');
const launchCheck = fs.readFileSync(path.join(root, 'scripts', 'launch-check.js'), 'utf8');
const indexScript = fs.readFileSync(path.join(root, 'scripts', 'ensure-production-indexes.js'), 'utf8');
const listingModel = fs.readFileSync(path.join(root, 'src', 'models', 'Listing.js'), 'utf8');
const airportModel = fs.readFileSync(path.join(root, 'src', 'models', 'Airport.js'), 'utf8');

const checks = [];
function check(label, condition) {
  if (!condition) throw new Error(label);
  checks.push(label);
}

function npmCliPath() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(path.dirname(process.execPath)), 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean);

  const match = candidates.find((candidate) => fs.existsSync(candidate));
  if (!match) {
    throw new Error('Unable to locate npm-cli.js. Run this check through "npm run check:release-cleanup".');
  }
  return match;
}

function npmPackFileList() {
  // Invoke npm's JavaScript CLI through the current Node executable. Calling
  // npm.cmd directly with spawnSync/execFileSync fails with EINVAL on some
  // Windows + Node 24 installations.
  const output = execFileSync(
    process.execPath,
    [npmCliPath(), 'pack', '--dry-run', '--json', '--ignore-scripts'],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const parsed = JSON.parse(output);
  return new Set((parsed[0]?.files || []).map((item) => item.path.replace(/\\/g, '/')));
}

const packedFiles = npmPackFileList();

check('package is private', pkg.private === true);
check('package and lockfile versions match', /^\d+\.\d+\.\d+$/.test(pkg.version) && lock.version === pkg.version && lock.packages?.['']?.version === pkg.version);
check('service worker cache matches release version', sw.includes(`classic-trip-static-v${pkg.version}`));
check('final release notes exist', fs.existsSync(path.join(root, 'RELEASE_NOTES.md')));
check('final deployment checklist exists', fs.existsSync(path.join(root, 'FINAL_RELEASE_CHECKLIST.md')));
check('security policy exists', fs.existsSync(path.join(root, 'SECURITY.md')));
check('obsolete dated release notes removed', !['FINAL_LAUNCH_AUDIT_2026-07-30.md', 'FINAL_SPEED_CONTENT_SPLASH_RELEASE_2026-07-27.md', 'ROOT_CAUSE_REPAIR_2026-07-31.md'].some((name) => fs.existsSync(path.join(root, name))));
check('Procfile uses the maintained start command', fs.readFileSync(path.join(root, 'Procfile'), 'utf8').trim() === 'web: npm start');
check('Render uses readiness endpoint', render.includes('healthCheckPath: /ready'));
check('Render web build prunes development dependencies', render.includes('npm run verify && npm prune --omit=dev'));
check('Render worker installs production dependencies only', render.includes('buildCommand: npm ci --omit=dev'));
check('Mongo connection retry settings are release consistent', (render.match(/MONGO_CONNECT_RETRY_ATTEMPTS/g) || []).length === 2 && !render.includes('MONGO_CONNECT_RETRY_ATTEMPTS\n        value: "3"'));
check('Multer release floor is 2.2.0', launchCheck.includes("requireVersion(packages, 'multer', '2.2.0')"));
check('production audit command exists', pkg.scripts?.['audit:production'] === 'npm audit --omit=dev --audit-level=high');
check('release verification command exists', Boolean(pkg.scripts?.['release:check']));
check('unit tests use Node built-in runner', pkg.scripts?.test === 'node scripts/run-unit-tests.js');
check('obsolete external test/watch dependencies are removed', !pkg.devDependencies && !pkg.dependencies?.nodemon && !pkg.dependencies?.jest && !pkg.dependencies?.supertest);
check('local .env is excluded from the package', !packedFiles.has('.env'));
check('node_modules is excluded from the package', ![...packedFiles].some((file) => file === 'node_modules' || file.startsWith('node_modules/')));
check('logs and temporary files are excluded from the package', ![...packedFiles].some((file) => /(^|\/)(?:logs?|tmp|temp)(\/|$)|\.log$|\.tmp$/i.test(file)));
check('index command performs controlled reconciliation', indexScript.includes('reconcileModelIndexes'));
check('listing has one canonical compound text index', listingModel.includes("name: 'listing_search_text_v2'") && !listingModel.includes('required: true, text: true'));
check('airport has one canonical compound text index', airportModel.includes("name: 'airport_search_text_v2'") && !airportModel.includes('trim: true, text: true'));

console.log(`Final release cleanup checks passed (${checks.length}/${checks.length}).`);
