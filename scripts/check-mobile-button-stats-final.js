'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const cssPath = path.join(root, 'public/css/completion-fixes.css');
const css = fs.readFileSync(cssPath, 'utf8');
const marker = 'Final mobile statistics and blue-button text contract';
const finalBlockIndex = css.lastIndexOf(marker);
const failures = [];

function expect(condition, message) {
  if (!condition) failures.push(message);
}

expect(finalBlockIndex >= 0, 'Missing final mobile statistics/button contract.');
const finalCss = finalBlockIndex >= 0 ? css.slice(finalBlockIndex) : '';
expect(finalCss.includes('grid-template-columns:repeat(2,minmax(0,1fr))!important'), 'Phone statistics are not locked to two columns.');
expect(finalCss.includes('.dashboardBody .financeKpis'), 'Finance statistics are not covered.');
expect(finalCss.includes('.dashboardBody .hotelOpsNudge'), 'Hotel statistics are not covered.');
expect(finalCss.includes('.authPage .miniDash'), 'Authentication statistics are not covered.');
expect(finalCss.includes('.btnBlue:visited'), 'Visited blue links are not protected.');
expect(finalCss.includes('-webkit-text-fill-color:#eef5ff!important'), 'Blue button text fill is not protected.');

const standalone = [
  'src/views/pages/driver-manifest-print.ejs',
  'src/views/pages/hotel-voucher-detail.ejs',
  'src/views/pages/driver-ticket-detail.ejs',
  'src/views/pages/company-customer-manifest.ejs',
];
for (const relative of standalone) {
  const text = fs.readFileSync(path.join(root, relative), 'utf8');
  expect(text.includes('.btn.primary:hover,.btn.primary:focus-visible,.btn.primary:active'), `${relative} is missing primary button hover text protection.`);
}

if (failures.length) {
  console.error(`Mobile button/stats audit failed (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Mobile button/stats audit passed (10/10).');
