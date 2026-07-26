const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const pwa = fs.readFileSync(path.join(root, 'public/js/pwa.js'), 'utf8');
const pwaCss = fs.readFileSync(path.join(root, 'public/css/pwa.css'), 'utf8');
const completionCss = fs.readFileSync(path.join(root, 'public/css/completion-fixes.css'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/site.webmanifest'), 'utf8'));
const sw = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
let passed = 0;
function check(name, fn){ fn(); passed += 1; console.log(`✓ ${name}`); }
check('custom JavaScript splash removed', () => assert(!pwa.includes('classicTripLaunchSplash') && !pwa.includes('showStandaloneSplash') && !pwa.includes('SPLASH_DURATION_MS')));
check('custom splash CSS removed', () => assert(!pwaCss.includes('pwaLaunchSplash') && !completionCss.includes('pwaLaunchSplash') && !pwaCss.includes('pwa-splash-open')));
check('native manifest carries brand and slogan', () => assert(manifest.name === 'Classic Trip — Move, stay and fly with confidence.' && manifest.short_name === 'Classic Trip'));
check('native splash keeps clean brand colours and icons', () => assert(manifest.background_color === '#070a12' && manifest.theme_color === '#070a12' && Array.isArray(manifest.icons) && manifest.icons.length >= 4));
check('service worker cache version updated', () => assert(sw.includes('classic-trip-static-v1.2.8')));
console.log(`Single native splash checks passed: ${passed}/5`);
