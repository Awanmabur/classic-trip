'use strict';

const contentRepository = require('../../repositories/domain/contentRepository');
const dashboardSnapshotService = require('../dashboard/dashboardSnapshotService');
const { nextId } = require('../data/idService');

function cleanText(value) { return String(value || '').replace(/<[^>]*>/g, '').trim(); }

function invalidateCampaignDashboards(companyId = '') {
  dashboardSnapshotService.invalidate('admin');
  dashboardSnapshotService.invalidate('content');
  if (companyId) dashboardSnapshotService.invalidate('company', { companyId });
}

async function activeCampaigns(companyId) {
  const now = new Date();
  const filter = { status: 'active', ...(companyId ? { companyId } : {}) };
  return (await contentRepository.promotionCampaigns.list(filter, { sort: { createdAt: -1 }, limit: 5000 }))
    .filter((row) => (!row.startsAt || new Date(row.startsAt) <= now) && (!row.endsAt || new Date(row.endsAt) >= now));
}

async function markSponsored(listingId, companyId, campaign = {}, actorId = '') {
  const listing = await contentRepository.listings.findOne({ id: cleanText(listingId), companyId });
  if (!listing) {
    const error = new Error('You can only promote listings that belong to your own company');
    error.status = 403;
    throw error;
  }
  if (!['active', 'published'].includes(String(listing.status || listing.releaseStatus || '').toLowerCase()) && listing.bookable !== true) {
    const error = new Error('Publish the service before creating a promotion campaign');
    error.status = 422;
    throw error;
  }
  const budget = Math.max(0, Number(campaign.budget || 0));
  if (!Number.isFinite(budget) || budget <= 0) {
    const error = new Error('Promotion budget must be greater than zero');
    error.status = 422;
    throw error;
  }
  const startsAt = campaign.startsAt ? new Date(campaign.startsAt) : new Date();
  const endsAt = campaign.endsAt ? new Date(campaign.endsAt) : null;
  if (Number.isNaN(startsAt.getTime()) || (endsAt && Number.isNaN(endsAt.getTime()))) {
    const error = new Error('Promotion dates are invalid');
    error.status = 422;
    throw error;
  }
  if (endsAt && endsAt <= startsAt) {
    const error = new Error('Promotion end date must be after its start date');
    error.status = 422;
    throw error;
  }
  const row = {
    id: await nextId('campaign'),
    listingId: listing.id,
    companyId: listing.companyId,
    name: cleanText(campaign.name) || `${listing.title} boost`,
    placement: cleanText(campaign.placement) || 'route_boost',
    budget,
    clicks: 0,
    bookings: 0,
    status: 'active',
    startsAt: startsAt.toISOString(),
    endsAt: endsAt ? endsAt.toISOString() : null,
    createdBy: actorId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  listing.isSponsored = true;
  listing.updatedAt = new Date().toISOString();
  await Promise.all([
    contentRepository.promotionCampaigns.save(row, { id: row.id }),
    contentRepository.listings.save(listing, { id: listing.id }),
  ]);
  invalidateCampaignDashboards(companyId);
  return { listing, campaign: row };
}

async function setCampaignStatus(campaignId, companyId, status, actorId = '') {
  const allowed = new Set(['active', 'paused', 'expired']);
  if (!allowed.has(status)) {
    const error = new Error('Unsupported campaign status');
    error.status = 422;
    throw error;
  }
  const campaign = await contentRepository.promotionCampaigns.findOne({ id: cleanText(campaignId), companyId });
  if (!campaign) {
    const error = new Error('Promotion campaign not found for this company');
    error.status = 404;
    throw error;
  }
  campaign.status = status;
  campaign.updatedBy = actorId;
  campaign.updatedAt = new Date().toISOString();
  if (status === 'expired' && !campaign.endsAt) campaign.endsAt = new Date().toISOString();
  await contentRepository.promotionCampaigns.save(campaign, { id: campaign.id });
  if (status === 'expired') {
    const otherActive = await contentRepository.promotionCampaigns.count({ listingId: campaign.listingId, companyId, status: 'active' });
    if (!otherActive) {
      const listing = await contentRepository.listings.findOne({ id: campaign.listingId, companyId });
      if (listing) {
        listing.isSponsored = false;
        listing.updatedAt = new Date().toISOString();
        await contentRepository.listings.save(listing, { id: listing.id });
      }
    }
  }
  invalidateCampaignDashboards(companyId);
  return campaign;
}

module.exports = { activeCampaigns, markSponsored, setCampaignStatus };
