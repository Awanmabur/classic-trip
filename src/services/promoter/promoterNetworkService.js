const store = require('../data/persistentStore');
const promoterService = require('./promoterService');
const walletService = require('../wallet/walletService');

function clean(value, limit = 500) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, limit);
}

function normalize(value) { return clean(value).toLowerCase(); }

function now() { return new Date().toISOString(); }

function ensureCollections() {
  ['agentProfiles', 'attributionSessions', 'campaignConversions', 'fraudSignals', 'referralClicks', 'promoterLinks', 'promotionCampaigns'].forEach((key) => {
    if (!Array.isArray(store.state[key])) store.state[key] = [];
  });
}

function nextId(prefix, rows) { return `${prefix}-${String((rows || []).length + 1).padStart(5, '0')}`; }

function requirePromoter(promoterId) {
  const promoter = store.state.users.find((user) => user.id === promoterId && user.role === 'promoter');
  if (!promoter) {
    const error = new Error('Promoter or agent account not found');
    error.status = 404;
    throw error;
  }
  return promoter;
}

function ensureAgentProfile(promoterId, payload = {}, actorId = promoterId) {
  ensureCollections();
  const promoter = requirePromoter(promoterId);
  let profile = store.state.agentProfiles.find((row) => row.userId === promoterId || row.promoterId === promoterId);
  const permissions = Array.isArray(payload.permissions)
    ? payload.permissions
    : clean(payload.permissions || 'offline_sales,referral_links').split(',').map((item) => clean(item)).filter(Boolean);
  if (!profile) {
    profile = {
      id: nextId('agent-profile', store.state.agentProfiles),
      userId: promoterId,
      promoterId,
      agentCode: payload.agentCode || promoter.referralCode || `AGENT-${store.state.agentProfiles.length + 1}`,
      createdAt: now(),
      createdBy: actorId,
    };
    store.state.agentProfiles.unshift(profile);
  }
  Object.assign(profile, {
    officeName: clean(payload.officeName || payload.name || profile.officeName || `${promoter.fullName} desk`),
    terminalId: clean(payload.terminalId || profile.terminalId || ''),
    branchId: clean(payload.branchId || profile.branchId || ''),
    location: clean(payload.location || profile.location || ''),
    payoutMethod: clean(payload.payoutMethod || profile.payoutMethod || promoter.payoutAccount?.method || 'mobile_money'),
    payoutAccount: clean(payload.payoutAccount || profile.payoutAccount || promoter.phone || ''),
    offlineSalesEnabled: payload.offlineSalesEnabled === false || payload.offlineSalesEnabled === 'false' ? false : true,
    permissions: permissions.length ? permissions : (profile.permissions || ['offline_sales', 'referral_links']),
    dailyLimit: Number(payload.dailyLimit || profile.dailyLimit || 0),
    status: clean(payload.status || profile.status || 'active'),
    verifiedAt: profile.verifiedAt || now(),
    updatedAt: now(),
    updatedBy: actorId,
  });
  promoter.agentProfile = {
    id: profile.id,
    agentCode: profile.agentCode,
    offlineSalesEnabled: profile.offlineSalesEnabled,
    permissions: profile.permissions,
    location: profile.location,
    dailyLimit: profile.dailyLimit,
  };
  promoter.promoterProfile = {
    ...(promoter.promoterProfile || {}),
    offlineSalesEnabled: profile.offlineSalesEnabled,
    agentPermissions: profile.permissions,
  };
  walletService.getOrCreateWallet('promoter', promoterId, payload.currency || 'UGX');
  return profile;
}

