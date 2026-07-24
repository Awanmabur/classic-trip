'use strict';

const repositories = require('..');

function unavailable(entity) {
  const error = new Error(`MongoDB is unavailable; '${entity}' cannot be read or written`);
  error.status = 503;
  error.code = 'mongodb_unavailable';
  return error;
}

class MongoCollection {
  constructor(entity) {
    this.entity = entity;
    this.repository = repositories.repositoryFor(entity);
  }

  assertReady() {
    if (!repositories.mongoReady()) throw unavailable(this.entity);
  }

  async list(filter = {}, options = {}) {
    this.assertReady();
    return this.repository.list(filter, options);
  }

  async findOne(filter = {}, options = {}) {
    this.assertReady();
    return this.repository.findOne(filter, options);
  }

  async count(filter = {}, options = {}) {
    this.assertReady();
    return this.repository.count(filter, options);
  }

  async insert(row, options = {}) {
    this.assertReady();
    return this.repository.insert(row, options);
  }

  async save(row, filter = null, options = {}) {
    this.assertReady();
    return this.repository.upsert(row, filter, options);
  }

  async saveMany(rows = [], filterFor = null, options = {}) {
    this.assertReady();
    return this.repository.upsertMany(rows, filterFor, options);
  }

  async updateOne(filter, update, options = {}) {
    this.assertReady();
    return this.repository.updateOne(filter, update, options);
  }

  async updateMany(filter, update, options = {}) {
    this.assertReady();
    return this.repository.updateMany(filter, update, options);
  }

  async deleteOne(filter = {}, options = {}) {
    this.assertReady();
    const existing = await this.repository.findOne(filter, options);
    if (!existing) return null;
    await this.repository.Model.deleteOne(this.repository.normalizeFilter(filter), options);
    return existing;
  }

  async deleteMany(filter = {}, options = {}) {
    this.assertReady();
    const existing = await this.repository.list(filter, options);
    await this.repository.deleteMany(filter, options);
    return existing;
  }

  async refresh(filter = {}, options = {}) {
    return this.list(filter, options);
  }

}

module.exports = { MongoCollection };
