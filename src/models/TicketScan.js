const { Schema, model } = require('./_helpers');

const ticketScanSchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  scanType: { type: String, enum: ['lookup', 'validate', 'no_show'], required: true, index: true },
  scannedToken: { type: String, required: true, index: true },
  bookingId: { type: String, index: true },
  bookingRef: { type: String, index: true },
  ticketNumber: { type: String, index: true },
  ticketLegId: { type: String, index: true },
  scheduleId: { type: String, index: true },
  seatNumber: String,
  qrTokenPreview: String,
  qrCodeValue: { type: String, index: true },
  employeeId: { type: String, index: true },
  companyId: { type: String, index: true },
  // Canonical scanner outcomes shared by lookup, validation, no-show, and audit workflows.
  result: { type: String, required: true, index: true, enum: ['not_authorized_for_ticket', 'not_found', 'blocked', 'ready', 'not_valid_for_checkin', 'payment_not_successful', 'already_used', 'validated', 'not_valid_for_no_show', 'no_show'] },
  ok: { type: Boolean, default: false, index: true },
  message: String,
  scannedAt: { type: Date, default: Date.now, index: true },
  ip: String,
  userAgent: String,
  actorRole: String,
  actorName: String,
  actorEmail: String,
  note: String,
  source: String,
  location: String,
  meta: Schema.Types.Mixed,
}, { timestamps: true });

ticketScanSchema.index({ companyId: 1, scannedAt: -1 });
ticketScanSchema.index({ bookingRef: 1, scanType: 1, scannedAt: -1 });
ticketScanSchema.index({ ticketNumber: 1, result: 1 });
ticketScanSchema.index({ employeeId: 1, scannedAt: -1 });

module.exports = model('TicketScan', ticketScanSchema);
