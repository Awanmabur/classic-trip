#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const failures = [];
let checks = 0;

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function files(relative, extension) {
  const base = path.join(root, relative);
  const output = [];
  function walk(directory) {
    fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (!extension || entry.name.endsWith(extension)) output.push(target);
    });
  }
  walk(base);
  return output;
}

function check(condition, message) {
  checks += 1;
  if (!condition) failures.push(message);
}

const templates = files('src/views', '.ejs');
const browserScripts = files('public/js', '.js');
const stylesheets = files('public/css', '.css');
const templateSource = templates.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const browserSource = browserScripts.map((file) => fs.readFileSync(file, 'utf8')).join('\n');

check(templates.length >= 120, `Expected the complete EJS surface; found ${templates.length}`);
check(browserScripts.length >= 15, `Expected all browser scripts; found ${browserScripts.length}`);
check(stylesheets.length >= 13, `Expected all responsive stylesheets; found ${stylesheets.length}`);
check(!/javascript\s*:/i.test(templateSource), 'Templates must not contain javascript: URLs');
check(!/\beval\s*\(|\bnew\s+Function\s*\(/.test(browserSource), 'Browser code must not use eval or the Function constructor');

const blankLinks = [...templateSource.matchAll(/<a\b[^>]*target=["']_blank["'][^>]*>/gi)].map((match) => match[0]);
check(blankLinks.every((tag) => /rel=["'][^"']*noopener/i.test(tag)), 'Every new-window link must use rel="noopener"');

const inlineScripts = [...templateSource.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>/gi)].map((match) => match[0]);
check(inlineScripts.every((tag) => /nonce=/.test(tag)), 'Every inline template script must carry the CSP nonce');

const jsonBootstrapCount = (templateSource.match(/type=["']application\/json["']/gi) || []).length;
const safeJsonBootstrapCount = (templateSource.match(/type=["']application\/json["'][\s\S]{0,300}?toScriptJson\(/gi) || []).length;
check(jsonBootstrapCount >= 5 && safeJsonBootstrapCount === jsonBootstrapCount, 'Application JSON bootstraps must use the script-safe serializer');

const home = read('src/views/pages/home.ejs');
const homeJs = read('public/js/home.js');
const homeSearch = read('public/js/home-service-search.js');
check(/<html[^>]*data-theme="dark"/.test(home), 'Home must retain dark mode as the default');
check((home.match(/data-service-tab=/g) || []).length === 7, 'Home must expose exactly seven implemented service search tabs');
check(/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(read('public/css/completion-fixes.css')), 'Phone layouts must retain two-column compact controls where approved');
check(/function safeInternalUrl/.test(homeJs) && /url\.origin !== window\.location\.origin/.test(homeJs), 'Home navigation must reject unsafe cross-origin action URLs');
check(/role="dialog"[^>]*aria-modal="true"/.test(home) && /function setDrawer/.test(homeJs) && /event\.key === 'Escape'/.test(homeJs), 'Home drawer must expose modal, keyboard and focus behavior');
check(/ArrowLeft/.test(homeSearch) && /aria-selected/.test(homeSearch), 'Home service tabs must support keyboard navigation and selected state');

const auth = read('src/views/pages/auth/login.ejs');
const authJs = read('public/js/auth-page.js');
check(/class="toggle" role="tablist"/.test(auth) && (auth.match(/role="tab"/g) || []).length >= 3, 'Account access choices must use the tab pattern');
check(/drawerFocusable/.test(authJs) && /event\.key === 'Escape'/.test(authJs), 'Account drawer must trap focus and close with Escape');
check(/autocomplete="current-password"/.test(auth) && /autocomplete="new-password"/.test(auth), 'Authentication forms must preserve password-manager autocomplete contracts');

const workspace = read('src/views/dashboards/shared/workspace.ejs');
const dashboardJs = read('public/js/dashboard-workspace.js');
check(/'workflow-guide','blogs'/.test(workspace) && /'flight-search','flight-quotes'/.test(workspace), 'Real dashboard sections must not be duplicated by generic fallback pages');
check(/setAttribute\('role', 'tablist'\)/.test(dashboardJs) && /setAttribute\('role', 'tabpanel'\)/.test(dashboardJs), 'Dashboard tabs must expose a complete tablist/tabpanel relationship');
check(/wrap\.setAttribute\('tabindex', '0'\)/.test(dashboardJs) && /scroll horizontally for more columns/.test(dashboardJs), 'Responsive dashboard tables must be keyboard-scrollable and named');
check(/function enhanceFormLabels/.test(dashboardJs), 'Dashboard form controls must receive explicit label associations');
check(/aria-label="<%= defaultCreateLabel %>"/.test(workspace), 'The compact dashboard create action must retain an accessible name');

const listing = read('src/views/pages/listing-details.ejs');
const booking = read('src/views/pages/booking-form.ejs');
check(/Standard Ticket/.test(listing) && /VIP Ticket/.test(listing) && /Return Ticket/.test(listing), 'Bus preview must keep Standard, VIP and Return choices separate and labeled');
check(/aria-label="Passenger <%= index \+ 1 %> identity type"/.test(booking) && /aria-label="Cargo type"/.test(booking), 'Checkout identity and service-specific selects must be explicitly named');
check(/listing\.serviceType === 'tour'/.test(booking) && /listing\.serviceType === 'car_rental'/.test(booking) && /listing\.serviceType === 'cargo'/.test(booking), 'Checkout must retain every implemented non-bus service flow');

const saved = read('src/views/pages/saved.ejs');
check(!/role="button"[^>]*data-saved-action="open"/.test(saved), 'Saved cards must not nest controls inside an interactive container');
check(/aria-label="Remove <%= l\.title %> from saved trips"/.test(saved), 'Saved-item icon controls must have contextual names');

const taxi = read('public/js/taxi.js');
const taxiTrack = read('public/js/taxi-track.js');
check(/!window\.L \|\| typeof window\.L\.map !== 'function'/.test(taxiTrack), 'Ride tracking must degrade safely when the map library is unavailable');
check(/role="img" aria-label/.test(taxi), 'Generated ride markers must expose permitted ARIA semantics');

const pwa = read('public/js/pwa.js');
const worker = read('public/sw.js');
check(/beforeinstallprompt/.test(pwa) && /appinstalled/.test(pwa), 'PWA install controls must handle browser install lifecycle events');
check(/fetch/.test(worker) && /caches\./.test(worker), 'Service worker must retain fetch and cache behavior');

const localAssets = [...templateSource.matchAll(/(?:href|src)=["']\/(css|js|images)\/([^"'<%?]+)/g)];
const missingAssets = localAssets.map((match) => path.join('public', match[1], match[2])).filter((relative) => !fs.existsSync(path.join(root, relative)));
check(missingAssets.length === 0, `Templates reference missing local assets: ${[...new Set(missingAssets)].slice(0, 8).join(', ')}`);

if (failures.length) {
  process.stderr.write(`Frontend completeness check failed (${failures.length}/${checks}):\n- ${failures.join('\n- ')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Frontend completeness check passed (${checks} contracts; ${templates.length} templates, ${browserScripts.length} browser scripts, ${stylesheets.length} stylesheets).\n`);
}
