const store = require('../data/persistentStore');
const notificationService = require('../notification/notificationService');
const { mongoose } = require('../../config/db');

function cleanText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

function normalize(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
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

function ensureCollections() {
  if (!Array.isArray(store.state.verificationReviews)) store.state.verificationReviews = [];
  if (!Array.isArray(store.state.auditLogs)) store.state.auditLogs = [];
  if (!Array.isArray(store.state.notifications)) store.state.notifications = [];
  if (!Array.isArray(store.state.companyEmployees)) store.state.companyEmployees = [];
}

async function persist(modelName, row, filter = { id: row.id }) {
  if (mongoose.connection.readyState !== 1 || !row) return row;
  require(`../../models/${modelName}`);
  const Model = mongoose.model(modelName);
  await Model.updateOne(filter, { $set: row }, { upsert: true, runValidators: true });
  return row;
}

async function persistMany(modelName, rows) {
  if (mongoose.connection.readyState !== 1 || !rows.length) return rows;
  require(`../../models/${modelName}`);
  const Model = mongoose.model(modelName);
  await Model.bulkWrite(rows.map((row) => ({ updateOne: { filter: { id: row.id }, update: { $set: row }, upsert: true } })));
  return rows;
}

async function audit(action, actorId, targetType, targetId, meta = {}) {
  ensureCollections();
  const row = {
    id: nextId('audit', store.state.auditLogs),
    actorId: actorId || 'system',
    action,
    entityType: targetType,
    entityId: targetId,
    target: targetId,
    metadata: meta,
    status: 'success',
    createdAt: new Date().toISOString(),
  };
  store.state.auditLogs.unshift(row);
  await persist('AuditLog', row);
  return row;
}

const COMPANY_CHECKS = [
  ['business_license', 'Business license'],
  ['agreement_confirmed', 'Agreement / terms confirmed'],
  ['payout_account', 'Payout account'],
  ['support_contacts', 'Support contacts'],
  ['inventory_ready', 'Service inventory readiness'],
];

const DRIVER_CHECKS = [
  ['driver_license', 'Driver license'],
  ['identity_document', 'Identity document'],
  ['company_assignment', 'Company assignment'],
  ['safety_clearance', 'Safety clearance'],
  ['trip_permissions', 'Manifest/check-in permissions'],
];

function checklistTemplate(targetType) {
  const rows = targetType === 'driver' ? DRIVER_CHECKS : COMPANY_CHECKS;
  return rows.map(([key, label]) => ({ key, label, required: true, status: 'missing', value: '', notes: '' }));
}

function summarizeInventory(companyId) {
  const listings = store.state.listings.filter((listing) => listing.companyId === companyId && listing.status !== 'archived');
  const activeListings = listings.filter((listing) => listing.status === 'active');
  const routes = store.state.routes.filter((route) => route.companyId === companyId && route.status !== 'archived');
  const schedules = store.state.schedules.filter((schedule) => schedule.companyId === companyId && schedule.status !== 'archived');
  const vehicles = store.state.vehicles.filter((vehicle) => vehicle.companyId === companyId && vehicle.status !== 'archived');
  const rooms = store.state.rooms.filter((room) => room.companyId === companyId && room.status !== 'archived');
  return {
    listings: listings.length,
    activeListings: activeListings.length,
    routes: routes.length,
    schedules: schedules.length,
    vehicles: vehicles.length,
    rooms: rooms.length,
    ready: listings.length > 0 && (schedules.length > 0 || rooms.length > 0 || vehicles.length > 0),
  };
}

function findTarget(targetType, targetId) {
  const type = normalize(targetType || 'company');
  if (type === 'driver') {
    const employee = store.state.companyEmployees.find((row) => row.id === targetId || row.userId === targetId);
    return { type: 'driver', entity: employee, companyId: employee?.companyId || '' };
  }
  const company = store.findCompany(targetId);
  return { type: 'company', entity: company, companyId: company?.id || '' };
}

function getReview(targetType, targetId, options = {}) {
  ensureCollections();
  const target = findTarget(targetType, targetId);
  if (!target.entity) {
    const error = new Error(`${target.type === 'driver' ? 'Driver' : 'Company'} not found for verification`);
    error.status = 404;
    throw error;
  }
  let review = store.state.verificationReviews.find((row) => row.targetType === target.type && (row.targetId === target.entity.id || row.targetId === targetId));
  if (!review && options.create !== false) {
    review = {
      id: nextId('verification', store.state.verificationReviews),
      targetType: target.type,
      targetId: target.entity.id,
      companyId: target.companyId,
      status: 'draft',
      riskLevel: 'medium',
      checklist: checklistTemplate(target.type),
      documents: [],
      payoutAccount: {},
      supportContacts: {},
      inventorySummary: target.type === 'company' ? summarizeInventory(target.companyId) : {},
      agreementSummary: '',
      auditTrail: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.state.verificationReviews.unshift(review);
  }
  return review;
}

function item(review, key) {
  const normalized = normalize(key);
  let row = review.checklist.find((check) => check.key === normalized);
  if (!row) {
    row = { key: normalized, label: cleanText(key), required: true, status: 'missing' };
    review.checklist.push(row);
  }
  return row;
}

function pendingRequired(review) {
  return review.checklist.filter((check) => check.required !== false && !['approved', 'waived'].includes(check.status));
}

function markItem(review, key, status, actorId, payload = {}) {
  const now = new Date().toISOString();
  const check = item(review, key);
  check.status = status;
  if (payload.value) check.value = cleanText(payload.value);
  if (payload.documentReference) check.documentReference = cleanText(payload.documentReference);
  if (payload.notes || payload.note) check.notes = cleanText(payload.notes || payload.note);
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
  review.status = pendingRequired(review).length ? 'pending_review' : 'approved';
  review.auditTrail = Array.isArray(review.auditTrail) ? review.auditTrail : [];
  review.auditTrail.unshift({ action: `check.${status}`, key: check.key, actorId, at: now, note: check.reviewNotes || check.notes || '' });
  return check;
}

async function submitCompanyChecklist(companyId, payload = {}, actorId = 'company-system') {
  const company = store.findCompany(companyId);
  if (!company) {
    const error = new Error('Company not found');
    error.status = 404;
    throw error;
  }
  const review = getReview('company', company.id);
  const payoutAccount = {
    provider: cleanText(payload.payoutProvider || payload.bankName || company.payoutAccountProvider || ''),
    accountName: cleanText(payload.accountName || company.payoutAccountName || company.name),
    accountNumber: cleanText(payload.accountNumber || payload.payoutAccount || company.payoutAccount || ''),
    currency: cleanText(payload.currency || company.settings?.defaultCurrency || 'UGX'),
  };
  const supportContacts = {
    phone: cleanText(payload.supportPhone || payload.phone || company.supportContacts?.phone || ''),
    email: cleanText(payload.supportEmail || payload.email || company.supportContacts?.email || ''),
    whatsapp: cleanText(payload.supportWhatsapp || payload.whatsapp || company.supportContacts?.whatsapp || ''),
  };
  company.payoutAccount = payoutAccount.accountNumber || company.payoutAccount || '';
  company.payoutAccountProvider = payoutAccount.provider || company.payoutAccountProvider || '';
  company.payoutAccountName = payoutAccount.accountName || company.payoutAccountName || '';
  company.supportContacts = { ...(company.supportContacts || {}), ...supportContacts };
  const canAlreadyPublish = company.verificationStatus === 'verified' && company.settings?.canPublish !== false;
  company.settings = {
    ...(company.settings || {}),
    onboardingStep: canAlreadyPublish ? (company.settings?.onboardingStep || 'complete') : 'verification',
    canPublish: canAlreadyPublish,
    instantConfirmation: canAlreadyPublish ? company.settings?.instantConfirmation !== false : false,
  };
  review.payoutAccount = payoutAccount;
  review.supportContacts = supportContacts;
  review.agreementSummary = cleanText(payload.agreementSummary || payload.termsSummary || review.agreementSummary || '');
  review.inventorySummary = summarizeInventory(company.id);
  markItem(review, 'payout_account', payoutAccount.accountNumber ? 'submitted' : 'missing', actorId, { value: payoutAccount.accountNumber, notes: payoutAccount.provider });
  markItem(review, 'support_contacts', supportContacts.phone || supportContacts.email ? 'submitted' : 'missing', actorId, { value: [supportContacts.phone, supportContacts.email].filter(Boolean).join(' / ') });
  markItem(review, 'agreement_confirmed', (payload.agreementAccepted === 'on' || payload.agreementAccepted === true || review.agreementSummary) ? 'submitted' : 'missing', actorId, { value: review.agreementSummary });
  markItem(review, 'inventory_ready', review.inventorySummary.ready ? 'submitted' : 'missing', actorId, { value: JSON.stringify(review.inventorySummary) });
  if ((company.documents || []).length) markItem(review, 'business_license', 'submitted', actorId, { value: `${company.documents.length} document(s)` });
  review.submittedBy = actorId;
  review.submittedAt = new Date().toISOString();
  review.status = pendingRequired(review).length ? 'pending_review' : 'approved';
  await persist('Company', company);
  await persist('VerificationReview', review);
  await audit('company.verification.submitted', actorId, 'company', company.id, { reviewId: review.id });
  await notificationService.queueNotification({
    ownerType: 'verification', ownerId: review.id, channels: ['email'], title: 'Partner verification submitted',
    message: `${company.name} submitted verification details for review.`, referenceType: 'verification', referenceId: review.id,
  });
  return review;
}

async function submitDriverChecklist(driverId, payload = {}, actorId = 'company-system', scopeCompanyId = '') {
  const target = findTarget('driver', driverId);
  if (!target.entity) {
    const error = new Error('Driver not found');
    error.status = 404;
    throw error;
  }
  if (scopeCompanyId && String(target.companyId) !== String(scopeCompanyId)) {
    const error = new Error('This driver does not belong to your company');
    error.status = 403;
    throw error;
  }
  const driver = target.entity;
  const review = getReview('driver', driver.id);
  driver.licenseNumber = cleanText(payload.licenseNumber || driver.licenseNumber || '');
  driver.safetyStatus = 'pending_review';
  driver.documents = Array.isArray(driver.documents) ? driver.documents : [];
  if (payload.documentReference || payload.licenseNumber) {
    driver.documents.push({ documentType: cleanText(payload.documentType || 'driver_license'), documentReference: cleanText(payload.documentReference || payload.licenseNumber), status: 'pending_review', uploadedBy: actorId, uploadedAt: new Date().toISOString() });
  }
  markItem(review, 'driver_license', driver.licenseNumber || payload.documentReference ? 'submitted' : 'missing', actorId, { value: driver.licenseNumber, documentReference: payload.documentReference });
  markItem(review, 'identity_document', payload.identityReference ? 'submitted' : 'missing', actorId, { documentReference: payload.identityReference });
  markItem(review, 'company_assignment', driver.companyId ? 'submitted' : 'missing', actorId, { value: driver.companyId });
  markItem(review, 'safety_clearance', payload.safetyCleared === 'on' || payload.safetyCleared === true ? 'submitted' : 'missing', actorId, { notes: payload.safetyNote });
  markItem(review, 'trip_permissions', (driver.permissions || []).length ? 'submitted' : 'missing', actorId, { value: (driver.permissions || []).join(', ') });
  review.submittedBy = actorId;
  review.submittedAt = new Date().toISOString();
  await persist('CompanyEmployee', driver);
  await persist('VerificationReview', review);
  await audit('driver.verification.submitted', actorId, 'driver', driver.id, { reviewId: review.id });
  return review;
}

async function reviewChecklistItem(targetType, targetId, key, status, actorId = 'admin-system', payload = {}) {
  const review = getReview(targetType, targetId);
  const safeStatus = ['approved', 'rejected', 'waived'].includes(status) ? status : 'approved';
  const check = markItem(review, key, safeStatus, actorId, payload);
  if (safeStatus === 'rejected') review.status = 'rejected';
  await persist('VerificationReview', review);
  await audit(`admin.verification.${safeStatus}`, actorId, review.targetType, review.targetId, { reviewId: review.id, key: check.key });
  return review;
}

async function activateTarget(targetType, targetId, actorId = 'admin-system') {
  const review = getReview(targetType, targetId);
  const missing = pendingRequired(review);
  if (missing.length) {
    const error = new Error(`Cannot activate until these checklist items are approved: ${missing.map((row) => row.label).join(', ')}`);
    error.status = 422;
    throw error;
  }
  const now = new Date().toISOString();
  if (review.targetType === 'company') {
    const company = store.findCompany(review.targetId);
    company.verificationStatus = 'verified';
    company.status = 'active';
    company.settings = { ...(company.settings || {}), canPublish: true, instantConfirmation: true, onboardingStep: 'complete' };
    company.reviewedBy = actorId;
    company.reviewedAt = now;
    company.reviewNotes = cleanText(review.reviewNotes || 'Verification checklist approved.');
    await persist('Company', company);
    const companyListings = store.state.listings.filter((listing) => listing.companyId === company.id);
    companyListings.forEach((listing) => { listing.isVerified = true; if (listing.status === 'active') listing.bookable = true; });
    await persistMany('Listing', companyListings);
    // Approving the company only ever updated the Company document - the company_admin
    // owner's own user.status/verificationStatus stayed "pending" forever, since nothing
    // here mirrored what the driver branch below already does for its employee's user.
    const owner = store.state.users.find((row) => row.id === company.ownerId);
    if (owner) {
      owner.status = 'active';
      owner.isVerified = true;
      owner.verificationStatus = 'verified';
      await persist('User', owner);
    }
  } else if (review.targetType === 'driver') {
    const employee = store.state.companyEmployees.find((row) => row.id === review.targetId);
    employee.status = 'active';
    employee.safetyStatus = 'cleared';
    employee.verifiedBy = actorId;
    employee.verifiedAt = now;
    const user = store.state.users.find((row) => row.id === employee.userId);
    if (user) {
      user.status = 'active';
      user.isVerified = true;
      user.verificationStatus = 'verified';
      await persist('User', user);
    }
    await persist('CompanyEmployee', employee);
  }
  review.status = 'activated';
  review.reviewedBy = actorId;
  review.reviewedAt = now;
  review.activatedBy = actorId;
  review.activatedAt = now;
  review.auditTrail.unshift({ action: 'verification.activated', actorId, at: now });
  await persist('VerificationReview', review);
  await audit('admin.verification.activated', actorId, review.targetType, review.targetId, { reviewId: review.id });
  await notificationService.queueNotification({
    ownerType: review.targetType, ownerId: review.targetId, channels: ['email'], title: 'Classic Trip verification approved',
    message: `Your ${review.targetType} verification checklist was approved and activated.`, referenceType: 'verification', referenceId: review.id,
  });
  return review;
}

async function rejectTarget(targetType, targetId, actorId = 'admin-system', reason = '') {
  const review = getReview(targetType, targetId);
  review.status = 'rejected';
  review.rejectionReason = cleanText(reason);
  review.reviewedBy = actorId;
  review.reviewedAt = new Date().toISOString();
  if (review.targetType === 'company') {
    const company = store.findCompany(review.targetId);
    company.verificationStatus = 'rejected';
    company.settings = { ...(company.settings || {}), canPublish: false, instantConfirmation: false };
    await persist('Company', company);
  } else if (review.targetType === 'driver') {
    const employee = store.state.companyEmployees.find((row) => row.id === review.targetId);
    employee.status = 'verification_rejected';
    await persist('CompanyEmployee', employee);
  }
  await persist('VerificationReview', review);
  await audit('admin.verification.rejected', actorId, review.targetType, review.targetId, { reason: review.rejectionReason, reviewId: review.id });
  return review;
}

function listReviews(filter = {}) {
  ensureCollections();
  const seeded = [];
  store.state.companies.forEach((company) => {
    if (/pending|review|rejected|suspended/.test(cleanText(company.verificationStatus || 'pending'))) seeded.push(getReview('company', company.id));
  });
  store.state.companyEmployees.filter((employee) => /driver/i.test(employee.roleTitle || '') || (employee.permissions || []).includes('trip_status')).forEach((employee) => {
    if (/pending|review|rejected/.test(cleanText(employee.status || 'pending'))) seeded.push(getReview('driver', employee.id));
  });
  return store.state.verificationReviews.filter((row) => (!filter.status || row.status === filter.status) && (!filter.targetType || row.targetType === filter.targetType));
}

module.exports = {
  getReview,
  listReviews,
  submitCompanyChecklist,
  submitDriverChecklist,
  reviewChecklistItem,
  activateTarget,
  rejectTarget,
  summarizeInventory,
  pendingRequired,
};
