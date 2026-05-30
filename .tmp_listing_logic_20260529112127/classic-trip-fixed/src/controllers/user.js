const asyncHandler = require("../middleware/asyncHandler");
const User = require("../models/user");

exports.me = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.userId).select("-passwordHash").lean();
  res.json({ ok: true, user });
});

exports.list = asyncHandler(async (req, res) => {
  const items = await User.find().select("-passwordHash").sort("-createdAt").lean();
  res.json({ ok: true, items });
});

exports.setRole = asyncHandler(async (req, res) => {
  const { role } = req.body;
  const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true })
    .select("-passwordHash")
    .lean();
  res.json({ ok: true, user });
});

exports.setStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const user = await User.findByIdAndUpdate(req.params.id, { status }, { new: true })
    .select("-passwordHash")
    .lean();
  res.json({ ok: true, user });
});
