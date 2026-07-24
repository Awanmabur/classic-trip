'use strict';

const toSlug = require('../../../utils/slugify');
const repository = require('../repositories/busRepository');
const { evaluateDriverAssignment } = require('../../../services/company/driverEligibilityService');
const {
  cleanText,
  normalize,
  boolValue,
  numberValue,
  moneyValue,
  parseList,
  validationError,
  conflictError,
  requireText,
  buildSeatDefinitions,
  seatMapChecksum,
  buildRouteSegments,
  sortStops,
  immutableSnapshot,
  columnsForLayout,
  parseDurationMinutes,
  canonicalBusListingStatus,
  applyBusListingPrivateStatus,
  applyBusListingPublishedStatus,
} = require('../domain/busDomain');

function actorId(value) { return cleanText(value || 'company-admin', 180); }
function nowIso() { return new Date().toISOString(); }

function timezoneForCountry(country = '') {
  const normalized = normalize(country);
  const map = {
    uganda: 'Africa/Kampala',
    kenya: 'Africa/Nairobi',
    rwanda: 'Africa/Kigali',
    tanzania: 'Africa/Dar_es_Salaam',
    south_sudan: 'Africa/Juba',
    burundi: 'Africa/Bujumbura',
    somalia: 'Africa/Mogadishu',
  };
  return map[normalized] || 'Africa/Kampala';
}

async function uniqueSlug(base, existingId = '') {
  const root = toSlug(base) || `bus-service-${Date.now()}`;
  let slug = root;
  let suffix = 1;
  while (await repository.listings.findOne({ slug, ...(existingId ? { id: { $ne: existingId } } : {}) })) {
    suffix += 1;
    slug = `${root}-${suffix}`;
  }
  return slug;
}

function mediaFromPayload(payload = {}, fallback = []) {
  if (Array.isArray(payload.media) && payload.media.length) return payload.media;
  const asset = payload.mediaAsset || payload.uploadedMedia || payload.asset;
  if (asset && (asset.secureUrl || asset.url)) {
    const url = cleanText(asset.secureUrl || asset.url, 2000);
    return [...fallback, {
      url,
      secureUrl: url,
      publicId: cleanText(asset.publicId || asset.public_id || url, 500),
      resourceType: cleanText(asset.resourceType || asset.resource_type || 'image', 40),
      width: Number(asset.width || 0) || undefined,
      height: Number(asset.height || 0) || undefined,
      format: cleanText(asset.format, 30),
      alt: cleanText(asset.alt || payload.title || 'Bus service', 240),
      label: cleanText(asset.label || payload.title || 'Bus service', 240),
    }];
  }
  const imageUrl = cleanText(payload.imageUrl || payload.image || payload.mediaUrl, 2000);
  if (!imageUrl) return fallback;
  return [...fallback, { url: imageUrl, secureUrl: imageUrl, publicId: imageUrl, resourceType: 'image', alt: cleanText(payload.imageAlt || payload.title || 'Bus service', 240), label: cleanText(payload.imageLabel || payload.title || 'Bus service', 240) }];
}

async function activeBranch(companyId, id, label) {
  const key = cleanText(id, 180);
  if (!key) return null;
  const branch = await repository.branches.findOne({ id: key, companyId, status: { $ne: 'archived' } });
  if (!branch) throw validationError(`${label} must be selected from this company's active branches and terminals`);
  return branch;
}

function branchLabel(branch = {}) {
  return cleanText(branch.name || branch.city || branch.address || branch.id, 180);
}

async function createBusListing(companyId, payload = {}, actor = 'company-admin') {
  const company = await repository.companyOrThrow(companyId);
  const title = requireText(payload.title || payload.name, 'Bus service name', 180);
  const branch = await activeBranch(company.id, payload.branchId, 'Operating branch');
  if (!branch) throw validationError('Select an active operating branch or terminal for this bus service');
  if (!cleanText(branch.country || company.country, 120)) throw validationError('The selected branch or company must have a country before creating a bus service');
  const timestamp = nowIso();
  const listing = {
    id: await repository.nextId('listing'),
    companyId: company.id,
    companySlug: company.slug,
    companyName: company.name,
    branchId: branch?.id || '',
    branchName: branchLabel(branch),
    serviceType: 'bus',
    listingKind: 'operator_service',
    group: 'bus',
    type: 'Bus',
    title,
    slug: await uniqueSlug(payload.slug || title),
    sub: cleanText(payload.sub || payload.shortDescription || payload.description, 280),
    shortDescription: cleanText(payload.shortDescription || payload.sub || payload.description, 500),
    country: cleanText(branch.country || company.country, 120),
    city: cleanText(branch.city || company.city, 160),
    address: cleanText(branch.address || company.headOfficeAddress, 400),
    currency: cleanText(company.operatingCurrency, 10).toUpperCase(),
    media: mediaFromPayload(payload),
    amenities: parseList(payload.amenities),
    serviceNotes: cleanText(payload.serviceNotes || payload.publicInstructions, 1600),
    contactPhone: cleanText(payload.contactPhone || company.supportContacts?.phone, 80),
    operatorLicenceRef: cleanText(payload.operatorLicenceRef || payload.operatorPermitRef, 160),
    salesChannels: parseList(payload.salesChannels || ['web', 'mobile', 'agent']),
    baggageRules: cleanText(payload.baggageRules, 1600),
    cancellationRules: cleanText(payload.cancellationRules, 1600),
    bookable: false,
    isVerified: company.verificationStatus === 'verified',
    publication: {
      readiness: 'incomplete',
      bookingReadiness: 'incomplete',
      public: false,
      state: 'draft',
      lastCheckedAt: timestamp,
      failures: ['Complete the public bus service profile'],
      bookingFailures: ['Add route, vehicle, seat map, fare and future dated departure'],
    },
    status: 'draft',
    releaseStatus: 'draft',
    createdBy: actorId(actor),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await repository.withTransaction(async (session) => {
    await repository.listings.save(listing, { id: listing.id }, { session });
    await repository.audit({ actorId: actorId(actor), action: 'bus.listing.created', targetType: 'listing', targetId: listing.id, companyId: company.id, metadata: { serviceType: 'bus' }, session });
  });
  return listing;
}

async function updateBusListing(companyId, listingId, payload = {}, actor = 'company-admin') {
  const listing = immutableSnapshot(await repository.listingOrThrow(companyId, listingId));
  const branch = Object.prototype.hasOwnProperty.call(payload, 'branchId')
    ? await activeBranch(companyId, payload.branchId, 'Operating branch')
    : null;
  if (payload.title || payload.name) listing.title = requireText(payload.title || payload.name, 'Bus service name', 180);
  if (payload.slug || payload.title || payload.name) listing.slug = await uniqueSlug(payload.slug || listing.title, listing.id);
  if (Object.prototype.hasOwnProperty.call(payload, 'branchId')) {
    if (!branch) throw validationError('Select an active operating branch or terminal for this bus service');
    listing.branchId = branch.id;
    listing.branchName = branchLabel(branch);
    listing.country = cleanText(branch.country, 120);
    listing.city = cleanText(branch.city, 160);
    listing.address = cleanText(branch.address, 400);
  }
  const directFields = {
    shortDescription: 500,
    sub: 280,
    serviceNotes: 1600,
    contactPhone: 80,
    operatorLicenceRef: 160,
    baggageRules: 1600,
    cancellationRules: 1600,
  };
  for (const [field, max] of Object.entries(directFields)) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) listing[field] = cleanText(payload[field], max);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'description') && !Object.prototype.hasOwnProperty.call(payload, 'shortDescription')) {
    listing.shortDescription = cleanText(payload.description, 500);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'amenities')) listing.amenities = parseList(payload.amenities);
  if (Object.prototype.hasOwnProperty.call(payload, 'salesChannels')) listing.salesChannels = parseList(payload.salesChannels);
  listing.media = mediaFromPayload(payload, Array.isArray(listing.media) ? listing.media : []);

  const requestedStatus = Object.prototype.hasOwnProperty.call(payload, 'status')
    ? canonicalBusListingStatus(payload.status)
    : '';

  if (requestedStatus === 'active') {
    let readiness = await listingReadiness(companyId, listing.id, listing);
    const nonDepartureFailures = readiness.failures.filter((failure) => failure !== 'Publish at least one dated departure');
    if (!readiness.ok
      && nonDepartureFailures.length === 0
      && readiness.failures.includes('Publish at least one dated departure')
      && readiness.departureDiagnostics.length > 0) {
      await smartPreparePublishedDeparture(companyId, listing.id, actor);
      readiness = await listingReadiness(companyId, listing.id, listing);
    }
    listing.publication = {
      readiness: readiness.publicReady ? (readiness.bookingReady ? 'bookable' : 'public') : 'incomplete',
      bookingReadiness: readiness.bookingReady ? 'ready' : 'incomplete',
      public: false,
      state: 'draft',
      lastCheckedAt: readiness.checkedAt,
      failures: readiness.failures,
      bookingFailures: readiness.bookingFailures,
      counts: readiness.counts,
    };
    if (!readiness.ok) {
      throw Object.assign(
        validationError(`Bus service cannot be activated: ${readiness.allFailures.join('; ')}`),
        { validation: readiness },
      );
    }
    const wasPublic = listing.status === 'active'
      && ['published', 'live'].includes(normalize(listing.releaseStatus));
    applyBusListingPublishedStatus(listing, readiness, { actor: actorId(actor), at: nowIso() });
    await repository.withTransaction(async (session) => {
      await repository.listings.save(listing, { id: listing.id }, { session });
      if (!wasPublic) {
        await repository.outbox({
          eventType: 'BusListingPublished',
          aggregateType: 'listing',
          aggregateId: listing.id,
          companyId,
          payload: { listingId: listing.id },
          dedupeKey: `BusListingPublished:${listing.id}:${listing.updatedAt}`,
          session,
        });
      }
      await repository.audit({
        actorId: actorId(actor),
        action: wasPublic ? 'bus.listing.updated' : 'bus.listing.published',
        targetType: 'listing',
        targetId: listing.id,
        companyId,
        metadata: { requestedStatus, readiness },
        session,
      });
    });
    return listing;
  }

  if (requestedStatus) applyBusListingPrivateStatus(listing, requestedStatus, { actor: actorId(actor), at: nowIso() });
  else {
    listing.updatedBy = actorId(actor);
    listing.updatedAt = nowIso();
  }

  await repository.withTransaction(async (session) => {
    await repository.listings.save(listing, { id: listing.id }, { session });
    await repository.audit({
      actorId: actorId(actor),
      action: requestedStatus === 'archived' ? 'bus.listing.archived' : 'bus.listing.updated',
      targetType: 'listing',
      targetId: listing.id,
      companyId,
      metadata: { requestedStatus: requestedStatus || listing.status },
      session,
    });
  });
  return listing;
}

