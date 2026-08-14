#!/usr/bin/env node
'use strict';
const { performance } = require('perf_hooks');
const { validateEnv } = require('../src/config/env');
const { connectDb, mongoose } = require('../src/config/db');
const { connectRedis, closeRedis, activeClient } = require('../src/config/redis');

async function timed(label, fn) {
  const started = performance.now();
  const value = await fn();
  const ms = Math.round(performance.now() - started);
  console.log(`${ms <= 500 ? '✓' : ms <= 1500 ? '!' : '✗'} ${label} — ${ms}ms`);
  return { value, ms };
}

async function main() {
  validateEnv();
  console.log(`Classic Trip performance doctor — Node ${process.version}`);
  await Promise.all([connectDb(), connectRedis()]);
  const redis = activeClient();
  await timed('MongoDB application PING', () => mongoose.connection.db.admin().command({ ping: 1 }));
  if (redis) await timed('Redis PING', () => redis.ping());
  const catalog = require('../src/services/marketplace/catalogService');
  await timed('Public discovery prewarm', () => catalog.prewarmHome());
  await timed('Warm Home bootstrap', () => catalog.homeBootstrap());
  console.log('\nTargets: warm Home <250ms; Redis <100ms. MongoDB >1000ms indicates network/Atlas latency that code cannot fully hide without caching.');
}

main()
  .catch((error) => { console.error(`✗ Performance doctor failed — ${error.message}`); process.exitCode = 1; })
  .finally(async () => {
    await closeRedis().catch(() => {});
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect().catch(() => {});
  });
