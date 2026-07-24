const { platformCurrency } = require('../../utils/currency');
const promoterRepository = require('../../repositories/domain/promoterRepository');
const notificationService = require('../notification/notificationService');
const walletService = require('../wallet/walletService');
const busBookingService = require('../../modules/bus/services/busBookingService');
const hotelService = require('../hotel/hotelService');
const { nextId } = require('../data/idService');

function cleanText(value, max = 500) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePhone(value) {
  return String(value || '').replace(/[^\d+]/g, '').replace(/^00/, '+').trim();
}

function hasOfflinePermission(agent = {}, profile = {}) {
  const embedded = agent.promoterProfile || agent.agentProfile || {};
  const permissions = profile.permissions || profile.agentPermissions || embedded.agentPermissions || embedded.permissions || agent.permissions || [];
  if (profile.offlineSalesEnabled === true || embedded.offlineSalesEnabled === true || embedded.canSellOffline === true || agent.canSellOffline === true) return true;
  if (Array.isArray(permissions) && (permissions.includes('offline_sales') || permissions.includes('agent_sales'))) return true;
  if (permissions && typeof permissions === 'object' && (permissions.offlineSales || permissions.agentSales)) return true;
  return normalize(agent.role) === 'promoter' && normalize(agent.status) === 'active' && normalize(agent.verificationStatus || 'verified') === 'verified';
}

async function ensureAgent(agentId) {
  const agent = await promoterRepository.users.findOne({ id: agentId });
  const profile = await promoterRepository.profiles.findOne({ $or: [{ userId: agentId }, { promoterId: agentId }] });
  if (!agent || normalize(agent.role) !== 'promoter') {
    const error = new Error('Offline ticket sales are only available to approved promoter accounts');
    error.status = 403;
    throw error;
  }
  const verified = normalize(agent.verificationStatus) === 'verified';
  if (normalize(agent.status) !== 'active' || !verified) {
    const error = new Error('Promoter account must be active and verified before recording offline sales');
    error.status = 403;
    throw error;
  }
  if (profile && normalize(profile.status) !== 'active') {
    const error = new Error('Promoter offline-sales profile is not active');
    error.status = 403;
    throw error;
  }
  if (!hasOfflinePermission(agent, profile || {})) {
    const error = new Error('Agent offline-sales permission is not enabled');
    error.status = 403;
    throw error;
  }
  return { agent, profile: profile || {} };
}

async function findOrCreateCustomer(payload = {}) {
  const email = cleanText(payload.email || payload.customerEmail, 254).toLowerCase();
  const phone = normalizePhone(payload.phone || payload.customerPhone);
  const fullName = cleanText(payload.fullName || payload.customerName || payload.passengerName || 'Offline Customer', 160);
  let existing = null;
  if (email) existing = await promoterRepository.users.findOne({ email });
  if (!existing && phone) existing = await promoterRepository.users.findOne({ phone });
  if (existing) {
    if (existing.role !== 'customer') {
      const error = new Error('The supplied customer contact belongs to a non-customer account');
      error.status = 409;
      throw error;
    }
    Object.assign(existing, {
      fullName: existing.fullName || fullName,
      phone: existing.phone || phone,
      email: existing.email || email,
      updatedAt: new Date().toISOString(),
    });
    await promoterRepository.users.save(existing, { id: existing.id });
    return existing;
  }
  const customer = {
    role: 'customer',
    fullName,
    email: email || `offline-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@classictrip.local`,
    phone,
    status: 'active',
    isVerified: false,
    source: 'agent_offline_sale',
    createdAt: new Date().toISOString(),
  };
  Object.assign(customer, await promoterRepository.users.insert(customer));
  await walletService.getOrCreateWallet('customer', customer.id, cleanText(payload.currency || platformCurrency(), 8).toUpperCase());
  return customer;
}

function createReceipt({ sale, booking, payment }) {
  const now = new Date().toISOString();
  return {
    receiptRef: `RCPT-${sale.saleRef}`,
    receiptUrl: `/promoter/offline-sales/${encodeURIComponent(sale.id)}/receipt`,
    ticketUrl: `/tickets/${encodeURIComponent(booking.bookingRef)}`,
    printedAt: now,
    paymentReference: payment.providerReference || payment.id,
  };
}

async function enforceDailyLimit(agent, profile, amountCollected) {
  const dailyLimit = Number(profile.dailyLimit || agent.promoterProfile?.dailyLimit || 0);
  if (!dailyLimit) return;
  const today = new Date().toISOString().slice(0, 10);
  const existing = await promoterRepository.offlineSales.list({ agentId: agent.id });
  const collectedToday = existing
    .filter((sale) => String(sale.createdAt || '').slice(0, 10) === today && ['completed', 'confirmed'].includes(sale.status))
    .reduce((sum, sale) => sum + Number(sale.amountCollected || 0), 0);
  if (collectedToday + amountCollected > dailyLimit) {
    const error = new Error('This sale exceeds the promoter daily offline-sales limit');
    error.status = 403;
    throw error;
  }
}

