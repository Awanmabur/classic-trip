'use strict';

const { mongoose } = require('../../config/db');
const { POLICIES, RETENTION_DAYS } = require('../../jobs/purgeArchivedRecords');
const { nextId } = require('../data/idService');
const platformRepository = require('../../repositories/domain/platformRepository');

const POLICY_MODELS = new Set(POLICIES.map((policy) => policy.model));
const COMPANY_MODELS = new Set([
  'CompanyPolicy', 'CompanyBranch', 'ServiceAddon', 'BusSegmentFare',
  'FareProduct', 'RouteStop', 'RouteSegment', 'SeatMapTemplate',
  'SeatMapVersion', 'Vehicle', 'Route', 'TripSchedule', 'RatePlan',
  'RoomUnit', 'RoomType', 'HotelProperty', 'RoomNightInventory',
  'CompanyEmployee', 'Listing', 'Room', 'Airline', 'Aircraft',
  'FlightRoute', 'FlightFareFamily', 'FlightAncillary', 'VehicleClass',
  'TaxiServiceZone', 'TaxiFareRule', 'TaxiVehicle',
]);
const OPERATIONS_MODELS = new Set([...COMPANY_MODELS, 'Place']);
const SCOPE_MODELS = Object.freeze({
  admin: POLICY_MODELS,
  company: new Set([...COMPANY_MODELS, 'Notification']),
  employee: new Set([...COMPANY_MODELS, 'Notification']),
  driver: new Set([...COMPANY_MODELS, 'Notification']),
  operations: OPERATIONS_MODELS,
  content: new Set(['BlogPost']),
  support: new Set(['Notification']),
  finance: new Set(),
  customer: new Set(['Notification']),
  promoter: new Set(['PromoterLink', 'Notification']),
});

const MODEL_LABELS = Object.freeze({
  BlogPost: 'Blog post',
  CompanyPolicy: 'Company policy',
  Notification: 'Notification',
  CompanyBranch: 'Company branch',
  PromoterLink: 'Promoter link',
  ServiceAddon: 'Service add-on',
  BusSegmentFare: 'Stop-to-stop fare',
  FareProduct: 'Fare product',
  RouteStop: 'Route stop',
  RouteSegment: 'Route segment',
  SeatMapTemplate: 'Seat-map template',
  SeatMapVersion: 'Seat-map version',
  Vehicle: 'Vehicle',
  Route: 'Route',
  TripSchedule: 'Departure',
  RatePlan: 'Rate plan',
  RoomUnit: 'Room unit',
  RoomType: 'Room type',
  HotelProperty: 'Hotel property',
  RoomNightInventory: 'Room-night inventory',
  CompanyEmployee: 'Staff record',
  Listing: 'Listing',
  Room: 'Room',
  Airline: 'Airline',
  Aircraft: 'Aircraft',
  FlightRoute: 'Flight route',
  FlightFareFamily: 'Flight fare family',
  FlightAncillary: 'Flight add-on',
  VehicleClass: 'Vehicle class',
  TaxiServiceZone: 'Service zone',
  TaxiFareRule: 'Taxi fare rule',
  TaxiVehicle: 'Taxi vehicle',
  Place: 'Place',
});

// Restored records always return to a non-public state. Models that only support
// active/archived, or whose children must be restored as a unit, remain visible
// in Archive but intentionally do not expose a generic restore action.
const RESTORE_TARGETS = Object.freeze({
  BlogPost: { status: 'draft' },
  CompanyPolicy: { status: 'paused' },
  Notification: { status: 'read' },
  CompanyBranch: { status: 'paused' },
  PromoterLink: { status: 'active' },
  ServiceAddon: { status: 'draft' },
  BusSegmentFare: { status: 'paused' },
  FareProduct: { status: 'draft' },
  SeatMapTemplate: { status: 'draft' },
  Vehicle: { status: 'paused' },
  TripSchedule: { status: 'draft' },
  RatePlan: { status: 'paused' },
  RoomUnit: { status: 'maintenance', housekeepingStatus: 'maintenance' },
  RoomType: { status: 'paused' },
  HotelProperty: { status: 'paused' },
  Listing: {
    status: 'draft',
    releaseStatus: 'draft',
    bookable: false,
    publishedAt: null,
  },
  Airline: { status: 'draft' },
  Aircraft: { status: 'draft' },
  FlightRoute: { status: 'draft' },
  FlightFareFamily: { status: 'draft' },
  FlightAncillary: { status: 'paused' },
  VehicleClass: { status: 'paused' },
  TaxiServiceZone: { status: 'paused' },
  TaxiFareRule: { status: 'paused' },
  TaxiVehicle: { operationalStatus: 'offline' },
  Place: { status: 'paused' },
});

