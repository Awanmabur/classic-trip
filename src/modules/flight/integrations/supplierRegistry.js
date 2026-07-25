'use strict';

const EXTERNAL_SUPPLIER_TYPES = Object.freeze(['airline_api', 'ndc', 'gds', 'consolidator']);
const REQUIRED_ADAPTER_METHODS = Object.freeze(['verifyOffer', 'holdOffer', 'confirmOrder', 'releaseHold', 'refundOrder']);
const adapters = new Map();

function normalizeSupplierType(value = 'native') {
  return String(value || 'native').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function supplierError(message, code = 'flight_supplier_unavailable', status = 503) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function validateAdapter(type, adapter) {
  if (!EXTERNAL_SUPPLIER_TYPES.includes(type)) {
    throw supplierError(`Unsupported external flight supplier type: ${type}`, 'flight_supplier_type_invalid', 422);
  }
  if (!adapter || typeof adapter !== 'object') {
    throw supplierError(`A ${type} flight supplier adapter object is required`, 'flight_supplier_adapter_invalid', 422);
  }
  const missing = REQUIRED_ADAPTER_METHODS.filter((method) => typeof adapter[method] !== 'function');
  if (missing.length) {
    throw supplierError(`Flight supplier adapter ${type} is missing: ${missing.join(', ')}`, 'flight_supplier_adapter_incomplete', 422);
  }
}

function registerSupplierAdapter(type, adapter) {
  const normalized = normalizeSupplierType(type);
  validateAdapter(normalized, adapter);
  adapters.set(normalized, Object.freeze({ ...adapter, supplierType: normalized }));
  return adapters.get(normalized);
}

function unregisterSupplierAdapter(type) {
  return adapters.delete(normalizeSupplierType(type));
}

function getSupplierAdapter(type) {
  const normalized = normalizeSupplierType(type);
  return normalized === 'native' ? null : adapters.get(normalized) || null;
}

function supplierIsAvailable(type) {
  const normalized = normalizeSupplierType(type);
  return normalized === 'native' || adapters.has(normalized);
}

function assertScheduleSupplierAvailable(schedule = {}) {
  const type = normalizeSupplierType(schedule.supplierType);
  if (type === 'native') return { supplierType: type, adapter: null };
  if (!EXTERNAL_SUPPLIER_TYPES.includes(type)) {
    throw supplierError('Flight schedule has an unsupported supplier type', 'flight_supplier_type_invalid', 409);
  }
  const adapter = adapters.get(type);
  if (!adapter) {
    throw supplierError('This supplier flight is temporarily unavailable because its certified integration is not active. No payment has been taken.');
  }
  return { supplierType: type, adapter };
}

function registeredSupplierTypes() {
  return ['native', ...Array.from(adapters.keys()).sort()];
}

module.exports = {
  EXTERNAL_SUPPLIER_TYPES,
  REQUIRED_ADAPTER_METHODS,
  normalizeSupplierType,
  registerSupplierAdapter,
  unregisterSupplierAdapter,
  getSupplierAdapter,
  supplierIsAvailable,
  assertScheduleSupplierAvailable,
  registeredSupplierTypes,
};
