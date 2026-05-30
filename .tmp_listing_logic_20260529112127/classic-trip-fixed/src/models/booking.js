const mongoose = require("mongoose");

const BookingSeatSchema = new mongoose.Schema(
  {
    seatId: { type: String, required: true },
    price: { type: Number, required: true }
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
    tripId: { type: mongoose.Schema.Types.ObjectId, ref: "Trip", required: true, index: true },

    travelDate: { type: Date, required: true },

    seats: { type: [BookingSeatSchema], default: [] },
    quantity: { type: Number, required: true },

    amount: { type: Number, required: true },
    currency: { type: String, default: "UGX" },

    // Promotions / referral
    referralCode: { type: String, trim: true, index: true },
    referralUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    referralPercent: { type: Number, default: 0 },

    // Wallet redemption (discount)
    walletUsed: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ["pending_payment", "confirmed", "cancelled", "refunded"],
      default: "pending_payment",
      index: true
    },

    paymentProvider: { type: String, default: "none" },
    paymentRef: { type: String, default: "" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Booking", BookingSchema);
