const { asyncHandler } = require("../../middleware/http");
const { PartnerInvite, StaffInvite } = require("../../models/platform");
const { PartnerInquiry } = require("../../models/public");
const { Session, User } = require("../../models/shared");
const { ensureTenantForPartnerUser } = require("../../services/platform/tenants");
const { getOrCreateWallet } = require("../../services/shared/wallet");
const {
  ensureStaffInviteStatus,
  staffInviteSummary
} = require("../../services/tenant/company");
const {
  hashPassword,
  sha256,
  signAccessToken,
  signRefreshToken
} = require("../../utils/auth");
const {
  REFRESH_COOKIE_NAME,
  COOKIE_SECURE,
  COOKIE_DOMAIN,
  COOKIE_SAME_SITE
} = require("../../config/app");

function makeReferralCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "CT-";
  for (let i = 0; i < 6; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

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

async function ensureInviteStatus(invite) {
  if (!invite) return null;
  if (invite.status === "pending" && invite.expiresAt && invite.expiresAt < new Date()) {
    invite.status = "expired";
    await invite.save();
  }
  return invite;
}

function partnerInviteSummary(invite) {
  return {
    id: invite._id,
    companyName: invite.companyName,
    businessType: invite.businessType,
    country: invite.country,
    contactName: invite.contactName,
    email: invite.email,
    phone: invite.phone,
    role: invite.role,
    status: invite.status,
    sentAt: invite.sentAt,
    lastSentAt: invite.lastSentAt,
    expiresAt: invite.expiresAt
  };
}

function staffInvitePublicSummary(invite, company) {
  const summary = staffInviteSummary(invite);
  return {
    ...summary,
    inviteKind: "staff",
    companyName: company?.companyName || company?.name || "Company",
    businessType: company?.businessType || "",
    country: company?.country || "",
    contactName: invite.name || "",
    email: invite.email,
    phone: invite.phone || "",
    role: "company_employee"
  };
}

function splitName(fullName = "") {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ")
  };
}

async function loadInvite(token) {
  const tokenHash = sha256(token || "");
  const partnerInvite = await ensureInviteStatus(await PartnerInvite.findOne({ tokenHash }));
  if (partnerInvite) return { kind: "partner", invite: partnerInvite };

  const staffInvite = await ensureStaffInviteStatus(await StaffInvite.findOne({ tokenHash }));
  if (staffInvite) return { kind: "staff", invite: staffInvite };

  return { kind: null, invite: null };
}

exports.getOne = asyncHandler(async (req, res) => {
  const { kind, invite } = await loadInvite(req.params.token);

  if (!invite) return res.status(404).json({ ok: false, message: "Invite not found" });
  if (invite.status === "revoked") return res.status(410).json({ ok: false, message: "Invite has been revoked" });
  if (invite.status === "accepted") return res.status(409).json({ ok: false, message: "Invite has already been accepted" });
  if (invite.status === "expired") return res.status(410).json({ ok: false, message: "Invite has expired" });

  const nameParts = splitName(invite.contactName);
  let summary = null;

  if (kind === "partner") {
    summary = {
      ...partnerInviteSummary(invite),
      inviteKind: "partner",
      firstName: nameParts.firstName,
      lastName: nameParts.lastName
    };
  } else {
    const company = await User.findById(invite.ownerId).select("name companyName businessType country").lean();
    const staffNameParts = splitName(invite.name);
    summary = {
      ...staffInvitePublicSummary(invite, company),
      firstName: staffNameParts.firstName,
      lastName: staffNameParts.lastName
    };
  }

  res.json({
    ok: true,
    invite: summary
  });
});

