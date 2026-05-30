const mongoose = require("mongoose");

const BookingSeatSchema = new mongoose.Schema(
  {
    seatId: { type: String, required: true },
    price: { type: Number, required: true }
  },
  { _id: false }
);

const BookingCustomerNoteSchema = new mongoose.Schema(
  {
    text: { type: String, trim: true, required: true },
    createdAt: { type: Date, default: Date.now },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
  },
  { _id: false }
);

const BookingSchema = new mongoose.Schema(
  {
    // Auth user booking
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false, index: true },

    // Guest booking (no login)
    guest: {
      name: { type: String, trim: true, default: "" },
      email: { type: String, trim: true, lowercase: true, default: "" },
      phone: { type: String, trim: true, default: "" }
    },
    guestLookupCode: { type: String, trim: true, index: true }, // used to view booking without account

    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true }, // partner/operator
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", default: null, index: true },
    tenantSlug: { type: String, trim: true, default: "", index: true },
    tripCatalogId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    tripId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    serviceName: { type: String, trim: true, default: "" },
    serviceType: { type: String, trim: true, default: "" },
    serviceFrom: { type: String, trim: true, default: "" },
    serviceTo: { type: String, trim: true, default: "" },
    serviceAddress: { type: String, trim: true, default: "" },
    vehicleName: { type: String, trim: true, default: "" },

    travelDate: { type: Date, required: true },

    seats: { type: [BookingSeatSchema], default: [] },
    quantity: { type: Number, required: true },

    amount: { type: Number, required: true },
    grossAmount: { type: Number, default: 0 },
    currency: { type: String, default: "UGX" },

    // Promotions / referral
    referralCode: { type: String, trim: true, index: true },
    referralUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    referralPercent: { type: Number, default: 0 },

    // Wallet redemption (discount)
    walletUsed: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ["pending_payment", "confirmed", "completed", "cancelled", "refunded"],
      default: "pending_payment",
      index: true
    },

    paymentStatus: {
      type: String,
      enum: ["unpaid", "pending", "paid", "failed", "refunded", "cancelled"],
      default: "unpaid",
      index: true
    },

    paymentProvider: { type: String, default: "none" },
    paymentRef: { type: String, default: "" },
    paymentMethodNote: { type: String, default: "" },
    checkInStatus: {
      type: String,
      enum: ["pending", "checked_in", "no_show"],
      default: "pending",
      index: true
    },
    checkedInAt: { type: Date, default: null },
    checkedInByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    checkInNote: { type: String, trim: true, default: "" },
    customerNotes: { type: [BookingCustomerNoteSchema], default: [] },

    promoterAmount: { type: Number, default: 0 },
    platformPercent: { type: Number, default: 0 },
    platformAmount: { type: Number, default: 0 },
    ownerPercent: { type: Number, default: 0 },
    ownerAmount: { type: Number, default: 0 },
    settlementStatus: {
      type: String,
      enum: ["pending", "settled", "reversed"],
      default: "pending",
      index: true
    },
    platformUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    cancellationReason: { type: String, trim: true, default: "" },
    cancelledAt: { type: Date, default: null },
    cancelledByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    completedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Booking", BookingSchema);
