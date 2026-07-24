const fs = require('fs');
const path = require('path');

const Company = require('../../src/models/Company');
const CompanyBranch = require('../../src/models/CompanyBranch');
const CompanyEmployee = require('../../src/models/CompanyEmployee');
const Listing = require('../../src/models/Listing');
const Route = require('../../src/models/Route');
const RouteStop = require('../../src/models/RouteStop');
const HotelProperty = require('../../src/models/HotelProperty');
const RoomType = require('../../src/models/RoomType');
const RoomUnit = require('../../src/models/RoomUnit');
const { buildDashboardShell } = require('../../src/services/dashboard/shellConfig');

function enumValues(Model, field) {
  return Model.schema.path(field)?.enumValues || [];
}

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '../..', relative), 'utf8');
}

describe('entity relationship contracts and workflow forms', () => {
  test('company onboarding and reusable setup fields exist in canonical schemas', () => {
    ['legalName', 'registrationNumber', 'taxNumber', 'headOfficeAddress', 'website'].forEach((field) => {
      expect(Company.schema.path(field)).toBeTruthy();
    });
    expect(CompanyBranch.schema.path('branchType')).toBeTruthy();
    expect(CompanyEmployee.schema.path('branchId')).toBeTruthy();
    expect(CompanyEmployee.schema.path('listingIds')).toBeTruthy();
    expect(CompanyEmployee.schema.path('scheduleIds')).toBeTruthy();
    expect(Listing.schema.path('branchId')).toBeTruthy();
  });

  test('bus route and stop records use selected branch relationships', () => {
    expect(Route.schema.path('originTerminalId')).toBeTruthy();
    expect(Route.schema.path('destinationTerminalId')).toBeTruthy();
    expect(Route.schema.path('boardingBranchIds')).toBeTruthy();
    expect(Route.schema.path('dropoffBranchIds')).toBeTruthy();
    expect(RouteStop.schema.path('branchId')).toBeTruthy();
    expect(enumValues(RouteStop, 'stopType')).toEqual(expect.arrayContaining(['origin', 'boarding', 'pickup', 'intermediate', 'dropoff', 'destination']));
  });

  test('hotel hierarchy is listing to property to room type to physical unit', () => {
    expect(HotelProperty.schema.path('listingId')).toBeTruthy();
    expect(RoomType.schema.path('listingId')).toBeTruthy();
    expect(RoomType.schema.path('propertyId')).toBeTruthy();
    expect(RoomUnit.schema.path('roomTypeId')).toBeTruthy();
    expect(RoomUnit.schema.path('propertyId')).toBeTruthy();
    expect(enumValues(RoomType, 'status')).toEqual(expect.arrayContaining(['active', 'paused', 'archived']));
  });

  test('dashboard forms use dependent selectors instead of typed internal relationships', () => {
    const js = read('public/js/dashboard-workspace.js');
    expect(js).toContain("dependsOn:'listingId'");
    expect(js).toContain("dependsOn:'scheduleId'");
    expect(js).toContain("dependsOn:'roomTypeId'");
    expect(js).toContain("name:'originBranchId'");
    expect(js).toContain("name:'destinationBranchId'");
    expect(js).toContain("label:'Available seat', type:'select'");
    expect(js).toContain("name:'listingIds', label:'Assigned listings', type:'multiselect'");
    expect(js).toContain("name:'scheduleIds', label:'Assigned schedules / departures', type:'multiselect'");
    expect(js).not.toContain("{ name:'selected', label:'Seat / room', icon:'fa-chair'");
  });

  test('authenticated customer workflows select owned bookings', () => {
    const reviews = read('src/views/dashboards/shared/sections/customer-reviews.ejs');
    const support = read('src/views/dashboards/shared/sections/customer-support.ejs');
    expect(reviews).toMatch(/<select name="bookingRef" required>/);
    expect(reviews).not.toMatch(/<input name="bookingRef"/);
    expect(support).toMatch(/<select name="bookingRef">/);
    expect(support).toMatch(/<select name="bookingRef" required>/);
    expect(support).not.toMatch(/<input name="bookingRef"/);
  });

  test('every non-company role receives an embedded workflow guide', () => {
    ['admin', 'customer', 'employee', 'driver', 'promoter', 'support', 'finance', 'operations', 'content'].forEach((role) => {
      const shell = buildDashboardShell(role, { user: { role, fullName: `${role} user` } });
      const guide = shell.groups.flatMap((group) => group.items).find((item) => item.page === 'workflow-guide');
      expect(guide).toMatchObject({ label: 'How This Dashboard Works', href: '#workflow-guide' });
    });
  });

  test('setup guide and full operations guide are part of the shipped project', () => {
    const workspace = read('src/views/dashboards/shared/workspace.ejs');
    const guide = read('docs/OPERATIONS_AND_ENTITY_GUIDE.md');
    const shell = read('src/services/dashboard/shellConfig.js');
    expect(workspace).toContain("sections/setup-guide");
    expect(workspace).toContain("sections/workflow-guide");
    expect(shell).toContain('How This Dashboard Works');
    expect(guide).toContain('Bus entity relationship');
    expect(guide).toContain('Hotel entity relationship');
    expect(guide).toContain('Fields that must be selected');
    expect(guide).toContain('Partner onboarding from beginning to completion');
  });
});
