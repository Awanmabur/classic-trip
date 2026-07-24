const onboardingRepository = require('../../repositories/domain/onboardingRepository');
const invitationService = require('./invitationService');
const notificationService = require('../notification/notificationService');
const { nextId } = require('../data/idService');
const { getPlatformConfig } = require('../platform/platformConfigService');
function cleanText(value, max = 2000) { return String(value || '').replace(/<[^>]*>/g, '').trim().replace(/\s+/g, ' ').slice(0, max); }
function normalize(value) { return cleanText(value).toLowerCase(); }
function boundedPercent(value, fallback = 0) { const number = Number(value); return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : fallback; }
function parseList(value) { if (Array.isArray(value)) return value.map((item) => cleanText(item, 200)).filter(Boolean); return String(value || '').split(',').map((item) => cleanText(item, 200)).filter(Boolean); }
async function audit(action, actorId, entityType, entityId, meta = {}) { const row = { id: await nextId('audit'), actorId: actorId || 'system', action, entityType, entityId, target: entityId, metadata: meta, status: 'success', createdAt: new Date().toISOString() }; await onboardingRepository.auditLogs.save(row, { id: row.id }); return row; }
async function findLead(id) { return onboardingRepository.partnerLeads.findOne({ id: cleanText(id, 180) }); }
async function findSession(id) { return onboardingRepository.discoverySessions.findOne({ id: cleanText(id, 180) }); }
async function findAgreement(id) { return onboardingRepository.agreements.findOne({ id: cleanText(id, 180) }); }
function inferLeadType(value) { const key = normalize(value || 'company').replace(/[^a-z0-9]+/g, '_'); const allowed = new Set(['bus','hotel','driver','promoter','agent','company','other']); if (allowed.has(key)) return key; if (key === 'bus') return 'bus'; if (/hotel|apartment|stay/.test(key)) return 'hotel'; return 'company'; }
function inviteTypeForAgreement(agreement = {}, lead = {}) { const source = normalize(agreement.agreementType || lead.leadType || 'company'); if (/driver/.test(source)) return 'driver'; if (/hotel/.test(source)) return 'hotel'; if (source === 'bus') return 'bus'; if (/promoter/.test(source)) return 'promoter'; if (/agent/.test(source)) return 'agent'; return 'company'; }

async function createLead(payload = {}, actorId = 'public') {
  const email = cleanText(payload.email, 254).toLowerCase(); const phone = cleanText(payload.phone, 60); const businessName = cleanText(payload.businessName || payload.companyName || payload.name, 180);
  if (!businessName) { const error = new Error('Business/person name is required'); error.status = 422; throw error; }
  if (!email && !phone) { const error = new Error('Email or phone is required'); error.status = 422; throw error; }
  const duplicate = await onboardingRepository.partnerLeads.findOne({ status: { $nin: ['closed', 'rejected'] }, $or: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] });
  if (duplicate) return duplicate;
  const lead = { id: await nextId('lead'), leadType: inferLeadType(payload.leadType || payload.companyType || payload.serviceCategory), businessName, contactName: cleanText(payload.contactName || payload.fullName || businessName, 180), phone, email, whatsapp: cleanText(payload.whatsapp || payload.whatsApp || phone, 60), city: cleanText(payload.city, 120), country: cleanText(payload.country, 100), serviceCategory: cleanText(payload.serviceCategory || payload.companyType || payload.leadType, 120), sourceChannel: cleanText(payload.sourceChannel || payload.source || 'public_form', 100), notes: cleanText(payload.notes || payload.message), status: 'new', assignedTo: cleanText(payload.assignedTo || 'admin-onboarding', 120), createdBy: actorId, updatedBy: actorId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), meta: { sourcePath: cleanText(payload.sourcePath, 500) } };
  await onboardingRepository.partnerLeads.save(lead, { id: lead.id }); await audit('partner_lead.created', actorId, 'partner_lead', lead.id, { source: lead.sourceChannel, leadType: lead.leadType });
  await notificationService.queueNotification({ ownerType: 'partner_lead', ownerId: lead.id, channels: ['email'], audience: 'admins', title: 'New partner lead received', message: `${lead.businessName} requested Classic Trip onboarding as ${lead.leadType}.`, referenceType: 'partner_lead', referenceId: lead.id, status: 'queued' }); return lead;
}

