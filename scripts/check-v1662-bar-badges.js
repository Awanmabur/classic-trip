const fs = require('fs');
const path = require('path');
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const css = fs.readFileSync(path.join(__dirname, '..', 'public/css/completion-fixes.css'), 'utf8');
function ok(cond, msg){ if(!cond){ console.error('✖ ' + msg); process.exitCode = 1; } else { console.log('✓ ' + msg); } }
ok(pkg.version === '1.6.62', 'release is v1.6.62');
ok(css.includes('v1.6.62 — bar-only badge increase'), 'bar-only badge override block exists');
const block = css.split('/* v1.6.62 — bar-only badge increase. Cards remain unchanged. */')[1] || '';
ok(block.includes('.homePage .sectionListingCollection[data-view="bars"] .thumbBadges .badge{') && block.includes('font-size:10.4px!important;'), 'bar image badges are increased');
ok(block.includes('.homePage .sectionListingCollection[data-view="bars"] .cornerBadge{') && block.includes('font-size:10.45px!important;'), 'bar departure-count badge is increased');
ok(!block.includes('.marketplaceListingCard .thumbBadges .badge{'), 'cards are unchanged by v1.6.62 override');
if(process.exitCode) { console.error('\ncheck:v1662-bar-badges failed.'); process.exit(process.exitCode); }
console.log('\n5/5 v1.6.62 bar badge checks passed.');
