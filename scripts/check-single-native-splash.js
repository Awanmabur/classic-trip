const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const pwa = fs.readFileSync(path.join(root, 'public/js/pwa.js'), 'utf8');
const pwaCss = fs.readFileSync(path.join(root, 'public/css/pwa.css'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/site.webmanifest'), 'utf8'));
const sw = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
let passed = 0;
function check(name, fn){ fn(); passed += 1; console.log(`✓ ${name}`); }
check('installed-app launch flash carries transparent logo, name, and slogan', () => assert(pwa.includes('pwaLaunchFlash') && pwa.includes('logo-symbol-192.png') && pwa.includes('APP_NAME') && pwa.includes('APP_SLOGAN')));
check('launch flash is restricted to installed standalone mode', () => assert(pwa.includes('if (!isStandalone() || launchFlashAlreadyShown()')));
check('launch flash is session-scoped and does not repeat during navigation', () => assert(pwa.includes('sessionStorage.getItem(LAUNCH_FLASH_KEY)') && pwa.includes('sessionStorage.setItem(LAUNCH_FLASH_KEY')));
check('launch flash has light and dark visual support', () => assert(pwaCss.includes('.pwaLaunchFlash') && pwaCss.includes('html[data-theme="dark"] .pwaLaunchFlash')));
check('native manifest carries brand and slogan', () => assert(manifest.name === 'Classic Trip — Move, stay and fly with confidence.' && manifest.short_name === 'Classic Trip'));
check('native manifest defaults to light mode with transparent launch icons', () => assert(manifest.background_color === '#f8fafc' && manifest.theme_color === '#f8fafc' && Array.isArray(manifest.icons) && manifest.icons.length >= 2 && manifest.icons.every((icon) => icon.purpose !== 'maskable')));
check('service worker cache version is present', () => assert(/classic-trip-static-v\d/.test(sw)));
console.log(`Branded single-splash checks passed: ${passed}/7`);