async function scheduleSession(payload = {}, actorId = 'admin-system') {
  const lead = await findLead(payload.leadId); if (!lead) { const error = new Error('Partner lead is required before booking a discovery session'); error.status = 404; throw error; }
  const session = { id: await nextId('session'), leadId: lead.id, providerName: lead.businessName, sessionType: cleanText(payload.sessionType || 'Discovery call', 120), scheduledAt: payload.scheduledAt || new Date().toISOString(), attendees: parseList(payload.attendees || [lead.contactName, lead.email].filter(Boolean)), location: cleanText(payload.location, 240), meetingLink: cleanText(payload.meetingLink, 1000), notes: cleanText(payload.notes), objections: cleanText(payload.objections), agreedNextAction: cleanText(payload.agreedNextAction || 'Prepare agreement decision'), followUpOwner: cleanText(payload.followUpOwner || actorId, 180), status: cleanText(payload.status || 'scheduled', 60), files: [], createdBy: actorId, updatedBy: actorId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  Object.assign(lead, { status: session.status === 'completed' ? 'session_completed' : 'session_scheduled', latestSessionId: session.id, updatedBy: actorId, updatedAt: new Date().toISOString() });
  await Promise.all([onboardingRepository.discoverySessions.save(session, { id: session.id }), onboardingRepository.partnerLeads.save(lead, { id: lead.id })]); await audit('discovery_session.booked', actorId, 'discovery_session', session.id, { leadId: lead.id, sessionType: session.sessionType }); return session;
}

async function createAgreement(payload = {}, actorId = 'admin-system') {
  const lead = await findLead(payload.leadId); if (!lead) { const error = new Error('Partner lead is required before creating an agreement'); error.status = 404; throw error; }
  const session = payload.sessionId ? await findSession(payload.sessionId) : (lead.latestSessionId ? await findSession(lead.latestSessionId) : null);
  const platform = await getPlatformConfig();
  const commissionPercent = boundedPercent(payload.commissionPercent, platform.partnerCommissionPercent);
  const agreement = { id: await nextId('agreement'), leadId: lead.id, sessionId: session?.id || '', agreementType: cleanText(payload.agreementType || lead.leadType || 'company', 120), partnerName: cleanText(payload.partnerName || lead.businessName, 180), contactEmail: cleanText(payload.contactEmail || lead.email, 254).toLowerCase(), contactPhone: cleanText(payload.contactPhone || lead.phone, 60), commercialModel: 'percentage_commission', commissionPercent, promoterFunding: 'platform_commission', payoutFrequency: cleanText(payload.payoutFrequency || 'settlement_cycle', 80), cancellationRules: cleanText(payload.cancellationRules), serviceLevelExpectations: cleanText(payload.serviceLevelExpectations), documentRequirements: cleanText(payload.documentRequirements), operatingRegions: parseList(payload.operatingRegions || [lead.city, lead.country].filter(Boolean)), startDate: payload.startDate || new Date().toISOString(), expiresAt: payload.expiresAt || payload.expiryDate || null, status: cleanText(payload.status || 'draft', 60), approvalHistory: [{ by: actorId, action: 'created', at: new Date().toISOString(), note: cleanText(payload.note) }], termsSummary: cleanText(payload.termsSummary || payload.terms || `${commissionPercent}% booking commission; promoter rewards are funded from Classic Trip's commission`), createdBy: actorId, updatedBy: actorId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  Object.assign(lead, { status: 'agreement_draft', latestAgreementId: agreement.id, updatedBy: actorId, updatedAt: new Date().toISOString() });
  await Promise.all([onboardingRepository.agreements.save(agreement, { id: agreement.id }), onboardingRepository.partnerLeads.save(lead, { id: lead.id })]); await audit('agreement.created', actorId, 'agreement', agreement.id, { leadId: lead.id, agreementType: agreement.agreementType }); return agreement;
}

async function updateAgreementStatus(id, status, actorId = 'admin-system', note = '') {
  const agreement = await findAgreement(id); if (!agreement) { const error = new Error('Agreement not found'); error.status = 404; throw error; }
  const cleanStatus = cleanText(status || 'draft', 60); Object.assign(agreement, { status: cleanStatus, updatedBy: actorId, updatedAt: new Date().toISOString() }); if (['approved','agreed'].includes(cleanStatus)) Object.assign(agreement, { approvedBy: actorId, approvedAt: new Date().toISOString() });
  agreement.approvalHistory = [{ by: actorId, action: cleanStatus, at: new Date().toISOString(), note: cleanText(note) }, ...(agreement.approvalHistory || [])].slice(0, 100);
  const lead = await findLead(agreement.leadId); if (lead) { Object.assign(lead, { status: ['approved','agreed'].includes(cleanStatus) ? 'agreement_approved' : `agreement_${cleanStatus}`, updatedAt: new Date().toISOString(), updatedBy: actorId }); await onboardingRepository.partnerLeads.save(lead, { id: lead.id }); }
  await onboardingRepository.agreements.save(agreement, { id: agreement.id }); await audit(`agreement.${cleanStatus}`, actorId, 'agreement', agreement.id, { note: cleanText(note) }); return agreement;
}

async function approveAgreementAndInvite(id, actorId = 'admin-system', payload = {}) {
  const agreement = await updateAgreementStatus(id, 'approved', actorId, payload.note || 'Approved for secure invitation'); const lead = await findLead(agreement.leadId) || {};
  const invitation = await invitationService.createInvitation({ type: inviteTypeForAgreement(agreement, lead), email: agreement.contactEmail || lead.email, phone: agreement.contactPhone || lead.phone, fullName: lead.contactName || agreement.partnerName, companyName: agreement.partnerName || lead.businessName, roleTitle: payload.roleTitle || (inviteTypeForAgreement(agreement, lead) === 'driver' ? 'Driver' : 'Company owner'), termsSummary: agreement.termsSummary || `${agreement.commissionPercent}% booking commission; payout ${agreement.payoutFrequency}; docs ${agreement.documentRequirements}`, startDate: agreement.startDate, leadId: agreement.leadId, agreementId: agreement.id }, actorId, 'admin');
  // createInvitation() has already persisted the invitation without its raw token.
  // Keep the returned token transient for immediate delivery only and never
  // write the raw token back to storage.
  const transientToken = invitation.token;
  const storedInvitation = {
    ...invitation,
    leadId: agreement.leadId,
    agreementId: agreement.id,
    termsSummary: invitation.termsSummary || agreement.termsSummary,
  };
  delete storedInvitation.token;
  Object.assign(agreement, { invitationId: invitation.id, updatedAt: new Date().toISOString() });
  if (lead.id) {
    Object.assign(lead, { status: 'invitation_sent', convertedInvitationId: invitation.id, convertedAt: new Date().toISOString() });
    await onboardingRepository.partnerLeads.save(lead, { id: lead.id });
  }
  await Promise.all([
    onboardingRepository.invitations.save(storedInvitation, { id: invitation.id }),
    onboardingRepository.invitations.updateOne({ id: invitation.id }, { $unset: { token: 1 } }),
    onboardingRepository.agreements.save(agreement, { id: agreement.id }),
  ]);
  await audit('agreement.approved_invitation_sent', actorId, 'agreement', agreement.id, { invitationId: invitation.id });
  return { agreement, invitation: { ...storedInvitation, token: transientToken }, lead };
}
async function listPipeline() { const [leads, sessions, agreements] = await Promise.all([onboardingRepository.partnerLeads.list({}, { sort: { createdAt: -1 }, limit: 5000 }), onboardingRepository.discoverySessions.list({}, { sort: { scheduledAt: -1 }, limit: 5000 }), onboardingRepository.agreements.list({}, { sort: { createdAt: -1 }, limit: 5000 })]); return { leads, sessions, agreements }; }
module.exports = { createLead, scheduleSession, createAgreement, updateAgreementStatus, approveAgreementAndInvite, findLead, findSession, findAgreement, listPipeline };
