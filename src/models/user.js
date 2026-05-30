const { Schema, model } = require('./_helpers');

const userSchema = new Schema({
  id: { type: String, index: true },
  role: { type: String, enum: ['super_admin', 'company_admin', 'company_employee', 'customer', 'promoter'], default: 'customer', index: true },
  fullName: { type: String, required: true, trim: true },
  email: { type: String, lowercase: true, trim: true, index: true },
  phone: { type: String, trim: true, index: true },
  passwordHash: String,
  googleId: { type: String, index: true },
  authProviders: { type: Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ['active', 'pending', 'suspended', 'blocked'], default: 'active', index: true },
  isVerified: { type: Boolean, default: false },
  companyId: { type: String, index: true },
  referralCode: { type: String, index: true },
  emailVerifiedAt: Date,
  lastLoginAt: Date,
}, { timestamps: true });

userSchema.index({ email: 1, role: 1 });
module.exports = model('User', userSchema);
