const { asyncHandler } = require("../../middleware/http");
const { getTenantModels } = require("../../models/tenant");
const { getTenantAccessForRequest } = require("../../services/tenant/runtime");

function fileUrl(file = {}) {
  const direct = String(file.path || file.secure_url || file.url || "").replace(/\\/g, "/");
  if (/^https?:\/\//i.test(direct) || direct.startsWith("/public/")) return direct;
  const marker = "/public/uploads/";
  const index = direct.toLowerCase().indexOf(marker);
  if (index >= 0) return direct.slice(index);
  return direct;
}

function filesToImages(files = []) {
  return files.map((file) => ({ url: fileUrl(file), publicId: file.filename }));
}

function publicRouteFilter(query = {}) {
  const {
    q,
    type,
    country,
    city,
    from,
    to
  } = query;

  const filter = { isActive: true };
  if (type) filter.type = type;
  if (country) filter.country = country;
  if (city) filter.city = city;
  if (from) filter.from = from;
  if (to) filter.to = to;
  if (q) filter.$text = { $search: q };
  return filter;
}

function getRequestScopedModels(req) {
  if (req.tenantConnection) {
    return getTenantModels(req.tenantConnection);
  }
  return null;
}

exports.create = asyncHandler(async (req, res) => {
  const images = filesToImages(req.files);
  const { models, ownerUserId } = await getTenantAccessForRequest(req);
  const { Route } = models;

  const data = {
    ...req.body,
    ownerId: ownerUserId,
    stars: req.body.stars ? Number(req.body.stars) : undefined,
    amenities: req.body.amenities
      ? String(req.body.amenities).split(",").map((item) => item.trim()).filter(Boolean)
      : [],
    images
  };

  const route = await Route.create(data);
  res.status(201).json({ ok: true, route });
});

exports.listPublic = asyncHandler(async (req, res) => {
  const models = getRequestScopedModels(req);
  if (!models) {
    return res.json({
      ok: true,
      page: Number(req.query.page || 1),
      limit: Number(req.query.limit || 12),
      total: 0,
      pages: 0,
      items: []
    });
  }

  const { Route } = models;
  const {
    page = 1,
    limit = 12,
    sort = "-createdAt"
  } = req.query;

  const filter = publicRouteFilter(req.query);
  const skip = (Number(page) - 1) * Number(limit);

  const [items, total] = await Promise.all([
    Route.find(filter).sort(sort).skip(skip).limit(Number(limit)).lean(),
    Route.countDocuments(filter)
  ]);

  res.json({
    ok: true,
    page: Number(page),
    limit: Number(limit),
    total,
    pages: Math.ceil(total / Number(limit)),
    items
  });
});

exports.listMine = asyncHandler(async (req, res) => {
  const { models, ownerUserId } = await getTenantAccessForRequest(req);
  const { Route } = models;
  const isPlatformAdmin = ["admin", "super_admin"].includes(req.user.role);
  const filter = isPlatformAdmin && req.query.ownerId
    ? { ownerId: ownerUserId }
    : { ownerId: ownerUserId };

  const items = await Route.find(filter).sort("-createdAt").lean();
  res.json({ ok: true, items });
});

exports.getOne = asyncHandler(async (req, res) => {
  const models = req.user
    ? (await getTenantAccessForRequest(req)).models
    : getRequestScopedModels(req);

  if (!models) {
    return res.status(404).json({ ok: false, message: "Route not found" });
  }

  const { Route } = models;
  const route = await Route.findById(req.params.id).lean();
  if (!route) return res.status(404).json({ ok: false, message: "Route not found" });

  if (!route.isActive && req.user?.role !== "admin" && String(route.ownerId) !== String(req.user?.userId || "")) {
    return res.status(404).json({ ok: false, message: "Route not found" });
  }

  res.json({ ok: true, route });
});

exports.update = asyncHandler(async (req, res) => {
  const { models, ownerUserId, tenant } = await getTenantAccessForRequest(req);
  const { Route } = models;

  const route = await Route.findById(req.params.id);
  if (!route) return res.status(404).json({ ok: false, message: "Route not found" });
  if (!["admin", "super_admin"].includes(req.user.role) && String(route.ownerId) !== String(ownerUserId)) {
    return res.status(403).json({ ok: false, message: "Forbidden" });
  }

  const body = req.validated?.body || req.body;
  const updatableFields = ["title", "description", "country", "city", "from", "to",
    "address", "stars", "amenities", "policy", "currency", "isActive"];
  for (const field of updatableFields) {
    if (body[field] != null) route[field] = body[field];
  }
  if (req.files?.length) {
    route.images = req.files.map((f) => ({
      url: String(f.path || f.secure_url || f.url || "").replace(/\\/g, "/"),
      publicId: f.filename || ""
    }));
  }
  await route.save();

  const { syncTripCatalogsByRoute } = require("../../services/platform/catalog");
  if (tenant) {
    try { await syncTripCatalogsByRoute({ tenant, models, routeId: route._id }); } catch (_) {}
  }

  res.json({ ok: true, route });
});

exports.remove = asyncHandler(async (req, res) => {
  const { models, ownerUserId } = await getTenantAccessForRequest(req);
  const { Route, Trip } = models;

  const route = await Route.findById(req.params.id);
  if (!route) return res.status(404).json({ ok: false, message: "Route not found" });
  if (!["admin", "super_admin"].includes(req.user.role) && String(route.ownerId) !== String(ownerUserId)) {
    return res.status(403).json({ ok: false, message: "Forbidden" });
  }

  const hasTrips = await Trip.exists({ routeId: route._id, status: "scheduled" });
  if (hasTrips) {
    return res.status(409).json({ ok: false, message: "Cannot delete a route with active scheduled trips" });
  }

  await route.deleteOne();
  res.json({ ok: true, message: "Route deleted" });
});