async function listingReadiness(companyId, listingId, listingCandidate = null) {
  const company = await repository.companyOrThrow(companyId);
  const listing = listingCandidate || await repository.listingOrThrow(company.id, listingId);
  const listingKey = cleanText(listing.id || listingId, 180);
  const now = Date.now();
  const nowDate = new Date(now);

  const [routes, vehicles, fares, futureCompanyDepartures] = await Promise.all([
    repository.routes.list({ companyId, listingId: listingKey, status: 'active' }, { limit: 1000 }),
    repository.vehicles.list({ companyId, listingId: listingKey, serviceType: 'bus', status: 'active' }, { limit: 1000 }),
    repository.fareProducts.list({ companyId, listingId: listingKey, status: 'active' }, { limit: 1000 }),
    repository.schedules.list({
      companyId,
      departAt: { $gt: nowDate },
      status: { $in: ['draft', 'active', 'published'] },
    }, { sort: { departAt: 1 }, limit: 3000 }),
  ]);

  const routeById = new Map(routes.map((row) => [String(row.id), row]));
  const vehicleById = new Map(vehicles.map((row) => [String(row.id), row]));
  const fareById = new Map(fares.map((row) => [String(row.id), row]));
  const referencedSeatMapIds = [...new Set(vehicles.map((row) => row.activeSeatMapVersionId).filter(Boolean).map(String))];
  const publishedSeatMaps = referencedSeatMapIds.length
    ? await repository.seatMapVersions.list({
      companyId,
      listingId: listingKey,
      id: { $in: referencedSeatMapIds },
      status: 'published',
    }, { limit: 1000 })
    : [];
  const seatMapById = new Map(publishedSeatMaps.map((row) => [String(row.id), row]));

  const compliantVehicles = vehicles.filter((vehicle) => {
    const dates = [vehicle.operatorPermitExpiresAt, vehicle.inspectionExpiresAt, vehicle.insuranceExpiresAt]
      .map((value) => new Date(value).getTime());
    return Boolean(vehicle.operatorPermitRef && vehicle.inspectionRef && vehicle.insuranceRef)
      && dates.every((value) => Number.isFinite(value) && value > now)
      && Boolean(vehicle.activeSeatMapVersionId && seatMapById.has(String(vehicle.activeSeatMapVersionId)));
  });
  const compliantVehicleIds = new Set(compliantVehicles.map((row) => String(row.id)));

  const listingDepartures = futureCompanyDepartures.filter((schedule) => String(schedule.listingId || '') === listingKey);
  const publishedCandidates = listingDepartures.filter((schedule) => normalize(schedule.status) === 'published');
  const departureDiagnostics = [];
  const validPublishedDepartures = [];

  for (const schedule of listingDepartures) {
    const reasons = [];
    if (normalize(schedule.status) !== 'published') reasons.push(`departure status is ${normalize(schedule.status || 'draft')}; publish this dated departure`);
    const route = routeById.get(String(schedule.routeId || ''));
    const vehicle = vehicleById.get(String(schedule.vehicleId || ''));
    const fare = fareById.get(String(schedule.fareProductId || ''));
    const seatMap = seatMapById.get(String(schedule.seatMapVersionId || ''));
    if (!route) reasons.push('active route link is missing');
    if (!vehicle) reasons.push('active vehicle link is missing');
    else if (!compliantVehicleIds.has(String(vehicle.id))) reasons.push('vehicle compliance or published seat map is incomplete');
    if (!fare || String(fare.routeId || '') !== String(schedule.routeId || '')) reasons.push('active fare link is missing');
    if (!seatMap || String(seatMap.vehicleId || '') !== String(schedule.vehicleId || '')) reasons.push('published seat-map version link is missing');
    if (!schedule.driverEmployeeId) {
      reasons.push('driver assignment is missing');
    } else {
      const assignedEmployee = await repository.employees.findOne({ id: schedule.driverEmployeeId, companyId });
      const assignedUser = assignedEmployee?.userId ? await repository.users.findOne({ id: assignedEmployee.userId }) : null;
      const assignedDriver = evaluateDriverAssignment(assignedEmployee || {}, assignedUser || {});
      if (!assignedDriver.assignable) reasons.push(`driver assignment is invalid (${assignedDriver.reasons.join(', ')})`);
    }
    if (!Number(schedule.totalSeats || 0) || !schedule.inventoryReadyAt) reasons.push('seat inventory snapshot is missing');

    const relationshipFailures = reasons.filter((reason) => !reason.startsWith('departure status is'));
    const inventoryRows = relationshipFailures.length
      ? 0
      : await repository.segmentInventory.count({
        companyId,
        listingId: listingKey,
        scheduleId: schedule.id,
      });
    if (!inventoryRows) reasons.push('live seat-segment inventory is missing');

    if (reasons.length) departureDiagnostics.push({ scheduleId: schedule.id, departAt: schedule.departAt, status: schedule.status, reasons });
    else validPublishedDepartures.push(schedule);
  }

  const failures = [];
  if (company.verificationStatus !== 'verified' || company.status !== 'active') failures.push('Company must be active and verified');
  if (!listing.branchId) failures.push('Select an active operating branch or terminal');
  if (!listing.country || !listing.city || !listing.address) failures.push('Complete the selected branch country, city and address');
  if (!listing.media?.length) failures.push('Upload at least one bus service image');
  if (!listing.contactPhone) failures.push('Add the public operations contact phone');
  if (!listing.operatorLicenceRef) failures.push('Add the bus operator licence reference');
  if (!listing.baggageRules) failures.push('Add the baggage policy');
  if (!listing.cancellationRules) failures.push('Add the cancellation policy');
  if (!routes.length) failures.push('Create an active route');
  if (!vehicles.length) failures.push('Create an active vehicle');
  if (vehicles.length && !publishedSeatMaps.length) failures.push('Publish a seat-map version for the active vehicle');
  if (vehicles.length && !compliantVehicles.length) failures.push('Complete valid permit, inspection, insurance and seat-map setup for an active vehicle');
  if (!fares.length) failures.push('Create an active fare product');
  if (!validPublishedDepartures.length) failures.push('Publish at least one dated departure');

  const diagnosticFailures = !validPublishedDepartures.length
    ? departureDiagnostics.slice(0, 5).map((item) => `Departure ${item.scheduleId}: ${item.reasons.join(', ')}`)
    : [];
  const allFailures = [...failures, ...diagnosticFailures];
  const ready = failures.length === 0;
  return {
    ok: ready,
    publicReady: ready,
    bookingReady: ready,
    failures,
    bookingFailures: failures,
    allFailures,
    counts: {
      routes: routes.length,
      vehicles: vehicles.length,
      compliantVehicles: compliantVehicles.length,
      publishedSeatMaps: publishedSeatMaps.length,
      fares: fares.length,
      linkedFutureDepartures: listingDepartures.length,
      publishedFutureDepartures: publishedCandidates.length,
      validPublishedDepartures: validPublishedDepartures.length,
      invalidPublishedDepartures: departureDiagnostics.length,
    },
    departureDiagnostics,
    checkedAt: nowIso(),
  };
}


async function assignableDrivers(companyId) {
  const employees = await repository.employees.list({ companyId, status: 'active' }, { limit: 1000 });
  const candidates = [];
  for (const employee of employees) {
    const user = employee.userId ? await repository.users.findOne({ id: employee.userId, companyId }) : null;
    const assignment = evaluateDriverAssignment(employee, user || {});
    if (!assignment.assignable) continue;
    candidates.push({ employee, user, assignment, eligibility: assignment });
  }
  return candidates;
}


function chooseDriverForSchedule(drivers = [], schedule = {}) {
  const scored = drivers.filter((driver) => driver?.employee?.id).map((driver) => {
    const employee = driver.employee || {};
    let score = 0;
    if (String(employee.pendingScheduleId || '') === String(schedule.id || '')) score += 100;
    if (Array.isArray(employee.scheduleIds) && employee.scheduleIds.map(String).includes(String(schedule.id || ''))) score += 90;
    if (String(employee.assignedFleetId || employee.pendingVehicleId || '') === String(schedule.vehicleId || '')) score += 50;
    if (String(employee.status || '').toLowerCase() === 'active') score += 20;
    if (String(employee.safetyStatus || '').toLowerCase() === 'cleared') score += 10;
    return { driver, score, order: String(employee.createdAt || employee.updatedAt || employee.id || '') };
  });
  scored.sort((a, b) => b.score - a.score || a.order.localeCompare(b.order) || String(a.driver.employee.id).localeCompare(String(b.driver.employee.id)));
  return scored[0]?.driver || null;
}

async function attachDriverToSchedule(companyId, schedule, driver, actor = 'company-admin') {
  if (!driver?.employee?.id) throw validationError('Approve at least one active, verified and safety-cleared company driver before publishing the departure.');
  const timestamp = nowIso();
  schedule.driverEmployeeId = driver.employee.id;
  schedule.driverUserId = driver.user?.id || driver.employee.userId || '';
  schedule.driverIds = [schedule.driverEmployeeId, schedule.driverUserId].filter(Boolean);
  schedule.driverName = cleanText(driver.eligibility?.label || driver.user?.fullName || driver.employee.roleTitle || driver.employee.id, 180);
  schedule.assignmentStatus = 'assigned';
  schedule.updatedBy = actorId(actor);
  schedule.updatedAt = timestamp;

  await repository.withTransaction(async (session) => {
    await repository.schedules.save(schedule, { id: schedule.id }, { session });
    const existing = await repository.driverAssignments.findOne({
      companyId,
      scheduleId: schedule.id,
      assignmentRole: 'driver',
      status: 'active',
    }, { session });
    if (!existing) {
      const assignment = {
        id: await repository.nextId('driver-assignment'),
        companyId,
        employeeId: driver.employee.id,
        driverUserId: schedule.driverUserId,
        vehicleId: schedule.vehicleId,
        scheduleId: schedule.id,
        routeId: schedule.routeId,
        listingId: schedule.listingId,
        assignmentType: 'schedule',
        assignmentRole: 'driver',
        startsAt: schedule.boardingStartAt || schedule.departAt,
        endsAt: schedule.arriveAt || null,
        safetyStatus: driver.employee.safetyStatus || 'not_submitted',
        status: 'active',
        assignedBy: actorId(actor),
        createdAt: timestamp,
      };
      await repository.driverAssignments.save(assignment, { id: assignment.id }, { session });
    }
    await repository.audit({
      actorId: actorId(actor),
      action: 'bus.departure.driver_auto_assigned',
      targetType: 'trip_schedule',
      targetId: schedule.id,
      companyId,
      metadata: { employeeId: driver.employee.id, listingId: schedule.listingId },
      session,
    });
  });
  return schedule;
}

