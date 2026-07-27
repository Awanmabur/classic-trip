'use strict';
const mongoose = require('mongoose');
const User = require('../../src/models/User');
const { MongoRepository } = require('../../src/repositories/mongoRepository');
const { ACTIVE_SERVICE_TYPES, COMING_SOON_SERVICE_TYPES, serviceDefinition } = require('../../src/config/serviceRegistry');

describe('MongoDB user identity contract', () => {
  const repository = new MongoRepository({ entity: 'users', modelName: 'User', objectIdIdentity: true });
  const id = new mongoose.Types.ObjectId().toString();

  test('User schema relies on MongoDB _id only', () => {
    expect(User.schema.path('_id')).toBeDefined();
    expect(User.schema.path('id')).toBeUndefined();
  });

  test('repository translates runtime id filters to _id', () => {
    expect(repository.normalizeFilter({ id })).toEqual({ _id: id });
    expect(repository.normalizeFilter({ $or: [{ id: 'not-an-object-id' }, { email: 'owner@example.com' }] }))
      .toEqual({ $or: [{ _id: null }, { email: 'owner@example.com' }] });
  });

  test('repository never writes runtime id alias back into User documents', () => {
    expect(repository.prepareRow({ id, fullName: 'Owner' })).toEqual({ fullName: 'Owner' });
    expect(repository.prepareUpdate({ $set: { id, fullName: 'Owner' } })).toEqual({ $set: { fullName: 'Owner' } });
  });
});

describe('service roadmap contract', () => {
  test('all completed marketplace verticals are operational', () => {
    expect(ACTIVE_SERVICE_TYPES).toEqual(['bus', 'hotel', 'flight', 'local_transport', 'tour', 'car_rental', 'cargo']);
  });

  test('there are no placeholder-only marketplace categories', () => {
    expect(COMING_SOON_SERVICE_TYPES).toEqual([]);
    expect(serviceDefinition('cargo')).toMatchObject({ status: 'active', bookable: true });
  });
});
