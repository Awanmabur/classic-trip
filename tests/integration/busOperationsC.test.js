const request = require('supertest');
const app = require('../../src/app');
const store = require('../../src/services/data/persistentStore');
const companyService = require('../../src/services/company/companyService');
const seatLockService = require('../../src/services/booking/seatLockService');

async function login(email) {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ identity: email, password: 'Password123' }).expect(302);
  return agent;
}

describe('Master section C - Bus booking and route operations', () => {
  test('C is end-to-end: structured route, seat map, publish validation, group and round-trip tickets, reports', async () => {
    const stamp = Date.now();
    const companyId = 'company-01';
    const agent = await login('company@classictrip.test');

    const branch = await companyService.createBranch(companyId, {
      name: `C Origin Terminal ${stamp}`,
      branchType: 'terminal',
      terminalCode: `COT-${String(stamp).slice(-4)}`,
      city: 'Kampala',
      serviceCategories: 'bus',
      status: 'active',
    });
    await companyService.createPolicy(companyId, {
      title: `C Cancellation Policy ${stamp}`,
      policyType: 'cancellation',
      serviceCategory: 'bus',
      summary: 'Refund and reschedule rules apply per leg or whole booking.',
      customerVisible: true,
      status: 'active',
    });

    const listing = await companyService.createListing(companyId, {
      serviceType: 'bus',
      title: `C Bus Route ${stamp}`,
      from: 'Kampala',
      to: 'Gulu',
      priceFrom: 70000,
      cancellationRules: 'Cancel 12 hours before departure.',
      baggageRules: 'One checked bag plus one cabin bag.',
      status: 'active',
    });

    const route = await companyService.createRoute(companyId, {
      listingId: listing.id,
      routeName: `C Kampala to Gulu ${stamp}`,
      origin: 'Kampala',
      destination: 'Gulu',
      originTerminalId: branch.id,
      destinationTerminalId: 'gulu-terminal',
      distanceKm: 335,
      estimatedDuration: '6h 30m',
      estimatedDurationMinutes: 390,
      operatingDays: 'Mon,Wed,Fri,Sun',
      boardingPoints: `${branch.name},Bwaise Stage`,
      dropoffPoints: 'Gulu Main Park',
      stops: JSON.stringify([
        { name: 'Luweero Stop', stopType: 'pickup_dropoff', stopOrder: 1, timeOffsetMinutes: 55, publicInstructions: 'Wait near the fuel station.' },
        { name: 'Karuma Stop', stopType: 'rest_stop', stopOrder: 2, timeOffsetMinutes: 210, pickupAllowed: false, dropoffAllowed: false },
      ]),
      publicInstructions: 'Board with QR ticket and ID.',
      status: 'active',
    });

    expect(route.routeName).toContain('Kampala to Gulu');
    expect(route.distanceKm).toBe(335);
    expect(route.operatingDays).toContain('Wed');
    expect(route.stops).toHaveLength(2);
    expect(store.state.routeStops.some((stop) => stop.routeId === route.id && stop.name === 'Luweero Stop')).toBe(true);

    const vehicle = await companyService.createVehicle(companyId, {
      listingId: listing.id,
      name: `C Coach ${stamp}`,
      plateOrCode: `UCC${String(stamp).slice(-3)}`,
      totalSeats: 8,
      layoutName: '2x2',
      rows: 2,
      amenities: 'AC,USB,Reclining seats',
      status: 'active',
    });
    expect(vehicle.seats[0]).toMatchObject({ row: 1, col: 1, deck: 'main', seatType: 'vip', status: 'available' });

    const { schedule: draftSchedule } = await companyService.createSchedule(companyId, {
      routeId: route.id,
      vehicleId: vehicle.id,
      departAt: new Date(Date.now() + 3 * 86400000).toISOString(),
      arriveAt: new Date(Date.now() + 3 * 86400000 + 390 * 60000).toISOString(),
      boardingStartAt: new Date(Date.now() + 3 * 86400000 - 30 * 60000).toISOString(),
      totalSeats: 8,
      basePrice: 70000,
      fareClass: 'express',
      blockedSeats: '8',
      status: 'draft',
    });

    await agent.post(`/company/schedules/${draftSchedule.id}/publish`).type('form').send({}).expect(422);
    expect(draftSchedule.publishValidation.ok).toBe(false);
    expect(draftSchedule.publishValidation.failures).toContain('driver_assignment_missing');

    const staff = await companyService.inviteEmployee(companyId, {
      fullName: `C Driver ${stamp}`,
      email: `c-driver-${stamp}@classictrip.test`,
      roleTitle: 'Driver',
      permissions: 'driver_manifest,trip_status,check_in_assist',
      status: 'active',
    });
    await companyService.updateDriverProfile(companyId, staff.employee.id, {
      licenseNumber: `C-DL-${stamp}`,
      safetyStatus: 'cleared',
      permissions: 'driver_manifest,trip_status,check_in_assist',
    });
    await companyService.assignDriver(companyId, staff.employee.id, {
      vehicleId: vehicle.id,
      scheduleId: draftSchedule.id,
      safetyStatus: 'cleared',
    });

    await agent.post(`/company/schedules/${draftSchedule.id}/publish`).type('form').send({}).expect(302);
    expect(draftSchedule.status).toBe('published');
    expect(draftSchedule.publishValidation.ok).toBe(true);
    expect(draftSchedule.seatInventorySnapshot.length).toBe(8);

    await agent.post('/company/seats/status').type('form').send({
      scheduleId: draftSchedule.id,
      seatNumber: '7',
      status: 'maintenance',
      seatType: 'standard',
      blockedReason: 'Seatbelt replacement',
      priceDelta: 0,
    }).expect(302);
    const maintenanceSeat = store.seatsForSchedule(draftSchedule.id).find((seat) => seat.seatNumber === '7');
    expect(maintenanceSeat.status).toBe('maintenance');
    expect(maintenanceSeat.blockedReason).toBe('Seatbelt replacement');

    const { schedule: returnSchedule } = await companyService.createSchedule(companyId, {
      routeId: route.id,
      vehicleId: vehicle.id,
      driverName: 'Return Driver',
      driverIds: staff.employee.userId,
      departAt: new Date(Date.now() + 5 * 86400000).toISOString(),
      totalSeats: 8,
      basePrice: 72000,
      fareClass: 'express',
      status: 'published',
    });

    const groupBooking = store.createBooking({
      listingId: listing.id,
      scheduleId: draftSchedule.id,
      selectedSeats: '1,2',
      passengers: JSON.stringify([
        { fullName: 'C Passenger One', phone: '+256700300001', pickupPoint: branch.name, dropoffPoint: 'Gulu Main Park' },
        { fullName: 'C Passenger Two', phone: '+256700300002', pickupPoint: 'Bwaise Stage', dropoffPoint: 'Gulu Main Park' },
      ]),
      fullName: 'C Buyer',
      email: `c-group-${stamp}@classictrip.test`,
      phone: '+256700300000',
    });
    expect(groupBooking.passengers).toHaveLength(2);
    expect(groupBooking.bookingItems).toHaveLength(2);
    expect(groupBooking.ticketLegs).toHaveLength(2);
    expect(groupBooking.pricing.subtotal).toBeGreaterThan(70000);

    const roundTripBooking = store.createBooking({
      listingId: listing.id,
      scheduleId: draftSchedule.id,
      selectedSeats: '3,4',
      returnScheduleId: returnSchedule.id,
      returnSeats: '1,2',
      passengers: JSON.stringify([
        { fullName: 'C Round One', phone: '+256700300003' },
        { fullName: 'C Round Two', phone: '+256700300004' },
      ]),
      fullName: 'C Round Buyer',
      email: `c-round-${stamp}@classictrip.test`,
      phone: '+256700300005',
    });
    expect(roundTripBooking.tripType).toBe('round_trip');
    expect(roundTripBooking.bookingLegs).toHaveLength(2);
    expect(roundTripBooking.ticketLegs).toHaveLength(4);
    expect(roundTripBooking.bookingItems.map((item) => item.legType)).toEqual(expect.arrayContaining(['outbound', 'return']));

    const hold = await seatLockService.lockSeatsPersistent(draftSchedule.id, ['5', '6'], 10, {
      listingId: listing.id,
      companyId,
      serviceType: 'bus',
      createdBy: 'section-c-test',
    });
    expect(hold.type).toBe('seats');
    expect(hold.seatNumbers).toEqual(['5', '6']);

    const companyData = store.dashboardData('company', { companyId });
    expect(companyData.routes.some((row) => row[0] === route.routeName)).toBe(true);
    expect(companyData.routeStops.some((row) => row[1] === 'Luweero Stop')).toBe(true);
    expect(companyData.schedules.some((row) => row[0] === draftSchedule.id && row[5] === 'published')).toBe(true);
    const scheduleSeatMap = companyData.seatMaps.find((map) => map.scheduleId === draftSchedule.id);
    expect(scheduleSeatMap).toBeTruthy();
    expect(scheduleSeatMap.totals.booked).toBe(4);
    expect(scheduleSeatMap.totals.held).toBe(2);
    expect(scheduleSeatMap.seats.find((seat) => seat.seatNumber === '1')).toMatchObject({
      status: 'taken',
      bookingRef: groupBooking.bookingRef,
      passengerName: 'C Passenger One',
      paymentStatus: 'successful',
    });
    expect(scheduleSeatMap.seats.find((seat) => seat.seatNumber === '5')).toMatchObject({
      status: 'locked',
      lockId: hold.id,
    });

    const companyPage = await agent.get('/company/dashboard').expect(200);
    expect(companyPage.text).toContain('Visual seat map');
    expect(companyPage.text).toContain('seatMapDetail');
    expect(companyPage.text).toContain(groupBooking.bookingRef);
    expect(companyPage.text).toContain('C Passenger One');
    expect(companyPage.text).toContain(hold.id);

    const publicDetail = await request(app).get(`/listings/${listing.serviceType}/${listing.slug}`).expect(200);
    expect(publicDetail.text).toContain('Multi-ticket mode is on');
    expect(publicDetail.text).toContain('Two-way / return ticket');
    expect(publicDetail.text).toContain('data-return-seat');
    expect(publicDetail.text).toContain('selectedSeats');

    const checkoutPage = await request(app)
      .get(`/book/${listing.serviceType}/${listing.slug}`)
      .query({
        scheduleId: draftSchedule.id,
        selectedSeats: '7,8',
        selected: '7,8',
        passengerCount: '2',
        returnScheduleId: returnSchedule.id,
        returnSeats: '5,6',
      })
      .expect(200);
    expect(checkoutPage.text).toContain('name="selectedSeats"');
    expect(checkoutPage.text).toContain('name="returnScheduleId"');
    expect(checkoutPage.text).toContain('Ticket 1 / Seat');
    expect(checkoutPage.text).toContain('Extra ticket details');
    expect(checkoutPage.text).toContain('window.__busSelectedSeats');

    const routeStopsCsv = await agent.get('/company/reports/route-stops.csv').expect(200);
    expect(routeStopsCsv.text).toContain('Luweero Stop');
    const schedulesCsv = await agent.get('/company/reports/schedules.csv').expect(200);
    expect(schedulesCsv.text).toContain(draftSchedule.id);
  });
});
