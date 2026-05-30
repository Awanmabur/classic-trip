const { asyncHandler } = require("../../middleware/http");
const { APP_URL } = require("../../config/app");
const { PartnerInvite, Tenant, TripCatalog } = require("../../models/platform");
const { PartnerInquiry } = require("../../models/public");
const { Booking, User } = require("../../models/shared");
const { loadCatalogMetricsByTenant } = require("../../services/platform/analytics");
const { buildTenantPortalUrl, buildTenantWebUrl } = require("../../services/platform/tenants/domains");
const { setTenantStatusForOwner } = require("../../services/platform/tenants/provisioning");
const { bookingServiceSnapshot } = require("../../services/shared/bookings");
const { randomToken, sha256 } = require("../../utils/auth");

const PARTNER_ROLES = ["company_admin", "partner"];
const PENDING_INVITE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function baseAppUrl() {
  return String(APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

function inviteUrl(token) {
  return `${baseAppUrl()}/invite/${token}`;
}

function normalizeStatusBadge(invite) {
  if (invite.status === "pending" && invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    return "expired";
  }
  return invite.status;
}

function serializeInquiry(inquiry) {
  return {
    _id: String(inquiry._id),
    companyName: inquiry.companyName,
    businessType: inquiry.businessType,
    country: inquiry.country,
    contactName: inquiry.contactName,
    email: inquiry.email,
    phone: inquiry.phone,
    status: inquiry.status,
    notes: inquiry.notes || "",
    inviteId: inquiry.inviteId ? String(inquiry.inviteId) : "",
    reviewedByUserId: inquiry.reviewedByUserId ? String(inquiry.reviewedByUserId) : "",
    reviewedAt: inquiry.reviewedAt,
    createdAt: inquiry.createdAt
  };
}

function serializeInvite(invite) {
  return {
    _id: String(invite._id),
    inquiryId: invite.inquiryId ? String(invite.inquiryId) : "",
    invitedByUserId: invite.invitedByUserId ? String(invite.invitedByUserId) : "",
    acceptedUserId: invite.acceptedUserId ? String(invite.acceptedUserId) : "",
    companyName: invite.companyName,
    businessType: invite.businessType,
    country: invite.country,
    contactName: invite.contactName,
    email: invite.email,
    phone: invite.phone,
    role: invite.role,
    notes: invite.notes || "",
    status: normalizeStatusBadge(invite),
    sentAt: invite.sentAt,
    lastSentAt: invite.lastSentAt,
    expiresAt: invite.expiresAt,
    acceptedAt: invite.acceptedAt,
    revokedAt: invite.revokedAt,
    createdAt: invite.createdAt
  };
}

function bookingSearchHaystack(booking) {
  const snapshot = bookingServiceSnapshot(booking);
  const user = booking.userId || {};
  const owner = booking.ownerId || {};
  const guest = booking.guest || {};

  return [
    booking._id,
    booking.guestLookupCode,
    booking.referralCode,
    booking.paymentRef,
    booking.status,
    booking.paymentStatus,
    snapshot.serviceName,
    snapshot.serviceFrom,
    snapshot.serviceTo,
    owner.companyName,
    owner.name,
    owner.email,
    user.name,
    user.email,
    user.phone,
    guest.name,
    guest.email,
    guest.phone
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase())
    .join(" ");
}

function buildInviteDelivery(invite, token) {
  const url = inviteUrl(token);
  const intro = invite.companyName
    ? `You have been invited to manage ${invite.companyName} on Classic Trip.`
    : "You have been invited to join Classic Trip as a company administrator.";

  return {
    inviteUrl: url,
    email: {
      to: invite.email,
      subject: `Classic Trip partner invite for ${invite.companyName}`,
      body: [
        `Hello ${invite.contactName || "partner team"},`,
        "",
        intro,
        `Business type: ${invite.businessType}`,
        `Country: ${invite.country}`,
        "",
        `Accept the invite here: ${url}`,
        "",
        "This secure invite expires in 7 days."
      ].join("\n")
    },
    whatsappText: [
      `Classic Trip partner invite for ${invite.companyName}`,
      intro,
      `Accept here: ${url}`,
      "This secure invite expires in 7 days."
    ].join("\n")
  };
}

function mapById(rows, valueKey) {
  return new Map(rows.map((row) => [String(row._id), Number(row[valueKey] || 0)]));
}

function mapPartnerPerformance(rows) {
  return new Map(rows.map((row) => [String(row._id), row]));
}

function dateValue(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}

async function expirePendingInvites() {
  await PartnerInvite.updateMany(
    {
      status: "pending",
      expiresAt: { $lt: new Date() }
    },
    {
      $set: { status: "expired" }
    }
  );
}

async function buildPartnerDirectory(limit = 12) {
  const tenants = await Tenant.find()
    .sort("-createdAt")
    .limit(limit)
    .lean();

  const tenantIds = tenants.map((tenant) => tenant._id);
  const ownerIds = tenants.map((tenant) => tenant.ownerUserId).filter(Boolean);
  if (!tenantIds.length) return [];

  const [catalogMetrics, owners, employeeRows, bookingRows] = await Promise.all([
    loadCatalogMetricsByTenant(tenantIds),
    User.find({ _id: { $in: ownerIds } })
      .select("name email phone role status companyName businessType country invitedByUserId onboardingSource invitedAt onboardedAt createdAt")
      .lean(),
    User.aggregate([
      { $match: { tenantId: { $in: tenantIds }, role: "company_employee" } },
      { $group: { _id: "$tenantId", employees: { $sum: 1 } } }
    ]),
    Booking.aggregate([
      { $match: { ownerId: { $in: ownerIds } } },
      {
        $group: {
          _id: "$ownerId",
          totalBookings: { $sum: 1 },
          confirmedBookings: {
            $sum: { $cond: [{ $eq: ["$status", "confirmed"] }, 1, 0] }
          },
          revenue: {
            $sum: { $cond: [{ $eq: ["$status", "confirmed"] }, "$amount", 0] }
          }
        }
      }
    ])
  ]);

  const ownersById = new Map(owners.map((owner) => [String(owner._id), owner]));
  const employeesById = mapById(employeeRows, "employees");
  const bookingsById = mapPartnerPerformance(bookingRows);

  return tenants.map((tenant) => {
    const owner = ownersById.get(String(tenant.ownerUserId)) || {};
    const bookingStats = bookingsById.get(String(tenant.ownerUserId || "")) || {};
    const routeStats = catalogMetrics.routesByTenant.get(String(tenant._id)) || {};
    const tripStats = catalogMetrics.tripsByTenant.get(String(tenant._id)) || {};
    return {
      _id: String(tenant.ownerUserId || owner._id || tenant._id),
      tenantId: String(tenant._id),
      tenantSlug: tenant.slug,
      primaryDomain: tenant.primaryDomain || "",
      portalUrl: buildTenantPortalUrl(tenant),
      storefrontUrl: buildTenantWebUrl(tenant, "/"),
      authUrl: buildTenantWebUrl(tenant, "/login"),
      name: owner.name || tenant.ownerName || tenant.name,
      email: owner.email || tenant.ownerEmail || "",
      phone: owner.phone || tenant.phone || "",
      role: owner.role || "company_admin",
      status: tenant.status,
      companyName: tenant.name,
      businessType: tenant.businessType || "",
      country: tenant.country || "",
      onboardingSource: owner.onboardingSource || "",
      invitedAt: owner.invitedAt || null,
      onboardedAt: owner.onboardedAt || tenant.provisionedAt || null,
      createdAt: tenant.createdAt,
      routes: Number(routeStats.totalRoutes || 0),
      trips: Number(tripStats.totalTrips || 0),
      employees: Number(employeesById.get(String(tenant._id)) || 0),
      totalBookings: Number(bookingStats.totalBookings || 0),
      confirmedBookings: Number(bookingStats.confirmedBookings || 0),
      revenue: Number(bookingStats.revenue || 0)
    };
  });
}

async function buildPartnerAdminSnapshot() {
  await expirePendingInvites();

  const [
    users,
    partners,
    trips,
    bookings,
    confirmed,
    pendingInquiries,
    pendingInvites,
    suspendedPartners,
    newInquiries,
    reviewingInquiries,
    approvedInquiries,
    rejectedInquiries,
    acceptedInvites,
    expiredInvites,
    revokedInvites,
    activePartners,
    trialPartners,
    revenueAgg,
    partnerInquiries,
    partnerInvites,
    partnerDirectory
  ] = await Promise.all([
    User.countDocuments(),
    Tenant.countDocuments(),
    TripCatalog.countDocuments(),
    Booking.countDocuments(),
    Booking.countDocuments({ status: "confirmed" }),
    PartnerInquiry.countDocuments({ status: { $in: ["new", "reviewing"] } }),
    PartnerInvite.countDocuments({ status: "pending" }),
    Tenant.countDocuments({ status: "suspended" }),
    PartnerInquiry.countDocuments({ status: "new" }),
    PartnerInquiry.countDocuments({ status: "reviewing" }),
    PartnerInquiry.countDocuments({ status: "approved" }),
    PartnerInquiry.countDocuments({ status: "rejected" }),
    PartnerInvite.countDocuments({ status: "accepted" }),
    PartnerInvite.countDocuments({ status: "expired" }),
    PartnerInvite.countDocuments({ status: "revoked" }),
    Tenant.countDocuments({ status: "active" }),
    Tenant.countDocuments({ status: "trial" }),
    Booking.aggregate([
      { $match: { status: "confirmed" } },
      { $group: { _id: "$currency", total: { $sum: "$amount" } } }
    ]),
    PartnerInquiry.find()
      .sort({ createdAt: -1 })
      .limit(12)
      .lean(),
    PartnerInvite.find()
      .sort({ createdAt: -1 })
      .limit(12)
      .lean(),
    buildPartnerDirectory(12)
  ]);

  const recentOnboardedPartners = [...partnerDirectory]
    .filter((item) => item.onboardedAt)
    .sort((a, b) => dateValue(b.onboardedAt) - dateValue(a.onboardedAt))
    .slice(0, 6);

  return {
    stats: {
      users,
      partners,
      trips,
      bookings,
      confirmed,
      pendingInquiries,
      pendingInvites,
      suspendedPartners,
      activePartners,
      trialPartners,
      acceptedInvites,
      expiredInvites,
      revokedInvites,
      revenue: revenueAgg
    },
    onboarding: {
      inquiries: {
        new: newInquiries,
        reviewing: reviewingInquiries,
        approved: approvedInquiries,
        rejected: rejectedInquiries
      },
      invites: {
        pending: pendingInvites,
        accepted: acceptedInvites,
        expired: expiredInvites,
        revoked: revokedInvites
      },
      partners: {
        active: activePartners,
        trial: trialPartners,
        suspended: suspendedPartners
      }
    },
    partnerInquiries: partnerInquiries.map(serializeInquiry),
    partnerInvites: partnerInvites.map(serializeInvite),
    partners: partnerDirectory,
    recentOnboardedPartners
  };
}

async function createInviteRecord({
  inquiryId = "",
  invitedByUserId,
  companyName,
  businessType,
  country,
  contactName,
  email,
  phone,
  notes,
  role
}) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  let inquiry = null;

  if (inquiryId) {
    inquiry = await PartnerInquiry.findById(inquiryId).select("_id status inviteId");
    if (!inquiry) {
      const err = new Error("Partner inquiry not found");
      err.statusCode = 404;
      throw err;
    }
  }

  const existingUser = await User.findOne({ email: normalizedEmail }).select("_id role status");
  if (existingUser) {
    const err = new Error("A user account already exists for this email");
    err.statusCode = 409;
    throw err;
  }

  await expirePendingInvites();

  const existingInvite = await PartnerInvite.findOne({
    email: normalizedEmail,
    status: "pending"
  }).select("_id");

  if (existingInvite) {
    const err = new Error("There is already a pending invite for this email");
    err.statusCode = 409;
    throw err;
  }

  if (inquiry) {
    const inquiryInvite = await PartnerInvite.findOne({
      inquiryId,
      status: { $in: ["pending", "accepted"] }
    }).select("_id status");

    if (inquiryInvite) {
      const err = new Error("This inquiry already has an active invite");
      err.statusCode = 409;
      throw err;
    }
  }

  const token = randomToken(24);
  const now = new Date();
  const invite = await PartnerInvite.create({
    inquiryId: inquiryId || null,
    invitedByUserId,
    companyName,
    businessType,
    country,
    contactName,
    email: normalizedEmail,
    phone: String(phone || "").trim(),
    role: role || "company_admin",
    notes: String(notes || "").trim(),
    tokenHash: sha256(token),
    status: "pending",
    sentAt: now,
    lastSentAt: now,
    expiresAt: new Date(now.getTime() + PENDING_INVITE_WINDOW_MS)
  });

  if (inquiry) {
    await PartnerInquiry.findByIdAndUpdate(inquiryId, {
      status: "approved",
      inviteId: invite._id,
      reviewedByUserId: invitedByUserId,
      reviewedAt: now,
      notes: String(notes || "").trim()
    });
  }

  return { invite, delivery: buildInviteDelivery(invite, token) };
}

exports.stats = asyncHandler(async (_req, res) => {
  const snapshot = await buildPartnerAdminSnapshot();
  res.json({ ok: true, ...snapshot });
});

exports.users = asyncHandler(async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
  const q = String(req.query.q || "").trim();
  const role = String(req.query.role || "").trim();
  const status = String(req.query.status || "").trim();
  const filter = q
    ? {
        $or: [
          { email: new RegExp(q, "i") },
          { name: new RegExp(q, "i") },
          { phone: new RegExp(q, "i") },
          { companyName: new RegExp(q, "i") },
          { referralCode: new RegExp(q, "i") }
        ]
      }
    : {};
  if (role) filter.role = role;
  if (status) filter.status = status;
  const items = await User.find(filter)
    .select("name email phone role status referralCode companyId companyName businessType country onboardingSource invitedAt onboardedAt createdAt")
    .sort("-createdAt")
    .limit(limit)
    .lean();
  res.json({ ok: true, items });
});

