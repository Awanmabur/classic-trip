const mongoose = require("mongoose");

const { APP_URL } = require("../../config/app");
const { randomToken, sha256 } = require("../../utils/auth");

function toObjectId(value) {
  return new mongoose.Types.ObjectId(String(value));
}

function resolveCompanyOwnerId(user, ownerIdOverride = "") {
  if ((user.role === "admin" || user.role === "super_admin") && ownerIdOverride) {
    return String(ownerIdOverride);
  }
  return String(user.companyId || user.userId);
}

function buildStaffInviteToken() {
  const rawToken = randomToken(24);
  return {
    rawToken,
    tokenHash: sha256(rawToken)
  };
}

async function ensureStaffInviteStatus(invite) {
  if (!invite) return null;
  if (invite.status === "pending" && invite.expiresAt && invite.expiresAt < new Date()) {
    invite.status = "expired";
    await invite.save();
  }
  return invite;
}

function staffInviteSummary(invite) {
  return {
    id: invite._id,
    ownerId: invite.ownerId,
    name: invite.name,
    email: invite.email,
    phone: invite.phone,
    jobTitle: invite.jobTitle,
    permissionsLabel: invite.permissionsLabel,
    notes: invite.notes,
    role: "company_employee",
    status: invite.status,
    sentAt: invite.sentAt,
    lastSentAt: invite.lastSentAt,
    expiresAt: invite.expiresAt,
    acceptedAt: invite.acceptedAt
  };
}

function buildStaffInviteDelivery(invite, rawToken, company) {
  const inviteUrl = `${APP_URL.replace(/\/$/, "")}/invite/${rawToken}`;
  const companyName = company?.companyName || company?.name || "your company";
  const subject = `Classic Trip staff invite for ${companyName}`;
  const emailCopy = [
    `Hello ${invite.name || "team member"},`,
    "",
    `You have been invited to join ${companyName} on Classic Trip as ${invite.jobTitle || "company staff"}.`,
    `Invite link: ${inviteUrl}`,
    `Access expires: ${new Date(invite.expiresAt).toLocaleString()}`,
    "",
    "Use the secure invite link to create your account."
  ].join("\n");

  const whatsappCopy = [
    `Classic Trip invite for ${companyName}`,
    `Role: ${invite.jobTitle || "company staff"}`,
    `Permissions: ${invite.permissionsLabel || "Operations"}`,
    `Link: ${inviteUrl}`
  ].join("\n");

  return {
    inviteUrl,
    subject,
    emailCopy,
    whatsappCopy
  };
}

module.exports = {
  buildStaffInviteDelivery,
  buildStaffInviteToken,
  ensureStaffInviteStatus,
  resolveCompanyOwnerId,
  staffInviteSummary,
  toObjectId
};
