const request = require('supertest');
const app = require('../../src/app');
const store = require('../../src/services/data/persistentStore');
const companyService = require('../../src/services/company/companyService');

async function login(email) {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ identity: email, password: 'Password123' }).expect(302);
  return agent;
}

describe('Master section B - Company and driver operations', () => {
  test('B is end-to-end: profile, terminal, documents, staff roles, driver profile, assignments, dashboard ops, incident and reports', async () => {
    const stamp = Date.now();
    const companyId = 'company-01';
    const companyAgent = await login('company@classictrip.test');

    await companyAgent.post('/company/settings').type('form').send({
      name: `B Complete Express ${stamp}`,
      companyType: 'bus',
      city: 'Kampala',
      country: 'Uganda',
      defaultCurrency: 'UGX',
      supportEmail: `support-b-${stamp}@classictrip.test`,
      supportPhone: '+256702200001',
      supportWhatsapp: '+256702200002',
      supportMessage: 'Section B operations support desk.',
      payoutAccount: `B-PAYOUT-${stamp}`,
    }).expect(302);
    const company = store.findCompany(companyId);
    expect(company.name).toBe(`B Complete Express ${stamp}`);
    expect(company.supportContacts.email).toBe(`support-b-${stamp}@classictrip.test`);
    expect(company.payoutAccount).toBe(`B-PAYOUT-${stamp}`);

    await companyAgent.post('/company/branches').type('form').send({
      name: `B Main Terminal ${stamp}`,
      branchType: 'terminal',
      terminalCode: `B-${String(stamp).slice(-5)}`,
      city: 'Kampala',
      country: 'Uganda',
      address: 'Namirembe Road',
      contactPhone: '+256702200003',
      serviceCategories: 'bus,cargo,parcel',
      operatingHours: '05:00-23:00',
    }).expect(302);
    const branch = store.state.companyBranches.find((row) => row.companyId === companyId && row.name === `B Main Terminal ${stamp}`);
    expect(branch).toBeTruthy();
    expect(branch.branchType).toBe('terminal');
    expect(branch.serviceCategories).toContain('cargo');

    await companyAgent.post('/company/policies').type('form').send({
      title: `B Boarding Policy ${stamp}`,
      policyType: 'boarding',
      serviceCategory: 'bus',
      summary: 'Passengers must arrive 30 minutes before departure and carry ticket QR.',
      customerVisible: 'on',
      appliesToBranches: branch.id,
    }).expect(302);
    const policy = store.state.companyPolicies.find((row) => row.companyId === companyId && row.title === `B Boarding Policy ${stamp}`);
    expect(policy.customerVisible).toBe(true);
    expect(policy.appliesToBranches).toContain(branch.id);

    const staffResult = await companyService.inviteEmployee(companyId, {
      fullName: `B Driver ${stamp}`,
      email: `b-driver-${stamp}@classictrip.test`,
      phone: '+256702200004',
      roleTitle: 'Driver',
      branch: branch.name,
      permissions: 'driver_manifest,trip_status,incident_reporting,check_in_assist',
      status: 'active',
    });
    await companyAgent.post(`/company/staff/${staffResult.employee.id}/role`).type('form').send({
      roleTitle: 'Senior Driver',
      branch: branch.name,
      permissions: 'driver_manifest,trip_status,incident_reporting,check_in_assist',
      serviceCategories: 'bus,cargo',
      status: 'active',
    }).expect(302);
    expect(staffResult.employee.roleTitle).toBe('Senior Driver');
    expect(staffResult.employee.permissions).toContain('trip_status');

    await companyAgent.post(`/company/drivers/${staffResult.employee.id}/profile`).type('form').send({
      roleTitle: 'Senior Driver',
      licenseNumber: `DL-B-${stamp}`,
      licenseClass: 'DE',
      licenseExpiresAt: new Date(Date.now() + 365 * 86400000).toISOString(),
      safetyStatus: 'cleared',
      assignedFleetId: 'fleet-b-01',
      documentType: 'driver_license',
      documentReference: `DL-B-${stamp}`,
      documentUrl: 'https://res.cloudinary.com/classic-trip/raw/upload/b-license.pdf',
      permissions: 'driver_manifest,trip_status,incident_reporting,check_in_assist',
    }).expect(302);
    expect(staffResult.employee.licenseNumber).toBe(`DL-B-${stamp}`);
    expect(staffResult.employee.safetyStatus).toBe('cleared');
    expect(staffResult.employee.documents[0].documentReference).toBe(`DL-B-${stamp}`);

    const listing = await companyService.createListing(companyId, { serviceType: 'bus', title: `B Route ${stamp}`, from: 'Kampala', to: 'Mbarara', priceFrom: 50000, status: 'active' });
    const route = await companyService.createRoute(companyId, { listingId: listing.id, origin: 'Kampala', destination: 'Mbarara', boardingPoints: branch.name, status: 'active' });
    const vehicle = await companyService.createVehicle(companyId, { listingId: listing.id, name: `B Coach ${stamp}`, plateOrCode: `UBB${String(stamp).slice(-3)}`, totalSeats: 12, amenities: 'AC,USB', status: 'active' });
    const { schedule } = await companyService.createSchedule(companyId, { listingId: listing.id, routeId: route.id, vehicleId: vehicle.id, departAt: new Date(Date.now() + 2 * 86400000).toISOString(), totalSeats: 12, basePrice: 50000, status: 'active' });

    await companyAgent.post(`/company/drivers/${staffResult.employee.id}/assign`).type('form').send({
      vehicleId: vehicle.id,
      scheduleId: schedule.id,
      assignmentType: 'schedule',
      safetyStatus: 'cleared',
      note: 'Assigned to B complete test trip.',
    }).expect(302);
    const assignment = store.state.driverAssignments.find((row) => row.employeeId === staffResult.employee.id && row.scheduleId === schedule.id);
    expect(assignment).toBeTruthy();
    expect(schedule.driverEmployeeId).toBe(staffResult.employee.id);
    expect(vehicle.assignedDriverId).toBe(staffResult.employee.id);

    const driverAgent = request.agent(app);
    await driverAgent.post('/login').type('form').send({ identity: `b-driver-${stamp}@classictrip.test`, password: 'Password123' }).expect(302);
    const dashboard = await driverAgent.get('/driver/dashboard').expect(200);
    expect(dashboard.text).toContain(schedule.id);
    expect(dashboard.text).toContain('Driver Operations');

    await driverAgent.post(`/driver/trips/${schedule.id}/status`).type('form').send({ status: 'boarding', location: branch.name, note: 'Boarding opened from B terminal.' }).expect(302);
    expect(schedule.tripStatus).toBe('boarding');
    expect(store.state.tripStatusUpdates.some((row) => row.scheduleId === schedule.id && row.status === 'boarding')).toBe(true);

    await driverAgent.post('/driver/incidents').type('form').send({ scheduleId: schedule.id, category: 'vehicle', severity: 'high', title: 'Tyre inspection', description: 'Tyre pressure warning handled before departure.', location: branch.name }).expect(302);
    expect(store.state.driverIncidents.some((row) => row.scheduleId === schedule.id && row.category === 'vehicle')).toBe(true);

    const companyDashboard = store.dashboardData('company', { companyId });
    expect(companyDashboard.branches.some((row) => row[0] === branch.name)).toBe(true);
    expect(companyDashboard.policies.some((row) => row[0] === policy.title)).toBe(true);
    expect(companyDashboard.drivers.some((row) => row[1] === `DL-B-${stamp}`)).toBe(true);
    expect(companyDashboard.driverAssignments.some((row) => row[2] === schedule.id)).toBe(true);

    const branchCsv = await companyAgent.get('/company/reports/branches.csv').expect(200);
    expect(branchCsv.text).toContain(branch.name);
    const driverCsv = await companyAgent.get('/company/reports/drivers.csv').expect(200);
    expect(driverCsv.text).toContain(`DL-B-${stamp}`);
    const assignmentCsv = await companyAgent.get('/company/reports/driver-assignments.csv').expect(200);
    expect(assignmentCsv.text).toContain(schedule.id);
  });
});
