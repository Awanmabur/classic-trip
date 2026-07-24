'use strict';

const Counter = require('../../models/Counter');
const { mongoose } = require('../../config/db');

async function nextId(prefix) {
  if (!prefix) throw new Error('nextId requires a prefix');
  if (mongoose.connection.readyState !== 1) {
    const error = new Error('MongoDB is unavailable; cannot allocate an identifier');
    error.status = 503;
    error.code = 'mongodb_unavailable';
    throw error;
  }
  const counter = await Counter.findOneAndUpdate(
    { _id: prefix },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return `${prefix}-${counter.seq}`;
}

module.exports = { nextId };
