const repositories = require('../../repositories');
const store = require('../data/persistentStore');

function cleanLimit(value, fallback = 50, max = 500) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.floor(number), max);
}

async function listEntity(entity, filter = {}, options = {}) {
  const repo = repositories[entity];
  if (repo?.isReady?.()) {
    return repo.list(filter, { sort: options.sort || { createdAt: -1 }, limit: cleanLimit(options.limit, 100), skip: Number(options.skip || 0) });
  }
  const rows = Array.isArray(store.state[entity]) ? store.state[entity] : [];
  return rows.slice(Number(options.skip || 0), Number(options.skip || 0) + cleanLimit(options.limit, 100));
}

async function countEntity(entity, filter = {}) {
  const repo = repositories[entity];
  if (repo?.isReady?.()) return repo.count(filter);
  const rows = Array.isArray(store.state[entity]) ? store.state[entity] : [];
  return rows.filter((row) => Object.entries(filter).every(([key, value]) => row[key] === value)).length;
}


function hasRows(value) {
  return Array.isArray(value) && value.length > 0;
}

function hasUsefulObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
}

function mergeDashboardPayload(base = {}, overrides = {}) {
  const merged = { ...(base || {}) };
  Object.entries(overrides || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      if (value.length > 0) merged[key] = value;
      return;
    }
    if (hasUsefulObject(value)) {
      const current = merged[key];
      merged[key] = hasUsefulObject(current) ? { ...current, ...value } : value;
      return;
    }
    if (value !== undefined && value !== null && value !== '') merged[key] = value;
  });
  return merged;
}

function ensureLocalReadModelFallback() {
  const hasCoreRows = ['companies', 'users', 'listings'].some((key) => Array.isArray(store.state[key]) && store.state[key].length > 0);
  if (hasCoreRows) return;
  const isProduction = process.env.NODE_ENV === 'production';
  const allowSeedFallback = !isProduction || ['true', '1', 'yes'].includes(String(process.env.SEED_READ_MODEL || '').toLowerCase());
  if (!allowSeedFallback) return;
  try { store.loadSeedReadModel({ force: true }); } catch (error) { /* dashboard fallback is best-effort */ }
}

async function roleDashboard(role, context = {}) {
  ensureLocalReadModelFallback();

  // The dashboard EJS/JS renderers expect formatted table-row arrays from
  // persistentStore.dashboardData(). Returning raw Mongo documents here caused
  // blank tables and repeated fallback text because the client renderer could
  // not treat objects as table rows. MongoDB is still hydrated into the read
  // model by app.js/server.js; this function should return the formatted read
  // model only.
  const dataRole = ['support', 'finance', 'operations'].includes(role) ? 'admin' : role;
  return store.dashboardData(dataRole, context);
}

module.exports = { listEntity, countEntity, roleDashboard };
