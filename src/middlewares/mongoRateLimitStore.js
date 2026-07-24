const crypto = require('crypto');
const RateLimitCounter = require('../models/RateLimitCounter');

function digest(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

class MongoRateLimitStore {
  constructor(prefix = 'general') {
    this.prefix = String(prefix || 'general').replace(/[^a-z0-9_-]/gi, '_').slice(0, 48);
    this.localKeys = false;
    this.windowMs = 60_000;
  }

  init(options = {}) {
    this.windowMs = Math.max(1_000, Number(options.windowMs) || this.windowMs);
  }

  windowFor(key, now = Date.now()) {
    const startsAt = Math.floor(now / this.windowMs) * this.windowMs;
    return {
      key: `${this.prefix}:${startsAt}:${digest(key)}`,
      resetTime: new Date(startsAt + this.windowMs),
    };
  }

  async increment(key) {
    const window = this.windowFor(key);
    const record = await RateLimitCounter.findOneAndUpdate(
      { key: window.key },
      {
        $inc: { totalHits: 1 },
        $setOnInsert: { resetTime: window.resetTime },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    ).lean();
    return { totalHits: Number(record?.totalHits || 1), resetTime: window.resetTime };
  }

  async decrement(key) {
    const window = this.windowFor(key);
    await RateLimitCounter.updateOne(
      { key: window.key, totalHits: { $gt: 0 } },
      { $inc: { totalHits: -1 } }
    );
  }

  async resetKey(key) {
    const window = this.windowFor(key);
    await RateLimitCounter.deleteOne({ key: window.key });
  }

  async resetAll() {
    await RateLimitCounter.deleteMany({ key: { $regex: `^${this.prefix}:` } });
  }

  shutdown() {}
}

module.exports = { MongoRateLimitStore };