async function findListing(identifier) {
  const key = cleanText(identifier, 180);
  if (!key) return null;
  return promoterRepository.listings.findOne({ $or: [{ id: key }, { slug: key }] });
}


function listValues(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (!value) return [];
  try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) return parsed.map((item) => String(item || '').trim()).filter(Boolean); } catch (error) { /* comma-separated fallback */ }
  return String(value).split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean);
}
async function createOfflineSale(payload = {}, context = {}) {
  const { agent, profile } = await ensureAgent(context.agentId || payload.agentId);
  const listing = await findListing(payload.listingId || payload.slug);
  if (!listing || listing.status !== 'active' || listing.bookable === false) {
    const error = new Error('Listing is not available for offline sale');
    error.status = listing ? 409 : 404;
    throw error;
  }
  if (!['bus', 'hotel'].includes(listing.serviceType)) {
    const error = new Error('Offline sales are enabled only for live bus and hotel inventory');
    error.status = 422;
    throw error;
  }

  const paymentMethod = normalize(payload.paymentMethod || 'cash');
  if (paymentMethod !== 'cash') {
    const error = new Error('Offline promoter sales must be recorded as cash; online methods must use the normal checkout flow');
    error.status = 422;
    throw error;
  }
  const amountCollected = Math.max(0, Number(payload.amountCollected || payload.total || 0));
  if (amountCollected <= 0) {
    const error = new Error('Amount collected must be greater than zero');
    error.status = 422;
    throw error;
  }
  await enforceDailyLimit(agent, profile, amountCollected);

  const externalReference = cleanText(payload.paymentReference, 120);
  if (externalReference) {
    const replay = await promoterRepository.payments.findOne({ provider: 'cash', providerReference: externalReference });
    if (replay) {
      const priorSale = await promoterRepository.offlineSales.findOne({ bookingRef: replay.bookingRef });
      const priorBooking = await promoterRepository.bookings.findOne({ bookingRef: replay.bookingRef });
      if (priorSale && priorBooking && priorSale.agentId === agent.id) return { sale: priorSale, booking: priorBooking, payment: replay, replayed: true };
      const error = new Error('Payment reference has already been used');
      error.status = 409;
      throw error;
    }
  }

  const customer = await findOrCreateCustomer(payload);
  const link = await promoterRepository.links.findOne({ promoterId: agent.id, listingId: listing.id, status: { $ne: 'archived' } })
    || await promoterRepository.links.findOne({ promoterId: agent.id, status: { $ne: 'archived' } });

  const idempotencyKey = cleanText(payload.idempotencyKey, 180)
    || `offline:${agent.id}:${externalReference || `${listing.id}:${payload.scheduleId || payload.roomTypeId || payload.roomUnitId || ''}:${customer.id}:${Date.now()}`}`;
  const canonicalPayload = {
    ...payload,
    listingId: listing.id,
    selectedSeats: listValues(payload.selectedSeats || payload.selected || payload.seatNumber),
    returnSeats: listValues(payload.returnSeats),
    passengerNames: listValues(payload.passengerNames),
    passengerPhones: listValues(payload.passengerPhones),
    passengerEmails: listValues(payload.passengerEmails),
    identityNumbers: listValues(payload.identityNumbers || payload.passengerIdentityNumbers),
    identityTypes: listValues(payload.identityTypes),
    nationalities: listValues(payload.nationalities),
    luggageCounts: listValues(payload.luggageCounts),
    roomUnitIds: listValues(payload.roomUnitIds || payload.roomUnitId),
    addons: listValues(payload.addons),
    fullName: cleanText(payload.fullName || payload.customerName || customer.fullName, 160),
    customerName: cleanText(payload.customerName || payload.fullName || customer.fullName, 160),
    passengerName: cleanText(payload.passengerName || payload.customerName || payload.fullName || customer.fullName, 160),
    email: cleanText(payload.email || payload.customerEmail || customer.email, 254).toLowerCase(),
    phone: normalizePhone(payload.phone || payload.customerPhone || customer.phone),
    customerUserId: customer.id,
    amountCollected,
    total: amountCollected,
    currency: cleanText(payload.currency || listing.currency || platformCurrency(), 8).toUpperCase(),
    paymentMethod: 'cash',
    paymentProvider: 'cash',
    provider: 'cash',
    paymentStatus: 'successful',
    paymentRef: externalReference,
    paymentReference: externalReference,
    idempotencyKey,
    source: 'agent_offline',
    actorId: agent.id,
    agentId: agent.id,
    agentName: agent.fullName,
    promoterAttribution: { promoterId: agent.id, linkId: link?.id || null, code: link?.code || agent.referralCode || 'AGENT-OFFLINE' },
  };
  let booking;
  let payment;
  let replayed = false;
  if (listing.serviceType === 'bus') {
    ({ booking, payment, replayed } = await busBookingService.createTrustedOfflineBooking(canonicalPayload, {
      agentId: agent.id,
      agentName: agent.fullName,
      ip: context.ip || '',
      userAgent: context.userAgent || '',
      requestId: context.requestId || '',
    }));
  } else {
    booking = await hotelService.createHotelBooking(canonicalPayload, {
      session: { user: { id: agent.id } },
      ip: context.ip || '',
      headers: { 'user-agent': context.userAgent || '' },
    }, { trustedOffline: true, companyId: listing.companyId, actorId: agent.id });
    payment = await promoterRepository.payments.findOne({ bookingRef: booking.bookingRef, provider: 'cash' });
    if (!payment) throw Object.assign(new Error('Canonical hotel cash payment record was not created'), { status: 500, code: 'offline_hotel_payment_missing' });
  }

  if (replayed) {
    const priorSale = await promoterRepository.offlineSales.findOne({ bookingRef: booking.bookingRef });
    return { sale: priorSale, booking, customer, payment, replayed: true };
  }

  const due = Number(booking.pricing?.total || 0);
  if (amountCollected + 0.0001 < due) {
    const error = new Error(`Collected amount is below the computed booking total of ${booking.pricing?.currency || platformCurrency()} ${due}`);
    error.status = 422;
    throw error;
  }

  const sale = {
    id: await nextId('offline-sale'),
    saleRef: `AGSALE-${String(await nextId('offline-sale-ref')).replace(/^offline-sale-ref-/, '').padStart(5, '0')}`,
    agentId: agent.id,
    agentName: agent.fullName,
    agentLocation: cleanText(payload.agentLocation || profile.location || agent.agentLocation || 'Office/terminal', 240),
    listingId: listing.id,
    companyId: listing.companyId,
    scheduleId: booking.scheduleId,
    bookingId: booking.id,
    bookingRef: booking.bookingRef,
    customerUserId: customer.id,
    customerName: customer.fullName,
    customerEmail: customer.email,
    customerPhone: customer.phone,
    passengerName: booking.passengers?.[0]?.fullName || customer.fullName,
    seatNumber: booking.passengers?.[0]?.seatOrRoom || cleanText(payload.seatNumber, 40),
    paymentMethod: 'cash',
    paymentReference: payment.providerReference,
    amountCollected: payment.amount,
    currency: payment.currency,
    commissionAmount: booking.pricing?.split?.promoterAmount || 0,
    commissionStatus: 'pending',
    status: 'completed',
    notes: cleanText(payload.notes, 1000),
    createdAt: new Date().toISOString(),
    meta: { bookingChannel: 'agent_offline', listingTitle: listing.title, paymentId: payment.id, idempotencyKey },
  };
  Object.assign(sale, createReceipt({ sale, booking, payment }));
  await promoterRepository.offlineSales.save(sale, { saleRef: sale.saleRef });

  await notificationService.queueNotification({
    userId: customer.id,
    channels: ['in_app', 'email', 'sms'],
    title: 'Classic Trip offline ticket issued',
    message: `Your ticket ${booking.bookingRef} was issued by ${agent.fullName}.`,
    recipient: { email: customer.email, phone: customer.phone, name: customer.fullName },
    ownerType: 'customer',
    ownerId: customer.id,
    referenceType: 'booking',
    referenceId: booking.id,
    meta: { bookingRef: booking.bookingRef, companyId: booking.companyId, promoterId: agent.id, ticketUrl: sale.ticketUrl },
  });

  const audit = {
    id: await nextId('audit'),
    actorId: agent.id,
    actorRole: 'promoter',
    actorName: agent.fullName,
    actorEmail: agent.email,
    action: 'agent.offline_sale.created',
    target: sale.saleRef,
    entityType: 'offline_sale',
    entityId: sale.id,
    beforeSummary: 'No offline sale record existed',
    afterSummary: `Created booking ${booking.bookingRef}, receipt ${sale.receiptRef}, and collected ${sale.currency} ${sale.amountCollected}`,
    status: 'success',
    createdAt: new Date().toISOString(),
  };
  await promoterRepository.auditLogs.save(audit, { id: audit.id });
  return { sale, booking, customer, payment, replayed: false };
}

async function receiptForSale(saleId, agentId = '') {
  const sale = await promoterRepository.offlineSales.findOne({ $or: [{ id: saleId }, { saleRef: saleId }, { bookingRef: saleId }] });
  if (!sale || (agentId && sale.agentId !== agentId)) return null;
  const [booking, listing, company, customer, payment] = await Promise.all([
    promoterRepository.bookings.findOne({ bookingRef: sale.bookingRef }),
    promoterRepository.listings.findOne({ id: sale.listingId }),
    promoterRepository.companies.findOne({ id: sale.companyId }),
    promoterRepository.users.findOne({ id: sale.customerUserId }),
    promoterRepository.payments.findOne({ bookingRef: sale.bookingRef }),
  ]);
  return { sale, booking, listing, company, customer, payment };
}

module.exports = { createOfflineSale, receiptForSale, hasOfflinePermission, ensureAgent };

