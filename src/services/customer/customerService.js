const { platformCurrency } = require('../../utils/currency');
const customerRepository = require('../../repositories/domain/customerRepository');
const walletService = require('../wallet/walletService');
const notificationService = require('../notification/notificationService');
const timelineService = require('../support/timelineService');
const correspondenceService = require('../support/correspondenceService');
const { nextId } = require('../data/idService');
const { ownsBooking } = require('../../utils/bookingOwnership');
const { assertContactAvailableLive } = require('../../utils/uniqueContact');

function cleanText(value, max = 500) {
  return String(value || '').replace(/<[^>]*>/g, '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function amountValue(value) {
  const amount = Number(String(value || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(amount) ? amount : 0;
}

function normalizePhone(value) {
  return String(value || '').replace(/[^\d+]/g, '').replace(/^00/, '+').trim();
}

async function requireSessionUser(req, options = {}) {
  const current = req.session?.user || {};
  if (!current.id) {
    const error = new Error('Your session could not be verified. Please log in again.');
    error.status = 403;
    throw error;
  }
  const user = await customerRepository.users.findOne({ id: current.id });
  if (!user) {
    const error = new Error('Customer account no longer exists');
    error.status = 403;
    throw error;
  }
  if (user.status !== 'active') {
    const error = new Error('Customer account is not active');
    error.status = 403;
    throw error;
  }
  const allowed = options.allowedRoles || ['customer'];
  if (!allowed.includes(user.role) && !allowed.includes('*')) {
    const error = new Error('This action is not available for your account role');
    error.status = 403;
    throw error;
  }
  return user;
}

async function findListing(identifier) {
  const value = cleanText(identifier, 180);
  if (!value) return null;
  return customerRepository.listings.findOne({ $or: [{ id: value }, { slug: value }, { title: value }] });
}

async function saveTrip(req) {
  const user = await requireSessionUser(req);
  const listing = await findListing(req.body.listingId || req.body.listingSlug || req.body.title);
  if (!listing || listing.status !== 'active') {
    const error = new Error('Listing not found or unavailable');
    error.status = listing ? 409 : 404;
    throw error;
  }
  let saved = await customerRepository.savedListings.findOne({ userId: user.id, listingId: listing.id });
  if (!saved) {
    saved = {
      id: await nextId('saved-listing'),
      userId: user.id,
      listingId: listing.id,
      companyId: listing.companyId,
      serviceType: listing.serviceType,
      status: 'saved',
      createdAt: new Date().toISOString(),
    };
  }
  Object.assign(saved, {
    notes: cleanText(req.body.notes || saved.notes || '', 1000),
    status: 'saved',
    updatedAt: new Date().toISOString(),
  });
  await customerRepository.savedListings.save(saved, { userId: user.id, listingId: listing.id });
  return saved;
}

async function topUpWallet(req) {
  const user = await requireSessionUser(req);
  const amount = amountValue(req.body.amount);
  if (amount <= 0) {
    const error = new Error('Wallet top-up amount must be greater than zero');
    error.status = 422;
    throw error;
  }
  const currency = cleanText(req.body.currency || platformCurrency(), 8).toUpperCase();
  const reference = cleanText(req.body.paymentReference || `topup-${Date.now()}`, 180);
  const duplicate = await customerRepository.transactions.findOne({ ownerType: 'customer', ownerId: user.id, transactionType: 'wallet_top_up_request', reference });
  if (duplicate) return { wallet: await walletService.getOrCreateWallet('customer', user.id, currency), transaction: duplicate, replayed: true };

  const wallet = await walletService.creditPending('customer', user.id, currency, amount, {
    transactionType: 'wallet_top_up_request',
    referenceType: 'wallet',
    referenceId: reference,
    status: 'pending',
    meta: { source: 'customer_dashboard' },
  });
  const transactions = await customerRepository.transactions.list({ ownerType: 'customer', ownerId: user.id, transactionType: 'wallet_top_up_request' }, { sort: { createdAt: -1 }, limit: 5 });
  const transaction = transactions.find((row) => row.referenceId === reference || row.reference === reference) || transactions[0];
  if (transaction) {
    Object.assign(transaction, {
      method: cleanText(req.body.method || 'manual', 60),
      reference,
      meta: { ...(transaction.meta || {}), source: 'customer_dashboard', note: cleanText(req.body.notes || '', 1000) },
    });
    await customerRepository.transactions.save(transaction, { id: transaction.id });
  }
  return { wallet, transaction, replayed: false };
}

function promoterChecklist() {
  return [
    { key: 'identity_document', label: 'Identity document', required: true, status: 'missing' },
    { key: 'payout_account', label: 'Payout account', required: true, status: 'submitted' },
    { key: 'terms_confirmed', label: 'Promoter terms confirmed', required: true, status: 'submitted' },
    { key: 'fraud_training', label: 'Fraud and offline-sales training', required: true, status: 'missing' },
  ];
}

async function applyForPromoter(req) {
  const user = await requireSessionUser(req);
  if (user.requestedRole === 'promoter' && user.roleChangeStatus === 'pending') {
    const existingReview = await customerRepository.verificationReviews.findOne({ targetType: 'promoter', targetId: user.id });
    return { user, review: existingReview, replayed: true };
  }
  const root = cleanText(req.body.referralCode || `${(user.fullName || 'promoter').replace(/[^a-z0-9]+/gi, '-').toUpperCase()}-${Date.now().toString().slice(-4)}`, 60)
    .toUpperCase().replace(/[^A-Z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  let code = root || `PROMOTER-${Date.now()}`;
  let index = 1;
  while (await customerRepository.users.findOne({ referralCode: code, id: { $ne: user.id } })) {
    index += 1;
    code = `${root}-${index}`;
  }
  const payoutMethod = cleanText(req.body.payoutMethod || 'Mobile Money', 40);
  const payoutAccount = cleanText(req.body.payoutAccount || user.phone || '', 120);
  if (!payoutAccount) {
    const error = new Error('A payout account is required for promoter application');
    error.status = 422;
    throw error;
  }
  Object.assign(user, {
    requestedRole: 'promoter',
    roleChangeStatus: 'pending',
    referralCode: code,
    verificationStatus: 'pending',
    payoutAccount: { method: payoutMethod, account: payoutAccount },
    promoterProfile: {
      ...(user.promoterProfile || {}),
      defaultChannel: cleanText(req.body.defaultChannel || 'social', 80),
      bio: cleanText(req.body.bio || '', 1000),
      applicationStatus: 'pending',
      offlineSalesEnabled: false,
    },
    updatedAt: new Date().toISOString(),
  });
  const profile = {
    id: await nextId('agent-profile'),
    userId: user.id,
    promoterId: user.id,
    agentCode: code,
    officeName: '',
    location: user.city || '',
    payoutMethod: payoutMethod.toLowerCase().includes('mobile') ? 'mobile_money' : 'mobile_money',
    payoutAccount,
    offlineSalesEnabled: false,
    permissions: ['referral_links'],
    dailyLimit: 0,
    status: 'pending_review',
    createdBy: user.id,
    updatedBy: user.id,
    createdAt: new Date().toISOString(),
  };
  const review = {
    id: await nextId('verification'),
    targetType: 'promoter',
    targetId: user.id,
    status: 'pending_review',
    riskLevel: 'medium',
    checklist: promoterChecklist(),
    payoutAccount: user.payoutAccount,
    supportContacts: { email: user.email, phone: user.phone },
    submittedBy: user.id,
    submittedAt: new Date().toISOString(),
    auditTrail: [{ action: 'promoter.application.submitted', actorId: user.id, at: new Date().toISOString() }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await customerRepository.users.save(user, { id: user.id });
  await customerRepository.agentProfiles.save(profile, { userId: user.id });
  await customerRepository.verificationReviews.save(review, { targetType: 'promoter', targetId: user.id });
  const audit = {
    id: await nextId('audit'), actorId: user.id, actorRole: 'customer', action: 'promoter.application.submitted',
    entityType: 'user', entityId: user.id, target: user.id, status: 'success', metadata: { referralCode: code, reviewId: review.id }, createdAt: new Date().toISOString(),
  };
  await customerRepository.auditLogs.save(audit, { id: audit.id });
  await notificationService.queueNotification({
    channels: ['in_app'], ownerType: 'platform', ownerId: 'promoter-verification', audience: 'admin',
    title: 'New promoter application', message: `${user.fullName} submitted a promoter application.`,
    referenceType: 'verification', referenceId: review.id, meta: { userId: user.id, targetType: 'promoter' },
  });
  if (req.session?.user) Object.assign(req.session.user, { referralCode: code, requestedRole: 'promoter', roleChangeStatus: 'pending', verificationStatus: 'pending' });
  return { user, review, profile, replayed: false };
}

async function updateSecurity(req) {
  const user = await requireSessionUser(req, { allowedRoles: ['customer', 'promoter'] });
  const recoveryEmail = cleanText(req.body.recoveryEmail || user.recoveryEmail || '', 254).toLowerCase();
  if (recoveryEmail) await assertContactAvailableLive(user.id, { email: recoveryEmail }, { allowRecoveryEmail: true });
  user.twoFactorEnabled = ['on', 'true', '1', 'enabled'].includes(String(req.body.twoFactorEnabled || '').toLowerCase());
  user.loginAlertsEnabled = req.body.loginAlertsEnabled === undefined ? true : ['on', 'true', '1', 'enabled'].includes(String(req.body.loginAlertsEnabled || '').toLowerCase());
  user.recoveryEmail = recoveryEmail;
  if (req.body.passwordChanged === 'on') user.passwordChangedAt = new Date().toISOString();
  user.updatedAt = new Date().toISOString();
  await customerRepository.users.save(user, { id: user.id });
  if (req.session?.user) Object.assign(req.session.user, user);
  return user;
}

async function updateProfile(req) {
  const user = await requireSessionUser(req, { allowedRoles: ['customer', 'promoter'] });
  await assertContactAvailableLive(user.id, { email: req.body.email, phone: req.body.phone });
  const nextEmail = req.body.email ? cleanText(req.body.email, 254).toLowerCase() : user.email;
  const nextPhone = req.body.phone ? normalizePhone(req.body.phone) : user.phone;
  const emailChanged = Boolean(req.body.email && nextEmail !== String(user.email || '').toLowerCase());
  const phoneChanged = Boolean(req.body.phone && nextPhone !== String(user.phone || ''));
  if (req.body.fullName) user.fullName = cleanText(req.body.fullName, 160);
  if (req.body.email) user.email = nextEmail;
  if (req.body.phone) user.phone = nextPhone;
  if (req.body.city) user.city = cleanText(req.body.city, 120);
  if (req.body.savedPassengerDetails) user.savedPassengerDetails = cleanText(req.body.savedPassengerDetails, 2000);
  user.updatedAt = new Date().toISOString();
  await customerRepository.users.save(user, { id: user.id });
  if (emailChanged || phoneChanged) {
    await require('../onboarding/verificationService').invalidateContactVerificationForUser(user.id, { emailChanged, phoneChanged }, user.id);
    if (emailChanged) await require('../auth/authService').resendVerificationEmail(user.id);
    if (phoneChanged && nextPhone) await require('../auth/phoneVerificationService').requestCode(user.id);
  }
  const refreshed = await customerRepository.users.findOne({ id: user.id });
  if (req.session?.user && refreshed) Object.assign(req.session.user, refreshed);
  return refreshed || user;
}

async function findOwnedBooking(bookingRef, user) {
  const booking = await customerRepository.bookings.findOne({ bookingRef: cleanText(bookingRef, 80) });
  return booking && ownsBooking(booking, user) ? booking : null;
}

async function createSupportTicket(req) {
  const user = await requireSessionUser(req, { allowedRoles: ['customer', 'promoter'] });
  const message = cleanText(req.body.message, 3000);
  if (!message) { const error = new Error('Support message is required'); error.status = 422; throw error; }
  const requestedRef = cleanText(req.body.bookingRef || '', 80).replace(/^#/, '');
  const booking = requestedRef ? await findOwnedBooking(requestedRef, user) : null;
  if (requestedRef && !booking) { const error = new Error('Booking not found or does not belong to your account'); error.status = 403; throw error; }
  const ticket = {
    id: await nextId('support'), ownerType: user.role === 'promoter' ? 'promoter' : 'customer', ownerId: user.id,
    userId: user.id, companyId: booking?.companyId || '', bookingId: booking?.id || '', bookingRef: booking?.bookingRef || '',
    category: user.role === 'promoter' ? 'Promoter support' : 'Customer support',
    subject: cleanText(req.body.category || `${user.role === 'promoter' ? 'Promoter' : 'Customer'} support ${booking?.bookingRef || ''}`, 240),
    message, priority: ['low', 'normal', 'high', 'urgent'].includes(cleanText(req.body.priority).toLowerCase()) ? cleanText(req.body.priority).toLowerCase() : 'normal',
    status: 'open', assignedTo: 'support', createdBy: user.id, createdAt: new Date().toISOString(),
  };
  await customerRepository.supportTickets.save(ticket, { id: ticket.id });
  await timelineService.attachSupportEvent(ticket, { action: 'support.case.created', title: ticket.subject, message, status: ticket.status, actorType: user.role, actorId: user.id, actorName: user.fullName || user.email, visibility: 'shared' });
  await correspondenceService.linkToSupportTicket(ticket, { message, actorType: user.role, actorId: user.id, actorName: user.fullName || user.email, visibility: 'shared', direction: 'inbound', channels: ['in_app'], metadata: { source: `${user.role}_support_form` } });
  return ticket;
}

function frontendListing(listing = {}) {
  return { ...listing, img: listing.img || listing.media?.[0]?.url, rating: String(listing.rating || listing.ratingAverage || ''), price: listing.price || listing.priceFrom, partner: listing.partner || listing.companyName, url: `/listings/${listing.serviceType}/${listing.slug}`, bookingUrl: listing.bookable ? `/book/${listing.serviceType}/${listing.slug}` : '', companyUrl: `/companies/${listing.companySlug || listing.companyId || ''}` };
}

function frontendBooking(booking = {}, listing = {}) {
  const passenger = booking.passengers?.[0] || {};
  return { code: booking.bookingRef, title: listing.title || booking.serviceType, type: listing.type || booking.serviceType, selected: passenger.seatOrRoom || passenger.seatNumber || '', total: `${booking.pricing?.currency || platformCurrency()} ${Math.round(Number(booking.pricing?.total || 0)).toLocaleString()}`, customer: booking.guestSnapshot?.fullName || '', date: booking.createdAt ? new Date(booking.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '', channel: booking.bookingChannel || '', status: booking.bookingStatus, ticketUrl: `/tickets/${booking.bookingRef}`, lookupUrl: `/tickets?bookingRef=${encodeURIComponent(booking.bookingRef)}` };
}

async function savedListingsFor(userId) {
  const saved = await customerRepository.savedListings.list({ userId, status: 'saved' }, { sort: { createdAt: -1 } });
  const listings = await Promise.all(saved.map((row) => customerRepository.listings.findOne({ id: row.listingId })));
  return listings.filter(Boolean).map(frontendListing);
}

async function bookingsFor(userId) {
  const bookings = await customerRepository.bookings.list({ customerUserId: userId }, { sort: { createdAt: -1 } });
  const listingIds = [...new Set(bookings.map((row) => row.listingId).filter(Boolean))];
  const listings = await customerRepository.listings.list({ id: { $in: listingIds } });
  const byId = new Map(listings.map((row) => [row.id, row]));
  return bookings.map((booking) => frontendBooking(booking, byId.get(booking.listingId) || {}));
}

module.exports = {
  requireSessionUser, saveTrip, topUpWallet, applyForPromoter, updateSecurity, updateProfile,
  findOwnedBooking, createSupportTicket, savedListingsFor, bookingsFor, frontendListing, frontendBooking,
};
