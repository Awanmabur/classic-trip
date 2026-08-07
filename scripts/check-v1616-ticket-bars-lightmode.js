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
const details = read('src/views/pages/listing-details.ejs');
const css = read('public/css/completion-fixes.css');
const sw = read('public/sw.js');
check('release is v1.6.16', sw.includes(`classic-trip-static-v${pkg.version}`));
check('ticket class is a radio-style exclusive group', details.includes('role="radiogroup" aria-label="Ticket class"') && details.includes('role="radio" aria-checked='));
check('ticket class sync targets only ticket buttons', details.includes("document.querySelectorAll('.ticketChoice[data-ticket-class]')"));
check('route sync never silently forces Standard or VIP', !details.includes("if (!counts[activeTicketClass]) activeTicketClass = counts.standard"));
check('live availability cannot overwrite the traveller ticket class', !details.includes('activeTicketClass = normalizedTicketClass(data.schedule?.vehicleClass || activeTicketClass)'));
check('ticket chooser is ordered vertically below route and travel', css.includes('.listingPreviewPage .busTicketChooser{\n  grid-template-columns:1fr!important;'));
check('desktop preview control type is restored to compact size', css.includes('font-size:12px!important;') && css.includes('min-height:44px!important;'));
check('phone preview type is reduced from the oversized v1.6.15 size', css.includes('font-size:11.5px!important;') && css.includes('.listingPreviewPage .ticketChoice b{font-size:12px!important;}'));
check('desktop bar image width is reduced without fixed max height', css.includes('grid-template-columns:176px minmax(0,1fr)!important;') && css.includes('max-height:none!important;'));
check('phone bar approved dimensions remain unchanged', css.includes('grid-template-columns:148px minmax(0,1fr)!important;') && css.includes('height:154px!important;'));
check('bar body uses card-like spacing', css.includes('padding:10px!important;') && css.includes('gap:7px!important;'));
check('phone bar typography is slightly larger', css.includes('font-size:13px!important;') && css.includes('font-size:13.5px!important;'));
check('two image badges are reduced on desktop and phone', css.includes('font-size:8.5px!important;') && css.includes('font-size:7.25px!important;'));
check('light-mode green availability badge has dark readable text', css.includes('html[data-theme="light"] .cornerBadge.available') && css.includes('color:#14532d!important;') && css.includes('background:#dcfce7!important;'));
if (!process.exitCode) console.log(`v1.6.16 ticket/bar/light-mode checks passed (${passed}/14).`);
