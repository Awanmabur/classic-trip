const promoterRepository = require('../../repositories/domain/promoterRepository');
const toSlug = require('../../utils/slugify');
const { nextId } = require('../data/idService');

function codeRoot(value) {
  return String(value || `PROMO-${Date.now()}`).trim().toUpperCase().replace(/[^A-Z0-9-]+/g, '-');
}

async function listingBy(value) {
  return promoterRepository.listings.findOne({ $or: [{ id: value }, { slug: value }] });
}

async function uniqueCode(baseCode) {
  const root = codeRoot(baseCode) || `PROMO-${Date.now()}`;
  let code = root;
  let counter = 1;
  while (await promoterRepository.links.findOne({ code })) {
    counter += 1;
    code = `${root}-${counter}`;
  }
  return code;
}

function publicLink(link, listing = null) {
  return {
    ...link,
    listing,
    shareUrl: link.url,
    conversionRate: link.clicks
      ? Math.round((Number(link.conversions || 0) / Number(link.clicks || 1)) * 1000) / 10
      : 0,
  };
}

async function createLink({ promoterId, listingId, code } = {}) {
  const listing = await listingBy(listingId);
  if (!listing || listing.status !== 'active') {
    const error = new Error('Listing not found or unavailable');
    error.status = listing ? 409 : 404;
    throw error;
  }
  const finalCode = await uniqueCode(code || `${toSlug(listing.type || listing.serviceType).toUpperCase()}-${Date.now()}`);
  const now = new Date().toISOString();
  const link = {
    id: await nextId('promoter-link'), promoterId, listingId: listing.id, code: finalCode, referralCode: finalCode,
    url: `/listings/${listing.serviceType}/${listing.slug}?ref=${encodeURIComponent(finalCode)}`,
    clicks: 0, conversions: 0, status: 'active', createdAt: now, updatedAt: now,
  };
  await promoterRepository.links.save(link, { id: link.id });
  return link;
}

async function archiveLink({ promoterId, linkId, actorId = promoterId } = {}) {
  const key = String(linkId || '').trim();
  const link = await promoterRepository.links.findOne({ promoterId, $or: [{ id: key }, { code: key }, { referralCode: key }] });
  if (!link) { const error = new Error('Promoter link not found'); error.status = 404; throw error; }
  Object.assign(link, { status: 'archived', archivedAt: new Date().toISOString(), archivedBy: actorId, updatedAt: new Date().toISOString() });
  await promoterRepository.links.save(link, { id: link.id });
  return link;
}

async function linksForPromoter(promoterId) {
  const links = await promoterRepository.links.list({ promoterId, status: { $ne: 'archived' } }, { sort: { createdAt: -1 }, limit: 500 });
  const listingIds = [...new Set(links.map((row) => row.listingId).filter(Boolean))];
  const listings = listingIds.length ? await promoterRepository.listings.list({ id: { $in: listingIds } }) : [];
  const byId = new Map(listings.map((row) => [row.id, row]));
  return links.map((link) => publicLink(link, byId.get(link.listingId) || null));
}

module.exports = {
  createLink,
  archiveLink,
  linksForPromoter,
  publicLink,
  listingBy,
  createLinkLive: createLink,
  archiveLinkLive: archiveLink,
  linksForPromoterLive: linksForPromoter,
  listingByLive: listingBy,
};
