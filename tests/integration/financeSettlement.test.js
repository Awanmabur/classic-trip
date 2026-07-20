const request = require('supertest');
const app = require('../../src/app');
const store = require('../../src/services/data/persistentStore');

async function login(email) {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ identity: email, password: 'Password123' }).expect(302);
  return agent;
}

async function ensureCompletedReferralBooking() {
  let booking = store.state.bookings.find((row) => row.companyId === 'company-01' && row.promoterAttribution?.promoterId === 'user-promoter-001');
  if (!booking) {
    booking = await store.createBooking({
      listingId: 'bus-001',
      scheduleId: 'schedule-0001',
      seatNumber: '8',
      fullName: 'Finance Passenger',
      email: 'finance-passenger@classictrip.test',
      phone: '+256700555000',
      promoterAttribution: { promoterId: 'user-promoter-001', linkId: 'promoter-link-001', code: 'CT-DEMO-1' },
    });
  }
  booking.companyId = 'company-01';
  booking.paymentStatus = 'successful';
  booking.bookingStatus = 'completed';
  booking.checkInStatus = 'checked_in';
  booking.checkedInAt = booking.checkedInAt || new Date().toISOString();
  booking.promoterAttribution = booking.promoterAttribution || { promoterId: 'user-promoter-001', linkId: 'promoter-link-001', code: 'CT-DEMO-1' };
  return booking;
}

test('finance settlement workflow releases commissions, creates statements, batches payouts, and reconciles ledger', async () => {
  const booking = await ensureCompletedReferralBooking();
  const admin = await login('admin@classictrip.test');

  await admin.post('/admin/finance/release-eligible').type('form').send({}).expect(302);
  const releasedCommission = store.state.commissions.find((row) => row.bookingId === booking.id);
  expect(releasedCommission).toBeTruthy();
  expect(releasedCommission.status).toBe('released');

  await admin.post('/admin/settlements').type('form').send({ notes: 'Weekly settlement test' }).expect(302);
  const settlement = store.state.settlementBatches[0];
  expect(settlement).toBeTruthy();
  expect(settlement.rows.some((row) => row.ownerType === 'company' && row.ownerId === 'company-01')).toBe(true);

  const company = await login('company@classictrip.test');
  await company
    .post('/company/payouts')
    .type('form')
    .send({ amount: '50000', payoutMethod: 'mobile_money', payoutAccount: '+256700000001', note: 'Weekly company payout' })
    .expect(302);

  const payoutRequest = store.state.payoutRequests.find((row) => row.ownerType === 'company' && row.ownerId === 'company-01' && row.amount === 50000);
  expect(payoutRequest).toBeTruthy();
  expect(payoutRequest.status).toBe('requested');

  await admin.post(`/admin/payouts/${payoutRequest.transactionId}/review`).type('form').send({ status: 'approved', providerReference: 'BANK-EXPORT-1' }).expect(302);
  expect(store.state.payoutRequests.find((row) => row.id === payoutRequest.id).status).toBe('approved');

  await admin.post('/admin/payouts/batch').type('form').send({ requestIds: payoutRequest.id, providerReference: 'BATCH-EXPORT-1' }).expect(302);
  expect(store.state.payoutBatches[0].requestIds).toContain(payoutRequest.id);

  await admin.post('/admin/reconciliation').type('form').send({ settlementBatchId: settlement.id }).expect(302);
  expect(store.state.reconciliationReports[0]).toBeTruthy();

  const adminPage = await admin.get('/admin/payments').expect(200);
  expect(adminPage.text).toContain('Settlement batches');
  expect(adminPage.text).toContain('Payout requests and batches');
  expect(adminPage.text).toContain('Ledger, refund debits, and reconciliation');

  const companyPage = await company.get('/company/dashboard').expect(200);
  expect(companyPage.text).toContain('Company ledger');
  expect(companyPage.text).toContain('Refund debit visibility');

  const promoter = await login('samuel@classictrip.test');
  const promoterPage = await promoter.get('/promoter/dashboard').expect(200);
  expect(promoterPage.text).toContain('Commission release links');

  const settlementCsv = await admin.get('/admin/reports/settlements.csv').expect(200);
  expect(settlementCsv.text).toContain('Batch,Period start,Period end,Gross,Payable,Status');
  expect(settlementCsv.text).toContain(settlement.batchNumber);

  const ledgerCsv = await admin.get('/admin/reports/ledger.csv').expect(200);
  expect(ledgerCsv.text).toContain('Transaction,Owner,Type,Direction,Amount,Status');
  expect(ledgerCsv.text).toContain(payoutRequest.transactionId);
});
