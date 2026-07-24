const { platformCurrency } = require('../../utils/currency');
const bookingService = require('../booking/bookingService');
const paymentSettlementService = require('../booking/paymentSettlementService');
const companyService = require('../company/companyService');
const notificationService = require('../notification/notificationService');
const walletService = require('../wallet/walletService');
const workflowService = require('../support/workflowService');
const settlementService = require('../finance/settlementService');
const hotelService = require('../hotel/hotelService');
const busBookingService = require('../../modules/bus/services/busBookingService');
const repository = require('../../repositories/domain/dashboardActionRepository');
const hotelRepository = require('../../repositories/domain/hotelRepository');
const { nextId } = require('../data/idService');
const { normalizeCompanyType } = require('../../utils/companyServiceType');
const { employeePermissions, canonicalRole } = require('../../config/accessControl');
const { ALL_SERVICE_TYPES } = require('../../config/serviceRegistry');

const COMPANY_TYPES = new Set(ALL_SERVICE_TYPES);
const TICKET_PRIORITIES = new Set(['low', 'medium', 'normal', 'high', 'urgent']);
const TICKET_STATUSES = new Set(['open', 'pending', 'resolved', 'closed', 'pending_super_admin_approval']);
const REVIEW_STATUSES = new Set(['published', 'replied', 'hidden']);
const PAYMENT_PROVIDERS = new Set(['pesapal', 'mtn_momo', 'airtel_money', 'flutterwave', 'paystack', 'dpo', 'cash', 'bank_transfer', 'card', 'mobile_money']);
const PAYMENT_STATUSES = new Set(['pending', 'successful', 'failed', 'expired', 'refunded']);

