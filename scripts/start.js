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
const runBackgroundWorker = String(process.env.RUN_BACKGROUND_WORKER || 'true').trim().toLowerCase() !== 'false';
const explicitWebRollingFallback = String(process.env.WEB_ROLLING_FALLBACK || '').trim().toLowerCase();
// A production web process must never silently become a second rolling worker.
// Standalone development can keep the fallback; production requires an explicit
// WEB_ROLLING_FALLBACK=true when no dedicated worker exists.
const webRollingFallback = !runBackgroundWorker && (explicitWebRollingFallback
  ? explicitWebRollingFallback === 'true'
  : nodeEnv !== 'production');
const webRollingEnv = { WEB_ROLLING_FALLBACK: webRollingFallback ? 'true' : 'false' };
process.env.NODE_ENV = nodeEnv;

const children = new Set();
let stopping = false;

function launch(name, args, envOverrides = {}) {
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...envOverrides },
    stdio: 'inherit',
  });
  child.processName = name;
  children.add(child);
  child.once('exit', (code, signal) => {
    children.delete(child);
    if (stopping) return;
    stopping = true;
    for (const sibling of children) sibling.kill('SIGTERM');
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
  return child;
}

function stopAll(signal) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
  const force = setTimeout(() => process.exit(1), 12000);
  force.unref();
  Promise.all([...children].map((child) => new Promise((resolve) => child.once('exit', resolve))))
    .finally(() => process.exit(0));
}

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stopAll(signal));

if (!watch) {
  launch('web', [path.join(process.cwd(), 'src', 'server.js')], webRollingEnv);
} else {
  // Node >=20 provides a supported cross-platform watcher, so development no
  // longer needs Nodemon or its transitive dependency tree.
  launch('web', [
    '--watch',
    '--watch-preserve-output',
    path.join(process.cwd(), 'src', 'server.js'),
  ], webRollingEnv);
}

// Rolling departures, outbox notifications, payment expiry and other scheduled
// work must run with the normal one-command startup. Set RUN_BACKGROUND_WORKER=false
// only when the deployment already has a dedicated `npm run worker` process.
if (runBackgroundWorker) launch('worker', [path.join(process.cwd(), 'src', 'worker.js')], { WEB_ROLLING_FALLBACK: 'false' });
