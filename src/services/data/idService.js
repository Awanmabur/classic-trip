const Counter = require('../../models/Counter');
const { mongoose } = require('../../config/db');

function mongoReady() {
  return mongoose.connection.readyState === 1;
}

// In-process fallback counters, used only when MongoDB isn't connected (e.g. local dev without
// a database, or the seeded in-memory test read model). Never atomic across processes, but
// matches the previous nextId() behavior for those environments rather than throwing.
const fallbackCounters = new Map();

async function nextId(prefix) {
  if (!prefix) throw new Error('nextId requires a prefix');
  if (mongoReady()) {
    const counter = await Counter.findOneAndUpdate(
      { _id: prefix },
      { $inc: { seq: 1 } },
      { upsert: true, new: true }
    );
    return `${prefix}-${counter.seq}`;
  }
  const next = (fallbackCounters.get(prefix) || 0) + 1;
  fallbackCounters.set(prefix, next);
  return `${prefix}-${next}`;
}

module.exports = { nextId };
