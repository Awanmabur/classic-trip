'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const json = (file) => JSON.parse(read(file));
let passed = 0;
function check(label, condition) {
  if (!condition) throw new Error(label);
  passed += 1;
  console.log(`✓ ${label}`);
}

const home = read('src/views/pages/home.ejs');
const siteHead = read('src/views/partials/site-head.ejs');
const workspace = read('src/views/dashboards/shared/workspace.ejs');
const login = read('src/views/pages/auth/login.ejs');
const homeJs = read('public/js/home.js');
const siteHeader = read('public/js/site-header.js');
const dashboardJs = read('public/js/dashboard-workspace.js');
const completion = read('public/css/completion-fixes.css');
const manifest = json('public/site.webmanifest');

check('public, authentication, and dashboard shells start in dark mode', [home, siteHead, workspace, login].every((text) => text.includes('data-theme="dark"')));
check('PWA and browser launch palette remains dark', manifest.background_color === '#070a12' && manifest.theme_color === '#070a12');
check('homepage first-visit fallback remains dark', /ct_auth_theme'\) \|\| 'dark'/.test(homeJs));
check('shared public shell first-visit fallback remains dark', /savedTheme\(\) \|\| 'dark'/.test(siteHeader));
check('saved preferences restore before first paint', [home, siteHead, workspace, login].every((text) => text.includes('document.documentElement.dataset.theme=t')));
check('phone service search uses two columns', /@media\(max-width:680px\)[\s\S]*\.homePage \.serviceSearchPanel[\s\S]*repeat\(2,minmax\(0,1fr\)\)/.test(completion));
check('hero and type strip are width-contained', completion.includes('.homePage .heroCard,') && completion.includes('overscroll-behavior-x:contain!important'));
check('the focused patch does not replace global theme backgrounds', !completion.includes('html[data-theme="dark"] :is(body.homePage') && !completion.includes('background-color:var(--card,#0b1220)!important'));
check('dashboard theme toggle still updates browser chrome', dashboardJs.includes('meta[name="theme-color"]'));
console.log(`Dark/mobile UI validation passed (${passed}/${passed}).`);
