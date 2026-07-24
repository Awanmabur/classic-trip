const mongoose = require('mongoose');
const { Schema } = mongoose;

const mediaSchema = new Schema({
  id: String,
  url: String,
  secureUrl: String,
  publicId: String,
  width: Number,
  height: Number,
  format: String,
  resourceType: { type: String, enum: ['image', 'raw', 'video'] },
  alt: String,
  label: String,
  target: String,
  documentType: { type: String, enum: ['business_license', 'tax_certificate', 'operator_permit', 'vehicle_registration', 'vehicle_insurance', 'driver_license', 'driver_identity', 'hotel_license', 'property_verification', 'guest_identity', 'photo', 'payout_proof', 'owner_id', 'national_id', 'company_registration', 'receipt', 'invoice'] },
  documentReference: String,
  status: { type: String, enum: ['approved', 'rejected', 'pending_review'] },
  uploadedBy: String,
  uploadedAt: Date,
  reviewedBy: String,
  reviewedAt: Date,
  reviewNotes: String,
}, { _id: false });

const moneySchema = new Schema({
  subtotal: Number,
  fees: Number,
  addonTotal: Number,
  total: Number,
  currency: { type: String, required: true, uppercase: true, trim: true },
  split: Schema.Types.Mixed,
  addons: [Schema.Types.Mixed],
}, { _id: false });

function model(name, schema) {
  return mongoose.models[name] || mongoose.model(name, schema);
}

module.exports = { mongoose, Schema, mediaSchema, moneySchema, model };
