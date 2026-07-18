const companies = require('./seedCompanies');
const listings = require('./seedListings');
const blogs = require('./seedBlogs');
const categories = require('./categories');
const users = require('./admin');
const calculateCommission = require('../utils/calculateCommission');

function buildRoutes(seedListings = listings) {
  return seedListings
    .filter((listing) => listing.serviceType === 'bus')
    .map((listing, index) => ({
      id: `route-${String(index + 1).padStart(3, '0')}`,
      listingId: listing.id,
      companyId: listing.companyId,
      origin: listing.from,
      destination: listing.to,
      corridor: listing.corridor,
      boardingPoints: [`${listing.from} Central`, `${listing.from} Office`, `${listing.from} Terminal`],
      dropoffPoints: [`${listing.to} Central`, `${listing.to} Office`, `${listing.to} Terminal`],
      baggageRules: listing.baggageRules,
      cancellationRules: listing.cancellationRules,
      status: 'active',
    }));
}

function buildVehicleSeats(totalSeats) {
  return Array.from({ length: totalSeats }).map((_, index) => {
    const row = Math.floor(index / 4);
    const seatNumber = String(index + 1);
    return {
      id: seatNumber,
      seatNumber,
      row: row + 1,
      col: (index % 4) + 1,
      label: seatNumber,
      displayLabel: `Seat No ${seatNumber}`,
      isAisle: false,
      isDisabled: false,
    };
  });
}

function buildVehicles(routes, seedListings = listings) {
  return routes.map((route, index) => {
    const listing = seedListings.find((item) => item.id === route.listingId) || {};
    const layoutName = listing.layout === 'bus-2-1' ? '2x1' : listing.layout === 'bus-sleeper' ? 'sleeper' : '2x2';
    const totalSeats = layoutName === '2x1' ? 36 : layoutName === 'sleeper' ? 32 : 48;
    return {
      id: `vehicle-${String(index + 1).padStart(3, '0')}`,
      companyId: route.companyId,
      listingId: route.listingId,
      serviceType: listing.serviceType || 'bus',
      name: `${listing.companyName || listing.partner || 'Partner'} ${listing.type || 'Coach'} ${index + 1}`,
      plateOrCode: `CT-${String(index + 1).padStart(3, '0')}`,
      layoutName,
      rows: Math.ceil(totalSeats / 4),
      cols: 4,
      totalSeats,
      seats: buildVehicleSeats(totalSeats),
      amenities: ['Reclining seats', 'USB charging', 'Ticket scanner'],
      media: listing.media || [],
      status: 'active',
    };
  });
}

function buildSchedules(routes, seedListings = listings, vehicles = []) {
  const dates = [1, 2, 3, 4, 5, 7, 10];
  // Anchor to "today" (not a fixed calendar date) so seeded departures never silently
  // age into the past - they always start tomorrow and run about two weeks out.
  const anchor = new Date();
  anchor.setUTCHours(0, 0, 0, 0);
  const schedules = [];
  for (const route of routes) {
    const listing = seedListings.find((item) => item.id === route.listingId);
    const vehicle = vehicles.find((item) => item.listingId === route.listingId && item.companyId === route.companyId);
    dates.slice(0, 3 + (schedules.length % 3)).forEach((offset, i) => {
      const departAt = new Date(anchor.getTime() + offset * 24 * 60 * 60 * 1000 + (5 + i * 4) * 60 * 60 * 1000 + 30 * 60 * 1000);
      const totalSeats = Number(vehicle?.totalSeats || 48);
      schedules.push({
        id: `schedule-${String(schedules.length + 1).padStart(4, '0')}`,
        routeId: route.id,
        listingId: route.listingId,
        companyId: route.companyId,
        vehicleId: vehicle?.id || '',
        vehicleName: vehicle?.name || '',
        departAt: departAt.toISOString(),
        arriveAt: new Date(departAt.getTime() + 1000 * 60 * 60 * (4 + (i % 8))).toISOString(),
        basePrice: listing.priceFrom + i * 5000,
        currency: 'UGX',
        totalSeats,
        availableSeats: Math.max(9, totalSeats - (i * 6 + schedules.length) % 30),
        status: 'active',
      });
    });
  }
  return schedules;
}

function buildSeats(schedules) {
  const seats = [];
  for (const schedule of schedules) {
    for (let localIndex = 0; localIndex < Number(schedule.totalSeats || 0); localIndex += 1) {
      const rowIndex = Math.floor(localIndex / 4);
      const index = seats.length;
      const seatNumber = String(localIndex + 1);
      seats.push({
        id: `seat-${String(index + 1).padStart(5, '0')}`,
        scheduleId: schedule.id,
        seatNumber,
        seatClass: rowIndex < 2 ? 'VIP' : 'Standard',
        priceDelta: rowIndex < 2 ? 15000 : 0,
        status: index % 17 === 0 ? 'taken' : 'available',
        lockedUntil: null,
      });
    }
  }
  return seats;
}

function buildRooms(seedListings = listings) {
  const roomTypes = ['Standard Queen', 'Twin Room', 'Executive Suite', 'Family Apartment', 'Villa Room'];
  const rooms = [];
  seedListings.filter((listing) => listing.serviceType === 'hotel').forEach((listing) => {
    roomTypes.forEach((roomType, index) => {
      rooms.push({
        id: `room-${String(rooms.length + 1).padStart(4, '0')}`,
        listingId: listing.id,
        companyId: listing.companyId,
        roomType,
        capacity: index < 2 ? 2 : index === 2 ? 3 : 4,
        nightlyPrice: listing.priceFrom + index * 35000,
        inventory: Math.max(1, 8 - index - (rooms.length % 3)),
        amenities: ['WiFi', 'Breakfast option', 'Private bathroom', index > 1 ? 'Workspace' : 'TV'].filter(Boolean),
        media: listing.media,
        status: 'active',
      });
    });
  });
  return rooms;
}

function buildPromoterLinks(seedListings = listings) {
  const promoter = users.find((u) => u.role === 'promoter');
  return seedListings.filter((item) => item.bookable).slice(0, 12).map((listing, index) => ({
    id: `promoter-link-${String(index + 1).padStart(3, '0')}`,
    promoterId: promoter.id,
    listingId: listing.id,
    code: `${promoter.referralCode}-${index + 1}`,
    referralCode: `${promoter.referralCode}-${index + 1}`,
    url: `/listings/${listing.serviceType}/${listing.slug}?ref=${promoter.referralCode}-${index + 1}`,
    clicks: 120 + index * 31,
    conversions: 4 + index,
    status: 'active',
  }));
}

function buildBookings(seedListings = listings) {
  const sample = seedListings.filter((x) => x.bookable).slice(0, 10);
  return sample.map((listing, index) => {
    const total = listing.priceFrom + 7750;
    const hasReferral = index % 2 === 0;
    const split = calculateCommission(total, hasReferral);
    return {
      id: `booking-${String(index + 1).padStart(4, '0')}`,
      bookingRef: `CT-${listing.serviceType.toUpperCase()}-${1042 + index}`,
      serviceType: listing.serviceType,
      guestSnapshot: { fullName: index % 2 ? 'Brian Okello' : 'Amina Nakanwagi', email: index % 2 ? 'brian@classictrip.test' : 'amina@classictrip.test', phone: '+256700000004' },
      customerUserId: index % 2 ? null : 'user-customer-001',
      companyId: listing.companyId,
      listingId: listing.id,
      scheduleId: null,
      passengers: [{ fullName: index % 2 ? 'Brian Okello' : 'Amina Nakanwagi', seatOrRoom: listing.serviceType === 'bus' ? String((index % 40) + 1) : `Room ${201 + index}` }],
      pricing: { subtotal: listing.priceFrom, fees: 7750, total, currency: 'UGX', split },
      promoterAttribution: hasReferral ? { promoterId: 'user-promoter-001', linkId: `promoter-link-${String(index + 1).padStart(3, '0')}`, code: 'CT-DEMO-1' } : null,
      paymentStatus: 'successful',
      bookingStatus: index % 3 === 0 ? 'completed' : 'confirmed',
      qrCodeValue: `CLASSIC-TRIP:${listing.serviceType}:${1042 + index}`,
      createdAt: new Date(Date.UTC(2026, 4, 10 + index)).toISOString(),
    };
  });
}

