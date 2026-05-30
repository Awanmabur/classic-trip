const { asyncHandler } = require("../../middleware/http");
const crypto = require("crypto");
const { StaffInvite, Tenant } = require("../../models/platform");
const { Review, SupportRequest } = require("../../models/public");
const { serializePublicTenantContext } = require("../../services/public/context");
const { Booking, Payment, User } = require("../../models/shared");
const { bookingCodeFor, bookingServiceSnapshot } = require("../../services/shared/bookings");
const { getOrCreateWallet } = require("../../services/shared/wallet");
const {
  syncTripCatalogByTrip,
  syncTenantCatalogByOwner,
  syncTripCatalogsByRoute,
  syncTripCatalogsByVehicle
} = require("../../services/platform/catalog");
const { reverseBookingPayouts, settleBookingPayouts } = require("../../services/platform/settlements");
const {
  createTenantDomain,
  listTenantDomains,
  removeTenantDomain,
  serializeTenantDomain,
  serializeTenantIdentity,
  verifyTenantDomain
} = require("../../services/platform/tenants");
const { createOptions, runWithOptionalTransaction, withSession } = require("../../services/shared/database");
const { getTenantAccessForRequest } = require("../../services/tenant/runtime");
const {
  buildStaffInviteDelivery,
  buildStaffInviteToken,
  ensureStaffInviteStatus,
  resolveCompanyOwnerId,
  staffInviteSummary,
  toObjectId
} = require("../../services/tenant/company");

const STAFF_INVITE_DAYS = 7;

function serializeEmployee(employee) {
  return {
    id: employee._id,
    name: employee.name,
    email: employee.email,
    phone: employee.phone || "",
    status: employee.status,
    jobTitle: employee.jobTitle || "Operations staff",
    permissionsLabel: employee.permissionsLabel || "Operations",
    createdAt: employee.createdAt,
    updatedAt: employee.updatedAt
  };
}

function serializeSupportCase(item) {
  return {
    id: item._id,
    customer: item.name,
    contact: item.contact,
    issue: item.topic,
    priority: item.priority || "Normal",
    status: item.status,
    openedAt: item.createdAt,
    bookingReference: item.bookingReference || "",
    message: item.message,
    notes: item.notes || ""
  };
}

function serializeNotice(item) {
  return {
    id: item._id,
    audience: item.audience,
    priority: item.priority,
    message: item.message,
    tripId: item.tripId || null,
    status: item.status,
    createdAt: item.createdAt
  };
}

function serializePayoutRequest(item) {
  return {
    id: item._id,
    amount: item.amount,
    currency: item.currency,
    destination: item.destination || "",
    note: item.note || "",
    status: item.status,
    createdAt: item.createdAt
  };
}

