const mongoose = require("mongoose");

const TripSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    routeId: { type: mongoose.Schema.Types.ObjectId, ref: "Route", required: true, index: true },
    vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle", required: true, index: true },

    departureAt: { type: Date, required: true, index: true },
    arriveAt: { type: Date },

    basePrice: { type: Number, required: true },
    currency: { type: String, default: "UGX" },

    totalSeats: { type: Number, required: true },
    bookedSeats: { type: Number, default: 0 },
    heldSeats: { type: Number, default: 0 },

    status: { type: String, enum: ["scheduled", "closed", "cancelled"], default: "scheduled", index: true }
  },
  { timestamps: true }
);

TripSchema.index({ vehicleId: 1, departureAt: 1 }, { unique: true });

module.exports = mongoose.model("Trip", TripSchema);
