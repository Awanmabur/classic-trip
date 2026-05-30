const { Schema, model } = require('./_helpers');

const seatSchema = new Schema({
  id: { type: String, index: true },
  scheduleId: { type: String, required: true, index: true },
  seatNumber: { type: String, required: true },
  seatClass: String,
  priceDelta: { type: Number, default: 0 },
  status: { type: String, enum: ['available', 'locked', 'taken', 'blocked'], default: 'available', index: true },
  lockedUntil: Date,
  lockId: String,
}, { timestamps: true });

seatSchema.index({ scheduleId: 1, seatNumber: 1 }, { unique: true });
module.exports = model('Seat', seatSchema);
