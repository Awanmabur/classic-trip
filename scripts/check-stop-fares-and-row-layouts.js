'use strict';

const assert = require('assert');
const { buildSeatDefinitions, calculateFare } = require('../src/modules/bus/domain/busDomain');

const segments = [
  { id:'s1', fromOrder:1, toOrder:2, segmentOrder:0, distanceKm:100 },
  { id:'s2', fromOrder:2, toOrder:3, segmentOrder:1, distanceKm:200 },
  { id:'s3', fromOrder:3, toOrder:4, segmentOrder:2, distanceKm:300 },
];
const fullFare = [{ id:'full', fromStopId:'a', toStopId:'d', fromOrder:1, toOrder:4, amount:60000, status:'active' }];
const partialRange = { originOrder:1, destinationOrder:3, segmentCount:2 };
const partial = calculateFare({ fares:fullFare, originStopId:'a', destinationStopId:'c', segments, range:partialRange });
assert.strictEqual(partial.amount, 30000);
assert.strictEqual(partial.source, 'distance_prorated_full_route');

const exact = calculateFare({
  fares:[...fullFare, { id:'exact', fromStopId:'a', toStopId:'c', fromOrder:1, toOrder:3, amount:27000, status:'active' }],
  originStopId:'a',
  destinationStopId:'c',
  segments,
  range:partialRange,
});
assert.strictEqual(exact.amount, 27000);
assert.strictEqual(exact.source, 'exact');

const layout = buildSeatDefinitions({
  layoutName:'2x3',
  totalSeats:10,
  rows:3,
  numberingStartSide:'right',
  rowLayoutOverrides:'1:1+1, 3:2+1',
});
assert.deepStrictEqual(layout.rowLayoutOverrides, [
  { row:1, leftSeats:1, rightSeats:1 },
  { row:3, leftSeats:2, rightSeats:1 },
]);
assert.strictEqual(layout.seats.filter((seat) => seat.row === 1 && seat.side === 'left').length, 1);
assert.strictEqual(layout.seats.filter((seat) => seat.row === 1 && seat.side === 'right').length, 1);
assert.strictEqual(layout.seats[0].side, 'right');
assert.strictEqual(layout.seats.filter((seat) => seat.row === 2 && seat.side === 'left').length, 2);
assert.strictEqual(layout.seats.filter((seat) => seat.row === 2 && seat.side === 'right').length, 3);

const front = buildSeatDefinitions({
  layoutName:'3x2',
  totalSeats:6,
  rows:2,
  driverPosition:'left',
  frontRowPassengerSeats:1,
});
assert.strictEqual(front.seats[0].row, 1);
assert.strictEqual(front.seats[0].side, 'right');

console.log('Stop fare and row layout checks passed.');
