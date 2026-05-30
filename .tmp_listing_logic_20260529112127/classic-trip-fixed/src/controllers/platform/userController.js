const { asyncHandler } = require("../../middleware/http");
const { User } = require("../../models/shared");

const MANAGED_ROLES = ["customer", "promoter", "company_employee", "company_admin", "partner", "admin", "super_admin"];
const MANAGED_STATUSES = ["active", "suspended"];
const PLATFORM_ROLES = ["admin", "super_admin"];
const PARTNER_ROLES = ["company_admin", "partner"];

function canManagePrivilegedUser(actorRole, targetRole) {
  if (!PLATFORM_ROLES.includes(targetRole)) return true;
  return actorRole === "super_admin";
}

function canAssignPrivilegedRole(actorRole, nextRole) {
  if (!PLATFORM_ROLES.includes(nextRole)) return true;
  return actorRole === "super_admin";
}

function sanitizeUser(user) {
  if (!user) return null;
  const source = user.toObject ? user.toObject() : user;
  const { passwordHash, ...rest } = source;
  return rest;
}

exports.me = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.userId).select("-passwordHash").lean();
  res.json({ ok: true, user });
});

exports.updateMe = asyncHandler(async (req, res) => {
  const body = req.validated?.body || req.body;
  const user = await User.findById(req.user.userId);
  if (!user) return res.status(404).json({ ok: false, message: "User not found" });

  user.name = body.name;
  if (body.phone != null) user.phone = body.phone;
  if (body.jobTitle != null) user.jobTitle = body.jobTitle;
  if (body.permissionsLabel != null) user.permissionsLabel = body.permissionsLabel;
  await user.save();

  res.json({ ok: true, user: sanitizeUser(user) });
});

exports.list = asyncHandler(async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 80)));
  const q = String(req.query.q || "").trim();
  const role = String(req.query.role || "").trim();
  const status = String(req.query.status || "").trim();

  const filter = {};
  if (q) {
    filter.$or = [
      { email: new RegExp(q, "i") },
      { name: new RegExp(q, "i") },
      { phone: new RegExp(q, "i") },
      { referralCode: new RegExp(q, "i") },
      { companyName: new RegExp(q, "i") }
    ];
  }
  if (MANAGED_ROLES.includes(role)) filter.role = role;
  if (MANAGED_STATUSES.includes(status)) filter.status = status;

  const items = await User.find(filter)
    .select("-passwordHash")
    .sort("-createdAt")
    .limit(limit)
    .lean();

  res.json({ ok: true, items });
});

exports.setRole = asyncHandler(async (req, res) => {
  const role = String(req.body?.role || "").trim();
  if (!MANAGED_ROLES.includes(role)) {
    return res.status(400).json({ ok: false, message: "Invalid role" });
  }

  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ ok: false, message: "User not found" });
  if (String(user._id) === String(req.user.userId)) {
    return res.status(400).json({ ok: false, message: "You cannot change your own role from the platform page" });
  }
  if (!canManagePrivilegedUser(req.user.role, user.role)) {
    return res.status(403).json({ ok: false, message: "Only a super admin can manage admin accounts" });
  }
  if (!canAssignPrivilegedRole(req.user.role, role)) {
    return res.status(403).json({ ok: false, message: "Only a super admin can assign admin roles" });
  }
  if (role === "company_employee" && !user.companyId) {
    return res.status(400).json({ ok: false, message: "Company employee role requires a company assignment" });
  }

  user.role = role;

  if (["customer", "promoter", "admin", "super_admin"].includes(role)) {
    user.companyId = null;
  }

  if (PARTNER_ROLES.includes(role)) {
    user.companyId = null;
    if (!user.companyName) user.companyName = user.name;
  }

  await user.save();
  res.json({ ok: true, user: sanitizeUser(user) });
});

exports.setStatus = asyncHandler(async (req, res) => {
  const status = String(req.body?.status || "").trim();
  if (!MANAGED_STATUSES.includes(status)) {
    return res.status(400).json({ ok: false, message: "Invalid status" });
  }

  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ ok: false, message: "User not found" });
  if (String(user._id) === String(req.user.userId)) {
    return res.status(400).json({ ok: false, message: "You cannot change your own status from the platform page" });
  }
  if (!canManagePrivilegedUser(req.user.role, user.role)) {
    return res.status(403).json({ ok: false, message: "Only a super admin can manage admin accounts" });
  }

  user.status = status;
  await user.save();

  if (PARTNER_ROLES.includes(user.role)) {
    await User.updateMany(
      { companyId: user._id, role: "company_employee" },
      { $set: { status } }
    );
  }

  res.json({ ok: true, user: sanitizeUser(user) });
});
