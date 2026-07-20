const request = require('supertest');
const app = require('../../src/app');
const store = require('../../src/services/data/persistentStore');
const settlementService = require('../../src/services/finance/settlementService');

async function login(email) {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ identity: email, password: 'Password123' }).expect(302);
  return agent;
}

async function ensurePaidCompletedBooking() {
  const listing = store.state.listings.find((item) => item.id === 'bus-001') || store.state.listings.find((item) => item.serviceType === 'bus' && item.bookable);
  const schedule = store.schedulesForListing(listing.id)[0];
  const availableSeat = store.seatsForSchedule(schedule.id).find((seat) => seat.status === 'available');
  const booking = await store.createBooking({
    listingId: listing.id,
    scheduleId: schedule.id,
    seatNumber: availableSeat?.seatNumber || '1',
    fullName: 'Section I Finance Customer',
    email: `section-i-${Date.now()}@classictrip.test`,
    phone: '+256700900001',
    promoterAttribution: { promoterId: 'user-promoter-001', linkId: 'promoter-link-001', code: 'CT-DEMO-1' },
  });
  booking.companyId = 'company-01';
  booking.promoterAttribution = { promoterId: 'user-promoter-001', linkId: 'promoter-link-001', code: 'CT-DEMO-1' };
  booking.pricing.split = require('../../src/utils/calculateCommission')(booking.pricing.total, true);
  booking.paymentStatus = 'successful';
  booking.bookingStatus = 'completed';
  booking.checkInStatus = 'checked_in';
  booking.checkedInAt = booking.checkedInAt || new Date().toISOString();
  store.state.commissions = store.state.commissions.filter((row) => row.bookingId !== booking.id);
  store.state.walletTransactions = store.state.walletTransactions.filter((row) => row.referenceId !== booking.id);
  booking.settlementStatus = null;
  await store.settleBookingPayment(booking.bookingRef);
  return booking;
}

describe('Master section I - Finance, wallet, commission, and settlement', () => {
  test('I is end-to-end: payment intents, receipts/invoices, ledger splits, release, payout risk, statements, and finance exports', async () => {
    const booking = await ensurePaidCompletedBooking();
    const admin = await login('admin@classictrip.test');

    await settlementService.recordPaymentIntent({
      bookingId: booking.id,
      bookingRef: booking.bookingRef,
      companyId: booking.companyId,
      customerUserId: booking.customerUserId,
      provider: 'mock',
      providerReference: `PI-I-${Date.now()}`,
      idempotencyKey: `section-i:${booking.bookingRef}`,
      amount: booking.pricing.total,
      currency: booking.pricing.currency,
      status: 'successful',
    }, 'section-i-test');
    await settlementService.recordBookingFinancialDocuments(booking, null, 'section-i-test');

    expect(store.state.paymentIntents.some((intent) => intent.bookingRef === booking.bookingRef && intent.status === 'successful')).toBe(true);
    expect(store.state.receiptInvoices.some((doc) => doc.bookingRef === booking.bookingRef && doc.documentType === 'receipt')).toBe(true);
    expect(store.state.receiptInvoices.some((doc) => doc.bookingRef === booking.bookingRef && doc.documentType === 'invoice')).toBe(true);
    expect(store.state.taxFeeRecords.some((row) => row.bookingRef === booking.bookingRef)).toBe(true);

    const platformLedger = store.state.walletTransactions.find((txn) => txn.ownerType === 'platform' && txn.transactionType === 'platform_fee' && txn.referenceId === booking.id);
    const companyPending = store.state.walletTransactions.find((txn) => txn.ownerType === 'company' && txn.transactionType === 'company_earning_pending' && txn.referenceId === booking.id);
    const promoterPending = store.state.walletTransactions.find((txn) => txn.ownerType === 'promoter' && txn.transactionType === 'promoter_commission_pending' && txn.referenceId === booking.id);
    expect(platformLedger).toBeTruthy();
    expect(companyPending).toBeTruthy();
    expect(promoterPending).toBeTruthy();

    await admin.post('/admin/finance/release-eligible').type('form').send({}).expect(302);
    expect(store.state.commissions.find((row) => row.bookingId === booking.id).status).toBe('released');

    await admin.post('/admin/settlements').type('form').send({ notes: 'Section I settlement' }).expect(302);
    const settlement = store.state.settlementBatches[0];
    expect(settlement.rows.some((row) => row.ownerType === 'company' && row.ownerId === 'company-01')).toBe(true);
    expect(store.state.financeStatements.some((statement) => statement.settlementBatchId === settlement.id && statement.ownerType === 'company')).toBe(true);

    const company = await login('company@classictrip.test');
    await company.post('/company/payouts').type('form').send({ amount: '10000', payoutMethod: 'mobile_money', payoutAccount: '+256700000001' }).expect(302);
    const payoutRequest = store.state.payoutRequests.find((row) => row.ownerType === 'company' && row.ownerId === 'company-01' && row.amount === 10000);
    expect(payoutRequest).toBeTruthy();

    await admin.post(`/admin/payouts/${payoutRequest.transactionId}/review`).type('form').send({ status: 'held', reason: 'Section I risk review' }).expect(302);
    const reviewed = store.state.payoutRequests.find((row) => row.id === payoutRequest.id);
    expect(reviewed.status).toBe('held');
    expect(reviewed.riskReviewId).toBeTruthy();
    expect(store.state.financeRiskReviews.find((row) => row.id === reviewed.riskReviewId)).toBeTruthy();

    await admin.post('/admin/finance/statements').type('form').send({ notes: 'Manual Section I statements' }).expect(302);
    expect(store.state.financeStatements.length).toBeGreaterThan(0);

    const dashboard = await admin.get('/admin/payments').expect(200);
    expect(dashboard.text).toContain('Settlement batches');
    expect(dashboard.text).toContain('Payout requests and batches');
    expect(dashboard.text).toContain('Ledger, refund debits, and reconciliation');

    await admin.get('/admin/reports/payment-intents.csv').expect(200).expect((res) => expect(res.text).toContain('Intent,Booking/cart,Provider'));
    await admin.get('/admin/reports/receipt-invoices.csv').expect(200).expect((res) => expect(res.text).toContain('Document,Type,Booking'));
    await admin.get('/admin/reports/tax-fees.csv').expect(200).expect((res) => expect(res.text).toContain('Record,Booking,Subtotal'));
    await admin.get('/admin/reports/finance-statements.csv').expect(200).expect((res) => expect(res.text).toContain('Statement,Owner,Period start'));
    await admin.get('/admin/reports/finance-risk.csv').expect(200).expect((res) => expect(res.text).toContain('Review,Target,Owner'));
  });
});
