const { mongoose } = require('../config/db');

function mongoReady() {
  return mongoose.connection.readyState === 1;
}

function clean(row) {
  if (!row) return row;
  const plain = typeof row.toObject === 'function' ? row.toObject() : { ...row };
  if (!plain.id && plain._id) plain.id = String(plain._id);
  delete plain._id;
  delete plain.__v;
  return plain;
}

class MongoRepository {
  constructor({ entity, modelName, defaultFilter = (row) => ({ id: row.id }) }) {
    this.entity = entity;
    this.modelName = modelName;
    this.defaultFilter = defaultFilter;
  }

  get Model() {
    require(`../models/${this.modelName}`);
    return mongoose.model(this.modelName);
  }

  isReady() {
    return mongoReady();
  }

  async list(filter = {}, options = {}) {
    if (!this.isReady()) return [];
    let query = this.Model.find(filter);
    if (options.sort) query = query.sort(options.sort);
    if (options.limit) query = query.limit(options.limit);
    if (options.skip) query = query.skip(options.skip);
    return (await query.lean()).map(clean);
  }

  async findOne(filter = {}) {
    if (!this.isReady()) return null;
    return clean(await this.Model.findOne(filter).lean());
  }

  async count(filter = {}) {
    if (!this.isReady()) return 0;
    return this.Model.countDocuments(filter);
  }

  async upsert(row, filter = null) {
    if (!this.isReady() || !row) return row;
    const resolvedFilter = filter || this.defaultFilter(row);
    await this.Model.updateOne(resolvedFilter, { $set: row }, { upsert: true, runValidators: true });
    return row;
  }

  async upsertMany(rows = [], filterFor = null) {
    if (!this.isReady() || !rows.length) return rows;
    await this.Model.bulkWrite(rows.map((row) => ({
      updateOne: {
        filter: filterFor ? filterFor(row) : this.defaultFilter(row),
        update: { $set: row },
        upsert: true,
      },
    })));
    return rows;
  }

  async insertMany(rows = [], options = { ordered: false }) {
    if (!this.isReady() || !rows.length) return rows;
    await this.Model.insertMany(rows, options);
    return rows;
  }

  async updateOne(filter, update, options = {}) {
    if (!this.isReady()) return null;
    return this.Model.updateOne(filter, update, options);
  }

  async updateMany(filter, update, options = {}) {
    if (!this.isReady()) return null;
    return this.Model.updateMany(filter, update, options);
  }

  async findOneAndUpdate(filter, update, options = { new: true }) {
    if (!this.isReady()) return null;
    return clean(await this.Model.findOneAndUpdate(filter, update, options).lean());
  }

  async deleteMany(filter = {}) {
    if (!this.isReady()) return null;
    return this.Model.deleteMany(filter);
  }
}

module.exports = { MongoRepository, mongoReady, clean };
