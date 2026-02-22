const asyncHandler = require("../middleware/asyncHandler");
const Review = require("../models/review");
const Route = require("../models/route");
const mongoose = require("mongoose");

async function recompute(routeId) {
  const _id = new mongoose.Types.ObjectId(routeId);
  const stats = await Review.aggregate([
    { $match: { routeId: _id } },
    { $group: { _id: "$routeId", avg: { $avg: "$rating" }, count: { $sum: 1 } } }
  ]);
  const row = stats[0] || { avg: 0, count: 0 };
  await Route.findByIdAndUpdate(routeId, { ratingAvg: Number(row.avg || 0), ratingCount: Number(row.count || 0) });
}

exports.createOrUpdate = asyncHandler(async (req, res) => {
  const { routeId, rating, comment } = req.body;
  const route = await Route.findById(routeId);
  if (!route) return res.status(404).json({ ok: false, message: "Route not found" });

  const r = await Review.findOneAndUpdate(
    { routeId, userId: req.user.userId },
    { rating: Number(rating), comment },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  await recompute(routeId);
  res.json({ ok: true, review: r });
});

exports.listForRoute = asyncHandler(async (req, res) => {
  const items = await Review.find({ routeId: req.params.routeId })
    .populate("userId", "name")
    .sort("-createdAt")
    .lean();
  res.json({ ok: true, items });
});
