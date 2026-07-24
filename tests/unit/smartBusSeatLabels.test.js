'use strict';

const { buildSeatDefinitions, parseDurationMinutes } = require('../../src/modules/bus/domain/busDomain');

describe('smart bus seat maps', () => {
  test('automatic numbering does not require manual labels', () => {
    const map = buildSeatDefinitions({ totalSeats:48, rows:12, columns:4, layoutName:'2x2', labelMode:'automatic' });
    expect(map.seats).toHaveLength(48);
    expect(map.seats[0].seatNumber).toBe('1');
    expect(map.seats[47].seatNumber).toBe('48');
  });

  test('custom numbering requires one unique label for every seat', () => {
    expect(() => buildSeatDefinitions({ totalSeats:4, rows:1, columns:4, labelMode:'custom', labels:['A1','A2'] })).toThrow(/exactly 4 unique labels/i);
    expect(() => buildSeatDefinitions({ totalSeats:4, rows:1, columns:4, labelMode:'custom', labels:['A1','A1','A3','A4'] })).toThrow(/unique/i);
  });

  test('row-position and prefix modes are generated consistently', () => {
    expect(buildSeatDefinitions({ totalSeats:4, rows:1, columns:4, labelMode:'row_letters' }).seats.map(seat => seat.seatNumber)).toEqual(['A1','A2','A3','A4']);
    expect(buildSeatDefinitions({ totalSeats:3, rows:1, columns:3, labelMode:'prefix_numeric', labelPrefix:'S' }).seats.map(seat => seat.seatNumber)).toEqual(['S1','S2','S3']);
  });

  test('special-seat lists must reference the generated map', () => {
    expect(() => buildSeatDefinitions({ totalSeats:3, rows:1, columns:3, labelMode:'automatic', vipSeats:['9'] })).toThrow(/not in this seat map/i);
  });


  test('custom labels support common delimiters and reject category conflicts', () => {
    expect(buildSeatDefinitions({ totalSeats:3, rows:1, columns:3, labelMode:'custom', labels:'A;B;C' }).seats.map(seat => seat.seatNumber)).toEqual(['A','B','C']);
    expect(() => buildSeatDefinitions({ totalSeats:3, rows:1, columns:3, labelMode:'automatic', vipSeats:['1'], crewSeats:['1'] })).toThrow(/Crew-only seats/i);
    expect(() => buildSeatDefinitions({ totalSeats:3, rows:1, columns:3, labelMode:'automatic', accessibleSeats:['2'], disabledSeats:['2'] })).toThrow(/Non-sellable spaces/i);
  });

  test('human duration values become schedule minutes', () => {
    expect(parseDurationMinutes('12h 30m')).toBe(750);
  });
});
