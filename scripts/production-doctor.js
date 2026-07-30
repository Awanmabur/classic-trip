#!/usr/bin/env node
const { env, validateEnv } = require('../src/config/env');
const { connectDb, mongoose } = require('../src/config/db');
const { connectRedis, closeRedis } = require('../src/config/redis');

function line(ok, label, detail = '') {
  console.log(`${ok ? '✓' : '✖'} ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const major = Number(process.versions.node.split('.')[0]);
  line(major >= 20, 'Node.js version', process.version);
  validateEnv();
  line(true, 'Environment', env.nodeEnv);
  line(env.mongoDbName === 'classic-trip' || /\/classic-trip(?:\?|$)/.test(env.mongoUri), 'MongoDB database', env.mongoDbName || 'from URI');
  await connectDb();
  const pingStarted = Date.now();
  await mongoose.connection.db.admin().ping();
  line(true, 'MongoDB ping', `${Date.now() - pingStarted}ms`);
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  const transactions = Boolean(hello.setName) || hello.msg === 'isdbgrid';
  line(!env.mongoTransactions || transactions, 'Transaction support', transactions ? 'available' : 'unavailable');
  line(env.mongoPool.max >= env.mongoPool.min, 'MongoDB pool', `${env.mongoPool.min}-${env.mongoPool.max}`);
  const redis = await connectRedis();
  line(!env.redis.required || Boolean(redis), 'Redis', redis ? 'connected' : 'MongoDB fallback');
  line(true, 'Scheduled jobs process', env.jobs.enabled ? 'this process' : 'separate worker expected');
  line(!env.isProduction || env.maps.routingApiUrl, 'Live routing', env.maps.routingApiUrl || 'not configured');
  console.log('✓ Doctor checks complete.');
}

main()
  .catch((error) => { console.error(`✖ ${error.message}`); process.exitCode = 1; })
  .finally(async () => { await closeRedis().catch(() => {}); await mongoose.disconnect().catch(() => {}); });
