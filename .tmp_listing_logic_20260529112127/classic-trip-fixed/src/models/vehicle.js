const mongoose = require("mongoose");

const SeatCellSchema = new mongoose.Schema(
  {
    id: { type: String, required: true }, // seatId e.g. "A1"
    row: { type: Number, required: true },
    col: { type: Number, required: true },
    isAisle: { type: Boolean, default: false },
    isDisabled: { type: Boolean, default: false },
    label: { type: String, default: "" }
  },
  { _id: false }
);

const ImageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true }
  },
  { _id: false }
);

const VehicleSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    type: { type: String, enum: ["bus", "train", "flight", "hotel"], default: "bus", index: true },
    name: { type: String, required: true, trim: true },
    plateOrCode: { type: String, trim: true, default: "" },

    layoutName: { type: String, default: "2x2" }, // 2x2,2x3,custom
    rows: { type: Number, required: true },
    cols: { type: Number, required: true },
    seats: { type: [SeatCellSchema], default: [] },
    totalSeats: { type: Number, default: 0 },

    images: { type: [ImageSchema], default: [] }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Vehicle", VehicleSchema);
