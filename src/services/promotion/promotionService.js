const store = require('../data/persistentStore');

function activeCampaigns(companyId) {
  const now = new Date();
  return store.state.promotionCampaigns.filter((campaign) => {
    if (companyId && campaign.companyId !== companyId) return false;
    if (campaign.status !== 'active') return false;
    if (campaign.startsAt && new Date(campaign.startsAt) > now) return false;
    if (campaign.endsAt && new Date(campaign.endsAt) < now) return false;
    return true;
  });
}

function markSponsored(listingId, campaign = {}) {
  const listing = store.findListing(listingId);
  if (!listing) return null;
  listing.isSponsored = true;
  const row = {
    id: `campaign-${store.state.promotionCampaigns.length + 1}`,
    listingId: listing.id,
    companyId: listing.companyId,
    name: campaign.name || `${listing.title} boost`,
    placement: campaign.placement || 'route_boost',
    budget: Number(campaign.budget || 0),
    clicks: 0,
    bookings: 0,
    status: 'active',
    startsAt: campaign.startsAt || new Date().toISOString(),
    endsAt: campaign.endsAt || null,
    createdAt: new Date().toISOString(),
  };
  store.state.promotionCampaigns.push(row);
  return { listing, campaign: row };
}

module.exports = { activeCampaigns, markSponsored };
