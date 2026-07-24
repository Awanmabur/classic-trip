const { platformCurrency } = require('../../utils/currency');
const promoterRepository = require('../../repositories/domain/promoterRepository');
const promoterService = require('./promoterService');
const walletService = require('../wallet/walletService');
const { nextId } = require('../data/idService');

function clean(value, limit = 500) { return String(value || '').trim().replace(/\s+/g, ' ').slice(0, limit); }
function now() { return new Date().toISOString(); }

async function requirePromoter(promoterId) {
  const promoter = await promoterRepository.users.findOne({ id: promoterId, role: 'promoter' });
  if (!promoter || promoter.status !== 'active') {
    const error = new Error('Active promoter or agent account not found'); error.status = 404; throw error;
  }
  return promoter;
}

async function ensureAgentProfile(promoterId, payload = {}, actorId = promoterId) {
  const promoter = await requirePromoter(promoterId);
  let profile = await promoterRepository.profiles.findOne({ $or: [{ userId: promoterId }, { promoterId }] });
  const permissions = Array.isArray(payload.permissions)
    ? payload.permissions.map(clean).filter(Boolean)
    : clean(payload.permissions || 'offline_sales,referral_links').split(',').map(clean).filter(Boolean);
  if (!profile) {
    profile = {
      id: await nextId('agent-profile'), userId: promoterId, promoterId,
      agentCode: payload.agentCode || promoter.referralCode || `AGENT-${cryptoSafeSuffix()}`,
      createdAt: now(), createdBy: actorId,
    };
  }
  Object.assign(profile, {
    officeName: clean(payload.officeName || payload.name || profile.officeName || `${promoter.fullName} desk`),
    terminalId: clean(payload.terminalId || profile.terminalId || ''), branchId: clean(payload.branchId || profile.branchId || ''),
    location: clean(payload.location || profile.location || ''), payoutMethod: 'mobile_money',
    payoutAccount: clean(payload.payoutAccount || profile.payoutAccount || promoter.phone || ''),
    offlineSalesEnabled: !(payload.offlineSalesEnabled === false || payload.offlineSalesEnabled === 'false'),
    permissions: permissions.length ? permissions : (profile.permissions || ['offline_sales', 'referral_links']),
    dailyLimit: Math.max(0, Number(payload.dailyLimit || profile.dailyLimit || 0)), status: 'active',
    verifiedAt: profile.verifiedAt || now(), updatedAt: now(), updatedBy: actorId,
  });
  promoter.agentProfile = { id: profile.id, agentCode: profile.agentCode, offlineSalesEnabled: profile.offlineSalesEnabled, permissions: profile.permissions, location: profile.location, dailyLimit: profile.dailyLimit };
  promoter.promoterProfile = { ...(promoter.promoterProfile || {}), offlineSalesEnabled: profile.offlineSalesEnabled, agentPermissions: profile.permissions };
  await promoterRepository.withTransaction(async (session) => {
    await promoterRepository.profiles.save(profile, { userId: promoterId }, { session });
    await promoterRepository.users.save(promoter, { id: promoter.id }, { session });
  });
  await walletService.getOrCreateWallet('promoter', promoterId, payload.currency || platformCurrency());
  return profile;
}

function cryptoSafeSuffix() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase(); }

async function createReferralLink(payload = {}, actorId = payload.promoterId) {
  const promoterId = payload.promoterId || actorId;
  await requirePromoter(promoterId);
  const link = await promoterService.createLink({ promoterId, listingId: payload.listingId, code: payload.code });
  Object.assign(link, {
    campaignId: clean(payload.campaignId), sourceChannel: clean(payload.sourceChannel || payload.channel || 'direct'),
    audience: clean(payload.audience || ''), expiresAt: payload.expiresAt || null,
    qrCardUrl: `/promoter/links/${encodeURIComponent(link.id)}/qr-card`,
    shareTitle: clean(payload.shareTitle || 'Book on Classic Trip'),
    shareText: clean(payload.shareText || 'Use my Classic Trip link to book securely.'), updatedAt: now(),
  });
  await promoterRepository.links.save(link, { id: link.id });
  return link;
}

