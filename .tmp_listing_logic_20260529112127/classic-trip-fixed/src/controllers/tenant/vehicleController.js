const { asyncHandler } = require("../../middleware/http");
const { getTenantAccessForRequest } = require("../../services/tenant/runtime");
const { generateBusLayout } = require("../../services/shared/layouts");

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

exports.create = asyncHandler(async (req, res) => {
  const { type, name, plateOrCode = "", layoutName = "2x2", rows } = req.body;
  const { models, ownerUserId } = await getTenantAccessForRequest(req);
  const { Vehicle } = models;

  const rowCount = Number(rows || 0);
  if (rowCount < 1) {
    return res.status(400).json({ ok: false, message: "rows must be >= 1" });
  }

  let cols = Number(req.body.cols || 0);
  let seats = Array.isArray(req.body.seats) ? req.body.seats : null;
  let totalSeats = 0;

  if (type === "bus" && (layoutName === "2x2" || layoutName === "2x3")) {
    const generated = generateBusLayout({ rows: rowCount, config: layoutName });
    cols = generated.cols;
    seats = generated.seats;
    totalSeats = generated.totalSeats;
  } else if (layoutName === "custom") {
    let parsed = req.body.seats;
    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
      } catch (_error) {
        parsed = null;
      }
    }

    if (!Array.isArray(parsed) || parsed.length < 1) {
      return res.status(400).json({ ok: false, message: "custom layout requires seats array" });
    }

    seats = parsed;
    cols = Number(req.body.cols || 0);
    totalSeats = parsed.filter((seat) => !seat.isAisle && !seat.isDisabled).length;
    if (!cols) {
      cols = Math.max(...parsed.map((seat) => Number(seat.col || 0)));
    }
  } else {
    let parsed = req.body.seats;
    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
      } catch (_error) {
        parsed = null;
      }
    }

    if (Array.isArray(parsed) && parsed.length) {
      seats = parsed;
      totalSeats = parsed.filter((seat) => !seat.isAisle && !seat.isDisabled).length;
      cols = Number(req.body.cols || 0) || Math.max(...parsed.map((seat) => Number(seat.col || 0)));
    } else {
      return res.status(400).json({ ok: false, message: "Provide seats layout for non-bus or set layoutName=custom" });
    }
  }

  const images = filesToImages(req.files);

  const vehicle = await Vehicle.create({
    ownerId: ownerUserId,
    type,
    name,
    plateOrCode,
    layoutName,
    rows: rowCount,
    cols,
    seats,
    totalSeats,
    images
  });

  res.status(201).json({ ok: true, vehicle });
});

exports.listMine = asyncHandler(async (req, res) => {
  const { models, ownerUserId } = await getTenantAccessForRequest(req);
  const { Vehicle } = models;
  const items = await Vehicle.find({ ownerId: ownerUserId }).sort("-createdAt").lean();
  res.json({ ok: true, items });
});

exports.getOne = asyncHandler(async (req, res) => {
  const { models, ownerUserId } = await getTenantAccessForRequest(req);
  const { Vehicle } = models;
  const vehicle = await Vehicle.findById(req.params.id).lean();

  if (!vehicle) return res.status(404).json({ ok: false, message: "Vehicle not found" });
  if (!["admin", "super_admin"].includes(req.user.role) && String(vehicle.ownerId) !== String(ownerUserId)) {
    return res.status(403).json({ ok: false, message: "Forbidden" });
  }

  res.json({ ok: true, vehicle });
});

exports.update = asyncHandler(async (req, res) => {
  const { models, ownerUserId, tenant } = await getTenantAccessForRequest(req);
  const { Vehicle } = models;

  const vehicle = await Vehicle.findById(req.params.id);
  if (!vehicle) return res.status(404).json({ ok: false, message: "Vehicle not found" });
  if (!["admin", "super_admin"].includes(req.user.role) && String(vehicle.ownerId) !== String(ownerUserId)) {
    return res.status(403).json({ ok: false, message: "Forbidden" });
  }

  const body = req.validated?.body || req.body;
  if (body.name) vehicle.name = body.name;
  if (body.plateOrCode != null) vehicle.plateOrCode = body.plateOrCode;
  if (body.status) vehicle.status = body.status;

  const images = req.files?.length ? req.files.map((f) => ({
    url: String(f.path || f.secure_url || f.url || "").replace(/\\/g, "/"),
    publicId: f.filename || ""
  })) : null;
  if (images) vehicle.images = images;

  await vehicle.save();

  const { syncTripCatalogsByVehicle } = require("../../services/platform/catalog");
  if (tenant) {
    try { await syncTripCatalogsByVehicle({ tenant, models, vehicleId: vehicle._id }); } catch (_) {}
  }

  res.json({ ok: true, vehicle });
});

exports.remove = asyncHandler(async (req, res) => {
  const { models, ownerUserId } = await getTenantAccessForRequest(req);
  const { Vehicle, Trip } = models;

  const vehicle = await Vehicle.findById(req.params.id);
  if (!vehicle) return res.status(404).json({ ok: false, message: "Vehicle not found" });
  if (!["admin", "super_admin"].includes(req.user.role) && String(vehicle.ownerId) !== String(ownerUserId)) {
    return res.status(403).json({ ok: false, message: "Forbidden" });
  }

  const hasTrips = await Trip.exists({ vehicleId: vehicle._id, status: "scheduled" });
  if (hasTrips) {
    return res.status(409).json({ ok: false, message: "Cannot delete a vehicle with active scheduled trips" });
  }

  await vehicle.deleteOne();
  res.json({ ok: true, message: "Vehicle deleted" });
});
