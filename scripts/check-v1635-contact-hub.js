const fs = require('fs');
const pkg = require('../package.json');
const css = fs.readFileSync('public/css/completion-fixes.css','utf8');
const js = fs.readFileSync('public/js/contact-hub.js','utf8');
let passed=0; function check(name, ok){ if(!ok){ console.error('FAIL',name); process.exitCode=1; } else { passed++; console.log('PASS',name); } }
check('version includes v1.6.38 contact hub', pkg.version === '1.6.45');
check('launcher is circular', css.includes('.ctContactHubToggle{') && css.includes('border-radius:50%!important'));
check('launcher text hidden globally', css.includes('.ctContactHubToggle span{display:none!important;}'));
check('dark action background opaque', css.includes('html[data-theme="dark"] .ctContactHubAction') && css.includes('background:#111827!important'));
check('action bars are narrower', css.includes('width:218px!important') && css.includes('width:205px!important'));
check('drag uses pointer events', js.includes("pointerdown") && js.includes("pointermove") && js.includes("pointerup"));
check('position persists locally', js.includes('localStorage.setItem') && js.includes('localStorage.getItem'));
check('drag snaps left or right', js.includes('snapToNearestSide') && js.includes("side = rect.left"));
check('menu opens inward on left side', css.includes('.ctContactHub[data-side="left"] .ctContactHubMenu'));
if(!process.exitCode) console.log(`v1.6.38 contact hub checks passed (${passed}/9).`);