const READ_CONCURRENCY = 4;
const PER_MODEL_LIMIT = 40;
const TOTAL_LIMIT = 300;

function loadModel(name) {
  if (!POLICY_MODELS.has(name)) return null;
  require(`../../models/${name}`);
  return mongoose.model(name);
}

function archivedFilter() {
  return { $or: [{ status: 'archived' }, { operationalStatus: 'archived' }] };
}

function scopeFilter(scope, modelName, context = {}) {
  if (['admin', 'operations', 'content', 'support', 'finance'].includes(scope)) return {};
  if (['company', 'employee', 'driver'].includes(scope)) {
    const companyId = String(context.companyId || '').trim();
    if (!companyId) return null;
    if (modelName === 'Notification') {
      return { ownerType: 'company', ownerId: companyId };
    }
    return { companyId };
  }
  if (scope === 'customer' && modelName === 'Notification') {
    const customerId = String(context.customerId || '').trim();
    if (!customerId) return null;
    return {
      $or: [
        { userId: customerId },
        { ownerType: 'customer', ownerId: customerId },
      ],
    };
  }
  if (scope === 'promoter') {
    const promoterId = String(context.promoterId || '').trim();
    if (!promoterId) return null;
    if (modelName === 'PromoterLink') return { promoterId };
    if (modelName === 'Notification') {
      return {
        $or: [
          { userId: promoterId },
          { ownerType: 'promoter', ownerId: promoterId },
        ],
      };
    }
  }
  return null;
}

function identityFilter(value) {
  const key = String(value || '').trim();
  const clauses = [{ id: key }];
  if (mongoose.isValidObjectId(key)) clauses.push({ _id: key });
  return { $or: clauses };
}

function combinedFilter(scope, modelName, context, extra = {}) {
  const scoped = scopeFilter(scope, modelName, context);
  if (scoped === null) return null;
  return {
    $and: [
      archivedFilter(),
      scoped,
      extra,
    ],
  };
}

function firstText(row, fields) {
  for (const field of fields) {
    const value = row?.[field];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).replace(/\s+/g, ' ').trim();
    }
  }
  return '';
}

function recordName(row, modelName) {
  if (modelName === 'Route') {
    return firstText(row, ['routeName']) || `${row.origin || 'Origin'} → ${row.destination || 'Destination'}`;
  }
  if (modelName === 'RouteStop') return firstText(row, ['name']) || `Stop ${row.stopOrder || ''}`.trim();
  if (modelName === 'BusSegmentFare') {
    return `${row.fromStopName || 'Origin'} → ${row.toStopName || 'Destination'}`;
  }
  if (modelName === 'TripSchedule') {
    return firstText(row, ['vehicleName', 'routeName']) || 'Scheduled departure';
  }
  if (modelName === 'TaxiVehicle') {
    return [row.registrationNumber, row.make, row.model].filter(Boolean).join(' · ');
  }
  return firstText(row, [
    'title', 'name', 'routeName', 'propertyName', 'unitNumber',
    'registrationNumber', 'code', 'subject', 'message', 'description',
    'slug', 'id',
  ]) || MODEL_LABELS[modelName] || modelName;
}

function archiveDate(row) {
  return row.archivedAt || row.updatedAt || row.createdAt || new Date();
}