exports.bookings = asyncHandler(async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
  const q = String(req.query.q || "").trim().toLowerCase();
  const status = String(req.query.status || "").trim();
  const filter = status ? { status } : {};

  let items = await Booking.find(filter)
    .populate("userId", "name email phone")
    .populate("ownerId", "name companyName email phone")
    .populate("referralUserId", "name email phone referralCode")
    .sort("-createdAt")
    .limit(limit)
    .lean();

  if (q) {
    items = items.filter((booking) => bookingSearchHaystack(booking).includes(q));
  }

  res.json({ ok: true, items });
});

exports.partnerInquiries = asyncHandler(async (_req, res) => {
  const items = await PartnerInquiry.find().sort("-createdAt").limit(50).lean();
  res.json({ ok: true, items: items.map(serializeInquiry) });
});

exports.reviewPartnerInquiry = asyncHandler(async (req, res) => {
  const inquiry = await PartnerInquiry.findById(req.params.id);
  if (!inquiry) return res.status(404).json({ ok: false, message: "Partner inquiry not found" });

  inquiry.status = req.validated?.body?.status || req.body.status;
  inquiry.notes = String(req.validated?.body?.notes || req.body.notes || "").trim();
  inquiry.reviewedByUserId = req.user.userId;
  inquiry.reviewedAt = new Date();
  await inquiry.save();

  res.json({ ok: true, inquiry: serializeInquiry(inquiry) });
});

