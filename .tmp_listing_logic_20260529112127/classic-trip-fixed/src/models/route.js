const mongoose = require("mongoose");

const ImageSchema = new mongoose.Schema({ url: String, publicId: String }, { _id: false });

const RouteSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: ["bus", "train", "flight", "hotel"], required: true, index: true },

    title: { type: String, trim: true, required: true },
    description: { type: String, trim: true },

    country: { type: String, trim: true, index: true },
    city: { type: String, trim: true, index: true },

    from: { type: String, trim: true, index: true }, // routes
    to: { type: String, trim: true, index: true },

    // hotels
    address: { type: String, trim: true },
    stars: { type: Number, default: 0 },
    amenities: [{ type: String, trim: true }],

    policy: { type: String, trim: true },

    currency: { type: String, default: "UGX" },
    isActive: { type: Boolean, default: true, index: true },

    images: [ImageSchema],

    ratingAvg: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 }
  },
  { timestamps: true }
);

RouteSchema.index({ title: "text", description: "text", from: "text", to: "text", city: "text", country: "text" });

module.exports = mongoose.model("Route", RouteSchema);
