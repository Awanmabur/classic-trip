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
// npm start must be stable. File watching is opt-in through npm run dev only.
const watch = process.argv.includes('--watch');
const workerFlag = String(process.env.RUN_BACKGROUND_WORKER || '').trim().toLowerCase();
const devWorkerFlag = String(process.env.RUN_BACKGROUND_WORKER_DEV || '').trim().toLowerCase();
const productionWorkerRequested = workerFlag ? workerFlag !== 'false' : true;
// Local npm start is always request-serving only. Run `npm run worker` separately
// when testing background jobs; an old RUN_BACKGROUND_WORKER=true cannot starve localhost.
const runBackgroundWorker = nodeEnv === 'development' ? devWorkerFlag === 'true' : productionWorkerRequested;
const explicitWebRollingFallback = String(process.env.WEB_ROLLING_FALLBACK || '').trim().toLowerCase();
// The web process never becomes a rolling worker implicitly. If an operator
// intentionally runs without a worker, WEB_ROLLING_FALLBACK=true must be explicit.
const webRollingFallback = nodeEnv !== 'development' && !runBackgroundWorker && explicitWebRollingFallback === 'true';
const webRollingEnv = { WEB_ROLLING_FALLBACK: webRollingFallback ? 'true' : 'false' };
process.env.NODE_ENV = nodeEnv;

const children = new Set();
let stopping = false;
let workerRestartTimer = null;

function launch(name, args, envOverrides = {}, options = {}) {
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
    if (options.critical === false) {
      console.error(`! ${name} exited; web process remains online — code=${code ?? ''} signal=${signal || ''}`);
      if (options.restart === true) {
        workerRestartTimer = setTimeout(() => {
          workerRestartTimer = null;
          if (!stopping) launch(name, args, envOverrides, options);
        }, Math.max(5000, Number(options.restartDelayMs || 15000)));
        workerRestartTimer.unref?.();
      }
      return;
    }
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
  if (workerRestartTimer) clearTimeout(workerRestartTimer);
  workerRestartTimer = null;
  for (const child of children) child.kill(signal);
  const force = setTimeout(() => process.exit(1), 12000);
  force.unref();
  Promise.all([...children].map((child) => new Promise((resolve) => child.once('exit', resolve))))
    .finally(() => process.exit(0));
}

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stopAll(signal));

if (!watch) {
  launch('web', [path.join(process.cwd(), 'src', 'server.js')], { ...webRollingEnv, CLASSIC_TRIP_PROCESS_ROLE: 'web' });
} else {
  // Node >=20 provides a supported cross-platform watcher, so development no
  // longer needs Nodemon or its transitive dependency tree.
  launch('web', [
    '--watch',
    '--watch-preserve-output',
    path.join(process.cwd(), 'src', 'server.js'),
  ], { ...webRollingEnv, CLASSIC_TRIP_PROCESS_ROLE: 'web' });
}

// Local development defaults to web-only so maintenance cannot starve page requests.
// Production defaults to starting the worker unless RUN_BACKGROUND_WORKER=false is
// explicitly configured for a deployment that has a separate worker service.
if (runBackgroundWorker) launch('worker', [path.join(process.cwd(), 'src', 'worker.js')], { WEB_ROLLING_FALLBACK: 'false', CLASSIC_TRIP_PROCESS_ROLE: 'worker' }, { critical: false, restart: true, restartDelayMs: 15000 });
