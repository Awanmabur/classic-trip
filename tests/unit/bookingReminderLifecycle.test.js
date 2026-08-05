'use strict';

const {
  reminderIsDue,
  serviceStartAt,
  REMINDER_WINDOW_MS,
} = require('../../src/jobs/bookingReminders');

describe('booking reminder lifecycle', () => {
  const at = new Date('2026-08-05T09:00:00.000Z');

  test('hotel, flight and mobility start times resolve from their canonical snapshots', async () => {
    expect((await serviceStartAt({ serviceType: 'hotel', hotelStay: { checkIn: '2026-08-06T09:00:00.000Z' } })).toISOString())
      .toBe('2026-08-06T09:00:00.000Z');
    expect((await serviceStartAt({ serviceType: 'flight', bookingLegs: [{ departAt: '2026-08-06T08:00:00.000Z' }] })).toISOString())
      .toBe('2026-08-06T08:00:00.000Z');
    expect((await serviceStartAt({ serviceType: 'local_transport', bookingLegs: [{ scheduledPickupAt: '2026-08-05T10:00:00.000Z' }] })).toISOString())
      .toBe('2026-08-05T10:00:00.000Z');
  });

  test('only future services inside the next 24 hours are due', async () => {
    expect((await reminderIsDue({ serviceType: 'flight', bookingLegs: [{ departAt: new Date(at.getTime() + REMINDER_WINDOW_MS).toISOString() }] }, at)).due).toBe(true);
    expect((await reminderIsDue({ serviceType: 'flight', bookingLegs: [{ departAt: new Date(at.getTime() + REMINDER_WINDOW_MS + 1).toISOString() }] }, at)).due).toBe(false);
    expect((await reminderIsDue({ serviceType: 'flight', bookingLegs: [{ departAt: new Date(at.getTime() - 1).toISOString() }] }, at)).due).toBe(false);
  });
});
