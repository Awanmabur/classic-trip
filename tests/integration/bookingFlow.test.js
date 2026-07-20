const store = require('../../src/services/data/persistentStore');
const bookingService = require('../../src/services/booking/bookingService');
const walletService = require('../../src/services/wallet/walletService');
const promoterService = require('../../src/services/promoter/promoterService');
const promotionService = require('../../src/services/promotion/promotionService');
const workflowService = require('../../src/services/support/workflowService');
const seatLockService = require('../../src/services/booking/seatLockService');
const roomReservationService = require('../../src/services/booking/roomReservationService');

test('creates a guest booking for a bookable listing', async () => {
  const listing = store.state.listings.find((item) => item.bookable);
  const booking = await store.createBooking({ listingId: listing.id, fullName: 'Test Guest', email: 'test@example.com', phone: '+256700123456' });
  expect(booking.bookingRef).toMatch(/^CT-/);
  expect(booking.paymentStatus).toBe('successful');
  expect(booking.qrCodeValue).toContain('CLASSIC-TRIP');
});

test('keeps selected add-ons in guest booking pricing', async () => {
  const listing = store.state.listings.find((item) => item.bookable && item.serviceType === 'bus');
  const booking = await store.createBooking({
    listingId: listing.id,
    fullName: 'Addon Guest',
    email: 'addons@example.com',
    phone: '+256700654321',
    addons: ['extra-luggage', 'sms-and-whatsapp-ticket'],
  });

  expect(booking.pricing.addonTotal).toBe(14500);
  expect(booking.pricing.addons.map((addon) => addon.id)).toEqual(['extra-luggage', 'sms-and-whatsapp-ticket']);
  expect(booking.pricing.total).toBe(booking.pricing.subtotal + booking.pricing.fees + booking.pricing.addonTotal);
});

test('marketplace catalog enriches listings with live availability and route intelligence', () => {
  const catalog = store.buildListingCatalog();
  const busListing = catalog.find((item) => item.serviceType === 'bus');
  const availableResults = store.searchListings({ serviceType: 'bus', available: 'true', sort: 'availability' });
  const meta = store.marketplaceInfo(availableResults);

  expect(catalog.length).toBeGreaterThan(0);
  expect(busListing).toBeTruthy();
  expect(busListing).toHaveProperty('remainingInventory');
  expect(busListing).toHaveProperty('unitsLabel');
  expect(busListing).toHaveProperty('corridor');
  expect(busListing.routeLabel).toContain('to');
  expect(availableResults.every((item) => item.remainingInventory > 0)).toBe(true);
  expect(meta.stats.liveListings).toBe(availableResults.length);
  expect(meta.routeHighlights.length).toBeGreaterThan(0);
  expect(meta.typeStats.some((item) => item.type === 'bus' && item.count > 0)).toBe(true);
});

test('seat and room holds are recorded and consumed during checkout', async () => {
  const busListing = store.state.listings.find((item) => item.bookable && item.serviceType === 'bus');
  const schedule = store.schedulesForListing(busListing.id)[0];
  const seat = store.seatsForSchedule(schedule.id).find((item) => item.status === 'available');
  const seatHold = await seatLockService.lockSeatPersistent(schedule.id, seat.seatNumber, 10, {
    listingId: busListing.id,
    companyId: busListing.companyId,
  });

  expect(store.state.inventoryHolds.find((hold) => hold.id === seatHold.id).status).toBe('active');

  await bookingService.createGuestBooking({
    listingId: busListing.id,
    scheduleId: schedule.id,
    seatNumber: seat.seatNumber,
    holdId: seatHold.id,
    fullName: 'Held Seat Guest',
    email: `held-seat-${Date.now()}@example.com`,
    phone: '+256700111333',
  });

  expect(store.state.inventoryHolds.find((hold) => hold.id === seatHold.id).status).toBe('consumed');

  const hotelListing = store.state.listings.find((item) => item.bookable && item.serviceType === 'hotel');
  const room = store.roomsForListing(hotelListing.id).find((item) => item.status === 'active' && item.inventory > 0);
  const roomHold = await roomReservationService.reserveRoomPersistent(room.id, { fullName: 'Held Room Guest' }, 10, {
    listingId: hotelListing.id,
    companyId: hotelListing.companyId,
    selectedLabel: room.roomType,
  });

  expect(store.state.inventoryHolds.find((hold) => hold.id === roomHold.id).status).toBe('active');

  await bookingService.createGuestBooking({
    listingId: hotelListing.id,
    roomId: room.id,
    holdId: roomHold.id,
    fullName: 'Held Room Guest',
    email: `held-room-${Date.now()}@example.com`,
    phone: '+256700111334',
  });

  expect(store.state.inventoryHolds.find((hold) => hold.id === roomHold.id).status).toBe('consumed');
});

