const store = require('../data/persistentStore');
const toSlug = require('../../utils/slugify');

function uniqueCode(baseCode) {
  const root = String(baseCode || `PROMO-${Date.now()}`).trim().toUpperCase().replace(/[^A-Z0-9-]+/g, '-');
  let code = root || `PROMO-${Date.now()}`;
  let counter = 1;
  while (store.state.promoterLinks.some((link) => link.code === code)) {
    counter += 1;
    code = `${root}-${counter}`;
  }
  return code;
}

function createLink({ promoterId = 'user-promoter-001', listingId, code } = {}) {
  const listing = store.findListing(listingId);
  if (!listing) {
    const error = new Error('Listing not found');
    error.status = 404;
    throw error;
  }
  const finalCode = uniqueCode(code || `${toSlug(listing.type || listing.serviceType).toUpperCase()}-${Date.now()}`);
  const link = {
    id: `promoter-link-${store.state.promoterLinks.length + 1}`,
    promoterId,
    listingId: listing.id,
    code: finalCode,
    referralCode: finalCode,
    url: `/listings/${listing.serviceType}/${listing.slug}?ref=${encodeURIComponent(finalCode)}`,
    clicks: 0,
    conversions: 0,
    status: 'active',
    createdAt: new Date().toISOString(),
  };
  store.state.promoterLinks.push(link);
  return link;
}

function archiveLink({ promoterId = 'user-promoter-001', linkId, actorId = promoterId } = {}) {
  const key = String(linkId || '').trim();
  const link = store.state.promoterLinks.find((item) => (
    (item.id === key || item.code === key || item.referralCode === key) &&
    item.promoterId === promoterId
  ));
  if (!link) {
    const error = new Error('Promoter link not found');
    error.status = 404;
    throw error;
  }
  link.status = 'archived';
  link.archivedAt = new Date().toISOString();
  link.archivedBy = actorId;
  link.updatedAt = link.archivedAt;
  return link;
}

function linksForPromoter(promoterId = 'user-promoter-001') {
  return store.state.promoterLinks
    .filter((link) => link.promoterId === promoterId && String(link.status || '').toLowerCase() !== 'archived')
    .map(store.publicPromoterLink);
}

module.exports = { createLink, archiveLink, linksForPromoter };
