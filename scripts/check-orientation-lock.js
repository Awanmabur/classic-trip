'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/site.webmanifest'), 'utf8'));
const pwa = fs.readFileSync(path.join(root, 'public/js/pwa.js'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const checks = [
  ['manifest locks installed app to portrait-primary', manifest.orientation === 'portrait-primary'],
  ['runtime orientation constant is portrait-primary', pwa.includes("const APP_ORIENTATION = 'portrait-primary'" )],
  ['runtime lock runs only in installed mode', pwa.includes("if (!isStandalone()) return false")],
  ['screen orientation lock is feature-detected', pwa.includes("typeof orientation.lock !== 'function'")],
  ['orientation is re-applied after orientation change', pwa.includes("window.addEventListener('orientationchange'")],
  ['orientation is re-applied when app resumes', pwa.includes("document.addEventListener('visibilitychange'")],
  ['orientation failure is handled without breaking launch', pwa.includes('Some browsers rely only on the web-app manifest')],
  ['service-worker cache version is current', sw.includes(`classic-trip-static-v${pkg.version}`)],
];

let passed = 0;
for (const [label, ok] of checks) {
  if (!ok) {
    console.error(`✗ ${label}`);
    process.exitCode = 1;
  } else {
    passed += 1;
    console.log(`✓ ${label}`);
  }
}

if (!process.exitCode) console.log(`Orientation lock checks passed: ${passed}/${checks.length}`);