test('scanner validates a paid ticket once', async () => {
  const listing = store.state.listings.find((item) => item.bookable && item.serviceType === 'bus');
  const booking = await store.createBooking({ listingId: listing.id, fullName: 'Scan Guest', email: 'scan@example.com', phone: '+256700111222' });
  const scanCountBefore = store.state.ticketScans.length;

  const firstScan = await bookingService.validateTicket(booking.qrCodeValue, 'employee-test');
  expect(firstScan.ok).toBe(true);
  expect(firstScan.booking.bookingStatus).toBe('checked_in');
  expect(firstScan.booking.checkedInBy).toBe('employee-test');

  const secondScan = await bookingService.validateTicket(booking.qrCodeValue, 'employee-test');
  expect(secondScan.ok).toBe(false);
  expect(secondScan.result).toBe('already_used');
  const scans = store.state.ticketScans.filter((scan) => scan.bookingRef === booking.bookingRef);
  expect(store.state.ticketScans.length).toBe(scanCountBefore + 2);
  expect(scans.map((scan) => scan.result)).toEqual(expect.arrayContaining(['validated', 'already_used']));
  expect(scans.every((scan) => scan.employeeId === 'employee-test' && scan.companyId === booking.companyId)).toBe(true);
});

test('scanner rejects unpaid tickets', async () => {
  const listing = store.state.listings.find((item) => item.bookable && item.serviceType === 'hotel');
  const booking = await store.createBooking({ listingId: listing.id, fullName: 'Unpaid Guest', email: 'unpaid@example.com', phone: '+256700333444' });
  booking.paymentStatus = 'pending';

  const scan = await bookingService.validateTicket(booking.qrCodeValue, 'employee-test');
  expect(scan.ok).toBe(false);
  expect(scan.result).toBe('payment_not_successful');
});

test('booking creates pending earnings and scanner releases company and promoter commission', async () => {
  const listing = store.state.listings.find((item) => item.bookable && item.serviceType === 'bus');
  const link = promoterService.createLink({
    promoterId: 'user-promoter-e2e',
    listingId: listing.id,
    code: `18E-${Date.now()}`,
  });

  const booking = await store.createBooking({
    listingId: listing.id,
    fullName: 'Finance Guest',
    email: 'finance@example.com',
    phone: '+256700555666',
    ref: link.code,
  });

  const commission = store.state.commissions.find((item) => item.bookingId === booking.id);
  const companyWalletBefore = walletService.getWallet('company', listing.companyId, booking.pricing.currency);
  const promoterWalletBefore = walletService.getWallet('promoter', link.promoterId, booking.pricing.currency);
  const companyPendingBefore = companyWalletBefore.pendingBalance;
  const companyAvailableBefore = companyWalletBefore.availableBalance;
  const promoterPendingBefore = promoterWalletBefore.pendingBalance;
  const promoterAvailableBefore = promoterWalletBefore.availableBalance;

  expect(booking.promoterAttribution.promoterId).toBe(link.promoterId);
  expect(link.conversions).toBe(1);
  expect(commission.status).toBe('pending');
  expect(companyPendingBefore).toBeGreaterThanOrEqual(commission.companyAmount);
  expect(promoterPendingBefore).toBe(commission.promoterAmount);

  const scan = await bookingService.validateTicket(booking.qrCodeValue, 'employee-finance');
  expect(scan.ok).toBe(true);
  expect(scan.releasedCommissions).toHaveLength(1);

  const companyWalletAfter = walletService.getWallet('company', listing.companyId, booking.pricing.currency);
  const promoterWalletAfter = walletService.getWallet('promoter', link.promoterId, booking.pricing.currency);
  expect(commission.status).toBe('released');
  expect(booking.earningsReleasedAt).toBeTruthy();
  expect(companyWalletAfter.pendingBalance).toBe(companyPendingBefore - commission.companyAmount);
  expect(companyWalletAfter.availableBalance).toBe(companyAvailableBefore + commission.companyAmount);
  expect(promoterWalletAfter.pendingBalance).toBe(promoterPendingBefore - commission.promoterAmount);
  expect(promoterWalletAfter.availableBalance).toBe(promoterAvailableBefore + commission.promoterAmount);
  expect(store.state.walletTransactions.some((txn) => txn.referenceId === booking.id && txn.status === 'completed')).toBe(true);

  const withdrawal = await walletService.requestWithdrawal('promoter', link.promoterId, booking.pricing.currency, commission.promoterAmount, {
    referenceType: 'withdrawal',
    referenceId: `withdrawal-${booking.id}`,
  });
  expect(withdrawal.transaction.status).toBe('pending');
  expect(withdrawal.wallet.availableBalance).toBe(promoterAvailableBefore);

  const approved = walletService.approveWithdrawal(withdrawal.transaction.id, 'admin-finance');
  expect(approved.status).toBe('completed');
});

