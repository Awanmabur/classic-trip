const contentRepository = require('../../repositories/domain/contentRepository');
const { nextId } = require('../data/idService');
function cleanText(value) { return String(value || '').replace(/<[^>]*>/g, '').trim(); }
async function activeCampaigns(companyId) {
  const now = new Date();
  const filter = { status: 'active', ...(companyId ? { companyId } : {}) };
  return (await contentRepository.promotionCampaigns.list(filter, { sort: { createdAt: -1 }, limit: 5000 })).filter((row) => (!row.startsAt || new Date(row.startsAt) <= now) && (!row.endsAt || new Date(row.endsAt) >= now));
}
async function markSponsored(listingId, companyId, campaign = {}, actorId = '') {
  const listing = await contentRepository.listings.findOne({ id: listingId, companyId });
  if (!listing) { const error = new Error('You can only promote listings that belong to your own company'); error.status = 403; throw error; }
  const row = { id: await nextId('campaign'), listingId: listing.id, companyId: listing.companyId, name: cleanText(campaign.name) || `${listing.title} boost`, placement: cleanText(campaign.placement) || 'route_boost', budget: Math.max(0, Number(campaign.budget || 0)), clicks: 0, bookings: 0, status: 'active', startsAt: campaign.startsAt || new Date().toISOString(), endsAt: campaign.endsAt || null, createdBy: actorId, createdAt: new Date().toISOString() };
  listing.isSponsored = true; listing.updatedAt = new Date().toISOString();
  await Promise.all([contentRepository.promotionCampaigns.save(row, { id: row.id }), contentRepository.listings.save(listing, { id: listing.id })]);
  return { listing, campaign: row };
}
module.exports = { activeCampaigns, markSponsored };
