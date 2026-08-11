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
check('version includes v1.6.40 work', pkg.version === '1.6.45');
check('monitoring expiresAt uses one explicit TTL index', activity.includes('expiresAt: { type: Date }') && activity.includes("platformActivitySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })") && !activity.includes('expiresAt: { type: Date, index: true }'));
check('recurring rules persist blocking rule IDs', ruleModel.includes('materializationBlockerRuleIds'));
check('full-window recurring conflicts become persistent action blockers', rolling.includes("materializationBlockerCode: 'vehicle_schedule_conflict_window'") && rolling.includes('persistFullWindowVehicleConflictBlocker'));
check('full-window blockers have bounded automatic recheck', rolling.includes('FULL_WINDOW_CONFLICT_RECHECK_MS') && rolling.includes('6 * 60 * 60 * 1000'));
check('partial date conflicts still scan later free dates', rolling.includes('for (const departAt of missingDates)') && rolling.includes('if (maxCreates > 0 && dates.length >= maxCreates) break'));
check('blocking rule edits clear dependent blockers', departure.includes('clearDependentRecurringVehicleBlockers') && departure.includes("materializationBlockerCode: 'vehicle_schedule_conflict_window'"));
check('dependent rules are immediately requeued', departure.includes('dependency-cleared') && departure.includes("eventType: 'ScheduleRuleMaterializationRequested'"));
check('dashboard exposes recurring rule action state', projection.includes('· action needed') && projection.includes('materializationBlockerReason'));
check('worker log is concise for persistent full-window blockers', rolling.includes('Repeated full-window conflict scans are paused') || rolling.includes('repeated full-window conflict scans are paused'));
if (!process.exitCode) console.log(`v1.6.40 rolling/index cleanup checks passed (${passed}/10).`);
