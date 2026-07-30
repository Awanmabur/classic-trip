'use strict';

const Counter = require('../../models/Counter');
const { mongoose } = require('../../config/db');

async function nextIds(prefix, count = 1) {
  if (!prefix) throw new Error('nextId requires a prefix');
  const amount = Number(count);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 10000) {
    throw new Error('nextIds count must be an integer between 1 and 10000');
  }
  if (mongoose.connection.readyState !== 1) {
    const error = new Error('MongoDB is unavailable; cannot allocate an identifier');
    error.status = 503;
    error.code = 'mongodb_unavailable';
    throw error;
  }
  const counter = await Counter.findOneAndUpdate(
    { _id: prefix },
    { $inc: { seq: amount } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  const first = Number(counter.seq) - amount + 1;
  return Array.from({ length: amount }, (_, index) => `${prefix}-${first + index}`);
}

async function nextId(prefix) {
  return (await nextIds(prefix, 1))[0];
}

module.exports = { nextId, nextIds };
