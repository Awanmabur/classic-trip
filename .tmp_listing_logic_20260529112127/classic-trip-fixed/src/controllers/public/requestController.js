const { asyncHandler } = require("../../middleware/http");
const { User } = require("../../models/shared");
const { PartnerInquiry, RecoveryRequest, SupportRequest } = require("../../models/public");

function normalizeIdentity(identity) {
  return String(identity || "").trim();
}

async function matchUser(identity) {
  const normalized = normalizeIdentity(identity);
  if (!normalized) return null;

  if (normalized.includes("@")) {
    return User.findOne({ email: normalized.toLowerCase() }).select("_id email phone").lean();
  }

  return User.findOne({ phone: normalized }).select("_id email phone").lean();
}

exports.createSupportRequest = asyncHandler(async (req, res) => {
  const body = req.validated?.body || req.body;

  const ticket = await SupportRequest.create({
    userId: req.user?.userId || null,
    name: body.name,
    contact: body.contact,
    topic: body.topic,
    bookingReference: body.bookingReference || "",
    message: body.message,
    source: "public_auth"
  });

  res.status(201).json({
    ok: true,
    ticket: {
      id: ticket._id,
      status: ticket.status,
      topic: ticket.topic,
      createdAt: ticket.createdAt
    },
    message: "Support request received. Our team will review it shortly."
  });
});

exports.createPartnerInquiry = asyncHandler(async (req, res) => {
  const body = req.validated?.body || req.body;

  const inquiry = await PartnerInquiry.create({
    userId: req.user?.userId || null,
    companyName: body.companyName,
    businessType: body.businessType,
    country: body.country,
    contactName: body.contactName,
    email: body.email,
    phone: body.phone,
    source: "public_auth"
  });

  res.status(201).json({
    ok: true,
    inquiry: {
      id: inquiry._id,
      status: inquiry.status,
      companyName: inquiry.companyName,
      createdAt: inquiry.createdAt
    },
    message: "Partner request received. We will contact you after review."
  });
});

exports.createRecoveryRequest = asyncHandler(async (req, res) => {
  const body = req.validated?.body || req.body;
  const identity = normalizeIdentity(body.identity);
  const user = await matchUser(identity);

  await RecoveryRequest.create({
    userId: user?._id || null,
    identity,
    email: user?.email || (identity.includes("@") ? identity.toLowerCase() : ""),
    phone: user?.phone || (!identity.includes("@") ? identity : ""),
    source: "public_auth"
  });

  res.status(201).json({
    ok: true,
    message: "Recovery request received. If the account exists, the reset flow can continue from support."
  });
});