function cleanText(value, max = 2000) {
  return String(value || '').replace(/<[^>]*>/g, '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function parseList(value) {
  if (Array.isArray(value)) return [...new Set(value.map((item) => cleanText(item, 100)).filter(Boolean))];
  return [...new Set(String(value || '').split(',').map((item) => cleanText(item, 100)).filter(Boolean))];
}

function amountValue(value, fallback = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const amount = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(amount) ? amount : fallback;
}

function normalize(value) {
  return cleanText(value, 100).toLowerCase().replace(/[\s-]+/g, '_');
}

function httpError(message, status = 422) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function enumValue(value, allowed, fallback, label) {
  const normalized = normalize(value || fallback);
  if (!allowed.has(normalized)) throw httpError(`Invalid ${label}`, 422);
  return normalized;
}

async function audit(actorId, action, target, meta = {}, options = {}) {
  const entry = {
    id: await nextId('audit'),
    actorId: actorId || 'dashboard-system',
    actorRole: cleanText(options.actorRole || '', 60),
    action,
    target: cleanText(target, 240),
    targetType: cleanText(options.targetType || meta.entityType || '', 80),
    targetId: cleanText(target, 240),
    entityType: cleanText(options.entityType || meta.entityType || '', 80),
    entityId: cleanText(target, 240),
    metadata: meta,
    meta,
    status: options.status || 'success',
    createdAt: new Date().toISOString(),
  };
  await repository.auditLogs.save(entry, { id: entry.id }, { session: options.session || undefined });
  return entry;
}

async function companyOrThrow(companyId) {
  const company = await repository.companies.findOne({ id: companyId });
  if (!company) throw httpError('Company not found', 404);
  return company;
}

async function companyBookingOrThrow(companyId, bookingRef) {
  const cleanRef = cleanText(bookingRef, 180);
  if (!cleanRef) throw httpError('Booking reference is required', 422);
  const booking = await repository.bookings.findOne({ companyId, $or: [{ bookingRef: cleanRef }, { id: cleanRef }] });
  if (!booking) throw httpError('Booking not found for this company', 404);
  return booking;
}

async function companyListingOrThrow(companyId, listingId) {
  const listing = await repository.listings.findOne({ id: cleanText(listingId, 180), companyId });
  if (!listing) throw httpError('Listing not found for this company', 404);
  return listing;
}

function entityIdentity(value) {
  const key = cleanText(value, 180);
  const clauses = [{ id: key }];
  if (/^[a-f0-9]{24}$/i.test(key)) clauses.push({ _id: key });
  return clauses;
}

async function companyVehicleOrThrow(companyId, vehicleId) {
  const vehicle = await repository.vehicles.findOne({ companyId, status: { $ne: 'archived' }, $or: entityIdentity(vehicleId) });
  if (!vehicle) throw httpError('Selected vehicle was not found for this company', 404);
  return vehicle;
}

async function companyScheduleOrThrow(companyId, scheduleId) {
  const schedule = await repository.schedules.findOne({ companyId, status: { $nin: ['archived', 'cancelled'] }, $or: entityIdentity(scheduleId) });
  if (!schedule) throw httpError('Selected schedule was not found for this company', 404);
  return schedule;
}

function bookingRecipient(booking = {}) {
  return {
    email: booking.guestSnapshot?.email,
    phone: booking.guestSnapshot?.phone,
    whatsapp: booking.guestSnapshot?.phone,
    name: booking.guestSnapshot?.fullName,
  };
}

async function notifyCompanyBookings({ companyId, scheduleId = '', title, message, referenceType, referenceId }) {
  const filter = { companyId };
  if (scheduleId) filter.scheduleId = scheduleId;
  const bookings = await repository.bookings.list(filter, { sort: { createdAt: -1 }, limit: 40 });
  await Promise.all(bookings.map((booking) => notificationService.queueNotification({
    userId: booking.customerUserId || null,
    channels: ['email', 'sms'],
    title,
    message,
    recipient: bookingRecipient(booking),
    referenceType,
    referenceId,
    meta: { bookingRef: booking.bookingRef, companyId, scheduleId },
  })));
}

async function updateCompanySettings(companyId, payload = {}, actorId = 'company-admin') {
  const company = await companyOrThrow(companyId);
  const owner = company.ownerId ? await repository.users.findOne({ id: company.ownerId }) : await repository.users.findOne({ companyId: company.id });
  if (!owner || canonicalRole(owner.role) !== 'company_admin' || String(owner.companyId || company.id) !== String(company.id)) {
    throw httpError('The company owner account could not be resolved for this profile update', 409);
  }
  const previousOwnerEmail = cleanText(owner.email || '', 254).toLowerCase();
  const previousOwnerPhone = cleanText(owner.phone || '', 50);
  const nextOwnerEmail = payload.ownerEmail !== undefined ? cleanText(payload.ownerEmail, 254).toLowerCase() : previousOwnerEmail;
  const nextOwnerPhone = payload.ownerPhone !== undefined ? cleanText(payload.ownerPhone, 50) : previousOwnerPhone;
  if (!nextOwnerEmail) throw httpError('Owner email is required', 422);
  if (!nextOwnerPhone) throw httpError('Owner phone is required', 422);
  const emailOwner = await repository.users.findOne({ email: nextOwnerEmail });
  if (emailOwner && String(emailOwner.id) !== String(owner.id)) throw httpError('Another account already uses this owner email', 409);
  const phoneOwner = await repository.users.findOne({ phone: nextOwnerPhone });
  if (phoneOwner && String(phoneOwner.id) !== String(owner.id)) throw httpError('Another account already uses this owner phone', 409);
  const emailChanged = nextOwnerEmail !== previousOwnerEmail;
  const phoneChanged = nextOwnerPhone !== previousOwnerPhone;
  owner.email = nextOwnerEmail;
  owner.phone = nextOwnerPhone;
  owner.updatedAt = new Date().toISOString();
  const requestedType = payload.companyType ? normalizeCompanyType(payload.companyType) : company.companyType;
  if (!COMPANY_TYPES.has(requestedType)) throw httpError('Unsupported company type', 422);
  if (company.companyType && requestedType !== normalizeCompanyType(company.companyType)) {
    throw httpError('Company service type can only be changed through platform verification', 409);
  }
  if (payload.name) company.name = cleanText(payload.name, 180);
  if (payload.city) company.city = cleanText(payload.city, 120);
  if (payload.country) company.country = cleanText(payload.country, 120);
  if (payload.description !== undefined) company.description = cleanText(payload.description, 3000);
  if (payload.legalName !== undefined) company.legalName = cleanText(payload.legalName || company.name, 200);
  if (payload.registrationNumber !== undefined) company.registrationNumber = cleanText(payload.registrationNumber, 120);
  if (payload.taxNumber !== undefined) company.taxNumber = cleanText(payload.taxNumber, 120);
  if (payload.headOfficeAddress !== undefined) company.headOfficeAddress = cleanText(payload.headOfficeAddress, 400);
  if (payload.website !== undefined) company.website = cleanText(payload.website, 300);
  company.companyType = requestedType;
  company.supportContacts = {
    ...(company.supportContacts || {}),
    email: cleanText(payload.supportEmail || company.supportContacts?.email || '', 254).toLowerCase(),
    phone: cleanText(payload.supportPhone || company.supportContacts?.phone || '', 50),
    whatsapp: cleanText(payload.supportWhatsapp || payload.supportPhone || company.supportContacts?.whatsapp || '', 50),
  };
  const payoutAccount = cleanText(payload.payoutAccount || company.settings?.payoutAccount || company.payoutAccount?.account || company.payoutAccount || '', 500);
  company.settings = {
    ...(company.settings || {}),
    defaultCurrency: String(company.operatingCurrency || company.settings?.defaultCurrency || platformCurrency()).toUpperCase(),
    payoutAccount,
    supportMessage: cleanText(payload.supportMessage || company.settings?.supportMessage || '', 2000),
    profileIncomplete: !cleanText(company.city, 120),
    missingProfileFields: cleanText(company.city, 120) ? [] : ['city'],
  };
  company.payoutAccount = typeof company.payoutAccount === 'object' && company.payoutAccount !== null
    ? { ...company.payoutAccount, account: payoutAccount }
    : payoutAccount;
  company.updatedAt = new Date().toISOString();
  await repository.withTransaction(async (session) => {
    await repository.companies.save(company, { id: company.id }, { session });
    await repository.users.save(owner, { id: owner.id }, { session });
    await audit(actorId, 'company.settings.updated', company.id, { entityType: 'company', ownerEmailChanged: emailChanged, ownerPhoneChanged: phoneChanged }, { session, actorRole: 'company_admin', entityType: 'company' });
  });
  if (emailChanged || phoneChanged) {
    await require('../onboarding/verificationService').invalidateContactVerificationForUser(owner.id, { emailChanged, phoneChanged }, actorId);
    if (emailChanged) await require('../auth/authService').resendVerificationEmail(owner.id);
    if (phoneChanged) await require('../auth/phoneVerificationService').requestCode(owner.id);
  }
  const refreshedOwner = await repository.users.findOne({ id: owner.id });
  return { company, owner: refreshedOwner || owner };
}

async function requestCompanyPayout(companyId, payload = {}, actorId = 'company-admin') {
  const company = await companyOrThrow(companyId);
  if (String(company.status || '').toLowerCase() !== 'active' || String(company.verificationStatus || '').toLowerCase() !== 'verified') {
    throw httpError('Company verification must be approved before requesting payouts.', 403);
  }
  const wallet = await walletService.getOrCreateWallet('company', company.id, company.operatingCurrency || platformCurrency());
  const amount = amountValue(payload.amount, wallet.availableBalance);
  if (!(amount > 0)) throw httpError('Payout amount must be greater than zero', 422);
  if (amount > Number(wallet.availableBalance || 0)) throw httpError('Payout amount exceeds available balance', 409);
  const result = await settlementService.requestOwnerPayout('company', company.id, amount, {
    ...payload,
    currency: wallet.currency,
    payoutAccount: payload.payoutAccount || company.payoutAccount || company.settings?.payoutAccount || '',
  }, actorId);
  await audit(actorId, 'company.payout.dashboard_requested', company.id, { entityType: 'company', amount, payoutRequestId: result.request?.id }, { actorRole: 'company_admin', entityType: 'company' });
  return result;
}

async function createCompanyNotice(companyId, payload = {}, actorId = 'dashboard-user', options = {}) {
  const company = await companyOrThrow(companyId);
  const message = cleanText(payload.message || payload.notice || payload.note, 4000);
  if (!message) throw httpError('Notice message is required', 422);
  const ownerType = options.allowCustomerOwner && normalize(payload.ownerType) === 'customer' ? 'customer' : 'company';
  const ownerId = ownerType === 'customer' ? cleanText(payload.ownerId, 180) : company.id;
  if (!ownerId) throw httpError('Notice owner is required', 422);
  const ticket = {
    id: await nextId('support'),
    ownerType,
    ownerId,
    companyId: company.id,
    subject: cleanText(payload.subject || `${company.name} notice`, 300),
    category: ownerType === 'customer' ? (options.category || 'customer_note') : (options.category || 'platform_notice'),
    message,
    audience: cleanText(payload.audience || 'customers', 300),
    priority: enumValue(payload.priority, TICKET_PRIORITIES, 'normal', 'ticket priority'),
    status: enumValue(payload.status, TICKET_STATUSES, 'open', 'ticket status'),
    scheduleId: cleanText(payload.scheduleId, 180),
    assignedTo: cleanText(payload.assignedTo || actorId, 180),
    createdBy: actorId,
    createdAt: new Date().toISOString(),
    metadata: { source: 'dashboard_notice', scheduleId: cleanText(payload.scheduleId, 180) },
  };
  await repository.withTransaction(async (session) => {
    await repository.tickets.save(ticket, { id: ticket.id }, { session });
    await audit(actorId, 'company.notice.sent', company.id, { entityType: 'support_ticket', ticketId: ticket.id, audience: ticket.audience }, { session, entityType: 'support_ticket' });
  });
  if (payload.notify !== false) {
    await notifyCompanyBookings({
      companyId: company.id,
      scheduleId: ticket.scheduleId,
      title: ticket.subject,
      message,
      referenceType: 'support_ticket',
      referenceId: ticket.id,
    });
  }
  return ticket;
}

async function updateSupportTicket(companyId, ticketId, payload = {}, actorId = 'dashboard-user') {
  const ticket = await repository.tickets.findOne({ id: ticketId, $or: [{ companyId }, { ownerId: companyId, ownerType: 'company' }] });
  if (!ticket) throw httpError('Support ticket not found', 404);
  if (payload.subject) ticket.subject = cleanText(payload.subject, 300);
  if (payload.priority) ticket.priority = enumValue(payload.priority, TICKET_PRIORITIES, ticket.priority || 'medium', 'ticket priority');
  if (payload.status) ticket.status = enumValue(payload.status, TICKET_STATUSES, ticket.status || 'open', 'ticket status');
  if (payload.assignedTo) {
    const assignedTo = cleanText(payload.assignedTo, 180);
    if (assignedTo !== actorId) {
      const membership = await repository.employees.findOne({ companyId, userId: assignedTo, status: 'active' });
      if (!membership) throw httpError('Assigned employee is not active in this company', 422);
    }
    ticket.assignedTo = assignedTo;
  }
  const response = cleanText(payload.response || payload.message, 4000);
  if (response) {
    const respondedAt = new Date().toISOString();
    ticket.replies = Array.isArray(ticket.replies) ? ticket.replies : [];
    ticket.replies.push({ message: response, actorId, actorType: 'company', createdAt: respondedAt });
    ticket.lastResponse = response;
    ticket.respondedBy = actorId;
    ticket.respondedAt = respondedAt;
  }
  if (ticket.status === 'resolved' || ticket.status === 'closed') {
    ticket.resolutionNotes = response || ticket.resolutionNotes || 'Resolved from company dashboard';
    ticket.resolvedBy = actorId;
    ticket.resolvedAt = new Date().toISOString();
  }
  ticket.updatedAt = new Date().toISOString();
  await repository.withTransaction(async (session) => {
    await repository.tickets.save(ticket, { id: ticket.id }, { session });
    await audit(actorId, 'support.ticket.updated', ticket.id, { entityType: 'support_ticket', status: ticket.status }, { session, entityType: 'support_ticket' });
  });
  return ticket;
}

async function replyToReview(companyId, reviewId, payload = {}, actorId = 'company-admin') {
  const review = await repository.reviews.findOne({ id: reviewId, companyId });
  if (!review) throw httpError('Review not found', 404);
  const reply = cleanText(payload.reply || payload.message || payload.response, 3000);
  if (!reply) throw httpError('Review reply is required', 422);
  review.companyReply = { message: reply, repliedBy: actorId, repliedAt: new Date().toISOString() };
  review.status = enumValue(payload.status, REVIEW_STATUSES, 'replied', 'review status');
  review.updatedAt = new Date().toISOString();
  await repository.withTransaction(async (session) => {
    await repository.reviews.save(review, { id: review.id }, { session });
    await audit(actorId, 'company.review.replied', review.id, { entityType: 'review' }, { session, entityType: 'review' });
  });
  return review;
}

async function createManualBooking(companyId, payload = {}, actorId = 'employee-system', options = {}) {
  let listingId = cleanText(payload.listingId, 180);
  if (!listingId) {
    const listing = await repository.listings.findOne({ companyId, bookable: true, status: 'active' });
    listingId = listing?.id || '';
  }
  const listing = await companyListingOrThrow(companyId, listingId);
  if (!listing.bookable || listing.status !== 'active') throw httpError('Listing is not currently bookable', 409);
  let booking;
  if (normalize(listing.serviceType) === 'hotel') {
    const requestedPaymentStatus = normalize(payload.paymentStatus || (options.canRecordPayment ? 'successful' : 'pending'));
    if (requestedPaymentStatus === 'successful' && options.canRecordPayment !== true) {
      throw httpError('Recording a paid hotel booking requires the payment.record permission', 403);
    }
    booking = await hotelService.createHotelBooking({
      ...payload,
      listingId: listing.id,
      source: 'company_manual',
      actorId,
      createdByEmployeeId: actorId,
      paymentStatus: requestedPaymentStatus,
      bookingStatus: requestedPaymentStatus === 'successful' ? 'confirmed' : 'pending_payment',
    }, { session: { user: { id: actorId } } }, { trustedManual: true, companyId });
  } else if (normalize(listing.serviceType) === 'bus') {
    booking = await busBookingService.createTrustedManualBooking({
      ...payload,
      listingId: listing.id,
      selectedSeats: payload.selectedSeats || payload.selected || payload.seatNumber,
    }, { actorId, companyId });
  } else {
    const fullName = cleanText(payload.fullName || payload.customerName, 180);
    const email = cleanText(payload.email, 254).toLowerCase();
    const phone = cleanText(payload.phone, 50);
    if (!fullName) throw httpError('Customer full name is required', 422);
    if (!email && !phone) throw httpError('Provide the customer email or phone number', 422);
    booking = await bookingService.createManualBooking({
      ...payload,
      listingId: listing.id,
      scheduleId: cleanText(payload.scheduleId, 180),
      roomTypeId: cleanText(payload.roomTypeId, 180),
      selected: cleanText(payload.selected || payload.seatNumber, 180),
      seatNumber: cleanText(payload.seatNumber, 80),
      fullName,
      email,
      phone,
    }, { actorId });
  }
  if (booking.companyId !== companyId) throw httpError('Booking company mismatch', 409);
  if (['hotel', 'bus'].includes(normalize(listing.serviceType))) {
    // Canonical service modules already persist the generic booking and every normalized hotel record in one transaction.
    // Saving the returned object again here could drift the generic row away from its reservation/assignment records.
    return booking;
  }
  Object.assign(booking, { source: 'employee_manual', createdByEmployeeId: actorId, createdAtDesk: new Date().toISOString() });
  await repository.withTransaction(async (session) => {
    await repository.bookings.save(booking, { bookingRef: booking.bookingRef }, { session });
    await audit(actorId, 'employee.booking.created', booking.bookingRef, { entityType: 'booking', companyId, listingId: listing.id }, { session, entityType: 'booking' });
  });
  return booking;
}

async function updateEmployeeInventory(companyId, payload = {}, actorId = 'employee-system') {
  let result;
  if (payload.inventoryId) {
    result = await hotelService.updateNightStatus(companyId, payload.inventoryId, {
      status: payload.status,
      housekeepingStatus: payload.housekeepingStatus,
      notes: payload.notes || payload.note,
    }, actorId);
    await audit(actorId, 'employee.room_night.updated', result.id, { entityType: 'room_night_inventory', companyId, roomUnitId: result.roomUnitId, date: result.date }, { entityType: 'room_night_inventory' });
    return { roomNight: result };
  }
  if (payload.roomUnitId) {
    result = await hotelService.updateHousekeeping(companyId, payload.roomUnitId, {
      status: payload.status,
      housekeepingStatus: payload.housekeepingStatus,
      taskStatus: payload.taskStatus,
      assignedTo: payload.assignedTo || actorId,
      notes: payload.notes || payload.note,
    }, actorId);
    await audit(actorId, 'employee.room_unit.updated', result.id, { entityType: 'room_unit', companyId, roomTypeId: result.roomTypeId }, { entityType: 'room_unit' });
    return { roomUnit: result };
  }
  if (payload.roomTypeId) {
    result = await hotelService.setRoomTypeInventory(companyId, payload.roomTypeId, {
      inventory: payload.inventory,
      status: payload.status,
      roomType: payload.roomType,
      capacity: payload.capacity,
      nightlyPrice: payload.nightlyPrice,
      amenities: payload.amenities,
    });
    await audit(actorId, 'employee.room.updated', result.id, { entityType: 'room', companyId }, { entityType: 'room' });
    return { room: result };
  }
  result = await companyService.updateSeatStatus(companyId, {
    scheduleId: payload.scheduleId,
    seatNumber: payload.seatNumber,
    seatId: payload.seatId,
    status: payload.status || 'blocked',
    seatClass: payload.seatClass,
    priceDelta: payload.priceDelta,
  });
  await audit(actorId, 'employee.seat.updated', `${payload.scheduleId}:${payload.seatNumber}`, { entityType: 'seat', companyId }, { entityType: 'seat' });
  return result;
}

async function sendDelayNotice(companyId, payload = {}, actorId = 'employee-system') {
  if (!payload.scheduleId) throw httpError('Schedule is required', 422);
  const schedule = await companyService.updateSchedule(companyId, payload.scheduleId, {
    status: 'delayed',
    departAt: payload.departAt,
    driverName: payload.driverName,
  });
  const message = cleanText(payload.message || `Schedule ${schedule.id} has been delayed. Please check your ticket for updates.`, 3000);
  const ticket = await createCompanyNotice(companyId, {
    subject: `Delay notice ${schedule.id}`,
    audience: 'customers on selected trip',
    priority: payload.priority || 'high',
    message,
    scheduleId: schedule.id,
  }, actorId);
  await audit(actorId, 'employee.delay.notice.sent', schedule.id, { entityType: 'schedule', ticketId: ticket.id }, { entityType: 'schedule' });
  return { schedule, ticket };
}

async function recordEmployeePayment(companyId, payload = {}, actorId = 'employee-system', options = {}) {
  const booking = await companyBookingOrThrow(companyId, payload.bookingRef);
  const requestedStatus = normalize(payload.status || 'successful');
  const statusAlias = ['paid', 'completed', 'complete', 'success'].includes(requestedStatus) ? 'successful' : requestedStatus;
  const status = enumValue(statusAlias, PAYMENT_STATUSES, 'successful', 'payment status');
  if (!['pending', 'successful'].includes(status)) throw httpError('Dashboard payments may only be pending or successful', 422);
  const provider = enumValue(payload.method || payload.provider, PAYMENT_PROVIDERS, 'cash', 'payment provider');
  const currency = cleanText(payload.currency || booking.pricing?.currency || platformCurrency(), 8).toUpperCase();
  const bookingCurrency = String(booking.pricing?.currency || platformCurrency()).toUpperCase();
  if (currency !== bookingCurrency) throw httpError('Payment currency must match the booking currency', 409);
  const successfulPayments = await repository.payments.list({ bookingRef: booking.bookingRef, status: 'successful' });
  const collected = successfulPayments.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const outstanding = Math.max(0, Number(booking.pricing?.total || 0) - collected);
  const amount = amountValue(payload.amount, outstanding);
  if (!(amount > 0)) {
    if (outstanding <= 0 && successfulPayments.length) return { payment: successfulPayments[0], booking, replayed: true };
    throw httpError('Payment amount must be greater than zero', 422);
  }
  if (status === 'successful' && Math.abs(amount - outstanding) > 0.01) {
    throw httpError(`Payment must equal the outstanding booking balance of ${bookingCurrency} ${outstanding}`, 422);
  }
  const providerReference = cleanText(payload.providerReference || `${provider === 'cash' ? 'CASH' : 'DESK'}-${booking.bookingRef}`, 240);
  const idempotencyKey = cleanText(payload.idempotencyKey || `employee:${companyId}:${booking.bookingRef}:${provider}:${providerReference}`, 300);
  const existing = await repository.payments.findOne({ idempotencyKey });
  const now = new Date().toISOString();
  if (existing && normalize(existing.status) === status) return { payment: existing, booking, replayed: true };
  if (existing && !(status === 'successful' && ['pending', 'created', 'processing'].includes(normalize(existing.status)))) {
    throw httpError('This payment reference has already been used with a different final status', 409);
  }
  if (existing && (String(existing.currency || '').toUpperCase() !== currency || Math.abs(Number(existing.amount || 0) - amount) > 0.01)) {
    throw httpError('A pending payment may be confirmed only with its original amount and currency', 409);
  }
  const payment = existing ? {
    ...existing,
    status: 'successful',
    paidAt: existing.paidAt || now,
    updatedAt: now,
    rawPayload: { ...(existing.rawPayload || {}), source: options.source || 'employee_dashboard', actorId, actorRole: options.actorRole || 'company_employee' },
    metadata: { ...(existing.metadata || {}), source: options.source || 'employee_dashboard', actorId, actorRole: options.actorRole || 'company_employee' },
  } : {
    id: await nextId('payment'), bookingId: booking.id, bookingRef: booking.bookingRef, companyId,
    customerUserId: booking.customerUserId || '', provider, providerReference, paymentRef: providerReference,
    amount, grossAmount: amount, currency, status, settlementStatus: 'pending',
    paidAt: status === 'successful' ? now : null,
    idempotencyKey, rawPayload: { source: options.source || 'employee_dashboard', actorId, actorRole: options.actorRole || 'company_employee' }, metadata: { source: options.source || 'employee_dashboard', actorId, actorRole: options.actorRole || 'company_employee' },
    createdAt: now,
  };
  booking.paymentStatus = status;
  booking.paymentProvider = provider;
  booking.paymentRef = providerReference;
  if (status === 'successful' && ['draft', 'pending', 'pending_payment'].includes(normalize(booking.bookingStatus))) booking.bookingStatus = 'confirmed';
  if (normalize(booking.serviceType) === 'hotel') {
    const successful = status === 'successful';
    booking.bookingStatus = successful ? 'confirmed' : 'pending_payment';
    booking.hotelStay = { ...(booking.hotelStay || {}), status: successful ? 'booked' : 'pending_payment' };
    booking.bookingItems = (booking.bookingItems || []).map((item) => ({ ...item, status: successful ? 'confirmed' : 'awaiting_payment' }));
    booking.ticketLegs = (booking.ticketLegs || []).map((leg) => ({
      ...leg,
      status: successful ? 'valid' : 'pending_payment',
      issuedAt: successful ? (leg.issuedAt || now) : null,
    }));
    booking.lockedUntil = successful ? null : booking.lockedUntil;
  }
  await repository.withTransaction(async (session) => {
    const duplicate = await repository.payments.findOne({ idempotencyKey }, { session });
    if (duplicate && !(status === 'successful' && ['pending', 'created', 'processing'].includes(normalize(duplicate.status)))) return;
    await repository.payments.save(payment, { idempotencyKey }, { session });
    await repository.bookings.save(booking, { bookingRef: booking.bookingRef }, { session });
    if (normalize(booking.serviceType) === 'hotel') {
      const lifecycle = await hotelRepository.applyPaymentLifecycle({
        bookingRef: booking.bookingRef,
        companyId,
        paymentStatus: status,
        reason: `Dashboard payment recorded by ${actorId}`,
        session,
      });
      if (!lifecycle?.reservation) throw httpError('Hotel booking has no canonical reservation. Run the hotel-domain migration before recording payment.', 409);
    }
    await audit(actorId, options.auditAction || 'employee.payment.recorded', payment.id, { entityType: 'payment', bookingRef: booking.bookingRef, amount, currency, actorRole: options.actorRole || 'company_employee' }, { session, entityType: 'payment' });
  });
  if (status === 'successful') {
    try {
      Object.assign(booking, await paymentSettlementService.settleBookingPayment(booking, { source: options.source || 'employee_dashboard' }) || {});
      await repository.bookings.save(booking, { bookingRef: booking.bookingRef });
    } catch (error) {
      booking.settlementStatus = 'reconciliation_required';
      booking.settlementError = cleanText(error.message, 1000);
      await repository.bookings.save(booking, { bookingRef: booking.bookingRef });
    }
  }
  await notificationService.paymentUpdated(booking, payment);
  if (status === 'successful' && normalize(booking.serviceType) === 'hotel') await notificationService.bookingConfirmed(booking);
  return { payment, booking, replayed: false };
}


async function recordCompanyPayment(companyId, payload = {}, actorId = 'company-admin') {
  return recordEmployeePayment(companyId, payload, actorId, {
    source: 'company_dashboard',
    actorRole: 'company_admin',
    auditAction: 'company.payment.recorded',
  });
}

async function requestEmployeeRefund(companyId, payload = {}, actorId = 'employee-system') {
  const booking = await companyBookingOrThrow(companyId, payload.bookingRef);
  const refund = await workflowService.requestRefundLive({
    bookingRef: booking.bookingRef,
    companyId,
    requesterId: cleanText(payload.requesterId || actorId, 180),
    amount: amountValue(payload.amount, booking.pricing?.total || 0),
    reason: cleanText(payload.reason || 'Employee created refund request', 3000),
    actorType: 'employee',
  });
  await audit(actorId, 'employee.refund.requested', refund.id, { entityType: 'refund_request', bookingRef: booking.bookingRef, companyId }, { entityType: 'refund_request' });
  return refund;
}

async function createEmployeeSupportNotice(companyId, payload = {}, actorId = 'employee-system') {
  const booking = payload.bookingRef ? await companyBookingOrThrow(companyId, payload.bookingRef) : null;
  return createCompanyNotice(companyId, {
    ownerType: booking ? 'customer' : 'company',
    ownerId: booking?.customerUserId || companyId,
    subject: payload.subject || (booking ? `Customer notice ${booking.bookingRef}` : 'Employee support notice'),
    audience: payload.audience || (booking ? booking.bookingRef : 'customers'),
    priority: payload.priority || 'normal',
    message: payload.message || payload.note,
    scheduleId: payload.scheduleId || booking?.scheduleId || '',
    assignedTo: actorId,
  }, actorId, { allowCustomerOwner: Boolean(booking), category: booking ? 'Customer support' : 'platform_notice' });
}

async function createCustomerNote(companyId, payload = {}, actorId = 'employee-system') {
  const booking = payload.bookingRef ? await companyBookingOrThrow(companyId, payload.bookingRef) : null;
  const ownerId = booking?.customerUserId || cleanText(payload.customerId || payload.customerName || payload.customer || 'walk-in', 180);
  const ticket = await createCompanyNotice(companyId, {
    ownerType: 'customer', ownerId,
    subject: cleanText(payload.subject || `Customer note ${booking?.bookingRef || payload.customerName || ''}`, 300),
    audience: cleanText(payload.customerName || booking?.guestSnapshot?.fullName || 'Customer', 200),
    priority: payload.priority || 'normal',
    message: cleanText(payload.message || payload.note || 'Customer note', 3000),
    scheduleId: booking?.scheduleId || '', notify: false,
  }, actorId, { allowCustomerOwner: true, category: 'customer_note' });
  await audit(actorId, 'employee.customer.note.created', ticket.id, { entityType: 'support_ticket', bookingRef: booking?.bookingRef || '' }, { entityType: 'support_ticket' });
  return ticket;
}

async function createHandover(companyId, payload = {}, actorId = 'employee-system') {
  await companyOrThrow(companyId);
  const membership = await repository.employees.findOne({ companyId, userId: actorId, status: 'active' });
  if (!membership) throw httpError('Active employee membership is required', 403);
  const note = cleanText(payload.note || payload.notes || payload.message, 4000);
  if (!note) throw httpError('Handover note is required', 422);
  const row = {
    id: await nextId('handover'), companyId, tenantId: companyId, userId: actorId, employeeId: membership.id || actorId,
    userName: cleanText(payload.userName || payload.employeeName, 180),
    shiftDate: payload.shiftDate ? new Date(payload.shiftDate).toISOString() : new Date().toISOString(),
    shift: cleanText(payload.shift || 'Current shift', 120), nextStaff: cleanText(payload.nextStaff || payload.nextEmployee || 'Next staff', 180),
    note, notes: note, cashCollected: Math.max(0, amountValue(payload.cashCollected, 0)),
    bookingsHandled: Math.max(0, Math.round(amountValue(payload.bookingsHandled, 0))),
    checkInsHandled: Math.max(0, Math.round(amountValue(payload.checkInsHandled, 0))),
    paymentsRecorded: Math.max(0, Math.round(amountValue(payload.paymentsRecorded, 0))),
    refundRequestsHandled: Math.max(0, Math.round(amountValue(payload.refundRequestsHandled, 0))),
    issues: cleanText(payload.issues, 3000),
    status: ['open', 'submitted'].includes(normalize(payload.status || 'submitted')) ? normalize(payload.status || 'submitted') : 'submitted',
    createdAt: new Date().toISOString(),
  };
  if (Number.isNaN(new Date(row.shiftDate).getTime())) throw httpError('Invalid shift date', 422);
  await repository.withTransaction(async (session) => {
    await repository.handovers.save(row, { id: row.id }, { session });
    await audit(actorId, 'employee.handover.created', row.id, { entityType: 'shift_handover', companyId }, { session, entityType: 'shift_handover' });
  });
  return row;
}

async function updateEmployeeProfile(companyId, payload = {}, actorId = 'employee-system', options = {}) {
  const canManageProfileAssignments = Boolean(options.canManageProfileAssignments);
  const [user, employee] = await Promise.all([
    repository.users.findOne({ id: actorId }),
    repository.employees.findOne({ companyId, userId: actorId }),
  ]);
  if (!user || !employee) throw httpError('Employee profile not found', 404);
  if (String(user.companyId || companyId) !== String(companyId) || String(employee.companyId) !== String(companyId)) throw httpError('Employee company mismatch', 403);
  const email = payload.email ? cleanText(payload.email, 254).toLowerCase() : '';
  const phone = payload.phone ? cleanText(payload.phone, 50) : '';
  const emailChanged = Boolean(email && email !== String(user.email || '').toLowerCase());
  const phoneChanged = Boolean(phone && phone !== String(user.phone || ''));
  if (email || phone) {
    const or = [];
    if (email) or.push({ email });
    if (phone) or.push({ phone });
    const conflict = await repository.users.findOne({ id: { $ne: user.id }, $or: or });
    if (conflict) throw httpError(email && conflict.email === email ? 'Email is already in use' : 'Phone number is already in use', 409);
  }
  if (payload.fullName) user.fullName = cleanText(payload.fullName, 180);
  if (email) user.email = email;
  if (phone) user.phone = phone;
  user.companyId = companyId;
  user.updatedAt = new Date().toISOString();
  if (canManageProfileAssignments) {
    if (payload.roleTitle) employee.roleTitle = cleanText(payload.roleTitle, 180);
    if (payload.branch) employee.branch = cleanText(payload.branch, 180);
    if (payload.permissions !== undefined) employee.permissions = employeePermissions(employee.roleTitle, payload.permissions);
  }
  if (payload.shift !== undefined) employee.shift = cleanText(payload.shift, 180);
  if (payload.notes !== undefined) employee.notes = cleanText(payload.notes, 3000);
  employee.updatedAt = new Date().toISOString();
  await repository.withTransaction(async (session) => {
    await repository.users.save(user, { id: user.id }, { session });
    await repository.employees.save(employee, { id: employee.id }, { session });
    await audit(actorId, 'employee.profile.updated', user.id, {
      entityType: 'company_employee', companyId,
      assignmentsUpdated: canManageProfileAssignments && Boolean(payload.roleTitle || payload.branch || payload.permissions !== undefined),
    }, { session, entityType: 'company_employee' });
  });
  if (emailChanged || phoneChanged) {
    await require('../onboarding/verificationService').invalidateContactVerificationForUser(user.id, { emailChanged, phoneChanged }, actorId);
    if (emailChanged) await require('../auth/authService').resendVerificationEmail(user.id);
    if (phoneChanged && phone) await require('../auth/phoneVerificationService').requestCode(user.id);
  }
  const refreshedUser = await repository.users.findOne({ id: user.id });
  const refreshedEmployee = await repository.employees.findOne({ id: employee.id, companyId });
  return { user: refreshedUser || user, employee: refreshedEmployee || employee };
}

async function createDriverInviteRequest(companyId, payload = {}, actorId = 'company-admin') {
  const company = await companyOrThrow(companyId);
  if (normalize(company.status) !== 'active' || normalize(company.verificationStatus) !== 'verified') {
    throw httpError('The partner company must be approved by Super Admin before its Partner Admin can invite employees', 409);
  }

  const fullName = cleanText(payload.fullName || payload.name, 180);
  const email = cleanText(payload.email, 254).toLowerCase();
  const phone = cleanText(payload.phone, 50);
  if (!fullName || !email || !phone) throw httpError('Driver name, email, and phone are required', 422);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError('Enter a valid driver email address', 422);

  const vehicle = payload.vehicleId ? await companyVehicleOrThrow(company.id, payload.vehicleId) : null;
  const schedule = payload.scheduleId ? await companyScheduleOrThrow(company.id, payload.scheduleId) : null;
  if (vehicle && schedule && schedule.vehicleId && String(schedule.vehicleId) !== String(vehicle.id)) {
    throw httpError('Selected departure uses a different vehicle', 422);
  }

  const timestamp = new Date().toISOString();
  let driverEmployee = await repository.employees.findOne({
    companyId: company.id,
    roleTitle: { $regex: /^driver$/i },
    $or: [{ email }, ...(phone ? [{ phone }] : [])],
    status: { $nin: ['rejected', 'revoked'] },
  });
  if (!driverEmployee) {
    driverEmployee = {
      id: await nextId('company-employee'), companyId: company.id, userId: '',
      fullName, email, phone, roleTitle: 'Driver', serviceCategories: ['driver', 'bus'],
      permissions: employeePermissions('Driver', ['manifest.view', 'checkin.assist', 'trip.status.update', 'incident.create']),
      licenseNumber: cleanText(payload.licenseNumber, 120), licenseClass: cleanText(payload.licenseClass, 80),
      pendingVehicleId: vehicle?.id || '', pendingScheduleId: schedule?.id || '',
      safetyStatus: 'not_submitted', onboardingStatus: 'invitation_pending', status: 'requested',
      createdAt: timestamp, updatedAt: timestamp,
    };
  } else {
    Object.assign(driverEmployee, {
      fullName, email, phone,
      licenseNumber: cleanText(payload.licenseNumber || driverEmployee.licenseNumber, 120),
      licenseClass: cleanText(payload.licenseClass || driverEmployee.licenseClass, 80),
      pendingVehicleId: vehicle?.id || driverEmployee.pendingVehicleId || '',
      pendingScheduleId: schedule?.id || driverEmployee.pendingScheduleId || '',
      serviceCategories: Array.from(new Set([...(driverEmployee.serviceCategories || []), 'driver', 'bus'])),
      permissions: employeePermissions('Driver', driverEmployee.permissions || ['manifest.view', 'checkin.assist', 'trip.status.update', 'incident.create']),
      updatedAt: timestamp,
    });
  }

  const existingInvitation = await repository.invitations.findOne({
    companyId: company.id, type: 'driver', email,
    status: { $in: ['sent', 'requested', 'accepted'] },
  });
  let invitation = existingInvitation;
  if (!invitation) {
    const invitationService = require('../onboarding/invitationService');
    invitation = await invitationService.createInvitation({
      type: 'driver', fullName, email, phone,
      companyId: company.id, companyName: company.name, roleTitle: 'Driver',
      permissions: driverEmployee.permissions, serviceCategories: ['driver', 'bus'],
      vehicleId: vehicle?.id || '', scheduleId: schedule?.id || '',
      licenseNumber: driverEmployee.licenseNumber || '', licenseClass: driverEmployee.licenseClass || '',
      driverEmployeeId: driverEmployee.id,
      termsSummary: 'This driver is managed and approved by the Partner Admin. Platform approval applies only to the partner company.',
      validDays: 7,
    }, actorId, 'company_staff');
  }

  driverEmployee.invitationId = invitation.id;
  driverEmployee.status = normalize(invitation.status) === 'accepted' ? 'pending_verification' : 'invited';
  driverEmployee.onboardingStatus = normalize(invitation.status) === 'accepted' ? 'account_setup_complete' : 'invitation_sent';
  driverEmployee.invitedAt = invitation.sentAt || driverEmployee.invitedAt || timestamp;
  driverEmployee.updatedAt = timestamp;
  invitation.meta = { ...(invitation.meta || {}), driverEmployeeId: driverEmployee.id };
  const invitationRecord = { ...invitation };
  delete invitationRecord.token;

  await repository.withTransaction(async (session) => {
    await repository.employees.save(driverEmployee, { id: driverEmployee.id }, { session });
    await repository.invitations.save(invitationRecord, { id: invitationRecord.id }, { session });
    await audit(actorId, 'company.driver_invitation.sent', driverEmployee.id, {
      entityType: 'company_employee', companyId: company.id, invitationId: invitation.id,
      vehicleId: vehicle?.id || '', scheduleId: schedule?.id || '', approvalOwner: 'partner_admin',
    }, { session, entityType: 'company_employee' });
  });
  return { invitation, driverEmployee };
}

module.exports = {
  updateCompanySettings,
  requestCompanyPayout,
  createCompanyNotice,
  createDriverInviteRequest,
  updateSupportTicket,
  replyToReview,
  createManualBooking,
  updateEmployeeInventory,
  sendDelayNotice,
  recordEmployeePayment,
  recordCompanyPayment,
  requestEmployeeRefund,
  createEmployeeSupportNotice,
  createCustomerNote,
  createHandover,
  updateEmployeeProfile,
};