function createReferralLink(payload = {}, actorId = payload.promoterId) {
  ensureCollections();
  const promoterId = payload.promoterId || actorId || 'user-promoter-001';
  requirePromoter(promoterId);
  const link = promoterService.createLink({ promoterId, listingId: payload.listingId, code: payload.code });
  Object.assign(link, {
    campaignId: clean(payload.campaignId),
    sourceChannel: clean(payload.sourceChannel || payload.channel || 'direct'),
    audience: clean(payload.audience || ''),
    expiresAt: payload.expiresAt || '',
    qrCardUrl: `/promoter/links/${encodeURIComponent(link.id)}/qr-card`,
    shareTitle: clean(payload.shareTitle || 'Book on Classic Trip'),
    shareText: clean(payload.shareText || 'Use my Classic Trip link to book securely.'),
    updatedAt: now(),
  });
  return link;
}

function createQrReferralCard(promoterId, linkId) {
  ensureCollections();
  const link = store.state.promoterLinks.find((row) => row.promoterId === promoterId && (row.id === linkId || row.code === linkId));
  if (!link) {
    const error = new Error('Referral link not found');
    error.status = 404;
    throw error;
  }
  const listing = store.findListing(link.listingId) || {};
  const promoter = requirePromoter(promoterId);
  const card = {
    id: `qr-card-${link.id}`,
    promoterId,
    linkId: link.id,
    code: link.code,
    title: `${listing.title || 'Classic Trip'} referral card`,
    qrPayload: link.url,
    printableUrl: `/promoter/links/${encodeURIComponent(link.id)}/qr-card`,
    promoterName: promoter.fullName,
    listingTitle: listing.title || '',
    createdAt: now(),
  };
  link.qrCard = card;
  link.qrCardUrl = card.printableUrl;
  return card;
}

function recordClick({ code, listingId, req, source = 'web', medium = 'referral' } = {}) {
  ensureCollections();
  const click = store.recordReferralClick(code, listingId, req);
  if (!click) return null;
  const link = store.state.promoterLinks.find((row) => row.id === click.linkId);
  const activeCampaign = link?.campaignId
    ? store.state.promotionCampaigns.find((campaign) => campaign.id === link.campaignId)
    : store.state.promotionCampaigns.find((campaign) => campaign.listingId === (listingId || link?.listingId) && campaign.status === 'active');
  if (activeCampaign) {
    activeCampaign.clicks = Number(activeCampaign.clicks || 0) + 1;
    click.campaignId = activeCampaign.id;
  }
  const session = {
    id: nextId('attr-session', store.state.attributionSessions),
    sessionKey: req?.sessionID || `session-${Date.now()}-${store.state.attributionSessions.length + 1}`,
    clickId: click.id,
    linkId: click.linkId,
    promoterId: click.promoterId,
    listingId: click.listingId,
    campaignId: activeCampaign?.id || '',
    referralCode: code,
    source,
    medium,
    landingPath: req?.originalUrl || req?.url || '',
    ip: click.ip,
    userAgent: click.userAgent,
    status: 'active',
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: now(),
  };
  store.state.attributionSessions.unshift(session);
  return { click, session };
}

function recordConversion(booking = {}, source = 'booking') {
  ensureCollections();
  const attribution = booking.promoterAttribution || {};
  if (!attribution.promoterId) return null;
  const link = attribution.linkId ? store.state.promoterLinks.find((row) => row.id === attribution.linkId) : null;
  const session = store.state.attributionSessions.find((row) => row.linkId === attribution.linkId && row.status === 'active');
  const campaign = link?.campaignId
    ? store.state.promotionCampaigns.find((row) => row.id === link.campaignId)
    : store.state.promotionCampaigns.find((row) => row.listingId === booking.listingId && row.status === 'active');
  const existing = store.state.campaignConversions.find((row) => row.bookingRef === booking.bookingRef && row.promoterId === attribution.promoterId);
  if (session) {
    session.status = 'converted';
    session.convertedAt = now();
    session.bookingRef = booking.bookingRef;
  }
  if (link) link.conversions = Number(link.conversions || 0) + (existing ? 0 : 1);
  if (campaign && !existing) campaign.bookings = Number(campaign.bookings || 0) + 1;
  const conversion = existing || {
    id: nextId('campaign-conversion', store.state.campaignConversions),
    createdAt: now(),
  };
  Object.assign(conversion, {
    campaignId: campaign?.id || '',
    linkId: attribution.linkId || '',
    clickId: session?.clickId || '',
    promoterId: attribution.promoterId,
    listingId: booking.listingId,
    companyId: booking.companyId,
    bookingId: booking.id,
    bookingRef: booking.bookingRef,
    customerUserId: booking.customerUserId || '',
    amount: Number(booking.pricing?.total || 0),
    commissionAmount: Number(booking.pricing?.split?.promoterAmount || 0),
    currency: booking.pricing?.currency || 'UGX',
    attributionSource: source,
    status: booking.bookingStatus || 'confirmed',
    convertedAt: now(),
    updatedAt: now(),
  });
  if (!existing) store.state.campaignConversions.unshift(conversion);
  return conversion;
}

