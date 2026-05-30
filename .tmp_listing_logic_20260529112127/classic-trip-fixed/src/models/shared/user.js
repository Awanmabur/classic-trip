const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, required: true },
    email: { type: String, trim: true, lowercase: true, unique: true, required: true, index: true },
    phone: { type: String, trim: true },

    passwordHash: { type: String, required: true },

    role: { type: String, enum: ["customer", "promoter", "company_employee", "company_admin", "partner", "admin", "super_admin"], default: "customer", index: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", index: true },
    tenantSlug: { type: String, trim: true, lowercase: true, default: "", index: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    status: { type: String, enum: ["active", "suspended"], default: "active", index: true },
    companyName: { type: String, trim: true, default: "", index: true },
    businessType: { type: String, trim: true, default: "" },
    country: { type: String, trim: true, default: "" },
    companyCurrency: { type: String, trim: true, default: "UGX" },
    payoutAccount: { type: String, trim: true, default: "" },
    supportMessage: { type: String, trim: true, default: "" },
    jobTitle: { type: String, trim: true, default: "" },
    permissionsLabel: { type: String, trim: true, default: "" },
    invitedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    onboardingSource: {
      type: String,
      enum: ["self_signup", "platform_invite", "company_invite", "seed"],
      default: "self_signup",
      index: true
    },
    invitedAt: { type: Date, default: null },
    onboardedAt: { type: Date, default: null },

    // Promotion / referral
    referralCode: { type: String, trim: true, unique: true, sparse: true, index: true }, // e.g. "CT-8F2K1Q"
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", UserSchema);
