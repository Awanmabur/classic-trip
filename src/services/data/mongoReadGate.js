'use strict';

const { env } = require('../../config/env');

// One process-wide admission gate protects normal auth/session/payment traffic
// from large dashboard/catalog fan-outs. Queueing is deliberately bounded: when
// Atlas is unhealthy, requests should use stale caches or fail fast instead of
// becoming an unbounded backlog.
const configuredLimit = Math.max(2, Number(env.performance?.mongoReadConcurrency || 6));
const poolSize = Math.max(5, Number(env.mongoPool?.max || 24));
const reservedConnections = Math.max(3, Math.ceil(poolSize / 2));
const MAX_ACTIVE_READS = Math.max(2, Math.min(configuredLimit, poolSize - reservedConnections));
const READ_QUEUE_TIMEOUT_MS = Math.max(250, Number(env.performance?.mongoReadQueueTimeoutMs || 1200));

let activeReads = 0;
const waiters = [];

function overloadError() {
  const error = new Error('MongoDB read capacity is temporarily busy');
  error.status = 503;
  error.code = 'mongodb_read_queue_busy';
  error.publicMessage = 'This page is temporarily busy. Please retry in a moment.';
  return error;
}

function release() {
  activeReads = Math.max(0, activeReads - 1);
  while (waiters.length) {
    const next = waiters.shift();
    if (!next || next.cancelled) continue;
    clearTimeout(next.timer);
    activeReads += 1;
    next.resolve(release);
    break;
  }
}

function acquire() {
  if (activeReads < MAX_ACTIVE_READS) {
    activeReads += 1;
    return Promise.resolve(release);
  }
  return new Promise((resolve, reject) => {
    const waiter = { resolve, reject, cancelled: false, timer: null };
    waiter.timer = setTimeout(() => {
      waiter.cancelled = true;
      reject(overloadError());
    }, READ_QUEUE_TIMEOUT_MS);
    waiter.timer.unref?.();
    waiters.push(waiter);
  });
}

async function runMongoRead(work) {
  if (typeof work !== 'function') throw new TypeError('runMongoRead requires a function');
  const done = await acquire();
  try {
    return await work();
  } finally {
    done();
  }
}

function mongoReadGateStats() {
  return {
    active: activeReads,
    queued: waiters.filter((waiter) => !waiter.cancelled).length,
    limit: MAX_ACTIVE_READS,
    queueTimeoutMs: READ_QUEUE_TIMEOUT_MS,
    poolSize,
    reservedConnections,
  };
}

module.exports = { runMongoRead, mongoReadGateStats, MAX_ACTIVE_READS, READ_QUEUE_TIMEOUT_MS };