function buildWallets(seedCompanies = companies) {
  const wallets = [
    { id: 'wallet-platform-001', ownerType: 'platform', ownerId: 'platform', currency: 'UGX', availableBalance: 8420000, pendingBalance: 0 },
    { id: 'wallet-promoter-001', ownerType: 'promoter', ownerId: 'user-promoter-001', currency: 'UGX', availableBalance: 820000, pendingBalance: 310000 },
  ];
  seedCompanies.forEach((company, index) => wallets.push({
    id: company.walletId,
    ownerType: 'company',
    ownerId: company.id,
    currency: 'UGX',
    availableBalance: 500000 + index * 210000,
    pendingBalance: 100000 + index * 67000,
  }));
  return wallets;
}

function buildOperations() {
  return {
    supportTickets: [
      { id: 'support-001', subject: 'Passenger cannot find ticket', ownerType: 'customer', status: 'open', priority: 'high' },
      { id: 'support-002', subject: 'Partner wants route boost', ownerType: 'company', status: 'pending', priority: 'medium' },
      { id: 'support-003', subject: 'Promoter withdrawal proof', ownerType: 'promoter', status: 'resolved', priority: 'low' },
    ],
    refundRequests: [
      { id: 'refund-001', bookingRef: 'CT-BUS-1044', amount: 55000, status: 'reviewing', reason: 'Operator schedule changed' },
      { id: 'refund-002', bookingRef: 'CT-HOTEL-1047', amount: 185000, status: 'approved', reason: 'Guest cancellation within window' },
    ],
    promotionCampaigns: [
      { id: 'campaign-001', companyId: 'company-01', listingId: 'bus-001', name: 'Juba route boost', placement: 'route_boost', budget: 800000, clicks: 1240, bookings: 32, status: 'active' },
      { id: 'campaign-002', companyId: 'company-06', listingId: 'hotel-021', name: 'Kampala hotel feature', placement: 'homepage_feature', budget: 500000, clicks: 870, bookings: 18, status: 'active' },
    ],
    auditLogs: [
      { id: 'audit-001', actorId: 'user-admin-001', action: 'company.approved', target: 'company-01', createdAt: new Date().toISOString() },
      { id: 'audit-002', actorId: 'user-employee-001', action: 'ticket.scanned', target: 'CT-BUS-1042', createdAt: new Date().toISOString() },
    ],
  };
}


function buildCompanyOperations(seedCompanies = companies) {
  const branches = [];
  const policies = [];
  const employees = [];
  seedCompanies.forEach((company, index) => {
    branches.push({
      id: `branch-${String(index + 1).padStart(3, '0')}`,
      companyId: company.id,
      name: `${company.city || 'Main'} branch`,
      city: company.city || 'Kampala',
      country: company.country || 'Uganda',
      address: `${company.city || 'Kampala'} central office`,
      phone: company.supportContacts?.phone || '+256700000000',
      status: 'active',
    });
    policies.push({
      id: `policy-${String(index + 1).padStart(3, '0')}`,
      companyId: company.id,
      title: `${company.companyType === 'hotel' ? 'Guest stay' : 'Passenger'} service policy`,
      policyType: company.companyType === 'hotel' ? 'hotel' : 'transport',
      body: company.companyType === 'hotel'
        ? 'Guests must present booking confirmation and valid contact details at check-in.'
        : 'Passengers must arrive before departure with a valid ticket QR code.',
      status: 'active',
      effectiveFrom: new Date(Date.UTC(2026, 4, 1)).toISOString(),
    });
    if (index < 8) {
      const userIndex = String(index + 1).padStart(3, '0');
      employees.push({
        id: `company-employee-${userIndex}`,
        companyId: company.id,
        userId: index === 0 ? 'user-employee-001' : `seed-employee-${userIndex}`,
        fullName: index === 0 ? 'Gate Scanner' : `${company.name} Staff ${index + 1}`,
        roleTitle: company.companyType === 'hotel' ? 'Front desk operator' : 'Boarding scanner',
        branch: company.city || 'Main branch',
        permissions: ['view_bookings', 'scan_tickets', 'view_manifest'],
        status: 'active',
        invitedAt: new Date(Date.UTC(2026, 4, 3 + index)).toISOString(),
        acceptedAt: new Date(Date.UTC(2026, 4, 4 + index)).toISOString(),
      });
    }
  });
  return { branches, policies, employees };
}

function buildRouteStops(routes = []) {
  const stops = [];
  routes.forEach((route, index) => {
    [
      { name: `${route.origin} Central`, stopType: 'boarding', stopOrder: 1 },
      { name: `${route.origin} Office`, stopType: 'boarding', stopOrder: 2 },
      { name: `${route.destination} Central`, stopType: 'dropoff', stopOrder: 3 },
    ].forEach((stop, stopIndex) => stops.push({
      id: `route-stop-${String(index + 1).padStart(3, '0')}-${stopIndex + 1}`,
      routeId: route.id,
      listingId: route.listingId,
      companyId: route.companyId,
      name: stop.name,
      stopType: stop.stopType,
      stopOrder: stop.stopOrder,
      city: stop.name.split(' ')[0],
      status: 'active',
    }));
  });
  return stops;
}

function buildDriverOperations(seedCompanies = companies, schedules = []) {
  const busCompanies = seedCompanies.filter((company) => company.companyType === 'bus').slice(0, 8);
  const assignments = [];
  const incidents = [];
  const tripStatusUpdates = [];
  busCompanies.forEach((company, index) => {
    const schedule = schedules.find((item) => item.companyId === company.id) || schedules[index];
    if (!schedule) return;
    assignments.push({
      id: `driver-assignment-${String(index + 1).padStart(3, '0')}`,
      companyId: company.id,
      employeeId: index === 0 ? 'user-employee-001' : `seed-driver-${String(index + 1).padStart(3, '0')}`,
      scheduleId: schedule.id,
      vehicleId: schedule.vehicleId,
      driverName: `${company.name} Driver ${index + 1}`,
      phone: `+25670010${String(index + 1).padStart(3, '0')}`,
      status: 'assigned',
      assignedAt: new Date(Date.UTC(2026, 4, 15 + index)).toISOString(),
    });
    tripStatusUpdates.push({
      id: `trip-status-${String(index + 1).padStart(3, '0')}`,
      companyId: company.id,
      scheduleId: schedule.id,
      listingId: schedule.listingId,
      status: index % 3 === 0 ? 'boarding' : 'scheduled',
      message: index % 3 === 0 ? 'Boarding gate is open.' : 'Trip is scheduled and on time.',
      updatedBy: 'user-employee-001',
      updatedAt: new Date(Date.UTC(2026, 4, 20 + index)).toISOString(),
    });
    if (index < 3) {
      incidents.push({
        id: `driver-incident-${String(index + 1).padStart(3, '0')}`,
        companyId: company.id,
        employeeId: assignments[index]?.employeeId,
        scheduleId: schedule.id,
        incidentType: index === 0 ? 'delay' : 'customer_support',
        severity: index === 0 ? 'medium' : 'low',
        notes: index === 0 ? 'Demo delay report for operational workflow.' : 'Demo passenger assistance incident.',
        status: index === 0 ? 'open' : 'resolved',
        reportedAt: new Date(Date.UTC(2026, 4, 21 + index)).toISOString(),
      });
    }
  });
  return { assignments, incidents, tripStatusUpdates };
}

