const promoterRepository = require('../../repositories/domain/promoterRepository');
const { nextId } = require('../../services/data/idService');
const { resolvePromoterId } = require('../../utils/promoterScope');

function cleanText(value, max = 500) { return String(value || '').replace(/<[^>]*>/g, '').trim().replace(/\s+/g, ' ').slice(0, max); }
function amountValue(value) { const amount = Number(String(value || '').replace(/[^0-9.-]/g, '')); return Number.isFinite(amount) ? amount : 0; }

async function index(req, res, next) {
  try {
    const promoterId = resolvePromoterId(req);
    const campaigns = await promoterRepository.campaigns.list({ $or: [{ promoterId }, { promoterId: { $exists: false } }, { promoterId: '' }] }, { sort: { createdAt: -1 }, limit: 250 });
    return res.json(campaigns);
  } catch (error) { return next(error); }
}

async function create(req, res, next) {
  try {
    const key = cleanText(req.body.listingId || req.body.listingSlug || req.body.title, 180);
    const listing = await promoterRepository.listings.findOne({ $or: [{ id: key }, { slug: key }, { title: key }] });
    if (!listing || listing.status !== 'active') { const error = new Error('Listing not found or unavailable'); error.status = listing ? 409 : 404; throw error; }
    const status = cleanText(req.body.status || 'active', 40).toLowerCase();
    if (!['draft', 'active', 'paused', 'completed', 'expired'].includes(status)) { const error = new Error('Invalid campaign status'); error.status = 422; throw error; }
    const campaign = {
      id: await nextId('campaign'), companyId: listing.companyId, promoterId: resolvePromoterId(req), listingId: listing.id,
      name: cleanText(req.body.name || req.body.title || `${listing.title} referral push`, 180), placement: cleanText(req.body.placement || 'promoter_share', 80),
      budget: Math.max(0, amountValue(req.body.budget)), clicks: 0, bookings: 0, status,
      startsAt: req.body.startsAt || null, endsAt: req.body.endsAt || null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await promoterRepository.campaigns.save(campaign, { id: campaign.id });
    return res.redirect('/promoter/campaigns');
  } catch (error) { return next(error); }
}

module.exports = { index, create };
