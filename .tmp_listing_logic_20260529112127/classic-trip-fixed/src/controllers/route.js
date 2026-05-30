const asyncHandler = require("../middleware/asyncHandler");
const Route = require("../models/route");

function filesToImages(files = []) {
  return files.map((f) => ({ url: f.path, publicId: f.filename }));
}

exports.create = asyncHandler(async (req, res) => {
  const images = filesToImages(req.files);
  const data = {
    ...req.body,
    ownerId: req.user.userId,
    stars: req.body.stars ? Number(req.body.stars) : undefined,
    amenities: req.body.amenities ? String(req.body.amenities).split(",").map(s => s.trim()).filter(Boolean) : [],
    images
  };
  const route = await Route.create(data);
  res.status(201).json({ ok: true, route });
});

exports.listPublic = asyncHandler(async (req, res) => {
  const {
    q, type, country, city, from, to,
    page = 1, limit = 12, sort = "-createdAt"
  } = req.query;

  const filter = { isActive: true };
  if (type) filter.type = type;
  if (country) filter.country = country;
  if (city) filter.city = city;
  if (from) filter.from = from;
  if (to) filter.to = to;
  if (q) filter.$text = { $search: q };

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
  const filter = req.user.role === "admin" ? {} : { ownerId: req.user.userId };
  const items = await Route.find(filter).sort("-createdAt").lean();
  res.json({ ok: true, items });
});

exports.getOne = asyncHandler(async (req, res) => {
  const route = await Route.findById(req.params.id).lean();
  if (!route) return res.status(404).json({ ok: false, message: "Route not found" });
  if (!route.isActive && req.user?.role !== "admin" && String(route.ownerId) !== String(req.user?.userId || "")) {
    return res.status(404).json({ ok: false, message: "Route not found" });
  }
  res.json({ ok: true, route });
});