function buildHotelInventory(seedListings = listings, seedRooms = rooms) {
  const hotelListings = seedListings.filter((listing) => listing.serviceType === 'hotel');
  const hotelProperties = [];
  const roomTypes = [];
  const roomUnits = [];
  const roomNightInventories = [];
  // Anchor to "today" so seeded room-night availability never silently ages into the past.
  const inventoryAnchor = new Date();
  inventoryAnchor.setUTCHours(0, 0, 0, 0);
  const stayRules = [];
  hotelListings.forEach((listing, listingIndex) => {
    const propertyId = `hotel-property-${String(listingIndex + 1).padStart(3, '0')}`;
    hotelProperties.push({
      id: propertyId,
      companyId: listing.companyId,
      listingId: listing.id,
      propertyName: listing.title,
      address: listing.address || `${listing.city || 'Kampala'} central`,
      city: listing.city,
      country: listing.country || 'Uganda',
      checkInTime: listing.checkInTime || '14:00',
      checkOutTime: listing.checkOutTime || '10:00',
      amenities: listing.amenities || [],
      status: 'active',
    });
    const listingRooms = seedRooms.filter((room) => room.listingId === listing.id).slice(0, 3);
    listingRooms.forEach((room, roomIndex) => {
      const roomTypeId = `room-type-${String(roomTypes.length + 1).padStart(4, '0')}`;
      roomTypes.push({
        id: roomTypeId,
        companyId: listing.companyId,
        listingId: listing.id,
        propertyId,
        name: room.roomType || `Room type ${roomIndex + 1}`,
        capacity: room.capacity || 2,
        basePrice: room.nightlyPrice || listing.priceFrom,
        amenities: room.amenities || listing.amenities || [],
        images: room.media || listing.media || [],
        policies: ['Valid contact required at check-in', 'Cancellation follows property policy'],
        status: 'active',
      });
      const unitCount = Math.max(1, Math.min(3, Number(room.inventory || 1)));
      for (let unitIndex = 0; unitIndex < unitCount; unitIndex += 1) {
        const unitId = `room-unit-${String(roomUnits.length + 1).padStart(5, '0')}`;
        roomUnits.push({
          id: unitId,
          companyId: listing.companyId,
          listingId: listing.id,
          propertyId,
          roomTypeId,
          roomId: room.id,
          unitNumber: `${roomIndex + 1}${String(unitIndex + 1).padStart(2, '0')}`,
          floor: roomIndex + 1,
          housekeepingStatus: unitIndex % 3 === 0 ? 'clean' : 'ready',
          status: 'available',
        });
      }
      for (let day = 0; day < 14; day += 1) {
        const date = new Date(inventoryAnchor.getTime() + day * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        roomNightInventories.push({
          id: `room-night-${room.id}-${date}`,
          companyId: listing.companyId,
          listingId: listing.id,
          propertyId,
          roomTypeId,
          roomId: room.id,
          date,
          totalInventory: Number(room.inventory || 1),
          availableInventory: Math.max(0, Number(room.inventory || 1) - (day % 3)),
          price: Number(room.nightlyPrice || listing.priceFrom || 0) + (day % 4) * 10000,
          currency: listing.currency || 'UGX',
          status: 'open',
        });
      }
    });
    stayRules.push({
      id: `stay-rule-${String(listingIndex + 1).padStart(3, '0')}`,
      companyId: listing.companyId,
      listingId: listing.id,
      propertyId,
      ruleType: 'cancellation',
      title: 'Standard guest cancellation rule',
      description: listing.cancellationRules || 'Free cancellation before the property cutoff time.',
      status: 'active',
    });
  });
  return { hotelProperties, roomTypes, roomUnits, roomNightInventories, stayRules };
}

function buildBookingArtifacts(bookings = []) {
  const passengers = [];
  const payments = [];
  const paymentIntents = [];
  const receiptInvoices = [];
  const taxFeeRecords = [];
  const bookingTimelineEvents = [];
  const correspondenceMessages = [];
  const notifications = [];
  const notificationDeliveryAttempts = [];
  const commissions = [];
  const campaignConversions = [];
  bookings.forEach((booking, index) => {
    const bookingId = booking.id;
    const amount = Number(booking.pricing?.total || booking.grossAmount || 0);
    const paymentId = `payment-${String(index + 1).padStart(4, '0')}`;
    payments.push({
      id: paymentId,
      bookingId,
      bookingRef: booking.bookingRef,
      companyId: booking.companyId,
      customerUserId: booking.customerUserId,
      provider: 'mock',
      providerReference: `MOCK-${booking.bookingRef}`,
      paymentRef: `PAY-${booking.bookingRef}`,
      methodNote: 'Seeded successful demo payment',
      amount,
      grossAmount: amount,
      currency: booking.pricing?.currency || 'UGX',
      status: 'successful',
      settlementStatus: index % 2 ? 'pending' : 'settled',
      platformPercent: booking.pricing?.split?.platformPercent || 10,
      platformAmount: booking.pricing?.split?.platformFee || 0,
      promoterPercent: booking.pricing?.split?.promoterPercent || 0,
      promoterAmount: booking.pricing?.split?.promoterCommission || 0,
      ownerAmount: booking.pricing?.split?.companyEarning || amount,
      paidAt: booking.createdAt,
      idempotencyKey: `seed-${booking.bookingRef}`,
      metadata: { seed: true },
    });
    paymentIntents.push({
      id: `payment-intent-${String(index + 1).padStart(4, '0')}`,
      idempotencyKey: `intent-${booking.bookingRef}`,
      bookingId,
      bookingRef: booking.bookingRef,
      provider: 'mock',
      providerReference: `MOCK-${booking.bookingRef}`,
      amount,
      currency: booking.pricing?.currency || 'UGX',
      status: 'successful',
      checkoutUrl: `/ticket/${booking.bookingRef}`,
      metadata: { seed: true },
    });
    (booking.passengers || []).forEach((passenger, passengerIndex) => passengers.push({
      id: `passenger-${String(passengers.length + 1).padStart(5, '0')}`,
      bookingId,
      bookingRef: booking.bookingRef,
      companyId: booking.companyId,
      listingId: booking.listingId,
      scheduleId: booking.scheduleId,
      passengerIndex,
      fullName: passenger.fullName || booking.guestSnapshot?.fullName,
      phone: booking.guestSnapshot?.phone,
      email: booking.guestSnapshot?.email,
      seatOrRoom: passenger.seatOrRoom,
      seatNumber: passenger.seatOrRoom,
      pickupPoint: passenger.pickupPoint || '',
      dropoffPoint: passenger.dropoffPoint || '',
      specialNotes: passenger.specialNotes || 'Seed passenger record',
    }));
    receiptInvoices.push({
      id: `receipt-${String(index + 1).padStart(4, '0')}`,
      documentRef: `RCT-${booking.bookingRef}`,
      documentType: 'receipt',
      bookingId,
      bookingRef: booking.bookingRef,
      paymentId,
      companyId: booking.companyId,
      customerUserId: booking.customerUserId,
      customerName: booking.guestSnapshot?.fullName,
      customerEmail: booking.guestSnapshot?.email,
      serviceType: booking.serviceType,
      subtotal: booking.pricing?.subtotal || 0,
      fees: booking.pricing?.fees || 0,
      taxes: 0,
      total: amount,
      currency: booking.pricing?.currency || 'UGX',
      status: 'issued',
      issuedAt: booking.createdAt,
    });
    taxFeeRecords.push({
      id: `tax-fee-${String(index + 1).padStart(4, '0')}`,
      bookingId,
      bookingRef: booking.bookingRef,
      paymentId,
      companyId: booking.companyId,
      currency: booking.pricing?.currency || 'UGX',
      subtotal: booking.pricing?.subtotal || 0,
      serviceFee: booking.pricing?.fees || 0,
      taxAmount: 0,
      providerFee: Math.round(amount * 0.01),
      totalFees: (booking.pricing?.fees || 0) + Math.round(amount * 0.01),
      status: 'recorded',
      recordedAt: booking.createdAt,
    });
    ['created', 'payment_successful', 'ticket_issued'].forEach((eventName, eventIndex) => bookingTimelineEvents.push({
      id: `timeline-${String(bookingTimelineEvents.length + 1).padStart(5, '0')}`,
      bookingId,
      bookingRef: booking.bookingRef,
      eventType: eventName,
      title: eventName.replace(/_/g, ' '),
      message: `Seed ${eventName} event for ${booking.bookingRef}`,
      actorType: eventIndex === 0 ? 'customer' : 'system',
      createdAt: booking.createdAt,
    }));
    correspondenceMessages.push({
      id: `correspondence-${String(index + 1).padStart(4, '0')}`,
      bookingId,
      bookingRef: booking.bookingRef,
      ownerType: 'customer',
      ownerId: booking.customerUserId || booking.guestSnapshot?.phone,
      subject: `Booking ${booking.bookingRef} support thread`,
      message: 'Seed support correspondence thread for customer and operator visibility.',
      audience: 'customer',
      status: 'open',
      createdAt: booking.createdAt,
    });
    const notificationId = `notification-${String(index + 1).padStart(4, '0')}`;
    notifications.push({
      id: notificationId,
      userId: booking.customerUserId,
      ownerType: 'customer',
      ownerId: booking.customerUserId,
      audience: 'customer',
      channels: ['email', 'sms'],
      title: `Ticket issued ${booking.bookingRef}`,
      message: `Your Classic Trip booking ${booking.bookingRef} is confirmed.`,
      recipient: booking.guestSnapshot,
      referenceType: 'booking',
      referenceId: bookingId,
      status: 'sent',
      deliveryStatus: 'delivered',
      sentCount: 2,
      deliveredCount: 2,
      sentAt: booking.createdAt,
    });
    ['email', 'sms'].forEach((channel) => notificationDeliveryAttempts.push({
      id: `delivery-${String(notificationDeliveryAttempts.length + 1).padStart(5, '0')}`,
      notificationId,
      channel,
      provider: channel === 'email' ? 'smtp-demo' : 'sms-demo',
      recipient: channel === 'email' ? booking.guestSnapshot?.email : booking.guestSnapshot?.phone,
      status: 'delivered',
      attemptNumber: 1,
      response: { seed: true },
      attemptedAt: booking.createdAt,
    }));
    if (booking.promoterAttribution?.promoterId) {
      commissions.push({
        id: `commission-${String(commissions.length + 1).padStart(4, '0')}`,
        bookingId,
        promoterId: booking.promoterAttribution.promoterId,
        companyId: booking.companyId,
        platformFee: booking.pricing?.split?.platformFee || 0,
        promoterAmount: booking.pricing?.split?.promoterCommission || 0,
        companyAmount: booking.pricing?.split?.companyEarning || 0,
        status: index % 2 ? 'pending' : 'released',
        releasedAt: index % 2 ? null : booking.createdAt,
      });
      campaignConversions.push({
        id: `campaign-conversion-${String(campaignConversions.length + 1).padStart(4, '0')}`,
        bookingId,
        bookingRef: booking.bookingRef,
        promoterId: booking.promoterAttribution.promoterId,
        linkId: booking.promoterAttribution.linkId,
        listingId: booking.listingId,
        companyId: booking.companyId,
        amount,
        currency: booking.pricing?.currency || 'UGX',
        commissionAmount: booking.pricing?.split?.promoterCommission || 0,
        status: 'confirmed',
        convertedAt: booking.createdAt,
      });
    }
  });
  return { passengers, payments, paymentIntents, receiptInvoices, taxFeeRecords, bookingTimelineEvents, correspondenceMessages, notifications, notificationDeliveryAttempts, commissions, campaignConversions };
}

function buildFinanceArtifacts(seedWallets = [], bookings = []) {
  const walletTransactions = [];
  seedWallets.forEach((wallet, index) => {
    walletTransactions.push({
      id: `wallet-tx-${String(index + 1).padStart(4, '0')}`,
      walletId: wallet.id,
      ownerType: wallet.ownerType,
      ownerId: wallet.ownerId,
      transactionType: 'seed_opening_balance',
      direction: 'credit',
      amount: Number(wallet.availableBalance || 0),
      currency: wallet.currency || 'UGX',
      status: 'completed',
      method: 'seed',
      reference: `OPEN-${wallet.id}`,
      referenceType: 'wallet',
      referenceId: wallet.id,
      meta: { seed: true },
    });
  });
  const grossPayments = bookings.reduce((sum, booking) => sum + Number(booking.pricing?.total || 0), 0);
  const totalPlatformFee = bookings.reduce((sum, booking) => sum + Number(booking.pricing?.split?.platformFee || 0), 0);
  const totalPromoterCommission = bookings.reduce((sum, booking) => sum + Number(booking.pricing?.split?.promoterCommission || 0), 0);
  const totalCompanyEarning = bookings.reduce((sum, booking) => sum + Number(booking.pricing?.split?.companyEarning || 0), 0);
  const settlementBatches = [{
    id: 'settlement-batch-001',
    batchNumber: 'SETTLE-2026-05-DEMO',
    periodStart: new Date(Date.UTC(2026, 4, 1)).toISOString(),
    periodEnd: new Date(Date.UTC(2026, 4, 31)).toISOString(),
    currency: 'UGX',
    status: 'reviewed',
    createdBy: 'user-admin-001',
    reviewedBy: 'user-admin-001',
    reviewedAt: new Date(Date.UTC(2026, 5, 1)).toISOString(),
    totalGross: grossPayments,
    totalCompanyEarning,
    totalPromoterCommission,
    totalPlatformFee,
    totalRefundDebits: 0,
    totalPayable: totalCompanyEarning + totalPromoterCommission,
    rows: bookings.slice(0, 8).map((booking) => ({ bookingRef: booking.bookingRef, companyId: booking.companyId, total: booking.pricing?.total })),
    notes: 'Seed settlement batch backed by MongoDB records.',
  }];
  const payoutRequests = [{
    id: 'payout-request-001', ownerType: 'company', ownerId: 'company-01', walletId: 'wallet-company-01', transactionId: 'wallet-tx-0001', settlementBatchId: 'settlement-batch-001', amount: 650000, currency: 'UGX', payoutMethod: 'Mobile Money', payoutAccount: '+256700000001', status: 'approved', requestedBy: 'user-company-001', requestedAt: new Date(Date.UTC(2026, 5, 2)).toISOString(), reviewedBy: 'user-admin-001', reviewedAt: new Date(Date.UTC(2026, 5, 2)).toISOString(), notes: 'Seed company payout request.' },
    { id: 'payout-request-002', ownerType: 'promoter', ownerId: 'user-promoter-001', walletId: 'wallet-promoter-001', transactionId: 'wallet-tx-0002', settlementBatchId: 'settlement-batch-001', amount: 220000, currency: 'UGX', payoutMethod: 'Mobile Money', payoutAccount: '+256700000005', status: 'requested', requestedBy: 'user-promoter-001', requestedAt: new Date(Date.UTC(2026, 5, 3)).toISOString(), notes: 'Seed promoter withdrawal request.' },
  ];
  const payoutBatches = [{
    id: 'payout-batch-001', batchNumber: 'PAYOUT-2026-05-DEMO', settlementBatchId: 'settlement-batch-001', currency: 'UGX', ownerType: 'mixed', status: 'exported', createdBy: 'user-admin-001', createdAt: new Date(Date.UTC(2026, 5, 3)).toISOString(), exportedAt: new Date(Date.UTC(2026, 5, 3)).toISOString(), totalAmount: 870000, requestIds: ['payout-request-001', 'payout-request-002'], rows: payoutRequests.map((request) => ({ ownerId: request.ownerId, amount: request.amount, status: request.status })), notes: 'Seed payout batch.'
  }];
  const reconciliationReports = [{
    id: 'reconciliation-001', settlementBatchId: 'settlement-batch-001', payoutBatchId: 'payout-batch-001', periodStart: new Date(Date.UTC(2026, 4, 1)).toISOString(), periodEnd: new Date(Date.UTC(2026, 4, 31)).toISOString(), status: 'balanced', createdBy: 'user-admin-001', createdAt: new Date(Date.UTC(2026, 5, 4)).toISOString(), grossPayments, refundDebits: 0, companyEarnings: totalCompanyEarning, promoterCommissions: totalPromoterCommission, platformFees: totalPlatformFee, requestedPayouts: 870000, completedPayouts: 650000, variance: 0, findings: [{ status: 'ok', note: 'Seed reconciliation balanced.' }], notes: 'Seed reconciliation report.'
  }];
  const financeStatements = seedWallets.slice(0, 8).map((wallet, index) => ({
    id: `finance-statement-${String(index + 1).padStart(4, '0')}`,
    statementRef: `STMT-${wallet.id}`,
    ownerType: wallet.ownerType,
    ownerId: wallet.ownerId,
    settlementBatchId: 'settlement-batch-001',
    payoutBatchId: 'payout-batch-001',
    periodStart: new Date(Date.UTC(2026, 4, 1)).toISOString(),
    periodEnd: new Date(Date.UTC(2026, 4, 31)).toISOString(),
    currency: wallet.currency || 'UGX',
    gross: Number(wallet.availableBalance || 0) + Number(wallet.pendingBalance || 0),
    platformFee: index === 0 ? totalPlatformFee : 0,
    companyEarning: wallet.ownerType === 'company' ? Number(wallet.availableBalance || 0) : 0,
    promoterCommission: wallet.ownerType === 'promoter' ? Number(wallet.availableBalance || 0) : 0,
    refundDebits: 0,
    payoutTotal: index < 2 ? 220000 : 0,
    openingBalance: 0,
    closingBalance: Number(wallet.availableBalance || 0),
    status: 'issued',
    generatedBy: 'user-admin-001',
    generatedAt: new Date(Date.UTC(2026, 5, 5)).toISOString(),
    rows: [{ reference: `OPEN-${wallet.id}`, amount: wallet.availableBalance }],
  }));
  const financeRiskReviews = [{ id: 'finance-risk-001', targetType: 'payout', targetId: 'payout-request-002', ownerType: 'promoter', ownerId: 'user-promoter-001', amount: 220000, currency: 'UGX', riskScore: 22, flags: ['seed_review'], status: 'clear', reviewedBy: 'user-admin-001', reviewedAt: new Date(Date.UTC(2026, 5, 3)).toISOString(), notes: 'Seed low-risk payout review.' }];
  return { walletTransactions, settlementBatches, payoutRequests, payoutBatches, reconciliationReports, financeStatements, financeRiskReviews };
}

function buildCartArtifacts(seedListings = listings) {
  const bus = seedListings.find((listing) => listing.serviceType === 'bus' && listing.bookable);
  const hotel = seedListings.find((listing) => listing.serviceType === 'hotel' && listing.bookable);
  const carts = [{
    id: 'cart-001', cartRef: 'CART-DEMO-001', status: 'draft', userId: 'user-customer-001', customer: { fullName: 'Amina Nakanwagi', email: 'amina@classictrip.test', phone: '+256700000004' }, items: [bus, hotel].filter(Boolean).map((listing, index) => ({ itemId: `cart-item-${index + 1}`, serviceType: listing.serviceType, listingId: listing.id, title: listing.title, quantity: 1, price: listing.priceFrom })), holds: [], couponCode: 'DEMO10', pricing: { subtotal: Number(bus?.priceFrom || 0) + Number(hotel?.priceFrom || 0), fees: 12000, total: Number(bus?.priceFrom || 0) + Number(hotel?.priceFrom || 0) + 12000, currency: 'UGX' }, expiresAt: new Date(Date.UTC(2026, 5, 30)).toISOString(), createdBy: 'user-customer-001'
  }];
  const cartCheckoutAttempts = [{ id: 'cart-attempt-001', cartRef: 'CART-DEMO-001', status: 'started', recoveryAction: 'resume_checkout', recoveryUrl: '/cart', inventorySnapshot: carts[0].items, pricingSnapshot: carts[0].pricing, createdBy: 'user-customer-001' }];
  return { carts, cartCheckoutAttempts };
}

function buildFutureServiceArtifacts(seedListings = listings) {
  const modules = ['flight', 'train', 'ferry', 'tour', 'car_rental', 'airport_transfer', 'event', 'cargo', 'visa', 'insurance', 'package'].map((key) => ({
    id: `future-module-${key}`,
    key,
    label: key.split('_').map((part) => part[0].toUpperCase() + part.slice(1)).join(' '),
    releaseStatus: key === 'tour' ? 'pilot-planned' : 'architecture-ready',
    bookable: false,
    featureFlag: `ENABLE_${key.toUpperCase()}_BOOKING`,
    bookingGuard: 'coming_soon_read_only',
    entities: [`${key}_inventory`, 'booking', 'payment', 'support'],
    workflows: ['search preview', 'availability architecture', 'checkout guard', 'support handoff'],
    readinessChecklist: ['provider integration', 'inventory lock', 'payment capture', 'manifest/reporting'],
    status: 'planned',
  }));
  const flightOffers = seedListings.filter((listing) => listing.serviceType === 'flight').slice(0, 6).map((listing, index) => ({ id: `flight-offer-${String(index + 1).padStart(3, '0')}`, airlineId: listing.companyId, airlineName: listing.companyName, offerRef: `FLT-${String(index + 1).padStart(5, '0')}`, originAirport: listing.from || listing.city || 'EBB', destinationAirport: listing.to || 'NBO', currency: listing.currency || 'UGX', totalPrice: listing.priceFrom || 0, segments: [{ segmentId: `seg-${index + 1}`, flightNumber: `CT${100 + index}`, departAirport: listing.from || 'EBB', arriveAirport: listing.to || 'NBO', departAt: new Date(Date.UTC(2026, 6, 1 + index, 8)).toISOString(), arriveAt: new Date(Date.UTC(2026, 6, 1 + index, 10)).toISOString(), cabin: 'Economy' }], baggage: [{ passengerType: 'adult', allowance: '23kg', price: 0 }], ancillaries: [{ code: 'BAG', name: 'Extra baggage', price: 55000 }], status: 'teaser' }));
  const trainInventories = seedListings.filter((listing) => listing.serviceType === 'train').slice(0, 6).map((listing, index) => ({ id: `train-inventory-${String(index + 1).padStart(3, '0')}`, stationCode: `ST${index + 1}`, stationName: listing.from || listing.city || 'Central', routeId: listing.id, originStation: listing.from || 'Origin', destinationStation: listing.to || 'Destination', coachCode: `C${index + 1}`, coachClass: 'Standard', seatNumber: `T${index + 1}`, scheduleId: `future-train-${index + 1}`, departAt: new Date(Date.UTC(2026, 6, 5 + index, 6)).toISOString(), arriveAt: new Date(Date.UTC(2026, 6, 5 + index, 12)).toISOString(), manifestGroup: 'planned', status: 'planned' }));
  const tourPackageInventories = seedListings.filter((listing) => listing.serviceType === 'tour').slice(0, 6).map((listing, index) => ({ id: `tour-inventory-${String(index + 1).padStart(3, '0')}`, packageId: listing.id, packageName: listing.title, tourDate: new Date(Date.UTC(2026, 7, 1 + index)).toISOString(), capacity: 25, availableCapacity: 18 - index, guideId: `guide-${index + 1}`, guideName: `Demo Guide ${index + 1}`, pickupPoints: [listing.city || 'Kampala'], participants: [], status: 'planned' }));
  const carRentalUnits = seedListings.filter((listing) => listing.serviceType === 'car_rental').slice(0, 6).map((listing, index) => ({ id: `car-rental-unit-${String(index + 1).padStart(3, '0')}`, companyId: listing.companyId, vehicleId: `rental-car-${index + 1}`, vehicleName: listing.title, pickupLocationId: listing.city || 'Kampala', returnLocationId: listing.city || 'Kampala', availableFrom: new Date(Date.UTC(2026, 7, 1)).toISOString(), availableTo: new Date(Date.UTC(2026, 8, 1)).toISOString(), withDriverAvailable: true, selfDriveAvailable: index % 2 === 0, requiredDocuments: ['Driving permit', 'National ID'], depositAmount: 250000, status: 'planned' }));
  const eventTicketInventories = seedListings.filter((listing) => listing.serviceType === 'event').slice(0, 6).map((listing, index) => ({ id: `event-ticket-${String(index + 1).padStart(3, '0')}`, venueId: `venue-${index + 1}`, venueName: listing.city || 'Kampala venue', eventId: listing.id, eventName: listing.title, eventDate: new Date(Date.UTC(2026, 8, 10 + index)).toISOString(), ticketTiers: [{ tierId: 'regular', name: 'Regular', capacity: 500, price: listing.priceFrom || 25000 }], seatMapId: `event-seat-map-${index + 1}`, qrEntryEnabled: true, promoterLinkIds: [], status: 'planned' }));
  const cargoShipments = seedListings.filter((listing) => listing.serviceType === 'cargo').slice(0, 6).map((listing, index) => ({ id: `cargo-shipment-${String(index + 1).padStart(3, '0')}`, shipmentRef: `CARGO-${String(index + 1).padStart(5, '0')}`, sender: { name: 'Demo Sender', phone: '+256700000010' }, receiver: { name: 'Demo Receiver', phone: '+256700000011' }, routeId: listing.id, waybillNumber: `WB-${String(index + 1).padStart(5, '0')}`, trackingEvents: [{ status: 'created', location: listing.from || listing.city, at: new Date(Date.UTC(2026, 6, 1 + index)).toISOString(), note: 'Seed cargo workflow.' }], status: 'planned' }));
  const insurancePolicyRecords = [{ id: 'insurance-policy-001', policyNumber: 'INS-DEMO-001', providerId: 'safe-journey-cover', coverageType: 'travel', coverageSummary: 'Seed travel insurance policy record.', premium: 18000, currency: 'UGX', beneficiary: { name: 'Amina Nakanwagi', phone: '+256700000004', email: 'amina@classictrip.test' }, bookingRef: 'CT-BUS-1042', claimLink: '/support', status: 'planned' }];
  const corporateTravelAccounts = [{ id: 'corporate-account-001', companyAccountId: 'classic-technologies', companyName: 'Classic Technologies', employeeTravelers: [{ userId: 'user-customer-001', name: 'Amina Nakanwagi', email: 'amina@classictrip.test' }], approvalWorkflow: [{ level: 1, approverUserId: 'user-admin-001', rule: 'Trips above UGX 500,000' }], monthlyInvoiceId: 'receipt-0001', travelPolicyId: 'policy-001', status: 'planned' }];
  const loyaltyAccounts = [{ id: 'loyalty-account-001', userId: 'user-customer-001', tier: 'Silver', pointsBalance: 2400, walletCreditBalance: 15000, coupons: [{ code: 'WELCOME10', value: 10, expiresAt: new Date(Date.UTC(2026, 11, 31)).toISOString(), status: 'active' }], referralRewards: [{ referralCode: 'AMINA-DEMO', points: 200, status: 'earned' }], status: 'active' }];
  return { futureServiceModules: modules, flightOffers, trainInventories, tourPackageInventories, carRentalUnits, eventTicketInventories, cargoShipments, insurancePolicyRecords, corporateTravelAccounts, loyaltyAccounts };
}

function buildSecurityAndProfileArtifacts() {
  return {
    securityEvents: [{ id: 'security-event-001', userId: 'user-admin-001', eventType: 'login_success', severity: 'low', ip: '127.0.0.1', userAgent: 'seed', status: 'closed', metadata: { seed: true } }],
    loginAudits: [{ id: 'login-audit-001', userId: 'user-admin-001', identity: 'admin@classictrip.test', result: 'success', ip: '127.0.0.1', userAgent: 'seed', createdAt: new Date(Date.UTC(2026, 5, 1)).toISOString() }],
    deviceSessions: [{ id: 'device-session-001', userId: 'user-admin-001', sessionHash: 'seed-device-session-admin', deviceName: 'Seed browser', ip: '127.0.0.1', userAgent: 'seed', status: 'active', lastSeenAt: new Date(Date.UTC(2026, 5, 1)).toISOString() }],
    idempotencyKeyRecords: [{ id: 'idem-001', key: 'seed-CT-BUS-1042', scope: 'payment', status: 'completed', responseHash: 'seed', expiresAt: new Date(Date.UTC(2026, 11, 31)).toISOString() }],
    savedListings: [{ id: 'saved-listing-001', userId: 'user-customer-001', listingId: 'bus-001', serviceType: 'bus', notes: 'Seed saved listing.' }],
    shiftHandovers: [{ id: 'shift-handover-001', userId: 'user-employee-001', employeeId: 'company-employee-001', companyId: 'company-01', branch: 'Kampala branch', shiftDate: '2026-06-01', summary: 'Seed shift handover.', cashCollected: 0, ticketsScanned: 12, status: 'submitted' }],
    agentProfiles: [{ id: 'agent-profile-001', userId: 'user-promoter-001', promoterId: 'user-promoter-001', displayName: 'Samuel Kato', defaultChannel: 'social', bio: 'Seed promoter profile.', status: 'active' }],
    referralClicks: [{ id: 'referral-click-001', promoterId: 'user-promoter-001', linkId: 'promoter-link-001', code: 'CT-DEMO-1', ipHash: 'seed', userAgent: 'seed', landingUrl: '/listings/bus/bus-001', clickedAt: new Date(Date.UTC(2026, 5, 1)).toISOString() }],
    attributionSessions: [{ id: 'attribution-session-001', promoterId: 'user-promoter-001', linkId: 'promoter-link-001', code: 'CT-DEMO-1', sessionKey: 'seed-session', status: 'active', expiresAt: new Date(Date.UTC(2026, 6, 1)).toISOString() }],
    offlineSales: [{ id: 'offline-sale-001', saleRef: 'OFFLINE-DEMO-001', promoterId: 'user-promoter-001', bookingRef: 'CT-BUS-1042', customerName: 'Amina Nakanwagi', customerPhone: '+256700000004', amount: 102750, currency: 'UGX', status: 'confirmed' }],
    fraudSignals: [{ id: 'fraud-signal-001', targetType: 'booking', targetId: 'booking-0001', ownerType: 'customer', ownerId: 'user-customer-001', signalType: 'seed_low_risk', severity: 'low', score: 8, status: 'cleared', metadata: { seed: true } }],
    reviews: [{ id: 'review-001', userId: 'user-customer-001', listingId: 'bus-001', companyId: 'company-01', rating: 5, title: 'Smooth trip', comment: 'Seed review for Mongo dashboard data.', status: 'published' }],
    settings: [
      { key: 'platform.default_currency', group: 'platform', label: 'Default currency', value: 'UGX', editable: true, updatedBy: 'user-admin-001' },
      { key: 'booking.hold_minutes', group: 'booking', label: 'Inventory hold minutes', value: 15, editable: true, updatedBy: 'user-admin-001' },
      { key: 'future_services.guard', group: 'release', label: 'Future service booking guard', value: 'coming_soon_read_only', editable: true, updatedBy: 'user-admin-001' },
    ],
    subscriptions: [{ id: 'subscription-001', companyId: 'company-01', status: 'active', planId: 'growth', planName: 'Growth', currency: 'UGX', price: 250000, startedAt: new Date(Date.UTC(2026, 4, 1)).toISOString(), renewsAt: new Date(Date.UTC(2026, 6, 1)).toISOString() }],
    subscriptionOrders: [{ id: 'subscription-order-001', orderRef: 'SUB-ORDER-001', companyId: 'company-01', userId: 'user-company-001', planId: 'growth', planName: 'Growth', amount: 250000, currency: 'UGX', status: 'paid', paidAt: new Date(Date.UTC(2026, 4, 1)).toISOString() }],
  };
}

function buildSeedData() {
  const routes = buildRoutes();
  const vehicles = buildVehicles(routes);
  const schedules = buildSchedules(routes, listings, vehicles);
  const seats = buildSeats(schedules);
  const rooms = buildRooms();
  const promoterLinks = buildPromoterLinks();
  const bookings = buildBookings();
  const wallets = buildWallets();
  const operations = buildOperations();
  const companyOps = buildCompanyOperations(companies);
  const routeStops = buildRouteStops(routes);
  const driverOps = buildDriverOperations(companies, schedules);
  const hotelInventory = buildHotelInventory(listings, rooms);
  const bookingArtifacts = buildBookingArtifacts(bookings);
  const financeArtifacts = buildFinanceArtifacts(wallets, bookings);
  const cartArtifacts = buildCartArtifacts(listings);
  const futureServiceArtifacts = buildFutureServiceArtifacts(listings);
  const securityAndProfileArtifacts = buildSecurityAndProfileArtifacts();
  return {
    categories,
    users,
    companies,
    listings,
    partnerLeads: [
      { id: 'lead-001', companyName: 'Demo Cross Border Coaches', contactName: 'Diana Demo', email: 'partner@classictrip.test', phone: '+256700000020', serviceType: 'bus', status: 'qualified', source: 'seed' },
      { id: 'lead-002', companyName: 'Demo Apartment Stays', contactName: 'Henry Demo', email: 'stays@classictrip.test', phone: '+256700000021', serviceType: 'hotel', status: 'contacted', source: 'seed' },
    ],
    discoverySessions: [{ id: 'discovery-001', leadId: 'lead-001', companyName: 'Demo Cross Border Coaches', scheduledAt: new Date(Date.UTC(2026, 5, 10)).toISOString(), status: 'scheduled', notes: 'Seed onboarding discovery session.' }],
    agreements: [{ id: 'agreement-001', companyId: 'company-01', agreementType: 'partner_terms', status: 'signed', signedBy: 'user-company-001', signedAt: new Date(Date.UTC(2026, 4, 5)).toISOString(), documentUrl: '#' }],
    invitations: [{ id: 'invitation-001', email: 'newstaff@classictrip.test', phone: '+256700000030', companyId: 'company-01', role: 'company_employee', tokenHash: 'seed-invite-token-hash', status: 'pending', expiresAt: new Date(Date.UTC(2026, 7, 1)).toISOString(), invitedBy: 'user-company-001' }],
    verificationReviews: [{ id: 'verification-review-001', companyId: 'company-01', reviewerId: 'user-admin-001', status: 'approved', notes: 'Seed verification review.', reviewedAt: new Date(Date.UTC(2026, 4, 6)).toISOString() }],
    routes,
    vehicles,
    schedules,
    seats,
    rooms,
    hotelProperties: hotelInventory.hotelProperties,
    roomTypes: hotelInventory.roomTypes,
    roomUnits: hotelInventory.roomUnits,
    roomNightInventories: hotelInventory.roomNightInventories,
    stayRules: hotelInventory.stayRules,
    companyEmployees: companyOps.employees,
    companyBranches: companyOps.branches,
    companyPolicies: companyOps.policies,
    driverAssignments: driverOps.assignments,
    driverIncidents: driverOps.incidents,
    tripStatusUpdates: driverOps.tripStatusUpdates,
    routeStops,
    carts: cartArtifacts.carts,
    cartCheckoutAttempts: cartArtifacts.cartCheckoutAttempts,
    bookings,
    passengers: bookingArtifacts.passengers,
    payments: bookingArtifacts.payments,
    correspondenceMessages: bookingArtifacts.correspondenceMessages,
    bookingTimelineEvents: bookingArtifacts.bookingTimelineEvents,
    notificationDeliveryAttempts: bookingArtifacts.notificationDeliveryAttempts,
    rescheduleRequests: [{ id: 'reschedule-001', bookingId: 'booking-0001', bookingRef: 'CT-BUS-1042', companyId: 'company-01', requesterId: 'user-customer-001', requestedScheduleId: schedules[1]?.id, reason: 'Seed reschedule request.', status: 'pending', requestedAt: new Date(Date.UTC(2026, 5, 2)).toISOString() }],
    wallets,
    walletTransactions: financeArtifacts.walletTransactions,
    paymentIntents: bookingArtifacts.paymentIntents,
    receiptInvoices: bookingArtifacts.receiptInvoices,
    taxFeeRecords: bookingArtifacts.taxFeeRecords,
    financeStatements: financeArtifacts.financeStatements,
    financeRiskReviews: financeArtifacts.financeRiskReviews,
    settlementBatches: financeArtifacts.settlementBatches,
    payoutRequests: financeArtifacts.payoutRequests,
    payoutBatches: financeArtifacts.payoutBatches,
    reconciliationReports: financeArtifacts.reconciliationReports,
    promoterLinks,
    referralClicks: securityAndProfileArtifacts.referralClicks,
    attributionSessions: securityAndProfileArtifacts.attributionSessions,
    campaignConversions: bookingArtifacts.campaignConversions,
    agentProfiles: securityAndProfileArtifacts.agentProfiles,
    offlineSales: securityAndProfileArtifacts.offlineSales,
    fraudSignals: securityAndProfileArtifacts.fraudSignals,
    commissions: bookingArtifacts.commissions,
    blogs,
    reviews: securityAndProfileArtifacts.reviews,
    notifications: bookingArtifacts.notifications,
    savedListings: securityAndProfileArtifacts.savedListings,
    shiftHandovers: securityAndProfileArtifacts.shiftHandovers,
    subscriptionOrders: securityAndProfileArtifacts.subscriptionOrders,
    subscriptions: securityAndProfileArtifacts.subscriptions,
    inventoryHolds: [],
    ticketScans: [],
    securityEvents: securityAndProfileArtifacts.securityEvents,
    loginAudits: securityAndProfileArtifacts.loginAudits,
    deviceSessions: securityAndProfileArtifacts.deviceSessions,
    idempotencyKeyRecords: securityAndProfileArtifacts.idempotencyKeyRecords,
    futureServiceModules: futureServiceArtifacts.futureServiceModules,
    flightOffers: futureServiceArtifacts.flightOffers,
    trainInventories: futureServiceArtifacts.trainInventories,
    tourPackageInventories: futureServiceArtifacts.tourPackageInventories,
    carRentalUnits: futureServiceArtifacts.carRentalUnits,
    eventTicketInventories: futureServiceArtifacts.eventTicketInventories,
    cargoShipments: futureServiceArtifacts.cargoShipments,
    insurancePolicyRecords: futureServiceArtifacts.insurancePolicyRecords,
    corporateTravelAccounts: futureServiceArtifacts.corporateTravelAccounts,
    loyaltyAccounts: futureServiceArtifacts.loyaltyAccounts,
    settings: securityAndProfileArtifacts.settings,
    ...operations,
  };
}

const seedModelNames = [
  'User', 'Company', 'ServiceCategory', 'Listing', 'PartnerLead', 'DiscoverySession', 'Agreement', 'Invitation', 'VerificationReview',
  'Route', 'Vehicle', 'TripSchedule', 'Seat', 'Room', 'HotelProperty', 'RoomType', 'RoomUnit', 'RoomNightInventory', 'StayRule',
  'CompanyEmployee', 'CompanyBranch', 'CompanyPolicy', 'DriverAssignment', 'DriverIncident', 'TripStatusUpdate', 'RouteStop',
  'Cart', 'CartCheckoutAttempt', 'Booking', 'Passenger', 'Payment', 'CorrespondenceMessage', 'BookingTimelineEvent',
  'NotificationDeliveryAttempt', 'PushSubscription', 'RescheduleRequest', 'Wallet', 'WalletTransaction', 'PaymentIntent', 'ReceiptInvoice',
  'TaxFeeRecord', 'FinanceStatement', 'FinanceRiskReview', 'SettlementBatch', 'PayoutRequest', 'PayoutBatch', 'ReconciliationReport',
  'PromoterLink', 'ReferralClick', 'AttributionSession', 'CampaignConversion', 'AgentProfile', 'OfflineSale', 'FraudSignal', 'Commission',
  'BlogPost', 'SupportTicket', 'RefundRequest', 'PromotionCampaign', 'AuditLog', 'Review', 'Notification', 'SavedListing', 'ShiftHandover',
  'SubscriptionOrder', 'Subscription', 'InventoryHold', 'TicketScan', 'SecurityEvent', 'LoginAudit', 'DeviceSession', 'IdempotencyKeyRecord',
  'FutureServiceModule', 'FlightOffer', 'TrainInventory', 'TourPackageInventory', 'CarRentalUnit', 'EventTicketInventory', 'CargoShipment',
  'InsurancePolicyRecord', 'CorporateTravelAccount', 'LoyaltyAccount', 'Setting', 'PlatformSetting',
];

function collectionMapFromSeedData(data) {
  return {
    User: data.users,
    Company: data.companies,
    ServiceCategory: data.categories,
    Listing: data.listings,
    PartnerLead: data.partnerLeads || [],
    DiscoverySession: data.discoverySessions || [],
    Agreement: data.agreements || [],
    Invitation: data.invitations || [],
    VerificationReview: data.verificationReviews || [],
    Route: data.routes,
    Vehicle: data.vehicles,
    TripSchedule: data.schedules,
    Seat: data.seats,
    Room: data.rooms,
    HotelProperty: data.hotelProperties || [],
    RoomType: data.roomTypes || [],
    RoomUnit: data.roomUnits || [],
    RoomNightInventory: data.roomNightInventories || [],
    StayRule: data.stayRules || [],
    CompanyEmployee: data.companyEmployees || [],
    CompanyBranch: data.companyBranches || [],
    CompanyPolicy: data.companyPolicies || [],
    DriverAssignment: data.driverAssignments || [],
    DriverIncident: data.driverIncidents || [],
    TripStatusUpdate: data.tripStatusUpdates || [],
    RouteStop: data.routeStops || [],
    Cart: data.carts || [],
    CartCheckoutAttempt: data.cartCheckoutAttempts || [],
    Booking: data.bookings,
    Passenger: data.passengers || [],
    Payment: data.payments || [],
    CorrespondenceMessage: data.correspondenceMessages || [],
    BookingTimelineEvent: data.bookingTimelineEvents || [],
    NotificationDeliveryAttempt: data.notificationDeliveryAttempts || [],
    PushSubscription: data.pushSubscriptions || [],
    RescheduleRequest: data.rescheduleRequests || [],
    Wallet: data.wallets,
    WalletTransaction: data.walletTransactions || [],
    PaymentIntent: data.paymentIntents || [],
    ReceiptInvoice: data.receiptInvoices || [],
    TaxFeeRecord: data.taxFeeRecords || [],
    FinanceStatement: data.financeStatements || [],
    FinanceRiskReview: data.financeRiskReviews || [],
    SettlementBatch: data.settlementBatches || [],
    PayoutRequest: data.payoutRequests || [],
    PayoutBatch: data.payoutBatches || [],
    ReconciliationReport: data.reconciliationReports || [],
    PromoterLink: data.promoterLinks,
    ReferralClick: data.referralClicks || [],
    AttributionSession: data.attributionSessions || [],
    CampaignConversion: data.campaignConversions || [],
    AgentProfile: data.agentProfiles || [],
    OfflineSale: data.offlineSales || [],
    FraudSignal: data.fraudSignals || [],
    Commission: data.commissions || [],
    BlogPost: data.blogs,
    SupportTicket: data.supportTickets || [],
    RefundRequest: data.refundRequests || [],
    PromotionCampaign: data.promotionCampaigns || [],
    AuditLog: data.auditLogs || [],
    Review: data.reviews || [],
    Notification: data.notifications || [],
    SavedListing: data.savedListings || [],
    ShiftHandover: data.shiftHandovers || [],
    SubscriptionOrder: data.subscriptionOrders || [],
    Subscription: data.subscriptions || [],
    InventoryHold: data.inventoryHolds || [],
    TicketScan: data.ticketScans || [],
    SecurityEvent: data.securityEvents || [],
    LoginAudit: data.loginAudits || [],
    DeviceSession: data.deviceSessions || [],
    IdempotencyKeyRecord: data.idempotencyKeyRecords || [],
    FutureServiceModule: data.futureServiceModules || [],
    FlightOffer: data.flightOffers || [],
    TrainInventory: data.trainInventories || [],
    TourPackageInventory: data.tourPackageInventories || [],
    CarRentalUnit: data.carRentalUnits || [],
    EventTicketInventory: data.eventTicketInventories || [],
    CargoShipment: data.cargoShipments || [],
    InsurancePolicyRecord: data.insurancePolicyRecords || [],
    CorporateTravelAccount: data.corporateTravelAccounts || [],
    LoyaltyAccount: data.loyaltyAccounts || [],
    Setting: data.settings || [],
    PlatformSetting: [{
      platformName: 'Classic Trip',
      defaultCurrency: 'UGX',
      platformFeePercent: 7,
      promoterDefaultPercent: 3,
      supportEmail: 'support@classictrip.com',
      maintenanceMode: false,
      termsUrl: '/terms',
      privacyUrl: '/privacy',
      updatedBy: 'user-admin-001',
    }],
  };
}

async function prepareSeedData(data) {
  const isTest = process.env.NODE_ENV === 'test';
  const password = isTest ? 'Password123' : (process.env.DEMO_PASSWORD || 'Password123');
  const superAdminPassword = isTest ? password : (process.env.SUPER_ADMIN_PASSWORD || password);
  try {
    const bcrypt = require('bcryptjs');
    const passwordHash = password ? await bcrypt.hash(password, 10) : '';
    const superAdminHash = superAdminPassword ? await bcrypt.hash(superAdminPassword, 10) : passwordHash;
    data.users = (data.users || []).map((user) => {
      const isSuperAdmin = user.id === 'user-admin-001' || user.role === 'super_admin';
      const patched = {
        ...user,
        authProviders: user.authProviders || { local: { enabled: true }, google: { enabled: false } },
        emailVerifiedAt: user.emailVerifiedAt || new Date(Date.UTC(2026, 4, 1)).toISOString(),
      };
      if (isSuperAdmin) {
        patched.fullName = isTest ? patched.fullName : (process.env.SUPER_ADMIN_NAME || patched.fullName);
        patched.email = (isTest ? patched.email : (process.env.SUPER_ADMIN_EMAIL || patched.email || '')).toLowerCase();
        patched.phone = isTest ? patched.phone : (process.env.SUPER_ADMIN_PHONE || patched.phone);
        patched.passwordHash = user.passwordHash || superAdminHash;
      } else {
        patched.passwordHash = user.passwordHash || passwordHash;
      }
      return patched;
    });
  } catch (error) {
    // bcrypt is a runtime dependency. If someone checks syntax without npm install,
    // keep seed data usable with the global DEMO_PASSWORD login fallback.
  }
  return data;
}

function loadSeedModels() {
  seedModelNames.forEach((name) => require(`../models/${name}`));
}

async function seedMongo(options = {}) {
  const { connectDb, mongoose } = require('../config/db');
  const repositories = require('../repositories');
  await connectDb();
  if (mongoose.connection.readyState !== 1) {
    console.log('MongoDB not connected. Start local MongoDB and set MONGO_URI=mongodb://127.0.0.1:27017/classic_trip');
    return { connected: false, inserted: 0, collections: 0 };
  }
  loadSeedModels();
  const productionSeed = process.env.NODE_ENV === 'production';
  const freshDefault = productionSeed ? 'false' : 'true';
  const fresh = options.fresh ?? ['true', '1', 'yes'].includes(String(process.env.SEED_FRESH || freshDefault).toLowerCase());
  if (productionSeed && fresh) {
    const allowProductionSeed = ['true', '1', 'yes'].includes(String(process.env.ALLOW_PRODUCTION_SEED || '').toLowerCase());
    const confirmedDelete = process.env.CONFIRM_SEED_DELETE === 'DELETE_PRODUCTION_DATA';
    if (!allowProductionSeed || !confirmedDelete) {
      throw new Error('Refusing fresh seed in production. Set ALLOW_PRODUCTION_SEED=true and CONFIRM_SEED_DELETE=DELETE_PRODUCTION_DATA to delete production data.');
    }
  }
  const data = await prepareSeedData(buildSeedData());
  const map = collectionMapFromSeedData(data);
  let inserted = 0;
  let collections = 0;
  for (const [name, rows = []] of Object.entries(map)) {
    const Model = mongoose.model(name);
    if (fresh) await Model.deleteMany({});
    if (rows.length) {
      if (fresh) {
        await Model.insertMany(rows, { ordered: false });
      } else {
        const entity = Object.entries(repositories.entityModelMap).find(([, modelName]) => modelName === name)?.[0];
        if (entity && repositories[entity]) await repositories[entity].upsertMany(rows);
        else await Model.insertMany(rows, { ordered: false });
      }
    }
    inserted += rows.length;
    collections += 1;
    console.log(`${fresh ? 'Seeded' : 'Upserted'} ${rows.length} ${name} records`);
  }
  console.log(`MongoDB seed complete: ${inserted} records across ${collections} collections in ${mongoose.connection.name}.`);
  if (options.disconnect !== false) await mongoose.disconnect();
  return { connected: true, inserted, collections, database: mongoose.connection.name };
}

module.exports = { buildSeedData, collectionMapFromSeedData, seedMongo, seedModelNames, loadSeedModels };

if (require.main === module) {
  seedMongo().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}


