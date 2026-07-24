const { platformCurrency } = require('../../utils/currency');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const onboardingRepository = require('../../repositories/domain/onboardingRepository');
const { nextId } = require('../data/idService');
const walletService = require('../wallet/walletService');
const notificationService = require('../notification/notificationService');
const verificationService = require('./verificationService');
const logger = require('../../config/logger');
const { employeePermissions } = require('../../config/accessControl');
const { validatePassword } = require('../auth/passwordPolicy');

function cleanText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

function normalize(value) {
  return cleanText(value).toLowerCase();
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
  const allowed = new Set(['company', 'staff', 'driver', 'hotel', 'fleet_owner', 'promoter', 'agent', 'service_provider', 'admin']);
  return allowed.has(key) ? key : 'company';
}

function parseList(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  return String(value || '').split(',').map(cleanText).filter(Boolean);
}

const PLATFORM_ADMIN_ROLES = new Set(['admin', 'finance_admin', 'support_admin', 'operations_admin', 'content_admin']);

function roleForInvite(type, payload = {}, source = 'admin') {
  const requested = normalize(payload.role || '');
  if (type === 'admin') {
    const role = requested || 'admin';
    if (!PLATFORM_ADMIN_ROLES.has(role)) {
      const error = new Error('Unsupported platform administrator role');
      error.status = 422;
      throw error;
    }
    return role;
  }
  if (type === 'promoter' || type === 'agent') return 'promoter';
  if (type === 'driver') return 'driver';
  if (type === 'staff') return 'company_employee';
  if (['company', 'hotel', 'fleet_owner', 'service_provider'].includes(type)) return 'company_admin';
  const error = new Error(`Unsupported invitation role for ${source}`);
  error.status = 422;
  throw error;
}

function expireOld(row, now = new Date()) {
  if (['sent', 'requested'].includes(row.status) && row.expiresAt && new Date(row.expiresAt) < now) {
    row.status = 'expired';
    row.expiredAt = now.toISOString();
  }
  return row;
}

async function persist(modelName, row, filter = null, options = {}) {
  if (!row) return row;
  const map = {
    Invitation: onboardingRepository.invitations,
    AuditLog: onboardingRepository.auditLogs,
    Company: onboardingRepository.companies,
    User: onboardingRepository.users,
    CompanyEmployee: onboardingRepository.employees,
    VerificationReview: onboardingRepository.verificationReviews,
  };
  const collection = map[modelName];
  if (!collection) throw new Error(`Unsupported onboarding persistence model: ${modelName}`);
  await collection.save(row, filter || { id: row.id }, options);
  return row;
}


async function persistInvitation(row, filter = null, options = {}) {
  const stored = { ...row };
  delete stored.token;
  await persist('Invitation', stored, filter || { id: stored.id }, options);
  await onboardingRepository.invitations.updateOne(filter || { id: stored.id }, { $unset: { token: 1 } }, options);
  return row;
}

async function audit(action, actorId, entityId, meta = {}) {
  const row = {
    id: await nextId('audit'),
    actorId: actorId || 'system',
    action,
    entityType: 'invitation',
    entityId,
    target: entityId,
    metadata: meta,
    status: 'success',
    createdAt: new Date().toISOString(),
  };
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
    // The delivery adapter receives the one-time link, but the durable
    // notification/audit record stores only redacted metadata.
    meta: { type: invitation.type, link: publicLink(invitation) },
    persistedMessage: `A secure ${invitation.type} invitation was sent. It expires on ${new Date(invitation.expiresAt).toLocaleDateString('en-GB')}.`,
    persistedMeta: { type: invitation.type, tokenPreview: invitation.tokenPreview, expiresAt: invitation.expiresAt },
  });
}