async function createQrReferralCard(promoterId, linkId) {
  const link = await promoterRepository.links.findOne({ promoterId, $or: [{ id: linkId }, { code: linkId }] });
  if (!link) { const error = new Error('Referral link not found'); error.status = 404; throw error; }
  const [listing, promoter] = await Promise.all([
    promoterRepository.listings.findOne({ id: link.listingId }), requirePromoter(promoterId),
  ]);
  const card = {
    id: `qr-card-${link.id}`, promoterId, linkId: link.id, code: link.code,
    title: `${listing?.title || 'Classic Trip'} referral card`, qrPayload: link.url,
    printableUrl: `/promoter/links/${encodeURIComponent(link.id)}/qr-card`,
    promoterName: promoter.fullName, listingTitle: listing?.title || '', createdAt: now(),
  };
  Object.assign(link, { qrCard: card, qrCardUrl: card.printableUrl, updatedAt: now() });
  await promoterRepository.links.save(link, { id: link.id });
  return card;
}

async function recordClick({ code, listingId, req, source = 'web', medium = 'referral' } = {}) {
  const link = await promoterRepository.links.findOne({
    status: { $ne: 'archived' }, $or: [{ code }, { referralCode: code }], ...(listingId ? { listingId } : {}),
  });
  if (!link) return null;
  const activeCampaign = link.campaignId
    ? await promoterRepository.campaigns.findOne({ id: link.campaignId, status: 'active' })
    : await promoterRepository.campaigns.findOne({ listingId: listingId || link.listingId, status: 'active' });
  const click = {
    id: await nextId('ref-click'), linkId: link.id, promoterId: link.promoterId,
    listingId: listingId || link.listingId, code, ip: req?.ip || '', userAgent: req?.headers?.['user-agent'] || '',
    campaignId: activeCampaign?.id || '', createdAt: now(),
  };
  const session = {
    id: await nextId('attr-session'), sessionKey: req?.sessionID || `session-${cryptoSafeSuffix()}`,
    clickId: click.id, linkId: click.linkId, promoterId: click.promoterId, listingId: click.listingId,
    campaignId: activeCampaign?.id || '', referralCode: code, source, medium,
    landingPath: req?.originalUrl || req?.url || '', ip: click.ip, userAgent: click.userAgent,
    status: 'active', expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), createdAt: now(),
  };
  link.clicks = Number(link.clicks || 0) + 1;
  if (activeCampaign) activeCampaign.clicks = Number(activeCampaign.clicks || 0) + 1;
  await promoterRepository.withTransaction(async (dbSession) => {
    await promoterRepository.clicks.save(click, { id: click.id }, { session: dbSession });
    await promoterRepository.attributionSessions.save(session, { id: session.id }, { session: dbSession });
    await promoterRepository.links.save(link, { id: link.id }, { session: dbSession });
    if (activeCampaign) await promoterRepository.campaigns.save(activeCampaign, { id: activeCampaign.id }, { session: dbSession });
  });
  return { click, session };
}

async function recordConversion(booking = {}, source = 'booking') {
  const attribution = booking.promoterAttribution || {};
  if (!attribution.promoterId) return null;
  const link = attribution.linkId ? await promoterRepository.links.findOne({ id: attribution.linkId }) : null;
  const session = attribution.linkId
    ? await promoterRepository.attributionSessions.findOne({ linkId: attribution.linkId, status: 'active' })
    : null;
  const campaign = link?.campaignId
    ? await promoterRepository.campaigns.findOne({ id: link.campaignId })
    : await promoterRepository.campaigns.findOne({ listingId: booking.listingId, status: 'active' });
  const existing = await promoterRepository.conversions.findOne({ bookingRef: booking.bookingRef, promoterId: attribution.promoterId });
  const conversion = existing || { id: await nextId('campaign-conversion'), createdAt: now() };
  Object.assign(conversion, {
    campaignId: campaign?.id || '', linkId: attribution.linkId || '', clickId: session?.clickId || '',
    promoterId: attribution.promoterId, listingId: booking.listingId, companyId: booking.companyId,
    bookingId: booking.id, bookingRef: booking.bookingRef, customerUserId: booking.customerUserId || '',
    amount: Number(booking.pricing?.total || 0), commissionAmount: Number(booking.pricing?.split?.promoterAmount || 0),
    currency: booking.pricing?.currency || platformCurrency(), attributionSource: source,
    status: booking.bookingStatus || 'confirmed', convertedAt: now(), updatedAt: now(),
  });
  await promoterRepository.withTransaction(async (dbSession) => {
    if (session) {
      Object.assign(session, { status: 'converted', convertedAt: now(), bookingRef: booking.bookingRef });
      await promoterRepository.attributionSessions.save(session, { id: session.id }, { session: dbSession });
    }
    if (link && !existing) {
      link.conversions = Number(link.conversions || 0) + 1;
      await promoterRepository.links.save(link, { id: link.id }, { session: dbSession });
    }
    if (campaign && !existing) {
      campaign.bookings = Number(campaign.bookings || 0) + 1;
      await promoterRepository.campaigns.save(campaign, { id: campaign.id }, { session: dbSession });
    }
    await promoterRepository.conversions.save(conversion, { bookingRef: conversion.bookingRef, promoterId: conversion.promoterId }, { session: dbSession });
  });
  return conversion;
}

