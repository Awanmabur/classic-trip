const { mongoose } = require('../config/db');

function mongoReady() {
  return mongoose.connection.readyState === 1;
}


function requireMongo(entity = 'repository') {
  if (mongoReady()) return;
  const error = new Error(`MongoDB is unavailable for ${entity}`);
  error.status = 503;
  error.code = 'mongodb_unavailable';
  error.publicMessage = 'The database connection is temporarily unavailable. Please restart the server and try again.';
  throw error;
}

function clean(row) {
  if (!row) return row;
  const plain = typeof row.toObject === 'function' ? row.toObject() : { ...row };
  if (!plain.id && plain._id) plain.id = String(plain._id);
  delete plain._id;
  delete plain.__v;
  return plain;
}

function impossibleObjectId() { return null; }

function normalizeObjectIdValue(value) {
  if (Array.isArray(value)) {
    const values = value.filter((item) => mongoose.isValidObjectId(item)).map(String);
    return values.length ? values : [impossibleObjectId()];
  }
  if (value && typeof value === 'object' && !(value instanceof mongoose.Types.ObjectId)) {
    const normalized = {};
    Object.entries(value).forEach(([operator, nested]) => {
      if (operator === '$exists') normalized[operator] = Boolean(nested);
      else normalized[operator] = normalizeObjectIdValue(nested);
    });
    return normalized;
  }
  if (value instanceof mongoose.Types.ObjectId) return value;
  return mongoose.isValidObjectId(value) ? String(value) : impossibleObjectId();
}

function normalizeIdentityFilter(filter, objectIdIdentity) {
  if (!objectIdIdentity || filter === null || filter === undefined) return filter;
  if (Array.isArray(filter)) return filter.map((item) => normalizeIdentityFilter(item, true));
  if (typeof filter !== 'object' || filter instanceof Date || filter instanceof mongoose.Types.ObjectId) return filter;
  const normalized = {};
  Object.entries(filter).forEach(([key, value]) => {
    if (key === 'id') normalized._id = normalizeObjectIdValue(value);
    else normalized[key] = normalizeIdentityFilter(value, true);
  });
  return normalized;
}

function prepareIdentityRow(row, objectIdIdentity, { insert = false } = {}) {
  if (!row || !objectIdIdentity) return row;
  const prepared = { ...row };
  if (insert && prepared._id === undefined && mongoose.isValidObjectId(prepared.id)) prepared._id = prepared.id;
  delete prepared.id;
  if (!insert) delete prepared._id;
  return prepared;
}

function prepareIdentityUpdate(update, objectIdIdentity) {
  if (!update || !objectIdIdentity) return update;
  const keys = Object.keys(update);
  if (!keys.some((key) => key.startsWith('$'))) return prepareIdentityRow(update, true);
  const prepared = { ...update };
  ['$set', '$setOnInsert'].forEach((operator) => {
    if (!prepared[operator] || typeof prepared[operator] !== 'object') return;
    prepared[operator] = { ...prepared[operator] };
    delete prepared[operator].id;
    delete prepared[operator]._id;
  });
  if (prepared.$unset && typeof prepared.$unset === 'object') {
    prepared.$unset = { ...prepared.$unset };
    delete prepared.$unset._id;
  }
  return prepared;
}

class MongoRepository {
  constructor({ entity, modelName, defaultFilter = (row) => ({ id: row.id }), objectIdIdentity = false }) {
    this.entity = entity;
    this.modelName = modelName;
    this.defaultFilter = defaultFilter;
    this.objectIdIdentity = objectIdIdentity;
  }

  normalizeFilter(filter = {}) { return normalizeIdentityFilter(filter, this.objectIdIdentity); }
  prepareRow(row, options = {}) { return prepareIdentityRow(row, this.objectIdIdentity, options); }
  prepareUpdate(update) { return prepareIdentityUpdate(update, this.objectIdIdentity); }

  get Model() {
    require(`../models/${this.modelName}`);
    return mongoose.model(this.modelName);
  }

  isReady() {
    return mongoReady();
  }

  assertReady() {
    requireMongo(this.entity);
    return this;
  }

  async list(filter = {}, options = {}) {
    requireMongo(this.entity);
    let query = this.Model.find(this.normalizeFilter(filter));
    if (options.session) query = query.session(options.session);
    if (options.sort) query = query.sort(options.sort);
    if (options.limit) query = query.limit(options.limit);
    if (options.skip) query = query.skip(options.skip);
    return (await query.lean()).map(clean);
  }

  async findOne(filter = {}, options = {}) {
    requireMongo(this.entity);
    let query = this.Model.findOne(this.normalizeFilter(filter));
    if (options.session) query = query.session(options.session);
    return clean(await query.lean());
  }

  async count(filter = {}, options = {}) {
    requireMongo(this.entity);
    let query = this.Model.countDocuments(this.normalizeFilter(filter));
    if (options.session) query = query.session(options.session);
    return query;
  }

  async insert(row, options = {}) {
    requireMongo(this.entity);
    if (!row) return row;
    const created = await this.Model.create([this.prepareRow(row, { insert: true })], options);
    return clean(created[0]);
  }

  async upsert(row, filter = null, options = {}) {
    requireMongo(this.entity);
    if (!row) return row;
    const resolvedFilter = this.normalizeFilter(filter || this.defaultFilter(row));
    await this.Model.updateOne(resolvedFilter, { $set: this.prepareRow(row) }, { upsert: true, runValidators: true, ...options });
    return row;
  }

  async upsertMany(rows = [], filterFor = null, options = {}) {
    requireMongo(this.entity);
    if (!rows.length) return rows;
    await this.Model.bulkWrite(rows.map((row) => ({
      updateOne: {
        filter: this.normalizeFilter(filterFor ? filterFor(row) : this.defaultFilter(row)),
        update: { $set: this.prepareRow(row) },
        upsert: true,
      },
    })), options);
    return rows;
  }

  async insertMany(rows = [], options = { ordered: false }) {
    requireMongo(this.entity);
    if (!rows.length) return rows;
    await this.Model.insertMany(rows.map((row) => this.prepareRow(row, { insert: true })), options);
    return rows;
  }

  async updateOne(filter, update, options = {}) {
    requireMongo(this.entity);
    return this.Model.updateOne(this.normalizeFilter(filter), this.prepareUpdate(update), { runValidators: true, ...options });
  }

  async updateMany(filter, update, options = {}) {
    requireMongo(this.entity);
    return this.Model.updateMany(this.normalizeFilter(filter), this.prepareUpdate(update), { runValidators: true, ...options });
  }

  async findOneAndUpdate(filter, update, options = { new: true }) {
    requireMongo(this.entity);
    return clean(await this.Model.findOneAndUpdate(this.normalizeFilter(filter), this.prepareUpdate(update), { new: true, runValidators: true, ...options }).lean());
  }

  async deleteMany(filter = {}) {
    requireMongo(this.entity);
    return this.Model.deleteMany(this.normalizeFilter(filter));
  }
}

module.exports = { MongoRepository, mongoReady, requireMongo, clean };