function purgeDate(row) {
  if (row.retentionHold) return null;
  if (row.purgeAfter) return new Date(row.purgeAfter);
  return new Date(new Date(archiveDate(row)).getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

function canRestore(scope, modelName) {
  if (!RESTORE_TARGETS[modelName]) return false;
  if (['employee', 'driver', 'finance'].includes(scope)) return false;
  return Boolean(SCOPE_MODELS[scope]?.has(modelName));
}

function toArchiveRow(row, modelName, scope, now = new Date()) {
  const archivedAt = new Date(archiveDate(row));
  const purgeAfter = purgeDate(row);
  const daysRemaining = purgeAfter
    ? Math.max(0, Math.ceil((purgeAfter.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
    : null;
  return {
    id: String(row.id || row._id || ''),
    model: modelName,
    type: MODEL_LABELS[modelName] || modelName,
    name: recordName(row, modelName).slice(0, 180),
    archivedAt,
    archivedBy: String(row.archivedBy || ''),
    purgeAfter,
    daysRemaining,
    retentionHold: Boolean(row.retentionHold),
    retentionHoldReason: String(row.retentionHoldReason || ''),
    restoreAllowed: canRestore(scope, modelName),
    restoreTarget: RESTORE_TARGETS[modelName]?.operationalStatus
      || RESTORE_TARGETS[modelName]?.status
      || '',
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      // eslint-disable-next-line no-await-in-loop
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  ));
  return results;
}

async function listForDashboard(scope, context = {}) {
  const allowed = SCOPE_MODELS[scope] || new Set();
  const modelNames = [...allowed].filter((name) => POLICY_MODELS.has(name));
  if (!modelNames.length) return [];
  const now = new Date();
  const groups = await mapWithConcurrency(modelNames, READ_CONCURRENCY, async (modelName) => {
    const filter = combinedFilter(scope, modelName, context);
    if (!filter) return [];
    const Model = loadModel(modelName);
    const rows = await Model.find(filter)
      .sort({ archivedAt: -1, updatedAt: -1 })
      .limit(PER_MODEL_LIMIT)
      .lean();
    return rows.map((row) => toArchiveRow(row, modelName, scope, now));
  });
  return groups.flat()
    .sort((a, b) => b.archivedAt.getTime() - a.archivedAt.getTime())
    .slice(0, TOTAL_LIMIT);
}

async function restore({ scope, modelName, recordId, context = {}, actor = {} }) {
  if (!POLICY_MODELS.has(modelName) || !SCOPE_MODELS[scope]?.has(modelName)) {
    const error = new Error('This archived record type is not available in this dashboard');
    error.status = 404;
    throw error;
  }
  if (!canRestore(scope, modelName)) {
    const error = new Error('This archived record cannot be restored automatically');
    error.status = 403;
    throw error;
  }
  const filter = combinedFilter(scope, modelName, context, identityFilter(recordId));
  if (!filter) {
    const error = new Error('Archive scope is missing');
    error.status = 403;
    throw error;
  }
  const Model = loadModel(modelName);
  const row = await Model.findOne(filter).lean();
  if (!row) {
    const error = new Error('Archived record not found in this dashboard');
    error.status = 404;
    throw error;
  }
  const target = RESTORE_TARGETS[modelName];
  await Model.updateOne(filter, {
    $set: {
      ...target,
      updatedBy: String(actor.id || ''),
    },
  });
  const auditId = await nextId('audit');
  await platformRepository.auditLogs.save({
    id: auditId,
    actorId: String(actor.id || 'system'),
    actorRole: String(actor.role || ''),
    action: 'archive.record.restored',
    entityType: modelName,
    entityId: String(row.id || row._id || ''),
    targetType: modelName,
    targetId: String(row.id || row._id || ''),
    target: String(row.id || row._id || ''),
    metadata: {
      archiveScope: scope,
      restoredTo: target.operationalStatus || target.status || '',
      companyId: context.companyId || '',
    },
    status: 'success',
    createdAt: new Date().toISOString(),
  }, { id: auditId });
  return toArchiveRow(row, modelName, scope);
}

module.exports = {
  listForDashboard,
  restore,
  MODEL_LABELS,
  RESTORE_TARGETS,
  SCOPE_MODELS,
};