async function createFraudSignal({ booking, signalType = 'promoter_risk', severity, score, reasons = [], metadata = {} } = {}) {
  const bookingRef = booking?.bookingRef || '';
  if (bookingRef) {
    const existing = await promoterRepository.fraudSignals.findOne({ bookingRef, signalType });
    if (existing) return existing;
  }
  const signal = {
    id: await nextId('fraud-signal'), promoterId: booking?.promoterAttribution?.promoterId || metadata.promoterId || '',
    agentId: booking?.createdByAgentId || metadata.agentId || '', bookingId: booking?.id || '',
    bookingRef: booking?.bookingRef || '', linkId: booking?.promoterAttribution?.linkId || metadata.linkId || '',
    clickId: metadata.clickId || '', signalType,
    severity: severity || (Number(score || 0) >= 60 ? 'high' : Number(score || 0) >= 25 ? 'medium' : 'low'),
    score: Number(score || 0), reasons, status: 'open', assignedTo: 'fraud-review', metadata, createdAt: now(),
  };
  await promoterRepository.fraudSignals.save(signal, { id: signal.id });
  return signal;
}

async function reviewFraudSignal(signalId, payload = {}, actorId = 'admin-system') {
  const signal = await promoterRepository.fraudSignals.findOne({ $or: [{ id: signalId }, { bookingRef: signalId }] });
  if (!signal) { const error = new Error('Fraud signal not found'); error.status = 404; throw error; }
  const status = clean(payload.status || 'resolved');
  if (!['open', 'reviewing', 'resolved', 'dismissed'].includes(status)) { const error = new Error('Invalid fraud review status'); error.status = 422; throw error; }
  Object.assign(signal, {
    status, resolution: clean(payload.resolution || payload.note || 'Reviewed'), resolvedBy: actorId,
    resolvedAt: ['resolved', 'dismissed'].includes(status) ? now() : null, updatedAt: now(),
  });
  await promoterRepository.fraudSignals.save(signal, { id: signal.id });
  return signal;
}

async function promoterReportRows(promoterId) {
  const [links, clicks, sessions, conversions, signals] = await Promise.all([
    promoterRepository.links.list({ promoterId }, { sort: { createdAt: -1 }, limit: 1000 }),
    promoterRepository.clicks.list({ promoterId }, { sort: { createdAt: -1 }, limit: 5000 }),
    promoterRepository.attributionSessions.list({ promoterId }, { sort: { createdAt: -1 }, limit: 5000 }),
    promoterRepository.conversions.list({ promoterId }, { sort: { convertedAt: -1 }, limit: 5000 }),
    promoterRepository.fraudSignals.list({ $or: [{ promoterId }, { agentId: promoterId }] }, { sort: { createdAt: -1 }, limit: 5000 }),
  ]);
  return {
    clicks: clicks.map((row) => [row.id, row.code, row.listingId, row.ip, row.userAgent, row.createdAt, row.campaignId || '']),
    attributionSessions: sessions.map((row) => [row.id, row.referralCode, row.listingId, row.campaignId, row.status, row.bookingRef || '', row.createdAt]),
    campaignConversions: conversions.map((row) => [row.id, row.campaignId, row.bookingRef, row.amount, row.commissionAmount, row.status, row.convertedAt]),
    referralCards: links.map((link) => [link.id, link.code, link.listingId, link.url, link.qrCardUrl || `/promoter/links/${link.id}/qr-card`, link.status]),
    fraudSignals: signals.map((row) => [row.id, row.bookingRef, row.signalType, row.severity, row.score, row.status, row.createdAt]),
  };
}

module.exports = {
  ensureAgentProfile, createReferralLink, createQrReferralCard, recordClick, recordConversion,
  createFraudSignal, reviewFraudSignal, promoterReportRows,
  createReferralLinkLive: createReferralLink, createQrReferralCardLive: createQrReferralCard,
  reviewFraudSignalLive: reviewFraudSignal, promoterReportRowsLive: promoterReportRows,
  requirePromoterLive: requirePromoter,
};
