'use strict';

const crypto = require('crypto');
const IdempotencyKeyRecord = require('../../models/IdempotencyKeyRecord');
const busRepository = require('../../modules/bus/repositories/busRepository');
const companyService = require('./companyService');

const IDEMPOTENCY_SCOPE = 'bus_service_onboarding';
const CLAIM_TTL_MS = 15 * 60 * 1000;

function cleanText(value, max = 500) {
  return String(value || '').replace(/<[^>]*>/g, '').trim().slice(0, max);
}

function normalizedStatus(value, fallback = 'draft') {
  return cleanText(value || fallback, 40).toLowerCase().replace(/[^a-z_]/g, '_');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
}

function payloadHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(payload || {}))).digest('hex');
}

function generatedIdempotencyKey(companyId, actorId, hash) {
  return `${companyId}:${actorId}:${hash}:${crypto.randomUUID()}`;
}

async function activeBranchOrThrow(companyId, branchId, label) {
  const id = cleanText(branchId, 180);
  if (!id) {
    const error = new Error(`${label} is required. Create the terminal first, then select it.`);
    error.status = 422;
    throw error;
  }
  const branch = await busRepository.branches.findOne({ id, companyId, status: { $ne: 'archived' } });
  if (!branch) {
    const error = new Error(`${label} does not belong to this company or is archived`);
    error.status = 422;
    throw error;
  }
  return branch;
}

function branchLabel(branch = {}) {
  return cleanText([branch.name, branch.city].filter(Boolean).join(', '), 180);
}

