'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { buildSeatDefinitions, parseDurationMinutes } = require('../src/modules/bus/domain/busDomain');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const dashboard = read('public/js/dashboard-workspace.js');
const departures = read('src/modules/bus/services/busDepartureService.js');
const setup = read('src/modules/bus/services/busSetupService.js');
const projection = read('src/services/dashboard/dashboardProjectionEngine.js');

const checks = [];
function check(label, fn) {
  try { fn(); checks.push({ label, ok:true }); }
  catch (error) { checks.push({ label, ok:false, error:error.message }); }
}

check('automatic numbering generates every seat without manual labels', () => {
  const result = buildSeatDefinitions({ totalSeats:48, rows:12, columns:4, layoutName:'2x2', labelMode:'automatic' });
  assert.strictEqual(result.seats.length, 48);
  assert.strictEqual(result.seats[0].seatNumber, '1');
  assert.strictEqual(result.seats[47].seatNumber, '48');
});
check('row-position numbering generates unique labels', () => {
  const result = buildSeatDefinitions({ totalSeats:8, rows:2, columns:4, layoutName:'2x2', labelMode:'row_letters' });
  assert.deepStrictEqual(result.seats.map(seat => seat.seatNumber), ['A1','A2','A3','A4','B1','B2','B3','B4']);
});
check('prefix numbering generates the expected capacity', () => {
  const result = buildSeatDefinitions({ totalSeats:3, rows:1, columns:3, labelMode:'prefix_numeric', labelPrefix:'S' });
  assert.deepStrictEqual(result.seats.map(seat => seat.seatNumber), ['S1','S2','S3']);
});
check('custom labels require one label per seat', () => {
  assert.throws(() => buildSeatDefinitions({ totalSeats:4, rows:1, columns:4, labelMode:'custom', labels:['A','B'] }), /exactly 4/i);
});
check('duplicate custom labels are rejected', () => {
  assert.throws(() => buildSeatDefinitions({ totalSeats:3, rows:1, columns:3, labelMode:'custom', labels:['A','A','B'] }), /duplicate/i);
});
check('special seats must exist in selected seat map', () => {
  assert.throws(() => buildSeatDefinitions({ totalSeats:3, rows:1, columns:3, labelMode:'automatic', vipSeats:['99'] }), /not in this seat map/i);
});
check('disabled seats are non-sellable', () => {
  const result = buildSeatDefinitions({ totalSeats:3, rows:1, columns:3, labelMode:'automatic', disabledSeats:['2'] });
  assert.strictEqual(result.seats[1].enabled, false);
});
check('semicolon-separated custom labels are accepted consistently', () => {
  const result = buildSeatDefinitions({ totalSeats:3, rows:1, columns:3, labelMode:'custom', labels:'A;B;C' });
  assert.deepStrictEqual(result.seats.map(seat => seat.seatNumber), ['A','B','C']);
});
check('crew and disabled category conflicts are rejected', () => {
  assert.throws(() => buildSeatDefinitions({ totalSeats:3, rows:1, columns:3, labelMode:'automatic', vipSeats:['1'], crewSeats:['1'] }), /Crew-only seats/i);
  assert.throws(() => buildSeatDefinitions({ totalSeats:3, rows:1, columns:3, labelMode:'automatic', accessibleSeats:['2'], disabledSeats:['2'] }), /Non-sellable spaces/i);
});
check('duration text is converted consistently', () => assert.strictEqual(parseDurationMinutes('1d 2h 30m'), 1590));

const staticAssertions = [
  ['smart form metadata is attached to CRUD forms', /data-form-type=/],
  ['seat numbering mode is exposed', /name:'seatLabelMode'/],
  ['custom seat editor is exposed', /type:'seat-labels'/],
  ['seat editor validates exact capacity', /Custom numbering needs exactly/],
  ['complete bus wizard derives linked records', /function syncBusServiceWizard/],
  ['bus listing reuses terminal location details', /function syncListingForm/],
  ['bus selection synchronizes linked fields', /function syncVehicleSeatTemplateForm/],
  ['route selection synchronizes schedules', /function syncScheduleForm/],
  ['route endpoints generate route identity', /function syncRouteForm/],
  ['fare currency is route derived', /function syncFareForm/],
  ['blocked seats use vehicle seat options', /options:vehicleSeatOptions/],
  ['smart form sync runs after modal creation', /syncSmartBusForm\(els\.crudModal\.querySelector\('#crudForm'\)\)/],
  ['departure inventory validates blocked labels', /unknownBlockedSeats/],
  ['departure inventory applies blocked status', /Blocked for this departure/],
  ['backend auto resolves a single eligible vehicle', /candidates\.length === 1/],
  ['route stop permissions derive from stop type', /defaultPickupAllowed/],
  ['vehicle options include published seat labels', /seatLabels: versionSeats/],
  ['vehicle-specific seat options are projected', /vehicleSeats:/],
  ['dynamic special-seat options are keyed to their own fields', /data-field-name=\"\$\{escapeHtml\(field\.name\)\}\"/],
  ['special-seat selectors refresh from the current seat design', /function refreshSeatSpecialOptions/]
];
for (const [label, pattern] of staticAssertions) {
  check(label, () => assert(pattern.test([dashboard, departures, setup, projection].join('\n')), `Missing pattern ${pattern}`));
}

const failed = checks.filter(item => !item.ok);
if (failed.length) {
  console.error(JSON.stringify({ passed:checks.length-failed.length, failed:failed.length, checks }, null, 2));
  process.exit(1);
}
console.log(`Smart bus form verification passed (${checks.length}/${checks.length}).`);
