const { platformCurrency } = require('../../utils/currency');
const onboardingRepository = require('../../repositories/domain/onboardingRepository');
const notificationService = require('../notification/notificationService');
const walletService = require('../wallet/walletService');
const { nextId } = require('../data/idService');
const { normalizePermissions, REQUIRED_DRIVER_PERMISSIONS } = require('../../config/accessControl');

function cleanText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

function normalize(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  throw error;
}

function forbidden(message) {
  const error = new Error(message);
  error.status = 403;
  throw error;
}

function invalid(message) {
  const error = new Error(message);
  error.status = 422;
  throw error;
}

const COMPANY_CHECKS = [
  ['email_verified', 'Owner email verified'],
  ['business_license', 'Business license'],
  ['agreement_confirmed', 'Agreement / terms confirmed'],
  ['payout_account', 'Payout account'],
  ['support_contacts', 'Support contacts'],
  ['inventory_ready', 'Service inventory readiness'],
  ['phone_verified', 'Owner phone verified'],
];

const DRIVER_CHECKS = [
  ['email_verified', 'Driver email verified'],
  ['driver_license', 'Driver license'],
  ['identity_document', 'Identity document'],
  ['company_assignment', 'Company assignment'],
  ['safety_clearance', 'Safety clearance'],
  ['trip_permissions', 'Manifest/check-in permissions'],
  ['phone_verified', 'Driver phone verified'],
];

const PROMOTER_CHECKS = [
  ['email_verified', 'Promoter email verified'],
  ['identity_document', 'Identity document'],
  ['payout_account', 'Payout account'],
  ['terms_confirmed', 'Promoter terms confirmed'],
  ['fraud_training', 'Fraud and offline-sales training'],
  ['phone_verified', 'Promoter phone verified'],
];

function checklistTemplate(targetType) {
  const rows = targetType === 'driver'
    ? DRIVER_CHECKS
    : targetType === 'promoter'
      ? PROMOTER_CHECKS
      : COMPANY_CHECKS;
  return rows.map(([key, label]) => ({
    key,
    label,
    required: true,
    status: 'missing',
    value: '',
    notes: '',
  }));
}

async function audit(action, actorId, targetType, targetId, metadata = {}) {
  const row = {
    id: await nextId('audit'),
    actorId: actorId || 'system',
    action,
    entityType: targetType,
    entityId: targetId,
    target: targetId,
    metadata,
    status: 'success',
    createdAt: new Date().toISOString(),
  };
  await onboardingRepository.auditLogs.save(row, { id: row.id });
  return row;
}

async function summarizeInventory(companyId) {
  const id = cleanText(companyId);
  const [listings, activeListings, routes, schedules, vehicles, properties, roomTypes, roomUnits] = await Promise.all([
    onboardingRepository.listings.count({ companyId: id, status: { $ne: 'archived' } }),
    onboardingRepository.listings.count({ companyId: id, status: 'active' }),
    onboardingRepository.routes.count({ companyId: id, status: { $ne: 'archived' } }),
    onboardingRepository.schedules.count({ companyId: id, status: { $ne: 'archived' } }),
    onboardingRepository.vehicles.count({ companyId: id, status: { $ne: 'archived' } }),
    onboardingRepository.hotelProperties.count({ companyId: id, status: { $ne: 'archived' } }),
    onboardingRepository.roomTypes.count({ companyId: id, status: { $ne: 'archived' } }),
    onboardingRepository.roomUnits.count({ companyId: id, status: { $ne: 'archived' } }),
  ]);
  return {
    listings,
    activeListings,
    routes,
    schedules,
    vehicles,
    properties,
    roomTypes,
    roomUnits,
    ready: listings > 0 && (schedules > 0 || vehicles > 0 || properties > 0 || roomTypes > 0 || roomUnits > 0),
  };
}

async function findTarget(targetType, targetId) {
  const type = normalize(targetType || 'company');
  const id = cleanText(targetId);
  if (type === 'driver') {
    const employee = await onboardingRepository.employees.findOne({ $or: [{ id }, { userId: id }] });
    return { type: 'driver', entity: employee, companyId: employee?.companyId || '' };
  }
  if (type === 'promoter') {
    const user = await onboardingRepository.users.findOne({ id });
    const valid = user && (user.requestedRole === 'promoter' || user.role === 'promoter');
    return { type: 'promoter', entity: valid ? user : null, companyId: '' };
  }
  const company = await onboardingRepository.companies.findOne({ id });
  return { type: 'company', entity: company, companyId: company?.id || '' };
}