async function smartPreparePublishedDeparture(companyId, listingId, actor = 'company-admin') {
  const listing = await repository.listingOrThrow(companyId, listingId);
  const now = new Date();
  const schedules = await repository.schedules.list({
    companyId,
    listingId: listing.id,
    departAt: { $gt: now },
    status: { $in: ['draft', 'active', 'published'] },
  }, { sort: { departAt: 1 }, limit: 1000 });

  if (!schedules.length) {
    throw validationError('Bus service cannot be published: Create at least one future dated departure for this listing');
  }

  const alreadyPublished = schedules.find((schedule) => normalize(schedule.status) === 'published');
  if (alreadyPublished) return alreadyPublished;

  const schedule = schedules[0];
  if (!schedule.driverEmployeeId) {
    const drivers = await assignableDrivers(companyId);
    if (!drivers.length) {
      throw validationError('Bus service cannot be published: Approve at least one active, verified and safety-cleared driver');
    }
    const selectedDriver = chooseDriverForSchedule(drivers, schedule);
    if (!selectedDriver) throw validationError('Bus service cannot be published: Approve at least one active, verified and safety-cleared company driver');
    await attachDriverToSchedule(companyId, schedule, selectedDriver, actor);
  }

  const departureService = require('./busDepartureService');
  const inventoryRows = await repository.segmentInventory.count({ companyId, scheduleId: schedule.id });
  if (!inventoryRows || !schedule.inventoryReadyAt) {
    const routeSegments = await repository.routeSegments.list({
      companyId,
      routeId: schedule.routeId,
      status: 'active',
    }, { sort: { segmentOrder: 1 }, limit: 1000 });
    const seatMapVersion = await repository.seatMapVersionOrThrow(companyId, schedule.seatMapVersionId);
    if (!routeSegments.length) throw validationError('Bus service cannot be published: Complete the active route segments first');
    if (normalize(seatMapVersion.status) !== 'published') throw validationError('Bus service cannot be published: Publish the selected vehicle seat map first');
    await departureService.generateInventory({
      schedule,
      routeSegments,
      seatMapVersion,
      blockedSeats: schedule.blockedSeats || [],
      actor,
    });
  }

  return departureService.publishSchedule(companyId, schedule.id, actor);
}

async function smartPublishBusListing(companyId, listingId, actor = 'company-admin') {
  let readiness = await listingReadiness(companyId, listingId);
  if (!readiness.ok) {
    const nonDepartureFailures = readiness.failures.filter((failure) => failure !== 'Publish at least one dated departure');
    const canPrepare = nonDepartureFailures.length === 0
      && readiness.failures.includes('Publish at least one dated departure')
      && readiness.departureDiagnostics.length > 0;
    if (canPrepare) {
      await smartPreparePublishedDeparture(companyId, listingId, actor);
      readiness = await listingReadiness(companyId, listingId);
    }
  }
  if (!readiness.ok) {
    throw Object.assign(
      validationError(`Bus service cannot be published: ${readiness.allFailures.join('; ')}`),
      { validation: readiness },
    );
  }
  return publishBusListing(companyId, listingId, actor);
}

async function publishBusListing(companyId, listingId, actor = 'company-admin') {
  const listing = immutableSnapshot(await repository.listingOrThrow(companyId, listingId));
  const readiness = await listingReadiness(companyId, listing.id);
  listing.publication = {
    readiness: readiness.publicReady ? (readiness.bookingReady ? 'bookable' : 'public') : 'incomplete',
    bookingReadiness: readiness.bookingReady ? 'ready' : 'incomplete',
    lastCheckedAt: readiness.checkedAt,
    failures: readiness.failures,
    bookingFailures: readiness.bookingFailures,
    counts: readiness.counts,
  };
  if (!readiness.ok) throw Object.assign(validationError(`Bus service cannot be published: ${readiness.allFailures.join('; ')}`), { validation: readiness });
  const wasPublic = listing.status === 'active'
    && ['published', 'live'].includes(normalize(listing.releaseStatus));
  applyBusListingPublishedStatus(listing, readiness, { actor: actorId(actor), at: nowIso() });
  await repository.withTransaction(async (session) => {
    await repository.listings.save(listing, { id: listing.id }, { session });
    if (!wasPublic) await repository.outbox({ eventType: 'BusListingPublished', aggregateType: 'listing', aggregateId: listing.id, companyId, payload: { listingId: listing.id }, dedupeKey: `BusListingPublished:${listing.id}:${listing.updatedAt}`, session });
    await repository.audit({ actorId: actorId(actor), action: 'bus.listing.published', targetType: 'listing', targetId: listing.id, companyId, metadata: readiness, session });
  });
  return listing;
}

async function archiveBusListing(companyId, listingId, actor = 'company-admin') {
  const listing = immutableSnapshot(await repository.listingOrThrow(companyId, listingId));
  applyBusListingPrivateStatus(listing, 'archived', { actor: actorId(actor), at: nowIso() });
  await repository.listings.save(listing, { id: listing.id });
  await repository.audit({ actorId: actorId(actor), action: 'bus.listing.archived', targetType: 'listing', targetId: listing.id, companyId, metadata: {} });
  return listing;
}

async function resolveEndpoint(companyId, payload, prefix) {
  const branchId = payload[`${prefix}BranchId`] || payload[`${prefix}TerminalId`] || payload[`${prefix}StopBranchId`];
  const branch = await activeBranch(companyId, branchId, `${prefix === 'origin' ? 'Origin' : 'Destination'} terminal`);
  const fallback = cleanText(payload[prefix] || payload[prefix === 'origin' ? 'from' : 'to'], 180);
  if (!branch && !fallback) throw validationError(`${prefix === 'origin' ? 'Origin' : 'Destination'} terminal is required`);
  return { branchId: branch?.id || '', name: branchLabel(branch) || fallback, branch };
}

function stopFromEndpoint({ id, companyId, listingId, routeId, endpoint, type, order, actor }) {
  return {
    id,
    routeId,
    listingId,
    companyId,
    branchId: endpoint.branchId,
    name: endpoint.name,
    stopType: type,
    stopOrder: order,
    timeOffsetMinutes: 0,
    pickupAllowed: type === 'origin',
    dropoffAllowed: type === 'destination',
    publicInstructions: '',
    status: 'active',
    createdBy: actorId(actor),
    createdAt: nowIso(),
  };
}

async function selectedIntermediateStops({ companyId, listingId, routeId, payload = {}, originBranchId = '', destinationBranchId = '', actor = 'company-admin' }) {
  const permissions = new Map();
  const add = (branchId, kind) => {
    const id = cleanText(branchId, 180);
    if (!id || id === originBranchId || id === destinationBranchId) return;
    const current = permissions.get(id) || { pickupAllowed: false, dropoffAllowed: false };
    if (kind === 'boarding') current.pickupAllowed = true;
    if (kind === 'dropoff') current.dropoffAllowed = true;
    permissions.set(id, current);
  };
  parseList(payload.boardingBranchIds).forEach((id) => add(id, 'boarding'));
  parseList(payload.dropoffBranchIds).forEach((id) => add(id, 'dropoff'));

  const rows = [];
  for (const [branchId, permission] of permissions.entries()) {
    const branch = await activeBranch(companyId, branchId, 'Route stop');
    rows.push({
      id: await repository.nextId('route-stop'),
      routeId,
      listingId,
      companyId,
      branchId: branch.id,
      name: branchLabel(branch),
      stopType: permission.pickupAllowed && permission.dropoffAllowed
        ? 'intermediate'
        : permission.pickupAllowed ? 'boarding' : 'dropoff',
      stopOrder: rows.length + 2,
      timeOffsetMinutes: 0,
      pickupAllowed: permission.pickupAllowed,
      dropoffAllowed: permission.dropoffAllowed,
      publicInstructions: '',
      status: 'active',
      createdBy: actorId(actor),
      createdAt: nowIso(),
    });
  }
  return rows;
}

async function rebuildRouteSegments(companyId, routeId, actor = 'system', session = null) {
  const route = await repository.routeOrThrow(companyId, routeId, session ? { session } : {});
  const stops = sortStops(await repository.routeStops.list({ companyId, routeId, status: { $ne: 'archived' } }, { sort: { stopOrder: 1 }, ...(session ? { session } : {}) }));
  const definitions = buildRouteSegments(stops);
  const rows = [];
  for (const definition of definitions) {
    rows.push({
      id: await repository.nextId('route-segment'),
      companyId,
      listingId: route.listingId,
      routeId,
      ...definition,
      status: 'active',
      createdAt: nowIso(),
    });
  }
  await repository.routeSegments.deleteMany({ companyId, routeId }, session ? { session } : {});
  if (rows.length) await repository.routeSegments.saveMany(rows, null, session ? { session } : {});
  const origin = stops[0];
  const destination = stops[stops.length - 1];
  Object.assign(route, {
    origin: origin.name,
    destination: destination.name,
    originTerminalId: origin.branchId || '',
    destinationTerminalId: destination.branchId || '',
    originStopId: origin.id,
    destinationStopId: destination.id,
    stopCount: stops.length,
    segmentCount: rows.length,
    boardingBranchIds: [...new Set(stops.filter((stop) => stop.pickupAllowed && stop.branchId).map((stop) => stop.branchId))],
    dropoffBranchIds: [...new Set(stops.filter((stop) => stop.dropoffAllowed && stop.branchId).map((stop) => stop.branchId))],
    boardingPoints: stops.filter((stop) => stop.pickupAllowed).map((stop) => stop.name),
    dropoffPoints: stops.filter((stop) => stop.dropoffAllowed).map((stop) => stop.name),
    version: route.originStopId && route.destinationStopId
      ? Number(route.version || 1) + 1
      : Math.max(1, Number(route.version || 1)),
    updatedBy: actorId(actor),
    updatedAt: nowIso(),
  });
  await repository.routes.save(route, { id: route.id }, session ? { session } : {});
  return { route, stops, segments: rows };
}

