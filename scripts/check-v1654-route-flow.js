#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const pkg = JSON.parse(read('package.json'));
let passed = 0;
function check(label, fn) { fn(); passed += 1; console.log(`✓ ${label}`); }

check('release is v1.6.55', () => assert(/^1\.6\.(?:5[5-9]|[6-9]\d|\d{3,})$/.test(pkg.version)));
check('route typography stays compact without squeezing labels', () => {
  const css = read('public/css/completion-fixes.css');
  const block = css.split('/* v1.6.56 — marketplace card rhythm:')[1] || '';
  assert(block.includes('font-size:11.25px!important'));
  assert(block.includes('font-weight:700!important'));
  assert(css.includes('white-space:nowrap!important'));
});
check('server marketplace cards use independent staggered route lanes', () => {
  const view = read('src/views/partials/listing-card.ejs');
  assert(view.includes('routeLaneCount = Math.min(2, companyRoutes.length)'));
  assert(view.includes('routeLaneWeights'));
  assert(view.includes('companyRouteTrack'));
  assert(view.includes('companyRouteLane'));
});
check('home cards and bars both use two route lanes', () => {
  const js = read('public/js/home.js');
  assert(js.includes('const routeRows = 2;'));
  assert(js.includes('const laneWeights = Array.from'));
  assert(js.includes('companyRouteTrack'));
  assert(js.includes('companyRouteLane'));
});
check('route lanes are re-rendered when switching card/bar view', () => {
  const js = read('public/js/home.js');
  const fn = js.slice(js.indexOf('function setSectionView'), js.indexOf('function equivalentCorridor'));
  assert(fn.includes('renderGroup(group)'));
});
check('route scroller supports native horizontal swipe in both directions', () => {
  const css = read('public/css/completion-fixes.css');
  const block = css.split('/* v1.6.55 — route text only:')[1] || '';
  assert(block.includes('overflow-x:auto!important'));
  assert(block.includes('-webkit-overflow-scrolling:touch!important'));
  assert(block.includes('overscroll-behavior-inline:contain!important'));
});
check('route names keep natural full width and are never squeezed', () => {
  const css = read('public/css/completion-fixes.css');
  const block = css.split('/* v1.6.55 — route text only:')[1] || '';
  assert(block.includes('width:max-content!important'));
  assert(block.includes('max-width:none!important'));
  assert(block.includes('white-space:nowrap!important'));
  assert(block.includes('text-overflow:clip!important'));
});
check('route lanes are independent free-flow flex rows rather than shared grid columns', () => {
  const css = read('public/css/completion-fixes.css');
  const block = css.split('/* v1.6.55 — route text only:')[1] || '';
  assert(block.includes('.companyRouteLane{'));
  assert(block.includes('flex-flow:row nowrap!important'));
  assert(block.includes('width:max-content!important'));
});
check('bar route area uses the same free-flow lane architecture', () => {
  const css = read('public/css/completion-fixes.css');
  const block = css.split('/* v1.6.55 — route text only:')[1] || '';
  assert(block.includes('[data-view="bars"] .companyRouteTrack'));
  assert(block.includes('[data-view="bars"] .companyRouteLane'));
  assert(block.includes('[data-view="bars"] .companyRouteChip'));
});
check('semantic assets use v1.6.55 cache busting', () => {
  assert(read('public/sw.js').includes(`classic-trip-static-v${pkg.version}`));
  assert(read('src/views/pages/home.ejs').includes(`/js/home.js?v=${pkg.version}`));
  assert(read('src/views/partials/site-head.ejs').includes(`/css/completion-fixes.css?v=${pkg.version}`));
});
console.log(`\n${passed}/10 route-flow regression checks passed.`);
