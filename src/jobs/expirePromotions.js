const contentRepository = require('../repositories/domain/contentRepository');
async function run(now = new Date()) {
  const campaigns = await contentRepository.promotionCampaigns.list({}, { limit: 5000 }); let expired = 0;
  for (const campaign of campaigns) {
    if (campaign.status === 'active' && campaign.endsAt && new Date(campaign.endsAt) < now) { campaign.status = 'expired'; campaign.expiredAt = now.toISOString(); await contentRepository.promotionCampaigns.save(campaign, { id: campaign.id }); expired += 1; }
  }
  const listings = await contentRepository.listings.list({}, { limit: 5000 }); let sponsoredListings = 0;
  for (const listing of listings) {
    const isSponsored = campaigns.some((campaign) => campaign.listingId === listing.id && campaign.status === 'active' && (!campaign.startsAt || new Date(campaign.startsAt) <= now) && (!campaign.endsAt || new Date(campaign.endsAt) >= now));
    if (Boolean(listing.isSponsored) !== isSponsored) { listing.isSponsored = isSponsored; listing.updatedAt = now.toISOString(); await contentRepository.listings.save(listing, { id: listing.id }); }
    if (isSponsored) sponsoredListings += 1;
  }
  return { expired, sponsoredListings };
}
module.exports = { run };