async function createRoute(companyId, payload = {}, actor = 'company-admin') {
  const listing = await repository.listingOrThrow(companyId, payload.listingId);
  const origin = await resolveEndpoint(companyId, payload, 'origin');
  const destination = await resolveEndpoint(companyId, payload, 'destination');
  if (origin.branchId && destination.branchId && origin.branchId === destination.branchId) throw validationError('Origin and destination terminals must be different');
  if (normalize(origin.name) === normalize(destination.name)) throw validationError('Origin and destination must be different');
  const timestamp = nowIso();
  const route = {
    id: await repository.nextId('route'),
    listingId: listing.id,
    companyId,
    routeName: cleanText(payload.routeName || payload.name || `${origin.name} to ${destination.name}`, 180),
    routeCode: cleanText(payload.routeCode || `${origin.name.slice(0, 3)}-${destination.name.slice(0, 3)}`, 40).toUpperCase(),
    timezone: cleanText(payload.timezone || timezoneForCountry(origin.branch?.country || listing.country), 80),
    version: 1,
    origin: origin.name,
    destination: destination.name,
    originTerminalId: origin.branchId,
    destinationTerminalId: destination.branchId,
    distanceKm: payload.distanceKm === '' || payload.distanceKm == null ? undefined : numberValue(payload.distanceKm, { field: 'Distance', min: 0, max: 20000 }),
    estimatedDuration: cleanText(payload.estimatedDuration, 80),
    estimatedDurationMinutes: payload.estimatedDurationMinutes === '' || payload.estimatedDurationMinutes == null
      ? parseDurationMinutes(payload.estimatedDuration, undefined)
      : numberValue(payload.estimatedDurationMinutes, { field: 'Estimated duration', min: 1, max: 100000, integer: true }),
    operatingDays: parseList(payload.operatingDays),
    corridor: cleanText(payload.corridor || `${toSlug(origin.name)}-${toSlug(destination.name)}`, 180),
    boardingBranchIds: origin.branchId ? [origin.branchId] : [],
    dropoffBranchIds: destination.branchId ? [destination.branchId] : [],
    boardingPoints: [origin.name],
    dropoffPoints: [destination.name],
    baggageRules: cleanText(payload.baggageRules || listing.baggageRules, 1600),
    cancellationRules: cleanText(payload.cancellationRules || listing.cancellationRules, 1600),
    publicInstructions: cleanText(payload.publicInstructions, 1600),
    status: 'active',
    createdBy: actorId(actor),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const originStop = stopFromEndpoint({ id: await repository.nextId('route-stop'), companyId, listingId: listing.id, routeId: route.id, endpoint: origin, type: 'origin', order: 1, actor });
  const intermediateStops = await selectedIntermediateStops({
    companyId,
    listingId: listing.id,
    routeId: route.id,
    payload,
    originBranchId: origin.branchId,
    destinationBranchId: destination.branchId,
    actor,
  });
  const destinationStop = stopFromEndpoint({ id: await repository.nextId('route-stop'), companyId, listingId: listing.id, routeId: route.id, endpoint: destination, type: 'destination', order: intermediateStops.length + 2, actor });
  await repository.withTransaction(async (session) => {
    await repository.routes.save(route, { id: route.id }, { session });
    await repository.routeStops.saveMany([originStop, ...intermediateStops, destinationStop], null, { session });
    await rebuildRouteSegments(companyId, route.id, actor, session);
    Object.assign(listing, { from: origin.name, to: destination.name, corridor: route.corridor, updatedAt: timestamp });
    await repository.listings.save(listing, { id: listing.id }, { session });
    await repository.audit({ actorId: actorId(actor), action: 'bus.route.created', targetType: 'route', targetId: route.id, companyId, metadata: { listingId: listing.id }, session });
  });
  return repository.routeOrThrow(companyId, route.id);
}

async function updateRoute(companyId, routeId, payload = {}, actor = 'company-admin') {
  const route = await repository.routeOrThrow(companyId, routeId);
  if (payload.listingId && payload.listingId !== route.listingId) {
    throw validationError('A route cannot be moved to another bus listing after creation. Create a new route for the other listing.');
  }
  const listing = await repository.listingOrThrow(companyId, route.listingId);
  const stops = sortStops(await repository.routeStops.list({ companyId, routeId, status: { $ne: 'archived' } }, { sort: { stopOrder: 1 } }));
  const originStop = stops.find((stop) => stop.stopType === 'origin') || stops[0];
  const destinationStop = stops.find((stop) => stop.stopType === 'destination') || stops[stops.length - 1];
  if (!originStop || !destinationStop) throw validationError('The route must have an origin and destination stop');

  const originChanged = Object.prototype.hasOwnProperty.call(payload, 'originBranchId') || Object.prototype.hasOwnProperty.call(payload, 'originTerminalId');
  const destinationChanged = Object.prototype.hasOwnProperty.call(payload, 'destinationBranchId') || Object.prototype.hasOwnProperty.call(payload, 'destinationTerminalId');
  const originBranch = originChanged
    ? await activeBranch(companyId, payload.originBranchId || payload.originTerminalId, 'Origin terminal')
    : null;
  const destinationBranch = destinationChanged
    ? await activeBranch(companyId, payload.destinationBranchId || payload.destinationTerminalId, 'Destination terminal')
    : null;
  const nextOriginId = originBranch?.id || originStop.branchId;
  const nextDestinationId = destinationBranch?.id || destinationStop.branchId;
  if (nextOriginId && nextDestinationId && nextOriginId === nextDestinationId) throw validationError('Origin and destination terminals must be different');
  const intermediateBranchIds = new Set(stops.slice(1, -1).map((stop) => stop.branchId).filter(Boolean));
  if (originChanged && intermediateBranchIds.has(nextOriginId)) throw validationError('The selected origin is already an intermediate stop. Remove or change that stop first.');
  if (destinationChanged && intermediateBranchIds.has(nextDestinationId)) throw validationError('The selected destination is already an intermediate stop. Remove or change that stop first.');

  if (payload.routeName || payload.name) route.routeName = cleanText(payload.routeName || payload.name, 180);
  if (Object.prototype.hasOwnProperty.call(payload, 'routeCode')) route.routeCode = cleanText(payload.routeCode, 40).toUpperCase();
  if (Object.prototype.hasOwnProperty.call(payload, 'timezone')) route.timezone = cleanText(payload.timezone || 'Africa/Kampala', 80);
  if (Object.prototype.hasOwnProperty.call(payload, 'distanceKm')) route.distanceKm = payload.distanceKm === '' ? undefined : numberValue(payload.distanceKm, { field: 'Distance', min: 0, max: 20000 });
  if (Object.prototype.hasOwnProperty.call(payload, 'estimatedDuration')) {
    route.estimatedDuration = cleanText(payload.estimatedDuration, 80);
    if (!Object.prototype.hasOwnProperty.call(payload, 'estimatedDurationMinutes')) route.estimatedDurationMinutes = parseDurationMinutes(payload.estimatedDuration, route.estimatedDurationMinutes);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'estimatedDurationMinutes')) route.estimatedDurationMinutes = payload.estimatedDurationMinutes === '' ? undefined : numberValue(payload.estimatedDurationMinutes, { field: 'Estimated duration', min: 1, max: 100000, integer: true });
  if (Object.prototype.hasOwnProperty.call(payload, 'operatingDays')) route.operatingDays = parseList(payload.operatingDays);
  if (Object.prototype.hasOwnProperty.call(payload, 'baggageRules')) route.baggageRules = cleanText(payload.baggageRules, 1600);
  if (Object.prototype.hasOwnProperty.call(payload, 'cancellationRules')) route.cancellationRules = cleanText(payload.cancellationRules, 1600);
  if (Object.prototype.hasOwnProperty.call(payload, 'publicInstructions')) route.publicInstructions = cleanText(payload.publicInstructions, 1600);

  if (originBranch) Object.assign(originStop, { branchId: originBranch.id, name: branchLabel(originBranch), updatedBy: actorId(actor), updatedAt: nowIso() });
  if (destinationBranch) Object.assign(destinationStop, { branchId: destinationBranch.id, name: branchLabel(destinationBranch), updatedBy: actorId(actor), updatedAt: nowIso() });
  if (originChanged || destinationChanged) route.corridor = cleanText(`${toSlug(originStop.name)}-${toSlug(destinationStop.name)}`, 180);

  if (payload.status && normalize(payload.status) === 'archived') {
    const future = await repository.schedules.count({ companyId, routeId, departAt: { $gt: new Date() }, status: { $in: ['published', 'boarding', 'delayed', 'departed'] } });
    if (future) throw conflictError('This route has active or future departures and cannot be archived');
    route.status = 'archived';
  } else if (payload.status) {
    route.status = 'active';
  }

  route.updatedBy = actorId(actor);
  route.updatedAt = nowIso();
  await repository.withTransaction(async (session) => {
    await repository.routeStops.saveMany([originStop, destinationStop], null, { session });
    await repository.routes.save(route, { id: route.id }, { session });
    const rebuilt = await rebuildRouteSegments(companyId, route.id, actor, session);
    Object.assign(listing, { from: rebuilt.route.origin, to: rebuilt.route.destination, corridor: rebuilt.route.corridor, updatedAt: nowIso() });
    await repository.listings.save(listing, { id: listing.id }, { session });
    await repository.audit({ actorId: actorId(actor), action: 'bus.route.updated', targetType: 'route', targetId: route.id, companyId, metadata: {}, session });
  });
  return repository.routeOrThrow(companyId, route.id);
}

