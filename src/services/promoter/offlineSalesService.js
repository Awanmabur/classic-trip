const store = require('../data/persistentStore');
const walletService = require('../wallet/walletService');

function cleanText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 500);
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function hasOfflinePermission(agent = {}) {
  const profile = agent.promoterProfile || agent.agentProfile || {};
  const permissions = profile.agentPermissions || profile.permissions || agent.permissions || [];
  if (profile.offlineSalesEnabled === true || profile.canSellOffline === true || agent.canSellOffline === true) return true;
  if (Array.isArray(permissions) && (permissions.includes('offline_sales') || permissions.includes('agent_sales'))) return true;
  if (permissions && typeof permissions === 'object' && (permissions.offlineSales || permissions.agentSales)) return true;
  return normalize(agent.role) === 'promoter' && agent.status !== 'suspended';
}

function ensureAgent(agentId) {
  const agent = store.state.users.find((user) => user.id === agentId);
  if (!agent || normalize(agent.role) !== 'promoter') {
    const error = new Error('Offline ticket sales are only available to approved promoter/agent accounts');
    error.status = 403;
    throw error;
  }
  if (!hasOfflinePermission(agent)) {
    const error = new Error('Agent offline sales permission is not enabled');
    error.status = 403;
    throw error;
  }
  return agent;
}

function findOrCreateCustomer(payload = {}) {
  const email = cleanText(payload.email || payload.customerEmail).toLowerCase();
  const phone = cleanText(payload.phone || payload.customerPhone);
  const fullName = cleanText(payload.fullName || payload.customerName || payload.passengerName || 'Offline Customer');
  const existing = store.state.users.find((user) => (email && normalize(user.email) === normalize(email)) || (phone && normalize(user.phone) === normalize(phone)));
  if (existing) {
    existing.fullName = existing.fullName || fullName;
    existing.phone = existing.phone || phone;
    existing.email = existing.email || email;
    existing.updatedAt = new Date().toISOString();
    return existing;
  }
  const customer = {
    id: `user-offline-customer-${store.state.users.length + 1}`,
    role: 'customer',
    fullName,
    email: email || `offline-${Date.now()}@classictrip.local`,
    phone,
    status: 'active',
    isVerified: false,
    source: 'agent_offline_sale',
    createdAt: new Date().toISOString(),
  };
  store.state.users.push(customer);
  walletService.getOrCreateWallet('customer', customer.id, cleanText(payload.currency || 'UGX'));
  return customer;
}

function createReceipt({ sale, booking, payment }) {
  const now = new Date().toISOString();
  const receiptRef = `RCPT-${String(store.state.offlineSales.length + 1).padStart(5, '0')}`;
  return {
    receiptRef,
    receiptUrl: `/promoter/offline-sales/${encodeURIComponent(sale.id)}/receipt`,
    ticketUrl: `/tickets/${encodeURIComponent(booking.bookingRef)}`,
    printedAt: now,
    paymentReference: payment.providerReference || payment.id,
  };
}

