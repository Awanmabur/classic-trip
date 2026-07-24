'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const failures = [];
const dashboardScriptPath = path.join(root, 'public/js/dashboard-workspace.js');
const dashboardScript = fs.readFileSync(dashboardScriptPath, 'utf8');

// Dashboard relationship fields must be selectors, multiselectors, or hidden context values.
// A conditional fallback to a text input is also forbidden because it exposes internal IDs.
const relationFieldPattern = /\{[^{}\n]*name\s*:\s*['"]([^'"]*(?:Id|Ids))['"][^{}\n]*\}/g;
let match;
while ((match = relationFieldPattern.exec(dashboardScript))) {
  const definition = match[0];
  const name = match[1];
  const selectorType = /type\s*:\s*['"](?:select|multiselect|hidden)['"]/.test(definition);
  const conditionalTextFallback = /type\s*:[^,}\n]*['"]text['"]/.test(definition);
  if (!selectorType || conditionalTextFallback) {
    const line = dashboardScript.slice(0, match.index).split('\n').length;
    failures.push(`public/js/dashboard-workspace.js:${line} relationship field '${name}' must use select/multiselect/hidden only`);
  }
}

function walk(directory) {
  const rows = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) rows.push(...walk(target));
    else if (entry.isFile() && entry.name.endsWith('.ejs')) rows.push(target);
  }
  return rows;
}

for (const file of walk(path.join(root, 'src/views/dashboards'))) {
  const source = fs.readFileSync(file, 'utf8');
  source.split('\n').forEach((lineText, index) => {
    const relationInput = lineText.match(/<input\b[^>]*\bname=["']([^"']*(?:Id|Ids))["'][^>]*>/i);
    if (relationInput && !/\btype=["'](?:hidden|radio|checkbox)["']/i.test(relationInput[0])) {
      failures.push(`${path.relative(root, file)}:${index + 1} visible relationship '${relationInput[1]}' must be selected, not typed`);
    }
    if (/<input\b[^>]*\bname=["']bookingRef["'][^>]*>/i.test(lineText)
      && !/\btype=["']hidden["']/i.test(lineText)) {
      failures.push(`${path.relative(root, file)}:${index + 1} authenticated dashboard bookingRef must use an owned-booking selector`);
    }
  });
}

if (!/dependsOn:'listingId'.*filterKey:'listingId'/.test(dashboardScript)
  || !/dependsOn:'roomTypeId'.*filterKey:'roomTypeId'/.test(dashboardScript)
  || !/dependsOn:'scheduleId'.*filterKey:'scheduleId'/.test(dashboardScript)) {
  failures.push('Dashboard cascading selectors must enforce listing, room-type, and schedule relationships');
}

if (failures.length) {
  console.error('Entity relationship UI audit failed:\n- ' + failures.join('\n- '));
  process.exit(1);
}
console.log('Entity relationship UI audit passed. Internal relationships are selected, filtered, or generated.');