exports.accept = asyncHandler(async (req, res) => {
  const { kind, invite } = await loadInvite(req.params.token);

  if (!invite) return res.status(404).json({ ok: false, message: "Invite not found" });
  if (invite.status === "revoked") return res.status(410).json({ ok: false, message: "Invite has been revoked" });
  if (invite.status === "accepted") return res.status(409).json({ ok: false, message: "Invite has already been accepted" });
  if (invite.status === "expired") return res.status(410).json({ ok: false, message: "Invite has expired" });

  const {
    name,
    firstName = "",
    lastName = "",
    phone = "",
    password
  } = req.validated?.body || req.body;

  const fullName = String(name || `${firstName} ${lastName}`).trim() || invite.contactName || invite.name;
  const existingUser = await User.findOne({ email: invite.email }).select("_id");
  if (existingUser) {
    return res.status(409).json({ ok: false, message: "An account already exists for this invite email" });
  }

  const passwordHash = await hashPassword(password);

  let user = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      if (kind === "partner") {
        user = await User.create({
          name: fullName,
          email: invite.email,
          phone: String(phone || invite.phone || "").trim(),
          passwordHash,
          role: invite.role,
          status: "active",
          companyName: invite.companyName,
          businessType: invite.businessType,
          country: invite.country,
          invitedByUserId: invite.invitedByUserId,
          onboardingSource: "platform_invite",
          invitedAt: invite.sentAt || invite.createdAt || new Date(),
          onboardedAt: new Date(),
          referralCode: makeReferralCode()
        });
        const tenant = await ensureTenantForPartnerUser(user);
        user = await User.findById(user._id);
        if (user) {
          user.tenantId = tenant._id;
          user.tenantSlug = tenant.slug;
          await user.save();
        }
      } else {
        const company = await User.findById(invite.ownerId).select("name companyName businessType country companyCurrency tenantId tenantSlug role email phone").lean();
        if (!company) {
          return res.status(404).json({ ok: false, message: "The company for this invite no longer exists" });
        }

        let companyTenantId = company.tenantId || null;
        let companyTenantSlug = company.tenantSlug || "";
        if (!companyTenantId && ["company_admin", "partner"].includes(String(company.role || ""))) {
          const ownerDoc = await User.findById(invite.ownerId);
          const tenant = await ensureTenantForPartnerUser(ownerDoc);
          companyTenantId = tenant._id;
          companyTenantSlug = tenant.slug;
        }

        user = await User.create({
          name: fullName,
          email: invite.email,
          phone: String(phone || invite.phone || "").trim(),
          passwordHash,
          role: "company_employee",
          tenantId: companyTenantId,
          tenantSlug: companyTenantSlug,
          companyId: company._id,
          status: "active",
          companyName: company.companyName || company.name || "",
          businessType: company.businessType || "",
          country: company.country || "",
          companyCurrency: company.companyCurrency || "UGX",
          jobTitle: invite.jobTitle || "Operations staff",
          permissionsLabel: invite.permissionsLabel || "Operations",
          invitedByUserId: invite.invitedByUserId,
          onboardingSource: "company_invite",
          invitedAt: invite.sentAt || invite.createdAt || new Date(),
          onboardedAt: new Date(),
          referralCode: makeReferralCode()
        });
      }
      break;
    } catch (err) {
      if (String(err.code) === "11000" && String(err.message || "").includes("referralCode")) continue;
      throw err;
    }
  }

  if (!user) {
    return res.status(500).json({ ok: false, message: "Could not complete onboarding for this invite" });
  }

  await getOrCreateWallet(user._id, "UGX");

  invite.status = "accepted";
  invite.acceptedUserId = user._id;
  invite.acceptedAt = new Date();
  await invite.save();

  if (invite.inquiryId) {
    await PartnerInquiry.findByIdAndUpdate(invite.inquiryId, {
      status: "approved",
      inviteId: invite._id,
      reviewedByUserId: invite.invitedByUserId,
      reviewedAt: new Date(),
      notes: invite.notes || undefined
    });
  }

  const refreshJwt = signRefreshToken({ userId: user._id.toString() });
  const session = await Session.create({
    userId: user._id,
    refreshTokenHash: sha256(refreshJwt),
    userAgent: String(req.headers["user-agent"] || ""),
    ipHash: ipHash(req),
    expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
  });

  const payload = makePayload(user, session._id.toString());
  const accessToken = signAccessToken(payload);

  const responseInvite = kind === "partner"
    ? partnerInviteSummary(invite)
    : staffInvitePublicSummary(invite, await User.findById(invite.ownerId).select("name companyName businessType country").lean());

  res.cookie(REFRESH_COOKIE_NAME, refreshJwt, cookieOpts());
  res.json({
    ok: true,
    accessToken,
    user: payload,
    invite: responseInvite
  });
});