async function getReview(targetType, targetId, options = {}) {
  const target = await findTarget(targetType, targetId);
  if (!target.entity) {
    const label = target.type === 'driver' ? 'Driver' : target.type === 'promoter' ? 'Promoter' : 'Company';
    notFound(`${label} not found for verification`);
  }
  let review = await onboardingRepository.verificationReviews.findOne({
    targetType: target.type,
    targetId: target.entity.id,
  });
  if (!review && options.create !== false) {
    review = {
      id: await nextId('verification'),
      targetType: target.type,
      targetId: target.entity.id,
      companyId: target.companyId,
      status: 'draft',
      riskLevel: 'medium',
      checklist: checklistTemplate(target.type),
      documents: [],
      payoutAccount: {},
      supportContacts: {},
      inventorySummary: target.type === 'company' ? await summarizeInventory(target.companyId) : {},
      agreementSummary: '',
      auditTrail: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await onboardingRepository.verificationReviews.save(review, { id: review.id });
  } else if (review) {
    review.checklist = Array.isArray(review.checklist) ? review.checklist : [];
    let changed = false;
    for (const template of checklistTemplate(target.type)) {
      if (!review.checklist.some((item) => item.key === template.key)) {
        review.checklist.push(template);
        changed = true;
      }
    }
    if (changed) {
      review.updatedAt = new Date().toISOString();
      review.status = pendingRequired(review).length ? 'pending_review' : review.status;
      await onboardingRepository.verificationReviews.save(review, { id: review.id });
    }
  }
  return review;
}

function checklistItem(review, key) {
  const normalized = normalize(key);
  review.checklist = Array.isArray(review.checklist) ? review.checklist : [];
  let row = review.checklist.find((check) => check.key === normalized);
  if (!row) {
    row = { key: normalized, label: cleanText(key), required: true, status: 'missing' };
    review.checklist.push(row);
  }
  return row;
}

function pendingRequired(review) {
  return (review.checklist || []).filter((check) => check.required !== false && !['approved', 'waived'].includes(check.status));
}

function markItem(review, key, status, actorId, payload = {}) {
  const allowed = new Set(['missing', 'submitted', 'approved', 'rejected', 'waived']);
  if (!allowed.has(status)) invalid('Invalid verification checklist status');
  const now = new Date().toISOString();
  const check = checklistItem(review, key);
  check.status = status;
  if (payload.value !== undefined) check.value = cleanText(payload.value);
  if (payload.documentReference !== undefined) check.documentReference = cleanText(payload.documentReference);
  if (payload.notes !== undefined || payload.note !== undefined) check.notes = cleanText(payload.notes || payload.note);
  if (status === 'submitted') {
    check.submittedBy = actorId;
    check.submittedAt = now;
  }
  if (['approved', 'rejected', 'waived'].includes(status)) {
    check.reviewedBy = actorId;
    check.reviewedAt = now;
    check.reviewNotes = cleanText(payload.reviewNotes || payload.note || '');
  }
  review.updatedAt = now;
  review.status = status === 'rejected' ? 'rejected' : pendingRequired(review).length ? 'pending_review' : 'approved';
  review.auditTrail = Array.isArray(review.auditTrail) ? review.auditTrail : [];
  review.auditTrail.unshift({
    action: `check.${status}`,
    key: check.key,
    actorId,
    at: now,
    note: check.reviewNotes || check.notes || '',
  });
  return check;
}

async function submitCompanyChecklist(companyId, payload = {}, actorId = 'company-system') {
  const company = await onboardingRepository.companies.findOne({ id: cleanText(companyId) });
  if (!company) notFound('Company not found');
  const review = await getReview('company', company.id);
  const previousPayout = typeof company.payoutAccount === 'object' && company.payoutAccount ? company.payoutAccount : {};
  const payoutAccount = {
    method: cleanText(payload.payoutMethod || previousPayout.method || ''),
    provider: cleanText(payload.payoutProvider || payload.bankName || previousPayout.provider || company.payoutAccountProvider || ''),
    accountName: cleanText(payload.accountName || previousPayout.accountName || company.payoutAccountName || company.name),
    accountNumber: cleanText(payload.accountNumber || payload.payoutAccount || previousPayout.accountNumber || company.settings?.payoutAccount || ''),
    currency: cleanText(payload.currency || previousPayout.currency || company.operatingCurrency || company.settings?.defaultCurrency || platformCurrency()).toUpperCase(),
  };
  const supportContacts = {
    phone: cleanText(payload.supportPhone || payload.phone || company.supportContacts?.phone || ''),
    email: cleanText(payload.supportEmail || payload.email || company.supportContacts?.email || '').toLowerCase(),
    whatsapp: cleanText(payload.supportWhatsapp || payload.whatsapp || company.supportContacts?.whatsapp || ''),
  };
  company.payoutAccount = payoutAccount;
  company.payoutAccountProvider = payoutAccount.provider;
  company.payoutAccountName = payoutAccount.accountName;
  company.supportContacts = { ...(company.supportContacts || {}), ...supportContacts };
  const canAlreadyPublish = company.verificationStatus === 'verified' && company.settings?.canPublish !== false;
  company.settings = {
    ...(company.settings || {}),
    payoutAccount: payoutAccount.accountNumber,
    onboardingStep: canAlreadyPublish ? (company.settings?.onboardingStep || 'complete') : 'verification',
    canPublish: canAlreadyPublish,
    instantConfirmation: canAlreadyPublish ? company.settings?.instantConfirmation !== false : false,
  };
  review.payoutAccount = payoutAccount;
  review.supportContacts = supportContacts;
  review.agreementSummary = cleanText(payload.agreementSummary || payload.termsSummary || review.agreementSummary || '');
  review.inventorySummary = await summarizeInventory(company.id);
  markItem(review, 'payout_account', payoutAccount.accountNumber ? 'submitted' : 'missing', actorId, {
    value: payoutAccount.accountNumber,
    notes: payoutAccount.provider,
  });
  markItem(review, 'support_contacts', supportContacts.phone || supportContacts.email ? 'submitted' : 'missing', actorId, {
    value: [supportContacts.phone, supportContacts.email].filter(Boolean).join(' / '),
  });
  markItem(review, 'agreement_confirmed', payload.agreementAccepted === 'on' || payload.agreementAccepted === true || review.agreementSummary ? 'submitted' : 'missing', actorId, {
    value: review.agreementSummary,
  });
  markItem(review, 'inventory_ready', review.inventorySummary.ready ? 'submitted' : 'missing', actorId, {
    value: JSON.stringify(review.inventorySummary),
  });
  if ((company.documents || []).length || payload.documentReference) {
    markItem(review, 'business_license', 'submitted', actorId, {
      value: `${Math.max((company.documents || []).length, payload.documentReference ? 1 : 0)} document(s)`,
      documentReference: payload.documentReference,
    });
  }
  const owner = company.ownerId ? await onboardingRepository.users.findOne({ id: company.ownerId }) : null;
  markItem(review, 'email_verified', !owner?.email || owner?.emailVerifiedAt ? 'submitted' : 'missing', actorId, {
    value: owner?.email || '',
    notes: !owner?.email ? 'Email not required' : owner?.emailVerifiedAt ? `Verified ${owner.emailVerifiedAt}` : 'Owner must verify the account email address',
  });
  markItem(review, 'phone_verified', owner?.phoneVerifiedAt ? 'submitted' : 'missing', actorId, {
    value: owner?.phone || '',
    notes: owner?.phoneVerifiedAt ? `Verified ${owner.phoneVerifiedAt}` : 'Owner must verify the account phone number',
  });
  review.submittedBy = actorId;
  review.submittedAt = new Date().toISOString();
  review.status = pendingRequired(review).length ? 'pending_review' : 'approved';
  await onboardingRepository.withTransaction(async (session) => {
    await onboardingRepository.companies.save(company, { id: company.id }, { session });
    await onboardingRepository.verificationReviews.save(review, { id: review.id }, { session });
  });
  await audit('company.verification.submitted', actorId, 'company', company.id, { reviewId: review.id });
  await notificationService.queueNotification({
    ownerType: 'verification',
    ownerId: review.id,
    channels: ['email'],
    title: 'Partner verification submitted',
    message: `${company.name} submitted verification details for review.`,
    referenceType: 'verification',
    referenceId: review.id,
  });
  return review;
}

async function submitDriverChecklist(driverId, payload = {}, actorId = 'company-system', scopeCompanyId = '') {
  const target = await findTarget('driver', driverId);
  if (!target.entity) notFound('Driver not found');
  if (scopeCompanyId && String(target.companyId) !== String(scopeCompanyId)) {
    forbidden('This driver does not belong to your company');
  }
  const driver = target.entity;
  const review = await getReview('driver', driver.id);
  driver.licenseNumber = cleanText(payload.licenseNumber || driver.licenseNumber || '');
  driver.safetyStatus = 'pending_review';
  driver.documents = Array.isArray(driver.documents) ? driver.documents : [];
  const documentReference = cleanText(payload.documentReference || payload.licenseNumber || '');
  if (documentReference && !driver.documents.some((row) => cleanText(row.documentReference) === documentReference)) {
    driver.documents.unshift({
      documentType: cleanText(payload.documentType || 'driver_license'),
      documentReference,
      status: 'pending_review',
      uploadedBy: actorId,
      uploadedAt: new Date().toISOString(),
    });
  }
  markItem(review, 'driver_license', driver.licenseNumber || documentReference ? 'submitted' : 'missing', actorId, {
    value: driver.licenseNumber,
    documentReference,
  });
  markItem(review, 'identity_document', payload.identityReference ? 'submitted' : 'missing', actorId, {
    documentReference: payload.identityReference,
  });
  markItem(review, 'company_assignment', driver.companyId ? 'submitted' : 'missing', actorId, { value: driver.companyId });
  markItem(review, 'safety_clearance', payload.safetyCleared === 'on' || payload.safetyCleared === true ? 'submitted' : 'missing', actorId, {
    notes: payload.safetyNote,
  });
  const grantedPermissions = new Set(normalizePermissions(driver.permissions || []));
  const hasRequiredDriverPermissions = REQUIRED_DRIVER_PERMISSIONS.every((permission) => grantedPermissions.has(permission));
  markItem(review, 'trip_permissions', hasRequiredDriverPermissions ? 'submitted' : 'missing', actorId, {
    value: Array.from(grantedPermissions).join(', '),
    notes: hasRequiredDriverPermissions ? 'All required driver permissions are present' : `Missing: ${REQUIRED_DRIVER_PERMISSIONS.filter((permission) => !grantedPermissions.has(permission)).join(', ')}`,
  });
  const driverUser = driver.userId ? await onboardingRepository.users.findOne({ id: driver.userId }) : null;
  markItem(review, 'email_verified', !driverUser?.email || driverUser?.emailVerifiedAt ? 'submitted' : 'missing', actorId, {
    value: driverUser?.email || '',
    notes: !driverUser?.email ? 'Email not required' : driverUser?.emailVerifiedAt ? `Verified ${driverUser.emailVerifiedAt}` : 'Driver must verify the account email address',
  });
  markItem(review, 'phone_verified', driverUser?.phoneVerifiedAt ? 'submitted' : 'missing', actorId, {
    value: driverUser?.phone || '',
    notes: driverUser?.phoneVerifiedAt ? `Verified ${driverUser.phoneVerifiedAt}` : 'Driver must verify the account phone number',
  });
  review.submittedBy = actorId;
  review.submittedAt = new Date().toISOString();
  await onboardingRepository.withTransaction(async (session) => {
    await onboardingRepository.employees.save(driver, { id: driver.id }, { session });
    await onboardingRepository.verificationReviews.save(review, { id: review.id }, { session });
  });
  await audit('driver.verification.submitted', actorId, 'driver', driver.id, { reviewId: review.id });
  return review;
}

async function submitPromoterChecklist(promoterId, payload = {}, actorId = 'promoter-system') {
  const user = await onboardingRepository.users.findOne({ id: cleanText(promoterId), role: 'promoter' });
  if (!user) notFound('Promoter account not found');
  const review = await getReview('promoter', user.id);
  const payoutAccount = {
    method: cleanText(payload.payoutMethod || user.payoutAccount?.method || 'Mobile Money'),
    provider: cleanText(payload.payoutProvider || user.promoterProfile?.payoutProvider || ''),
    account: cleanText(payload.payoutAccount || user.payoutAccount?.account || user.phone || ''),
  };
  const documentType = cleanText(payload.documentType || payload.verificationDocumentType || user.verificationDocumentType || 'national_id');
  const documentReference = cleanText(payload.documentReference || payload.verificationReference || user.verificationReference || '');
  const termsAccepted = payload.termsAccepted === 'on' || payload.termsAccepted === true || payload.agreementAccepted === 'on' || payload.agreementAccepted === true;
  const trainingAcknowledged = payload.trainingAcknowledged === 'on' || payload.trainingAcknowledged === true || payload.fraudTrainingAccepted === 'on' || payload.fraudTrainingAccepted === true;
  user.verificationStatus = 'pending';
  user.verificationDocumentType = documentType;
  user.verificationReference = documentReference;
  user.payoutAccount = payoutAccount;
  user.promoterProfile = {
    ...(user.promoterProfile || {}),
    payoutProvider: payoutAccount.provider,
    payoutMethod: payoutAccount.method,
    payoutAccount: payoutAccount.account,
    verificationNote: cleanText(payload.message || payload.notes || user.promoterProfile?.verificationNote || ''),
    termsAcceptedAt: termsAccepted ? (user.promoterProfile?.termsAcceptedAt || new Date().toISOString()) : user.promoterProfile?.termsAcceptedAt,
    fraudTrainingAcknowledgedAt: trainingAcknowledged ? (user.promoterProfile?.fraudTrainingAcknowledgedAt || new Date().toISOString()) : user.promoterProfile?.fraudTrainingAcknowledgedAt,
    onboardingStatus: 'verification_submitted',
  };
  user.updatedAt = new Date().toISOString();
  review.payoutAccount = payoutAccount;
  markItem(review, 'identity_document', documentReference ? 'submitted' : 'missing', actorId, {
    value: documentType,
    documentReference,
  });
  markItem(review, 'payout_account', payoutAccount.account ? 'submitted' : 'missing', actorId, {
    value: payoutAccount.account,
    notes: [payoutAccount.method, payoutAccount.provider].filter(Boolean).join(' / '),
  });
  markItem(review, 'terms_confirmed', termsAccepted || user.promoterProfile?.termsAcceptedAt ? 'submitted' : 'missing', actorId, {
    value: termsAccepted ? 'Promoter terms accepted' : '',
  });
  markItem(review, 'fraud_training', trainingAcknowledged || user.promoterProfile?.fraudTrainingAcknowledgedAt ? 'submitted' : 'missing', actorId, {
    value: trainingAcknowledged ? 'Fraud and offline-sales rules acknowledged' : '',
  });
  markItem(review, 'email_verified', !user.email || user.emailVerifiedAt ? 'submitted' : 'missing', actorId, {
    value: user.email || '',
    notes: !user.email ? 'Email not required' : user.emailVerifiedAt ? `Verified ${user.emailVerifiedAt}` : 'Promoter must verify the account email address',
  });
  markItem(review, 'phone_verified', user.phoneVerifiedAt ? 'submitted' : 'missing', actorId, {
    value: user.phone || '',
    notes: user.phoneVerifiedAt ? `Verified ${user.phoneVerifiedAt}` : 'Promoter must verify the account phone number',
  });
  review.submittedBy = actorId;
  review.submittedAt = new Date().toISOString();
  review.status = pendingRequired(review).length ? 'pending_review' : 'approved';
  await onboardingRepository.withTransaction(async (session) => {
    await onboardingRepository.users.save(user, { id: user.id }, { session });
    await onboardingRepository.verificationReviews.save(review, { id: review.id }, { session });
  });
  await audit('promoter.verification.submitted', actorId, 'promoter', user.id, { reviewId: review.id });
  await notificationService.queueNotification({
    ownerType: 'verification',
    ownerId: review.id,
    channels: ['email'],
    title: 'Promoter verification submitted',
    message: `${user.fullName || user.email || user.id} submitted promoter verification details for review.`,
    referenceType: 'verification',
    referenceId: review.id,
  });
  return review;
}


async function invalidateContactVerificationForUser(userId, changes = {}, actorId = 'system') {
  const user = await onboardingRepository.users.findOne({ id: cleanText(userId) });
  if (!user) notFound('User not found for contact verification reset');
  const emailChanged = Boolean(changes.emailChanged);
  const phoneChanged = Boolean(changes.phoneChanged);
  if (!emailChanged && !phoneChanged) return { user, targetType: '', targetId: '' };

  const now = new Date().toISOString();
  if (emailChanged) {
    user.emailVerifiedAt = null;
    user.emailVerifyToken = undefined;
    user.emailVerifyTokenExpiresAt = undefined;
    user.isVerified = false;
  }
  if (phoneChanged) {
    user.phoneVerifiedAt = null;
    user.phoneVerificationStatus = user.phone ? 'pending' : 'not_required';
    user.phoneVerification = null;
  }

  let targetType = '';
  let targetId = '';
  let review = null;
  let company = null;
  let employee = null;
  const role = normalize(user.role);

  if (role === 'company_admin') {
    company = await onboardingRepository.companies.findOne({ $or: [{ id: user.companyId }, { ownerId: user.id }] });
    if (company) {
      targetType = 'company';
      targetId = company.id;
      company.status = 'pending';
      company.verificationStatus = 'pending';
      company.settings = {
        ...(company.settings || {}),
        canPublish: false,
        instantConfirmation: false,
        onboardingStep: 'contact_reverification',
      };
      company.updatedAt = now;
      review = await getReview('company', company.id);
    }
    user.verificationStatus = 'pending';
    user.onboardingStatus = 'company_verification';
  } else if (role === 'promoter') {
    targetType = 'promoter';
    targetId = user.id;
    user.verificationStatus = 'pending';
    user.onboardingStatus = 'promoter_verification';
    review = await getReview('promoter', user.id);
  } else if (role === 'driver') {
    employee = await onboardingRepository.employees.findOne({ userId: user.id, companyId: user.companyId });
    if (employee) {
      targetType = 'driver';
      targetId = employee.id;
      employee.status = 'pending_verification';
      employee.onboardingStatus = 'contact_reverification';
      employee.updatedAt = now;
      review = await getReview('driver', employee.id);
      await onboardingRepository.driverAssignments.updateMany(
        { $or: [{ employeeId: employee.id }, { driverUserId: user.id }], status: { $nin: ['revoked', 'archived'] } },
        { $set: { status: 'suspended', suspensionReason: 'Driver contact changed and must be reverified', updatedAt: new Date(now) } }
      );
    }
    user.verificationStatus = 'pending';
    user.onboardingStatus = 'driver_verification';
  } else if (role === 'company_employee' && emailChanged) {
    employee = await onboardingRepository.employees.findOne({ userId: user.id, companyId: user.companyId });
    if (employee) {
      employee.status = 'pending_verification';
      employee.onboardingStatus = 'contact_reverification';
      employee.updatedAt = now;
    }
    user.verificationStatus = 'pending';
    user.onboardingStatus = 'contact_reverification';
  }

  if (review) {
    if (emailChanged) markItem(review, 'email_verified', 'missing', actorId, { value: user.email || '', notes: 'Contact changed; verify the new email address' });
    if (phoneChanged) markItem(review, 'phone_verified', 'missing', actorId, { value: user.phone || '', notes: user.phone ? 'Contact changed; verify the new phone number' : 'A verified phone number is required' });
    review.status = 'pending_review';
    review.updatedAt = now;
  }
  user.updatedAt = now;

  await onboardingRepository.withTransaction(async (session) => {
    await onboardingRepository.users.save(user, { id: user.id }, { session });
    if (company) await onboardingRepository.companies.save(company, { id: company.id }, { session });
    if (employee) await onboardingRepository.employees.save(employee, { id: employee.id }, { session });
    if (review) await onboardingRepository.verificationReviews.save(review, { id: review.id }, { session });
  });
  await audit('account.contact_verification_reset', actorId, targetType || 'user', targetId || user.id, {
    userId: user.id,
    emailChanged,
    phoneChanged,
  });
  return { user, company, employee, review, targetType, targetId };
}

async function markPhoneVerifiedForUser(userId, actorId = 'system') {
  const user = await onboardingRepository.users.findOne({ id: cleanText(userId) });
  if (!user || !user.phoneVerifiedAt) return null;
  let targetType = '';
  let targetId = '';
  if (user.role === 'company_admin' && user.companyId) {
    targetType = 'company';
    targetId = user.companyId;
  } else if (user.role === 'promoter') {
    targetType = 'promoter';
    targetId = user.id;
  } else if (user.role === 'driver') {
    const employee = await onboardingRepository.employees.findOne({ userId: user.id, companyId: user.companyId });
    if (employee) {
      targetType = 'driver';
      targetId = employee.id;
    }
  }
  if (!targetType || !targetId) return null;
  const review = await getReview(targetType, targetId);
  markItem(review, 'phone_verified', 'submitted', actorId, {
    value: user.phone,
    notes: `Verified ${user.phoneVerifiedAt}`,
  });
  await onboardingRepository.verificationReviews.save(review, { id: review.id });
  await audit('account.phone_verified', actorId, targetType, targetId, { userId: user.id, reviewId: review.id });
  return review;
}

async function markEmailVerifiedForUser(userId, actorId = 'system') {
  const user = await onboardingRepository.users.findOne({ id: cleanText(userId) });
  if (!user || !user.emailVerifiedAt) return null;
  let targetType = '';
  let targetId = '';
  if (user.role === 'company_admin' && user.companyId) {
    targetType = 'company';
    targetId = user.companyId;
  } else if (user.role === 'promoter') {
    targetType = 'promoter';
    targetId = user.id;
  } else if (user.role === 'driver') {
    const employee = await onboardingRepository.employees.findOne({ userId: user.id, companyId: user.companyId });
    if (employee) {
      targetType = 'driver';
      targetId = employee.id;
    }
  }
  if (!targetType || !targetId) {
    if (user.role === 'company_employee') {
      const employee = await onboardingRepository.employees.findOne({ userId: user.id, companyId: user.companyId });
      const company = user.companyId ? await onboardingRepository.companies.findOne({ id: user.companyId, status: 'active', verificationStatus: 'verified' }) : null;
      if (employee && company && employee.acceptedAt && user.passwordHash && !['suspended', 'rejected', 'revoked'].includes(employee.status)) {
        user.status = 'active';
        user.isVerified = true;
        user.verificationStatus = 'verified';
        user.onboardingStatus = 'complete';
        user.updatedAt = new Date().toISOString();
        employee.status = 'active';
        employee.onboardingStatus = 'complete';
        employee.updatedAt = user.updatedAt;
        await onboardingRepository.withTransaction(async (session) => {
          await onboardingRepository.users.save(user, { id: user.id }, { session });
          await onboardingRepository.employees.save(employee, { id: employee.id }, { session });
        });
        await audit('staff.email_reverified', actorId, 'company_employee', employee.id, { userId: user.id, companyId: company.id });
        return { employee, user };
      }
    }
    return null;
  }
  const review = await getReview(targetType, targetId);
  markItem(review, 'email_verified', 'submitted', actorId, {
    value: user.email,
    notes: `Verified ${user.emailVerifiedAt}`,
  });
  await onboardingRepository.verificationReviews.save(review, { id: review.id });
  await audit('account.email_verified', actorId, targetType, targetId, { userId: user.id, reviewId: review.id });
  return review;
}

async function reviewChecklistItem(targetType, targetId, key, status, actorId = 'admin-system', payload = {}) {
  const review = await getReview(targetType, targetId);
  const safeStatus = ['approved', 'rejected', 'waived'].includes(normalize(status)) ? normalize(status) : 'approved';
  const check = markItem(review, key, safeStatus, actorId, payload);
  await onboardingRepository.verificationReviews.save(review, { id: review.id });
  await audit(`admin.verification.${safeStatus}`, actorId, review.targetType, review.targetId, {
    reviewId: review.id,
    key: check.key,
  });
  return review;
}

async function activateCompany(review, actorId, session) {
  const company = await onboardingRepository.companies.findOne({ id: review.targetId }, { session });
  if (!company) notFound('Company not found');
  const now = new Date().toISOString();
  const ownerForPhone = company.ownerId ? await onboardingRepository.users.findOne({ id: company.ownerId }, { session }) : null;
  if (ownerForPhone?.email && !ownerForPhone.emailVerifiedAt) invalid('Company owner email verification is required before activation');
  if (!ownerForPhone?.phoneVerifiedAt) invalid('Company owner phone verification is required before activation');
  company.verificationStatus = 'verified';
  company.status = 'active';
  company.settings = { ...(company.settings || {}), canPublish: true, instantConfirmation: true, onboardingStep: 'complete' };
  company.reviewedBy = actorId;
  company.reviewedAt = now;
  company.reviewNotes = cleanText(review.reviewNotes || 'Verification checklist approved.');
  const listings = await onboardingRepository.listings.list({ companyId: company.id }, { session });
  listings.forEach((listing) => {
    listing.isVerified = true;
    if (listing.status === 'active') listing.bookable = true;
  });
  const owner = company.ownerId ? await onboardingRepository.users.findOne({ id: company.ownerId }, { session }) : null;
  if (owner) {
    owner.status = 'active';
    owner.isVerified = true;
    owner.verificationStatus = 'verified';
    owner.onboardingStatus = 'complete';
    owner.updatedAt = now;
  }
  await onboardingRepository.companies.save(company, { id: company.id }, { session });
  await onboardingRepository.listings.saveMany(listings, (row) => ({ id: row.id }), { session });
  if (owner) await onboardingRepository.users.save(owner, { id: owner.id }, { session });
  return { company, listings, owner };
}

async function activatePromoter(review, actorId, session) {
  const user = await onboardingRepository.users.findOne({ id: review.targetId }, { session });
  if (!user) notFound('Promoter applicant not found');
  const now = new Date().toISOString();
  if (user.email && !user.emailVerifiedAt) invalid('Promoter email verification is required before activation');
  if (!user.phoneVerifiedAt) invalid('Promoter phone verification is required before activation');
  user.role = 'promoter';
  user.status = 'active';
  user.isVerified = true;
  user.verificationStatus = 'verified';
  user.onboardingStatus = 'complete';
  delete user.requestedRole;
  user.roleChangeStatus = 'approved';
  user.promoterProfile = { ...(user.promoterProfile || {}), applicationStatus: 'approved', offlineSalesEnabled: false };
  user.updatedAt = now;
  const profile = await onboardingRepository.agentProfiles.findOne({ $or: [{ userId: user.id }, { promoterId: user.id }] }, { session });
  if (profile) {
    profile.status = 'active';
    profile.offlineSalesEnabled = false;
    profile.verifiedAt = now;
    profile.updatedBy = actorId;
    await onboardingRepository.agentProfiles.save(profile, { userId: user.id }, { session });
  }
  await onboardingRepository.users.save(user, { id: user.id }, { session });
  return { user, profile };
}

async function activateDriver(review, actorId, session) {
  const employee = await onboardingRepository.employees.findOne({ id: review.targetId }, { session });
  if (!employee) notFound('Driver not found');
  const now = new Date().toISOString();
  const company = await onboardingRepository.companies.findOne({ id: employee.companyId }, { session });
  if (!company || String(company.status || '').toLowerCase() !== 'active' || String(company.verificationStatus || '').toLowerCase() !== 'verified') {
    invalid('The driver company must remain active and verified before driver activation');
  }
  const driverAccount = employee.userId ? await onboardingRepository.users.findOne({ id: employee.userId }, { session }) : null;
  if (!driverAccount || driverAccount.role !== 'driver') invalid('Driver activation requires a dedicated driver account');
  if (!driverAccount.passwordHash || !employee.acceptedAt) invalid('Driver invitation must be accepted before activation');
  if (driverAccount.email && !driverAccount.emailVerifiedAt) invalid('Driver email verification is required before activation');
  if (!driverAccount.phoneVerifiedAt) invalid('Driver phone verification is required before activation');
  const grantedPermissions = new Set(normalizePermissions(employee.permissions || []));
  if (!REQUIRED_DRIVER_PERMISSIONS.every((permission) => grantedPermissions.has(permission))) {
    invalid('Driver is missing required manifest, check-in, trip-status, or incident permissions');
  }
  if (!employee.licenseNumber || !(employee.documents || []).some((row) => cleanText(row.documentReference))) {
    invalid('Driver licence documentation is required before activation');
  }
  let assignment = null;
  const vehicleId = cleanText(employee.pendingVehicleId || '');
  const scheduleId = cleanText(employee.pendingScheduleId || '');
  if (vehicleId) {
    const vehicle = await onboardingRepository.vehicles.findOne({ id: vehicleId, companyId: employee.companyId }, { session });
    if (!vehicle || String(vehicle.status || '').toLowerCase() === 'archived') invalid('The requested driver vehicle is no longer available to this company');
  }
  if (scheduleId) {
    const schedule = await onboardingRepository.schedules.findOne({ id: scheduleId, companyId: employee.companyId }, { session });
    if (!schedule || String(schedule.status || '').toLowerCase() === 'archived') invalid('The requested driver schedule is no longer available to this company');
  }
  if (vehicleId || scheduleId) {
    assignment = await onboardingRepository.driverAssignments.findOne({
      companyId: employee.companyId,
      employeeId: employee.id,
      ...(scheduleId ? { scheduleId } : { vehicleId }),
      status: 'active',
    }, { session });
    if (!assignment) {
      assignment = {
        id: await nextId('driver-assignment'),
        companyId: employee.companyId,
        employeeId: employee.id,
        driverUserId: employee.userId,
        vehicleId,
        scheduleId,
        assignmentType: scheduleId ? 'schedule' : 'vehicle',
        assignmentRole: 'driver',
        safetyStatus: 'cleared',
        status: 'active',
        note: `Activated from driver verification ${review.id}`,
        assignedBy: actorId,
        createdAt: now,
        updatedAt: now,
      };
      await onboardingRepository.driverAssignments.save(assignment, { id: assignment.id }, { session });
    }
  }
  employee.status = 'active';
  employee.safetyStatus = 'cleared';
  employee.verifiedBy = actorId;
  employee.verifiedAt = now;
  employee.onboardingStatus = 'complete';
  employee.pendingVehicleId = '';
  employee.pendingScheduleId = '';
  const user = await onboardingRepository.users.findOne({ id: employee.userId }, { session });
  if (user) {
    user.companyId = employee.companyId;
    user.status = 'active';
    user.isVerified = true;
    user.verificationStatus = 'verified';
    user.onboardingStatus = 'complete';
    user.updatedAt = now;
    await onboardingRepository.users.save(user, { id: user.id }, { session });
  }
  await onboardingRepository.employees.save(employee, { id: employee.id }, { session });
  return { employee, user, assignment };
}

async function activateTarget(targetType, targetId, actorId = 'admin-system') {
  const review = await getReview(targetType, targetId);
  const missing = pendingRequired(review);
  if (missing.length) {
    invalid(`Cannot activate until these checklist items are approved: ${missing.map((row) => row.label).join(', ')}`);
  }
  let changed;
  await onboardingRepository.withTransaction(async (session) => {
    if (review.targetType === 'company') changed = await activateCompany(review, actorId, session);
    else if (review.targetType === 'promoter') changed = await activatePromoter(review, actorId, session);
    else if (review.targetType === 'driver') changed = await activateDriver(review, actorId, session);
    else invalid('Unsupported verification target');
    const now = new Date().toISOString();
    review.status = 'activated';
    review.reviewedBy = actorId;
    review.reviewedAt = now;
    review.activatedBy = actorId;
    review.activatedAt = now;
    review.auditTrail = Array.isArray(review.auditTrail) ? review.auditTrail : [];
    review.auditTrail.unshift({ action: 'verification.activated', actorId, at: now });
    await onboardingRepository.verificationReviews.save(review, { id: review.id }, { session });
  });
  if (review.targetType === 'promoter') {
    await walletService.getOrCreateWallet('promoter', review.targetId, changed.user?.payoutAccount?.currency || platformCurrency());
  }
  await audit('admin.verification.activated', actorId, review.targetType, review.targetId, { reviewId: review.id });
  await notificationService.queueNotification({
    ownerType: review.targetType,
    ownerId: review.targetId,
    channels: ['email'],
    title: 'Classic Trip verification approved',
    message: `Your ${review.targetType} verification checklist was approved and activated.`,
    referenceType: 'verification',
    referenceId: review.id,
  });
  return review;
}

async function rejectTarget(targetType, targetId, actorId = 'admin-system', reason = '') {
  const review = await getReview(targetType, targetId);
  let changed = {};
  await onboardingRepository.withTransaction(async (session) => {
    const now = new Date().toISOString();
    review.status = 'rejected';
    review.rejectionReason = cleanText(reason);
    review.reviewedBy = actorId;
    review.reviewedAt = now;
    if (review.targetType === 'company') {
      const company = await onboardingRepository.companies.findOne({ id: review.targetId }, { session });
      if (!company) notFound('Company not found');
      company.verificationStatus = 'rejected';
      company.status = 'rejected';
      company.settings = { ...(company.settings || {}), canPublish: false, instantConfirmation: false, onboardingStep: 'correction_required' };
      await onboardingRepository.companies.save(company, { id: company.id }, { session });
      changed.company = company;
      if (company.ownerId) {
        const owner = await onboardingRepository.users.findOne({ id: company.ownerId }, { session });
        if (owner) {
          owner.onboardingStatus = 'correction_required';
          owner.verificationStatus = 'pending';
          owner.updatedAt = now;
          await onboardingRepository.users.save(owner, { id: owner.id }, { session });
          changed.owner = owner;
        }
      }
    } else if (review.targetType === 'promoter') {
      const user = await onboardingRepository.users.findOne({ id: review.targetId }, { session });
      if (user) {
        delete user.requestedRole;
        user.roleChangeStatus = 'rejected';
        user.verificationStatus = 'pending';
        user.onboardingStatus = 'correction_required';
        user.promoterProfile = { ...(user.promoterProfile || {}), applicationStatus: 'rejected', offlineSalesEnabled: false };
        user.updatedAt = now;
        await onboardingRepository.users.save(user, { id: user.id }, { session });
        changed.user = user;
      }
      const profile = await onboardingRepository.agentProfiles.findOne({ $or: [{ userId: review.targetId }, { promoterId: review.targetId }] }, { session });
      if (profile) {
        profile.status = 'rejected';
        profile.offlineSalesEnabled = false;
        profile.updatedBy = actorId;
        await onboardingRepository.agentProfiles.save(profile, { userId: review.targetId }, { session });
        changed.profile = profile;
      }
    } else if (review.targetType === 'driver') {
      const employee = await onboardingRepository.employees.findOne({ id: review.targetId }, { session });
      if (!employee) notFound('Driver not found');
      employee.status = 'rejected';
      employee.safetyStatus = 'rejected';
      employee.rejectedAt = now;
      await onboardingRepository.employees.save(employee, { id: employee.id }, { session });
      changed.employee = employee;
      if (employee.userId) {
        const user = await onboardingRepository.users.findOne({ id: employee.userId }, { session });
        if (user) {
          user.verificationStatus = 'pending';
          user.onboardingStatus = 'correction_required';
          user.updatedAt = now;
          await onboardingRepository.users.save(user, { id: user.id }, { session });
          changed.user = user;
        }
      }
    }
    await onboardingRepository.verificationReviews.save(review, { id: review.id }, { session });
  });
  await audit('admin.verification.rejected', actorId, review.targetType, review.targetId, {
    reason: review.rejectionReason,
    reviewId: review.id,
  });
  return review;
}

async function listReviews(filter = {}) {
  const [companies, employees, promoters] = await Promise.all([
    onboardingRepository.companies.list({ verificationStatus: { $in: ['pending', 'rejected', 'suspended'] } }),
    onboardingRepository.employees.list({ status: { $in: ['requested', 'invited', 'pending_verification', 'rejected', 'suspended'] } }),
    onboardingRepository.users.list({ role: 'promoter', verificationStatus: { $ne: 'verified' } }),
  ]);
  for (const company of companies) await getReview('company', company.id);
  for (const promoter of promoters) await getReview('promoter', promoter.id);
  for (const employee of employees) {
    const account = employee.userId ? await onboardingRepository.users.findOne({ id: employee.userId }) : null;
    if (account?.role === 'driver') await getReview('driver', employee.id);
  }
  const query = {};
  if (filter.status) query.status = normalize(filter.status);
  if (filter.targetType) query.targetType = normalize(filter.targetType);
  return onboardingRepository.verificationReviews.list(query, { sort: { updatedAt: -1, createdAt: -1 } });
}

module.exports = {
  getReview,
  listReviews,
  submitCompanyChecklist,
  submitDriverChecklist,
  submitPromoterChecklist,
  markPhoneVerifiedForUser,
  markEmailVerifiedForUser,
  invalidateContactVerificationForUser,
  reviewChecklistItem,
  activateTarget,
  rejectTarget,
  summarizeInventory,
  pendingRequired,
};