async function claimIdempotencyKey({ companyId, actorId, key, hash }) {
  const normalizedKey = cleanText(key, 220) || generatedIdempotencyKey(companyId, actorId, hash);
  const scopedKey = `${companyId}:${normalizedKey}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CLAIM_TTL_MS);

  try {
    const result = await IdempotencyKeyRecord.findOneAndUpdate(
      { key: scopedKey, scope: IDEMPOTENCY_SCOPE },
      {
        $setOnInsert: {
          id: `idem-${crypto.createHash('sha256').update(`${IDEMPOTENCY_SCOPE}:${scopedKey}`).digest('hex')}`,
          key: scopedKey,
          scope: IDEMPOTENCY_SCOPE,
          entityType: 'bus_service',
          payloadHash: hash,
          status: 'started',
          firstSeenAt: now,
        },
        $set: { lastSeenAt: now, expiresAt },
      },
      { upsert: true, new: true, includeResultMetadata: true, setDefaultsOnInsert: true },
    );
    const record = result.value;
    const inserted = !result.lastErrorObject?.updatedExisting;
    if (inserted) return { claimed: true, record };

    if (record.payloadHash && record.payloadHash !== hash) {
      const error = new Error('This submission key was already used for different bus-service data. Reopen the form and submit again.');
      error.status = 409;
      error.code = 'idempotency_payload_mismatch';
      throw error;
    }
    if (record.status === 'completed') return { claimed: false, record };

    const lastSeenAt = new Date(record.lastSeenAt || record.updatedAt || 0).getTime();
    const stale = !Number.isFinite(lastSeenAt) || (Date.now() - lastSeenAt) > CLAIM_TTL_MS;
    if (record.status === 'failed' || stale) {
      const reclaimed = await IdempotencyKeyRecord.findOneAndUpdate(
        { _id: record._id, status: record.status, lastSeenAt: record.lastSeenAt },
        { $set: { status: 'started', payloadHash: hash, lastSeenAt: now, expiresAt, metadata: {} } },
        { new: true },
      );
      if (reclaimed) return { claimed: true, record: reclaimed };
    }

    return { claimed: false, record };
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const record = await IdempotencyKeyRecord.findOne({ key: scopedKey, scope: IDEMPOTENCY_SCOPE });
    if (record?.payloadHash && record.payloadHash !== hash) {
      const conflict = new Error('This submission key was already used for different bus-service data. Reopen the form and submit again.');
      conflict.status = 409;
      conflict.code = 'idempotency_payload_mismatch';
      throw conflict;
    }
    return { claimed: false, record };
  }
}

async function resolveIdempotencyKey(record, status, metadata = {}) {
  if (!record?._id) return;
  await IdempotencyKeyRecord.updateOne(
    { _id: record._id },
    {
      $set: {
        status,
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + CLAIM_TTL_MS),
        metadata,
      },
    },
  );
}

function summarize(created) {
  return {
    listing: created.listing,
    vehicle: created.vehicle,
    route: created.route,
    routeStops: created.routeStops || [],
    fare: created.fare,
    schedule: created.schedule,
    seats: created.seats || [],
  };
}

// A failed one-screen setup has no accepted bookings. Remove only records created by this request,
// in reverse dependency order, so a failed wizard never leaves archived or half-connected debris.
async function rollback(companyId, created, actorId) {
  const listingId = created.listing?.id;
  const vehicleId = created.vehicle?.id;
  const routeId = created.route?.id;
  const fareProductId = created.fare?.id;
  const scheduleId = created.schedule?.id;

  await busRepository.withTransaction(async (session) => {
    const options = session ? { session } : {};
    if (scheduleId) {
      await busRepository.ticketScans.deleteMany({ companyId, scheduleId }, options);
      await busRepository.driverAssignments.deleteMany({ companyId, scheduleId }, options);
      await busRepository.segmentInventory.deleteMany({ companyId, scheduleId }, options);
      await busRepository.seats.deleteMany({ companyId, scheduleId }, options);
      await busRepository.schedules.deleteMany({ companyId, id: scheduleId }, options);
    }
    if (fareProductId) {
      await busRepository.segmentFares.deleteMany({ companyId, fareProductId }, options);
      await busRepository.fareProducts.deleteMany({ companyId, id: fareProductId }, options);
    }
    if (routeId) {
      await busRepository.routeSegments.deleteMany({ companyId, routeId }, options);
      await busRepository.routeStops.deleteMany({ companyId, routeId }, options);
      await busRepository.routes.deleteMany({ companyId, id: routeId }, options);
    }
    if (vehicleId) {
      await busRepository.seatMapVersions.deleteMany({ companyId, vehicleId }, options);
      await busRepository.seatMapTemplates.deleteMany({ companyId, vehicleId }, options);
      await busRepository.vehicles.deleteMany({ companyId, id: vehicleId }, options);
    }
    if (listingId) await busRepository.listings.deleteMany({ companyId, id: listingId }, options);
  });

  await busRepository.audit({
    actorId,
    action: 'bus.service_setup.rolled_back',
    targetType: 'bus_service',
    targetId: listingId || companyId,
    companyId,
    metadata: {
      createdListingId: listingId || '',
      createdVehicleId: vehicleId || '',
      createdRouteId: routeId || '',
      createdFareProductId: fareProductId || '',
      createdScheduleId: scheduleId || '',
    },
  });
}

// Creates the canonical chain used by the individual bus forms. Active means the whole chain,
// including a future published departure, passed the same backend readiness rules as manual setup.
async function createBusService(companyId, payload = {}, options = {}) {
  const actorId = cleanText(options.actorId || 'company-admin', 180);
  const hash = payloadHash(payload);
  const claim = await claimIdempotencyKey({
    companyId,
    actorId,
    key: options.idempotencyKey || payload.idempotencyKey,
    hash,
  });

  if (!claim.claimed) {
    if (claim.record?.status === 'completed' && claim.record.metadata?.result) {
      return { ...claim.record.metadata.result, replayed: true };
    }
    const error = new Error('This bus-service submission is already being processed. Do not submit it twice.');
    error.status = 409;
    error.code = 'idempotency_in_progress';
    throw error;
  }

  const listingPayload = payload.listing || {};
  const vehiclePayload = payload.vehicle || {};
  const routePayload = payload.route || {};
  const farePayload = payload.fare || {};
  const schedulePayload = payload.schedule || {};
  const requestedPublishListing = ['active', 'published'].includes(normalizedStatus(listingPayload.status));
  const requestedDriverId = cleanText(schedulePayload.driverId || '', 180);
  const publishListing = requestedPublishListing && Boolean(requestedDriverId);
  const departureStatus = publishListing ? 'published' : 'draft';
  const created = {};

  try {
    const originBranch = await activeBranchOrThrow(
      companyId,
      routePayload.originBranchId || routePayload.originTerminalId,
      'Origin terminal / branch',
    );
    const destinationBranch = await activeBranchOrThrow(
      companyId,
      routePayload.destinationBranchId || routePayload.destinationTerminalId,
      'Destination terminal / branch',
    );
    if (String(originBranch.id) === String(destinationBranch.id)) {
      const error = new Error('Origin and destination must be different');
      error.status = 422;
      throw error;
    }

    created.listing = await companyService.createListing(companyId, {
      ...listingPayload,
      status: 'draft',
      branchId: listingPayload.branchId || originBranch.id,
      serviceType: 'bus',
      actorId,
    });

    created.vehicle = await companyService.createVehicle(companyId, {
      ...vehiclePayload,
      listingId: created.listing.id,
      serviceType: 'bus',
      actorId,
    });

    created.route = await companyService.createRoute(companyId, {
      ...routePayload,
      listingId: created.listing.id,
      serviceType: 'bus',
      originBranchId: originBranch.id,
      destinationBranchId: destinationBranch.id,
      from: routePayload.origin || routePayload.from || branchLabel(originBranch),
      to: routePayload.destination || routePayload.to || branchLabel(destinationBranch),
      actorId,
    });
    created.routeStops = await busRepository.routeStops.list(
      { companyId, routeId: created.route.id, status: { $ne: 'archived' } },
      { sort: { stopOrder: 1 }, limit: 1000 },
    );

    created.fare = await companyService.createFareProduct(companyId, {
      ...farePayload,
      listingId: created.listing.id,
      routeId: created.route.id,
      status: farePayload.status || 'active',
    }, actorId);

    const scheduleResult = await companyService.createSchedule(companyId, {
      ...schedulePayload,
      listingId: created.listing.id,
      routeId: created.route.id,
      vehicleId: created.vehicle.id,
      fareProductId: created.fare.id,
      status: departureStatus,
      actorId,
    });
    created.schedule = scheduleResult.schedule;
    created.seats = scheduleResult.seats;

    if (publishListing) {
      created.listing = await companyService.publishListing(companyId, created.listing.id, actorId);
    }

    const result = {
      ...summarize(created), replayed: false,
      publicationDeferred: requestedPublishListing && !publishListing,
      publicationMessage: requestedPublishListing && !publishListing
        ? 'The complete bus setup was saved as Draft because no saved company driver was selected.' : '',
    };
    await busRepository.audit({
      actorId,
      action: 'bus.service_setup.created',
      targetType: 'bus_service',
      targetId: created.listing.id,
      companyId,
      metadata: {
        vehicleId: created.vehicle.id,
        routeId: created.route.id,
        fareProductId: created.fare.id,
        scheduleId: created.schedule.id,
        departureStatus: created.schedule.status,
        listingStatus: created.listing.status,
      },
    });
    await resolveIdempotencyKey(claim.record, 'completed', { result });
    return result;
  } catch (error) {
    try {
      await rollback(companyId, created, actorId);
    } catch (rollbackError) {
      error.rollbackError = rollbackError.message || String(rollbackError);
    }
    await resolveIdempotencyKey(claim.record, 'failed', {
      error: cleanText(error.message || error, 1200),
      rollbackError: cleanText(error.rollbackError || '', 1200),
    });
    throw error;
  }
}

module.exports = { createBusService };
