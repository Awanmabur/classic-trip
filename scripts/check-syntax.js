'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const roots = ['src', 'scripts', 'tests', 'public'].map((folder) => path.join(root, folder)).filter(fs.existsSync);

function walk(dir, files = []) {
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (!['node_modules', 'coverage', 'dist', 'build'].includes(item)) walk(full, files);
    } else if (full.endsWith('.js')) files.push(full);
  }
  return files;
}

const files = roots.flatMap((dir) => walk(dir));
const failures = [];
for (const file of files) {
  try {
    const source = fs.readFileSync(file, 'utf8').replace(/^#!.*\n/, '');
    new vm.Script(source, { filename: path.relative(root, file), displayErrors: true });
  } catch (error) {
    failures.push({ file: path.relative(root, file), message: error.message });
  }
}

if (failures.length) {
  console.error(`JavaScript syntax validation failed (${files.length - failures.length}/${files.length}).`);
  failures.forEach((failure) => console.error(`- ${failure.file}: ${failure.message}`));
  process.exit(1);
}

console.log(`JavaScript syntax validation passed (${files.length}/${files.length}).`);
