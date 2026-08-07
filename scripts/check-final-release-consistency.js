'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
let passed = 0;
function check(name, ok) {
  if (!ok) { console.error(`✗ ${name}`); process.exitCode = 1; }
  else { passed += 1; console.log(`✓ ${name}`); }
}
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const sw = read('public/sw.js');
const ejs = read('src/views/pages/listing-details.ejs');
const css = read('public/css/completion-fixes.css');
const render = read('render.yaml');
check('package and lockfile versions match', pkg.version === lock.version && pkg.version === lock.packages?.['']?.version);
check('service worker cache matches package version', sw.includes(`classic-trip-static-v${pkg.version}`));
check('Ticket class/Journey render before route', ejs.indexOf('busTicketChooser') < ejs.indexOf('busJourneyStepGroup'));
check('Standard is the preferred default class', ejs.includes("ticketClassesAvailable.has('standard') ? 'standard'"));
check('One-way is selected by default', ejs.includes('ticketChoice is-active" id="oneWayTicketChoice') && ejs.includes('aria-pressed="true"'));
check('preview toast remains black with no border', css.includes('v1.6.24 — keep preview flash black') && css.includes('background:rgba(8,12,24,.96)!important') && css.includes('border:0!important'));
check('Ticket class outer group dark border removed', css.includes('v1.6.25 — remove extra dark border') && css.includes('border-color:transparent!important'));

const viewRoot = path.join(root, 'src', 'views');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}
const staleSemanticAssetVersions = walk(viewRoot)
  .filter((file) => file.endsWith('.ejs'))
  .flatMap((file) => {
    const body = fs.readFileSync(file, 'utf8');
    return [...body.matchAll(/\?v=(1\.6\.\d+)/g)]
      .filter((match) => match[1] !== pkg.version)
      .map((match) => `${path.relative(root, file)}:${match[1]}`);
  });
check('all semantic asset query versions match package version', staleSemanticAssetVersions.length === 0);
check('Render production routing is explicitly configured', render.includes('TAXI_ROUTING_API_URL') && render.includes('TAXI_REQUIRE_LIVE_ROUTING'));
check('Render production push is enabled with VAPID configuration', render.includes('PUSH_ENABLED') && render.includes('PUSH_VAPID_PUBLIC_KEY') && render.includes('PUSH_VAPID_PRIVATE_KEY'));
check('Render worker uses the real outbox batch-size key', render.includes('key: OUTBOX_BATCH_SIZE') && !render.includes('key: JOB_OUTBOX_BATCH_SIZE'));

if (!process.exitCode) console.log(`Final release consistency checks passed (${passed}/${passed}).`);
