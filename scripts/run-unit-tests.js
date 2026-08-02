#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const testsDir = path.join(root, 'tests', 'unit');
const testFiles = fs.readdirSync(testsDir)
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => path.join(testsDir, name));

if (!testFiles.length) {
  console.error('No unit tests were found.');
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [
    '--test',
    '--test-concurrency=1',
    '--require',
    path.join(root, 'tests', 'node-test-compat.js'),
    ...testFiles,
  ],
  { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test' } },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
