'use strict';

const crypto = require('crypto');
const { mongoose } = require('../../config/db');
const redisRuntime = require('../../config/redis');

const RENEW_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

function ownerId() {
  return `worker-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
}

function safeName(value) {
  return String(value || '').replace(/[^a-z0-9:_-]/gi, '_').slice(0, 120);
}

function mongoReady() { return mongoose.connection.readyState === 1; }

async function acquireRedis(name, owner, ttlMs) {
  const client = redisRuntime.activeClient();
  if (!client) return null;
  const key = redisRuntime.key('job-lease', safeName(name));
  const result = await client.set(key, owner, { NX: true, PX: ttlMs });
  if (result !== 'OK') return { acquired: false, backend: 'redis', ownerId: owner };
  return {
    acquired: true,
    backend: 'redis',
    ownerId: owner,
    async renew() {
      return Number(await client.sendCommand(['EVAL', RENEW_SCRIPT, '1', key, owner, String(ttlMs)])) > 0;
    },
    async release() {
      return Number(await client.sendCommand(['EVAL', RELEASE_SCRIPT, '1', key, owner])) > 0;
    },
  };
}

async function acquireMongo(name, owner, ttlMs) {
  if (!mongoReady()) return null;
  const ScheduledJobLease = require('../../models/ScheduledJobLease');
  const timestamp = new Date();
  const expiresAt = new Date(timestamp.getTime() + ttlMs);
  try {
    const row = await ScheduledJobLease.findOneAndUpdate({
      name,
      $or: [{ expiresAt: { $lte: timestamp } }, { ownerId: owner }],
    }, {
      $set: { ownerId: owner, renewedAt: timestamp, expiresAt },
      $setOnInsert: { acquiredAt: timestamp },
    }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }).lean();
    if (!row || row.ownerId !== owner) return { acquired: false, backend: 'mongo', ownerId: owner };
  } catch (error) {
    if (Number(error?.code) === 11000) return { acquired: false, backend: 'mongo', ownerId: owner };
    throw error;
  }
  return {
    acquired: true,
    backend: 'mongo',
    ownerId: owner,
    async renew() {
      const renewedAt = new Date();
      const result = await ScheduledJobLease.updateOne(
        { name, ownerId: owner },
        { $set: { renewedAt, expiresAt: new Date(renewedAt.getTime() + ttlMs) } },
      );
      return Number(result.modifiedCount || result.nModified || 0) === 1;
    },
    async release() {
      const result = await ScheduledJobLease.deleteOne({ name, ownerId: owner });
      return Number(result.deletedCount || 0) === 1;
    },
  };
}

async function acquire(name, ttlMs = 10 * 60 * 1000) {
  const normalizedName = safeName(name);
  const safeTtl = Math.max(30_000, Math.min(Number(ttlMs) || 600_000, 6 * 60 * 60 * 1000));
  const owner = ownerId();
  // MongoDB is the authoritative lease store because every production worker
  // must already have it. Mixing Redis leases on healthy workers with Mongo
  // leases on a temporarily disconnected Redis worker would create two lock
  // domains and permit the same job to overlap.
  const mongoLease = await acquireMongo(normalizedName, owner, safeTtl);
  if (mongoLease) return mongoLease;
  try {
    const redisLease = await acquireRedis(normalizedName, owner, safeTtl);
    if (redisLease) return redisLease;
  } catch (_) {
    // Isolated development tooling can still use its configured Redis store.
  }
  // Tests and isolated development tools without connected stores still retain
  // the scheduler's in-process lock. Web/worker production startup always has MongoDB.
  return { acquired: true, backend: 'local', ownerId: owner, renew: async () => true, release: async () => true };
}

function keepAlive(lease, ttlMs) {
  if (!lease?.acquired || lease.backend === 'local') return () => {};
  const timer = setInterval(() => lease.renew().catch(() => {}), Math.max(10_000, Math.floor(ttlMs / 3)));
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { acquire, keepAlive, safeName, mongoReady };