async function validatedInvitationCompany(type, payload = {}) {
  const companyId = cleanText(payload.companyId || '');
  const requiresCompany = ['staff', 'driver'].includes(type);
  if (requiresCompany && !companyId) {
    const error = new Error('Staff and driver invitations require a verified company');
    error.status = 422;
    throw error;
  }
  if (!companyId) return null;
  const company = await onboardingRepository.companies.findOne({ id: companyId });
  if (!company) {
    const error = new Error('Invitation company was not found');
    error.status = 404;
    throw error;
  }
  if (requiresCompany) {
    const operational = String(company.status || '').toLowerCase() === 'active'
      && String(company.verificationStatus || '').toLowerCase() === 'verified';
    if (!operational) {
      const error = new Error('Staff and driver invitations require an active, verified company');
      error.status = 409;
      throw error;
    }
  }
  return company;
}

async function createInvitation(payload = {}, actorId = 'admin-system', source = 'admin') {
  const type = inviteType(payload.type || payload.inviteType || payload.roleType);
  if (source === 'company_staff' && !['staff', 'driver'].includes(type)) { const error = new Error('Partner Admin may directly invite only company staff and drivers'); error.status = 403; throw error; }
  if (source === 'company_request' && type !== 'driver') { const error = new Error('Company approval requests are limited to drivers'); error.status = 403; throw error; }
  const role = roleForInvite(type, payload, source);
  if (source === 'company_staff') {
    const staffTitle = cleanText(payload.roleTitle || (type === 'driver' ? 'Driver' : 'Staff member'));
    const requestedPermissions = employeePermissions(staffTitle, payload.permissions || []);
    if (type === 'driver' && !/driver/i.test(staffTitle)) payload.roleTitle = 'Driver';
    payload.permissions = requestedPermissions;
  }
  const invitationCompany = await validatedInvitationCompany(type, payload);
  const vehicleId = cleanText(payload.vehicleId || '');
  const scheduleId = cleanText(payload.scheduleId || '');
  if (type === 'driver' && vehicleId && !(await onboardingRepository.vehicles.findOne({ id: vehicleId, companyId: invitationCompany.id }))) {
    const error = new Error('Selected driver vehicle does not belong to the invitation company');
    error.status = 409;
    throw error;
  }
  if (type === 'driver' && scheduleId && !(await onboardingRepository.schedules.findOne({ id: scheduleId, companyId: invitationCompany.id }))) {
    const error = new Error('Selected driver schedule does not belong to the invitation company');
    error.status = 409;
    throw error;
  }
  const email = cleanText(payload.email).toLowerCase();
  if (!email) {
    const error = new Error('Invitation email is required');
    error.status = 422;
    throw error;
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + Math.max(1, Number(payload.validDays || 7)) * 24 * 60 * 60 * 1000);
  const existingFilter = { email, type, status: { $in: ['sent', 'requested'] } };
  if (invitationCompany?.id && ['staff', 'driver'].includes(type)) existingFilter.companyId = invitationCompany.id;
  const existing = await onboardingRepository.invitations.findOne(existingFilter);
  if (existing && source === 'admin') { existing.status = 'revoked'; existing.revokedAt = now.toISOString(); await persistInvitation(existing, { id: existing.id }); }
  else if (existing) { const error = new Error('An active invitation already exists for this email and role'); error.status = 409; throw error; }
  const rawToken = invitationToken();
  const invitation = {
    id: await nextId('invite'),
    tokenHash: tokenHash(rawToken),
    tokenPreview: maskToken(rawToken),
    type,
    status: source === 'company_request' ? 'requested' : 'sent',
    email,
    phone: cleanText(payload.phone),
    fullName: cleanText(payload.fullName || payload.name || email.split('@')[0]),
    companyId: cleanText(payload.companyId || ''),
    userId: cleanText(payload.userId || ''),
    leadId: cleanText(payload.leadId || ''),
    agreementId: cleanText(payload.agreementId || ''),
    companyName: cleanText(payload.companyName || payload.company || invitationCompany?.name || ''),
    role,
    roleTitle: cleanText(payload.roleTitle || (type === 'driver' ? 'Driver' : type === 'staff' ? 'Staff member' : type === 'admin' ? 'Platform administrator' : 'Company owner')),
    permissions: employeePermissions(payload.roleTitle || (type === 'driver' ? 'Driver' : 'Staff member'), payload.permissions || (type === 'driver' ? ['manifest.view', 'checkin.assist', 'trip.status.update', 'incident.create'] : [])),
    branchId: cleanText(payload.branchId || ''),
    vehicleId,
    scheduleId,
    licenseNumber: cleanText(payload.licenseNumber || ''),
    licenseClass: cleanText(payload.licenseClass || ''),
    listingIds: parseList(payload.listingIds),
    scheduleIds: parseList(payload.scheduleIds),
    serviceCategories: parseList(payload.serviceCategories),
    termsSummary: cleanText(payload.termsSummary || payload.terms || ''),
    startDate: payload.startDate || null,
    requestedBy: source === 'company_request' ? actorId : cleanText(payload.requestedBy || ''),
    sentBy: source === 'company_request' ? '' : actorId,
    expiresAt: expiresAt.toISOString(),
    sentAt: source === 'company_request' ? null : now.toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    meta: {
      source,
      requestTicketId: cleanText(payload.requestTicketId || ''),
      driverEmployeeId: cleanText(payload.driverEmployeeId || ''),
      requestedVehicleId: vehicleId,
      requestedScheduleId: scheduleId,
    },
  };
  await persistInvitation(invitation);
  if (invitation.status === 'sent') {
    try { await queueInviteNotification({ ...invitation, token: rawToken }); }
    catch (error) { logger.error('Invitation notification could not be queued', { invitationId: invitation.id, error: error.message }); }
  }
  const auditAction = source === 'company_request' ? 'company.driver_invite.requested' : source === 'company_staff' ? (type === 'driver' ? 'company.driver_invitation.sent' : 'company.staff_invitation.sent') : 'admin.invitation.sent';
  await audit(auditAction, actorId, invitation.id, { type, role, email, companyId: invitation.companyId });
  // The plaintext token is returned only to the trusted caller for immediate
  // rendering/testing. persistInvitation() has already removed it at rest.
  return { ...invitation, token: rawToken };
}