function createFraudSignal({ booking, signalType = 'promoter_risk', severity, score, reasons = [], metadata = {} } = {}) {
  ensureCollections();
  const signal = {
    id: nextId('fraud-signal', store.state.fraudSignals),
    promoterId: booking?.promoterAttribution?.promoterId || metadata.promoterId || '',
    agentId: booking?.createdByAgentId || metadata.agentId || '',
    bookingId: booking?.id || '',
    bookingRef: booking?.bookingRef || '',
    linkId: booking?.promoterAttribution?.linkId || metadata.linkId || '',
    clickId: metadata.clickId || '',
    signalType,
    severity: severity || (Number(score || 0) >= 60 ? 'high' : Number(score || 0) >= 25 ? 'medium' : 'low'),
    score: Number(score || 0),
    reasons,
    status: 'open',
    assignedTo: 'fraud-review',
    metadata,
    createdAt: now(),
  };
  store.state.fraudSignals.unshift(signal);
  return signal;
}

function reviewFraudSignal(signalId, payload = {}, actorId = 'admin-system') {
  ensureCollections();
  const signal = store.state.fraudSignals.find((row) => row.id === signalId || row.bookingRef === signalId);
  if (!signal) {
    const error = new Error('Fraud signal not found');
    error.status = 404;
    throw error;
  }
  Object.assign(signal, {
    status: clean(payload.status || 'resolved'),
    resolution: clean(payload.resolution || payload.note || 'Reviewed'),
    resolvedBy: actorId,
    resolvedAt: now(),
    updatedAt: now(),
  });
  return signal;
}

function promoterReportRows(promoterId) {
  ensureCollections();
  const links = store.state.promoterLinks.filter((row) => row.promoterId === promoterId);
  return {
    clicks: store.state.referralClicks.filter((row) => row.promoterId === promoterId).map((row) => [row.id, row.code, row.listingId, row.ip, row.userAgent, row.createdAt, row.campaignId || '']),
    attributionSessions: store.state.attributionSessions.filter((row) => row.promoterId === promoterId).map((row) => [row.id, row.referralCode, row.listingId, row.campaignId, row.status, row.bookingRef || '', row.createdAt]),
    campaignConversions: store.state.campaignConversions.filter((row) => row.promoterId === promoterId).map((row) => [row.id, row.campaignId, row.bookingRef, row.amount, row.commissionAmount, row.status, row.convertedAt]),
    referralCards: links.map((link) => [link.id, link.code, link.listingId, link.url, link.qrCardUrl || `/promoter/links/${link.id}/qr-card`, link.status]),
    fraudSignals: store.state.fraudSignals.filter((row) => row.promoterId === promoterId || row.agentId === promoterId).map((row) => [row.id, row.bookingRef, row.signalType, row.severity, row.score, row.status, row.createdAt]),
  };
}

module.exports = {
  ensureAgentProfile,
  createReferralLink,
  createQrReferralCard,
  recordClick,
  recordConversion,
  createFraudSignal,
  reviewFraudSignal,
  promoterReportRows,
};
