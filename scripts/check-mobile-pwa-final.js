'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [];
const check = (label, fn) => {
  fn();
  checks.push(label);
};

const home = read('src/views/pages/home.ejs');
const sharedHeader = read('src/views/partials/site-header.ejs');
const auth = read('src/views/pages/auth/login.ejs');
const css = read('public/css/completion-fixes.css');
const mobileNavigation = read('public/js/mobile-navigation.js');
const pwa = read('public/js/pwa.js');
const sw = read('public/sw.js');
const manifest = JSON.parse(read('public/site.webmanifest'));

check('home Start action opens sign in', () => assert(home.includes('href="/login"><i class="fa-solid fa-right-to-bracket"></i> Start')));
check('shared top ticket action is identifiable', () => assert(sharedHeader.includes('topTicketAction')));
check('auth top ticket action is identifiable', () => assert(auth.includes('topTicketAction')));
check('auth account switch remains three columns on phones', () => assert(css.includes('grid-template-columns:repeat(3,minmax(0,1fr))!important')));
check('bottom navigation hides during scroll', () => assert(mobileNavigation.includes('is-scroll-hidden') && mobileNavigation.includes('650')));
check('drawer state protects the final action', () => assert(mobileNavigation.includes('site-drawer-open') && css.includes('scroll-padding-bottom')));
check('input focus hides the bottom navigation', () => assert(mobileNavigation.includes('site-input-active')));
check('phone ticket action is removed', () => assert(css.includes('.topTicketAction{display:none!important}')));
check('blue buttons retain visible hover text', () => assert(css.includes('.btnBlue:hover') && css.includes('color:#eef5ff!important')));
check('phone statistics remain two per row', () => assert(css.includes('.homePage .stats{display:grid!important;grid-template-columns:repeat(2')));
check('install prompt carries brand and slogan', () => assert(pwa.includes('Move, stay and fly with confidence.') && pwa.includes('pwaInstallLogo')));
check('installed launch uses only the native manifest splash', () => assert(!pwa.includes('classicTripLaunchSplash') && !pwa.includes('showStandaloneSplash') && manifest.name === 'Classic Trip' && manifest.description.includes('Move, stay and fly with confidence')));
check('service worker is registered', () => assert(pwa.includes("register('/sw.js'")));
check('static service-worker cache is versioned', () => assert(sw.includes("classic-trip-static-v1.4.0") && sw.includes("'/css/")));
check('manifest uses transparent any-purpose icons for the launch surface', () => {
  assert(manifest.icons.some((icon) => icon.purpose === 'any'));
  assert(manifest.icons.every((icon) => icon.purpose !== 'maskable'));
});
check('manifest starts in standalone mode', () => assert.strictEqual(manifest.display, 'standalone'));
check('transparent launch and Apple touch icons exist', () => {
  ['public/images/launch-lockup-192.png','public/images/launch-lockup-512.png','public/images/apple-touch-icon.png'].forEach((file) => assert(fs.existsSync(path.join(root, file))));
});
check('auth document has one main opening', () => assert.strictEqual((auth.match(/<main class="main container">/g) || []).length, 1));

console.log(`Mobile navigation and PWA final checks: ${checks.length}/${checks.length} passed.`);
