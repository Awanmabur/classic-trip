'use strict';

const { createClient } = require('redis');
const { env } = require('./env');
const logger = require('./logger');

let client = null;
let connecting = null;

function activeClient() {
  return client?.isReady ? client : null;
}

async function connectRedis() {
  if (!env.redis.url) return null;
  if (activeClient()) return client;
  if (connecting) return connecting;

  let hasBeenReady = false;
  let lastErrorLogAt = 0;
  let reconnectNoticeAt = 0;

  client = createClient({
    url: env.redis.url,
    // A periodic PING keeps long-lived cloud/Docker/NAT connections active and
    // detects a dead socket early instead of discovering it on a user request.
    pingInterval: env.redis.pingIntervalMs,
    socket: {
      connectTimeout: env.redis.connectTimeoutMs,
      keepAlive: true,
      keepAliveInitialDelay: 5000,
      reconnectStrategy(retries) {
        // Keep startup bounded when Redis has never connected: Classic Trip can
        // intentionally fall back to MongoDB when Redis is optional. Once Redis
        // has been healthy, however, a transient ECONNRESET must never disable
        // caching/sessions for the lifetime of the web process.
        if (!hasBeenReady && retries >= 3) return false;
        const jitter = Math.floor(Math.random() * 200);
        const exponent = Math.min(Math.max(0, retries), 8);
        const delay = Math.min((2 ** exponent) * 50, env.redis.reconnectMaxDelayMs);
        return delay + jitter;
      },
    },
  });

  client.on('error', (error) => {
    const now = Date.now();
    // Runtime socket failures can emit repeatedly while node-redis reconnects.
    // Throttle the warning so one network flap does not flood Render logs.
    if (now - lastErrorLogAt >= env.redis.errorLogThrottleMs) {
      lastErrorLogAt = now;
      logger.warn('Redis connection error; automatic recovery active', { error: error.message });
    }
  });
  client.on('reconnecting', () => {
    const now = Date.now();
    if (hasBeenReady && now - reconnectNoticeAt >= env.redis.errorLogThrottleMs) {
      reconnectNoticeAt = now;
      logger.warn('Redis reconnecting; cache/rate-limit fallbacks remain available');
    }
  });
  client.on('ready', () => {
    if (hasBeenReady) logger.startup('Redis reconnected', { sessions: true, rateLimits: true });
    hasBeenReady = true;
  });

  connecting = client.connect()
    .then(async () => {
      await client.ping();
      logger.startup('Redis connected', { sessions: true, rateLimits: true });
      return client;
    })
    .catch((error) => {
      const failedClient = client;
      client = null;
      if (failedClient?.isOpen && typeof failedClient.destroy === 'function') failedClient.destroy();
      if (env.redis.required) throw new Error(`Redis connection failed: ${error.message}`);
      logger.warn('Redis unavailable; using durable MongoDB fallbacks', { error: error.message });
      return null;
    })
    .finally(() => {
      connecting = null;
    });
  return connecting;
}

async function closeRedis() {
  const current = client;
  client = null;
  if (!current?.isOpen) return;
  try {
    await current.quit();
  } catch (_) {
    if (typeof current.destroy === 'function') current.destroy();
  }
}

function key(namespace, value = '') {
  const cleanNamespace = String(namespace || 'cache').replace(/[^a-z0-9:_-]/gi, '_');
  return `${env.redis.prefix}${cleanNamespace}:${String(value || '')}`;
}

module.exports = { connectRedis, closeRedis, activeClient, key };
