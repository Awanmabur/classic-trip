'use strict';

const repo = require('../repositories/taxiRepository');
const rideService = require('./taxiRideService');
const paymentSettlementService = require('../../../services/booking/paymentSettlementService');
const calculateCommission = require('../../../utils/calculateCommission');
const { INDIVIDUAL_DRIVER_CATEGORIES, partnerCategory } = require('../domain/taxiGovernance');
const {
  cleanText,
  numberValue,
  validationError,
  conflictError,
  actorId,
} = require('../domain/taxiDomain');

function now() { return new Date(); }
function opts(session) { return session ? { session } : {}; }
function roundMoney(value) { return Math.round((Number(value) || 0) * 100) / 100; }

async function setAvailability(payload = {}, actor = {}) {
  const driver = await repo.oneOrThrow(
    repo.drivers,
    { id: actor.driverProfileId, companyId: actor.companyId, verificationStatus: 'verified' },
    'Verified taxi driver was not found',
  );
  const vehicle = await repo.oneOrThrow(
    repo.vehicles,
    { id: cleanText(payload.vehicleId || driver.assignedVehicleId, 180), companyId: driver.companyId, verificationStatus: 'verified' },
    'Verified taxi vehicle was not found',
  );
  const status = cleanText(payload.status || 'available', 40).toLowerCase();
  if (!['offline', 'available', 'break'].includes(status)) throw validationError('Driver availability status is invalid');
  if (['assigned', 'on_trip'].includes(driver.availabilityStatus) && status !== 'offline') throw conflictError('Driver cannot change availability during an active ride');

  let row = await repo.availability.findOne({ driverProfileId: driver.id, companyId: driver.companyId });
  if (!row) row = { id: await repo.nextId('driver-availability'), companyId: driver.companyId, driverProfileId: driver.id, version: 0, createdAt: now() };
  Object.assign(row, {
    vehicleId: vehicle.id,
    status,
    serviceZoneIds: Array.isArray(payload.serviceZoneIds) ? payload.serviceZoneIds : [],
    serviceTypes: Array.isArray(payload.serviceTypes) ? payload.serviceTypes : [],
    shiftStartedAt: status === 'available' ? (row.shiftStartedAt || now()) : row.shiftStartedAt,
    shiftEndsAt: status === 'offline' ? now() : null,
    lastHeartbeatAt: now(),
    version: Number(row.version || 0) + 1,
    updatedAt: now(),
  });
  driver.availabilityStatus = status;
  driver.assignedVehicleId = vehicle.id;
  driver.updatedAt = now();
  vehicle.operationalStatus = status === 'available' ? 'available' : 'offline';
  vehicle.updatedAt = now();
  await repo.availability.save(row, { driverProfileId: driver.id });
  await repo.drivers.save(driver, { id: driver.id });
  await repo.vehicles.save(vehicle, { id: vehicle.id });
  return row;
}

