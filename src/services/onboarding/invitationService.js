const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const store = require('../data/persistentStore');
const walletService = require('../wallet/walletService');
const notificationService = require('../notification/notificationService');
const verificationService = require('./verificationService');
const { mongoose } = require('../../config/db');

function cleanText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

function normalize(value) {
  return cleanText(value).toLowerCase();
}

function ensureCollections() {
  if (!Array.isArray(store.state.invitations)) store.state.invitations = [];
  if (!Array.isArray(store.state.auditLogs)) store.state.auditLogs = [];
  if (!Array.isArray(store.state.notifications)) store.state.notifications = [];
  if (!Array.isArray(store.state.companyEmployees)) store.state.companyEmployees = [];
  if (!Array.isArray(store.state.companies)) store.state.companies = [];
  if (!Array.isArray(store.state.users)) store.state.users = [];
}

function nextId(prefix, rows = []) {
  let index = rows.length + 1;
  let id = `${prefix}-${index}`;
  while (rows.some((row) => row.id === id)) {
    index += 1;
    id = `${prefix}-${index}`;
  }
  return id;
}

function invitationToken() {
  return crypto.randomBytes(24).toString('hex');
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function maskToken(token) {
  const value = String(token || '');
  return value ? `${value.slice(0, 6)}...${value.slice(-4)}` : '';
}

function inviteType(value) {
  const key = normalize(value || 'company').replace(/[^a-z0-9]+/g, '_');
  const allowed = new Set(['company', 'driver', 'hotel', 'fleet_owner', 'promoter', 'agent', 'service_provider', 'admin']);
  return allowed.has(key) ? key : 'company';
}

function parseList(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  return String(value || '').split(',').map(cleanText).filter(Boolean);
}

function roleForInvite(type, payload = {}) {
  const requested = normalize(payload.role || '');
  if (requested) return requested;
  if (type === 'promoter' || type === 'agent') return 'promoter';
  if (type === 'admin') return 'admin';
  return type === 'driver' ? 'company_employee' : 'company_admin';
}

function expireOld(row, now = new Date()) {
  if (['sent', 'requested'].includes(row.status) && row.expiresAt && new Date(row.expiresAt) < now) {
    row.status = 'expired';
    row.expiredAt = now.toISOString();
  }
  return row;
}

async function persist(modelName, row, filter = { id: row.id }) {
  if (mongoose.connection.readyState !== 1 || !row) return row;
  const Model = require(`../../models/${modelName}`);
  await Model.updateOne(filter, { $set: row }, { upsert: true, runValidators: true });
  return row;
}

async function audit(action, actorId, entityId, meta = {}) {
  ensureCollections();
  const row = {
    id: nextId('audit', store.state.auditLogs),
    actorId: actorId || 'system',
    action,
    entityType: 'invitation',
    entityId,
    target: entityId,
    metadata: meta,
    status: 'success',
    createdAt: new Date().toISOString(),
  };
  store.state.auditLogs.unshift(row);
  await persist('AuditLog', row);
  return row;
}

function publicLink(invitation) {
  return `/invite/${invitation.token}`;
}

async function queueInviteNotification(invitation, action = 'sent') {
  const title = action === 'resent' ? 'Classic Trip invitation resent' : 'Classic Trip onboarding invitation';
  return notificationService.queueNotification({
    userId: null,
    ownerType: 'invitation',
    ownerId: invitation.id,
    channels: ['email', 'sms'],
    title,
    message: `You have been invited to Classic Trip as ${invitation.type}. Use ${publicLink(invitation)} before ${new Date(invitation.expiresAt).toLocaleDateString('en-GB')}.`,
    recipient: { email: invitation.email, phone: invitation.phone, name: invitation.fullName },
    referenceType: 'invitation',
    referenceId: invitation.id,
    meta: { type: invitation.type, token: invitation.token, link: publicLink(invitation) },
  });
}

async function createInvitation(payload = {}, actorId = 'admin-system', source = 'admin') {
  ensureCollections();
  const type = inviteType(payload.type || payload.inviteType || payload.roleType);
  const email = cleanText(payload.email).toLowerCase();
  if (!email) {
    const error = new Error('Invitation email is required');
    error.status = 422;
    throw error;
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + Math.max(1, Number(payload.validDays || 7)) * 24 * 60 * 60 * 1000);
  const existing = store.state.invitations.find((row) => row.email === email && row.type === type && ['sent', 'requested'].includes(row.status));
  if (existing && source === 'admin') existing.status = 'revoked';
  const rawToken = invitationToken();
  const invitation = {
    id: nextId('invite', store.state.invitations),
    token: rawToken,
    tokenHash: tokenHash(rawToken),
    tokenPreview: maskToken(rawToken),
    type,
    status: source === 'company_request' ? 'requested' : 'sent',
    email,
    phone: cleanText(payload.phone),
    fullName: cleanText(payload.fullName || payload.name || email.split('@')[0]),
    companyId: cleanText(payload.companyId || ''),
    leadId: cleanText(payload.leadId || ''),
    agreementId: cleanText(payload.agreementId || ''),
    companyName: cleanText(payload.companyName || payload.company || ''),
    role: roleForInvite(type, payload),
    roleTitle: cleanText(payload.roleTitle || (type === 'driver' ? 'Driver' : 'Company owner')),
    permissions: parseList(payload.permissions || (type === 'driver' ? 'driver_manifest,check_in,trip_status' : '')),
    commissionPlan: cleanText(payload.commissionPlan || 'standard'),
    subscriptionPlan: cleanText(payload.subscriptionPlan || payload.plan || 'starter'),
    termsSummary: cleanText(payload.termsSummary || payload.terms || ''),
    startDate: payload.startDate || null,
    requestedBy: source === 'company_request' ? actorId : cleanText(payload.requestedBy || ''),
    sentBy: source === 'company_request' ? '' : actorId,
    expiresAt: expiresAt.toISOString(),
    sentAt: source === 'company_request' ? null : now.toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    meta: { source },
  };
  store.state.invitations.unshift(invitation);
  await persist('Invitation', invitation);
  if (invitation.status === 'sent') await queueInviteNotification(invitation);
  await audit(source === 'company_request' ? 'company.driver_invite.requested' : 'admin.invitation.sent', actorId, invitation.id, { type, email });
  return invitation;
}

function findByToken(token) {
  ensureCollections();
  const value = cleanText(token);
  const hashed = tokenHash(value);
  const row = store.state.invitations.find((item) => item.tokenHash === hashed || item.token === value);
  return row ? expireOld(row) : null;
}

function findById(id) {
  ensureCollections();
  const row = store.state.invitations.find((item) => item.id === cleanText(id));
  return row ? expireOld(row) : null;
}

async function resendInvitation(id, actorId = 'admin-system') {
  const invitation = findById(id);
  if (!invitation) {
    const error = new Error('Invitation not found');
    error.status = 404;
    throw error;
  }
  if (!['sent', 'expired'].includes(invitation.status)) {
    const error = new Error('Only sent or expired invitations can be resent');
    error.status = 422;
    throw error;
  }
  invitation.status = 'sent';
  invitation.token = invitationToken();
  invitation.tokenHash = tokenHash(invitation.token);
  invitation.tokenPreview = maskToken(invitation.token);
  invitation.resentBy = actorId;
  invitation.resentAt = new Date().toISOString();
  invitation.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  invitation.updatedAt = new Date().toISOString();
  await persist('Invitation', invitation);
  await queueInviteNotification(invitation, 'resent');
  await audit('admin.invitation.resent', actorId, invitation.id, { type: invitation.type, email: invitation.email });
  return invitation;
}

async function revokeInvitation(id, actorId = 'admin-system', reason = '') {
  const invitation = findById(id);
  if (!invitation) {
    const error = new Error('Invitation not found');
    error.status = 404;
    throw error;
  }
  invitation.status = 'revoked';
  invitation.revokedBy = actorId;
  invitation.revokedAt = new Date().toISOString();
  invitation.revocationReason = cleanText(reason);
  invitation.updatedAt = new Date().toISOString();
  await persist('Invitation', invitation);
  await audit('admin.invitation.revoked', actorId, invitation.id, { reason: invitation.revocationReason });
  return invitation;
}

async function approveRequestedInvitation(id, actorId = 'admin-system') {
  const invitation = findById(id);
  if (!invitation) {
    const error = new Error('Invitation not found');
    error.status = 404;
    throw error;
  }
  if (invitation.status !== 'requested') {
    const error = new Error('Only requested invitations can be approved');
    error.status = 422;
    throw error;
  }
  invitation.status = 'sent';
  invitation.sentBy = actorId;
  invitation.sentAt = new Date().toISOString();
  invitation.token = invitationToken();
  invitation.tokenHash = tokenHash(invitation.token);
  invitation.tokenPreview = maskToken(invitation.token);
  invitation.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  invitation.updatedAt = new Date().toISOString();
  await persist('Invitation', invitation);
  await queueInviteNotification(invitation);
  await audit('admin.invitation.approved', actorId, invitation.id, { type: invitation.type, email: invitation.email });
  return invitation;
}


function documentFromPayload(payload = {}, fallbackType = 'business_license') {
  const documentType = cleanText(payload.documentType || payload.verificationDocumentType || fallbackType);
  const documentReference = cleanText(payload.documentReference || payload.verificationReference || payload.documentNumber || '');
  const url = cleanText(payload.documentUrl || payload.documentLink || payload.fileUrl || '');
  const label = cleanText(payload.documentLabel || documentType.replace(/_/g, ' '));
  if (!documentReference && !url) return null;
  return {
    documentType,
    documentReference,
    label,
    url,
    secureUrl: url,
    status: 'pending_review',
    uploadedAt: new Date().toISOString(),
  };
}

function profileCompletion(invitation = {}, payload = {}, document = null) {
  const required = ['fullName', 'phone', 'password', 'agreementAccepted', 'document'];
  const complete = [];
  if (cleanText(payload.fullName || invitation.fullName)) complete.push('fullName');
  if (cleanText(payload.phone || invitation.phone)) complete.push('phone');
  if (cleanText(payload.password).length >= 6) complete.push('password');
  if (payload.agreementAccepted === 'on' || payload.agreementAccepted === true || payload.agreementAccepted === 'true') complete.push('agreementAccepted');
  if (document) complete.push('document');
  const missing = required.filter((key) => !complete.includes(key));
  return {
    required,
    complete,
    missing,
    percent: Math.round((complete.length / required.length) * 100),
    completed: missing.length === 0,
    completedAt: missing.length === 0 ? new Date().toISOString() : null,
  };
}

function companyForInvitation(invitation, user) {
  if (invitation.companyId) return store.findCompany(invitation.companyId);
  if (invitation.type === 'driver' && invitation.companyName) return store.state.companies.find((row) => normalize(row.name) === normalize(invitation.companyName));
  if (['company', 'hotel', 'fleet_owner', 'service_provider'].includes(invitation.type)) {
    const name = cleanText(invitation.companyName || `${user.fullName} company`);
    let company = store.state.companies.find((row) => normalize(row.name) === normalize(name));
    if (!company) {
      company = {
        id: nextId('company', store.state.companies),
        name,
        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        companyType: invitation.type === 'hotel' ? 'Hotel / apartments' : invitation.type,
        email: invitation.email,
        phone: invitation.phone,
        ownerId: user.id,
        status: 'pending',
        verificationStatus: 'pending',
        settings: { canPublish: false, instantConfirmation: false, onboardingStep: 'verification' },
        invitedBy: invitation.sentBy,
        invitedAt: invitation.sentAt,
        createdAt: new Date().toISOString(),
      };
      store.state.companies.unshift(company);
    }
    return company;
  }
  return null;
}

async function acceptInvitation(token, payload = {}) {
  ensureCollections();
  const invitation = findByToken(token);
  if (!invitation || invitation.status !== 'sent') {
    const error = new Error('Invitation link is invalid, expired, or no longer active');
    error.status = 400;
    throw error;
  }
  const password = cleanText(payload.password);
  if (password.length < 6) {
    const error = new Error('Password must be at least 6 characters');
    error.status = 422;
    throw error;
  }
  const email = invitation.email;
  const role = roleForInvite(invitation.type, invitation);
  const acceptedAt = new Date().toISOString();
  const fallbackDocumentType = role === 'company_employee' ? 'driver_license' : 'business_license';
  const submittedDocument = documentFromPayload(payload, fallbackDocumentType);
  const completion = profileCompletion(invitation, payload, submittedDocument);
  const phone = cleanText(payload.phone || invitation.phone);
  const user = store.upsertUser({
    fullName: cleanText(payload.fullName || invitation.fullName),
    email,
    phone,
    role,
    status: role === 'promoter' ? 'active' : 'pending',
    passwordHash: await bcrypt.hash(password, 10),
    authProviders: { local: { enabled: true }, google: { enabled: false } },
    isVerified: role === 'promoter',
    verificationStatus: role === 'promoter' ? 'pending' : 'pending',
    emailVerifiedAt: acceptedAt,
    phoneVerifiedAt: payload.phoneVerified === 'on' || payload.phoneVerified === true || !phone ? acceptedAt : null,
    phoneVerificationStatus: payload.phoneVerified === 'on' || payload.phoneVerified === true || !phone ? 'verified' : 'pending',
    onboardingStatus: completion.completed ? 'profile_submitted' : 'profile_incomplete',
    profileCompletion: completion,
  });
  const company = companyForInvitation(invitation, user);
  if (company) {
    user.companyId = company.id;
    company.ownerId = company.ownerId || (role === 'company_admin' ? user.id : company.ownerId);
    company.documents = Array.isArray(company.documents) ? company.documents : [];
    if (submittedDocument && role !== 'company_employee') {
      company.documents.push({ ...submittedDocument, uploadedBy: user.id });
    }
    company.settings = { ...(company.settings || {}), onboardingStep: 'verification', canPublish: false };
    company.updatedAt = acceptedAt;
    await persist('Company', company);
    walletService.getOrCreateWallet('company', company.id, 'UGX');
    const companyReview = verificationService.getReview('company', company.id);
    companyReview.invitationId = invitation.id;
    companyReview.documents = Array.isArray(companyReview.documents) ? companyReview.documents : [];
    if (submittedDocument && role !== 'company_employee') {
      companyReview.documents.unshift({ ...submittedDocument, uploadedBy: user.id });
      await verificationService.submitCompanyChecklist(company.id, {
        payoutProvider: payload.payoutProvider,
        accountName: payload.accountName,
        accountNumber: payload.accountNumber,
        currency: payload.currency,
        supportPhone: payload.supportPhone || phone,
        supportEmail: payload.supportEmail || email,
        supportWhatsapp: payload.supportWhatsapp || payload.whatsapp,
        agreementAccepted: payload.agreementAccepted,
        agreementSummary: payload.agreementSummary || invitation.termsSummary,
      }, user.id);
    }
    await persist('VerificationReview', companyReview);
  }
  if (role === 'company_employee') {
    let employee = store.state.companyEmployees.find((row) => row.userId === user.id && row.companyId === user.companyId);
    if (!employee) {
      employee = {
        id: nextId('company-employee', store.state.companyEmployees),
        companyId: user.companyId || invitation.companyId || '',
        userId: user.id,
        roleTitle: invitation.roleTitle || 'Driver',
        permissions: invitation.permissions || ['driver_manifest', 'check_in', 'trip_status'],
        status: 'pending_verification',
        invitedAt: invitation.sentAt,
        createdAt: acceptedAt,
      };
      store.state.companyEmployees.unshift(employee);
    }
    employee.documents = Array.isArray(employee.documents) ? employee.documents : [];
    if (submittedDocument) employee.documents.unshift({ ...submittedDocument, uploadedBy: user.id });
    employee.onboardingStatus = completion.completed ? 'profile_submitted' : 'profile_incomplete';
    await persist('CompanyEmployee', employee);
    const driverReview = verificationService.getReview('driver', employee.id);
    driverReview.invitationId = invitation.id;
    driverReview.documents = Array.isArray(driverReview.documents) ? driverReview.documents : [];
    if (submittedDocument) {
      driverReview.documents.unshift({ ...submittedDocument, uploadedBy: user.id });
      await verificationService.submitDriverChecklist(employee.id, {
        licenseNumber: payload.licenseNumber || payload.documentReference,
        documentReference: payload.documentReference,
        identityReference: payload.identityReference,
        safetyCleared: false,
      }, user.id, employee.companyId);
    }
    await persist('VerificationReview', driverReview);
  }
  if (role === 'promoter') {
    user.referralCode = user.referralCode || `${user.fullName || 'PROMOTER'}`.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '') || `PROMOTER-${Date.now()}`;
    user.verificationDocumentType = submittedDocument?.documentType || user.verificationDocumentType;
    user.verificationReference = submittedDocument?.documentReference || user.verificationReference;
    user.promoterProfile = { ...(user.promoterProfile || {}), agreementSummary: cleanText(payload.agreementSummary || invitation.termsSummary), onboardingStatus: completion.completed ? 'profile_submitted' : 'profile_incomplete' };
    walletService.getOrCreateWallet('promoter', user.id, 'UGX');
  }
  invitation.status = 'accepted';
  invitation.acceptedBy = user.id;
  invitation.acceptedAt = acceptedAt;
  invitation.updatedAt = acceptedAt;
  invitation.accountSetup = { profileCompletion: completion, documentSubmitted: Boolean(submittedDocument), emailVerified: true, phoneVerified: Boolean(user.phoneVerifiedAt) };
  await persist('User', user);
  await persist('Invitation', invitation);
  await audit('invitation.accepted', user.id, invitation.id, { type: invitation.type, companyId: user.companyId || '', profileCompletion: completion.percent });
  if (!user.phoneVerifiedAt && phone) {
    await notificationService.queueNotification({
      userId: user.id,
      ownerType: 'user',
      ownerId: user.id,
      channels: ['sms'],
      title: 'Verify your Classic Trip phone number',
      message: 'Please complete phone verification before activation.',
      recipient: { phone, name: user.fullName },
      referenceType: 'user',
      referenceId: user.id,
    });
  }
  return { invitation, user, company };
}

async function rejectInvitation(token, payload = {}) {
  ensureCollections();
  const invitation = findByToken(token);
  if (!invitation || invitation.status !== 'sent') {
    const error = new Error('Invitation link is invalid, expired, or no longer active');
    error.status = 400;
    throw error;
  }
  invitation.status = 'rejected';
  invitation.rejectedAt = new Date().toISOString();
  invitation.rejectionReason = cleanText(payload.reason || payload.note || 'Invitee declined invitation');
  invitation.updatedAt = invitation.rejectedAt;
  await persist('Invitation', invitation);
  await audit('invitation.rejected', invitation.email, invitation.id, { type: invitation.type, reason: invitation.rejectionReason });
  return invitation;
}

function listInvitations(filter = {}) {
  ensureCollections();
  return store.state.invitations
    .map((row) => expireOld(row))
    .filter((row) => !filter.companyId || row.companyId === filter.companyId)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

module.exports = {
  createInvitation,
  resendInvitation,
  revokeInvitation,
  approveRequestedInvitation,
  acceptInvitation,
  rejectInvitation,
  findByToken,
  findById,
  listInvitations,
  publicLink,
};
