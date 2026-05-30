const asyncHandler = require("../middleware/asyncHandler");
const Vehicle = require("../models/vehicle");
const { generateBusLayout } = require("./seatLayout");

function filesToImages(files = []) {
  return files.map((f) => ({ url: f.path, publicId: f.filename }));
}

exports.create = asyncHandler(async (req, res) => {
  const { type, name, plateOrCode = "", layoutName = "2x2", rows } = req.body;

  const r = Number(rows || 0);
  if (r < 1) return res.status(400).json({ ok: false, message: "rows must be >= 1" });

  let cols = Number(req.body.cols || 0);
  let seats = Array.isArray(req.body.seats) ? req.body.seats : null;
  let totalSeats = 0;

  if (type === "bus" && (layoutName === "2x2" || layoutName === "2x3")) {
    const gen = generateBusLayout({ rows: r, config: layoutName });
    cols = gen.cols;
    seats = gen.seats;
    totalSeats = gen.totalSeats;
  } else if (layoutName === "custom") {
    // expecting seats json string or array
    let parsed = req.body.seats;
    if (typeof parsed === "string") {
      try { parsed = JSON.parse(parsed); } catch (_) { parsed = null; }
    }
    if (!Array.isArray(parsed) || parsed.length < 1) {
      return res.status(400).json({ ok: false, message: "custom layout requires seats array" });
    }
    seats = parsed;
    cols = Number(req.body.cols || 0);
    totalSeats = parsed.filter(s => !s.isAisle && !s.isDisabled).length;
    if (!cols) {
      cols = Math.max(...parsed.map(s => Number(s.col || 0)));
    }
  } else {
    // train/flight: allow custom too
    // if not custom, still accept provided seats layout
    let parsed = req.body.seats;
    if (typeof parsed === "string") {
      try { parsed = JSON.parse(parsed); } catch (_) { parsed = null; }
    }
    if (Array.isArray(parsed) && parsed.length) {
      seats = parsed;
      totalSeats = parsed.filter(s => !s.isAisle && !s.isDisabled).length;
      cols = Number(req.body.cols || 0) || Math.max(...parsed.map(s => Number(s.col || 0)));
    } else {
      return res.status(400).json({ ok: false, message: "Provide seats layout for non-bus or set layoutName=custom" });
    }
  }

  const images = filesToImages(req.files);

  const vehicle = await Vehicle.create({
    ownerId: req.user.userId,
    type,
    name,
    plateOrCode,
    layoutName,
    rows: r,
    cols,
    seats,
    totalSeats,
    images
  });

  res.status(201).json({ ok: true, vehicle });
});

exports.listMine = asyncHandler(async (req, res) => {
  const filter = req.user.role === "admin" ? {} : { ownerId: req.user.userId };
  const items = await Vehicle.find(filter).sort("-createdAt").lean();
  res.json({ ok: true, items });
});

exports.getOne = asyncHandler(async (req, res) => {
  const v = await Vehicle.findById(req.params.id).lean();
  if (!v) return res.status(404).json({ ok: false, message: "Vehicle not found" });
  if (req.user.role !== "admin" && String(v.ownerId) !== String(req.user.userId)) {
    return res.status(403).json({ ok: false, message: "Forbidden" });
  }
  res.json({ ok: true, vehicle: v });
});
