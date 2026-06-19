const request = require('supertest');
const app = require('../../src/app');
const store = require('../../src/services/data/persistentStore');
const companyService = require('../../src/services/company/companyService');
const verificationService = require('../../src/services/onboarding/verificationService');

async function login(email) {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ identity: email, password: 'Password123' }).expect(302);
  return agent;
}

describe('Master section A - Super Admin controlled partner and driver onboarding', () => {
  test('A is end-to-end: public lead, session, agreement, secure invite, account setup, documents, verification, activation, reject, and expiry', async () => {
    const stamp = Date.now();
    const admin = await login('admin@classictrip.test');

    await request(app)
      .post('/partner-requests')
      .type('form')
      .send({
        name: `A Complete Coach ${stamp}`,
        companyType: 'bus_company',
        contactName: 'A Complete Owner',
        email: `a-complete-${stamp}@classictrip.test`,
        phone: '+256701100001',
        whatsapp: '+256701100001',
        city: 'Kampala',
        country: 'Uganda',
        notes: 'Public section A lead intake.',
      })
      .expect(302);

    const lead = store.state.partnerLeads.find((row) => row.email === `a-complete-${stamp}@classictrip.test`);
    expect(lead).toBeTruthy();
    expect(lead.status).toBe('new');
    expect(store.state.companies.some((row) => row.name === lead.businessName)).toBe(false);

    await admin.post('/admin/sessions').type('form').send({
      leadId: lead.id,
      sessionType: 'A discovery call',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      attendees: 'A Complete Owner, Super Admin',
      meetingLink: 'https://meet.example/a-complete',
      notes: 'Discussed documents, payout, support, subscription, and commission.',
      agreedNextAction: 'Prepare approved onboarding agreement',
    }).expect(302);
    const session = store.state.discoverySessions.find((row) => row.leadId === lead.id);
    expect(session.notes).toContain('documents');
    expect(lead.status).toBe('session_scheduled');

    await admin.post('/admin/agreements').type('form').send({
      leadId: lead.id,
      sessionId: session.id,
      agreementType: 'bus company',
      commissionModel: 'standard-90-7-3',
      subscriptionPlan: 'growth',
      documentRequirements: 'Business license, payout account, support contacts, inventory readiness.',
      startDate: new Date().toISOString(),
      termsSummary: 'Section A complete onboarding terms.',
    }).expect(302);
    const agreement = store.state.agreements.find((row) => row.leadId === lead.id);
    expect(agreement.status).toBe('draft');
    expect(agreement.approvalHistory[0].action).toBe('created');

    await admin.post(`/admin/agreements/${agreement.id}/approve`).type('form').send({ note: 'Approved for secure invitation' }).expect(302);
    const invite = store.state.invitations.find((row) => row.id === agreement.invitationId);
    expect(invite).toBeTruthy();
    expect(invite.type).toBe('company');
    expect(invite.status).toBe('sent');
    expect(invite.token).toBeTruthy();
    expect(invite.tokenHash).toBeTruthy();
    expect(invite.tokenPreview).toContain('...');

    const acceptPage = await request(app).get(`/invite/${invite.token}`).expect(200);
    expect(acceptPage.text).toContain('Verification document type');
    expect(acceptPage.text).toContain('Reject this invitation');

    await request(app).post(`/invite/${invite.token}`).type('form').send({
      fullName: 'A Complete Owner',
      phone: '+256701100001',
      phoneVerified: 'on',
      password: 'Password123',
      confirmPassword: 'Password123',
      documentType: 'business_license',
      documentReference: 'BL-A-COMPLETE-001',
      documentUrl: 'https://res.cloudinary.com/classic-trip/raw/upload/a-complete-license.pdf',
      payoutProvider: 'MTN MoMo',
      accountName: 'A Complete Coach Ltd',
      accountNumber: '+256701100001',
      supportPhone: '+256701100002',
      supportEmail: `support-a-complete-${stamp}@classictrip.test`,
      agreementAccepted: 'on',
      agreementSummary: 'Section A complete onboarding terms accepted.',
    }).expect(302);

    const user = store.findUserByIdentity(`a-complete-${stamp}@classictrip.test`);
    expect(user.role).toBe('company_admin');
    expect(user.emailVerifiedAt).toBeTruthy();
    expect(user.phoneVerifiedAt).toBeTruthy();
    expect(user.profileCompletion.completed).toBe(true);
    expect(user.onboardingStatus).toBe('profile_submitted');

    const company = store.findCompany(user.companyId);
    expect(company).toBeTruthy();
    expect(company.verificationStatus).toBe('pending');
    expect(company.settings.canPublish).toBe(false);
    expect(company.documents.some((doc) => doc.documentReference === 'BL-A-COMPLETE-001')).toBe(true);

    await companyService.createListing(company.id, { serviceType: 'bus', title: `A Route ${stamp}`, from: 'Kampala', to: 'Gulu', priceFrom: 45000, status: 'draft' });
    const listing = store.state.listings.find((row) => row.companyId === company.id && row.title === `A Route ${stamp}`);
    const route = await companyService.createRoute(company.id, { listingId: listing.id, origin: 'Kampala', destination: 'Gulu', status: 'active' });
    const vehicle = await companyService.createVehicle(company.id, { name: 'A Complete Coach', plateNumber: `UA${String(stamp).slice(-4)}A`, totalSeats: 8, status: 'active' });
    await companyService.createSchedule(company.id, { listingId: listing.id, routeId: route.id, vehicleId: vehicle.id, departAt: new Date(Date.now() + 2 * 86400000).toISOString(), totalSeats: 8, basePrice: 45000, status: 'active' });

    const review = await verificationService.submitCompanyChecklist(company.id, {
      payoutProvider: 'MTN MoMo',
      accountName: 'A Complete Coach Ltd',
      accountNumber: '+256701100001',
      supportPhone: '+256701100002',
      supportEmail: `support-a-complete-${stamp}@classictrip.test`,
      agreementAccepted: true,
      agreementSummary: 'Section A complete onboarding terms accepted.',
    }, user.id);
    expect(review.documents.some((doc) => doc.documentReference === 'BL-A-COMPLETE-001')).toBe(true);
    expect(review.checklist.every((item) => ['submitted', 'approved', 'waived'].includes(item.status))).toBe(true);

    for (const key of review.checklist.map((item) => item.key)) {
      await admin.post(`/admin/verification/company/${company.id}/items/${key}/approve`).type('form').send({ note: `A approved ${key}` }).expect(302);
    }
    await admin.post(`/admin/verification/company/${company.id}/activate`).type('form').send({ note: 'A activation complete' }).expect(302);
    expect(company.verificationStatus).toBe('verified');
    expect(company.status).toBe('active');
    expect(company.settings.canPublish).toBe(true);

    await admin.post('/admin/invitations').type('form').send({
      type: 'agent',
      email: `a-reject-${stamp}@classictrip.test`,
      fullName: 'A Reject Agent',
    }).expect(302);
    const rejectInvite = store.state.invitations.find((row) => row.email === `a-reject-${stamp}@classictrip.test`);
    await request(app).post(`/invite/${rejectInvite.token}/reject`).type('form').send({ reason: 'Not ready' }).expect(302);
    expect(rejectInvite.status).toBe('rejected');
    expect(rejectInvite.rejectionReason).toBe('Not ready');
    await request(app).get(`/invite/${rejectInvite.token}`).expect(400);

    await admin.post('/admin/invitations').type('form').send({
      type: 'hotel',
      email: `a-expired-${stamp}@classictrip.test`,
      fullName: 'A Expired Hotel',
      validDays: -1,
    }).expect(302);
    const expiredInvite = store.state.invitations.find((row) => row.email === `a-expired-${stamp}@classictrip.test`);
    expiredInvite.expiresAt = new Date(Date.now() - 1000).toISOString();
    await request(app).get(`/invite/${expiredInvite.token}`).expect(400);
    expect(expiredInvite.status).toBe('expired');

    await admin.post('/admin/invitations').type('form').send({
      type: 'driver',
      email: `a-driver-${stamp}@classictrip.test`,
      fullName: 'A Driver',
      phone: '+256701100003',
      companyId: 'company-01',
      roleTitle: 'Driver',
      permissions: 'driver_manifest,check_in,trip_status',
    }).expect(302);
    const driverInvite = store.state.invitations.find((row) => row.email === `a-driver-${stamp}@classictrip.test`);
    await request(app).post(`/invite/${driverInvite.token}`).type('form').send({
      fullName: 'A Driver',
      phone: '+256701100003',
      phoneVerified: 'on',
      password: 'Password123',
      confirmPassword: 'Password123',
      documentType: 'driver_license',
      documentReference: 'DL-A-COMPLETE-001',
      identityReference: 'NIN-A-COMPLETE-001',
      agreementAccepted: 'on',
    }).expect(302);
    const driverUser = store.findUserByIdentity(`a-driver-${stamp}@classictrip.test`);
    const employee = store.state.companyEmployees.find((row) => row.userId === driverUser.id);
    expect(employee.status).toBe('pending_verification');
    expect(employee.documents.some((doc) => doc.documentReference === 'DL-A-COMPLETE-001')).toBe(true);
    expect(store.state.verificationReviews.some((row) => row.targetType === 'driver' && row.targetId === employee.id && row.documents.some((doc) => doc.documentReference === 'DL-A-COMPLETE-001'))).toBe(true);

    const dashboard = store.dashboardData('admin');
    expect(dashboard.leads.some((row) => row[0] === `A Complete Coach ${stamp}`)).toBe(true);
    expect(dashboard.sessions.some((row) => row[0] === `A Complete Coach ${stamp}`)).toBe(true);
    expect(dashboard.agreements.some((row) => row[0] === `A Complete Coach ${stamp}` && row[5] === 'approved')).toBe(true);
    expect(store.state.auditLogs.some((log) => log.action === 'invitation.rejected' && log.entityId === rejectInvite.id)).toBe(true);
  });
});
