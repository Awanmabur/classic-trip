const request = require('supertest');
const app = require('../../src/app');
const store = require('../../src/services/data/persistentStore');
const companyService = require('../../src/services/company/companyService');
const manifestService = require('../../src/services/operations/manifestService');

async function login(email) {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ identity: email, password: 'Password123' }).expect(302);
  return agent;
}

describe('Master section F - Customer, passenger, and printable manifest pages', () => {
  test('F is end-to-end: filtered customer list, print manifest fields, PDF/CSV/Excel exports, and ticket passenger detail', async () => {
    const stamp = Date.now();
    const companyId = 'company-01';
    const companyAgent = await login('company@classictrip.test');
    const driverAgent = await login('employee@classictrip.test');

    const branch = await companyService.createBranch(companyId, {
      name: `F Terminal ${stamp}`,
      branchType: 'terminal',
      terminalCode: `FT-${String(stamp).slice(-4)}`,
      city: 'Kampala',
      serviceCategories: 'bus',
      status: 'active',
    });
    await companyService.createPolicy(companyId, {
      title: `F Manifest Policy ${stamp}`,
      policyType: 'cancellation',
      serviceCategory: 'bus',
      summary: 'Print manifests before departure and after check-in.',
      customerVisible: true,
      status: 'active',
    });
    const listing = await companyService.createListing(companyId, {
      serviceType: 'bus',
      title: `F Manifest Route ${stamp}`,
      from: 'Kampala',
      to: 'Arua',
      priceFrom: 64000,
      cancellationRules: 'Cancellation policy available.',
      status: 'active',
    });
    const route = await companyService.createRoute(companyId, {
      listingId: listing.id,
      routeName: `F Kampala Arua ${stamp}`,
      origin: 'Kampala',
      destination: 'Arua',
      originTerminalId: branch.id,
      destinationTerminalId: 'arua-terminal',
      boardingPoints: `${branch.name},Bwaise`,
      dropoffPoints: 'Arua Park',
      publicInstructions: 'Arrive 30 minutes early.',
      status: 'active',
    });
    const vehicle = await companyService.createVehicle(companyId, {
      listingId: listing.id,
      name: `F Coach ${stamp}`,
      plateOrCode: `UF${String(stamp).slice(-4)}`,
      totalSeats: 12,
      layoutName: '2x2',
      rows: 3,
      status: 'active',
    });
    const { schedule } = await companyService.createSchedule(companyId, {
      routeId: route.id,
      vehicleId: vehicle.id,
      driverName: `F Driver ${stamp}`,
      departAt: new Date(Date.now() + 6 * 86400000).toISOString(),
      totalSeats: 12,
      basePrice: 64000,
      status: 'published',
    });

    const booking = store.createBooking({
      listingId: listing.id,
      scheduleId: schedule.id,
      selectedSeats: '1,2',
      passengers: JSON.stringify([
        { fullName: 'F Passenger One', phone: '+256700600001', pickupPoint: branch.name, dropoffPoint: 'Arua Park', specialNotes: 'Needs front seat support' },
        { fullName: 'F Passenger Two', phone: '+256700600002', pickupPoint: 'Bwaise', dropoffPoint: 'Arua Park' },
      ]),
      fullName: 'F Buyer',
      email: `f-buyer-${stamp}@classictrip.test`,
      phone: '+256700600000',
      source: 'agent_offline',
    });

    booking.bookingChannel = 'agent_offline';
    const manifest = manifestService.buildManifest(companyId, schedule.id, { generatedBy: 'Section F Test' });
    expect(manifest.passengers).toHaveLength(2);
    expect(manifest.passengers[0]).toMatchObject({
      bookingRef: booking.bookingRef,
      passengerName: 'F Passenger One',
      pickupPoint: branch.name,
      dropoffPoint: 'Arua Park',
      bookingSource: 'agent_offline',
    });
    expect(manifest.passengers[0].ticketNumber).toContain(schedule.id);

    const filtered = manifestService.buildCustomerList(companyId, {
      scheduleId: schedule.id,
      vehicleId: vehicle.id,
      driver: `F Driver ${stamp}`,
      terminal: branch.name,
      date: new Date(schedule.departAt).toISOString().slice(0, 10),
      checkInStatus: 'boarding',
      paymentStatus: 'successful',
      bookingSource: 'agent_offline',
    });
    expect(filtered.map((row) => row.passengerName)).toEqual(expect.arrayContaining(['F Passenger One', 'F Passenger Two']));

    const printPage = await driverAgent.get(`/driver/schedules/${schedule.id}/manifest`).expect(200);
    expect(printPage.text).toContain('Trip Manifest');
    expect(printPage.text).toContain('Download Excel');
    expect(printPage.text).toContain('Passenger signature');
    expect(printPage.text).toContain('F Passenger One');
    expect(printPage.text).toContain('Arua Park');

    const scheduleCsv = await driverAgent.get(`/driver/schedules/${schedule.id}/manifest.csv`).expect(200);
    expect(scheduleCsv.text).toContain('Booking,Passenger,Seat,Contact,Ticket,Pickup,Dropoff');
    expect(scheduleCsv.text).toContain('F Passenger One');

    const scheduleExcel = await driverAgent.get(`/driver/schedules/${schedule.id}/manifest.xls`).expect(200);
    expect(scheduleExcel.headers['content-type']).toContain('application/vnd.ms-excel');
    expect(scheduleExcel.text).toContain('F Passenger Two');

    const schedulePdf = await driverAgent.get(`/driver/schedules/${schedule.id}/manifest.pdf`).expect(200);
    expect(schedulePdf.headers['content-type']).toContain('application/pdf');
    expect(Number(schedulePdf.headers['content-length'])).toBeGreaterThan(1000);

    const companyPage = await companyAgent.get(`/company/manifests?scheduleId=${encodeURIComponent(schedule.id)}&terminal=${encodeURIComponent(branch.name)}`).expect(200);
    expect(companyPage.text).toContain('Customer List / Manifest');
    expect(companyPage.text).toContain('F Passenger One');
    expect(companyPage.text).toContain('Download Excel');

    const companyCsv = await companyAgent.get(`/company/manifests.csv?scheduleId=${encodeURIComponent(schedule.id)}`).expect(200);
    expect(companyCsv.text).toContain('Schedule,Departure,Route,Vehicle,Driver,Booking,Passenger,Seat,Contact,Ticket');
    expect(companyCsv.text).toContain('F Passenger Two');

    const companyExcel = await companyAgent.get(`/company/manifests.xls?scheduleId=${encodeURIComponent(schedule.id)}`).expect(200);
    expect(companyExcel.headers['content-type']).toContain('application/vnd.ms-excel');
    expect(companyExcel.text).toContain('F Passenger One');

    const companyPdf = await companyAgent.get(`/company/manifests.pdf?scheduleId=${encodeURIComponent(schedule.id)}`).expect(200);
    expect(companyPdf.headers['content-type']).toContain('application/pdf');
    expect(Number(companyPdf.headers['content-length'])).toBeGreaterThan(1000);

    const ticketPage = await driverAgent.get(`/driver/tickets/${booking.bookingRef}`).expect(200);
    expect(ticketPage.text).toContain('Operational Ticket Detail');
    expect(ticketPage.text).toContain('Pickup');
    expect(ticketPage.text).toContain(branch.name);
    expect(ticketPage.text).toContain('Dropoff');
    expect(ticketPage.text).toContain('Arua Park');
  });
});