function cleanSeats(seats) {
  return Array.isArray(seats)
    ? seats.map((seat) => String(seat || "").trim()).filter(Boolean)
    : [];
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function makeLookupCode() {
  return `GT-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function makeManualProviderReference(prefix = "MANUAL") {
  return `${prefix}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}

function customerNameForBooking(booking) {
  return booking.userId?.name || booking.guest?.name || "Guest customer";
}

function customerContactForBooking(booking) {
  return booking.userId?.email || booking.userId?.phone || booking.guest?.email || booking.guest?.phone || "";
}

async function getCompanyTenantAccess(req, ownerId = "") {
  return getTenantAccessForRequest(req, ownerId ? { ownerIdOverride: ownerId } : {});
}

function serializeCompanyBooking(booking) {
  const snapshot = bookingServiceSnapshot(booking);
  const customerNotes = Array.isArray(booking.customerNotes) ? booking.customerNotes : [];
  const latestCustomerNote = customerNotes.length ? customerNotes[customerNotes.length - 1] : null;

  return {
    id: booking._id,
    _id: booking._id,
    tripId: snapshot.tripCatalogId || snapshot.tenantTripId || booking.tripId,
    code: bookingCodeFor(booking),
    customer: customerNameForBooking(booking),
    contact: customerContactForBooking(booking),
    service: snapshot.serviceName,
    seats: (booking.seats || []).map((seat) => seat.seatId).join(", "),
    seatIds: (booking.seats || []).map((seat) => seat.seatId),
    amount: booking.amount,
    currency: booking.currency,
    travelDate: booking.travelDate,
    status: booking.status,
    paymentStatus: booking.paymentStatus,
    paymentProvider: booking.paymentProvider || "",
    paymentRef: booking.paymentRef || "",
    paymentMethodNote: booking.paymentMethodNote || "",
    checkInStatus: booking.checkInStatus || "pending",
    checkedInAt: booking.checkedInAt || null,
    checkInNote: booking.checkInNote || "",
    cancellationReason: booking.cancellationReason || "",
    customerNoteCount: customerNotes.length,
    latestCustomerNote: latestCustomerNote?.text || "",
    createdAt: booking.createdAt
  };
}

function serializeTripOption(trip) {
  const route = trip.routeId || {};
  const vehicle = trip.vehicleId || {};
  return {
    id: trip._id,
    title: route.title || `${route.from || ""} to ${route.to || ""}`.trim() || "Scheduled service",
    departureAt: trip.departureAt,
    arriveAt: trip.arriveAt,
    currency: trip.currency,
    basePrice: trip.basePrice,
    totalSeats: Number(trip.totalSeats || 0),
    bookedSeats: Number(trip.bookedSeats || 0),
    heldSeats: Number(trip.heldSeats || 0),
    remainingSeats: Math.max(0, Number(trip.totalSeats || 0) - Number(trip.bookedSeats || 0) - Number(trip.heldSeats || 0)),
    vehicleName: vehicle.name || ""
  };
}

async function refreshTripCounts(models, tripId, session = null) {
  const { SeatBooking, SeatHold, Trip } = models;
  const [bookedSeats, heldSeats] = await Promise.all([
    withSession(SeatBooking.countDocuments({ tripId }), session),
    withSession(SeatHold.countDocuments({ tripId }), session)
  ]);

  await withSession(Trip.findByIdAndUpdate(tripId, { bookedSeats, heldSeats }), session);
  return { bookedSeats, heldSeats };
}

async function getCompany(ownerId) {
  return User.findById(ownerId).select([
    "name",
    "companyName",
    "businessType",
    "country",
    "companyCurrency",
    "payoutAccount",
    "supportMessage",
    "phone",
    "email",
    "status"
  ].join(" ")).lean();
}

async function tenantIdentitySnapshot(tenant) {
  const domains = tenant ? await listTenantDomains(tenant._id) : [];
  return {
    tenant: serializeTenantIdentity(tenant, domains),
    domains: domains.map(serializeTenantDomain),
    storefront: serializePublicTenantContext(tenant)
  };
}

function tenantBrandingSettingsFromBody(body = {}) {
  return {
    brandName: String(body.brandName || "").trim(),
    brandShortName: String(body.brandShortName || "").trim().toUpperCase(),
    supportEmail: String(body.supportEmail || "").trim().toLowerCase(),
    supportPhone: String(body.supportPhone || "").trim(),
    authTitle: String(body.authTitle || "").trim(),
    authSubtitle: String(body.authSubtitle || "").trim(),
    marketplaceTitle: String(body.marketplaceTitle || "").trim(),
    marketplaceSubtitle: String(body.marketplaceSubtitle || "").trim(),
    marketplaceIntro: String(body.marketplaceIntro || "").trim(),
    supportHeadline: String(body.supportHeadline || "").trim(),
    supportBlurb: String(body.supportBlurb || "").trim(),
    featureOneTitle: String(body.featureOneTitle || "").trim(),
    featureOneBody: String(body.featureOneBody || "").trim(),
    featureTwoTitle: String(body.featureTwoTitle || "").trim(),
    featureTwoBody: String(body.featureTwoBody || "").trim(),
    featureThreeTitle: String(body.featureThreeTitle || "").trim(),
    featureThreeBody: String(body.featureThreeBody || "").trim(),
    promoHeadline: String(body.promoHeadline || "").trim(),
    promoBody: String(body.promoBody || "").trim(),
    primaryColor: String(body.primaryColor || "").trim().toLowerCase(),
    accentColor: String(body.accentColor || "").trim().toLowerCase(),
    hotColor: String(body.hotColor || "").trim().toLowerCase()
  };
}

async function findOwnedBooking(ownerId, bookingId) {
  return Booking.findOne({ _id: bookingId, ownerId });
}

async function findStaffInvite(ownerId, inviteId) {
  const invite = await ensureStaffInviteStatus(await StaffInvite.findOne({
    _id: inviteId,
    ownerId
  }));
  if (!invite) {
    const err = new Error("Staff invite not found");
    err.statusCode = 404;
    throw err;
  }
  return invite;
}

async function findOwnedSupportCase(ownerId, supportId) {
  const bookings = await Booking.find({ ownerId }).select("userId guestLookupCode").lean();
  const customerIds = [...new Set(bookings.map((booking) => String(booking.userId || "")).filter(Boolean))];
  const bookingRefs = [...new Set(bookings.map((booking) => String(booking.guestLookupCode || "")).filter(Boolean))];
  const query = { _id: supportId };
  const or = [];
  if (customerIds.length) or.push({ userId: { $in: customerIds.map((value) => toObjectId(value)) } });
  if (bookingRefs.length) or.push({ bookingReference: { $in: bookingRefs } });
  if (!or.length) return null;
  query.$or = or;
  return SupportRequest.findOne(query);
}

async function loadSupportCases(ownerId, limit = 12) {
  const bookings = await Booking.find({ ownerId }).select("userId guestLookupCode").sort("-createdAt").limit(120).lean();
  const customerIds = [...new Set(bookings.map((booking) => String(booking.userId || "")).filter(Boolean))];
  const bookingRefs = [...new Set(bookings.map((booking) => String(booking.guestLookupCode || "")).filter(Boolean))];
  const or = [];
  if (customerIds.length) or.push({ userId: { $in: customerIds.map((value) => toObjectId(value)) } });
  if (bookingRefs.length) or.push({ bookingReference: { $in: bookingRefs } });
  if (!or.length) return [];

  const items = await SupportRequest.find({ $or: or })
    .sort("-createdAt")
    .limit(limit)
    .lean();

  return items.map(serializeSupportCase);
}

exports.staff = asyncHandler(async (req, res) => {
  const ownerId = resolveCompanyOwnerId(req.user, req.query.ownerId);
  const ownerObjectId = toObjectId(ownerId);

  const [company, employees, invites] = await Promise.all([
    getCompany(ownerId),
    User.find({ companyId: ownerObjectId, role: "company_employee" })
      .select("name email phone status jobTitle permissionsLabel createdAt updatedAt")
      .sort("-createdAt")
      .lean(),
    StaffInvite.find({ ownerId })
      .sort("-createdAt")
      .limit(25)
  ]);

  const normalizedInvites = [];
  for (const invite of invites) {
    const normalized = await ensureStaffInviteStatus(invite);
    normalizedInvites.push(staffInviteSummary(normalized));
  }

  res.json({
    ok: true,
    company,
    employees: employees.map(serializeEmployee),
    invites: normalizedInvites
  });
});

exports.createStaffInvite = asyncHandler(async (req, res) => {
  const ownerId = resolveCompanyOwnerId(req.user, req.query.ownerId);
  const ownerObjectId = toObjectId(ownerId);
  const { tenant } = await getCompanyTenantAccess(req, ownerId);
  const company = await User.findById(ownerId).select("name companyName businessType country").lean();
  if (!company) return res.status(404).json({ ok: false, message: "Company not found" });

  const {
    name,
    email,
    phone = "",
    jobTitle,
    permissionsLabel,
    notes = ""
  } = req.validated?.body || req.body;

  const existingUser = await User.findOne({ email: String(email).toLowerCase().trim() }).select("companyId role");
  if (existingUser) {
    return res.status(409).json({ ok: false, message: "A user already exists for this email" });
  }

  await StaffInvite.updateMany(
    {
      ownerId: ownerObjectId,
      email: String(email).toLowerCase().trim(),
      status: "pending"
    },
    {
      $set: {
        status: "revoked",
        revokedAt: new Date()
      }
    }
  );

  const { rawToken, tokenHash } = buildStaffInviteToken();
  const invite = await StaffInvite.create({
    ownerId: ownerObjectId,
    tenantId: tenant?._id || null,
    tenantSlug: tenant?.slug || "",
    invitedByUserId: req.user.userId,
    email: String(email).toLowerCase().trim(),
    name,
    phone: String(phone || "").trim(),
    jobTitle,
    permissionsLabel,
    notes,
    tokenHash,
    sentAt: new Date(),
    lastSentAt: new Date(),
    expiresAt: new Date(Date.now() + STAFF_INVITE_DAYS * 24 * 60 * 60 * 1000)
  });

  const delivery = buildStaffInviteDelivery(invite, rawToken, company);

  res.status(201).json({
    ok: true,
    invite: staffInviteSummary(invite),
    delivery
  });
});

exports.resendStaffInvite = asyncHandler(async (req, res) => {
  const ownerId = resolveCompanyOwnerId(req.user, req.query.ownerId);
  const company = await User.findById(ownerId).select("name companyName").lean();
  const invite = await findStaffInvite(ownerId, req.params.id);

  if (invite.status === "accepted") {
    return res.status(409).json({ ok: false, message: "This invite has already been accepted" });
  }
  if (invite.status === "revoked") {
    return res.status(409).json({ ok: false, message: "This invite has been revoked" });
  }

  const { rawToken, tokenHash } = buildStaffInviteToken();
  invite.tokenHash = tokenHash;
  invite.status = "pending";
  invite.lastSentAt = new Date();
  invite.expiresAt = new Date(Date.now() + STAFF_INVITE_DAYS * 24 * 60 * 60 * 1000);
  await invite.save();

  res.json({
    ok: true,
    invite: staffInviteSummary(invite),
    delivery: buildStaffInviteDelivery(invite, rawToken, company)
  });
});

exports.revokeStaffInvite = asyncHandler(async (req, res) => {
  const ownerId = resolveCompanyOwnerId(req.user, req.query.ownerId);
  const invite = await findStaffInvite(ownerId, req.params.id);

  if (invite.status === "accepted") {
    return res.status(409).json({ ok: false, message: "Accepted invites cannot be revoked" });
  }

  invite.status = "revoked";
  invite.revokedAt = new Date();
  await invite.save();

  res.json({ ok: true, invite: staffInviteSummary(invite) });
});

exports.setStaffStatus = asyncHandler(async (req, res) => {
  const ownerId = resolveCompanyOwnerId(req.user, req.query.ownerId);
  const ownerObjectId = toObjectId(ownerId);
  const { status } = req.validated?.body || req.body;

  const employee = await User.findOne({
    _id: req.params.id,
    companyId: ownerObjectId,
    role: "company_employee"
  });

  if (!employee) {
    return res.status(404).json({ ok: false, message: "Staff member not found" });
  }

  employee.status = status;
  await employee.save();

  res.json({ ok: true, employee: serializeEmployee(employee) });
});

exports.settings = asyncHandler(async (req, res) => {
  const ownerId = resolveCompanyOwnerId(req.user, req.query.ownerId);
  const { tenant } = await getCompanyTenantAccess(req, ownerId);
  const [company, wallet, identity] = await Promise.all([
    getCompany(ownerId),
    getOrCreateWallet(ownerId, "UGX"),
    tenantIdentitySnapshot(tenant)
  ]);

  if (!company) return res.status(404).json({ ok: false, message: "Company not found" });

  res.json({ ok: true, company, wallet, ...identity });
});

exports.updateSettings = asyncHandler(async (req, res) => {
  const ownerId = resolveCompanyOwnerId(req.user, req.query.ownerId);
  const ownerObjectId = toObjectId(ownerId);
  const body = req.validated?.body || req.body;
  const { tenant } = await getCompanyTenantAccess(req, ownerId);

  const updatePatch = {
    companyName: body.companyName,
    businessType: body.businessType,
    country: body.country,
    companyCurrency: body.companyCurrency || "UGX",
    payoutAccount: body.payoutAccount || "",
    supportMessage: body.supportMessage || "",
    phone: body.phone || ""
  };
  const brandingSettings = tenantBrandingSettingsFromBody(body);

  const [company, tenantDoc] = await Promise.all([
    User.findByIdAndUpdate(
      ownerId,
      { $set: updatePatch },
      { returnDocument: "after" }
    ).select("name companyName businessType country companyCurrency payoutAccount supportMessage phone email status"),
    tenant?._id ? Tenant.findById(tenant._id) : Promise.resolve(null)
  ]);

  await Promise.all([
    User.updateMany(
      { companyId: ownerObjectId, role: "company_employee" },
      {
        $set: {
          companyName: updatePatch.companyName,
          businessType: updatePatch.businessType,
          country: updatePatch.country,
          companyCurrency: updatePatch.companyCurrency
        }
      }
    ),
    tenantDoc
      ? Tenant.findByIdAndUpdate(
          tenantDoc._id,
          {
            $set: {
              name: updatePatch.companyName,
              businessType: updatePatch.businessType,
              country: updatePatch.country,
              currency: updatePatch.companyCurrency,
              phone: updatePatch.phone,
              timezone: body.timezone || tenantDoc.timezone || "Africa/Kampala",
              settings: {
                ...(tenantDoc.settings?.toObject ? tenantDoc.settings.toObject() : tenantDoc.settings || {}),
                ...brandingSettings
              }
            }
          },
          { returnDocument: "after" }
        )
      : Promise.resolve(null)
  ]);

  const refreshedAccess = await getCompanyTenantAccess(req, ownerId);
  if (refreshedAccess.tenant) {
    await syncTenantCatalogByOwner({ tenant: refreshedAccess.tenant, ownerUserId: ownerId });
  }
  const identity = await tenantIdentitySnapshot(refreshedAccess.tenant);

  res.json({ ok: true, company, ...identity });
});

exports.createDomain = asyncHandler(async (req, res) => {
  const ownerId = resolveCompanyOwnerId(req.user, req.query.ownerId);
  const { tenant } = await getCompanyTenantAccess(req, ownerId);
  const { hostname } = req.validated?.body || req.body;

  const result = await createTenantDomain({ tenant, hostname });
  const identity = await tenantIdentitySnapshot(result.tenant);

  res.status(201).json({
    ok: true,
    domain: serializeTenantDomain(result.domain),
    ...identity
  });
});

exports.verifyDomain = asyncHandler(async (req, res) => {
  const ownerId = resolveCompanyOwnerId(req.user, req.query.ownerId);
  const { tenant } = await getCompanyTenantAccess(req, ownerId);
  const { makePrimary = false } = req.validated?.body || req.body;

  const result = await verifyTenantDomain({
    tenant,
    domainId: req.params.id,
    makePrimary: Boolean(makePrimary)
  });
  const identity = await tenantIdentitySnapshot(result.tenant);

  res.json({
    ok: true,
    domain: serializeTenantDomain(result.domain),
    ...identity
  });
});

exports.removeDomain = asyncHandler(async (req, res) => {
  const ownerId = resolveCompanyOwnerId(req.user, req.query.ownerId);
  const { tenant } = await getCompanyTenantAccess(req, ownerId);

  const result = await removeTenantDomain({
    tenant,
    domainId: req.params.id
  });
  const identity = await tenantIdentitySnapshot(result.tenant);

  res.json({
    ok: true,
    removedDomainId: result.removedDomainId,
    ...identity
  });
});

exports.updateRoute = asyncHandler(async (req, res) => {
  const ownerId = resolveCompanyOwnerId(req.user, req.query.ownerId);
  const body = req.validated?.body || req.body;
  const { tenant, models } = await getCompanyTenantAccess(req, ownerId);
  const route = await models.Route.findOne({ _id: req.params.id, ownerId });
  if (!route) return res.status(404).json({ ok: false, message: "Listing not found" });

  const patch = { ...body };
  if (Object.prototype.hasOwnProperty.call(body, "amenities")) {
    patch.amenities = body.amenities
      ? String(body.amenities).split(",").map((item) => item.trim()).filter(Boolean)
      : [];
  }

  Object.assign(route, patch);
  await route.save();

  if (tenant) {
    await syncTripCatalogsByRoute({ tenant, models, routeId: route._id });
  }

  res.json({ ok: true, route });
});

exports.updateVehicle = asyncHandler(async (req, res) => {
  const ownerId = resolveCompanyOwnerId(req.user, req.query.ownerId);
  const body = req.validated?.body || req.body;
  const { tenant, models } = await getCompanyTenantAccess(req, ownerId);
  const vehicle = await models.Vehicle.findOne({ _id: req.params.id, ownerId });
  if (!vehicle) return res.status(404).json({ ok: false, message: "Inventory item not found" });

  Object.assign(vehicle, body);
  await vehicle.save();

  if (tenant) {
    await syncTripCatalogsByVehicle({ tenant, models, vehicleId: vehicle._id });
  }

  res.json({ ok: true, vehicle });
});

exports.updateTrip = asyncHandler(async (req, res) => {
  const ownerId = resolveCompanyOwnerId(req.user, req.query.ownerId);
  const body = req.validated?.body || req.body;
  const { tenant, models } = await getCompanyTenantAccess(req, ownerId);
  const trip = await models.Trip.findOne({ _id: req.params.id, ownerId });
  if (!trip) return res.status(404).json({ ok: false, message: "Schedule not found" });

  if (body.departureAt) trip.departureAt = new Date(body.departureAt);
  if (Object.prototype.hasOwnProperty.call(body, "arriveAt")) {
    trip.arriveAt = body.arriveAt ? new Date(body.arriveAt) : null;
  }
  if (body.basePrice != null) trip.basePrice = Number(body.basePrice);
  if (body.currency) trip.currency = body.currency;
  if (body.status) trip.status = body.status;
  await trip.save();

  if (tenant) {
    await syncTripCatalogByTrip({ tenant, models, tripId: trip._id });
  }

  res.json({ ok: true, trip });
});

exports.createNotice = asyncHandler(async (req, res) => {
  const ownerId = resolveCompanyOwnerId(req.user, req.query.ownerId);
  const body = req.validated?.body || req.body;
  const { models } = await getCompanyTenantAccess(req, ownerId);

  if (body.tripId) {
    const trip = await models.Trip.findOne({ _id: body.tripId, ownerId });
    if (!trip) return res.status(404).json({ ok: false, message: "Selected trip was not found" });
  }

  const notice = await models.CompanyNotice.create({
    ownerId: toObjectId(ownerId),
    createdByUserId: req.user.userId,
    tripId: body.tripId || null,
    audience: body.audience,
    priority: body.priority,
    message: body.message
  });

  res.status(201).json({ ok: true, notice: serializeNotice(notice) });
});

exports.notices = asyncHandler(async (req, res) => {
  const ownerId = resolveCompanyOwnerId(req.user, req.query.ownerId);
  const { models } = await getCompanyTenantAccess(req, ownerId);
  const items = await models.CompanyNotice.find({ ownerId }).sort("-createdAt").limit(40).lean();
  res.json({ ok: true, items: items.map(serializeNotice) });
});

exports.createPayoutRequest = asyncHandler(async (req, res) => {
  const ownerId = resolveCompanyOwnerId(req.user, req.query.ownerId);
  const body = req.validated?.body || req.body;
  const { models } = await getCompanyTenantAccess(req, ownerId);
  const wallet = await getOrCreateWallet(ownerId, body.currency || "UGX");

  if (Number(body.amount || 0) > Number(wallet.balance || 0)) {
    return res.status(400).json({ ok: false, message: "Requested payout exceeds the available company wallet balance" });
  }

  const payoutRequest = await models.CompanyPayoutRequest.create({
    ownerId: toObjectId(ownerId),
    createdByUserId: req.user.userId,
    amount: Number(body.amount || 0),
    currency: body.currency || wallet.currency || "UGX",
    destination: body.destination,
    note: body.note || ""
  });

  res.status(201).json({ ok: true, payoutRequest: serializePayoutRequest(payoutRequest) });
});

exports.payoutRequests = asyncHandler(async (req, res) => {
  const ownerId = resolveCompanyOwnerId(req.user, req.query.ownerId);
  const { models } = await getCompanyTenantAccess(req, ownerId);
  const items = await models.CompanyPayoutRequest.find({ ownerId }).sort("-createdAt").limit(40).lean();
  res.json({ ok: true, items: items.map(serializePayoutRequest) });
});

exports.supportCases = asyncHandler(async (req, res) => {
  const ownerId = resolveCompanyOwnerId(req.user, req.query.ownerId);
  const items = await loadSupportCases(ownerId, 24);
  res.json({ ok: true, items });
});

exports.updateSupportCase = asyncHandler(async (req, res) => {
  const ownerId = resolveCompanyOwnerId(req.user, req.query.ownerId);
  const supportCase = await findOwnedSupportCase(ownerId, req.params.id);
  if (!supportCase) return res.status(404).json({ ok: false, message: "Support case not found" });

  const body = req.validated?.body || req.body;
  supportCase.status = body.status;
  if (body.notes != null) supportCase.notes = body.notes;
  await supportCase.save();

  res.json({ ok: true, supportCase: serializeSupportCase(supportCase) });
});

exports.lookupBookings = asyncHandler(async (req, res) => {
  const ownerId = resolveCompanyOwnerId(req.user, req.query.ownerId);
  const q = normalizeText(req.validated?.query?.q || req.query.q || "");
  const tripId = String(req.validated?.query?.tripId || req.query.tripId || "").trim();
  const limit = Number(req.validated?.query?.limit || req.query.limit || 12);

  const filter = { ownerId };
  if (tripId) filter.tripId = tripId;

  const items = await Booking.find(filter)
    .populate("userId", "name email phone")
    .sort("-createdAt")
    .limit(Math.max(40, limit * 4))
    .lean();

  const filtered = !q
    ? items
    : items.filter((booking) => {
        const snapshot = bookingServiceSnapshot(booking);
        const haystack = [
          bookingCodeFor(booking),
          customerNameForBooking(booking),
          customerContactForBooking(booking),
          (booking.seats || []).map((seat) => seat.seatId).join(" "),
          snapshot.serviceName,
          snapshot.serviceFrom,
          snapshot.serviceTo
        ]
          .map(normalizeText)
          .join(" ");

        return haystack.includes(q);
      });

  res.json({
    ok: true,
    items: filtered.slice(0, limit).map(serializeCompanyBooking)
  });
});

exports.manualBooking = asyncHandler(async (req, res) => {
  const ownerId = resolveCompanyOwnerId(req.user, req.query.ownerId);
  const { tenant, models } = await getCompanyTenantAccess(req, ownerId);
  const { Route, SeatBooking, SeatHold, Trip, Vehicle } = models;
  const {
    tripId,
    seats,
    guest,
    paymentState = "pending_payment",
    paymentMethod = "cash",
    paymentReference = "",
    note = ""
  } = req.validated?.body || req.body;

  const seatIds = cleanSeats(seats);
  const trip = await Trip.findOne({ _id: tripId, ownerId });
  if (!trip || trip.status !== "scheduled") {
    return res.status(404).json({ ok: false, message: "Trip not available" });
  }

  const [vehicle, route] = await Promise.all([
    Vehicle.findById(trip.vehicleId),
    Route.findById(trip.routeId)
  ]);

  if (!vehicle) {
    return res.status(404).json({ ok: false, message: "Vehicle not found for this trip" });
  }

  const knownSeatIds = new Set((vehicle.seats || []).map((seat) => String(seat.id || "").trim()).filter(Boolean));
  const invalidSeats = knownSeatIds.size ? seatIds.filter((seatId) => !knownSeatIds.has(seatId)) : [];
  if (invalidSeats.length) {
    return res.status(400).json({ ok: false, message: `Invalid seat selection: ${invalidSeats.join(", ")}` });
  }

  const [bookedCount, heldCount] = await Promise.all([
    SeatBooking.countDocuments({ tripId: trip._id, seatId: { $in: seatIds } }),
    SeatHold.countDocuments({ tripId: trip._id, seatId: { $in: seatIds } })
  ]);

  if (bookedCount) {
    return res.status(409).json({ ok: false, message: "Some selected seats are already booked" });
  }
  if (heldCount) {
    return res.status(409).json({ ok: false, message: "Some selected seats are temporarily held. Please choose different seats." });
  }

  const bookingId = new Booking()._id;
  const amount = Number(trip.basePrice || 0) * seatIds.length;
  const isPaid = paymentState === "paid";
  const providerReference = String(paymentReference || "").trim() || makeManualProviderReference(isPaid ? "PAY" : "BOOK");

  let booking;
  let payment = null;

  try {
    await SeatBooking.create(
      seatIds.map((seatId) => ({ tripId: trip._id, seatId, bookingId }))
    );

    booking = await Booking.create({
      _id: bookingId,
      userId: null,
      guest: {
        name: String(guest?.name || "").trim(),
        email: String(guest?.email || "").trim().toLowerCase(),
        phone: String(guest?.phone || "").trim()
      },
      guestLookupCode: makeLookupCode(),
      ownerId: trip.ownerId,
      tenantId: tenant?._id || null,
      tenantSlug: tenant?.slug || "",
      tripId: trip._id,
      serviceName: route?.title || "Trip",
      serviceType: route?.type || "bus",
      serviceFrom: route?.from || route?.city || "",
      serviceTo: route?.to || route?.city || "",
      serviceAddress: route?.address || "",
      vehicleName: vehicle.name || "",
      travelDate: trip.departureAt,
      seats: seatIds.map((seatId) => ({ seatId, price: trip.basePrice })),
      quantity: seatIds.length,
      amount,
      grossAmount: amount,
      currency: trip.currency,
      status: isPaid ? "confirmed" : "pending_payment",
      paymentStatus: isPaid ? "paid" : "pending",
      paymentProvider: isPaid ? paymentMethod : "none",
      paymentRef: isPaid ? providerReference : "",
      paymentMethodNote: String(note || "").trim(),
      customerNotes: note
        ? [{
            text: String(note).trim(),
            createdAt: new Date(),
            createdByUserId: req.user.userId
          }]
        : [],
      settlementStatus: "pending"
    });

    if (isPaid) {
      payment = await Payment.create({
        bookingId: booking._id,
        userId: null,
        ownerId: booking.ownerId,
        provider: "mock",
        providerReference,
        amount: booking.amount,
        currency: booking.currency,
        status: "succeeded",
        paidAt: new Date(),
        metadata: {
          source: "tenant_manual_booking",
          method: paymentMethod,
          note: String(note || "").trim()
        }
      });

      await settleBookingPayouts(booking);
      await booking.save();
    }
  } catch (error) {
    await SeatBooking.deleteMany({ bookingId }).catch(() => {});
    await refreshTripCounts(models, trip._id).catch(() => {});
    if (tenant) {
      await syncTripCatalogByTrip({ tenant, models, tripId: trip._id }).catch(() => {});
    }
    throw error;
  }

  await refreshTripCounts(models, trip._id);
  if (tenant) {
    await syncTripCatalogByTrip({ tenant, models, tripId: trip._id });
  }

  const result = {
    booking: serializeCompanyBooking(booking),
    payment,
    trip: serializeTripOption({
      ...trip.toObject(),
      routeId: route ? route.toObject() : {},
      vehicleId: vehicle.toObject()
    })
  };

  res.status(201).json({ ok: true, ...result });
});

exports.recordBookingPayment = asyncHandler(async (req, res) => {
  const ownerId = resolveCompanyOwnerId(req.user, req.query.ownerId);
  const { method, reference = "", note = "" } = req.validated?.body || req.body;

  const booking = await findOwnedBooking(ownerId, req.params.id);
  if (!booking) return res.status(404).json({ ok: false, message: "Booking not found" });
  if (["cancelled", "refunded"].includes(String(booking.status || "").toLowerCase())) {
    return res.status(409).json({ ok: false, message: "This booking cannot accept a payment because it is already cancelled or refunded" });
  }
  if (booking.paymentStatus === "paid" && booking.status === "confirmed") {
    return res.json({ ok: true, booking, alreadyPaid: true });
  }

  const result = await runWithOptionalTransaction(async (session) => {
    const liveBooking = await withSession(Booking.findById(booking._id), session);
    let payment = await withSession(Payment.findOne({ bookingId: liveBooking._id }).sort("-createdAt"), session);

    if (!payment) {
      const [createdPayment] = await Payment.create([{
        bookingId: liveBooking._id,
        userId: liveBooking.userId || null,
        ownerId: liveBooking.ownerId,
        provider: "mock",
        providerReference: reference || makeManualProviderReference("PAY"),
        amount: liveBooking.amount,
        currency: liveBooking.currency,
        status: "pending",
        metadata: {
          source: "tenant_cashier",
          method,
          note
        }
      }], createOptions(session));
      payment = createdPayment;
    }

    payment.providerReference = reference || payment.providerReference || makeManualProviderReference("PAY");
    payment.status = "succeeded";
    payment.paidAt = new Date();
    payment.failureReason = "";
    payment.metadata = {
      ...(payment.metadata || {}),
      source: "tenant_cashier",
      method,
      note
    };

    liveBooking.status = "confirmed";
    liveBooking.paymentStatus = "paid";
    liveBooking.paymentProvider = method;
    liveBooking.paymentRef = payment.providerReference;
    liveBooking.paymentMethodNote = note || "";
    liveBooking.cancellationReason = "";
    liveBooking.cancelledAt = null;
    liveBooking.cancelledByUserId = null;

    await settleBookingPayouts(liveBooking, session);

    await Promise.all([
      payment.save(createOptions(session)),
      liveBooking.save(createOptions(session))
    ]);

    return { booking: liveBooking, payment };
  });

  res.json({ ok: true, booking: result.booking, payment: result.payment });
});

exports.checkInBooking = asyncHandler(async (req, res) => {
  const ownerId = resolveCompanyOwnerId(req.user, req.query.ownerId);
  const { action, note = "" } = req.validated?.body || req.body;

  const booking = await findOwnedBooking(ownerId, req.params.id);
  if (!booking) return res.status(404).json({ ok: false, message: "Booking not found" });
  if (["cancelled", "refunded"].includes(String(booking.status || "").toLowerCase())) {
    return res.status(409).json({ ok: false, message: "Cancelled or refunded bookings cannot be updated from check-in" });
  }

  if (action === "check_in" && !(booking.status === "confirmed" && booking.paymentStatus === "paid")) {
    return res.status(409).json({ ok: false, message: "Only paid confirmed bookings can be checked in" });
  }

  booking.checkInStatus = action === "check_in" ? "checked_in" : "no_show";
  booking.checkedInAt = new Date();
  booking.checkedInByUserId = req.user.userId;
  booking.checkInNote = String(note || "").trim();
  await booking.save();

  res.json({ ok: true, booking });
});

exports.moveBookingSeat = asyncHandler(async (req, res) => {
  const ownerId = resolveCompanyOwnerId(req.user, req.query.ownerId);
  const { models } = await getCompanyTenantAccess(req, ownerId);
  const { SeatBooking, SeatHold, Trip, Vehicle } = models;
  const { fromSeatId, toSeatId, note = "" } = req.validated?.body || req.body;

  const booking = await findOwnedBooking(ownerId, req.params.id);
  if (!booking) return res.status(404).json({ ok: false, message: "Booking not found" });
  if (["cancelled", "refunded"].includes(String(booking.status || "").toLowerCase())) {
    return res.status(409).json({ ok: false, message: "Cancelled or refunded bookings cannot be moved" });
  }

  const liveBooking = await Booking.findById(booking._id);
  const trip = await Trip.findById(liveBooking.tripId);
  if (!trip) {
    return res.status(404).json({ ok: false, message: "Trip not found for this booking" });
  }

  const vehicle = await Vehicle.findById(trip.vehicleId);
  if (!vehicle) {
    return res.status(404).json({ ok: false, message: "Vehicle not found for this booking" });
  }

  const sourceSeat = (liveBooking.seats || []).find((seat) => String(seat.seatId) === String(fromSeatId));
  if (!sourceSeat) {
    return res.status(400).json({ ok: false, message: "The selected source seat is not part of this booking" });
  }

  const knownSeatIds = new Set((vehicle.seats || []).map((seat) => String(seat.id || "").trim()).filter(Boolean));
  if (knownSeatIds.size && !knownSeatIds.has(String(toSeatId))) {
    return res.status(400).json({ ok: false, message: "The target seat does not exist on this vehicle" });
  }

  if (String(fromSeatId) !== String(toSeatId)) {
    const [occupied, held] = await Promise.all([
      SeatBooking.countDocuments({ tripId: trip._id, seatId: toSeatId, bookingId: { $ne: liveBooking._id } }),
      SeatHold.countDocuments({ tripId: trip._id, seatId: toSeatId })
    ]);

    if (occupied) {
      return res.status(409).json({ ok: false, message: "The target seat is already booked" });
    }
    if (held) {
      return res.status(409).json({ ok: false, message: "The target seat is currently held. Please choose another seat." });
    }

    const seatBooking = await SeatBooking.findOne({
      tripId: trip._id,
      bookingId: liveBooking._id,
      seatId: fromSeatId
    });

    if (!seatBooking) {
      return res.status(404).json({ ok: false, message: "Seat allocation record not found" });
    }

    seatBooking.seatId = toSeatId;
    await seatBooking.save();
    sourceSeat.seatId = toSeatId;
  }

  if (note) {
    liveBooking.customerNotes.push({
      text: `Seat moved from ${fromSeatId} to ${toSeatId}. ${String(note).trim()}`.trim(),
      createdAt: new Date(),
      createdByUserId: req.user.userId
    });
  }

  await liveBooking.save();
  const result = liveBooking;

  res.json({ ok: true, booking: result });
});

exports.refundBooking = asyncHandler(async (req, res) => {
  const ownerId = resolveCompanyOwnerId(req.user, req.query.ownerId);
  const { tenant, models } = await getCompanyTenantAccess(req, ownerId);
  const { SeatBooking, Trip } = models;
  const { reason } = req.validated?.body || req.body;

  const booking = await findOwnedBooking(ownerId, req.params.id);
  if (!booking) return res.status(404).json({ ok: false, message: "Booking not found" });
  if (["cancelled", "refunded"].includes(String(booking.status || "").toLowerCase())) {
    return res.status(409).json({ ok: false, message: "This booking has already been refunded or cancelled" });
  }
  if (!(booking.paymentStatus === "paid" && booking.status === "confirmed")) {
    return res.status(409).json({ ok: false, message: "Only paid confirmed bookings can be refunded from the company dashboard" });
  }

  const liveBooking = await Booking.findById(booking._id);
  const payment = await Payment.findOne({ bookingId: liveBooking._id }).sort("-createdAt");

  liveBooking.status = "refunded";
  liveBooking.paymentStatus = "refunded";
  liveBooking.cancellationReason = reason;
  liveBooking.cancelledAt = new Date();
  liveBooking.cancelledByUserId = req.user.userId;

  await reverseBookingPayouts(liveBooking);

  if (payment) {
    payment.status = "refunded";
    payment.failureReason = reason;
    payment.metadata = {
      ...(payment.metadata || {}),
      refundedBy: req.user.userId,
      refundReason: reason,
      refundSource: "tenant_cashier"
    };
    await payment.save();
  }

  await SeatBooking.deleteMany({ bookingId: liveBooking._id });

  const trip = await Trip.findById(liveBooking.tripId);
  if (trip) {
    await refreshTripCounts(models, trip._id);
    if (tenant) {
      await syncTripCatalogByTrip({ tenant, models, tripId: trip._id });
    }
  }

  await liveBooking.save();
  const result = { booking: liveBooking, payment };

  res.json({ ok: true, booking: result.booking, payment: result.payment || null });
});

exports.addCustomerNote = asyncHandler(async (req, res) => {
  const ownerId = resolveCompanyOwnerId(req.user, req.query.ownerId);
  const { note } = req.validated?.body || req.body;

  const booking = await findOwnedBooking(ownerId, req.params.id);
  if (!booking) return res.status(404).json({ ok: false, message: "Booking not found" });

  booking.customerNotes.push({
    text: String(note).trim(),
    createdAt: new Date(),
    createdByUserId: req.user.userId
  });
  await booking.save();

  const latestCustomerNote = booking.customerNotes[booking.customerNotes.length - 1] || null;
  res.json({
    ok: true,
    booking,
    latestCustomerNote
  });
});

exports.reviews = asyncHandler(async (req, res) => {
  const ownerId = resolveCompanyOwnerId(req.user, req.query.ownerId);
  const { models } = await getCompanyTenantAccess(req, ownerId);
  const routeIds = await models.Route.find({ ownerId }).select("_id").lean();
  const items = await Review.find({ routeId: { $in: routeIds.map((route) => route._id) } })
    .populate("routeId", "title type")
    .populate("userId", "name")
    .sort("-createdAt")
    .limit(40)
    .lean();

  res.json({
    ok: true,
    items: items.map((item) => ({
      id: item._id,
      routeTitle: item.routeId?.title || "Listing",
      routeType: item.routeId?.type || "",
      customer: item.userId?.name || "Customer",
      rating: item.rating,
      comment: item.comment || "",
      createdAt: item.createdAt
    }))
  });
});

exports.report = asyncHandler(async (req, res) => {
  const ownerId = resolveCompanyOwnerId(req.user, req.query.ownerId);
  const ownerObjectId = toObjectId(ownerId);
  const type = String(req.params.type || "summary").trim().toLowerCase();
  const { models } = await getCompanyTenantAccess(req, ownerId);

  const [company, routes, vehicles, trips, bookings, employees, invites, notices, payoutRequests, supportCases] = await Promise.all([
    getCompany(ownerId),
    models.Route.find({ ownerId }).sort("-createdAt").lean(),
    models.Vehicle.find({ ownerId }).sort("-createdAt").lean(),
    models.Trip.find({ ownerId }).sort("-departureAt").lean(),
    Booking.find({ ownerId }).sort("-createdAt").limit(200).lean(),
    User.find({ companyId: ownerObjectId, role: "company_employee" }).sort("-createdAt").lean(),
    StaffInvite.find({ ownerId }).sort("-createdAt").limit(100).lean(),
    models.CompanyNotice.find({ ownerId }).sort("-createdAt").limit(100).lean(),
    models.CompanyPayoutRequest.find({ ownerId }).sort("-createdAt").limit(100).lean(),
    loadSupportCases(ownerId, 100)
  ]);
  const reviews = await Review.find({ routeId: { $in: routes.map((route) => route._id) } }).sort("-createdAt").limit(200).lean();

  const payload = {
    type,
    exportedAt: new Date().toISOString(),
    company,
    data: {
      routes,
      vehicles,
      trips,
      bookings,
      employees,
      invites: invites.map(staffInviteSummary),
      notices: notices.map(serializeNotice),
      payoutRequests: payoutRequests.map(serializePayoutRequest),
      supportCases,
      reviews
    }
  };

  res.json({ ok: true, report: payload });
});
