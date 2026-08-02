#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
let passed = 0;
function check(label, condition) {
  if (!condition) throw new Error(label);
  passed += 1;
  console.log(`✓ ${label}`);
}
const completion = read('public/css/completion-fixes.css');
const travel = read('public/css/pages/travel-booking.css');
const pwa = read('public/css/pwa.css');
const service = read('public/js/home-service-search.js');
const home = read('src/views/pages/home.ejs');

check('top gap remains 12 px plus safe area', completion.includes('--ct-top-gap:calc(12px + env(safe-area-inset-top,0px))'));
check('top gap is body padding so its background is painted', /body\.homePage,[\s\S]*body\.sitePage,[\s\S]*body\.authPage\{[\s\S]*padding-top:var\(--ct-top-gap\)!important/.test(completion));
check('public navigation remains offset by the same top gap', /body\.homePage > header\.nav,[\s\S]*body\.sitePage > nav\.nav\{[\s\S]*top:var\(--ct-top-gap\)!important/.test(completion));
check('home markup no longer forces zero top offset', !home.includes('style="top:0;margin-top:0"'));
check('service activation never calls scrollIntoView', !service.includes('scrollIntoView'));
check('service activation never changes scrollLeft', !service.includes('scrollLeft'));
check('tab strip stays width-contained', completion.includes('overscroll-behavior-x:contain!important') && completion.includes('overflow-anchor:none'));
check('PWA prompt is opaque in its base stylesheet', /\.pwaInstallPrompt\{[^}]*background:#0b1020/.test(pwa));
check('PWA instructions and close control are opaque', pwa.includes('background:#111827'));
check('flight and taxi primary panels are opaque in dark mode', /html\[data-theme="dark"\] \.sitePage \.travelHero \.heroCard,[\s\S]*\.travelPanel\{[\s\S]*background:#0b1020/.test(travel));
check('flight and taxi nested containers are opaque in dark mode', travel.includes('.travelControl,') && travel.includes('.offerCard,') && travel.includes('.placeSuggestions,') && travel.includes('background:#111827'));
console.log(`Surface stability validation passed (${passed}/${passed}).`);