exports.partnerInvites = asyncHandler(async (_req, res) => {
  await expirePendingInvites();
  const items = await PartnerInvite.find().sort("-createdAt").limit(50).lean();
  res.json({ ok: true, items: items.map(serializeInvite) });
});

exports.createPartnerInvite = asyncHandler(async (req, res) => {
  const body = req.validated?.body || req.body;
  const { invite, delivery } = await createInviteRecord({
    inquiryId: String(body.inquiryId || "").trim(),
    invitedByUserId: req.user.userId,
    companyName: body.companyName,
    businessType: body.businessType,
    country: body.country,
    contactName: body.contactName,
    email: body.email,
    phone: body.phone,
    notes: body.notes,
    role: body.role
  });

  res.status(201).json({
    ok: true,
    invite: serializeInvite(invite),
    delivery,
    message: `Invite prepared for ${invite.email}`
  });
});

exports.resendPartnerInvite = asyncHandler(async (req, res) => {
  await expirePendingInvites();
  const invite = await PartnerInvite.findById(req.params.id);
  if (!invite) return res.status(404).json({ ok: false, message: "Invite not found" });
  if (invite.status === "accepted") {
    return res.status(409).json({ ok: false, message: "Accepted invites cannot be resent" });
  }
  if (invite.status === "revoked") {
    return res.status(409).json({ ok: false, message: "Revoked invites cannot be resent" });
  }

  const token = randomToken(24);
  const now = new Date();
  invite.tokenHash = sha256(token);
  invite.status = "pending";
  invite.lastSentAt = now;
  invite.expiresAt = new Date(now.getTime() + PENDING_INVITE_WINDOW_MS);
  await invite.save();

  res.json({
    ok: true,
    invite: serializeInvite(invite),
    delivery: buildInviteDelivery(invite, token),
    message: `A fresh secure invite is ready for ${invite.email}`
  });
});

