const { Schema, model } = require('./_helpers');

const reviewSchema = new Schema({
  id: { type: String, index: true },
  bookingId: { type: String, index: true },
  listingId: { type: String, index: true },
  companyId: { type: String, index: true },
  customerUserId: { type: String, index: true },
  rating: Number,
  comment: String,
  companyReply: Schema.Types.Mixed,
  status: { type: String, default: 'published', index: true },
}, { timestamps: true });

module.exports = model('Review', reviewSchema);
