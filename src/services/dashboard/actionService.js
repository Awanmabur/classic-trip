const store = require('../data/demoStore');
const bookingService = require('../booking/bookingService');
const companyService = require('../company/companyService');
const notificationService = require('../notification/notificationService');
const walletService = require('../wallet/walletService');
const workflowService = require('../support/workflowService');
const { mongoose } = require('../../config/db');

function mongoReady() {
  return mongoose.connection.readyState === 1;
}

async function upsertModel(modelName, row, filter = { id: row.id }) {
  if (!mongoReady() || !row) return;
  const Model = require(`../../models/${modelName}`);
  await Model.updateOne(filter, { $set: row }, { upsert: true, runValidators: true });
}

function ensureCollections() {
  if (!Array.isArray(store.state.supportTickets)) store.state.supportTickets = [];
  if (!Array.isArray(store.state.refundRequests)) store.state.refundRequests = [];
  if (!Array.isArray(store.state.reviews)) store.state.reviews = [];
  if (!Array.isArray(store.state.payments)) store.state.payments = [];
  if (!Array.isArray(store.state.companyEmployees)) store.state.companyEmployees = [];
  if (!Array.isArray(store.state.shiftHandovers)) store.state.shiftHandovers = [];
  if (!Array.isArray(store.state.auditLogs)) store.state.auditLogs = [];
}

function cleanText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

function parseList(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  return String(value || '')
    .split(',')
    .map(cleanText)
    .filter(Boolean);
}

function amountValue(value, fallback = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const cleaned = String(value || '').replace(/[^0-9.-]/g, '');
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? amount : fallback;
}

function normalize(value) {
  return String(value || '').toLowerCase().trim();
}

function statusValue(value, fallback = 'open') {
  return cleanText(value || fallback).toLowerCase().replace(/\s+/g, '_');
}

function nextId(prefix, rows) {
  let index = rows.length + 1;
  let id = `${prefix}-${index}`;
  while (rows.some((row) => row.id === id)) {
    index += 1;
    id = `${prefix}-${index}`;
  }
  return id;
}

function audit(actorId, action, target, meta = {}) {
  ensureCollections();
  const entry = {
    id: nextId('audit', store.state.auditLogs),
    actorId: actorId || 'dashboard-system',
    action,
    target,
    meta,
    createdAt: new Date().toISOString(),
  };
  store.state.auditLogs.push(entry);
  return entry;
}

function findCompanyOrThrow(companyId) {
  const company = store.findCompany(companyId);
  if (!company) {
    const error = new Error('Company not found');
    error.status = 404;
    throw error;
  }
  return company;
}

function companyBookingOrThrow(companyId, bookingRef) {
  const booking = store.findBooking(bookingRef);
  if (!booking || booking.companyId !== companyId) {
    const error = new Error('Booking not found for this company');
    error.status = 404;
    throw error;
  }
  return booking;
}

function companyListingOrThrow(companyId, listingId) {
  const listing = store.findListing(listingId);
  if (!listing || listing.companyId !== companyId) {
    const error = new Error('Listing not found for this company');
    error.status = 404;
    throw error;
  }
  return listing;
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
  const bookings = store.state.bookings
    .filter((booking) => booking.companyId === companyId)
    .filter((booking) => !scheduleId || booking.scheduleId === scheduleId)
    .slice(0, 40);

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
  ensureCollections();
  const company = findCompanyOrThrow(companyId);
  if (payload.name) company.name = cleanText(payload.name);
  if (payload.companyType) company.companyType = cleanText(payload.companyType);
  if (payload.city) company.city = cleanText(payload.city);
  if (payload.country) company.country = cleanText(payload.country);
  if (payload.description) company.description = cleanText(payload.description);
  company.supportContacts = {
    ...(company.supportContacts || {}),
    email: cleanText(payload.supportEmail || company.supportContacts?.email || ''),
    phone: cleanText(payload.supportPhone || company.supportContacts?.phone || ''),
    whatsapp: cleanText(payload.supportWhatsapp || payload.supportPhone || company.supportContacts?.whatsapp || ''),
  };
  company.settings = {
    ...(company.settings || {}),
    defaultCurrency: cleanText(payload.defaultCurrency || payload.currency || company.settings?.defaultCurrency || 'UGX'),
    payoutAccount: cleanText(payload.payoutAccount || company.settings?.payoutAccount || company.payoutAccount || ''),
    supportMessage: cleanText(payload.supportMessage || company.settings?.supportMessage || ''),
  };
  company.payoutAccount = company.settings.payoutAccount;
  company.updatedAt = new Date().toISOString();
  audit(actorId, 'company.settings.updated', company.id);
  await upsertModel('Company', company);
  return company;
}

