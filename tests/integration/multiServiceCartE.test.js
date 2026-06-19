const request = require('supertest');
const app = require('../../src/app');
const store = require('../../src/services/data/persistentStore');
const companyService = require('../../src/services/company/companyService');
const hotelService = require('../../src/services/hotel/hotelService');

describe('Master section E - Multi-service cart and checkout', () => {
  test('E is end-to-end: one cart validates bus seats + hotel rooms, pays once, issues many ticket legs, records ledger/audit/reports and recovery states', async () => {
    const stamp = Date.now();
    const companyId = 'company-01';

    const busListing = await companyService.createListing(companyId, {
      serviceType: 'bus',
      title: `E Cart Bus ${stamp}`,
      from: 'Kampala',
      to: 'Jinja',
      priceFrom: 40000,
      cancellationRules: 'Cart bus cancellation applies per ticket leg.',
      status: 'active',
    });
    const route = await companyService.createRoute(companyId, {
      listingId: busListing.id,
      origin: 'Kampala',
      destination: 'Jinja',
      status: 'active',
    });
    const vehicle = await companyService.createVehicle(companyId, {
      listingId: busListing.id,
      name: `E Coach ${stamp}`,
      plateOrCode: `UEE${String(stamp).slice(-3)}`,
      totalSeats: 8,
      status: 'active',
    });
    const { schedule } = await companyService.createSchedule(companyId, {
      routeId: route.id,
      vehicleId: vehicle.id,
      departAt: new Date(Date.now() + 3 * 86400000).toISOString(),
      totalSeats: 8,
      basePrice: 45000,
      status: 'active',
    });

    const hotelListing = await companyService.createListing(companyId, {
      serviceType: 'hotel',
      title: `E Cart Hotel ${stamp}`,
      city: 'Kampala',
      country: 'Uganda',
      priceFrom: 160000,
      status: 'active',
    });
    const property = await hotelService.createProperty(companyId, { listingId: hotelListing.id, propertyName: `E Hotel ${stamp}`, city: 'Kampala' });
    const { roomType } = await hotelService.createRoomType(companyId, { listingId: hotelListing.id, propertyId: property.id, name: `E Deluxe ${stamp}`, basePrice: 160000, capacity: 2, defaultInventory: 2 });
    await hotelService.createRoomUnits(companyId, { roomTypeId: roomType.id, unitNumbers: `1801-${stamp},1802-${stamp}` });
    const checkIn = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    const checkOut = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    await hotelService.createNightInventory(companyId, { roomTypeId: roomType.id, startDate: checkIn, endDate: checkOut, price: 170000, status: 'available' });

    const createRes = await request(app).post('/api/bookings/cart').send({
      fullName: 'E Cart Buyer',
      email: `e-cart-${stamp}@classictrip.test`,
      phone: '+256701000001',
      couponCode: 'CLASSI90',
    }).expect(201);
    const cartRef = createRes.body.cart.cartRef;
    expect(cartRef).toMatch(/^CART-/);

    await request(app).post(`/api/bookings/cart/${cartRef}/items`).send({
      serviceType: 'bus',
      listingId: busListing.id,
      scheduleId: schedule.id,
      selectedSeats: ['1', '2'],
      passengers: [
        { fullName: 'E Passenger One', email: `e-p1-${stamp}@classictrip.test`, phone: '+256701000002' },
        { fullName: 'E Passenger Two', email: `e-p2-${stamp}@classictrip.test`, phone: '+256701000003' },
      ],
    }).expect(201);
    await request(app).post(`/api/bookings/cart/${cartRef}/items`).send({
      serviceType: 'hotel',
      listingId: hotelListing.id,
      roomTypeId: roomType.id,
      roomCount: 1,
      checkIn,
      checkOut,
      guests: [{ fullName: 'E Hotel Guest', email: `e-hotel-${stamp}@classictrip.test`, phone: '+256701000004' }],
    }).expect(201);

    const validation = await request(app).post(`/api/bookings/cart/${cartRef}/validate`).send({}).expect(200);
    expect(validation.body.cart.status).toBe('validated');
    expect(validation.body.cart.pricing.discount).toBeGreaterThan(0);
    expect(validation.body.cart.validation.lines).toHaveLength(3);

    const checkout = await request(app).post(`/api/bookings/cart/${cartRef}/checkout`).send({ paymentProvider: 'mock' }).expect(201);
    expect(checkout.body.cart.status).toBe('checked_out');
    expect(checkout.body.booking.serviceType).toBe('cart');
    expect(checkout.body.booking.bookingItems).toHaveLength(3);
    expect(checkout.body.booking.ticketLegs).toHaveLength(3);
    expect(checkout.body.payment.metadata.cartRef).toBe(cartRef);

    const booking = store.findBooking(checkout.body.booking.bookingRef);
    expect(booking.cartRef).toBe(cartRef);
    expect(booking.ticketLegs.map((leg) => leg.passengerName)).toEqual(expect.arrayContaining(['E Passenger One', 'E Passenger Two', 'E Hotel Guest']));
    expect(store.seatsForSchedule(schedule.id).filter((seat) => ['1', '2'].includes(seat.seatNumber)).every((seat) => seat.status === 'taken')).toBe(true);
    expect(store.state.roomNightInventories.filter((night) => night.bookingRef === booking.bookingRef)).toHaveLength(2);
    expect(store.state.payments.filter((payment) => payment.metadata?.cartRef === cartRef)).toHaveLength(1);
    expect(store.state.walletTransactions.some((txn) => txn.referenceType === 'cart_booking' && txn.referenceId === booking.id)).toBe(true);
    expect(store.state.commissions.some((commission) => commission.bookingRef === booking.bookingRef)).toBe(true);
    expect(store.state.notifications.some((note) => note.referenceType === 'cart_booking' && note.referenceId === booking.id)).toBe(true);
    expect(store.state.auditLogs.some((log) => log.action === 'cart.checkout.completed' && log.targetId === cartRef)).toBe(true);

    const cartPage = await request(app).get(`/cart/${cartRef}`).expect(200);
    expect(cartPage.text).toContain('Multi-service cart');
    expect(cartPage.text).toContain(cartRef);

    const adminDashboard = store.dashboardData('admin');
    expect(adminDashboard.carts.some((row) => row[0] === cartRef && row[5] === 'checked_out')).toBe(true);
    expect(adminDashboard.cartCheckouts.some((row) => row[1] === cartRef && row[5] === 'completed')).toBe(true);

    const cartsCsv = await request(app).get('/admin/reports/carts.csv').expect(302);
    expect(cartsCsv.headers.location).toContain('/login');

    const paymentFailedCart = await request(app).post('/api/bookings/cart').send({ fullName: 'E Recovery Buyer', email: `e-recover-${stamp}@classictrip.test`, phone: '+256701000005' }).expect(201);
    const recoveryRef = paymentFailedCart.body.cart.cartRef;
    await request(app).post(`/api/bookings/cart/${recoveryRef}/items`).send({
      serviceType: 'bus', listingId: busListing.id, scheduleId: schedule.id, selectedSeats: ['3'],
      passengers: [{ fullName: 'E Recovery Passenger', email: `e-rec-${stamp}@classictrip.test`, phone: '+256701000006' }],
    }).expect(201);
    const failed = await request(app).post(`/api/bookings/cart/${recoveryRef}/checkout`).send({ forcePaymentFailure: true }).expect(409);
    expect(failed.body.cart.status).toBe('payment_failed');
    expect(failed.body.cart.recoveryState.type).toBe('payment_failed');
    expect(store.seatsForSchedule(schedule.id).find((seat) => seat.seatNumber === '3').status).not.toBe('taken');
    await request(app).post(`/api/bookings/cart/${recoveryRef}/recover`).send({ reason: 'retry payment' }).expect(200);
    expect(store.state.carts.find((cart) => cart.cartRef === recoveryRef).status).toBe('draft');

    const invalidCart = await request(app).post('/api/bookings/cart').send({ fullName: 'Future Buyer', email: `future-${stamp}@classictrip.test`, phone: '+256701000007' }).expect(201);
    const flightListing = { ...busListing, id: `flight-e-${stamp}`, slug: `flight-e-${stamp}`, serviceType: 'flight', title: `E Future Flight ${stamp}`, bookable: true, status: 'active' };
    store.state.listings.push(flightListing);
    await request(app).post(`/api/bookings/cart/${invalidCart.body.cart.cartRef}/items`).send({ serviceType: 'flight', listingId: flightListing.id, passengers: [{ fullName: 'Future Passenger', email: `f-${stamp}@classictrip.test`, phone: '+256701000008' }] }).expect(201);
    const futureValidation = await request(app).post(`/api/bookings/cart/${invalidCart.body.cart.cartRef}/validate`).send({}).expect(409);
    expect(futureValidation.body.error || futureValidation.text).toBeTruthy();
    expect(store.state.carts.find((cart) => cart.cartRef === invalidCart.body.cart.cartRef).recoveryState.type).toBe('coming_soon_service');
  });
});
