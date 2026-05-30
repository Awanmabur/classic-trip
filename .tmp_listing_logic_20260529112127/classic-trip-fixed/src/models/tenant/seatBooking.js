const mongoose = require("mongoose");

const seatBookingSchema = new mongoose.Schema(
  {
    tripId: { type: mongoose.Schema.Types.ObjectId, ref: "Trip", required: true, index: true },
    seatId: { type: String, required: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true, index: true }
  },
  { timestamps: true }
);

seatBookingSchema.index({ tripId: 1, seatId: 1 }, { unique: true });

module.exports = { seatBookingSchema };