async function findByToken(token) {
  const value = cleanText(token);
  const hashed = tokenHash(value);
  const row = await onboardingRepository.invitations.findOne({ $or: [{ tokenHash: hashed }, { token: value }] });
  if (!row) return null;
  const previous = row.status;
  expireOld(row);
  if (row.status !== previous) await persistInvitation(row, { id: row.id });
  return row;
}

async function findById(id) {
  const row = await onboardingRepository.invitations.findOne({ id: cleanText(id) });
  if (!row) return null;
  const previous = row.status;
  expireOld(row);
  if (row.status !== previous) await persistInvitation(row, { id: row.id });
  return row;
}

async function resendInvitation(id, actorId = 'admin-system') {
  const invitation = await findById(id);
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
  const rawToken = invitationToken();
  invitation.tokenHash = tokenHash(rawToken);
  invitation.tokenPreview = maskToken(rawToken);
  invitation.resentBy = actorId;
  invitation.resentAt = new Date().toISOString();
  invitation.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  invitation.updatedAt = new Date().toISOString();
  await persistInvitation(invitation);
  await queueInviteNotification({ ...invitation, token: rawToken }, 'resent');
  await audit('admin.invitation.resent', actorId, invitation.id, { type: invitation.type, email: invitation.email });
  return { ...invitation, token: rawToken };
}

async function revokeInvitation(id, actorId = 'admin-system', reason = '') {
  const invitation = await findById(id);
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
  await persistInvitation(invitation);
  await audit('admin.invitation.revoked', actorId, invitation.id, { reason: invitation.revocationReason });
  return invitation;
}

