'use strict';

const fs = require('fs');
const path = require('path');
const {
  startOfDay,
  matchingFutureDates,
  ROLLING_WINDOW_DAYS,
  HORIZON_DAYS,
  rollingWindowBounds,
} = require('../../src/jobs/materializeSchedules');

describe('rolling departure materializer lifecycle', () => {
  test('daily rules cover today plus the following 29 calendar days', () => {
    const now = new Date('2026-08-05T00:00:00');
    const horizon = startOfDay(new Date(now.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000));
    const dates = matchingFutureDates({ departureTime: '09:30', daysOfWeek: [] }, startOfDay(now), horizon, now);
    expect(ROLLING_WINDOW_DAYS).toBe(30);
    expect(HORIZON_DAYS).toBe(29);
    expect(dates).toHaveLength(30);
    expect(dates[0].getHours()).toBe(9);
    expect(dates[29].toISOString().slice(0, 10)).toBe('2026-09-03');
  });

  test('weekly rules materialize only their selected weekdays', () => {
    const now = new Date('2026-08-05T00:00:00');
    const horizon = new Date('2026-08-11T00:00:00');
    const dates = matchingFutureDates({ departureTime: '10:00', daysOfWeek: [5] }, startOfDay(now), horizon, now);
    expect(dates).toHaveLength(1);
    expect(dates[0].getDay()).toBe(5);
  });


  test('a departed daily date is replaced at the far edge immediately', () => {
    const now = new Date('2026-08-05T10:00:00');
    const horizon = startOfDay(new Date(now.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000));
    const rule = { startDate: '2026-08-01', departureTime: '09:30', daysOfWeek: [] };
    const bounds = rollingWindowBounds(rule, horizon, now);
    expect(bounds.replacedDepartedDate).toBe(true);
    expect(bounds.cursor.toISOString().slice(0, 10)).toBe('2026-08-06');
    expect(bounds.windowEnd.toISOString().slice(0, 10)).toBe('2026-09-04');
    const dates = matchingFutureDates(rule, bounds.cursor, bounds.windowEnd, now);
    expect(dates).toHaveLength(30);
    expect(dates[29].toISOString().slice(0, 10)).toBe('2026-09-04');
  });

  test('every run rechecks the full live window so missing dates can be repaired', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../src/jobs/materializeSchedules.js'), 'utf8');
    expect(source).toContain('const { cursor, windowEnd } = rollingWindowBounds(rule, horizonEnd, now);');
    expect(source).toContain('const missingDates = expectedDates.filter');
    expect(source).not.toContain('watermark ? new Date(watermark.getTime() + DAY_MS)');
  });
});