async function createRouteStop(companyId, routeId, payload = {}, actor = 'company-admin') {
  const route = await repository.routeOrThrow(companyId, routeId);
  const branch = await activeBranch(companyId, payload.branchId, 'Route stop');
  const name = requireText(payload.name || payload.stopName || branchLabel(branch), 'Route stop', 180);
  const existing = sortStops(await repository.routeStops.list({ companyId, routeId, status: { $ne: 'archived' } }, { sort: { stopOrder: 1 } }));
  if (branch && existing.some((stop) => stop.branchId === branch.id)) throw conflictError('This terminal or branch is already an active stop on the route');
  const destination = existing[existing.length - 1];
  const requestedOrder = payload.stopOrder == null || payload.stopOrder === '' ? Number(destination.stopOrder) : numberValue(payload.stopOrder, { field: 'Stop order', min: 1, max: 1000, integer: true });
  const timestamp = nowIso();
  const stopType = ['boarding', 'pickup', 'intermediate', 'dropoff'].includes(normalize(payload.stopType)) ? normalize(payload.stopType) : 'intermediate';
  const defaultPickupAllowed = ['boarding', 'pickup', 'intermediate'].includes(stopType);
  const defaultDropoffAllowed = ['dropoff', 'intermediate'].includes(stopType);
  const stop = {
    id: await repository.nextId('route-stop'),
    routeId,
    listingId: route.listingId,
    companyId,
    branchId: branch?.id || '',
    name,
    stopType,
    stopOrder: requestedOrder,
    timeOffsetMinutes: payload.timeOffsetMinutes == null || payload.timeOffsetMinutes === '' ? 0 : numberValue(payload.timeOffsetMinutes, { field: 'Time offset', min: 0, max: 100000, integer: true }),
    pickupAllowed: Object.prototype.hasOwnProperty.call(payload, 'pickupAllowed') ? boolValue(payload.pickupAllowed) : defaultPickupAllowed,
    dropoffAllowed: Object.prototype.hasOwnProperty.call(payload, 'dropoffAllowed') ? boolValue(payload.dropoffAllowed) : defaultDropoffAllowed,
    publicInstructions: cleanText(payload.publicInstructions || payload.instructions, 1200),
    status: 'active',
    createdBy: actorId(actor),
    createdAt: timestamp,
  };
  // Make room before the destination; existing order remains an entity relationship, not user-typed text.
  const shifted = existing.filter((item) => Number(item.stopOrder) >= requestedOrder).map((item) => ({ ...item, stopOrder: Number(item.stopOrder) + 1, updatedAt: timestamp }));
  await repository.withTransaction(async (session) => {
    if (shifted.length) await repository.routeStops.saveMany(shifted, null, { session });
    await repository.routeStops.save(stop, { id: stop.id }, { session });
    await rebuildRouteSegments(companyId, routeId, actor, session);
    await repository.audit({ actorId: actorId(actor), action: 'bus.route_stop.created', targetType: 'route_stop', targetId: stop.id, companyId, metadata: { routeId }, session });
  });
  return stop;
}

async function updateRouteStop(companyId, stopId, payload = {}, actor = 'company-admin') {
  const stop = await repository.oneOrThrow(repository.routeStops, { id: stopId, companyId }, 'Route stop not found for this company');
  const route = await repository.routeOrThrow(companyId, stop.routeId);
  const branch = Object.prototype.hasOwnProperty.call(payload, 'branchId') ? await activeBranch(companyId, payload.branchId, 'Route stop') : null;
  if (Object.prototype.hasOwnProperty.call(payload, 'branchId')) stop.branchId = branch?.id || '';
  if (branch || payload.name || payload.stopName) stop.name = requireText(payload.name || payload.stopName || branchLabel(branch), 'Route stop', 180);
  const stopTypeChanged = payload.stopType && !['origin', 'destination'].includes(stop.stopType);
  if (stopTypeChanged) stop.stopType = ['boarding', 'pickup', 'intermediate', 'dropoff'].includes(normalize(payload.stopType)) ? normalize(payload.stopType) : 'intermediate';
  if (Object.prototype.hasOwnProperty.call(payload, 'timeOffsetMinutes')) stop.timeOffsetMinutes = numberValue(payload.timeOffsetMinutes || 0, { field: 'Time offset', min: 0, max: 100000, integer: true });
  if (Object.prototype.hasOwnProperty.call(payload, 'pickupAllowed')) stop.pickupAllowed = boolValue(payload.pickupAllowed);
  else if (stopTypeChanged) stop.pickupAllowed = ['boarding', 'pickup', 'intermediate'].includes(stop.stopType);
  if (Object.prototype.hasOwnProperty.call(payload, 'dropoffAllowed')) stop.dropoffAllowed = boolValue(payload.dropoffAllowed);
  else if (stopTypeChanged) stop.dropoffAllowed = ['dropoff', 'intermediate'].includes(stop.stopType);
  if (Object.prototype.hasOwnProperty.call(payload, 'publicInstructions')) stop.publicInstructions = cleanText(payload.publicInstructions, 1200);
  stop.updatedBy = actorId(actor);
  stop.updatedAt = nowIso();
  await repository.withTransaction(async (session) => {
    await repository.routeStops.save(stop, { id: stop.id }, { session });
    await rebuildRouteSegments(companyId, route.id, actor, session);
    await repository.audit({ actorId: actorId(actor), action: 'bus.route_stop.updated', targetType: 'route_stop', targetId: stop.id, companyId, metadata: { routeId: route.id }, session });
  });
  return stop;
}

async function moveRouteStop(companyId, stopId, direction = 'up', actor = 'company-admin') {
  const stop = await repository.oneOrThrow(repository.routeStops, { id: stopId, companyId }, 'Route stop not found for this company');
  if (['origin', 'destination'].includes(stop.stopType)) throw validationError('Origin and destination positions are fixed; edit the route endpoints instead');
  const stops = sortStops(await repository.routeStops.list({ companyId, routeId: stop.routeId, status: { $ne: 'archived' } }, { sort: { stopOrder: 1 } }));
  const index = stops.findIndex((item) => item.id === stop.id);
  const targetIndex = normalize(direction) === 'down' ? index + 1 : index - 1;
  if (targetIndex <= 0 || targetIndex >= stops.length - 1) throw validationError('The stop cannot move beyond the route origin or destination');
  const target = stops[targetIndex];
  [stop.stopOrder, target.stopOrder] = [target.stopOrder, stop.stopOrder];
  const timestamp = nowIso();
  stop.updatedAt = timestamp;
  target.updatedAt = timestamp;
  await repository.withTransaction(async (session) => {
    await repository.routeStops.saveMany([stop, target], null, { session });
    await rebuildRouteSegments(companyId, stop.routeId, actor, session);
  });
  return stop;
}

async function archiveRouteStop(companyId, stopId, actor = 'company-admin') {
  const stop = await repository.oneOrThrow(repository.routeStops, { id: stopId, companyId }, 'Route stop not found for this company');
  if (['origin', 'destination'].includes(stop.stopType)) throw validationError('Origin and destination cannot be removed; edit or archive the route instead');
  stop.status = 'archived';
  stop.updatedBy = actorId(actor);
  stop.updatedAt = nowIso();
  await repository.withTransaction(async (session) => {
    await repository.routeStops.save(stop, { id: stop.id }, { session });
    await rebuildRouteSegments(companyId, stop.routeId, actor, session);
    await repository.audit({ actorId: actorId(actor), action: 'bus.route_stop.archived', targetType: 'route_stop', targetId: stop.id, companyId, metadata: { routeId: stop.routeId }, session });
  });
  return stop;
}

async function archiveRoute(companyId, routeId, actor = 'company-admin') {
  const route = await repository.routeOrThrow(companyId, routeId);
  const future = await repository.schedules.count({ companyId, routeId, departAt: { $gt: new Date() }, status: { $in: ['published', 'boarding', 'delayed', 'departed'] } });
  if (future) throw conflictError('This route has active or future departures and cannot be archived');
  route.status = 'archived';
  route.updatedBy = actorId(actor);
  route.updatedAt = nowIso();
  await repository.routes.save(route, { id: route.id });
  await repository.routeSegments.updateMany({ companyId, routeId }, { $set: { status: 'archived', updatedAt: route.updatedAt } });
  await repository.audit({ actorId: actorId(actor), action: 'bus.route.archived', targetType: 'route', targetId: route.id, companyId, metadata: {} });
  return route;
}

function compatibilitySeats(version) {
  return version.seats.map((seat) => ({
    id: `${version.id}:${seat.seatNumber}`,
    seatNumber: seat.seatNumber,
    row: seat.row,
    col: seat.column,
    deck: seat.deck,
    displayLabel: seat.seatNumber,
    label: seat.seatNumber,
    seatType: seat.seatClass === 'VIP' ? 'vip' : seat.enabled === false ? 'disabled' : 'standard',
    seatClass: seat.enabled === false ? 'Disabled' : seat.seatClass === 'Accessible' ? 'Standard' : seat.seatClass,
    priceDelta: seat.priceDelta,
    isDisabled: seat.enabled === false,
    status: seat.enabled === false ? 'disabled' : 'available',
    blockedReason: seat.blockedReason,
  }));
}

async function createSeatMapVersion({ companyId, listingId, vehicleId, template, payload, actor, session = null }) {
  const layoutName = cleanText(payload.layoutName || payload.layout || template.layoutName || '2x2', 40);
  const requestedLabelMode = cleanText(payload.seatLabelMode || payload.labelMode || template.labelMode || (payload.seatLabels || payload.labels ? 'custom' : 'automatic'), 40);
  const requestedLabelPrefix = cleanText(payload.seatLabelPrefix || payload.labelPrefix || template.labelPrefix, 8).toUpperCase().replace(/\s+/g, '');
  const definitions = buildSeatDefinitions({
    totalSeats: payload.totalSeats || template.totalSeats,
    rows: payload.rows || template.rows,
    columns: payload.columns || payload.cols || template.columns,
    layoutName,
    labels: payload.seatLabels || payload.labels,
    labelMode: requestedLabelMode,
    labelPrefix: requestedLabelPrefix,
    vipSeats: payload.vipSeats,
    accessibleSeats: payload.accessibleSeats,
    crewSeats: payload.crewSeats,
    disabledSeats: payload.disabledSeats,
    blockedSeats: payload.blockedSeats,
    vipPriceDelta: payload.vipPriceDelta,
  });
  const nextVersion = Number(template.versionCounter || 0) + 1;
  const version = {
    id: await repository.nextId('seat-map-version'),
    templateId: template.id,
    companyId,
    listingId,
    vehicleId,
    version: nextVersion,
    layoutName,
    labelMode: definitions.labelMode,
    labelPrefix: definitions.labelPrefix,
    ...definitions,
    checksum: seatMapChecksum({ layoutName, ...definitions }),
    status: 'published',
    publishedAt: nowIso(),
    createdBy: actorId(actor),
    createdAt: nowIso(),
  };
  await repository.seatMapVersions.save(version, { id: version.id }, session ? { session } : {});
  Object.assign(template, {
    name: cleanText(payload.templateName || payload.seatTemplateName || template.name, 180),
    layoutName,
    labelMode: definitions.labelMode,
    labelPrefix: definitions.labelPrefix,
    rows: definitions.rows,
    columns: definitions.columns,
    totalSeats: definitions.totalSeats,
    activeVersionId: version.id,
    versionCounter: nextVersion,
    status: 'active',
    updatedBy: actorId(actor),
    updatedAt: nowIso(),
  });
  await repository.seatMapTemplates.save(template, { id: template.id }, session ? { session } : {});
  return version;
}

