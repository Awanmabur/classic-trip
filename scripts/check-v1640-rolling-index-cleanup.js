'use strict';
const fs = require('fs');
function read(file){ return fs.readFileSync(file, 'utf8'); }
let passed = 0;
function check(name, ok){ if(!ok){ console.error('FAIL:', name); process.exitCode = 1; } else { passed += 1; console.log('PASS:', name); } }
const pkg = JSON.parse(read('package.json'));
const activity = read('src/models/PlatformActivity.js');
const ruleModel = read('src/models/ScheduleRule.js');
const rolling = read('src/jobs/materializeSchedules.js');
const departure = read('src/modules/bus/services/busDepartureService.js');
const projection = read('src/services/dashboard/dashboardProjectionEngine.js');
check('version preserves the v1.6.40+ baseline', Number(String(pkg.version).split('.')[2] || 0) >= 40);
check('monitoring expiresAt uses one explicit TTL index', activity.includes('expiresAt: { type: Date }') && activity.includes("platformActivitySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })") && !activity.includes('expiresAt: { type: Date, index: true }'));
check('recurring rules persist blocking rule IDs', ruleModel.includes('materializationBlockerRuleIds'));
check('historical full-window vehicle blockers are cleared instead of freezing rules', rolling.includes("startsWith('vehicle_schedule_conflict')") && !rolling.includes('persistFullWindowVehicleConflictBlocker'));
check('vehicle-conflict repairs have bounded five-minute fallback scans', rolling.includes('BACKGROUND_REPAIR_INTERVAL_MS = 5 * 60 * 1000'));
check('partial date conflicts still scan later free dates', rolling.includes('for (const departAt of missingDates)') && rolling.includes('if (maxCreates > 0 && dates.length >= maxCreates) break'));
check('blocking rule edits clear historical dependent blockers', departure.includes('clearDependentRecurringVehicleBlockers') && departure.includes("['vehicle_schedule_conflict', 'vehicle_schedule_conflict_window']"));
check('dependent rules are immediately requeued', departure.includes('dependency-cleared') && departure.includes("eventType: 'ScheduleRuleMaterializationRequested'"));
check('dashboard distinguishes auto-retried historical vehicle blockers from real action state', projection.includes('· retrying automatically') && projection.includes('· action needed') && projection.includes('materializationBlockerReason'));
check('worker log is concise for date-specific rolling conflicts', rolling.includes('Rolling window has no free missing date for this vehicle') && rolling.includes('Repeated rolling vehicle-conflict warning suppressed during cooldown'));
if (!process.exitCode) console.log(`v1.6.40 rolling/index cleanup checks passed (${passed}/10).`);
