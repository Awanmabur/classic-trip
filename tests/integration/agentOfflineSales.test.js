const request = require('supertest');
const app = require('../../src/app');
const store = require('../../src/services/data/persistentStore');

async function login(email) {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ identity: email, password: 'Password123' }).expect(302);
  return agent;
}

function nextAvailableSeat(scheduleId = 'schedule-0001') {
  return store.state.seats.find((seat) => seat.scheduleId === scheduleId && seat.status === 'available')?.seatNumber || 'Z9';
}

test('agent offline sales create customer, booking, ticket receipt, ledger, commission, manifest row, and reports', async () => {
  const promoter = await login('samuel@classictrip.test');
  const seatNumber = nextAvailableSeat();

  await promoter
    .post('/promoter/offline-sales')
    .type('form')
    .send({
      listingId: 'bus-001',
      scheduleId: 'schedule-0001',
      seatNumber,
      customerName: 'Offline Agent Customer',
      passengerName: 'Offline Agent Passenger',
      phone: '+256701234567',
      email: 'offline-agent-customer@classictrip.test',
      paymentMethod: 'cash',
      amountCollected: '95000',
      paymentReference: 'CASH-DESK-001',
      agentLocation: 'Kampala terminal desk',
    })
    .expect(302);

  const sale = store.state.offlineSales.find((row) => row.customerEmail === 'offline-agent-customer@classictrip.test');
  expect(sale).toBeTruthy();
  expect(sale.bookingRef).toBeTruthy();
  expect(sale.receiptUrl).toContain('/promoter/offline-sales/');

  const booking = store.findBooking(sale.bookingRef);
  expect(booking).toBeTruthy();
  expect(booking.bookingChannel).toBe('agent_offline');
  expect(booking.paymentStatus).toBe('successful');
  expect(booking.customerUserId).toBeTruthy();
  expect(booking.promoterAttribution.promoterId).toBe('user-promoter-001');

  expect(store.state.users.find((user) => user.email === 'offline-agent-customer@classictrip.test' && user.role === 'customer')).toBeTruthy();
  expect(store.state.payments.find((payment) => payment.bookingRef === sale.bookingRef && payment.provider === 'offline_agent')).toBeTruthy();
  expect(store.state.walletTransactions.find((txn) => txn.referenceId === booking.id && txn.transactionType === 'company_earning_pending')).toBeTruthy();
  expect(store.state.commissions.find((commission) => commission.bookingId === booking.id && commission.promoterId === 'user-promoter-001')).toBeTruthy();

  const receiptPage = await promoter.get(sale.receiptUrl).expect(200);
  expect(receiptPage.text).toContain('Classic Trip Offline Sales Receipt');
  expect(receiptPage.text).toContain(sale.bookingRef);

  const dashboard = await promoter.get('/promoter/offline-sales').expect(200);
  expect(dashboard.text).toContain('Agent / offline sales');
  expect(dashboard.text).toContain('Offline Agent Customer');

  const ticket = await promoter.get(`/tickets/${sale.bookingRef}`).expect(200);
  expect(ticket.text).toContain(sale.bookingRef);

  const admin = await login('admin@classictrip.test');
  const agentSalesCsv = await admin.get('/admin/reports/agent-sales.csv').expect(200);
  expect(agentSalesCsv.text).toContain('Sale,Booking,Customer,Listing,Payment method,Amount,Status');
  expect(agentSalesCsv.text).toContain(sale.saleRef);

  const promoterCsv = await promoter.get('/promoter/reports/offline-sales.csv').expect(200);
  expect(promoterCsv.text).toContain(sale.saleRef);
});
