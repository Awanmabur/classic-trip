'use strict';

const repo = require('../repositories/taxiRepository');
const rideService = require('./taxiRideService');
const { PLATFORM_MOBILITY_OWNER, MOBILITY_PARTNER_CATEGORIES } = require('../domain/taxiGovernance');
const { cleanText, conflictError, haversineKm, actorId } = require('../domain/taxiDomain');

function now() { return new Date(); }
function opts(session) { return session ? { session } : {}; }

async function eligibleCompany(companyId, options = {}) {
  const company = await repo.companies.findOne({
    id: companyId,
    companyType: 'local_transport',
    verificationStatus: 'verified',
    status: { $nin: ['suspended', 'rejected', 'archived'] },
  }, options);
  const category = String(company?.partnerCategory || company?.settings?.partnerCategory || '');
  return company && MOBILITY_PARTNER_CATEGORIES.includes(category) ? company : null;
}

async function dispatchRide(rideId, actor = {}) {
  return repo.withTransaction(async (session) => {
    const ride = await repo.oneOrThrow(repo.rides, {
      id: cleanText(rideId, 180), companyId: PLATFORM_MOBILITY_OWNER,
      status: { $in: ['dispatch_pending', 'driver_no_show'] },
    }, 'Ride is not ready for dispatch', opts(session));
    const request = await repo.oneOrThrow(repo.requests, { id: ride.requestId, companyId: PLATFORM_MOBILITY_OWNER }, 'Ride request was not found', opts(session));
    const activeSince = new Date(Date.now() - 3 * 60 * 1000);
    const availabilities = await repo.availability.list({
      status: 'available', lastHeartbeatAt: { $gte: activeSince },
      $or: [{ serviceTypes: ride.serviceType }, { serviceTypes: { $size: 0 } }],
    }, { ...opts(session), limit: 500 });
    const candidates = [];
    for (const availability of availabilities) {
      const provider = await eligibleCompany(availability.companyId, opts(session));
      if (!provider) continue;
      const driver = await repo.drivers.findOne({ id: availability.driverProfileId, companyId: provider.id, verificationStatus: 'verified' }, opts(session));
      const vehicle = driver ? await repo.vehicles.findOne({
        id: availability.vehicleId || driver.assignedVehicleId,
        companyId: provider.id, verificationStatus: 'verified', operationalStatus: { $in: ['available', 'offline'] },
      }, opts(session)) : null;
      if (!driver || !vehicle || String(vehicle.vehicleClassId) !== String(ride.vehicleClassId)) continue;
      const location = await repo.locations.findOne({ driverProfileId: driver.id, companyId: provider.id, expiresAt: { $gt: now() } }, { sort: { capturedAt: -1 }, ...opts(session) });
      if (!location) continue;
      const km = haversineKm(location, ride.pickup);
      if (km > 35) continue;
      candidates.push({ provider, driver, vehicle, availability, location, km, eta: Math.max(2, Math.ceil(km / 0.45)) });
    }
    candidates.sort((a, b) => a.km - b.km || Number(b.driver.ratingAverage || 0) - Number(a.driver.ratingAverage || 0));
    const selected = candidates.slice(0, 5);
    if (!selected.length) {
      request.dispatchAttempts = Number(request.dispatchAttempts || 0) + 1;
      request.lastDispatchAt = now(); request.dispatchAfter = new Date(Date.now() + 2 * 60 * 1000); request.status = 'dispatch_pending'; request.updatedAt = now();
      await repo.requests.save(request, { id: request.id }, opts(session));
      await rideService.event({ ride, from: ride.status, to: 'dispatch_pending', eventType: 'dispatch_no_driver', actorType: 'system', metadata: { attempt: request.dispatchAttempts }, session });
      return { ride, assignments: [], noDriver: true };
    }
    await repo.assignments.updateMany({ rideId: ride.id, status: 'offered' }, { $set: { status: 'expired', respondedAt: now(), updatedAt: now() } }, opts(session));
    const assignments = [];
    for (const candidate of selected) {
      const assignment = {
        id: await repo.nextId('ride-assignment'), companyId: PLATFORM_MOBILITY_OWNER, providerCompanyId: candidate.provider.id,
        rideId: ride.id, requestId: request.id, driverProfileId: candidate.driver.id, vehicleId: candidate.vehicle.id,
        offerExpiresAt: new Date(Date.now() + 45 * 1000), offeredAt: now(), status: 'offered',
        distanceToPickupKm: Math.round(candidate.km * 100) / 100, estimatedArrivalMinutes: candidate.eta,
        createdAt: now(), updatedAt: now(),
      };
      await repo.assignments.save(assignment, { rideId: ride.id, driverProfileId: candidate.driver.id }, opts(session));
      await repo.availability.updateOne({ id: candidate.availability.id, status: 'available', version: Number(candidate.availability.version || 0) }, { $set: { status: 'offered', updatedAt: now() }, $inc: { version: 1 } }, opts(session));
      assignments.push(assignment);
    }
    const from = ride.status;
    ride.status = 'offering'; ride.updatedAt = now();
    request.status = 'offering'; request.dispatchAttempts = Number(request.dispatchAttempts || 0) + 1; request.lastDispatchAt = now(); request.updatedAt = now();
    await repo.rides.save(ride, { id: ride.id }, opts(session));
    await repo.requests.save(request, { id: request.id }, opts(session));
    await rideService.event({ ride, from, to: 'offering', eventType: 'driver_offers_sent', actorType: 'system', metadata: { count: assignments.length }, session });
    return { ride, assignments };
  });
}

