const store = require('../data/persistentStore');
const invitationService = require('./invitationService');
const notificationService = require('../notification/notificationService');
const { mongoose } = require('../../config/db');

function cleanText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

function normalize(value) {
  return cleanText(value).toLowerCase();
}

function ensureCollections() {
  ['partnerLeads', 'discoverySessions', 'agreements', 'auditLogs', 'notifications'].forEach((key) => {
    if (!Array.isArray(store.state[key])) store.state[key] = [];
  });
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

function parseList(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  return String(value || '').split(',').map(cleanText).filter(Boolean);
}

async function persist(modelName, row, filter = { id: row.id }) {
  if (mongoose.connection.readyState !== 1 || !row) return row;
  const Model = require(`../../models/${modelName}`);
  await Model.updateOne(filter, { $set: row }, { upsert: true, runValidators: true });
  return row;
}

async function audit(action, actorId, entityType, entityId, meta = {}) {
  ensureCollections();
  const row = {
    id: nextId('audit', store.state.auditLogs),
    actorId: actorId || 'system',
    action,
    entityType,
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

function findLead(id) {
  ensureCollections();
  return store.state.partnerLeads.find((row) => row.id === cleanText(id));
}

function findSession(id) {
  ensureCollections();
  return store.state.discoverySessions.find((row) => row.id === cleanText(id));
}

function findAgreement(id) {
  ensureCollections();
  return store.state.agreements.find((row) => row.id === cleanText(id));
}

function inferLeadType(value) {
  const key = normalize(value || 'company').replace(/[^a-z0-9]+/g, '_');
  const allowed = new Set(['bus_company', 'hotel', 'driver', 'fleet_owner', 'promoter', 'agent', 'airline', 'tour_provider', 'car_rental', 'cargo_provider', 'corporate_client', 'service_provider', 'other', 'company']);
  if (allowed.has(key)) return key;
  if (/bus|transport|coach/.test(key)) return 'bus_company';
  return 'company';
}

function inviteTypeForAgreement(agreement = {}, lead = {}) {
  const source = normalize(agreement.agreementType || lead.leadType || 'company');
  if (/driver/.test(source)) return 'driver';
  if (/hotel/.test(source)) return 'hotel';
  if (/fleet/.test(source)) return 'fleet_owner';
  if (/promoter/.test(source)) return 'promoter';
  if (/agent/.test(source)) return 'agent';
  if (/service|tour|cargo|airline|car/.test(source)) return 'service_provider';
  return 'company';
}

async function createLead(payload = {}, actorId = 'public') {
  ensureCollections();
  const email = cleanText(payload.email).toLowerCase();
  const phone = cleanText(payload.phone);
  const businessName = cleanText(payload.businessName || payload.companyName || payload.name);
  if (!businessName) {
    const error = new Error('Business/person name is required');
    error.status = 422;
    throw error;
  }
  if (!email && !phone) {
    const error = new Error('Email or phone is required');
    error.status = 422;
    throw error;
  }
  const lead = {
    id: nextId('lead', store.state.partnerLeads),
    leadType: inferLeadType(payload.leadType || payload.companyType || payload.serviceCategory),
    businessName,
    contactName: cleanText(payload.contactName || payload.fullName || businessName),
    phone,
    email,
    whatsapp: cleanText(payload.whatsapp || payload.whatsApp || phone),
    city: cleanText(payload.city),
    country: cleanText(payload.country || 'Uganda'),
    serviceCategory: cleanText(payload.serviceCategory || payload.companyType || payload.leadType),
    sourceChannel: cleanText(payload.sourceChannel || payload.source || 'public_form'),
    notes: cleanText(payload.notes || payload.message),
    status: 'new',
    assignedTo: cleanText(payload.assignedTo || 'admin-onboarding'),
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    meta: { sourcePath: payload.sourcePath || '' },
  };
  store.state.partnerLeads.unshift(lead);
  await persist('PartnerLead', lead);
  await audit('partner_lead.created', actorId, 'partner_lead', lead.id, { source: lead.sourceChannel, leadType: lead.leadType });
  await notificationService.queueNotification({
    ownerType: 'partner_lead',
    ownerId: lead.id,
    channels: ['email'],
    audience: 'admins',
    title: 'New partner lead received',
    message: `${lead.businessName} requested Classic Trip onboarding as ${lead.leadType}.`,
    referenceType: 'partner_lead',
    referenceId: lead.id,
    status: 'queued',
  });
  return lead;
}

async function scheduleSession(payload = {}, actorId = 'admin-system') {
  ensureCollections();
  const lead = findLead(payload.leadId);
  if (!lead) {
    const error = new Error('Partner lead is required before booking a discovery session');
    error.status = 404;
    throw error;
  }
  const session = {
    id: nextId('session', store.state.discoverySessions),
    leadId: lead.id,
    providerName: lead.businessName,
    sessionType: cleanText(payload.sessionType || 'Discovery call'),
    scheduledAt: payload.scheduledAt || new Date().toISOString(),
    attendees: parseList(payload.attendees || [lead.contactName, lead.email].filter(Boolean)),
    location: cleanText(payload.location),
    meetingLink: cleanText(payload.meetingLink),
    notes: cleanText(payload.notes),
    objections: cleanText(payload.objections),
    agreedNextAction: cleanText(payload.agreedNextAction || 'Prepare agreement decision'),
    followUpOwner: cleanText(payload.followUpOwner || actorId),
    status: cleanText(payload.status || 'scheduled'),
    files: [],
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.state.discoverySessions.unshift(session);
  lead.status = session.status === 'completed' ? 'session_completed' : 'session_scheduled';
  lead.latestSessionId = session.id;
  lead.updatedBy = actorId;
  lead.updatedAt = new Date().toISOString();
  await persist('DiscoverySession', session);
  await persist('PartnerLead', lead);
  await audit('discovery_session.booked', actorId, 'discovery_session', session.id, { leadId: lead.id, sessionType: session.sessionType });
  return session;
}

async function createAgreement(payload = {}, actorId = 'admin-system') {
  ensureCollections();
  const lead = findLead(payload.leadId);
  if (!lead) {
    const error = new Error('Partner lead is required before creating an agreement');
    error.status = 404;
    throw error;
  }
  const session = payload.sessionId ? findSession(payload.sessionId) : (lead.latestSessionId ? findSession(lead.latestSessionId) : null);
  const agreement = {
    id: nextId('agreement', store.state.agreements),
    leadId: lead.id,
    sessionId: session?.id || '',
    agreementType: cleanText(payload.agreementType || lead.leadType || 'company'),
    partnerName: cleanText(payload.partnerName || lead.businessName),
    contactEmail: cleanText(payload.contactEmail || lead.email).toLowerCase(),
    contactPhone: cleanText(payload.contactPhone || lead.phone),
    commissionModel: cleanText(payload.commissionModel || payload.commissionPlan || 'standard-90-7-3'),
    subscriptionPlan: cleanText(payload.subscriptionPlan || 'starter'),
    payoutFrequency: cleanText(payload.payoutFrequency || 'weekly'),
    cancellationRules: cleanText(payload.cancellationRules || 'Classic Trip standard cancellation/refund policy'),
    serviceLevelExpectations: cleanText(payload.serviceLevelExpectations || 'Maintain verified inventory, accurate schedules, and responsive support.'),
    documentRequirements: cleanText(payload.documentRequirements || 'Business license, payout account, support contacts, inventory readiness.'),
    operatingRegions: parseList(payload.operatingRegions || [lead.city, lead.country].filter(Boolean)),
    startDate: payload.startDate || new Date().toISOString(),
    expiresAt: payload.expiresAt || payload.expiryDate || null,
    status: cleanText(payload.status || 'draft'),
    approvalHistory: [{ by: actorId, action: 'created', at: new Date().toISOString(), note: cleanText(payload.note || '') }],
    termsSummary: cleanText(payload.termsSummary || payload.terms || ''),
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.state.agreements.unshift(agreement);
  lead.status = 'agreement_draft';
  lead.latestAgreementId = agreement.id;
  lead.updatedBy = actorId;
  lead.updatedAt = new Date().toISOString();
  await persist('Agreement', agreement);
  await persist('PartnerLead', lead);
  await audit('agreement.created', actorId, 'agreement', agreement.id, { leadId: lead.id, agreementType: agreement.agreementType });
  return agreement;
}

async function updateAgreementStatus(id, status, actorId = 'admin-system', note = '') {
  const agreement = findAgreement(id);
  if (!agreement) {
    const error = new Error('Agreement not found');
    error.status = 404;
    throw error;
  }
  const cleanStatus = cleanText(status || 'draft');
  agreement.status = cleanStatus;
  agreement.updatedBy = actorId;
  agreement.updatedAt = new Date().toISOString();
  if (cleanStatus === 'approved' || cleanStatus === 'agreed') {
    agreement.approvedBy = actorId;
    agreement.approvedAt = new Date().toISOString();
  }
  agreement.approvalHistory = Array.isArray(agreement.approvalHistory) ? agreement.approvalHistory : [];
  agreement.approvalHistory.unshift({ by: actorId, action: cleanStatus, at: new Date().toISOString(), note: cleanText(note) });
  const lead = findLead(agreement.leadId);
  if (lead) {
    lead.status = cleanStatus === 'approved' || cleanStatus === 'agreed' ? 'agreement_approved' : `agreement_${cleanStatus}`;
    lead.updatedAt = new Date().toISOString();
    lead.updatedBy = actorId;
    await persist('PartnerLead', lead);
  }
  await persist('Agreement', agreement);
  await audit(`agreement.${cleanStatus}`, actorId, 'agreement', agreement.id, { note: cleanText(note) });
  return agreement;
}

async function approveAgreementAndInvite(id, actorId = 'admin-system', payload = {}) {
  const agreement = await updateAgreementStatus(id, 'approved', actorId, payload.note || 'Approved for secure invitation');
  const lead = findLead(agreement.leadId) || {};
  const invitation = await invitationService.createInvitation({
    type: inviteTypeForAgreement(agreement, lead),
    email: agreement.contactEmail || lead.email,
    phone: agreement.contactPhone || lead.phone,
    fullName: lead.contactName || agreement.partnerName,
    companyName: agreement.partnerName || lead.businessName,
    roleTitle: payload.roleTitle || (inviteTypeForAgreement(agreement, lead) === 'driver' ? 'Driver' : 'Company owner'),
    commissionPlan: agreement.commissionModel,
    subscriptionPlan: agreement.subscriptionPlan,
    termsSummary: agreement.termsSummary || `${agreement.commissionModel}; payout ${agreement.payoutFrequency}; docs ${agreement.documentRequirements}`,
    startDate: agreement.startDate,
    leadId: agreement.leadId,
    agreementId: agreement.id,
  }, actorId, 'admin');
  invitation.leadId = agreement.leadId;
  invitation.agreementId = agreement.id;
  invitation.termsSummary = invitation.termsSummary || agreement.termsSummary;
  agreement.invitationId = invitation.id;
  agreement.updatedAt = new Date().toISOString();
  if (lead.id) {
    lead.status = 'invitation_sent';
    lead.convertedInvitationId = invitation.id;
    lead.convertedAt = new Date().toISOString();
    await persist('PartnerLead', lead);
  }
  await persist('Invitation', invitation);
  await persist('Agreement', agreement);
  await audit('agreement.approved_invitation_sent', actorId, 'agreement', agreement.id, { invitationId: invitation.id });
  return { agreement, invitation, lead };
}

function listPipeline() {
  ensureCollections();
  return {
    leads: store.state.partnerLeads.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)),
    sessions: store.state.discoverySessions.slice().sort((a, b) => new Date(b.scheduledAt || b.createdAt || 0) - new Date(a.scheduledAt || a.createdAt || 0)),
    agreements: store.state.agreements.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)),
  };
}

module.exports = {
  createLead,
  scheduleSession,
  createAgreement,
  updateAgreementStatus,
  approveAgreementAndInvite,
  findLead,
  findSession,
  findAgreement,
  listPipeline,
};
