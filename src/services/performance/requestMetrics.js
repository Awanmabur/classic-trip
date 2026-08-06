'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

function run(initial = {}, work) {
  const metrics = {
    requestId: String(initial.requestId || ''),
    mongoReads: 0,
    mongoMs: 0,
    mongoWaitMs: 0,
    mongoQueuePeak: 0,
  };
  return storage.run(metrics, work);
}

function recordMongoRead({ durationMs = 0, waitMs = 0, queued = 0 } = {}) {
  const metrics = storage.getStore();
  if (!metrics) return;
  metrics.mongoReads += 1;
  metrics.mongoMs += Number(durationMs || 0);
  metrics.mongoWaitMs += Number(waitMs || 0);
  metrics.mongoQueuePeak = Math.max(metrics.mongoQueuePeak, Number(queued || 0));
}

function current() {
  const metrics = storage.getStore();
  return metrics ? { ...metrics } : {
    requestId: '', mongoReads: 0, mongoMs: 0, mongoWaitMs: 0, mongoQueuePeak: 0,
  };
}

module.exports = { run, recordMongoRead, current };
