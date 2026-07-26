'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const checks = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
  checks.push(message);
}

const head = read('src/views/partials/site-head.ejs');
const css = read('public/css/marketing-responsive.css');
const commission = read('src/views/pages/partner-commission.ejs');
const howItWorks = read('src/views/pages/how-it-works.ejs');

const pages = [
  'src/views/pages/blog-post.ejs',
  'src/views/pages/blogs.ejs',
  'src/views/pages/companies.ejs',
  'src/views/pages/company-profile.ejs',
  'src/views/pages/how-it-works.ejs',
  'src/views/pages/partner-commission.ejs',
  'src/views/pages/privacy.ejs',
  'src/views/pages/promoters.ejs',
  'src/views/pages/routes.ejs',
  'src/views/pages/services.ejs',
  'src/views/pages/support.ejs',
  'src/views/pages/terms.ejs',
];

assert(head.includes('/css/marketing-responsive.css?v=20260727-1'), 'Marketing responsive stylesheet is loaded on public pages');
assert(head.indexOf('/css/marketing-responsive.css') > head.indexOf('/css/completion-fixes.css'), 'Marketing responsive stylesheet loads after the completion fixes');
assert(head.indexOf('/css/marketing-responsive.css') < head.indexOf('/css/accessibility-safe.css'), 'Accessibility support remains the final non-layout layer');

for (const page of pages) {
  assert(read(page).includes('marketingPage'), `${path.basename(page)} uses the scoped marketing page contract`);
}

assert(commission.includes('marketingCtaCard'), 'Partner Commission CTA uses the contained CTA card');
assert(commission.includes('marketingCtaHead'), 'Partner Commission CTA header uses the responsive CTA contract');
assert(howItWorks.includes('marketingTabs'), 'How It Works audience actions use the responsive marketing tabs contract');

assert(css.includes('.sitePage .marketingPage .sectionHead > .actions'), 'Marketing section action groups are explicitly contained');
assert(css.includes('white-space:normal'), 'Marketing CTA labels may wrap instead of overflowing');
assert(css.includes('height:auto'), 'Wrapped marketing buttons are not clipped by fixed height');
assert(css.includes('grid-template-columns:minmax(0,1fr)'), 'Marketing action groups collapse to a safe single column on narrow phones');
assert(css.includes('.sitePage .marketingPage .badge'), 'Long marketing badges are constrained to the card width');
assert(css.includes('grid-template-columns:repeat(2,minmax(0,1fr))!important'), 'Marketing metrics retain two compact cards per phone row');
assert(css.includes('.siteFooter .footerGrid'), 'The public footer has a small-phone containment rule');
assert(!css.includes('position:fixed'), 'Marketing overflow corrections do not introduce fixed page geometry');
assert(!css.includes('width:100vw'), 'Marketing overflow corrections do not create viewport-width overflow');

console.log(`Marketing mobile overflow checks passed: ${checks.length}/${checks.length}`);
