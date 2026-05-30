const { asyncHandler } = require("../../middleware/http");
const { User, Session } = require("../../models/shared");
const { ensureTenantForPartnerUser } = require("../../services/platform/tenants");

function makeReferralCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "CT-";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

const { hashPassword, comparePassword, signAccessToken, signRefreshToken, verifyRefreshToken, sha256 } = require("../../utils/auth");
const { REFRESH_COOKIE_NAME, COOKIE_SECURE, COOKIE_DOMAIN, COOKIE_SAME_SITE } = require("../../config/app");

function ipHash(req) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString();
  return sha256(ip);
}

function cookieOpts() {
  const opts = {
    httpOnly: true,
    sameSite: COOKIE_SAME_SITE,
    secure: COOKIE_SECURE,
    path: "/api"
  };
  if (COOKIE_DOMAIN) opts.domain = COOKIE_DOMAIN;
  return opts;
}

function makePayload(user, sid) {
  const tenantId = user.tenantId ? user.tenantId.toString() : undefined;
  const companyId = user.companyId ? user.companyId.toString() : undefined;
  return {
    userId: user._id.toString(),
    email: user.email,
    role: user.role,
    tenantId,
    tenantSlug: user.tenantSlug || undefined,
    companyId,
    companyName: user.companyName || undefined,
    sid,
    referralCode: user.referralCode
  };
}

async function ensureUserTenantContext(user) {
  if (!user) return user;

  if ((user.role === "partner" || user.role === "company_admin") && !user.tenantId) {
    await ensureTenantForPartnerUser(user);
    return User.findById(user._id);
  }

  if (user.role === "company_employee" && !user.tenantId && user.companyId) {
    const ownerUser = await User.findById(user.companyId).select("role tenantId tenantSlug");
    if (ownerUser && (ownerUser.role === "partner" || ownerUser.role === "company_admin")) {
      const tenant = await ensureTenantForPartnerUser(ownerUser);
      user.tenantId = tenant._id;
      user.tenantSlug = tenant.slug;
      await user.save();
      return user;
    }
  }

  return user;
}

exports.register = asyncHandler(async (req, res) => {
  const {
    name,
    firstName = "",
    lastName = "",
    email,
    password,
    role = "customer",
    phone,
    companyEmail = "",
    company = "",
    businessType = "",
    country = ""
  } = req.validated?.body || req.body;

  const normalizedRole = ({
    employee: "company_employee",
    company_employee: "company_employee",
    partner: "partner",
    company_admin: "company_admin",
    promoter: "promoter",
    customer: "customer"
  })[String(role || "customer")] || "customer";

  const fullName = String(name || `${firstName} ${lastName}`).trim();

  const e = String(email).toLowerCase().trim();
  const exists = await User.findOne({ email: e });
  if (exists) return res.status(409).json({ ok: false, message: "Email already exists" });

  let companyId = null;
  let tenantId = null;
  let tenantSlug = "";
  if (normalizedRole === "company_employee") {
    const companyLookup = String(companyEmail || "").toLowerCase().trim();
    if (!companyLookup) {
      return res.status(400).json({ ok: false, message: "Company admin email is required for employee registration" });
    }

    const company = await User.findOne({
      email: companyLookup,
      role: { $in: ["company_admin", "partner"] },
      status: "active"
    }).select("_id tenantId tenantSlug companyId companyName businessType country companyCurrency role");

    if (!company) {
      return res.status(404).json({ ok: false, message: "Company admin account not found for that email" });
    }

    if (!company.tenantId && ["company_admin", "partner"].includes(String(company.role || ""))) {
      const tenant = await ensureTenantForPartnerUser(company);
      company.tenantId = tenant._id;
      company.tenantSlug = tenant.slug;
    }

    companyId = company._id;
    tenantId = company.tenantId || null;
    tenantSlug = company.tenantSlug || "";
  }

  const passwordHash = await hashPassword(password);
  let user = null;
  for (let i = 0; i < 5; i += 1) {
    try {
      user = await User.create({
        name: fullName,
        email: e,
        phone,
        passwordHash,
        role: normalizedRole,
        tenantId,
        tenantSlug,
        companyId,
        companyName: normalizedRole === "company_employee" ? "" : String(company || "").trim(),
        businessType: normalizedRole === "company_employee" ? "" : String(businessType || "").trim(),
        country: normalizedRole === "company_employee" ? "" : String(country || "").trim(),
        onboardingSource: "self_signup",
        onboardedAt: new Date(),
        referralCode: makeReferralCode()
      });
      break;
    } catch (err) {
      if (String(err.code) === "11000" && String(err.message || "").includes("referralCode")) continue;
      throw err;
    }
  }
  if (!user) return res.status(500).json({ ok: false, message: "Could not create user (referral code collision)" });

  if (normalizedRole === "partner" || normalizedRole === "company_admin") {
    const tenant = await ensureTenantForPartnerUser(user);
    user = await User.findById(user._id);
    if (user) {
      user.tenantId = tenant._id;
      user.tenantSlug = tenant.slug;
      await user.save();
    }
  }

  user = await ensureUserTenantContext(user);


  // create session
  const refreshJwt = signRefreshToken({ userId: user._id.toString() });
  const sess = await Session.create({
    userId: user._id,
    refreshTokenHash: sha256(refreshJwt),
    userAgent: String(req.headers["user-agent"] || ""),
    ipHash: ipHash(req),
    expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
  });

  const payload = makePayload(user, sess._id.toString());
  const accessToken = signAccessToken(payload);

  res.cookie(REFRESH_COOKIE_NAME, refreshJwt, cookieOpts());
  res.json({ ok: true, user: payload, accessToken });
});

