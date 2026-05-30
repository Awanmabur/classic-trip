const mongoose = require("mongoose");

const tripCatalogSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    tenantSlug: { type: String, trim: true, lowercase: true, required: true, index: true },
    ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sourceTripId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    sourceRouteId: { type: mongoose.Schema.Types.ObjectId, default: null },
    sourceVehicleId: { type: mongoose.Schema.Types.ObjectId, default: null },
    status: { type: String, enum: ["scheduled", "closed", "cancelled"], default: "scheduled", index: true },
    isActive: { type: Boolean, default: true, index: true },
    type: { type: String, enum: ["bus", "train", "flight", "hotel"], default: "bus", index: true },
    title: { type: String, trim: true, required: true, index: true },
    description: { type: String, trim: true, default: "" },
    country: { type: String, trim: true, default: "", index: true },
    city: { type: String, trim: true, default: "", index: true },
    from: { type: String, trim: true, default: "", index: true },
    to: { type: String, trim: true, default: "", index: true },
    address: { type: String, trim: true, default: "" },
    partner: { type: String, trim: true, default: "" },
    departureAt: { type: Date, required: true, index: true },
    arriveAt: { type: Date, default: null },
    basePrice: { type: Number, required: true, default: 0 },
    currency: { type: String, trim: true, default: "UGX" },
    policy: { type: String, trim: true, default: "Instant confirmation" },
    ratingAvg: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    totalSeats: { type: Number, default: 0 },
    bookedSeats: { type: Number, default: 0 },
    heldSeats: { type: Number, default: 0 },
    remainingSeats: { type: Number, default: 0 },
    image: { type: String, trim: true, default: "" },
    vehicle: {
      id: { type: mongoose.Schema.Types.ObjectId, default: null },
      name: { type: String, trim: true, default: "" },
      type: { type: String, trim: true, default: "" },
      layoutName: { type: String, trim: true, default: "" },
      rows: { type: Number, default: 0 },
      cols: { type: Number, default: 0 }
    }
  },
  { timestamps: true }
);

tripCatalogSchema.index({ tenantId: 1, sourceTripId: 1 }, { unique: true });
tripCatalogSchema.index({ title: "text", description: "text", from: "text", to: "text", city: "text", country: "text" });

module.exports = mongoose.model("TripCatalog", tripCatalogSchema);
