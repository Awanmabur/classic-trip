'use strict';

const { rollingSchedulePayload } = require('../../src/controllers/company/scheduleController');

describe('rolling departure controller payload', () => {
  test('turns the normal departure form into an active indefinite schedule rule', () => {
    const result = rollingSchedulePayload({
      routeId: 'route-1',
      vehicleId: 'vehicle-1',
      fareProductId: 'fare-1',
      driverId: 'driver-1',
      departAt: '2026-08-06T08:30',
      arriveAt: '2026-08-06T13:00',
      repeatDays: ['1', '3', '5'],
      status: 'published',
      blockedSeats: ['1', '2'],
    });

    expect(result).toMatchObject({
      routeId: 'route-1',
      vehicleId: 'vehicle-1',
      fareProductId: 'fare-1',
      driverId: 'driver-1',
      departureTime: '08:30',
      startDate: '2026-08-06',
      daysOfWeek: ['1', '3', '5'],
      durationMinutes: 270,
      status: 'active',
      blockedSeats: ['1', '2'],
    });
    expect(result.endDate).toBeUndefined();
  });

  test('keeps an unfinished rolling schedule paused as draft', () => {
    const result = rollingSchedulePayload({
      departAt: '2026-08-06T18:05',
      status: 'draft',
    });
    expect(result.departureTime).toBe('18:05');
    expect(result.status).toBe('draft');
    expect(result.durationMinutes).toBeUndefined();
  });

  test.each([
    [''],
    ['2026-08-06'],
    ['2026-08-06T25:00'],
  ])('rejects invalid departure date-time %s', (departAt) => {
    expect(() => rollingSchedulePayload({ departAt })).toThrow('First departure date and time are required');
  });
});
