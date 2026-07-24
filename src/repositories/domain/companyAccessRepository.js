const { MongoCollection } = require('./mongoCollection');

module.exports = {
  companies: new MongoCollection('companies'),
  listings: new MongoCollection('listings'),
  routes: new MongoCollection('routes'),
  schedules: new MongoCollection('schedules'),
  vehicles: new MongoCollection('vehicles'),
  bookings: new MongoCollection('bookings'),
  hotelProperties: new MongoCollection('hotelProperties'),
  roomTypes: new MongoCollection('roomTypes'),
  roomUnits: new MongoCollection('roomUnits'),
  roomNightInventories: new MongoCollection('roomNightInventories'),
};
