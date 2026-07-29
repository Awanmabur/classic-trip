'use strict';

const repository = require('../../modules/bus/repositories/busRepository');

async function restoreLegacyDemotedBusListings() {
  const candidates = await repository.listings.list({
    serviceType: 'bus',
    status: 'draft',
    releaseStatus: 'draft',
    'publication.readiness': 'incomplete',
    'publication.lastCheckedAt': { $exists: true },
    'publication.lastStatusChangeAt': { $exists: false },
  }, { limit: 500 });
  let restored = 0;
  for (const listing of candidates) {
    const publicationAudit = await repository.auditLogs.findOne({
      action: 'bus.listing.published',
      targetType: 'listing',
      targetId: listing.id,
      companyId: listing.companyId,
    });
    if (!publicationAudit) continue;
    const repairedAt = new Date().toISOString();
    listing.status = 'active';
    listing.releaseStatus = 'published';
    listing.bookable = false;
    listing.publication = {
      ...(listing.publication || {}),
      public: false,
      state: 'published',
      restoredFromLegacyReadinessRollbackAt: repairedAt,
    };
    listing.updatedAt = repairedAt;
    await repository.listings.save(listing, { id: listing.id });
    await repository.audit({
      actorId: 'system',
      action: 'bus.listing.legacy_publication_restored',
      targetType: 'listing',
      targetId: listing.id,
      companyId: listing.companyId,
      metadata: { bookable: false, reason: 'legacy_readiness_rollback' },
    });
    restored += 1;
  }
  return restored;
}

module.exports = { restoreLegacyDemotedBusListings };
