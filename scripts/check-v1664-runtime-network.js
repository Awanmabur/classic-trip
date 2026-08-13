'use strict';

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
let passed = 0;
function check(name, ok) {
  if (!ok) {
    console.error(`✗ ${name}`);
    process.exitCode = 1;
  } else {
    passed += 1;
    console.log(`✓ ${name}`);
  }
}

const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const redis = read('src/config/redis.js');
const env = read('src/config/env.js');
const envExample = read('.env.example');
const networkDoctor = read('scripts/doctor-network.js');
const localRedis = read('scripts/redis-local.js');
const sw = read('public/sw.js');
const render = read('render.yaml');

check('release is v1.6.64', pkg.version === '1.6.64' && lock.version === '1.6.64' && lock.packages?.['']?.version === '1.6.64');
check('doctor:network npm command exists', pkg.scripts?.['doctor:network'] === 'node scripts/doctor-network.js');
check('redis:local npm command exists', pkg.scripts?.['redis:local'] === 'node scripts/redis-local.js');
check('Redis keeps runtime recovery active after first healthy connection', redis.includes('if (!hasBeenReady && retries >= 3) return false;'));
check('Redis runtime reconnect uses bounded exponential backoff and jitter', redis.includes('2 ** exponent') && redis.includes('reconnectMaxDelayMs') && redis.includes('Math.random() * 200'));
check('Redis sends periodic health pings', redis.includes('pingInterval: env.redis.pingIntervalMs'));
check('Redis socket keepalive is explicitly enabled', redis.includes('keepAlive: true') && redis.includes('keepAliveInitialDelay: 5000'));
check('Redis socket errors are log-throttled', redis.includes('errorLogThrottleMs') && redis.includes('automatic recovery active'));
check('new Redis recovery controls are configurable', ['REDIS_PING_INTERVAL_MS', 'REDIS_RECONNECT_MAX_DELAY_MS', 'REDIS_ERROR_LOG_THROTTLE_MS'].every((key) => env.includes(key) && envExample.includes(key)));
check('network doctor probes MongoDB SRV members', networkDoctor.includes('resolveSrv') && networkDoctor.includes('MongoDB TCP'));
check('network doctor verifies Redis DNS TCP and PING', ['Redis DNS', 'Redis TCP', 'Redis PING'].every((token) => networkDoctor.includes(token)));
check('local Redis helper binds Docker Redis to loopback only', localRedis.includes('127.0.0.1:${HOST_PORT}:6379') && localRedis.includes("'--restart', 'unless-stopped'"));
check('local Redis helper verifies PONG', localRedis.includes("String(ping.stdout).trim() === 'PONG'"));
check('Render web and worker expose Redis recovery controls', ['REDIS_PING_INTERVAL_MS', 'REDIS_RECONNECT_MAX_DELAY_MS', 'REDIS_ERROR_LOG_THROTTLE_MS'].every((key) => (render.match(new RegExp(`key: ${key}`, 'g')) || []).length === 2));
check('service worker cache is v1.6.64', sw.includes('classic-trip-static-v1.6.64'));

if (!process.exitCode) console.log(`\n${passed}/${passed} v1.6.64 runtime/network checks passed.`);