async function requestCompanyPayout(companyId, payload = {}, actorId = 'company-admin') {
  ensureCollections();
  const company = findCompanyOrThrow(companyId);
  const wallet = walletService.getOrCreateWallet('company', company.id, payload.currency || company.settings?.defaultCurrency || 'UGX');
  const amount = amountValue(payload.amount, wallet.availableBalance);
  const result = walletService.requestWithdrawal('company', company.id, amount, {
    currency: wallet.currency,
    referenceType: 'company_payout',
    referenceId: company.id,
    requestedBy: actorId,
  });
  if (result.transaction) {
    Object.assign(result.transaction, {
      payoutMethod: cleanText(payload.payoutMethod || payload.method || 'bank'),
      payoutAccount: cleanText(payload.payoutAccount || company.payoutAccount || company.settings?.payoutAccount || ''),
      note: cleanText(payload.note || ''),
      requestedBy: actorId,
      updatedAt: new Date().toISOString(),
    });
    await upsertModel('WalletTransaction', result.transaction);
  }
  await upsertModel('Wallet', result.wallet);
  audit(actorId, 'company.payout.requested', company.id, { amount });
  return result;
}

async function createCompanyNotice(companyId, payload = {}, actorId = 'dashboard-user') {
  ensureCollections();
  const company = findCompanyOrThrow(companyId);
  const message = cleanText(payload.message || payload.notice || payload.note);
  if (!message) {
    const error = new Error('Notice message is required');
    error.status = 422;
    throw error;
  }
  const ticket = {
    id: nextId('support', store.state.supportTickets),
    ownerType: cleanText(payload.ownerType || 'company'),
    ownerId: cleanText(payload.ownerId || company.id),
    companyId: company.id,
    subject: cleanText(payload.subject || `${company.name} notice`),
    message,
    audience: cleanText(payload.audience || 'customers'),
    priority: statusValue(payload.priority, 'normal'),
    status: statusValue(payload.status, 'open'),
    scheduleId: cleanText(payload.scheduleId || ''),
    assignedTo: cleanText(payload.assignedTo || actorId),
    createdBy: actorId,
    createdAt: new Date().toISOString(),
  };
  store.state.supportTickets.unshift(ticket);
  await upsertModel('SupportTicket', ticket);
  audit(actorId, 'company.notice.sent', company.id, { ticketId: ticket.id, audience: ticket.audience });
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
  ensureCollections();
  const ticket = store.state.supportTickets.find((item) => item.id === ticketId && (!item.companyId || item.companyId === companyId || item.ownerId === companyId));
  if (!ticket) {
    const error = new Error('Support ticket not found');
    error.status = 404;
    throw error;
  }
  if (payload.subject) ticket.subject = cleanText(payload.subject);
  if (payload.priority) ticket.priority = statusValue(payload.priority, ticket.priority);
  if (payload.status) ticket.status = statusValue(payload.status, ticket.status);
  if (payload.assignedTo) ticket.assignedTo = cleanText(payload.assignedTo);
  if (payload.message || payload.response) {
    ticket.lastResponse = cleanText(payload.response || payload.message);
    ticket.respondedBy = actorId;
    ticket.respondedAt = new Date().toISOString();
  }
  ticket.updatedAt = new Date().toISOString();
  await upsertModel('SupportTicket', ticket);
  audit(actorId, 'support.ticket.updated', ticket.id, { status: ticket.status });
  return ticket;
}

async function replyToReview(companyId, reviewId, payload = {}, actorId = 'company-admin') {
  ensureCollections();
  const review = store.state.reviews.find((item) => item.id === reviewId && item.companyId === companyId);
  if (!review) {
    const error = new Error('Review not found');
    error.status = 404;
    throw error;
  }
  const reply = cleanText(payload.reply || payload.message || payload.response);
  if (!reply) {
    const error = new Error('Review reply is required');
    error.status = 422;
    throw error;
  }
  review.companyReply = {
    message: reply,
    repliedBy: actorId,
    repliedAt: new Date().toISOString(),
  };
  review.status = cleanText(payload.status || 'replied');
  review.updatedAt = new Date().toISOString();
  await upsertModel('Review', review);
  audit(actorId, 'company.review.replied', review.id);
  return review;
}

async function createManualBooking(companyId, payload = {}, actorId = 'employee-system') {
  ensureCollections();
  const listingId = cleanText(payload.listingId) || store.state.listings.find((listing) => listing.companyId === companyId && listing.bookable && listing.status === 'active')?.id;
  const listing = companyListingOrThrow(companyId, listingId);
  const booking = await bookingService.createGuestBooking({
    listingId: listing.id,
    scheduleId: cleanText(payload.scheduleId || ''),
    roomId: cleanText(payload.roomId || ''),
    selected: cleanText(payload.selected || payload.seatNumber || ''),
    seatNumber: cleanText(payload.seatNumber || ''),
    fullName: cleanText(payload.fullName || payload.customerName || 'Walk-in customer'),
    email: cleanText(payload.email || 'walkin@classictrip.example'),
    phone: cleanText(payload.phone || '+256700000000'),
    addons: payload.addons,
  });
  booking.source = 'employee_manual';
  booking.createdByEmployeeId = actorId;
  booking.createdAtDesk = new Date().toISOString();
  await upsertModel('Booking', booking, { bookingRef: booking.bookingRef });
  audit(actorId, 'employee.booking.created', booking.bookingRef, { companyId });
  return booking;
}

