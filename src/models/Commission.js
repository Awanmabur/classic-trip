const { Schema, model } = require('./_helpers');

const commissionSchema = new Schema({
  id: { type: String, index: true },
  bookingId: { type: String, required: true, index: true },
  promoterId: { type: String, index: true },
  companyId: { type: String, index: true },
  platformFee: Number,
  promoterAmount: Number,
  companyAmount: Number,
  status: { type: String, default: 'pending', index: true },
  releasedAt: Date,
}, { timestamps: true });

module.exports = model('Commission', commissionSchema);
