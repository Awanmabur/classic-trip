const mongoose = require('mongoose');
const { Schema } = mongoose;
const ARCHIVE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

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

function isArchivedValue(value) {
  return String(value || '').trim().toLowerCase() === 'archived';
}

function addArchiveRetention(schema) {
  const additions = {};
  if (!schema.path('archivedAt')) additions.archivedAt = Date;
  if (!schema.path('archivedBy')) additions.archivedBy = String;
  if (!schema.path('purgeAfter')) additions.purgeAfter = Date;
  if (!schema.path('retentionHold')) additions.retentionHold = Boolean;
  if (!schema.path('retentionHoldReason')) additions.retentionHoldReason = String;
  if (Object.keys(additions).length) schema.add(additions);

  schema.pre('save', function stampArchivedDocument(next) {
    const archived = isArchivedValue(this.status) || isArchivedValue(this.operationalStatus);
    if (archived) {
      const archivedAt = this.archivedAt || new Date();
      this.archivedAt = archivedAt;
      this.purgeAfter = this.purgeAfter || new Date(new Date(archivedAt).getTime() + ARCHIVE_RETENTION_MS);
      this.archivedBy = this.archivedBy || this.updatedBy || '';
    } else if ((this.isModified('status') || this.isModified('operationalStatus')) && this.archivedAt) {
      this.archivedAt = undefined;
      this.archivedBy = '';
      this.purgeAfter = undefined;
      this.retentionHold = false;
      this.retentionHoldReason = '';
    }
    next();
  });

  ['updateOne', 'updateMany', 'findOneAndUpdate'].forEach((hook) => {
    schema.pre(hook, function stampArchivedUpdate(next) {
      const update = this.getUpdate() || {};
      const operatorUpdate = Object.keys(update).some((key) => key.startsWith('$'));
      const values = operatorUpdate ? (update.$set || {}) : update;
      const statusWasSet = Object.prototype.hasOwnProperty.call(values, 'status')
        || Object.prototype.hasOwnProperty.call(values, 'operationalStatus');
      const archived = isArchivedValue(values.status) || isArchivedValue(values.operationalStatus);

      if (statusWasSet && archived) {
        const archivedAt = values.archivedAt || new Date();
        if (operatorUpdate) {
          update.$set = {
            ...values,
            archivedAt,
            archivedBy: values.archivedBy || values.updatedBy || '',
            purgeAfter: values.purgeAfter || new Date(new Date(archivedAt).getTime() + ARCHIVE_RETENTION_MS),
            retentionHold: false,
            retentionHoldReason: '',
          };
          if (update.$unset) {
            update.$unset = { ...update.$unset };
            delete update.$unset.archivedAt;
            delete update.$unset.archivedBy;
            delete update.$unset.purgeAfter;
          }
        } else {
          Object.assign(update, {
            archivedAt,
            archivedBy: values.archivedBy || values.updatedBy || '',
            purgeAfter: values.purgeAfter || new Date(new Date(archivedAt).getTime() + ARCHIVE_RETENTION_MS),
            retentionHold: false,
            retentionHoldReason: '',
          });
        }
      } else if (statusWasSet) {
        if (operatorUpdate) {
          update.$unset = {
            ...(update.$unset || {}),
            archivedAt: '',
            archivedBy: '',
            purgeAfter: '',
            retentionHold: '',
            retentionHoldReason: '',
          };
        } else {
          delete update.archivedAt;
          delete update.archivedBy;
          delete update.purgeAfter;
          delete update.retentionHold;
          delete update.retentionHoldReason;
        }
      }
      this.setUpdate(update);
      next();
    });
  });
}

function model(name, schema) {
  addArchiveRetention(schema);
  return mongoose.models[name] || mongoose.model(name, schema);
}

module.exports = { mongoose, Schema, mediaSchema, moneySchema, model, ARCHIVE_RETENTION_MS };
