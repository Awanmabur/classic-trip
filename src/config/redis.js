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
  if (!env.redis.url) {
    if (env.isProduction) logger.warn('Redis is not configured; shared marketplace and session caches are unavailable');
    return null;
  }
  if (activeClient()) return client;
  if (connecting) return connecting;

  client = createClient({
    url: env.redis.url,
    socket: {
      connectTimeout: env.redis.connectTimeoutMs,
      reconnectStrategy(retries) {
        if (retries >= 3) return false;
        return Math.min(250 * (retries + 1), 3000);
      },
    },
  });
  client.on('error', (error) => {
    logger.warn('Redis connection error', { error: error.message });
  });

  connecting = client.connect()
    .then(async () => {
      await client.ping();
      logger.startup('Redis connected', { sessions: true, rateLimits: true, marketplaceCache: true });
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
