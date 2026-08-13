#!/usr/bin/env node
'use strict';

const path = require('path');
const dns = require('dns').promises;
const net = require('net');

try {
  require('dotenv').config({ path: path.join(process.cwd(), '.env') });
} catch (_) {}

const { createClient } = require('redis');
const { env } = require('../src/config/env');
const { connectDb, mongoose } = require('../src/config/db');

function line(kind, label, detail = '') {
  const icon = kind === 'ok' ? '✓' : kind === 'warn' ? '!' : '✖';
  console.log(`${icon} ${label}${detail ? ` — ${detail}` : ''}`);
}

async function tcpProbe(host, port, timeoutMs = 3000) {
  const started = Date.now();
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const done = (ok, detail) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ok, ms: Date.now() - started, detail });
    };
    socket.setTimeout(timeoutMs, () => done(false, 'timeout'));
    socket.once('connect', () => done(true, 'reachable'));
    socket.once('error', (error) => done(false, error.code || error.message));
  });
}

function mongoSrvHostname(uri) {
  const match = String(uri || '').match(/^mongodb\+srv:\/\/(?:[^@/]+@)?([^/?]+)/i);
  return match?.[1] || '';
}

async function probeMongoMembers() {
  const host = mongoSrvHostname(env.mongoUri);
  if (!host) return;
  try {
    const records = await dns.resolveSrv(`_mongodb._tcp.${host}`);
    line('ok', 'MongoDB SRV', `${host} → ${records.length} member(s)`);
    const results = await Promise.all(records.map(async (record) => ({
      record,
      probe: await tcpProbe(record.name, record.port, 3000),
    })));
    for (const { record, probe } of results) {
      line(probe.ok ? 'ok' : 'warn', `MongoDB TCP ${record.name}:${record.port}`, `${probe.detail} in ${probe.ms}ms`);
    }
  } catch (error) {
    line('warn', 'MongoDB SRV member probe', error.code || error.message);
  }
}

async function probeRedis() {
  if (!env.redis.url) {
    line('warn', 'Redis URL', 'not configured; run npm run redis:local and set REDIS_URL=redis://127.0.0.1:6379');
    return false;
  }
  let parsed;
  try {
    parsed = new URL(env.redis.url);
  } catch (_) {
    line('error', 'Redis URL', 'invalid');
    return false;
  }
  const host = parsed.hostname;
  const port = Number(parsed.port || 6379);
  try {
    const addresses = await dns.lookup(host, { all: true });
    line('ok', 'Redis DNS', `${host} → ${addresses.map((entry) => entry.address).join(', ')}`);
  } catch (error) {
    line('error', 'Redis DNS', error.code || error.message);
    return false;
  }
  const tcp = await tcpProbe(host, port, 3000);
  line(tcp.ok ? 'ok' : 'error', `Redis TCP ${host}:${port}`, `${tcp.detail} in ${tcp.ms}ms`);
  if (!tcp.ok) return false;

  const client = createClient({
    url: env.redis.url,
    socket: { connectTimeout: 3000, reconnectStrategy: false },
  });
  client.on('error', () => {});
  try {
    await client.connect();
    const started = Date.now();
    const pong = await client.ping();
    line(pong === 'PONG' ? 'ok' : 'error', 'Redis PING', `${pong} in ${Date.now() - started}ms`);
    return pong === 'PONG';
  } catch (error) {
    line('error', 'Redis PING', error.code || error.message);
    return false;
  } finally {
    if (client.isOpen) { try { client.destroy(); } catch (_) {} }
  }
}

async function main() {
  console.log('Classic Trip network doctor\n');
  await probeMongoMembers();
  let mongoOk = false;
  try {
    const started = Date.now();
    await connectDb();
    await mongoose.connection.db.admin().ping();
    line('ok', 'MongoDB application connection', `PING in ${Date.now() - started}ms`);
    mongoOk = true;
  } catch (error) {
    line('error', 'MongoDB application connection', error.message);
  }

  const redisOk = await probeRedis();
  console.log('');
  if (mongoOk && redisOk) {
    console.log('✓ Network doctor passed — MongoDB and Redis are usable.');
  } else if (mongoOk && !env.redis.required) {
    console.log('! MongoDB is usable; Redis is unavailable but is optional in this environment.');
  } else {
    process.exitCode = 1;
    console.log('✖ Network doctor found a required connectivity problem.');
  }
}

main()
  .catch((error) => {
    console.error(`✖ Network doctor failed — ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
