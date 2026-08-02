'use strict';

const IGNORED_OPTION_KEYS = new Set(['background']);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}

function stableStringify(value) {
  return JSON.stringify(canonical(value));
}

function generatedIndexName(key) {
  return Object.entries(key)
    .map(([field, direction]) => `${field}_${direction}`)
    .join('_');
}

function desiredDescriptor(key, options = {}) {
  const textWeights = {};
  const regularKey = {};

  for (const [field, direction] of Object.entries(key)) {
    if (direction === 'text') textWeights[field] = Number(options.weights?.[field] || 1);
    else regularKey[field] = direction;
  }

  const isText = Object.keys(textWeights).length > 0;
  return {
    key,
    regularKey,
    isText,
    textWeights,
    name: options.name || generatedIndexName(key),
    options: { ...options },
  };
}

function existingDescriptor(index = {}) {
  const textWeights = index.weights || {};
  const isText = Boolean(Object.keys(textWeights).length || index.key?._fts === 'text');
  const regularKey = {};

  for (const [field, direction] of Object.entries(index.key || {})) {
    if (field !== '_fts' && field !== '_ftsx') regularKey[field] = direction;
  }

  return {
    key: index.key || {},
    regularKey,
    isText,
    textWeights,
    name: index.name,
    options: index,
  };
}

function relevantOptions(options = {}, isText = false) {
  const result = {};
  for (const key of ['unique', 'sparse', 'expireAfterSeconds', 'partialFilterExpression', 'collation']) {
    if (options[key] !== undefined) result[key] = options[key];
  }

  if (isText) {
    result.default_language = options.default_language || 'english';
    result.language_override = options.language_override || 'language';
  }

  return result;
}

function equivalentIndex(desired, existing) {
  if (desired.isText !== existing.isText) return false;

  if (desired.isText) {
    if (stableStringify(desired.textWeights) !== stableStringify(existing.textWeights)) return false;
    if (stableStringify(desired.regularKey) !== stableStringify(existing.regularKey)) return false;
  } else if (stableStringify(desired.key) !== stableStringify(existing.key)) {
    return false;
  }

  return stableStringify(relevantOptions(desired.options, desired.isText))
    === stableStringify(relevantOptions(existing.options, existing.isText));
}

function conflictingIndexes(desired, existingIndexes) {
  return existingIndexes
    .map(existingDescriptor)
    .filter((existing) => {
      if (existing.name === '_id_') return false;
      if (equivalentIndex(desired, existing)) return false;
      if (existing.name === desired.name) return true;
      if (desired.isText && existing.isText) return true;
      return !desired.isText
        && !existing.isText
        && stableStringify(desired.key) === stableStringify(existing.key);
    });
}

function cleanCreateOptions(options = {}) {
  const cleaned = {};
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined || IGNORED_OPTION_KEYS.has(key)) continue;
    cleaned[key] = value;
  }
  return cleaned;
}

async function listIndexes(collection) {
  try {
    return await collection.indexes();
  } catch (error) {
    if (error?.code === 26 || error?.codeName === 'NamespaceNotFound') return [];
    throw error;
  }
}

async function assertUniqueIndexCanBeCreated(collection, desired) {
  if (!desired.options.unique || desired.isText) return;

  const fields = Object.keys(desired.key);
  if (fields.length !== 1) return;

  const field = fields[0];
  const match = desired.options.sparse
    ? { [field]: { $exists: true, $ne: null } }
    : {};
  const duplicates = await collection.aggregate([
    { $match: match },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 5 },
  ]).toArray();

  if (!duplicates.length) return;

  const examples = duplicates.map((item) => JSON.stringify(item._id)).join(', ');
  throw new Error(
    `cannot create unique index ${desired.name}; duplicate ${field} values exist (${examples}). `
      + 'Resolve those duplicates and rerun npm run db:indexes.',
  );
}

async function reconcileModelIndexes(Model, { dryRun = false, logger = console } = {}) {
  const desiredIndexes = Model.schema.indexes().map(([key, options]) => desiredDescriptor(key, options));
  let existingIndexes = await listIndexes(Model.collection);
  let verified = 0;
  let created = 0;
  let dropped = 0;

  for (const desired of desiredIndexes) {
    const equivalent = existingIndexes
      .map(existingDescriptor)
      .find((existing) => equivalentIndex(desired, existing));

    if (equivalent) {
      verified += 1;
      continue;
    }

    const conflicts = conflictingIndexes(desired, existingIndexes);
    await assertUniqueIndexCanBeCreated(Model.collection, desired);

    for (const conflict of conflicts) {
      logger.log(`${dryRun ? '• Would replace' : '↻ Replacing'} ${Model.modelName}.${conflict.name} -> ${desired.name}`);
      if (!dryRun) await Model.collection.dropIndex(conflict.name);
      dropped += 1;
    }

    if (dryRun) {
      logger.log(`• Would create ${Model.modelName}.${desired.name}`);
    } else {
      await Model.collection.createIndex(desired.key, cleanCreateOptions({ ...desired.options, name: desired.name }));
    }
    created += 1;
    existingIndexes = await listIndexes(Model.collection);
  }

  return { verified, created, dropped, total: desiredIndexes.length };
}

module.exports = {
  cleanCreateOptions,
  conflictingIndexes,
  desiredDescriptor,
  equivalentIndex,
  existingDescriptor,
  generatedIndexName,
  reconcileModelIndexes,
  relevantOptions,
  stableStringify,
};
