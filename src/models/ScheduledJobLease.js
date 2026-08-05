'use strict';

const { Schema, model } = require('./_helpers');

const scheduledJobLeaseSchema = new Schema({
  name: { type: String, required: true, unique: true, index: true },
  ownerId: { type: String, required: true, index: true },
  acquiredAt: { type: Date, required: true },
  renewedAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

scheduledJobLeaseSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

module.exports = model('ScheduledJobLease', scheduledJobLeaseSchema);
