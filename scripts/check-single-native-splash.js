const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const pwa = fs.readFileSync(path.join(root, 'public/js/pwa.js'), 'utf8');
const pwaCss = fs.readFileSync(path.join(root, 'public/css/pwa.css'), 'utf8');
const head = fs.readFileSync(path.join(root, 'src/views/partials/site-head.ejs'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/site.webmanifest'), 'utf8'));
const sw = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
let passed = 0;
function check(name, fn){ fn(); passed += 1; console.log(`✓ ${name}`); }
check('no second in-page launch screen exists', () => assert(!head.includes('pwaLaunchFlash') && !pwa.includes('showBrandLaunchFlash') && !pwaCss.includes('.pwaLaunchFlash')));
check('native launch identity contains the app name and slogan', () => assert(manifest.name === 'Classic Trip' && manifest.description.includes('Move, stay and fly with confidence')));
check('native launch uses the transparent Classic Trip symbols', () => assert(Array.isArray(manifest.icons) && manifest.icons.length >= 2 && manifest.icons.every((icon) => icon.purpose !== 'maskable') && manifest.icons.some((icon) => icon.src.includes('launch-lockup-192.png')) && manifest.icons.some((icon) => icon.src.includes('launch-lockup-512.png'))));
check('native launch remains the only installed-app splash path', () => assert(!pwa.includes('LAUNCH_FLASH') && !pwa.includes('pwaLaunch') && !head.includes('pwaLaunch')));
check('manifest keeps the app name concise on the launcher', () => assert(manifest.short_name === 'Classic Trip'));
check('manifest defaults to the light launch palette', () => assert(manifest.background_color === '#f8fafc' && manifest.theme_color === '#f8fafc'));
check('service worker cache version is present', () => assert(/classic-trip-static-v\d/.test(sw)));
console.log(`Native single-splash checks passed: ${passed}/7`);
