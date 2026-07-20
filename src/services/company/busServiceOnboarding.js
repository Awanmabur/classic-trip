const store = require('../data/persistentStore');
const companyService = require('./companyService');
const { mongoReady } = require('../shared/mongoUnitOfWork');

const IDEMPOTENCY_SCOPE = 'bus_service_onboarding';

function cleanText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

function audit(actorId, action, target, meta = {}) {
  store.state.auditLogs.push({
    id: `audit-${store.state.auditLogs.length + 1}`,
    actorId,
    action,
    target,
    meta,
    createdAt: new Date().toISOString(),
  });
}

// In-process fallback, used only when MongoDB isn't connected (local dev without a database, or
// the seeded in-memory test read model - the same situation idService.nextId() falls back for).
// Never durable across restarts/processes, but keeps the double-submit guard working instead of
// silently no-opping in those environments.
const fallbackIdempotencyRecords = new Map();

// Claims an idempotency key with one atomic findOneAndUpdate upsert: whichever caller's upsert
// actually inserts the document is the one that gets to proceed (`claimed: true`); everyone else
// finds the just-inserted (or older) document already there (`claimed: false`) and replays its
// result instead of creating a duplicate bus service. This is atomic via the single-document
// upsert operation itself, not a unique index, so it doesn't race against index-build timing.
async function claimIdempotencyKey(key) {
  if (!key) return { claimed: true, record: null };
  if (!mongoReady()) {
    const existing = fallbackIdempotencyRecords.get(key);
    if (!existing || existing.status === 'failed') {
      const record = existing || { status: 'started', metadata: {}, firstSeenAt: new Date() };
      record.status = 'started';
      record.lastSeenAt = new Date();
      fallbackIdempotencyRecords.set(key, record);
      return { claimed: true, record };
    }
    return { claimed: false, record: existing };
  }
  const IdempotencyKeyRecord = require('../../models/IdempotencyKeyRecord');
  const now = new Date();
  const raw = await IdempotencyKeyRecord.findOneAndUpdate(
    { key, scope: IDEMPOTENCY_SCOPE },
    {
      $setOnInsert: {
        id: `idem-${IDEMPOTENCY_SCOPE}-${key}`,
        key,
        scope: IDEMPOTENCY_SCOPE,
        status: 'started',
        firstSeenAt: now,
      },
      $set: { lastSeenAt: now },
    },
    { upsert: true, new: true, includeResultMetadata: true, setDefaultsOnInsert: true }
  );
  const claimed = !raw.lastErrorObject?.updatedExisting;
  if (!claimed && raw.value?.status === 'failed') {
    // A previous attempt under this key failed; allow a clean retry instead of blocking forever.
    await IdempotencyKeyRecord.updateOne({ _id: raw.value._id }, { $set: { status: 'started', lastSeenAt: now } });
    return { claimed: true, record: raw.value };
  }
  return { claimed, record: raw.value };
}

async function resolveIdempotencyKey(record, status, extra = {}) {
  if (!record) return;
  if (!mongoReady()) {
    record.status = status;
    record.lastSeenAt = new Date();
    record.metadata = extra;
    return;
  }
  const IdempotencyKeyRecord = require('../../models/IdempotencyKeyRecord');
  await IdempotencyKeyRecord.updateOne({ _id: record._id }, {
    $set: { status, lastSeenAt: new Date(), metadata: extra },
  });
}

function summarize(created) {
  return {
    listing: created.listing,
    vehicle: created.vehicle,
    route: created.route,
    schedule: created.schedule,
    seats: created.seats,
  };
}

// Best-effort compensation for a wizard attempt that failed partway through. Nothing created here
// can have bookings yet (the schedule - the last, booking-enabling step - either never finished or
// is itself being rolled back first), so archiving is a safe, complete undo: archived records are
// excluded from search, marketplace listings, and booking eligibility everywhere else in the app.
// Uses the existing archive*() functions rather than raw deletes, matching this codebase's
// no-hard-delete convention and their already-tested cascade behavior (e.g. archiveRoute also
// archives its schedules).
async function rollback(companyId, created, actorId) {
  const steps = [
    ['schedule', () => created.schedule && companyService.archiveSchedule(companyId, created.schedule.id)],
    ['route', () => created.route && companyService.archiveRoute(companyId, created.route.id)],
    ['vehicle', () => created.vehicle && companyService.archiveVehicle(companyId, created.vehicle.id)],
    ['listing', () => created.listing && companyService.archiveListing(companyId, created.listing.id)],
  ];
  const failures = [];
  for (const [label, step] of steps) {
    try {
      await step();
    } catch (rollbackError) {
      failures.push({ step: label, message: rollbackError.message });
    }
  }
  audit(actorId, 'company.bus_service.rolled_back', created.listing?.id || companyId, {
    companyId,
    createdSteps: Object.keys(created).filter((key) => created[key]),
    rollbackFailures: failures,
  });
}

// Creates a full bus service (listing + vehicle + route/stops + first schedule/seats) as one
// logical unit. This app's hybrid in-memory/Mongo store means the four underlying creation calls
// each commit independently (see the architecture note in the onboarding rebuild plan), so
// atomicity here comes from compensating rollback on failure rather than a single Mongo
// transaction: whatever succeeded before the failure is archived, not left as an orphaned,
// half-created, live listing.
//
// `payload` takes explicit, non-overlapping sub-objects rather than one flat bag of fields:
// listing/vehicle/route/schedule each read a `status` (and other same-named fields) with different
// meanings, so flattening them would silently cross-apply one entity's field to another.
async function createBusService(companyId, payload = {}, options = {}) {
  const actorId = options.actorId || 'company-admin';
  const idempotencyKey = cleanText(options.idempotencyKey || payload.idempotencyKey);
  const claim = await claimIdempotencyKey(idempotencyKey);
  if (!claim.claimed) {
    if (claim.record?.status === 'completed') return claim.record.metadata?.result || {};
    const error = new Error('This bus service submission is already being processed. Please wait before retrying.');
    error.status = 409;
    throw error;
  }

  const listingPayload = payload.listing || {};
  const vehiclePayload = payload.vehicle || {};
  const routePayload = payload.route || {};
  const schedulePayload = payload.schedule || {};

  const created = {};
  try {
    created.listing = await companyService.createListing(companyId, { ...listingPayload, serviceType: listingPayload.serviceType || 'bus' });
    created.vehicle = await companyService.createVehicle(companyId, {
      ...vehiclePayload,
      listingId: created.listing.id,
      serviceType: created.listing.serviceType,
    });
    created.route = await companyService.createRoute(companyId, {
      ...routePayload,
      listingId: created.listing.id,
      from: routePayload.origin || routePayload.from || listingPayload.from,
      to: routePayload.destination || routePayload.to || listingPayload.to,
    });
    const scheduleResult = await companyService.createSchedule(companyId, {
      ...schedulePayload,
      routeId: created.route.id,
      vehicleId: created.vehicle.id,
    });
    created.schedule = scheduleResult.schedule;
    created.seats = scheduleResult.seats;

    const result = summarize(created);
    audit(actorId, 'company.bus_service.created', created.listing.id, {
      companyId,
      vehicleId: created.vehicle.id,
      routeId: created.route.id,
      scheduleId: created.schedule.id,
    });
    await resolveIdempotencyKey(claim.record, 'completed', { result });
    return result;
  } catch (error) {
    await rollback(companyId, created, actorId);
    await resolveIdempotencyKey(claim.record, 'failed', { error: String(error.message || error) });
    throw error;
  }
}

module.exports = { createBusService };
