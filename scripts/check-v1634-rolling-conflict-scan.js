const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const rolling = read('src/jobs/materializeSchedules.js');
const pkg = JSON.parse(read('package.json'));
let passed = 0;
function check(label, ok){ if(!ok){ console.error('FAIL', label); process.exitCode=1; } else { passed += 1; console.log('PASS', label); } }
check('version is v1.6.35', pkg.version === '1.6.35');
check('rolling scan walks complete missing window', rolling.includes('for (const departAt of missingDates)') && !rolling.includes('Math.min(missingDates.length, 10)'));
check('rolling conflict rows are preloaded once', rolling.includes('const conflictRows = earliestMissing && latestMissing') && rolling.includes('vehicleConflictsFromRows(conflictRows, departAt, arriveAt)'));
check('rolling diagnostics include conflicting schedule and rule IDs', rolling.includes('conflictingScheduleId') && rolling.includes('conflictingRuleId'));
check('worker distinguishes exhausted conflict window', rolling.includes('Rolling window has no free missing date for this vehicle') && rolling.includes('noFreeDateFound'));
check('duplicate conflict warnings are cooled down', rolling.includes('ROLLING_CONFLICT_LOG_COOLDOWN_MS') && rolling.includes('Repeated rolling vehicle-conflict warning suppressed during cooldown'));
if(!process.exitCode) console.log(`v1.6.35 rolling conflict scan checks passed (${passed}/6).`);
