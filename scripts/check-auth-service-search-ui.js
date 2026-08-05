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

const home = read('src/views/pages/home.ejs');
const homeJs = read('public/js/home.js');
const serviceJs = read('public/js/home-service-search.js');
const login = read('src/views/pages/auth/login.ejs');
const authJs = read('public/js/auth-page.js');
const css = read('public/css/completion-fixes.css');
const serviceTypes = ['bus', 'hotel', 'flight', 'local_transport', 'tour', 'car_rental', 'cargo'];

check('homepage loads the isolated service-search controller before the main homepage controller',
  home.indexOf('/js/home-service-search.js?v=1.6.1') > 0 && home.indexOf('/js/home-service-search.js?v=1.6.1') < home.indexOf('/js/home.js?v=1.6.1'));
check('all seven service tabs have explicit controller keys', serviceTypes.every((type) => home.includes(`data-service-tab="${type}"`)));
check('all seven service panels remain separate real containers', serviceTypes.every((type) => home.includes(`data-search-panel="${type}"`)));
check('each tab is linked to a unique panel', ['busSearchPanel','staySearchPanel','flightSearchPanel','taxiSearchPanel','tourSearchPanel','rentalSearchPanel','cargoSearchPanel'].every((id) => home.includes(`aria-controls="${id}"`) && home.includes(`id="${id}"`)));
check('the selected panel alone is visible, interactive, and enabled', serviceJs.includes("panel.hidden = !enabled") && serviceJs.includes("panel.toggleAttribute('inert', !enabled)") && serviceJs.includes('control.disabled = !enabled'));
check('each service tab owns a direct click listener', serviceJs.includes("tabs.forEach((tab) =>") && serviceJs.includes("tab.addEventListener('click'"));
check('service search no longer depends on the large homepage controller', !homeJs.includes('setServiceSearchPanel') && !homeJs.includes('serviceSearchRoutes') && !homeJs.includes("action === 'run-search'"));
check('touch swiping no longer captures pointers or blocks taps', !homeJs.includes('setPointerCapture') && !homeJs.includes("addEventListener('pointerdown'"));
check('service-specific inputs are submitted only from the active panel', serviceJs.includes("panel.querySelectorAll('[data-search-param]')") && serviceJs.includes('const panel = activePanel()'));
check('search buttons are owned by the dedicated controller', home.includes('data-service-search-submit="smart"') && home.includes('data-service-search-submit="primary"') && serviceJs.includes('[primaryButton, smartButton]'));
check('date limits remain service-specific', serviceJs.includes("['stayCheckInInput', 'stayCheckOutInput']") && serviceJs.includes("['flightDepartInput', 'flightReturnInput']") && serviceJs.includes("['rentalPickupDateInput', 'rentalReturnDateInput']"));
check('service panels remain two columns on phones', /@media\(max-width:680px\)[\s\S]*\.homePage \.serviceSearchPanel[\s\S]*repeat\(2,minmax\(0,1fr\)\)/.test(css));
check('hero and service strip remain width-contained', css.includes('.homePage .heroCard,') && css.includes('#searchTabs.tabs') && css.includes('overflow-x:auto!important'));

check('authentication loads its isolated controller', login.includes('/js/auth-page.js?v=1.6.1'));
check('login, signup, and partner switches are explicit buttons', ['login','signup','partner'].every((name) => login.includes(`type="button"`) && login.includes(`data-open-panel="${name}"`)));
check('inactive authentication panels start hidden', ['signupPanel','supportPanel','forgotPanel','partnerPanel'].every((id) => new RegExp(`id="${id}"[^>]*\\shidden(?:\\s|>)[^>]*aria-hidden="true"`).test(login)));
check('authentication switching updates hidden, inert, and aria state', authJs.includes('panel.hidden = !active') && authJs.includes("panel.toggleAttribute('inert', !active)") && authJs.includes("panel.setAttribute('aria-hidden'"));
check('authentication theme switching remains functional without background overrides', authJs.includes("html.setAttribute('data-theme', mode)") && authJs.includes("themeBtn?.addEventListener('click'"));
check('the previous broad authentication background override was removed', !css.includes('Authentication surfaces must be solid and readable in both themes') && !css.includes('background-color:var(--cardA)!important'));
check('the 12 px top spacing is retained inside the painted body surface', css.includes('--ct-top-gap:calc(12px + env(safe-area-inset-top,0px))') && css.includes('padding-top:var(--ct-top-gap)!important') && css.includes('top:var(--ct-top-gap)!important'));
check('service selection never scrolls the hero or tab strip automatically', !serviceJs.includes('scrollIntoView') && !serviceJs.includes('scrollLeft'));
check('dark PWA prompt uses an opaque surface', css.includes('html[data-theme="dark"] .pwaInstallPrompt') && css.includes('background:#0b1020!important'));

console.log(`Focused authentication and service-search validation passed (${passed}/${passed}).`);
