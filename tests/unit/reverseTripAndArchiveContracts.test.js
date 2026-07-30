'use strict';

const fs = require('fs');
const path = require('path');
const { stopMatches } = require('../../src/modules/bus/services/busSearchService');
const {
  RESTORE_TARGETS,
  SCOPE_MODELS,
} = require('../../src/services/archive/archiveService');

describe('reverse-trip and archive contracts', () => {
  test('reverse stop matching falls back to the canonical stop name', () => {
    expect(stopMatches(
      { branchId: '', name: 'Kampala Central' },
      'branch-kampala',
      'kampala central',
    )).toBe(true);
    expect(stopMatches(
      { branchId: 'branch-kampala', name: 'Old Taxi Park' },
      'branch-kampala',
      'kampala central',
    )).toBe(true);
    expect(stopMatches(
      { branchId: 'branch-jinja', name: 'Jinja' },
      'branch-kampala',
      'kampala central',
    )).toBe(false);
  });

  test('reverse-trip discovery does not depend on outbound chronology', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../src/modules/bus/services/busSearchService.js'), 'utf8');
    expect(source).toContain('departAt: { $gt: new Date() }');
    expect(source).not.toContain('afterDate');
    expect(source).not.toContain('availability.schedule.arriveAt');
  });

  test('company archive scope excludes global and promoter records', () => {
    expect(SCOPE_MODELS.company.has('Listing')).toBe(true);
    expect(SCOPE_MODELS.company.has('TripSchedule')).toBe(true);
    expect(SCOPE_MODELS.company.has('BlogPost')).toBe(false);
    expect(SCOPE_MODELS.company.has('PromoterLink')).toBe(false);
  });

  test('generic restore targets never publish operational records', () => {
    expect(RESTORE_TARGETS.Listing).toMatchObject({ status: 'draft', bookable: false });
    expect(RESTORE_TARGETS.TripSchedule).toEqual({ status: 'draft' });
    expect(RESTORE_TARGETS.TaxiVehicle).toEqual({ operationalStatus: 'offline' });
    expect(RESTORE_TARGETS.Route).toBeUndefined();
    expect(RESTORE_TARGETS.RouteStop).toBeUndefined();
  });
});
