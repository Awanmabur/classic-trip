const store = require('../../services/data/demoStore');
const { mongoose } = require('../../config/db');

function cleanText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

function amountValue(value) {
  const amount = Number(String(value || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(amount) ? amount : 0;
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

async function persist(campaign) {
  if (mongoose.connection.readyState !== 1 || !campaign) return;
  const PromotionCampaign = require('../../models/PromotionCampaign');
  await PromotionCampaign.updateOne({ id: campaign.id }, { $set: campaign }, { upsert: true, runValidators: true });
}

function index(req, res) {
  const promoterId = req.session?.user?.id || 'user-promoter-001';
  res.json(store.state.promotionCampaigns.filter((campaign) => !campaign.promoterId || campaign.promoterId === promoterId));
}

async function create(req, res, next) {
  try {
    if (!Array.isArray(store.state.promotionCampaigns)) store.state.promotionCampaigns = [];
    const listing = store.findListing(req.body.listingId || req.body.listingSlug || req.body.title);
    if (!listing) {
      const error = new Error('Listing not found');
      error.status = 404;
      throw error;
    }
    const campaign = {
      id: nextId('campaign', store.state.promotionCampaigns),
      companyId: listing.companyId,
      promoterId: req.session?.user?.id || 'user-promoter-001',
      listingId: listing.id,
      name: cleanText(req.body.name || req.body.title || `${listing.title} referral push`),
      placement: cleanText(req.body.placement || 'promoter_share'),
      budget: amountValue(req.body.budget),
      clicks: 0,
      bookings: 0,
      status: cleanText(req.body.status || 'active').toLowerCase(),
      startsAt: req.body.startsAt || null,
      endsAt: req.body.endsAt || null,
      createdAt: new Date().toISOString(),
    };
    store.state.promotionCampaigns.unshift(campaign);
    await persist(campaign);
    res.redirect('/promoter/campaigns');
  } catch (error) {
    next(error);
  }
}

module.exports = { index, create };
