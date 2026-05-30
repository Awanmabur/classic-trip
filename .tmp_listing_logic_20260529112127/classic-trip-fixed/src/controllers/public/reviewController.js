const { asyncHandler } = require("../../middleware/http");
const { Review } = require("../../models/public");
const { TripCatalog } = require("../../models/platform");
const { getTenantAccessByTenantId } = require("../../services/tenant/runtime");
const mongoose = require("mongoose");

function asObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value)
    ? new mongoose.Types.ObjectId(value)
    : null;
}

function tenantScopeQuery(tenantId) {
  return tenantId
    ? {
        $or: [
          { tenantId },
          { tenantId: null },
          { tenantId: { $exists: false } }
        ]
      }
    : {};
}

async function resolveRouteContext(routeId) {
  const routeObjectId = asObjectId(routeId);
  if (!routeObjectId) return { catalog: null, tenant: null, models: null, route: null };

  const catalog = await TripCatalog.findOne({ sourceRouteId: routeObjectId })
    .select("tenantId sourceRouteId ratingAvg ratingCount")
    .lean();
  if (!catalog?.tenantId) return { catalog: null, tenant: null, models: null, route: null };

  const access = await getTenantAccessByTenantId(catalog.tenantId);
  if (!access.models) return { catalog, ...access, route: null };

  const route = await access.models.Route.findById(routeObjectId);
  return { catalog, ...access, route };
}

async function recompute(routeId, tenantId, models) {
  const routeObjectId = asObjectId(routeId);
  if (!routeObjectId || !tenantId || !models?.Route) return;

  const stats = await Review.aggregate([
    {
      $match: {
        routeId: routeObjectId,
        ...tenantScopeQuery(tenantId)
      }
    },
    { $group: { _id: "$routeId", avg: { $avg: "$rating" }, count: { $sum: 1 } } }
  ]);
  const row = stats[0] || { avg: 0, count: 0 };
  const ratingAvg = Number(row.avg || 0);
  const ratingCount = Number(row.count || 0);

  await Promise.all([
    models.Route.findByIdAndUpdate(routeObjectId, { ratingAvg, ratingCount }),
    TripCatalog.updateMany(
      { tenantId, sourceRouteId: routeObjectId },
      { $set: { ratingAvg, ratingCount } }
    )
  ]);
}

exports.createOrUpdate = asyncHandler(async (req, res) => {
  const { routeId, rating, comment } = req.body;
  const { tenant, models, route } = await resolveRouteContext(routeId);
  if (!route) return res.status(404).json({ ok: false, message: "Route not found" });

  let review = await Review.findOne({
    routeId,
    userId: req.user.userId,
    ...tenantScopeQuery(tenant?._id || null)
  });

  if (!review) {
    review = await Review.create({
      tenantId: tenant?._id || null,
      routeId,
      userId: req.user.userId,
      rating: Number(rating),
      comment
    });
  } else {
    review.tenantId = tenant?._id || null;
    review.rating = Number(rating);
    review.comment = comment;
    await review.save();
  }

  await recompute(routeId, tenant?._id || null, models);
  res.json({ ok: true, review: review.toObject() });
});

exports.listForRoute = asyncHandler(async (req, res) => {
  const { tenant, route } = await resolveRouteContext(req.params.routeId);
  if (!route) return res.status(404).json({ ok: false, message: "Route not found" });

  const items = await Review.find({
    routeId: req.params.routeId,
    ...tenantScopeQuery(tenant?._id || null)
  })
    .populate("userId", "name")
    .sort("-createdAt")
    .lean();
  res.json({ ok: true, items });
});