async function createVehicle(companyId, payload = {}, actor = 'company-admin') {
  const listing = await repository.listingOrThrow(companyId, payload.listingId);
  const name = requireText(payload.name || payload.vehicleName, 'Vehicle name', 180);
  const plate = requireText(payload.plateOrCode || payload.plateNumber || payload.code, 'Registration or fleet code', 80).toUpperCase();
  if (await repository.vehicles.findOne({ companyId, plateOrCode: plate, status: { $ne: 'archived' } })) throw conflictError('A vehicle with this registration or fleet code already exists');
  const timestamp = nowIso();
  const layoutName = cleanText(payload.layoutName || payload.layout || '2x2', 40);
  const totalSeats = numberValue(payload.totalSeats || 32, { field: 'Total seats', min: 1, max: 300, integer: true });
  const cols = numberValue(payload.columns || payload.cols || columnsForLayout(layoutName), { field: 'Seat columns', min: 1, max: 12, integer: true });
  const rows = numberValue(payload.rows || Math.ceil(totalSeats / cols), { field: 'Seat rows', min: 1, max: 100, integer: true });
  const requestedStatus = normalize(payload.status || 'active');
  const vehicle = {
    id: await repository.nextId('vehicle'),
    companyId,
    listingId: listing.id,
    serviceType: 'bus',
    name,
    plateOrCode: plate,
    layoutName,
    seatLabelMode: cleanText(payload.seatLabelMode || payload.labelMode || (payload.seatLabels || payload.labels ? 'custom' : 'automatic'), 40),
    seatLabelPrefix: cleanText(payload.seatLabelPrefix || payload.labelPrefix, 8).toUpperCase().replace(/\s+/g, ''),
    rows,
    cols,
    totalSeats,
    amenities: parseList(payload.amenities),
    media: mediaFromPayload(payload),
    manufacturer: cleanText(payload.manufacturer, 100),
    modelName: cleanText(payload.modelName || payload.model, 100),
    modelYear: payload.modelYear || payload.year ? numberValue(payload.modelYear || payload.year, { field: 'Model year', min: 1950, max: new Date().getFullYear() + 2, integer: true }) : undefined,
    chassisNumber: cleanText(payload.chassisNumber, 120),
    registrationCountry: cleanText(payload.registrationCountry || listing.country, 120),
    operatorPermitRef: cleanText(payload.operatorPermitRef, 160),
    operatorPermitExpiresAt: payload.operatorPermitExpiresAt || undefined,
    inspectionRef: cleanText(payload.inspectionRef, 160),
    inspectionExpiresAt: payload.inspectionExpiresAt || undefined,
    insuranceRef: cleanText(payload.insuranceRef, 160),
    insuranceExpiresAt: payload.insuranceExpiresAt || undefined,
    maintenanceReason: cleanText(payload.maintenanceReason || payload.maintenanceNote, 600),
    defaultSeatClass: 'Standard',
    vipPriceDelta: moneyValue(payload.vipPriceDelta, 'VIP price difference', 0),
    status: ['active', 'maintenance', 'paused', 'archived'].includes(requestedStatus) ? requestedStatus : 'active',
    createdBy: actorId(actor),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const template = {
    id: await repository.nextId('seat-map-template'),
    companyId,
    listingId: listing.id,
    vehicleId: vehicle.id,
    name: cleanText(payload.templateName || `${name} seat map`, 180),
    layoutName: vehicle.layoutName,
    labelMode: vehicle.seatLabelMode,
    labelPrefix: vehicle.seatLabelPrefix,
    rows: vehicle.rows,
    columns: vehicle.cols,
    totalSeats: vehicle.totalSeats,
    versionCounter: 0,
    status: 'draft',
    createdBy: actorId(actor),
    createdAt: timestamp,
  };
  await repository.withTransaction(async (session) => {
    await repository.vehicles.save(vehicle, { id: vehicle.id }, { session });
    await repository.seatMapTemplates.save(template, { id: template.id }, { session });
    const version = await createSeatMapVersion({ companyId, listingId: listing.id, vehicleId: vehicle.id, template, payload, actor, session });
    Object.assign(vehicle, {
      activeSeatMapTemplateId: template.id,
      activeSeatMapVersionId: version.id,
      layoutName: version.layoutName,
      seatLabelMode: version.labelMode,
      seatLabelPrefix: version.labelPrefix,
      rows: version.rows,
      cols: version.columns,
      totalSeats: version.totalSeats,
      seatTemplate: compatibilitySeats(version),
      updatedAt: nowIso(),
    });
    await repository.vehicles.save(vehicle, { id: vehicle.id }, { session });
    await repository.audit({ actorId: actorId(actor), action: 'bus.vehicle.created', targetType: 'vehicle', targetId: vehicle.id, companyId, metadata: { listingId: listing.id, seatMapVersionId: version.id }, session });
  });
  return vehicle;
}

async function updateVehicle(companyId, vehicleId, payload = {}, actor = 'company-admin') {
  const vehicle = await repository.vehicleOrThrow(companyId, vehicleId);
  if (payload.listingId && payload.listingId !== vehicle.listingId) {
    throw validationError('A vehicle cannot be moved to another bus listing after schedules or seat-map versions exist. Create a new vehicle for the other listing.');
  }
  const direct = ['name', 'manufacturer', 'modelName', 'chassisNumber', 'registrationCountry', 'operatorPermitRef', 'inspectionRef', 'insuranceRef', 'maintenanceReason'];
  for (const field of direct) if (Object.prototype.hasOwnProperty.call(payload, field)) vehicle[field] = cleanText(payload[field], 180);
  if (payload.model) vehicle.modelName = cleanText(payload.model, 100);
  if (Object.prototype.hasOwnProperty.call(payload, 'maintenanceNote')) vehicle.maintenanceReason = cleanText(payload.maintenanceNote, 600);
  if (payload.plateOrCode || payload.plateNumber || payload.code) {
    const nextPlate = requireText(payload.plateOrCode || payload.plateNumber || payload.code, 'Registration or fleet code', 80).toUpperCase();
    const duplicate = await repository.vehicles.findOne({ companyId, plateOrCode: nextPlate, id: { $ne: vehicle.id }, status: { $ne: 'archived' } });
    if (duplicate) throw conflictError('A vehicle with this registration or fleet code already exists');
    vehicle.plateOrCode = nextPlate;
  }
  if (payload.modelYear || payload.year) vehicle.modelYear = numberValue(payload.modelYear || payload.year, { field: 'Model year', min: 1950, max: new Date().getFullYear() + 2, integer: true });
  for (const field of ['operatorPermitExpiresAt', 'inspectionExpiresAt', 'insuranceExpiresAt']) if (Object.prototype.hasOwnProperty.call(payload, field)) vehicle[field] = payload[field] || null;
  if (Object.prototype.hasOwnProperty.call(payload, 'amenities')) vehicle.amenities = parseList(payload.amenities);
  if (Object.prototype.hasOwnProperty.call(payload, 'status')) {
    const nextStatus = normalize(payload.status);
    if (!['active', 'maintenance', 'paused', 'archived'].includes(nextStatus)) throw validationError('Invalid vehicle status');
    if (['maintenance', 'archived'].includes(nextStatus) && nextStatus !== vehicle.status) {
      const future = await repository.schedules.count({ companyId, vehicleId, departAt: { $gt: new Date() }, status: { $in: ['published', 'boarding', 'delayed', 'departed'] } });
      if (future) throw conflictError('This vehicle is assigned to active or future departures');
    }
    vehicle.status = nextStatus;
  }
  vehicle.media = mediaFromPayload(payload, Array.isArray(vehicle.media) ? vehicle.media : []);
  vehicle.updatedBy = actorId(actor);
  vehicle.updatedAt = nowIso();
  await repository.vehicles.save(vehicle, { id: vehicle.id });
  await repository.audit({ actorId: actorId(actor), action: 'bus.vehicle.updated', targetType: 'vehicle', targetId: vehicle.id, companyId, metadata: {} });
  return vehicle;
}

async function updateVehicleSeatTemplate(companyId, vehicleId, payload = {}, actor = 'company-admin') {
  const vehicle = await repository.vehicleOrThrow(companyId, vehicleId);
  let template = vehicle.activeSeatMapTemplateId ? await repository.seatMapTemplates.findOne({ id: vehicle.activeSeatMapTemplateId, companyId }) : null;
  if (!template) template = await repository.seatMapTemplates.findOne({ vehicleId: vehicle.id, companyId, status: { $ne: 'archived' } });
  const currentVersion = vehicle.activeSeatMapVersionId
    ? await repository.seatMapVersions.findOne({ id: vehicle.activeSeatMapVersionId, companyId, vehicleId: vehicle.id })
    : null;
  if (!template) {
    template = { id: await repository.nextId('seat-map-template'), companyId, listingId: vehicle.listingId, vehicleId: vehicle.id, name: cleanText(payload.templateName || `${vehicle.name} seat map`, 180), layoutName: payload.layoutName || vehicle.layoutName || '2x2', labelMode: payload.seatLabelMode || payload.labelMode || vehicle.seatLabelMode || 'automatic', labelPrefix: payload.seatLabelPrefix || payload.labelPrefix || vehicle.seatLabelPrefix || '', rows: payload.rows || vehicle.rows || 8, columns: payload.columns || payload.cols || vehicle.cols || 4, totalSeats: payload.totalSeats || vehicle.totalSeats || 32, versionCounter: 0, status: 'draft', createdBy: actorId(actor), createdAt: nowIso() };
  }
  const requestedMode = cleanText(payload.seatLabelMode || payload.labelMode, 40);
  const hasSubmittedLabels = Boolean(parseList(payload.seatLabels || payload.labels).length);
  const effectivePayload = { ...payload };
  if (!requestedMode && !hasSubmittedLabels) effectivePayload.seatLabelMode = currentVersion?.seats?.length ? 'preserve' : 'automatic';
  if (normalize(effectivePayload.seatLabelMode || effectivePayload.labelMode) === 'preserve' && !hasSubmittedLabels) {
    effectivePayload.seatLabels = (currentVersion?.seats || []).map((seat) => seat.seatNumber);
  }
  let version;
  await repository.withTransaction(async (session) => {
    version = await createSeatMapVersion({ companyId, listingId: vehicle.listingId, vehicleId: vehicle.id, template, payload: { ...effectivePayload, totalSeats: effectivePayload.totalSeats || vehicle.totalSeats, rows: effectivePayload.rows || vehicle.rows, columns: effectivePayload.columns || effectivePayload.cols || vehicle.cols, layoutName: effectivePayload.layoutName || effectivePayload.layout || vehicle.layoutName }, actor, session });
    Object.assign(vehicle, { activeSeatMapTemplateId: template.id, activeSeatMapVersionId: version.id, layoutName: version.layoutName, seatLabelMode: version.labelMode, seatLabelPrefix: version.labelPrefix, rows: version.rows, cols: version.columns, totalSeats: version.totalSeats, seatTemplate: compatibilitySeats(version), vipPriceDelta: moneyValue(payload.vipPriceDelta, 'VIP price difference', vehicle.vipPriceDelta || 0), updatedBy: actorId(actor), updatedAt: nowIso() });
    await repository.vehicles.save(vehicle, { id: vehicle.id }, { session });
    await repository.audit({ actorId: actorId(actor), action: 'bus.seat_map.version_published', targetType: 'seat_map_version', targetId: version.id, companyId, metadata: { vehicleId, version: version.version }, session });
  });
  return { vehicle, template, version };
}

async function updateVehicleStatus(companyId, vehicleId, payload = {}, actor = 'company-admin') {
  const vehicle = await repository.vehicleOrThrow(companyId, vehicleId);
  const next = normalize(payload.status || payload.nextStatus);
  if (!['active', 'maintenance', 'paused', 'archived'].includes(next)) throw validationError('Invalid vehicle status');
  if (['maintenance', 'archived'].includes(next)) {
    const future = await repository.schedules.count({ companyId, vehicleId, departAt: { $gt: new Date() }, status: { $in: ['published', 'boarding', 'delayed', 'departed'] } });
    if (future) throw conflictError('This vehicle is assigned to active or future departures');
  }
  vehicle.status = next;
  vehicle.maintenanceReason = cleanText(payload.maintenanceReason || payload.reason, 600);
  vehicle.updatedBy = actorId(actor);
  vehicle.updatedAt = nowIso();
  await repository.vehicles.save(vehicle, { id: vehicle.id });
  await repository.audit({ actorId: actorId(actor), action: 'bus.vehicle.status_updated', targetType: 'vehicle', targetId: vehicle.id, companyId, metadata: { status: next }, });
  return vehicle;
}

async function archiveVehicle(companyId, vehicleId, actor = 'company-admin') {
  return updateVehicleStatus(companyId, vehicleId, { status: 'archived' }, actor);
}

async function syncListingFareSummary(companyId, listingId, session = null) {
  const listing = await repository.listingOrThrow(companyId, listingId, session ? { session } : {});
  const products = await repository.fareProducts.list({ companyId, listingId: listing.id, status: 'active' }, { limit: 1000, ...(session ? { session } : {}) });
  const productIds = products.map((row) => row.id);
  const fares = productIds.length
    ? await repository.segmentFares.list({ companyId, listingId: listing.id, fareProductId: { $in: productIds }, status: 'active' }, { limit: 10000, ...(session ? { session } : {}) })
    : [];
  const amounts = fares.map((row) => Number(row.amount || 0)).filter((amount) => Number.isFinite(amount) && amount > 0);
  listing.priceFrom = amounts.length ? Math.min(...amounts) : 0;
  listing.updatedAt = nowIso();
  await repository.listings.save(listing, { id: listing.id }, session ? { session } : {});
  return listing;
}

async function createFareProduct(companyId, payload = {}, actor = 'company-admin') {
  const route = await repository.routeOrThrow(companyId, payload.routeId);
  const listing = await repository.listingOrThrow(companyId, route.listingId);
  const timestamp = nowIso();
  const fareClass = ['standard', 'economy', 'business', 'executive', 'vip', 'premium', 'express'].includes(normalize(payload.fareClass)) ? normalize(payload.fareClass) : 'standard';
  const product = {
    id: await repository.nextId('fare-product'),
    companyId,
    listingId: listing.id,
    routeId: route.id,
    name: cleanText(payload.name || payload.fareName || `${route.routeName || `${route.origin} to ${route.destination}`} ${fareClass} fare`, 180),
    fareClass,
    currency: cleanText(listing.currency, 10).toUpperCase(),
    refundable: boolValue(payload.refundable),
    changeable: boolValue(payload.changeable),
    baggageAllowanceKg: moneyValue(payload.baggageAllowanceKg, 'Baggage allowance', 0),
    cancellationPolicyId: cleanText(payload.cancellationPolicyId, 180),
    baggagePolicyId: cleanText(payload.baggagePolicyId, 180),
    salesStartAt: payload.salesStartAt || null,
    salesEndAt: payload.salesEndAt || null,
    status: normalize(payload.status || 'active') === 'draft' ? 'draft' : 'active',
    createdBy: actorId(actor),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  let initialSegmentEndpoints = null;
  if (payload.amount !== undefined && payload.amount !== '') {
    const orderedStops = sortStops(await repository.routeStops.list({ companyId, routeId: route.id, status: { $ne: 'archived' } }, { sort: { stopOrder: 1 } }));
    const originStop = orderedStops.find((stop) => String(stop.id) === String(route.originStopId || '')) || orderedStops[0];
    const destinationStop = orderedStops.find((stop) => String(stop.id) === String(route.destinationStopId || '')) || orderedStops[orderedStops.length - 1];
    if (!originStop || !destinationStop || Number(destinationStop.stopOrder) <= Number(originStop.stopOrder)) {
      throw validationError('Create at least two ordered route stops before saving the full-route fare');
    }
    initialSegmentEndpoints = { fromStopId: originStop.id, toStopId: destinationStop.id };
  }
  await repository.withTransaction(async (session) => {
    await repository.fareProducts.save(product, { id: product.id }, { session });
    if (!route.activeFareProductId && product.status === 'active') {
      route.activeFareProductId = product.id;
      route.updatedAt = timestamp;
      await repository.routes.save(route, { id: route.id }, { session });
    }
    await repository.audit({ actorId: actorId(actor), action: 'bus.fare_product.created', targetType: 'fare_product', targetId: product.id, companyId, metadata: { routeId: route.id }, session });
  });
  if (initialSegmentEndpoints) {
    await upsertSegmentFare(companyId, product.id, { ...initialSegmentEndpoints, amount: payload.amount, currency: product.currency }, actor);
  }
  return product;
}

async function updateFareProduct(companyId, fareProductId, payload = {}, actor = 'company-admin') {
  const product = await repository.fareProductOrThrow(companyId, fareProductId);
  if (payload.name || payload.fareName) product.name = requireText(payload.name || payload.fareName, 'Fare product name', 180);
  if (payload.fareClass) product.fareClass = normalize(payload.fareClass);
  if (Object.prototype.hasOwnProperty.call(payload, 'refundable')) product.refundable = boolValue(payload.refundable);
  if (Object.prototype.hasOwnProperty.call(payload, 'changeable')) product.changeable = boolValue(payload.changeable);
  if (Object.prototype.hasOwnProperty.call(payload, 'baggageAllowanceKg')) product.baggageAllowanceKg = moneyValue(payload.baggageAllowanceKg, 'Baggage allowance', 0);
  if (payload.status) product.status = ['draft', 'active', 'paused', 'archived'].includes(normalize(payload.status)) ? normalize(payload.status) : product.status;
  product.updatedBy = actorId(actor);
  product.updatedAt = nowIso();
  await repository.fareProducts.save(product, { id: product.id });
  await syncListingFareSummary(companyId, product.listingId);
  await repository.audit({ actorId: actorId(actor), action: 'bus.fare_product.updated', targetType: 'fare_product', targetId: product.id, companyId, metadata: {} });
  return product;
}

async function upsertSegmentFare(companyId, fareProductId, payload = {}, actor = 'company-admin') {
  const product = await repository.fareProductOrThrow(companyId, fareProductId);
  const route = await repository.routeOrThrow(companyId, product.routeId);
  const stops = sortStops(await repository.routeStops.list({ companyId, routeId: route.id, status: { $ne: 'archived' } }, { sort: { stopOrder: 1 } }));
  const from = stops.find((stop) => String(stop.id) === String(payload.fromStopId));
  const to = stops.find((stop) => String(stop.id) === String(payload.toStopId));
  if (!from || !to) throw validationError('Select fare endpoints from this route');
  if (Number(to.stopOrder) <= Number(from.stopOrder)) throw validationError('Fare destination must come after its origin');
  const existing = await repository.segmentFares.findOne({ fareProductId: product.id, fromStopId: from.id, toStopId: to.id });
  const row = {
    ...(existing || {}),
    id: existing?.id || await repository.nextId('segment-fare'),
    companyId,
    listingId: product.listingId,
    routeId: route.id,
    fareProductId: product.id,
    fromStopId: from.id,
    toStopId: to.id,
    fromOrder: Number(from.stopOrder),
    toOrder: Number(to.stopOrder),
    amount: moneyValue(payload.amount, 'Fare amount'),
    currency: cleanText(product.currency, 10).toUpperCase(),
    status: normalize(payload.status || 'active') === 'archived' ? 'archived' : 'active',
    updatedBy: actorId(actor),
    updatedAt: nowIso(),
    createdAt: existing?.createdAt || nowIso(),
  };
  await repository.withTransaction(async (session) => {
    await repository.segmentFares.save(row, { id: row.id }, { session });
    await syncListingFareSummary(companyId, product.listingId, session);
    await repository.audit({ actorId: actorId(actor), action: 'bus.segment_fare.saved', targetType: 'segment_fare', targetId: row.id, companyId, metadata: { fareProductId: product.id, routeId: route.id }, session });
  });
  return row;
}


const ADDON_TEMPLATES = Object.freeze({
  bus: Object.freeze({
    extra_luggage: { name: 'Extra luggage', description: 'Adds one extra checked-luggage allowance for each selected traveler.', category: 'baggage', icon: 'fa-suitcase-rolling', chargeBasis: 'per_passenger', availableFor: 'all' },
    priority_boarding: { name: 'Priority boarding', description: 'Board before general boarding and settle into your seat earlier.', category: 'boarding', icon: 'fa-person-walking-arrow-right', chargeBasis: 'per_passenger', availableFor: 'all' },
    sms_whatsapp_ticket: { name: 'SMS and WhatsApp ticket', description: 'Receive the ticket and journey updates by both SMS and WhatsApp.', category: 'communication', icon: 'fa-message', chargeBasis: 'per_booking', availableFor: 'all' },
    travel_insurance: { name: 'Travel insurance', description: 'Optional trip protection for each traveler, subject to the partner policy.', category: 'insurance', icon: 'fa-shield-heart', chargeBasis: 'per_passenger', availableFor: 'all' },
    meal_pack: { name: 'Meal pack', description: 'A meal or refreshment pack provided on each selected trip leg.', category: 'meal', icon: 'fa-utensils', chargeBasis: 'per_passenger_per_leg', availableFor: 'all' },
    lounge_access: { name: 'Terminal lounge access', description: 'Access the partner lounge before departure.', category: 'comfort', icon: 'fa-couch', chargeBasis: 'per_passenger_per_leg', availableFor: 'all' },
    flexible_change: { name: 'Flexible ticket change', description: 'Adds a more flexible change option for this booking, subject to availability.', category: 'flexibility', icon: 'fa-calendar-pen', chargeBasis: 'per_booking', availableFor: 'all' },
    premium_wifi: { name: 'Premium Wi-Fi', description: 'Higher-priority onboard internet access for each traveler and trip leg.', category: 'comfort', icon: 'fa-wifi', chargeBasis: 'per_passenger_per_leg', availableFor: 'all' },
  }),
  hotel: Object.freeze({
    breakfast: { name: 'Breakfast', description: 'Breakfast for each selected guest on every night of the stay.', category: 'meal', icon: 'fa-mug-saucer', chargeBasis: 'per_passenger_per_leg', availableFor: 'all' },
    airport_transfer: { name: 'Airport transfer', description: 'One airport pickup or drop-off arranged for this hotel booking.', category: 'comfort', icon: 'fa-van-shuttle', chargeBasis: 'per_booking', availableFor: 'all' },
    parking: { name: 'Secure parking', description: 'Secure parking charged for each reserved room-night.', category: 'comfort', icon: 'fa-square-parking', chargeBasis: 'per_trip_leg', availableFor: 'all' },
    late_checkout: { name: 'Late checkout', description: 'A later checkout time for the booking, subject to hotel confirmation.', category: 'flexibility', icon: 'fa-clock', chargeBasis: 'per_booking', availableFor: 'all' },
    extra_bed: { name: 'Extra bed', description: 'An extra bed for each selected guest-night, subject to room capacity.', category: 'comfort', icon: 'fa-bed', chargeBasis: 'per_passenger_per_leg', availableFor: 'all' },
    spa_access: { name: 'Spa access', description: 'Spa access for each selected guest during the stay.', category: 'comfort', icon: 'fa-spa', chargeBasis: 'per_passenger', availableFor: 'all' },
    meal_plan: { name: 'Meal plan', description: 'A hotel meal plan for each selected guest-night.', category: 'meal', icon: 'fa-utensils', chargeBasis: 'per_passenger_per_leg', availableFor: 'all' },
    room_upgrade_request: { name: 'Room upgrade request', description: 'Request an upgraded room category, subject to availability and confirmation.', category: 'comfort', icon: 'fa-arrow-up-right-dots', chargeBasis: 'per_booking', availableFor: 'all' },
  }),
});

function addonTemplate(payload = {}, serviceType = 'bus') {
  const templates = ADDON_TEMPLATES[serviceType] || ADDON_TEMPLATES.bus;
  return templates[normalize(payload.template || payload.templateKey)] || {};
}

function addonServiceType(listing = {}) {
  const serviceType = normalize(listing.serviceType || listing.type);
  if (!['bus', 'hotel'].includes(serviceType)) throw validationError('Optional add-ons are currently supported only for bus and hotel listings', 422);
  return serviceType;
}

async function createServiceAddon(companyId, payload = {}, actor = 'company-admin') {
  const listing = await repository.listingOrThrow(companyId, payload.listingId);
  const serviceType = addonServiceType(listing);
  const template = addonTemplate(payload, serviceType);
  const listingCurrency = cleanText(listing.currency, 10).toUpperCase();
  const timestamp = nowIso();
  const category = normalize(payload.category || template.category || 'other');
  const chargeBasis = normalize(payload.chargeBasis || template.chargeBasis || 'per_booking');
  const availableFor = serviceType === 'hotel' ? 'all' : normalize(payload.availableFor || template.availableFor || 'all');
  const row = {
    id: await repository.nextId('service-addon'),
    companyId,
    listingId: listing.id,
    serviceType,
    name: requireText(payload.name || template.name, 'Add-on name', 180),
    description: cleanText(payload.description || template.description, 700),
    category: ['baggage','boarding','communication','comfort','meal','insurance','flexibility','accessibility','other'].includes(category) ? category : 'other',
    icon: cleanText(payload.icon || template.icon || 'fa-circle-plus', 80),
    price: moneyValue(payload.price, `Add-on price in ${listingCurrency || 'the listing currency'}`),
    currency: listingCurrency,
    chargeBasis: ['per_booking','per_passenger','per_trip_leg','per_passenger_per_leg'].includes(chargeBasis) ? chargeBasis : 'per_booking',
    availableFor: ['all','one_way','round_trip'].includes(availableFor) ? availableFor : 'all',
    maxQuantity: Math.max(1, Math.min(20, Number(payload.maxQuantity || 1) || 1)),
    sortOrder: Number(payload.sortOrder || 0) || 0,
    status: ['draft','active','paused'].includes(normalize(payload.status)) ? normalize(payload.status) : 'active',
    createdBy: actorId(actor),
    updatedBy: actorId(actor),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await repository.serviceAddons.save(row, { id: row.id });
  await repository.audit({ actorId: actorId(actor), action: `${serviceType}.service_addon.created`, targetType: 'service_addon', targetId: row.id, companyId, metadata: { listingId: listing.id, serviceType, chargeBasis: row.chargeBasis } });
  return row;
}

async function updateServiceAddon(companyId, addonId, payload = {}, actor = 'company-admin') {
  const row = await repository.serviceAddons.findOne({ id: cleanText(addonId, 180), companyId });
  if (!row) throw validationError('Optional add-on not found', 404);
  if (payload.listingId && String(payload.listingId) !== String(row.listingId)) {
    const listing = await repository.listingOrThrow(companyId, payload.listingId);
    row.listingId = listing.id;
    row.serviceType = addonServiceType(listing);
    row.currency = cleanText(listing.currency, 10).toUpperCase();
  }
  const serviceType = ['bus', 'hotel'].includes(normalize(row.serviceType)) ? normalize(row.serviceType) : 'bus';
  if (payload.name) row.name = requireText(payload.name, 'Add-on name', 180);
  if (Object.prototype.hasOwnProperty.call(payload, 'description')) row.description = cleanText(payload.description, 700);
  if (Object.prototype.hasOwnProperty.call(payload, 'price')) row.price = moneyValue(payload.price, 'Add-on price');
  if (payload.category && ['baggage','boarding','communication','comfort','meal','insurance','flexibility','accessibility','other'].includes(normalize(payload.category))) row.category = normalize(payload.category);
  if (payload.icon) row.icon = cleanText(payload.icon, 80);
  if (payload.chargeBasis && ['per_booking','per_passenger','per_trip_leg','per_passenger_per_leg'].includes(normalize(payload.chargeBasis))) row.chargeBasis = normalize(payload.chargeBasis);
  if (serviceType === 'hotel') row.availableFor = 'all';
  else if (payload.availableFor && ['all','one_way','round_trip'].includes(normalize(payload.availableFor))) row.availableFor = normalize(payload.availableFor);
  if (Object.prototype.hasOwnProperty.call(payload, 'sortOrder')) row.sortOrder = Number(payload.sortOrder || 0) || 0;
  if (payload.status && ['draft','active','paused','archived'].includes(normalize(payload.status))) row.status = normalize(payload.status);
  row.updatedBy = actorId(actor);
  row.updatedAt = nowIso();
  await repository.serviceAddons.save(row, { id: row.id });
  await repository.audit({ actorId: actorId(actor), action: `${serviceType}.service_addon.updated`, targetType: 'service_addon', targetId: row.id, companyId, metadata: { listingId: row.listingId, serviceType, status: row.status } });
  return row;
}

async function archiveServiceAddon(companyId, addonId, actor = 'company-admin') {
  return updateServiceAddon(companyId, addonId, { status: 'archived' }, actor);
}

async function readinessReport(companyId) {
  const listings = await repository.listings.list({ companyId, serviceType: 'bus', status: { $ne: 'archived' } });
  const results = [];
  for (const listing of listings) results.push({ listingId: listing.id, title: listing.title, ...(await listingReadiness(companyId, listing.id)) });
  return {
    companyId,
    generatedAt: nowIso(),
    listings: results,
    publicReady: results.filter((item) => item.publicReady).length,
    bookable: results.filter((item) => item.bookingReady).length,
    ready: results.filter((item) => item.publicReady).length,
    incomplete: results.filter((item) => !item.publicReady).length,
  };
}

module.exports = {
  createBusListing,
  updateBusListing,
  publishBusListing,
  smartPublishBusListing,
  smartPreparePublishedDeparture,
  archiveBusListing,
  listingReadiness,
  createRoute,
  updateRoute,
  archiveRoute,
  createRouteStop,
  updateRouteStop,
  archiveRouteStop,
  moveRouteStop,
  rebuildRouteSegments,
  createVehicle,
  updateVehicle,
  archiveVehicle,
  updateVehicleSeatTemplate,
  updateVehicleStatus,
  createFareProduct,
  updateFareProduct,
  upsertSegmentFare,
  createServiceAddon,
  updateServiceAddon,
  archiveServiceAddon,
  syncListingFareSummary,
  readinessReport,
  compatibilitySeats,
};
