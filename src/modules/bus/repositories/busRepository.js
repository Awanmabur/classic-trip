'use strict';

const { MongoCollection } = require('../../../repositories/domain/mongoCollection');
const { runMongoUnitOfWork } = require('../../../services/shared/mongoUnitOfWork');
const { nextId } = require('../../../services/data/idService');
const { notFoundError } = require('../domain/busDomain');

const busRepository = {
  users: new MongoCollection('users'),
  companies: new MongoCollection('companies'),
  employees: new MongoCollection('companyEmployees'),
  invitations: new MongoCollection('invitations'),
  supportTickets: new MongoCollection('supportTickets'),
  branches: new MongoCollection('companyBranches'),
  listings: new MongoCollection('listings'),
  routes: new MongoCollection('routes'),
  routeStops: new MongoCollection('routeStops'),
  routeSegments: new MongoCollection('routeSegments'),
  vehicles: new MongoCollection('vehicles'),
  seatMapTemplates: new MongoCollection('seatMapTemplates'),
  seatMapVersions: new MongoCollection('seatMapVersions'),
  fareProducts: new MongoCollection('fareProducts'),
  segmentFares: new MongoCollection('busSegmentFares'),
  serviceAddons: new MongoCollection('serviceAddons'),
  scheduleRules: new MongoCollection('scheduleRules'),
  schedules: new MongoCollection('schedules'),
  seats: new MongoCollection('seats'),
  segmentInventory: new MongoCollection('busSeatSegmentInventories'),
  holds: new MongoCollection('inventoryHolds'),
  holdItems: new MongoCollection('inventoryHoldItems'),
  bookings: new MongoCollection('bookings'),
  bookingItems: new MongoCollection('bookingItems'),
  reservations: new MongoCollection('busReservations'),
  passengers: new MongoCollection('passengers'),
  seatAssignments: new MongoCollection('busSeatAssignments'),
  tickets: new MongoCollection('busTickets'),
  paymentIntents: new MongoCollection('paymentIntents'),
  payments: new MongoCollection('payments'),
  idempotencyKeys: new MongoCollection('idempotencyKeyRecords'),
  driverAssignments: new MongoCollection('driverAssignments'),
  incidents: new MongoCollection('driverIncidents'),
  tripStatusUpdates: new MongoCollection('tripStatusUpdates'),
  ticketScans: new MongoCollection('ticketScans'),
  outboxEvents: new MongoCollection('outboxEvents'),
  auditLogs: new MongoCollection('auditLogs'),
};

async function oneOrThrow(collection, filter, message, options = {}) {
  const row = await collection.findOne(filter, options);
  if (!row) throw notFoundError(message);
  return row;
}

async function companyOrThrow(companyId, options = {}) {
  return oneOrThrow(busRepository.companies, { id: companyId }, 'Company not found', options);
}

async function listingOrThrow(companyId, listingId, options = {}) {
  const key = String(listingId || '').trim();
  const identities = [{ id: key }, { slug: key }];
  if (/^[a-f0-9]{24}$/i.test(key)) identities.push({ _id: key });
  const listing = await oneOrThrow(busRepository.listings, { companyId, $or: identities }, 'Bus service listing not found for this company', options);
  const serviceType = String(listing.serviceType || '').toLowerCase().trim();
  if (serviceType !== 'bus') throw notFoundError('Bus service listing not found for this company');
  return listing;
}

function identityClauses(value) {
  const key = String(value || '').trim();
  const clauses = [{ id: key }];
  if (/^[a-f0-9]{24}$/i.test(key)) clauses.push({ _id: key });
  return clauses;
}

async function routeOrThrow(companyId, routeId, options = {}) {
  return oneOrThrow(busRepository.routes, { companyId, $or: identityClauses(routeId) }, 'Bus route not found for this company', options);
}

async function vehicleOrThrow(companyId, vehicleId, options = {}) {
  return oneOrThrow(busRepository.vehicles, { companyId, serviceType: 'bus', $or: identityClauses(vehicleId) }, 'Bus vehicle not found for this company', options);
}

async function scheduleOrThrow(companyId, scheduleId, options = {}) {
  return oneOrThrow(busRepository.schedules, { companyId, $or: identityClauses(scheduleId) }, 'Bus departure not found for this company', options);
}

async function fareProductOrThrow(companyId, fareProductId, options = {}) {
  return oneOrThrow(busRepository.fareProducts, { companyId, $or: identityClauses(fareProductId) }, 'Bus fare product not found for this company', options);
}

async function seatMapVersionOrThrow(companyId, versionId, options = {}) {
  return oneOrThrow(busRepository.seatMapVersions, { companyId, $or: identityClauses(versionId) }, 'Seat-map version not found for this company', options);
}

async function audit({ actorId = 'system', action, targetType = 'bus', targetId, companyId = '', metadata = {}, session = null }) {
  const row = {
    id: await nextId('audit'),
    actorId,
    actorRole: metadata.actorRole || '',
    action,
    targetType,
    targetId,
    target: targetId,
    companyId,
    meta: metadata,
    status: 'success',
    createdAt: new Date().toISOString(),
  };
  await busRepository.auditLogs.save(row, { id: row.id }, session ? { session } : {});
  return row;
}

async function outbox({ eventType, aggregateType, aggregateId, companyId = '', payload = {}, dedupeKey, session = null }) {
  const row = {
    id: await nextId('outbox'),
    dedupeKey: dedupeKey || `${eventType}:${aggregateId}`,
    topic: eventType,
    type: eventType,
    eventType,
    aggregateType,
    aggregateId,
    companyId,
    payload,
    status: 'pending',
    attempts: 0,
    createdAt: new Date().toISOString(),
  };
  await busRepository.outboxEvents.save(row, { dedupeKey: row.dedupeKey }, session ? { session } : {});
  return row;
}

async function withTransaction(work) {
  return runMongoUnitOfWork(work);
}

module.exports = {
  ...busRepository,
  nextId,
  oneOrThrow,
  companyOrThrow,
  listingOrThrow,
  routeOrThrow,
  vehicleOrThrow,
  scheduleOrThrow,
  fareProductOrThrow,
  seatMapVersionOrThrow,
  audit,
  outbox,
  withTransaction,
};