async function updateEmployeeInventory(companyId, payload = {}, actorId = 'employee-system') {
  ensureCollections();
  let result;
  if (payload.roomId) {
    result = await companyService.updateRoomInventory(companyId, payload.roomId, {
      inventory: payload.inventory,
      status: payload.status,
      roomType: payload.roomType,
      capacity: payload.capacity,
      nightlyPrice: payload.nightlyPrice,
      amenities: payload.amenities,
    });
    audit(actorId, 'employee.room.updated', result.id, { companyId });
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
  audit(actorId, 'employee.seat.updated', `${payload.scheduleId}:${payload.seatNumber}`, { companyId });
  return result;
}

async function sendDelayNotice(companyId, payload = {}, actorId = 'employee-system') {
  ensureCollections();
  if (!payload.scheduleId) {
    const error = new Error('Schedule is required');
    error.status = 422;
    throw error;
  }
  const schedule = await companyService.updateSchedule(companyId, payload.scheduleId, {
    status: 'delayed',
    departAt: payload.departAt,
    driverName: payload.driverName,
  });
  const message = cleanText(payload.message || `Schedule ${schedule.id} has been delayed. Please check your ticket for updates.`);
  const ticket = await createCompanyNotice(companyId, {
    ownerType: 'company',
    subject: `Delay notice ${schedule.id}`,
    audience: 'customers on selected trip',
    priority: payload.priority || 'high',
    message,
    scheduleId: schedule.id,
  }, actorId);
  audit(actorId, 'employee.delay.notice.sent', schedule.id, { ticketId: ticket.id });
  return { schedule, ticket };
}

async function recordEmployeePayment(companyId, payload = {}, actorId = 'employee-system') {
  ensureCollections();
  const booking = companyBookingOrThrow(companyId, payload.bookingRef);
  const status = statusValue(payload.status || 'successful', 'successful');
  const payment = {
    id: nextId('payment', store.state.payments),
    bookingId: booking.id,
    bookingRef: booking.bookingRef,
    provider: cleanText(payload.method || payload.provider || 'cash'),
    providerReference: cleanText(payload.providerReference || `desk-${Date.now()}`),
    amount: amountValue(payload.amount, booking.pricing?.total || 0),
    currency: cleanText(payload.currency || booking.pricing?.currency || 'UGX'),
    status,
    paidAt: ['successful', 'paid', 'completed'].includes(status) ? new Date().toISOString() : null,
    idempotencyKey: cleanText(payload.idempotencyKey || `desk:${booking.bookingRef}:${Date.now()}`),
    rawPayload: { source: 'employee_dashboard', actorId },
    createdAt: new Date().toISOString(),
  };
  store.state.payments.push(payment);
  booking.paymentStatus = status === 'paid' ? 'successful' : status;
  if (['successful', 'paid', 'completed'].includes(status) && ['draft', 'pending'].includes(booking.bookingStatus)) {
    booking.bookingStatus = 'confirmed';
  }
  await upsertModel('Payment', payment);
  await upsertModel('Booking', booking, { bookingRef: booking.bookingRef });
  await notificationService.paymentUpdated(booking, payment);
  audit(actorId, 'employee.payment.recorded', payment.id, { bookingRef: booking.bookingRef });
  return { payment, booking };
}

async function requestEmployeeRefund(companyId, payload = {}, actorId = 'employee-system') {
  ensureCollections();
  const booking = companyBookingOrThrow(companyId, payload.bookingRef);
  const refund = workflowService.requestRefund({
    bookingRef: booking.bookingRef,
    requesterId: cleanText(payload.requesterId || actorId),
    amount: amountValue(payload.amount, booking.pricing?.total || 0),
    reason: cleanText(payload.reason || 'Employee created refund request'),
  });
  refund.companyId = companyId;
  refund.createdBy = actorId;
  refund.updatedAt = new Date().toISOString();
  const ticket = store.state.supportTickets.find((item) => item.subject === `Refund request ${booking.bookingRef}`);
  if (ticket) {
    ticket.companyId = companyId;
    ticket.assignedTo = actorId;
    ticket.updatedAt = new Date().toISOString();
    await upsertModel('SupportTicket', ticket);
  }
  await upsertModel('RefundRequest', refund);
  audit(actorId, 'employee.refund.requested', refund.id, { bookingRef: booking.bookingRef });
  return refund;
}

async function createEmployeeSupportNotice(companyId, payload = {}, actorId = 'employee-system') {
  const booking = payload.bookingRef ? companyBookingOrThrow(companyId, payload.bookingRef) : null;
  return createCompanyNotice(companyId, {
    ownerType: booking ? 'customer' : 'company',
    ownerId: booking?.customerUserId || companyId,
    subject: payload.subject || (booking ? `Customer notice ${booking.bookingRef}` : 'Employee support notice'),
    audience: payload.audience || (booking ? booking.bookingRef : 'customers'),
    priority: payload.priority || 'normal',
    message: payload.message || payload.note,
    scheduleId: payload.scheduleId || booking?.scheduleId || '',
    assignedTo: actorId,
  }, actorId);
}

async function createCustomerNote(companyId, payload = {}, actorId = 'employee-system') {
  const booking = payload.bookingRef ? companyBookingOrThrow(companyId, payload.bookingRef) : null;
  const ticket = await createCompanyNotice(companyId, {
    ownerType: 'customer',
    ownerId: booking?.customerUserId || cleanText(payload.customerName || payload.customer || 'walk-in'),
    subject: cleanText(payload.subject || `Customer note ${booking?.bookingRef || payload.customerName || ''}`),
    audience: cleanText(payload.customerName || booking?.guestSnapshot?.fullName || 'Customer'),
    priority: payload.priority || 'normal',
    message: cleanText(payload.message || payload.note || 'Customer note'),
    scheduleId: booking?.scheduleId || '',
    notify: false,
  }, actorId);
  audit(actorId, 'employee.customer.note.created', ticket.id, { bookingRef: booking?.bookingRef });
  return ticket;
}

async function createHandover(companyId, payload = {}, actorId = 'employee-system') {
  ensureCollections();
  const note = cleanText(payload.note || payload.notes || payload.message);
  if (!note) {
    const error = new Error('Handover note is required');
    error.status = 422;
    throw error;
  }
  const row = {
    id: nextId('handover', store.state.shiftHandovers),
    companyId,
    employeeId: actorId,
    shift: cleanText(payload.shift || 'Current shift'),
    nextStaff: cleanText(payload.nextStaff || payload.nextEmployee || 'Next staff'),
    note,
    status: cleanText(payload.status || 'open'),
    createdAt: new Date().toISOString(),
  };
  store.state.shiftHandovers.unshift(row);
  audit(actorId, 'employee.handover.created', row.id, { companyId });
  return row;
}

async function updateEmployeeProfile(companyId, payload = {}, actorId = 'employee-system') {
  ensureCollections();
  let user = store.state.users.find((item) => item.id === actorId);
  if (!user) {
    user = store.upsertUser({
      fullName: cleanText(payload.fullName || 'Company Employee'),
      email: cleanText(payload.email || `${actorId}@classictrip.example`),
      role: 'company_employee',
      companyId,
      status: 'active',
      isVerified: true,
    });
  }
  if (payload.fullName) user.fullName = cleanText(payload.fullName);
  if (payload.email) user.email = cleanText(payload.email).toLowerCase();
  if (payload.phone) user.phone = cleanText(payload.phone);
  user.companyId = companyId;
  user.updatedAt = new Date().toISOString();

  let employee = store.state.companyEmployees.find((item) => item.companyId === companyId && item.userId === user.id);
  if (!employee) {
    employee = {
      id: nextId('company-employee', store.state.companyEmployees),
      companyId,
      userId: user.id,
      roleTitle: cleanText(payload.roleTitle || 'Ticket Checker'),
      branch: cleanText(payload.branch || 'Main branch'),
      permissions: parseList(payload.permissions || 'check_in,view_bookings'),
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    store.state.companyEmployees.push(employee);
  }
  if (payload.roleTitle) employee.roleTitle = cleanText(payload.roleTitle);
  if (payload.branch) employee.branch = cleanText(payload.branch);
  if (payload.permissions) employee.permissions = parseList(payload.permissions);
  if (payload.shift) employee.shift = cleanText(payload.shift);
  if (payload.notes) employee.notes = cleanText(payload.notes);
  employee.updatedAt = new Date().toISOString();

  await upsertModel('User', user);
  await upsertModel('CompanyEmployee', employee);
  audit(actorId, 'employee.profile.updated', user.id, { companyId });
  return { user, employee };
}

module.exports = {
  updateCompanySettings,
  requestCompanyPayout,
  createCompanyNotice,
  updateSupportTicket,
  replyToReview,
  createManualBooking,
  updateEmployeeInventory,
  sendDelayNotice,
  recordEmployeePayment,
  requestEmployeeRefund,
  createEmployeeSupportNotice,
  createCustomerNote,
  createHandover,
  updateEmployeeProfile,
};
