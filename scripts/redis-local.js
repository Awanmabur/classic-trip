#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');

const CONTAINER = process.env.REDIS_LOCAL_CONTAINER || 'classic-trip-redis';
const IMAGE = process.env.REDIS_LOCAL_IMAGE || 'redis:7-alpine';
const HOST_PORT = String(process.env.REDIS_LOCAL_PORT || '6379');

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    ...options,
  });
}

function output(result) {
  return String(result?.stdout || result?.stderr || '').trim();
}

function fail(message, result) {
  console.error(`✖ ${message}`);
  const detail = output(result);
  if (detail) console.error(detail);
  process.exit(1);
}

const docker = run('docker', ['info']);
if (docker.error || docker.status !== 0) {
  fail('Docker Desktop is not available. Start Docker Desktop, then run npm run redis:local again.', docker);
}

const inspect = run('docker', ['inspect', '-f', '{{.State.Running}}', CONTAINER]);
if (inspect.status !== 0) {
  console.log(`Creating ${CONTAINER} on 127.0.0.1:${HOST_PORT}...`);
  const created = run('docker', [
    'run', '-d',
    '--name', CONTAINER,
    '--restart', 'unless-stopped',
    '-p', `127.0.0.1:${HOST_PORT}:6379`,
    IMAGE,
    'redis-server', '--appendonly', 'yes',
  ]);
  if (created.status !== 0) fail(`Could not create ${CONTAINER}.`, created);
} else if (String(inspect.stdout).trim() !== 'true') {
  console.log(`Starting ${CONTAINER}...`);
  const started = run('docker', ['start', CONTAINER]);
  if (started.status !== 0) fail(`Could not start ${CONTAINER}.`, started);
}

let ready = false;
for (let attempt = 0; attempt < 20; attempt += 1) {
  const ping = run('docker', ['exec', CONTAINER, 'redis-cli', 'ping']);
  if (ping.status === 0 && String(ping.stdout).trim() === 'PONG') {
    ready = true;
    break;
  }
  // Synchronous script by design; Atomics.wait avoids platform-specific shell sleep.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
}

if (!ready) fail(`${CONTAINER} started but Redis did not answer PING.`);
console.log(`✓ Local Redis is ready — redis://127.0.0.1:${HOST_PORT}`);
console.log(`✓ Container ${CONTAINER} will restart automatically unless explicitly stopped.`);
