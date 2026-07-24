const Booking = require('../../src/models/Booking');
const Route = require('../../src/models/Route');
const RouteStop = require('../../src/models/RouteStop');
const RouteSegment = require('../../src/models/RouteSegment');
const Vehicle = require('../../src/models/Vehicle');
const SeatMapTemplate = require('../../src/models/SeatMapTemplate');
const SeatMapVersion = require('../../src/models/SeatMapVersion');
const TripSchedule = require('../../src/models/TripSchedule');
const BusSeatSegmentInventory = require('../../src/models/BusSeatSegmentInventory');
const FareProduct = require('../../src/models/FareProduct');
const BusSegmentFare = require('../../src/models/BusSegmentFare');
const BookingItem = require('../../src/models/BookingItem');
const BusReservation = require('../../src/models/BusReservation');
const BusSeatAssignment = require('../../src/models/BusSeatAssignment');
const BusTicket = require('../../src/models/BusTicket');

beforeAll(() => {
  process.env.NODE_ENV = 'test';
});

test('all canonical bus models load without runtime reference errors', () => {
  [Booking, Route, RouteStop, RouteSegment, Vehicle, SeatMapTemplate, SeatMapVersion,
    TripSchedule, BusSeatSegmentInventory, FareProduct, BusSegmentFare, BookingItem,
    BusReservation, BusSeatAssignment, BusTicket].forEach((Model) => expect(Model.modelName).toBeTruthy());
});

test('routes use ordered stop and segment entities instead of embedded arrays', () => {
  expect(Route.schema.path('stops')).toBeUndefined();
  expect(RouteStop.schema.path('routeId')).toBeDefined();
  expect(RouteStop.schema.path('stopOrder')).toBeDefined();
  expect(RouteSegment.schema.path('fromStopId')).toBeDefined();
  expect(RouteSegment.schema.path('toStopId')).toBeDefined();
  expect(RouteSegment.schema.path('segmentOrder')).toBeDefined();
});

test('versioned seat maps are authoritative and dated inventory is route-segment aware', () => {
  expect(Vehicle.schema.path('activeSeatMapTemplateId')).toBeDefined();
  expect(Vehicle.schema.path('activeSeatMapVersionId')).toBeDefined();
  expect(Vehicle.schema.path('seatTemplate')).toBeDefined(); // dashboard-only compatibility projection
  expect(Vehicle.schema.path('seats')).toBeUndefined();
  expect(SeatMapTemplate.schema.path('activeVersionId')).toBeDefined();
  expect(SeatMapVersion.schema.path('checksum')).toBeDefined();
  expect(TripSchedule.schema.path('seatMapVersionId')).toBeDefined();
  expect(BusSeatSegmentInventory.schema.path('scheduleId')).toBeDefined();
  expect(BusSeatSegmentInventory.schema.path('seatNumber')).toBeDefined();
  expect(BusSeatSegmentInventory.schema.path('segmentId')).toBeDefined();
});

test('fares are independent products with exact route-stop relationships', () => {
  expect(FareProduct.schema.path('routeId')).toBeDefined();
  expect(FareProduct.schema.path('currency')).toBeDefined();
  expect(BusSegmentFare.schema.path('fareProductId')).toBeDefined();
  expect(BusSegmentFare.schema.path('fromStopId')).toBeDefined();
  expect(BusSegmentFare.schema.path('toStopId')).toBeDefined();
  expect(TripSchedule.schema.path('fareProductId')).toBeDefined();
  expect(TripSchedule.schema.path('fareSnapshot')).toBeDefined();
});

test('booking, reservation, assignment, and ticket records are independently traceable', () => {
  expect(BookingItem.schema.path('bookingId')).toBeDefined();
  expect(BookingItem.schema.path('domainReservationId')).toBeDefined();
  expect(BusReservation.schema.path('bookingItemId')).toBeDefined();
  expect(BusReservation.schema.path('segmentIds')).toBeDefined();
  expect(BusSeatAssignment.schema.path('passengerId')).toBeDefined();
  expect(BusSeatAssignment.schema.path('seatNumber')).toBeDefined();
  expect(BusTicket.schema.path('seatAssignmentId')).toBeDefined();
  expect(BusTicket.schema.path('qrTokenHash')).toBeDefined();
});

test('booking traveler snapshots remain structured while Passenger is the operational projection', () => {
  const passengers = Booking.schema.path('passengers');
  expect(passengers).toBeDefined();
  expect(passengers.schema.path('fullName')).toBeDefined();
  expect(passengers.schema.path('seatOrRoom')).toBeDefined();
  expect(passengers.schema.path('scheduleId')).toBeDefined();
});

test('segment inventory uses canonical lifecycle states', () => {
  const allowed = BusSeatSegmentInventory.schema.path('status').enumValues;
  expect(allowed).toEqual(expect.arrayContaining(['available', 'held', 'booked', 'checked_in', 'no_show', 'cancelled', 'refunded']));
  expect(allowed).not.toEqual(expect.arrayContaining(['checked-in', 'no-show', 'taken', 'locked']));
});
