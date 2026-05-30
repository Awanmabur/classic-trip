const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, required: true },
    email: { type: String, trim: true, lowercase: true, unique: true, required: true, index: true },
    phone: { type: String, trim: true },

    passwordHash: { type: String, required: true },

    role: { type: String, enum: ["customer", "promoter", "company_employee", "company_admin", "partner", "admin", "super_admin"], default: "customer", index: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true }, // for company employees
    status: { type: String, enum: ["active", "suspended"], default: "active", index: true },

    // Promotion / referral
    referralCode: { type: String, trim: true, unique: true, sparse: true, index: true }, // e.g. "CT-8F2K1Q"
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", UserSchema);
