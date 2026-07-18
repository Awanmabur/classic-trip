const { Schema, model } = require('./_helpers');

const userSchema = new Schema({
  id: { type: String, index: true, unique: true, sparse: true },
  role: { type: String, enum: ['super_admin', 'admin', 'finance_admin', 'support_admin', 'operations_admin', 'content_admin', 'company_admin', 'company_employee', 'driver', 'customer', 'promoter'], default: 'customer', index: true },
  fullName: { type: String, required: true, trim: true },
  email: { type: String, lowercase: true, trim: true, index: true, unique: true, sparse: true },
  phone: { type: String, trim: true, index: true },
  passwordHash: String,
  googleId: { type: String, index: true },
  authProviders: { type: Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ['active', 'pending', 'suspended', 'blocked'], default: 'active', index: true },
  isVerified: { type: Boolean, default: false },
  companyId: { type: String, index: true },
  referralCode: { type: String, index: true },
  city: String,
  preferredSeat: String,
  passengerNote: String,
  savedPassengerDetails: String,
  permissionsLabel: String,
  twoFactorEnabled: { type: Boolean, default: false },
  loginAlertsEnabled: { type: Boolean, default: true },
  recoveryEmail: String,
  passwordChangedAt: Date,
  verificationStatus: { type: String, index: true },
  verificationDocumentType: String,
  verificationReference: String,
  promoterProfile: Schema.Types.Mixed,
  payoutAccount: Schema.Types.Mixed,
  emailVerifiedAt: Date,
  emailVerifyToken: String,
  emailVerifyTokenExpiresAt: Date,
  lastLoginAt: Date,
}, { timestamps: true });

userSchema.index({ email: 1, role: 1 });
module.exports = model('User', userSchema);
