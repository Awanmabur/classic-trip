const store = require('../services/data/demoStore');

function run(now = new Date()) {
  let expired = 0;
  store.state.promotionCampaigns.forEach((campaign) => {
    if (campaign.status === 'active' && campaign.endsAt && new Date(campaign.endsAt) < now) {
      campaign.status = 'expired';
      campaign.expiredAt = now.toISOString();
      expired += 1;
    }
  });

  store.state.listings.forEach((listing) => {
    const hasActiveCampaign = store.state.promotionCampaigns.some((campaign) => (
      campaign.listingId === listing.id
      && campaign.status === 'active'
      && (!campaign.startsAt || new Date(campaign.startsAt) <= now)
      && (!campaign.endsAt || new Date(campaign.endsAt) >= now)
    ));
    listing.isSponsored = hasActiveCampaign;
  });

  return { expired, sponsoredListings: store.state.listings.filter((listing) => listing.isSponsored).length };
}
module.exports = { run };
