'use strict';

const redisRuntime = require('../config/redis');
const { MongoRateLimitStore } = require('./mongoRateLimitStore');

const INCREMENT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if hits == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {hits, ttl}
`;

class RedisRateLimitStore {
  constructor(prefix = 'general') {
    this.prefix = String(prefix || 'general').replace(/[^a-z0-9_-]/gi, '_').slice(0, 48);
    this.localKeys = false;
    this.windowMs = 60_000;
    this.mongoFallback = new MongoRateLimitStore(prefix);
  }

  init(options = {}) {
    this.windowMs = Math.max(1_000, Number(options.windowMs) || this.windowMs);
    this.mongoFallback.init(options);
  }

  redisKey(key) {
    return redisRuntime.key('rate-limit', `${this.prefix}:${key}`);
  }

  async increment(key) {
    const client = redisRuntime.activeClient();
    if (!client) return this.mongoFallback.increment(key);
    try {
      const [hits, ttl] = await client.sendCommand([
        'EVAL',
        INCREMENT_SCRIPT,
        '1',
        this.redisKey(key),
        String(this.windowMs),
      ]);
      return {
        totalHits: Number(hits || 1),
        resetTime: new Date(Date.now() + Math.max(0, Number(ttl || this.windowMs))),
      };
    } catch (_) {
      return this.mongoFallback.increment(key);
    }
  }

  async decrement(key) {
    const client = redisRuntime.activeClient();
    if (!client) return this.mongoFallback.decrement(key);
    try {
      await client.decr(this.redisKey(key));
    } catch (_) {
      await this.mongoFallback.decrement(key);
    }
  }

  async resetKey(key) {
    const client = redisRuntime.activeClient();
    if (!client) return this.mongoFallback.resetKey(key);
    try {
      await client.del(this.redisKey(key));
    } catch (_) {
      await this.mongoFallback.resetKey(key);
    }
  }

  async resetAll() {
    // Each limiter uses window-scoped keys with short TTLs. Avoid a production
    // KEYS/SCAN sweep; Mongo remains responsible only when Redis is unavailable.
    if (!redisRuntime.activeClient()) await this.mongoFallback.resetAll();
  }

  shutdown() {}
}

module.exports = { RedisRateLimitStore };