async function approveRequestedInvitation(id, actorId = 'admin-system') {
  const invitation = await findById(id);
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
  const rawToken = invitationToken();
  invitation.tokenHash = tokenHash(rawToken);
  invitation.tokenPreview = maskToken(rawToken);
  invitation.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  invitation.updatedAt = new Date().toISOString();
  await persistInvitation(invitation);
  await queueInviteNotification({ ...invitation, token: rawToken });
  await audit('admin.invitation.approved', actorId, invitation.id, { type: invitation.type, email: invitation.email });
  return { ...invitation, token: rawToken };
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

function accepted(value) {
  return value === 'on' || value === true || value === 'true' || value === '1';
}

function invitationRequirements(invitation = {}) {
  const type = inviteType(invitation.type);
  const required = ['fullName', 'password', 'agreementAccepted'];
  if (['company', 'hotel', 'fleet_owner', 'service_provider', 'driver', 'promoter', 'agent'].includes(type)) required.push('phone');
  if (['company', 'hotel', 'fleet_owner', 'service_provider'].includes(type)) required.push('businessDocument', 'payoutAccount', 'supportContact');
  if (type === 'driver') required.push('driverLicense', 'identityDocument');
  if (['promoter', 'agent'].includes(type)) required.push('identityDocument', 'payoutAccount', 'fraudTraining');
  if (type === 'admin') required.push('identityDocument');
  return required;
}

function profileCompletion(invitation = {}, payload = {}, document = null) {
  const required = invitationRequirements(invitation);
  const complete = [];
  if (cleanText(payload.fullName || invitation.fullName)) complete.push('fullName');
  if (cleanText(payload.phone || invitation.phone)) complete.push('phone');
  if (cleanText(payload.password).length >= 8) complete.push('password');
  if (accepted(payload.agreementAccepted)) complete.push('agreementAccepted');
  if (document && ['business_license', 'company_registration', 'tax_certificate'].includes(document.documentType)) complete.push('businessDocument');
  if (document && ['national_id', 'passport'].includes(document.documentType)) complete.push('identityDocument');
  if (document && document.documentType === 'driver_license') complete.push('driverLicense');
  if (cleanText(payload.identityReference)) complete.push('identityDocument');
  if (cleanText(payload.payoutAccount || payload.accountNumber)) complete.push('payoutAccount');
  if (cleanText(payload.supportPhone || payload.supportEmail || payload.supportWhatsapp)) complete.push('supportContact');
  if (accepted(payload.trainingAcknowledged) || accepted(payload.fraudTrainingAccepted)) complete.push('fraudTraining');
  const missing = required.filter((key) => !complete.includes(key));
  return {
    required,
    complete: Array.from(new Set(complete)),
    missing,
    percent: Math.round(((required.length - missing.length) / Math.max(1, required.length)) * 100),
    completed: missing.length === 0,
    completedAt: missing.length === 0 ? new Date().toISOString() : null,
  };
}

async function companyForInvitation(invitation, user) {
  if (invitation.companyId) {
    const company = await onboardingRepository.companies.findOne({ id: invitation.companyId });
    if (!company) {
      const error = new Error('The company attached to this invitation no longer exists');
      error.status = 409;
      throw error;
    }
    if (['staff', 'driver'].includes(invitation.type)) {
      const operational = String(company.status || '').toLowerCase() === 'active'
        && String(company.verificationStatus || '').toLowerCase() === 'verified';
      if (!operational) {
        const error = new Error('The inviting company is not active and verified');
        error.status = 409;
        throw error;
      }
    }
    return company;
  }
  if (['staff', 'driver'].includes(invitation.type)) {
    const error = new Error('This staff or driver invitation is not attached to a company');
    error.status = 409;
    throw error;
  }
  if (['company', 'hotel', 'fleet_owner', 'service_provider'].includes(invitation.type)) {
    const name = cleanText(invitation.companyName || `${user.fullName} company`);
    const company = {
      id: await nextId('company'), name,
      slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${crypto.randomBytes(3).toString('hex')}`,
      companyType: invitation.type === 'hotel' ? 'Hotel / apartments' : invitation.type,
      email: invitation.email, phone: invitation.phone, ownerId: user.id,
      status: 'pending', verificationStatus: 'pending',
      settings: { canPublish: false, instantConfirmation: false, onboardingStep: 'verification' },
      invitedBy: invitation.sentBy, invitedAt: invitation.sentAt, createdAt: new Date().toISOString(),
    };
    await onboardingRepository.companies.save(company, { id: company.id });
    return company;
  }
  return null;
}

async function acceptInvitation(token, payload = {}) {
  const invitation = await findByToken(token);
  if (!invitation || invitation.status !== 'sent') {
    const error = new Error('Invitation link is invalid, expired, or no longer active');
    error.status = 400;
    throw error;
  }
  const password = validatePassword(payload.password);
  const email = invitation.email;
  const type = inviteType(invitation.type);
  const role = roleForInvite(type, invitation, invitation.meta?.source || 'admin');
  // Revalidate the target organization immediately before creating credentials.
  // This prevents an accepted staff/driver invitation from leaving an orphaned
  // account if the company was deleted, suspended, or lost verification after
  // the invitation was issued.
  const prevalidatedCompany = await validatedInvitationCompany(type, { companyId: invitation.companyId });
  const acceptedAt = new Date().toISOString();
  const fallbackDocumentType = role === 'driver' ? 'driver_license' : role === 'company_employee' || PLATFORM_ADMIN_ROLES.has(role) ? 'national_id' : 'business_license';
  const submittedDocument = documentFromPayload(payload, fallbackDocumentType);
  const completion = profileCompletion(invitation, payload, submittedDocument);
  if (!completion.completed) {
    const error = new Error(`Complete the required invitation fields: ${completion.missing.join(', ')}`);
    error.status = 422;
    error.code = 'invitation_profile_incomplete';
    error.completion = completion;
    throw error;
  }
  const phone = cleanText(payload.phone || invitation.phone);
  let user = invitation.userId
    ? await onboardingRepository.users.findOne({ id: invitation.userId })
    : await onboardingRepository.users.findOne({ email });
  if (user && invitation.userId && String(user.id) !== String(invitation.userId)) {
    const error = new Error('Invitation account does not match the intended user');
    error.status = 409;
    throw error;
  }
  if (user && user.passwordHash && String(user.email || '').toLowerCase() === email && !invitation.userId) {
    const error = new Error('An account already exists for this email. Sign in and ask the inviter to link the existing account securely.');
    error.status = 409;
    throw error;
  }
  if (user && user.role && user.role !== role && invitation.userId) {
    const error = new Error('Invitation role does not match the provisional account');
    error.status = 409;
    throw error;
  }
  const isStaff = role === 'company_employee';
  const isDriver = role === 'driver';
  const isPlatformAdmin = PLATFORM_ADMIN_ROLES.has(role);
  const userPayload = {
    fullName: cleanText(payload.fullName || invitation.fullName), email, phone, role,
    status: 'active',
    passwordHash: await bcrypt.hash(password, 12),
    authProviders: { local: { enabled: true }, google: { enabled: false } },
    isVerified: isStaff || isPlatformAdmin,
    verificationStatus: isStaff || isPlatformAdmin ? 'verified' : 'pending',
    emailVerifiedAt: acceptedAt,
    phoneVerifiedAt: !phone ? acceptedAt : null,
    phoneVerificationStatus: !phone ? 'not_required' : 'pending',
    onboardingStatus: isPlatformAdmin ? 'mfa_setup_required' : isDriver ? 'driver_verification' : completion.completed ? 'profile_submitted' : 'profile_incomplete',
    profileCompletion: completion,
    ...(isPlatformAdmin ? { twoFactorEnabled: false } : {}),
    updatedAt: acceptedAt,
  };
  if (!user) {
    user = { ...userPayload, createdAt: acceptedAt };
    Object.assign(user, await onboardingRepository.users.insert(user));
  } else {
    Object.assign(user, userPayload);
    await onboardingRepository.users.save(user, { id: user.id });
  }
  const company = prevalidatedCompany || await companyForInvitation(invitation, user);
  if (company) {
    user.companyId = company.id;
    if (role === 'company_admin') {
      company.ownerId = company.ownerId || user.id;
      company.documents = Array.isArray(company.documents) ? company.documents : [];
      if (submittedDocument) company.documents.push({ ...submittedDocument, uploadedBy: user.id });
      company.settings = { ...(company.settings || {}), onboardingStep: 'verification', canPublish: false, instantConfirmation: false };
      company.updatedAt = acceptedAt;
      await persist('Company', company);
      await walletService.getOrCreateWallet('company', company.id, company.operatingCurrency || platformCurrency());
      const companyReview = await verificationService.getReview('company', company.id);
      companyReview.invitationId = invitation.id;
      companyReview.documents = Array.isArray(companyReview.documents) ? companyReview.documents : [];
      if (submittedDocument) companyReview.documents.unshift({ ...submittedDocument, uploadedBy: user.id });
      await verificationService.submitCompanyChecklist(company.id, {
        payoutMethod: payload.payoutMethod,
        payoutProvider: payload.payoutProvider,
        accountName: payload.accountName,
        accountNumber: payload.accountNumber || payload.payoutAccount,
        currency: payload.currency,
        supportPhone: payload.supportPhone || phone,
        supportEmail: payload.supportEmail || email,
        supportWhatsapp: payload.supportWhatsapp || payload.whatsapp,
        agreementAccepted: payload.agreementAccepted,
        agreementSummary: payload.agreementSummary || invitation.termsSummary,
        documentReference: submittedDocument?.documentReference,
      }, user.id);
      await persist('VerificationReview', companyReview);
    }
  }
  if (['company_employee', 'driver'].includes(role)) {
    let employee = invitation.meta?.driverEmployeeId
      ? await onboardingRepository.employees.findOne({ id: invitation.meta.driverEmployeeId, companyId: user.companyId })
      : null;
    if (!employee) employee = await onboardingRepository.employees.findOne({ userId: user.id, companyId: user.companyId });
    if (!employee && role === 'driver') {
      employee = await onboardingRepository.employees.findOne({
        companyId: user.companyId,
        $or: [
          { email: String(invitation.email || '').toLowerCase() },
          ...(invitation.phone ? [{ phone: invitation.phone }] : []),
        ],
        roleTitle: { $regex: /^driver$/i },
        status: { $nin: ['rejected', 'revoked'] },
      });
    }
    if (!employee) {
      employee = {
        id: await nextId('company-employee'),
        companyId: user.companyId || invitation.companyId || '',
        userId: user.id,
        roleTitle: invitation.roleTitle || (role === 'driver' ? 'Driver' : 'Staff member'),
        permissions: employeePermissions(invitation.roleTitle || (role === 'driver' ? 'Driver' : 'Staff member'), invitation.permissions || (role === 'driver' ? ['manifest.view', 'checkin.assist', 'trip.status.update', 'incident.create'] : [])),
        branchId: invitation.branchId || '', listingIds: invitation.listingIds || [], scheduleIds: invitation.scheduleIds || [], serviceCategories: invitation.serviceCategories || [],
        licenseNumber: cleanText(payload.licenseNumber || invitation.licenseNumber || payload.documentReference),
        licenseClass: cleanText(payload.licenseClass || invitation.licenseClass),
        pendingVehicleId: invitation.vehicleId || invitation.meta?.requestedVehicleId || '',
        pendingScheduleId: invitation.scheduleId || invitation.meta?.requestedScheduleId || '',
        status: role === 'driver' ? 'pending_verification' : 'active',
        invitedAt: invitation.sentAt,
        acceptedAt,
        createdAt: acceptedAt,
      };
    }
    employee.userId = user.id;
    employee.fullName = cleanText(payload.fullName || invitation.fullName || user.fullName);
    employee.email = cleanText(invitation.email || user.email).toLowerCase();
    employee.phone = cleanText(payload.phone || invitation.phone || user.phone);
    employee.invitationId = invitation.id;
    employee.requestTicketId = invitation.meta?.requestTicketId || employee.requestTicketId || '';
    employee.documents = Array.isArray(employee.documents) ? employee.documents : [];
    if (submittedDocument) employee.documents.unshift({ ...submittedDocument, uploadedBy: user.id });
    employee.acceptedAt = employee.acceptedAt || acceptedAt;
    employee.permissions = employeePermissions(employee.roleTitle || (role === 'driver' ? 'Driver' : 'Staff member'), employee.permissions || invitation.permissions);
    employee.onboardingStatus = role === 'driver' ? 'driver_verification' : completion.completed ? 'complete' : 'profile_incomplete';
    employee.updatedAt = acceptedAt;
    await persist('CompanyEmployee', employee);
    if (role === 'driver') {
      const driverReview = await verificationService.getReview('driver', employee.id);
      driverReview.invitationId = invitation.id;
      driverReview.documents = Array.isArray(driverReview.documents) ? driverReview.documents : [];
      if (submittedDocument) driverReview.documents.unshift({ ...submittedDocument, uploadedBy: user.id });
      await verificationService.submitDriverChecklist(employee.id, {
        licenseNumber: payload.licenseNumber || payload.documentReference,
        documentReference: payload.documentReference,
        identityReference: payload.identityReference,
        safetyCleared: false,
      }, user.id, employee.companyId);
      await persist('VerificationReview', driverReview);
    }
  }
  if (role === 'promoter') {
    user.referralCode = user.referralCode || `${user.fullName || 'PROMOTER'}`.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '') || `PROMOTER-${Date.now()}`;
    user.verificationDocumentType = submittedDocument?.documentType || user.verificationDocumentType;
    user.verificationReference = submittedDocument?.documentReference || user.verificationReference;
    user.promoterProfile = { ...(user.promoterProfile || {}), agreementSummary: cleanText(payload.agreementSummary || invitation.termsSummary), onboardingStatus: 'verification_submitted' };
    await walletService.getOrCreateWallet('promoter', user.id, cleanText(payload.currency || platformCurrency()).toUpperCase());
    await persist('User', user);
    await verificationService.submitPromoterChecklist(user.id, {
      documentType: submittedDocument?.documentType,
      documentReference: submittedDocument?.documentReference || payload.identityReference,
      payoutMethod: payload.payoutMethod,
      payoutProvider: payload.payoutProvider,
      payoutAccount: payload.payoutAccount || payload.accountNumber,
      termsAccepted: payload.agreementAccepted,
      trainingAcknowledged: payload.trainingAcknowledged || payload.fraudTrainingAccepted,
      notes: payload.agreementSummary || invitation.termsSummary,
    }, user.id);
  }
  invitation.status = 'accepted';
  invitation.acceptedBy = user.id;
  invitation.acceptedAt = acceptedAt;
  invitation.updatedAt = acceptedAt;
  invitation.accountSetup = { profileCompletion: completion, documentSubmitted: Boolean(submittedDocument), emailVerified: true, phoneVerified: Boolean(user.phoneVerifiedAt) };
  await persist('User', user);
  await persistInvitation(invitation);
  await audit('invitation.accepted', user.id, invitation.id, { type: invitation.type, companyId: user.companyId || '', profileCompletion: completion.percent });
  if (!user.phoneVerifiedAt && phone) {
    try { await require('../auth/phoneVerificationService').requestCode(user.id); }
    catch (error) { logger.error('Initial invitation phone verification could not be queued', { userId: user.id, error: error.message }); }
  }
  return { invitation, user, company };
}

async function rejectInvitation(token, payload = {}) {
  const invitation = await findByToken(token);
  if (!invitation || invitation.status !== 'sent') {
    const error = new Error('Invitation link is invalid, expired, or no longer active');
    error.status = 400;
    throw error;
  }
  invitation.status = 'rejected';
  invitation.rejectedAt = new Date().toISOString();
  invitation.rejectionReason = cleanText(payload.reason || payload.note || 'Invitee declined invitation');
  invitation.updatedAt = invitation.rejectedAt;
  await persistInvitation(invitation);
  await audit('invitation.rejected', invitation.email, invitation.id, { type: invitation.type, reason: invitation.rejectionReason });
  return invitation;
}

async function listInvitations(filter = {}) {
  const rows = await onboardingRepository.invitations.list(filter.companyId ? { companyId: filter.companyId } : {}, { sort: { createdAt: -1 }, limit: 5000 });
  const changed = [];
  rows.forEach((row) => { const previous = row.status; expireOld(row); if (row.status !== previous) changed.push(row); });
  await Promise.all(changed.map((row) => persistInvitation(row, { id: row.id })));
  return rows;
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