async function acceptAssignment(assignmentId, actor = {}) {
  return repo.withTransaction(async (session) => {
    const assignment = await repo.oneOrThrow(repo.assignments, { id: cleanText(assignmentId, 180), driverProfileId: actor.driverProfileId, status: 'offered' }, 'Ride offer was not found', opts(session));
    if (new Date(assignment.offerExpiresAt) <= now()) {
      assignment.status = 'expired'; assignment.respondedAt = now(); await repo.assignments.save(assignment, { id: assignment.id }, opts(session));
      throw conflictError('Ride offer expired');
    }
    const ride = await repo.oneOrThrow(repo.rides, { id: assignment.rideId, companyId: PLATFORM_MOBILITY_OWNER, status: 'offering' }, 'Ride was accepted by another driver', opts(session));
    const claimed = await repo.rides.updateOne({ id: ride.id, status: 'offering', driverProfileId: { $in: ['', null] } }, {
      $set: { status: 'assigned', providerCompanyId: assignment.providerCompanyId, driverProfileId: assignment.driverProfileId, vehicleId: assignment.vehicleId, acceptedAt: now(), updatedAt: now() },
    }, opts(session));
    if (!claimed || Number(claimed.modifiedCount || claimed.nModified || 0) !== 1) throw conflictError('Ride was accepted by another driver', 'ride_already_assigned');
    assignment.status = 'accepted'; assignment.respondedAt = now(); assignment.updatedAt = now();
    await repo.assignments.save(assignment, { id: assignment.id }, opts(session));
    await repo.assignments.updateMany({ rideId: ride.id, id: { $ne: assignment.id }, status: 'offered' }, { $set: { status: 'cancelled', respondedAt: now(), updatedAt: now() } }, opts(session));
    await repo.availability.updateMany({ driverProfileId: assignment.driverProfileId }, { $set: { status: 'assigned', vehicleId: assignment.vehicleId, updatedAt: now() }, $inc: { version: 1 } }, opts(session));
    await repo.vehicles.updateMany({ id: assignment.vehicleId, companyId: assignment.providerCompanyId }, { $set: { operationalStatus: 'assigned', updatedAt: now() } }, opts(session));
    await repo.requests.updateMany({ id: assignment.requestId }, { $set: { status: 'assigned', providerCompanyId: assignment.providerCompanyId, updatedAt: now() } }, opts(session));
    await repo.bookings.updateMany({ id: ride.bookingId }, { $set: { providerCompanyId: assignment.providerCompanyId, updatedAt: now() } }, opts(session));
    await repo.bookingItems.updateMany({ id: ride.bookingItemId }, { $set: { providerCompanyId: assignment.providerCompanyId, updatedAt: now() } }, opts(session));
    const updated = { ...ride, status: 'assigned', providerCompanyId: assignment.providerCompanyId, driverProfileId: assignment.driverProfileId, vehicleId: assignment.vehicleId, acceptedAt: now() };
    await rideService.event({ ride: updated, from: 'offering', to: 'assigned', eventType: 'driver_assigned', actorType: 'driver', actorIdValue: actorId(actor), metadata: { assignmentId: assignment.id }, session });
    return { ride: updated, assignment };
  });
}

async function declineAssignment(assignmentId, reason, actor = {}) {
  const assignment = await repo.oneOrThrow(repo.assignments, { id: cleanText(assignmentId, 180), driverProfileId: actor.driverProfileId, status: 'offered' }, 'Ride offer was not found');
  assignment.status = 'declined'; assignment.declineReason = cleanText(reason, 500); assignment.respondedAt = now(); assignment.updatedAt = now();
  await repo.assignments.save(assignment, { id: assignment.id });
  await repo.availability.updateMany({ driverProfileId: actor.driverProfileId, status: 'offered' }, { $set: { status: 'available', updatedAt: now() }, $inc: { version: 1 } });
  return assignment;
}

async function dispatchDueRides(limit = 100) {
  const due = await repo.rides.list({ companyId: PLATFORM_MOBILITY_OWNER, status: { $in: ['dispatch_pending', 'driver_no_show'] }, scheduledPickupAt: { $lte: new Date(Date.now() + 25 * 60 * 1000) } }, { sort: { scheduledPickupAt: 1 }, limit });
  const results = [];
  for (const ride of due) {
    try { results.push(await dispatchRide(ride.id, { actorId: 'scheduled-dispatch', actorType: 'system' })); }
    catch (error) { results.push({ rideId: ride.id, error: error.message }); }
  }
  const expired = await repo.assignments.list({ status: 'offered', offerExpiresAt: { $lte: now() } }, { limit: 500 });
  for (const assignment of expired) {
    assignment.status = 'expired'; assignment.respondedAt = now(); assignment.updatedAt = now(); await repo.assignments.save(assignment, { id: assignment.id });
    await repo.availability.updateMany({ driverProfileId: assignment.driverProfileId, status: 'offered' }, { $set: { status: 'available', updatedAt: now() }, $inc: { version: 1 } });
    const remaining = await repo.assignments.count({ rideId: assignment.rideId, status: 'offered' });
    if (!remaining) {
      const ride = await repo.rides.findOne({ id: assignment.rideId, status: 'offering' });
      if (ride) {
        ride.status = 'dispatch_pending'; ride.updatedAt = now(); await repo.rides.save(ride, { id: ride.id });
        await repo.requests.updateMany({ id: ride.requestId }, { $set: { status: 'dispatch_pending', dispatchAfter: new Date(Date.now() + 60 * 1000), updatedAt: now() } });
      }
    }
  }
  return results;
}

module.exports = { dispatchRide, acceptAssignment, declineAssignment, dispatchDueRides, eligibleCompany };
