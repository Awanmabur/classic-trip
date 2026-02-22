const asyncHandler = require("../middleware/asyncHandler");
const User = require("../models/user");

function makeReferralCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "CT-";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

const Session = require("../models/session");
const { hashPassword, comparePassword } = require("../utils/password");
const { signAccessToken, signRefreshToken, verifyRefreshToken, sha256 } = require("../utils/tokens");
const { REFRESH_COOKIE_NAME, COOKIE_SECURE, COOKIE_DOMAIN } = require("../config/env");

function ipHash(req) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString();
  return sha256(ip);
}

function cookieOpts() {
  const opts = {
    httpOnly: true,
    sameSite: "lax",
    secure: COOKIE_SECURE,
    path: "/api/auth/refresh"
  };
  if (COOKIE_DOMAIN) opts.domain = COOKIE_DOMAIN;
  return opts;
}

function makePayload(user, sid) {
  return { userId: user._id.toString(), email: user.email, role: user.role, sid, referralCode: user.referralCode };
}

exports.register = asyncHandler(async (req, res) => {
  const { name, email, password, role = "customer", phone } = req.body;

  const e = String(email).toLowerCase().trim();
  const exists = await User.findOne({ email: e });
  if (exists) return res.status(409).json({ ok: false, message: "Email already exists" });

  const passwordHash = await hashPassword(password);
  // Create user with unique referral code
let user = null;
for (let i = 0; i < 5; i++) {
  try {
    user = await User.create({
      name,
      email: e,
      phone,
      passwordHash,
      role,
      referralCode: makeReferralCode()
    });
    break;
  } catch (err) {
    // retry on duplicate referral code
    if (String(err.code) === "11000" && String(err.message || "").includes("referralCode")) continue;
    throw err;
  }
}
if (!user) return res.status(500).json({ ok: false, message: "Could not create user (referral code collision)" });


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
  const { email, password } = req.body;

  const e = String(email).toLowerCase().trim();
  const user = await User.findOne({ email: e });
  if (!user) return res.status(401).json({ ok: false, message: "Invalid credentials" });
  if (user.status !== "active") return res.status(403).json({ ok: false, message: "Account suspended" });

  const ok = await comparePassword(password, user.passwordHash);
  if (!ok) return res.status(401).json({ ok: false, message: "Invalid credentials" });

  // rotate: new refresh session each login
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

  const sess = await Session.findOne({ userId: user._id, refreshTokenHash: sha256(rt), revokedAt: null });
  if (!sess) return res.status(401).json({ ok: false, message: "Session revoked/expired" });

  // rotate refresh token (one-time use)
  const newRefreshJwt = signRefreshToken({ userId: user._id.toString() });
  sess.refreshTokenHash = sha256(newRefreshJwt);
  sess.userAgent = String(req.headers["user-agent"] || sess.userAgent || "");
  sess.ipHash = ipHash(req);
  await sess.save();

  const payload = makePayload(user, sess._id.toString());
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
    { new: true }
  ).select("-refreshTokenHash");
  if (!s) return res.status(404).json({ ok: false, message: "Session not found" });
  res.json({ ok: true, session: s });
});
