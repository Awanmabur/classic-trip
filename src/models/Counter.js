const { Schema, model } = require('./_helpers');

const counterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
}, { versionKey: false });

module.exports = model('Counter', counterSchema);
