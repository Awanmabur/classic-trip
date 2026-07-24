'use strict';

// Production syntax checks cannot detect undefined exports or top-level module-load failures.
// This gate loads the critical runtime boundaries without starting the HTTP server or workers.
const modules = [
  '../src/models/Booking',
  '../src/models/Company',
  '../src/models/Listing',
  '../src/models/Route',
  '../src/models/RouteStop',
  '../src/models/Vehicle',
  '../src/models/TripSchedule',
  '../src/models/Seat',
  '../src/models/HotelProperty',
  '../src/models/RoomType',
  '../src/models/RoomUnit',
  '../src/models/RoomNightInventory',
  '../src/services/company/companyService',
  '../src/services/company/busServiceOnboarding',
  '../src/modules/bus/services/busSetupService',
  '../src/modules/bus/services/busDepartureService',
  '../src/services/hotel/hotelService',
  '../src/services/booking/bookingService',
  '../src/repositories',
  '../src/services/dashboard/mongoDashboardService',
  '../src/services/dashboard/dashboardSnapshotService',
  '../src/services/dashboard/dashboardProjectionEngine',
  '../src/controllers/company/hotelController',
  '../src/controllers/company/routeController',
  '../src/controllers/company/vehicleController',
  '../src/controllers/company/scheduleController',
];

const failures = [];
for (const modulePath of modules) {
  try {
    require(modulePath);
  } catch (error) {
    failures.push(`${modulePath}: ${error.stack || error.message}`);
  }
}

if (failures.length) {
  console.error('Runtime module-load check failed:\n' + failures.join('\n\n'));
  process.exit(1);
}
console.log(`Runtime module-load check passed (${modules.length} critical modules).`);