exports.login = asyncHandler(async (req, res) => {
  const { email, identity, password } = req.validated?.body || req.body;

  const rawIdentity = String(identity || email || "").trim();
  const normalizedIdentity = rawIdentity.toLowerCase();
  const user = rawIdentity.includes("@")
    ? await User.findOne({ email: normalizedIdentity })
    : await User.findOne({ phone: rawIdentity });
  if (!user) return res.status(401).json({ ok: false, message: "Invalid credentials" });
  if (user.status !== "active") return res.status(403).json({ ok: false, message: "Account suspended" });

  const ok = await comparePassword(password, user.passwordHash);
  if (!ok) return res.status(401).json({ ok: false, message: "Invalid credentials" });

  const hydratedUser = await ensureUserTenantContext(user);

  // rotate: new refresh session each login
  const refreshJwt = signRefreshToken({ userId: hydratedUser._id.toString() });
  const sess = await Session.create({
    userId: hydratedUser._id,
    refreshTokenHash: sha256(refreshJwt),
    userAgent: String(req.headers["user-agent"] || ""),
    ipHash: ipHash(req),
    expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
  });

  const payload = makePayload(hydratedUser, sess._id.toString());
  const accessToken = signAccessToken(payload);

  res.cookie(REFRESH_COOKIE_NAME, refreshJwt, cookieOpts());
  res.json({ ok: true, user: payload, accessToken });
});

exports.refresh = asyncHandler(async (req, res) => {
  const rt = req.cookies[REFRESH_COOKIE_NAME] || req.body.refreshToken;
  if (!rt) return res.status(401).json({ ok: false, message: "Missing refresh token" });

  let decoded;
  try {
    decoded = verifyRefreshToken(rt);
  } catch (e) {
    return res.status(401).json({ ok: false, message: "Invalid refresh token" });
  }

  const user = await User.findById(decoded.userId);
  if (!user) return res.status(401).json({ ok: false, message: "User not found" });
  const hydratedUser = await ensureUserTenantContext(user);

  const sess = await Session.findOne({ userId: hydratedUser._id, refreshTokenHash: sha256(rt), revokedAt: null });
  if (!sess) return res.status(401).json({ ok: false, message: "Session revoked/expired" });

  // rotate refresh token (one-time use)
  const newRefreshJwt = signRefreshToken({ userId: user._id.toString() });
  sess.refreshTokenHash = sha256(newRefreshJwt);
  sess.userAgent = String(req.headers["user-agent"] || sess.userAgent || "");
  sess.ipHash = ipHash(req);
  await sess.save();

  const payload = makePayload(hydratedUser, sess._id.toString());
  const accessToken = signAccessToken(payload);

  res.cookie(REFRESH_COOKIE_NAME, newRefreshJwt, cookieOpts());
  res.json({ ok: true, accessToken, user: payload });
});

exports.logout = asyncHandler(async (req, res) => {
  const rt = req.cookies[REFRESH_COOKIE_NAME];
  if (rt) {
    await Session.findOneAndUpdate({ refreshTokenHash: sha256(rt) }, { revokedAt: new Date() });
  }
  res.clearCookie(REFRESH_COOKIE_NAME, cookieOpts());
  res.json({ ok: true, message: "Logged out" });
});

exports.mySessions = asyncHandler(async (req, res) => {
  const items = await Session.find({ userId: req.user.userId })
    .select("-refreshTokenHash")
    .sort("-createdAt")
    .lean();
  res.json({ ok: true, items });
});

exports.revokeSession = asyncHandler(async (req, res) => {
  const s = await Session.findOneAndUpdate(
    { _id: req.params.id, userId: req.user.userId },
    { revokedAt: new Date() },
    { returnDocument: "after" }
  ).select("-refreshTokenHash");
  if (!s) return res.status(404).json({ ok: false, message: "Session not found" });
  res.json({ ok: true, session: s });
});
