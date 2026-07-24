const { Schema, model } = require('./_helpers');

const rateLimitCounterSchema = new Schema({
  key: { type: String, required: true, unique: true, index: true },
  totalHits: { type: Number, required: true, min: 0, default: 0 },
  resetTime: { type: Date, required: true },
}, { timestamps: true });

// MongoDB's TTL monitor removes expired windows asynchronously. The request key includes
// the fixed-window boundary, so an expired record can never affect a later window even if
// deletion is delayed by a few seconds.
rateLimitCounterSchema.index({ resetTime: 1 }, { expireAfterSeconds: 0 });

module.exports = model('RateLimitCounter', rateLimitCounterSchema);
