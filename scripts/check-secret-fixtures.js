'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const scanRoots = ['src', 'scripts', 'tests', 'public'];
const rootFiles = ['.env.example', 'render.yaml'];
const readableExtensions = new Set(['.js', '.cjs', '.mjs', '.ejs', '.json', '.yaml', '.yml', '.md', '.txt', '.css', '.html']);
const credentialBearingMongoUri = /mongodb(?:\+srv)?:\/\/[^/\s:@'"`]+:[^@\s/'"`]+@/i;
const failures = [];

function scanFile(file) {
  const relative = path.relative(root, file);
  const source = fs.readFileSync(file, 'utf8');
  if (credentialBearingMongoUri.test(source)) failures.push(`${relative}: credential-bearing MongoDB URI`);
}

function walk(directory) {
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target);
    else if (readableExtensions.has(path.extname(entry.name).toLowerCase())) scanFile(target);
  });
}

scanRoots.forEach((directory) => walk(path.join(root, directory)));
rootFiles.forEach((file) => scanFile(path.join(root, file)));

const startupGate = fs.readFileSync(path.join(root, 'scripts/check-v1646-render-startup-failfast.js'), 'utf8');
if (startupGate.includes('...process.env')) failures.push('startup regression inherits the complete parent environment');

if (failures.length) {
  failures.forEach((failure) => console.error(`FAIL: ${failure}`));
  console.error(`Secret-fixture check failed (${failures.length} finding${failures.length === 1 ? '' : 's'}).`);
  process.exit(1);
}

console.log('Secret-fixture check passed: no credential-bearing MongoDB URI or full environment inheritance.');
