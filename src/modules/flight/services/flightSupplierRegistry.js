'use strict';

const { conflictError, assertActiveSupplier } = require('../domain/flightDomain');

const adapters = new Map();

function registerSupplierAdapter(key, adapter = {}) {
  const cleanKey = String(key || '').trim();
  if (!cleanKey) throw new Error('Flight supplier adapter key is required');
  adapters.set(cleanKey, Object.freeze({ ...adapter }));
  return adapters.get(cleanKey);
}

function adapterFor(supplier = {}, capability = '') {
  assertActiveSupplier(supplier, capability);
  if (supplier.mode === 'native_inventory') return null;
  if (supplier.mode === 'referral_only') {
    throw conflictError('This flight is referral-only and cannot be ticketed inside Classic Trip', 'referral_only_offer');
  }
  const adapter = adapters.get(String(supplier.adapterKey || '').trim());
  if (!adapter || typeof adapter[capability] !== 'function') {
    throw conflictError(`Certified flight supplier adapter is unavailable for ${capability}`, 'supplier_adapter_unavailable');
  }
  return adapter;
}

function registeredAdapters() {
  return Array.from(adapters.keys());
}

module.exports = { registerSupplierAdapter, adapterFor, registeredAdapters };
