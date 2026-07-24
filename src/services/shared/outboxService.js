const crypto = require('crypto');
const platformRepository = require('../../repositories/domain/platformRepository');

const outbox = platformRepository.outboxEvents;

function eventId() {
  return `outbox-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
}

function createEvent({
  topic,
  aggregateType,
  aggregateId,
  tenantId = '',
  companyId = '',
  dedupeKey = '',
  payload = {},
  headers = {},
  availableAt = new Date(),
  maxAttempts = 8,
} = {}) {
  if (!topic || !aggregateType || !aggregateId) {
    throw Object.assign(new Error('Outbox topic, aggregate type, and aggregate id are required'), { status: 500 });
  }
  const now = new Date().toISOString();
  return {
    id: eventId(),
    topic,
    aggregateType,
    aggregateId,
    tenantId,
    companyId,
    dedupeKey: dedupeKey || `${topic}:${aggregateType}:${aggregateId}`,
    payload,
    headers,
    status: 'pending',
    attempts: 0,
    maxAttempts: Math.max(1, Math.min(Number(maxAttempts) || 8, 100)),
    availableAt: availableAt instanceof Date ? availableAt.toISOString() : availableAt,
    createdAt: now,
    updatedAt: now,
  };
}


async function persistInSession(events = [], session = null) {
  const rows = Array.isArray(events) ? events : [events];
  if (!rows.length) return rows;
  outbox.assertReady();

  // $setOnInsert guarantees that retrying a committed checkout cannot rewrite an
  // already-processed event or reset its attempt counters.
  await outbox.repository.Model.bulkWrite(rows.map((event) => ({
    updateOne: {
      filter: { dedupeKey: event.dedupeKey || event.id },
      update: { $setOnInsert: event },
      upsert: true,
    },
  })), { ordered: false, ...(session ? { session } : {}) });
  return rows;
}

async function enqueue(events = []) {
  const rows = Array.isArray(events) ? events : [events];
  await persistInSession(rows);
  return rows;
}

async function resolveEvent(eventOrId) {
  if (eventOrId && typeof eventOrId === 'object') return eventOrId;
  const id = String(eventOrId || '');
  if (!id) return null;
  return outbox.findOne({ id });
}

async function markProcessed(eventOrId, result = {}) {
  const event = await resolveEvent(eventOrId);
  if (!event) return null;
  const update = {
    status: 'processed',
    processedAt: new Date().toISOString(),
    lockedAt: null,
    lockOwner: '',
    lastError: '',
    result,
    updatedAt: new Date().toISOString(),
  };
  await outbox.updateOne({ id: event.id }, { $set: update, $unset: { failedAt: '' } });
  const resolved = { ...event, ...update };
  return resolved;
}

async function markFailed(eventOrId, error) {
  const event = await resolveEvent(eventOrId);
  if (!event) return null;
  const attempts = Number(event.attempts || 0) + 1;
  const dead = attempts >= Number(event.maxAttempts || 8);
  const delaySeconds = Math.min(3600, 2 ** Math.min(attempts, 10));
  const update = {
    status: dead ? 'dead_letter' : 'failed',
    attempts,
    failedAt: new Date().toISOString(),
    availableAt: new Date(Date.now() + delaySeconds * 1000).toISOString(),
    lockedAt: null,
    lockOwner: '',
    lastError: String(error?.message || error || 'Outbox handler failed').slice(0, 2000),
    updatedAt: new Date().toISOString(),
  };
  await outbox.updateOne({ id: event.id }, { $set: update });
  const resolved = { ...event, ...update };
  return resolved;
}

async function processEvent(eventOrId, handlers = {}) {
  const event = await resolveEvent(eventOrId);
  if (!event || event.status === 'processed' || event.status === 'dead_letter') return event;
  const handler = handlers[event.topic];
  if (typeof handler !== 'function') {
    return markFailed(event, new Error(`No outbox handler registered for ${event.topic}`));
  }
  try {
    const result = await handler(event.payload || {}, event);
    return markProcessed(event, result || {});
  } catch (error) {
    return markFailed(event, error);
  }
}

async function claimNext(workerId = `worker-${process.pid}`) {
  const now = new Date();
  const lockExpiredAt = new Date(Date.now() - 5 * 60 * 1000);

  outbox.assertReady();
  const row = await outbox.repository.findOneAndUpdate({
    status: { $in: ['pending', 'failed'] },
    availableAt: { $lte: now },
    attempts: { $lt: 100 },
    $or: [{ lockedAt: null }, { lockedAt: { $exists: false } }, { lockedAt: { $lte: lockExpiredAt } }],
  }, {
    $set: { status: 'processing', lockedAt: now, lockOwner: workerId, updatedAt: now },
  }, { sort: { availableAt: 1, createdAt: 1 }, new: true });
  if (!row) return null;

  // Events may use a custom retry ceiling below the global query ceiling.
  if (Number(row.attempts || 0) >= Number(row.maxAttempts || 8)) {
    return markFailed(row, new Error('Outbox event retry limit reached'));
  }
  return row;
}

async function processBatch(handlers = {}, { limit = 50, workerId } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 500));
  const processed = [];
  for (let index = 0; index < safeLimit; index += 1) {
    const event = await claimNext(workerId);
    if (!event) break;
    processed.push(await processEvent(event, handlers));
  }
  return {
    claimed: processed.length,
    processed: processed.filter((event) => event?.status === 'processed').length,
    failed: processed.filter((event) => event?.status === 'failed').length,
    deadLetter: processed.filter((event) => event?.status === 'dead_letter').length,
  };
}

module.exports = {
  createEvent,
  persistInSession,
  enqueue,
  processEvent,
  processBatch,
  markProcessed,
  markFailed,
};