exports.revokePartnerInvite = asyncHandler(async (req, res) => {
  const invite = await PartnerInvite.findById(req.params.id);
  if (!invite) return res.status(404).json({ ok: false, message: "Invite not found" });
  if (invite.status === "accepted") {
    return res.status(409).json({ ok: false, message: "Accepted invites cannot be revoked" });
  }

  invite.status = "revoked";
  invite.revokedAt = new Date();
  await invite.save();

  res.json({ ok: true, invite: serializeInvite(invite) });
});

exports.partners = asyncHandler(async (_req, res) => {
  const items = await buildPartnerDirectory(50);
  res.json({ ok: true, items });
});

exports.setPartnerStatus = asyncHandler(async (req, res) => {
  const { status } = req.validated?.body || req.body;
  const partner = await User.findById(req.params.id);

  if (!partner || !PARTNER_ROLES.includes(partner.role)) {
    return res.status(404).json({ ok: false, message: "Partner company admin not found" });
  }

  partner.status = status;
  await partner.save();

  await User.updateMany(
    { companyId: partner._id, role: "company_employee" },
    { $set: { status } }
  );
  await setTenantStatusForOwner(partner._id, status);

  res.json({
    ok: true,
    partner: {
      _id: String(partner._id),
      status: partner.status,
      role: partner.role,
      companyName: partner.companyName || partner.name
    }
  });
});