function createOfflineSale(payload = {}, context = {}) {
  const agent = ensureAgent(context.agentId || payload.agentId);
  const listing = store.findListing(payload.listingId || payload.slug);
  if (!listing) {
    const error = new Error('Listing not found for offline sale');
    error.status = 404;
    throw error;
  }
  const customer = findOrCreateCustomer(payload);
  const link = store.state.promoterLinks.find((row) => row.promoterId === agent.id && row.listingId === listing.id && row.status !== 'archived')
    || store.state.promoterLinks.find((row) => row.promoterId === agent.id && row.status !== 'archived');
  const paymentMethod = cleanText(payload.paymentMethod || 'cash');
  const amountCollected = Math.max(0, Number(payload.amountCollected || payload.total || 0));
  const booking = store.createBooking({
    listingId: listing.id,
    scheduleId: cleanText(payload.scheduleId),
    seatNumber: cleanText(payload.seatNumber || payload.selected),
    roomId: cleanText(payload.roomId),
    fullName: cleanText(payload.fullName || payload.customerName),
    customerName: cleanText(payload.customerName || payload.fullName),
    passengerName: cleanText(payload.passengerName || payload.customerName || payload.fullName),
    email: cleanText(payload.email || payload.customerEmail || customer.email),
    phone: cleanText(payload.phone || payload.customerPhone || customer.phone),
    customerUserId: customer.id,
    paymentStatus: 'successful',
    total: amountCollected,
    agentSale: true,
    offlineSale: true,
    promoterAttribution: { promoterId: agent.id, linkId: link?.id || null, code: link?.code || agent.referralCode || 'AGENT-OFFLINE' },
  });
  booking.bookingChannel = 'agent_offline';
  booking.createdByAgentId = agent.id;
  booking.paymentMethod = paymentMethod;
  booking.paymentMethodNote = `Offline ${paymentMethod}`;
  booking.agentSale = { agentId: agent.id, agentName: agent.fullName, location: cleanText(payload.agentLocation || agent.agentLocation || '') };

  const payment = {
    id: `payment-offline-${store.state.payments.length + 1}`,
    bookingId: booking.id,
    bookingRef: booking.bookingRef,
    provider: 'offline_agent',
    method: paymentMethod,
    methodNote: `Collected by ${agent.fullName}`,
    amount: amountCollected || booking.pricing?.total || 0,
    currency: booking.pricing?.currency || payload.currency || 'UGX',
    status: 'successful',
    providerReference: cleanText(payload.paymentReference) || `OFFLINE-${booking.bookingRef}`,
    idempotencyKey: `offline-${booking.bookingRef}`,
    collectedBy: agent.id,
    createdAt: new Date().toISOString(),
  };
  store.state.payments.unshift(payment);

  const sale = {
    id: `offline-sale-${store.state.offlineSales.length + 1}`,
    saleRef: `AGSALE-${String(store.state.offlineSales.length + 1).padStart(5, '0')}`,
    agentId: agent.id,
    agentName: agent.fullName,
    agentLocation: cleanText(payload.agentLocation || agent.agentLocation || 'Office/terminal'),
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
    seatNumber: booking.passengers?.[0]?.seatOrRoom || cleanText(payload.seatNumber),
    paymentMethod,
    paymentReference: payment.providerReference,
    amountCollected: payment.amount,
    currency: payment.currency,
    commissionAmount: booking.pricing?.split?.promoterAmount || 0,
    commissionStatus: 'pending',
    status: 'completed',
    notes: cleanText(payload.notes),
    createdAt: new Date().toISOString(),
    meta: { bookingChannel: 'agent_offline', listingTitle: listing.title, paymentId: payment.id },
  };
  const receipt = createReceipt({ sale, booking, payment });
  Object.assign(sale, receipt);
  store.state.offlineSales.unshift(sale);

  store.state.notifications.unshift({
    id: `notification-${store.state.notifications.length + 1}`,
    ownerType: 'customer',
    ownerId: customer.id,
    title: 'Classic Trip offline ticket issued',
    message: `Your ticket ${booking.bookingRef} was issued by ${agent.fullName}.`,
    channel: 'system',
    status: 'queued',
    createdAt: new Date().toISOString(),
  });
  store.state.auditLogs.push({
    id: `audit-${store.state.auditLogs.length + 1}`,
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
  });
  return { sale, booking, customer, payment };
}

function receiptForSale(saleId, agentId = '') {
  const sale = store.state.offlineSales.find((row) => row.id === saleId || row.saleRef === saleId || row.bookingRef === saleId);
  if (!sale) return null;
  if (agentId && sale.agentId !== agentId) return null;
  return {
    sale,
    booking: store.findBooking(sale.bookingRef),
    listing: store.findListing(sale.listingId),
    company: store.findCompany(sale.companyId),
    customer: store.state.users.find((user) => user.id === sale.customerUserId),
    payment: store.state.payments.find((payment) => payment.bookingRef === sale.bookingRef),
  };
}

module.exports = { createOfflineSale, receiptForSale, hasOfflinePermission };
