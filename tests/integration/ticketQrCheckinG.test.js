const request = require('supertest');
const app = require('../../src/app');
const store = require('../../src/services/data/persistentStore');
const companyService = require('../../src/services/company/companyService');
const manifestService = require('../../src/services/operations/manifestService');
const reportService = require('../../src/services/report/reportService');
const bookingService = require('../../src/services/booking/bookingService');

async function login(email) {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ identity: email, password: 'Password123' }).expect(302);
  return agent;
}

describe('Master section G - Ticket, QR, and check-in', () => {
  test('G is end-to-end: one-time secure QR per leg, scoped scanner validation, manual fallback, scan history, and exports', async () => {
    const stamp = Date.now();
    const companyId = 'company-01';
    const employeeAgent = await login('employee@classictrip.test');

    const listing = await companyService.createListing(companyId, {
      serviceType: 'bus',
      title: `G QR Route ${stamp}`,
      from: 'Kampala',
      to: 'Mbarara',
      priceFrom: 55000,
      cancellationRules: 'Cancellation allowed before boarding.',
      status: 'active',
    });
    const route = await companyService.createRoute(companyId, {
      listingId: listing.id,
      routeName: `G Kampala Mbarara ${stamp}`,
      origin: 'Kampala',
      destination: 'Mbarara',
      boardingPoints: 'Namirembe Terminal',
      dropoffPoints: 'Mbarara Main Park',
      status: 'active',
    });
    const vehicle = await companyService.createVehicle(companyId, {
      listingId: listing.id,
      name: `G Coach ${stamp}`,
      plateOrCode: `UGG${String(stamp).slice(-4)}`,
      totalSeats: 10,
      layoutName: '2x2',
      rows: 3,
      status: 'active',
    });
    const { schedule } = await companyService.createSchedule(companyId, {
      routeId: route.id,
      vehicleId: vehicle.id,
      driverName: `G Driver ${stamp}`,
      departAt: new Date(Date.now() + 4 * 86400000).toISOString(),
      totalSeats: 10,
      basePrice: 55000,
      status: 'published',
    });

    const booking = store.createBooking({
      listingId: listing.id,
      scheduleId: schedule.id,
      selectedSeats: '1,2',
      passengers: JSON.stringify([
        { fullName: 'G Passenger One', phone: '+256700700001', pickupPoint: 'Namirembe Terminal', dropoffPoint: 'Mbarara Main Park' },
        { fullName: 'G Passenger Two', phone: '+256700700002', pickupPoint: 'Namirembe Terminal', dropoffPoint: 'Mbarara Main Park' },
      ]),
      fullName: 'G Buyer',
      email: `g-buyer-${stamp}@classictrip.test`,
      phone: '+256700700000',
    });

    expect(booking.ticketLegs).toHaveLength(2);
    const [firstLeg, secondLeg] = booking.ticketLegs;
    expect(firstLeg.qrToken).toMatch(/^CTQR-/);
    expect(firstLeg.qrTokenHash).toHaveLength(64);
    expect(firstLeg.qrToken).not.toEqual(secondLeg.qrToken);
    expect(firstLeg.ticketNumber).not.toEqual(secondLeg.ticketNumber);

    const customerTicket = await request(app).get(`/tickets/${booking.bookingRef}`).expect(200);
    expect(customerTicket.text).toContain('Ticket legs and QR check-in state');
    expect(customerTicket.text).toContain(firstLeg.ticketNumber);
    expect(customerTicket.text).toContain(secondLeg.ticketNumber);
    expect(customerTicket.text).toContain('Each leg below has its own one-time QR token');

    const lookup = await employeeAgent.post('/employee/scanner/lookup').type('form').send({ ticketNumber: firstLeg.ticketNumber, scheduleId: schedule.id, source: 'terminal_scanner', location: 'Gate A' }).expect(200);
    expect(lookup.body.ok).toBe(true);
    expect(lookup.body.ticket.ticketNumber).toBe(firstLeg.ticketNumber);

    const wrongCompany = await bookingService.validateTicket(firstLeg.qrToken, 'wrong-company-scanner', 'company-02', { actorRole: 'company_employee', userId: 'wrong-company-scanner' });
    expect(wrongCompany.result).toBe('not_authorized_for_ticket');

    const validate = await employeeAgent.post('/employee/scanner/validate').type('form').send({ qrToken: firstLeg.qrToken, scheduleId: schedule.id, source: 'terminal_scanner', location: 'Gate A' }).expect(200);
    expect(validate.body.ok).toBe(true);
    expect(validate.body.ticket.ticketNumber).toBe(firstLeg.ticketNumber);
    expect(validate.body.ticket.checkInStatus).toBe('checked_in');

    const duplicate = await employeeAgent.post('/employee/scanner/validate').type('form').send({ qrToken: firstLeg.qrToken, scheduleId: schedule.id }).expect(409);
    expect(duplicate.body.result).toBe('already_used');
    expect(duplicate.body.message).toMatch(/already used/i);

    const manual = await employeeAgent.post('/employee/scanner/validate').type('form').send({ ticketNumber: secondLeg.ticketNumber, scheduleId: schedule.id, source: 'manual_fallback', location: 'Gate B' }).expect(200);
    expect(manual.body.ok).toBe(true);
    expect(manual.body.ticket.ticketNumber).toBe(secondLeg.ticketNumber);

    expect(booking.bookingStatus).toBe('checked_in');
    expect(booking.ticketLegs.every((leg) => leg.checkInStatus === 'checked_in')).toBe(true);
    expect(booking.scanHistory.length).toBeGreaterThanOrEqual(4);
    expect(store.state.ticketScans.some((scan) => scan.ticketNumber === firstLeg.ticketNumber && scan.result === 'already_used')).toBe(true);

    const detail = manifestService.bookingForCompany(companyId, booking.bookingRef);
    expect(detail.scanHistory.length).toBeGreaterThanOrEqual(3);
    expect(detail.printable.qrTokenPreview).toContain('...');

    const operationalPage = await employeeAgent.get(`/driver/tickets/${booking.bookingRef}`).expect(200);
    expect(operationalPage.text).toContain('QR / scan history');
    expect(operationalPage.text).toContain('Refund / reschedule / support');
    expect(operationalPage.text).toContain(firstLeg.ticketNumber);

    const scanReport = reportService.generateCsvReport('admin', 'ticket-scans');
    expect(scanReport.csv).toContain('Scan,Booking,Ticket,Schedule,Type,Result,State,Scanned at,Actor,Location');
    expect(scanReport.csv).toContain(firstLeg.ticketNumber);

    const ticketReport = reportService.generateCsvReport('admin', 'ticket-legs');
    expect(ticketReport.csv).toContain('Ticket,Booking,Passenger,Leg,Schedule,Seat/room,Status,Check-in,QR preview,Used at');
    expect(ticketReport.csv).toContain(secondLeg.ticketNumber);

  });
});
