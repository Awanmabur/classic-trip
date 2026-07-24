const { Schema, model } = require('./_helpers');

const offlineSaleSchema = new Schema({
  id: { type: String, index: true },
  saleRef: { type: String, index: true },
  agentId: { type: String, index: true },
  agentName: String,
  agentLocation: String,
  listingId: { type: String, index: true },
  companyId: { type: String, index: true },
  scheduleId: { type: String, index: true },
  bookingId: { type: String, index: true },
  bookingRef: { type: String, index: true },
  customerUserId: { type: String, index: true },
  customerName: String,
  customerEmail: String,
  customerPhone: String,
  passengerName: String,
  seatNumber: String,
  paymentMethod: { type: String, enum: ['cash'] },
  paymentReference: String,
  amountCollected: Number,
  currency: { type: String, required: true, uppercase: true, trim: true },
  receiptRef: { type: String, index: true },
  receiptUrl: String,
  ticketUrl: String,
  commissionAmount: Number,
  commissionStatus: { type: String, default: 'pending', index: true, enum: ['pending'] },
  status: { type: String, default: 'completed', index: true, enum: ['completed', 'confirmed'] },
  notes: String,
  meta: Schema.Types.Mixed,
}, { timestamps: true });

module.exports = model('OfflineSale', offlineSaleSchema);
