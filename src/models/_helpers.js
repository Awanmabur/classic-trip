const mongoose = require('mongoose');
const { Schema } = mongoose;

const mediaSchema = new Schema({
  url: String,
  secureUrl: String,
  publicId: String,
  width: Number,
  height: Number,
  format: String,
  resourceType: String,
  alt: String,
  label: String,
}, { _id: false });

const moneySchema = new Schema({
  subtotal: Number,
  fees: Number,
  addonTotal: Number,
  total: Number,
  currency: { type: String, default: 'UGX' },
  split: Schema.Types.Mixed,
  addons: [Schema.Types.Mixed],
}, { _id: false });

function model(name, schema) {
  return mongoose.models[name] || mongoose.model(name, schema);
}

module.exports = { mongoose, Schema, mediaSchema, moneySchema, model };
