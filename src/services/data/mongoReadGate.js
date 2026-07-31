'use strict';

const { env } = require('../../config/env');

// MongoDB's driver has its own wait queue, but letting many independent
// dashboard/catalog snapshots all reach that queue at once creates a thundering
// herd: requests occupy every pool slot, then unrelated auth/session/write
// operations time out behind them. Keep one process-wide admission gate for
// bulk reads and deliberately reserve most of the pool for normal request work.
const configuredLimit = Math.max(2, Number(env.performance?.mongoReadConcurrency || 6));
const poolSize = Math.max(5, Number(env.mongoPool?.max || 24));
const reservedConnections = Math.max(3, Math.ceil(poolSize / 2));
const MAX_ACTIVE_READS = Math.max(2, Math.min(configuredLimit, poolSize - reservedConnections));

let activeReads = 0;
const waiters = [];

function release() {
  activeReads = Math.max(0, activeReads - 1);
  const next = waiters.shift();
  if (!next) return;
  activeReads += 1;
  next(release);
}

function acquire() {
  if (activeReads < MAX_ACTIVE_READS) {
    activeReads += 1;
    return Promise.resolve(release);
  }
  return new Promise((resolve) => waiters.push(resolve));
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
    queued: waiters.length,
    limit: MAX_ACTIVE_READS,
    poolSize,
    reservedConnections,
  };
}

module.exports = { runMongoRead, mongoReadGateStats, MAX_ACTIVE_READS };
