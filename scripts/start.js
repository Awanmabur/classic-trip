#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawn } = require('child_process');

try {
  require('dotenv').config({ path: path.join(process.cwd(), '.env') });
} catch (_) {
  // The server's environment validator reports a useful error if dotenv is unavailable.
}

const aliases = Object.freeze({ develoment: 'development', developement: 'development', dev: 'development', prod: 'production' });
const rawNodeEnv = String(process.env.NODE_ENV || 'development').trim().toLowerCase();
const nodeEnv = aliases[rawNodeEnv] || rawNodeEnv;
const watch = process.argv.includes('--watch') || nodeEnv !== 'production';
process.env.NODE_ENV = nodeEnv;

if (!watch) {
  require('../src/server');
} else {
  // Node >=20 provides a supported cross-platform watcher, so development no
  // longer needs Nodemon or its transitive dependency tree.
  const child = spawn(process.execPath, [
    '--watch',
    '--watch-preserve-output',
    path.join(process.cwd(), 'src', 'server.js'),
  ], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => child.kill(signal));
  }
  child.once('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
}