async function heartbeat(payload = {}, actor = {}) {
  const driver = await repo.oneOrThrow(
    repo.drivers,
    { id: actor.driverProfileId, companyId: actor.companyId, verificationStatus: 'verified' },
    'Verified taxi driver was not found',
  );
  const latitude = numberValue(payload.latitude, 'Latitude', -90, 90);
  const longitude = numberValue(payload.longitude, 'Longitude', -180, 180);
  const currentRide = await repo.rides.findOne({
    driverProfileId: driver.id,
    status: { $in: ['assigned', 'driver_arriving', 'driver_arrived', 'pickup_verified', 'in_progress', 'safety_hold'] },
  });
  const row = {
    id: await repo.nextId('driver-location'),
    companyId: driver.companyId,
    driverProfileId: driver.id,
    rideId: currentRide?.id || '',
    latitude,
    longitude,
    accuracyMeters: numberValue(payload.accuracyMeters, 'Accuracy', 0, 10000, 0),
    heading: numberValue(payload.heading, 'Heading', 0, 360, 0),
    speedKph: numberValue(payload.speedKph, 'Speed', 0, 300, 0),
    capturedAt: now(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    createdAt: now(),
    updatedAt: now(),
  };
  await repo.locations.save(row, { id: row.id });
  await repo.availability.updateMany({ driverProfileId: driver.id }, { $set: { lastHeartbeatAt: now(), updatedAt: now() } });
  return row;
}

async function driverTransition(rideId, action, payload = {}, actor = {}) {
  const ride = await repo.oneOrThrow(repo.rides, { id: cleanText(rideId, 180), driverProfileId: actor.driverProfileId }, 'Assigned local ride was not found');
  const transitions = {
    start_arrival: 'driver_arriving',
    arrived: 'driver_arrived',
    start_ride: 'in_progress',
    complete: 'completed',
    driver_no_show: 'driver_no_show',
    safety_hold: 'safety_hold',
    customer_no_show: 'customer_no_show',
  };
  const next = transitions[action];
  if (!next) throw validationError('Driver ride action is invalid');
  if (action === 'start_ride' && ride.status !== 'pickup_verified') throw conflictError('Verify the passenger pickup PIN before starting the ride');
  if (action === 'customer_no_show' && ride.status !== 'driver_arrived') throw conflictError('Customer no-show can only be recorded after arrival');

  let updated = await rideService.transitionRide(ride.id, next, { ...actor, actorType: 'driver' }, payload);
  if (next === 'in_progress') {
    await repo.availability.updateMany({ driverProfileId: actor.driverProfileId }, { $set: { status: 'on_trip', updatedAt: now() }, $inc: { version: 1 } });
    await repo.drivers.updateMany({ id: actor.driverProfileId }, { $set: { availabilityStatus: 'on_trip', updatedAt: now() } });
    await repo.vehicles.updateMany({ id: updated.vehicleId }, { $set: { operationalStatus: 'on_trip', updatedAt: now() } });
  }
  if (next === 'completed') updated = await completeRide(updated, payload, actor);
  if (['customer_no_show', 'driver_no_show'].includes(next)) {
    await repo.availability.updateMany({ driverProfileId: actor.driverProfileId }, { $set: { status: 'available', updatedAt: now() }, $inc: { version: 1 } });
    await repo.drivers.updateMany({ id: actor.driverProfileId }, { $set: { availabilityStatus: 'available', updatedAt: now() } });
    await repo.vehicles.updateMany({ id: updated.vehicleId }, { $set: { operationalStatus: 'available', updatedAt: now() } });
  }
  return updated;
}

async function completeRide(ride, payload = {}, actor = {}) {
  const completed = await repo.withTransaction(async (session) => {
    const current = await repo.oneOrThrow(
      repo.rides,
      { id: ride.id, companyId: ride.companyId, status: 'completed' },
      'Completed local ride was not found',
      opts(session),
    );
    const providerCompanyId = cleanText(current.providerCompanyId || actor.companyId, 180);
    const provider = await repo.oneOrThrow(
      repo.companies,
      { id: providerCompanyId, companyType: 'local_transport', verificationStatus: 'verified', status: 'active' },
      'Verified mobility partner was not found',
      opts(session),
    );

    // Customer fare is the platform quote accepted before payment. A rider cannot add
    // waiting, distance or any other charge from the driver app. Submitted distance and
    // waiting values are stored only as operational telemetry for support/fraud review.
    const estimate = current.pricing || {};
    const total = roundMoney(estimate.total || 0);
    const finalDistance = numberValue(payload.distanceKm, 'Final distance', 0, 10000, current.estimateSnapshot?.distanceKm || 0);
    const waitingMinutes = numberValue(payload.waitingMinutes, 'Waiting minutes', 0, 10000, 0);

    const booking = await repo.oneOrThrow(repo.bookings, { id: current.bookingId, companyId: current.companyId }, 'Ride booking was not found', opts(session));
    const bookingSplit = calculateCommission(total, Boolean(booking.promoterAttribution), {
      commissionPercent: booking.commercialTermsSnapshot?.commissionPercent,
    });
    const pricing = { ...estimate, total, split: bookingSplit, estimated: false, fareLocked: true, controlledBy: 'platform' };
    current.finalFareSnapshot = {
      ...pricing,
      finalDistanceKm: finalDistance,
      waitingMinutes,
      customerAdjustments: 0,
      adjustmentAuthority: 'super_admin_only',
    };
    current.pricing = pricing;
    current.settlementStatus = 'eligible';
    current.completedAt = current.completedAt || now();
    current.updatedAt = now();
    await repo.rides.save(current, { id: current.id }, opts(session));

    booking.providerCompanyId = provider.id;
    booking.pricing = { ...(booking.pricing || {}), ...pricing };
    booking.grossAmount = total;
    booking.bookingStatus = 'completed';
    booking.completedAt = now();
    booking.settlementStatus = 'eligible';
    booking.ticketLegs = (booking.ticketLegs || []).map((leg) => leg.type === 'local_transport'
      ? { ...leg, status: 'completed', completedAt: now(), finalFare: current.finalFareSnapshot }
      : leg);
    booking.updatedAt = now();
    await repo.bookings.save(booking, { id: booking.id }, opts(session));
    await repo.bookingItems.updateMany(
      { bookingId: booking.id },
      { $set: { status: 'completed', providerCompanyId: provider.id, pricing: booking.pricing, updatedAt: now() } },
      opts(session),
    );

    const category = partnerCategory(provider);
    const individual = INDIVIDUAL_DRIVER_CATEGORIES.includes(category);
    const configuredPercent = individual ? 100 : Math.max(0, Math.min(100, Number(provider.settings?.driverPayoutPercent ?? 80)));
    const companyShare = roundMoney(bookingSplit.companyAmount || 0);
    const driverShare = roundMoney(companyShare * (configuredPercent / 100));
    const existingEarning = await repo.earnings.findOne({ rideId: current.id }, opts(session));
    const earning = {
      ...(existingEarning || {}),
      id: existingEarning?.id || await repo.nextId('driver-earning'),
      companyId: provider.id,
      driverProfileId: current.driverProfileId,
      rideId: current.id,
      bookingRef: current.bookingRef,
      currency: booking.pricing.currency,
      grossFare: total,
      platformCommission: Number(bookingSplit.totalCommission || 0),
      companyShare,
      driverShare,
      driverPayoutPercent: configuredPercent,
      adjustments: [],
      status: 'eligible',
      eligibleAt: existingEarning?.eligibleAt || now(),
      createdAt: existingEarning?.createdAt || now(),
      updatedAt: now(),
    };
    await repo.earnings.save(earning, { rideId: current.id }, opts(session));

    await repo.availability.updateMany({ driverProfileId: current.driverProfileId }, { $set: { status: 'available', updatedAt: now() }, $inc: { version: 1 } }, opts(session));
    await repo.drivers.updateMany({ id: current.driverProfileId }, { $set: { availabilityStatus: 'available', updatedAt: now() }, $inc: { completedRideCount: 1 } }, opts(session));
    await repo.vehicles.updateMany({ id: current.vehicleId }, { $set: { operationalStatus: 'available', updatedAt: now() } }, opts(session));
    await repo.assignments.updateMany({ rideId: current.id, status: 'accepted' }, { $set: { status: 'completed', updatedAt: now() } }, opts(session));
    await repo.audit({
      actorId: actorId(actor),
      action: 'mobility.ride.completed',
      targetType: 'taxi_ride',
      targetId: current.id,
      companyId: provider.id,
      metadata: { fareLocked: true, total, driverPayoutPercent: configuredPercent, driverShare },
      session,
    });
    return { current, booking };
  });

  await paymentSettlementService.settleBookingPayment(completed.booking, { source: 'taxi_ride_completed' });
  return completed.current;
}

async function reportIncident(payload = {}, actor = {}) {
  const ride = payload.rideId
    ? await repo.oneOrThrow(repo.rides, { id: cleanText(payload.rideId, 180), providerCompanyId: actor.companyId }, 'Local ride was not found')
    : null;
  const category = cleanText(payload.category, 40).toLowerCase();
  if (!['safety', 'collision', 'harassment', 'lost_item', 'vehicle', 'route', 'payment', 'other'].includes(category)) throw validationError('Incident category is invalid');
  const severity = cleanText(payload.severity || 'medium', 20).toLowerCase();
  if (!['low', 'medium', 'high', 'critical'].includes(severity)) throw validationError('Incident severity is invalid');
  const description = cleanText(payload.description, 5000);
  if (!description) throw validationError('Incident description is required');
  const row = {
    id: await repo.nextId('taxi-incident'),
    companyId: actor.companyId,
    rideId: ride?.id || '',
    driverProfileId: ride?.driverProfileId || actor.driverProfileId || '',
    vehicleId: ride?.vehicleId || '',
    reportedBy: actorId(actor),
    category,
    severity,
    description,
    evidence: [],
    status: 'open',
    createdAt: now(),
    updatedAt: now(),
  };
  await repo.incidents.save(row, { id: row.id });
  if (severity === 'critical' && ride && !['completed', 'cancelled', 'refunded'].includes(ride.status)) {
    await rideService.transitionRide(ride.id, 'safety_hold', { ...actor, actorType: actor.actorType || 'driver' }, { incidentId: row.id });
  }
  return row;
}

module.exports = { setAvailability, heartbeat, driverTransition, completeRide, reportIncident };
