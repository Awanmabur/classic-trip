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
  let runtimeOutageStartedAt = 0;
  let runtimeOutageWarningTimer = null;
  let runtimeOutageError = '';

  function clearRuntimeOutageWarning() {
    if (runtimeOutageWarningTimer) clearTimeout(runtimeOutageWarningTimer);
    runtimeOutageWarningTimer = null;
  }

  function scheduleRuntimeOutageWarning(errorMessage = '') {
    if (!hasBeenReady) return;
    if (!runtimeOutageStartedAt) runtimeOutageStartedAt = Date.now();
    runtimeOutageError = errorMessage || runtimeOutageError;
    if (runtimeOutageWarningTimer) return;
    runtimeOutageWarningTimer = setTimeout(() => {
      runtimeOutageWarningTimer = null;
      const now = Date.now();
      if (now - lastErrorLogAt < env.redis.errorLogThrottleMs) return;
      lastErrorLogAt = now;
      logger.warn('Redis connection interrupted; automatic recovery active', {
        error: runtimeOutageError || 'socket_closed',
        outageMs: Math.max(0, now - runtimeOutageStartedAt),
      });
    }, env.redis.transientNoticeDelayMs);
    runtimeOutageWarningTimer.unref?.();
  }

  client = createClient({
    url: env.redis.url,
    // A periodic PING keeps long-lived cloud/Docker/NAT connections active and
    // detects a dead socket early instead of discovering it on a user request.
    pingInterval: env.redis.pingIntervalMs,
    socket: {
      connectTimeout: env.redis.connectTimeoutMs,
      keepAlive: true,
      keepAliveInitialDelay: env.redis.keepAliveInitialDelayMs,
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
    // Docker Desktop/NAT can occasionally reset an otherwise healthy TCP socket
    // for a few milliseconds. node-redis reconnects automatically. Do not flood
    // operators with a warning unless the outage survives the short grace period.
    if (hasBeenReady) scheduleRuntimeOutageWarning(error.message);
  });
  client.on('reconnecting', () => {
    if (!hasBeenReady) return;
    const now = Date.now();
    if (!runtimeOutageStartedAt) runtimeOutageStartedAt = now;
    if (now - reconnectNoticeAt >= env.redis.errorLogThrottleMs) reconnectNoticeAt = now;
  });
  client.on('ready', () => {
    const wasReady = hasBeenReady;
    const outageMs = runtimeOutageStartedAt ? Math.max(0, Date.now() - runtimeOutageStartedAt) : 0;
    clearRuntimeOutageWarning();
    runtimeOutageStartedAt = 0;
    runtimeOutageError = '';
    hasBeenReady = true;
    // Only surface a recovery event when Redis was actually unavailable long
    // enough to matter. Brief socket swaps stay invisible to users/operators.
    if (wasReady && outageMs >= env.redis.transientNoticeDelayMs) {
      logger.startup('Redis reconnected', { sessions: true, rateLimits: true, outageMs });
    }
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