// ─── Payout request management (platform admin) ──────────────────────────────

const { getTenantConnection } = require("../../core/tenancy/tenantConnectionManager");
const { getTenantModels } = require("../../models/tenant");
const { debit } = require("../../services/shared/wallet");

/**
 * Collect every CompanyPayoutRequest across all tenants.
 * Since payout requests live in per-tenant DBs we loop over all tenants.
 */
async function loadAllPayoutRequests(limit = 80) {
  const tenants = await Tenant.find({ status: { $in: ["active", "trial"] } }).lean();
  const results = [];

  await Promise.all(
    tenants.map(async (tenant) => {
      try {
        const connection = await getTenantConnection(tenant);
        const models = getTenantModels(connection);
        const items = await models.CompanyPayoutRequest.find()
          .sort("-createdAt")
          .limit(limit)
          .lean();
        for (const item of items) {
          results.push({
            id: String(item._id),
            tenantId: String(tenant._id),
            tenantSlug: tenant.slug,
            tenantName: tenant.name,
            ownerId: String(item.ownerId),
            amount: item.amount,
            currency: item.currency || "UGX",
            destination: item.destination || "",
            note: item.note || "",
            status: item.status,
            reviewedAt: item.reviewedAt || null,
            createdAt: item.createdAt,
            _raw: { tenantSlug: tenant.slug, itemId: String(item._id) }
          });
        }
      } catch (_) {
        // Silently skip tenants with connection issues
      }
    })
  );

  return results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit);
}

/** GET /api/platform/admin/payout-requests */
exports.payoutRequests = asyncHandler(async (req, res) => {
  const status = String(req.query.status || "").trim();
  const items = await loadAllPayoutRequests(100);
  const filtered = status ? items.filter((r) => r.status === status) : items;
  res.json({ ok: true, items: filtered });
});

/** PATCH /api/platform/admin/payout-requests/:tenantSlug/:id */
exports.reviewPayoutRequest = asyncHandler(async (req, res) => {
  const { tenantSlug, id } = req.params;
  const decision = String(req.body?.status || "").trim();
  const reviewNote = String(req.body?.note || "").trim();

  if (!["approved", "rejected", "paid"].includes(decision)) {
    return res.status(400).json({ ok: false, message: "status must be approved | rejected | paid" });
  }

  const tenant = await Tenant.findOne({ slug: tenantSlug }).lean();
  if (!tenant) return res.status(404).json({ ok: false, message: "Tenant not found" });

  const connection = await getTenantConnection(tenant);
  const models = getTenantModels(connection);
  const request = await models.CompanyPayoutRequest.findById(id);
  if (!request) return res.status(404).json({ ok: false, message: "Payout request not found" });

  if (request.status === "paid") {
    return res.status(409).json({ ok: false, message: "This payout has already been marked paid" });
  }

  const previousStatus = request.status;
  request.status = decision;
  request.reviewedByUserId = req.user.userId;
  request.reviewedAt = new Date();
  if (reviewNote) request.note = `${request.note || ""}\n[Admin] ${reviewNote}`.trim();
  await request.save();

  // When marking as paid: debit the operator wallet to record the outflow
  if (decision === "paid" && previousStatus !== "paid") {
    try {
      await debit(
        request.ownerId,
        request.amount,
        request.currency,
        {
          type: "payout_disbursed",
          note: `Payout #${id} approved and paid by admin`,
          sourcePayoutId: request._id
        }
      );
    } catch (walletErr) {
      // Log but don't fail the status update
      console.error("[payout] wallet debit error:", walletErr.message);
    }
  }

  res.json({
    ok: true,
    request: {
      id: String(request._id),
      tenantSlug,
      status: request.status,
      amount: request.amount,
      currency: request.currency,
      reviewedAt: request.reviewedAt
    }
  });
});