test('archived promoter links stop future attribution', async () => {
  const listing = store.state.listings.find((item) => item.bookable && item.serviceType === 'bus');
  const link = promoterService.createLink({
    promoterId: 'user-promoter-archive',
    listingId: listing.id,
    code: `ARCHIVE-${Date.now()}`,
  });

  const archived = promoterService.archiveLink({
    promoterId: link.promoterId,
    linkId: link.id,
    actorId: link.promoterId,
  });

  const click = store.recordReferralClick(link.code, listing.id);
  const booking = await store.createBooking({
    listingId: listing.id,
    fullName: 'Archived Link Guest',
    email: 'archived-link@example.com',
    phone: '+256700555667',
    ref: link.code,
  });

  expect(archived.status).toBe('archived');
  expect(promoterService.linksForPromoter(link.promoterId).some((item) => item.id === link.id)).toBe(false);
  expect(click.linkId).toBeNull();
  expect(booking.promoterAttribution).toBeNull();
});

test('sponsored campaign is active and counts new bookings', async () => {
  let listing = store.state.listings.find((item) => item.bookable && !store.state.promotionCampaigns.some((campaign) => campaign.listingId === item.id && campaign.status === 'active'));
  if (!listing) {
    listing = store.state.listings.find((item) => item.bookable);
    store.state.promotionCampaigns
      .filter((campaign) => campaign.listingId === listing.id && campaign.status === 'active')
      .forEach((campaign) => { campaign.status = 'paused'; });
  }
  const result = promotionService.markSponsored(listing.id, listing.companyId, { name: '18E sponsored route', budget: 50000 });
  const beforeBookings = result.campaign.bookings;

  expect(result.listing.isSponsored).toBe(true);
  expect(promotionService.activeCampaigns(listing.companyId).some((campaign) => campaign.id === result.campaign.id)).toBe(true);

  await store.createBooking({
    listingId: listing.id,
    fullName: 'Sponsored Guest',
    email: 'sponsored@example.com',
    phone: '+256700777888',
  });

  expect(result.campaign.bookings).toBe(beforeBookings + 1);
});

test('refund approval credits the customer wallet once and marks booking refunded', async () => {
  const listing = store.state.listings.find((item) => item.bookable && item.serviceType === 'hotel');
  const booking = await store.createBooking({
    listingId: listing.id,
    fullName: 'Refund Guest',
    email: 'refund@example.com',
    phone: '+256700999000',
  });
  const refund = workflowService.requestRefund({
    bookingRef: booking.bookingRef,
    requesterId: 'user-customer-refund',
    reason: '<b>Plans changed</b>',
  });
  const walletBefore = (await walletService.getOrCreateWallet('customer', 'user-customer-refund', booking.pricing.currency)).availableBalance;

  const approved = await workflowService.approveRefund(refund.id, 'admin-refund');
  const walletAfterFirstApproval = walletService.getWallet('customer', 'user-customer-refund', booking.pricing.currency).availableBalance;
  await workflowService.approveRefund(refund.id, 'admin-refund');

  expect(approved.status).toBe('approved');
  expect(refund.reason).toBe('Plans changed');
  expect(booking.bookingStatus).toBe('refunded');
  expect(booking.paymentStatus).toBe('refunded');
  expect(walletAfterFirstApproval).toBe(walletBefore + refund.amount);
  expect(walletService.getWallet('customer', 'user-customer-refund', booking.pricing.currency).availableBalance).toBe(walletAfterFirstApproval);
});

test('checked-in booking can be reviewed and dashboard rows reflect the review', async () => {
  const listing = store.state.listings.find((item) => item.bookable && item.serviceType === 'bus');
  const reviewCountBefore = Number(listing.reviewCount || 0);
  const booking = await store.createBooking({
    listingId: listing.id,
    fullName: 'Review Guest',
    email: 'review@example.com',
    phone: '+256700121212',
  }, { session: { user: { id: 'user-customer-review' } } });

  await bookingService.validateTicket(booking.qrCodeValue, 'employee-review');
  const review = workflowService.createReview({
    bookingRef: booking.bookingRef,
    customerUserId: 'user-customer-review',
    rating: 4,
    comment: '<i>Smooth boarding</i>',
  });

  expect(review.status).toBe('published');
  expect(review.comment).toBe('Smooth boarding');
  expect(listing.reviewCount).toBe(reviewCountBefore + 1);
  expect(store.dashboardData('customer', { customerId: 'user-customer-review' }).reviews.some((row) => row[0] === booking.bookingRef && row[5] === 'Submitted')).toBe(true);

  const moderated = workflowService.moderateReview(review.id, 'hidden');
  expect(moderated.status).toBe('hidden');
});
