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
    const liveDeparture = await repository.schedules.findOne({
      companyId: listing.companyId,
      listingId: listing.id,
      status: { $in: ['published', 'boarding', 'delayed'] },
      departAt: { $gt: new Date() },
    });
    const liveInventory = liveDeparture
      ? await repository.segmentInventory.count({ scheduleId: liveDeparture.id, status: 'available' })
      : 0;
    const bookable = Boolean(liveDeparture && liveInventory > 0);
    listing.status = 'active';
    listing.releaseStatus = 'published';
    listing.bookable = bookable;
    listing.publication = {
      ...(listing.publication || {}),
      public: true,
      state: 'published',
      readiness: bookable ? 'bookable' : (listing.publication?.readiness || 'incomplete'),
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
      metadata: { bookable, liveDepartureId: liveDeparture?.id || '', liveInventory, reason: 'legacy_readiness_rollback' },
    });
    restored += 1;
  }
  return restored;
}

module.exports = { restoreLegacyDemotedBusListings };
