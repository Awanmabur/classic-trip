const crypto = require("crypto");
const { asyncHandler } = require("../../middleware/http");
const { User, Session } = require("../../models/shared");
const { ensureTenantForPartnerUser } = require("../../services/platform/tenants");
const { getOrCreateWallet } = require("../../services/shared/wallet");
const { buildAuthUrl, resolveGoogleUser, isConfigured } = require("../../services/public/googleAuth");
const {
  signAccessToken,
  signRefreshToken,
  sha256
} = require("../../utils/auth");
const {
  REFRESH_COOKIE_NAME,
  COOKIE_SECURE,
  COOKIE_DOMAIN,
  COOKIE_SAME_SITE,
  APP_URL
} = require("../../config/app");

const GOOGLE_STATE_KEY = "ct_g_state";

function cookieOpts(maxAge = 900000) {
  const opts = {
    httpOnly: true,
    sameSite: COOKIE_SAME_SITE,
    secure: COOKIE_SECURE,
    path: "/",
    maxAge
  };
  if (COOKIE_DOMAIN) opts.domain = COOKIE_DOMAIN;
  return opts;
}

function refreshCookieOpts() {
  return {
    httpOnly: true,
    sameSite: COOKIE_SAME_SITE,
    secure: COOKIE_SECURE,
    path: "/api"
  };
}

function makeReferralCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "CT-";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function makePayload(user, sid) {
  return {
    userId: user._id.toString(),
    email: user.email,
    role: user.role,
    tenantId: user.tenantId ? user.tenantId.toString() : undefined,
    tenantSlug: user.tenantSlug || undefined,
    companyId: user.companyId ? user.companyId.toString() : undefined,
    companyName: user.companyName || undefined,
    sid,
    referralCode: user.referralCode
  };
}

function dashboardForRole(role) {
  switch (role) {
    case "super_admin":
    case "admin":
      return "/platform/admin";
    case "partner":
    case "company_admin":
      return "/tenant/company-admin";
    case "company_employee":
      return "/tenant/company-employee";
    case "promoter":
      return "/promoter-dashboard";
    default:
      return "/customer-dashboard";
  }
}

/** GET /auth/google?role=customer|partner|promoter */
exports.initiate = asyncHandler(async (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({ ok: false, message: "Google login is not configured on this server." });
  }

  const role = String(req.query.role || "customer").trim();
  const csrfToken = crypto.randomBytes(24).toString("hex");

  res.cookie(GOOGLE_STATE_KEY, csrfToken, cookieOpts(600000)); // 10 min

  const redirectUrl = buildAuthUrl(csrfToken, role);
  res.redirect(redirectUrl);
});

/** GET /auth/google/callback */
exports.callback = asyncHandler(async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`/login?error=${encodeURIComponent("Google login cancelled or failed.")}`);
  }

  if (!code || !state) {
    return res.redirect("/login?error=invalid_oauth_callback");
  }

  // CSRF check
  let stateData = {};
  try {
    stateData = JSON.parse(state);
  } catch (_) {
    return res.redirect("/login?error=invalid_state");
  }

  const storedCsrf = req.cookies?.[GOOGLE_STATE_KEY];
  if (!storedCsrf || storedCsrf !== stateData.csrf) {
    return res.redirect("/login?error=csrf_mismatch");
  }

  res.clearCookie(GOOGLE_STATE_KEY);

  // Exchange code for Google profile
  let googleProfile;
  try {
    googleProfile = await resolveGoogleUser(code);
  } catch (err) {
    return res.redirect(`/login?error=${encodeURIComponent("Google authentication failed.")}`);
  }

  const { googleId, email, name, emailVerified } = googleProfile;
  const hintRole = stateData.role || "customer";

  // Find or create user
  let user = await User.findOne({ email });

  if (user) {
    // Suspended users cannot log in
    if (user.status === "suspended") {
      return res.redirect("/login?error=account_suspended");
    }

    // Attach Google ID if not already linked
    if (!user.googleId) {
      user.googleId = googleId;
      await user.save();
    }
  } else {
    // New user — create with hinted role
    const normalizedRole = ({
      partner: "partner",
      company_admin: "partner",
      promoter: "promoter",
      customer: "customer"
    })[hintRole] || "customer";

    user = await User.create({
      name,
      email,
      googleId,
      role: normalizedRole,
      status: "active",
      emailVerifiedAt: emailVerified ? new Date() : null,
      referralCode: normalizedRole === "promoter" ? makeReferralCode() : undefined
    });

    // Ensure wallet
    await getOrCreateWallet(user._id, "UGX");
  }

  // For partner users, provision a tenant if needed
  if ((user.role === "partner" || user.role === "company_admin") && !user.tenantId) {
    try {
      await ensureTenantForPartnerUser(user);
      user = await User.findById(user._id);
    } catch (_) {
      // non-blocking
    }
  }

  // Create session
  const sid = crypto.randomBytes(16).toString("hex");
  const ipRaw = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString();
  const ipDigest = sha256(ipRaw);
  await Session.create({
    userId: user._id,
    sid,
    userAgent: req.headers["user-agent"] || "",
    ipHash: ipDigest
  });

  const payload = makePayload(user, sid);
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken({ ...payload, sid });

  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOpts());

  // Redirect to dashboard with tokens as query params (client stores them)
  const destination = dashboardForRole(user.role);
  const queryString = new URLSearchParams({ token: accessToken }).toString();
  return res.redirect(`${destination}?${queryString}`);
});
