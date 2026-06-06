const store = require('../../services/data/demoStore');
const bookingService = require('../../services/booking/bookingService');
const notificationService = require('../../services/notification/notificationService');
const walletService = require('../../services/wallet/walletService');
const workflowService = require('../../services/support/workflowService');
const { mongoose } = require('../../config/db');

function cleanText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

function normalize(value) {
  return cleanText(value).toLowerCase();
}

function amountValue(value, fallback = 0) {
  const amount = Number(String(value || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(amount) ? amount : fallback;
}

function nextId(prefix, rows = []) {
  let index = rows.length + 1;
  let id = `${prefix}-${index}`;
  while (rows.some((row) => row.id === id)) {
    index += 1;
    id = `${prefix}-${index}`;
  }
  return id;
}

function ensureCollections() {
  if (!Array.isArray(store.state.auditLogs)) store.state.auditLogs = [];
  if (!Array.isArray(store.state.supportTickets)) store.state.supportTickets = [];
  if (!Array.isArray(store.state.notifications)) store.state.notifications = [];
  if (!Array.isArray(store.state.promotionCampaigns)) store.state.promotionCampaigns = [];
  if (!Array.isArray(store.state.refundRequests)) store.state.refundRequests = [];
  if (!Array.isArray(store.state.listings)) store.state.listings = [];
  if (!store.state.platformSettings) store.state.platformSettings = {};
  if (!Array.isArray(store.state.notificationTemplates)) store.state.notificationTemplates = [];
}

async function persist(modelName, row, filter = { id: row.id }) {
  if (mongoose.connection.readyState !== 1 || !row) return;
  const Model = require(`../../models/${modelName}`);
  await Model.updateOne(filter, { $set: row }, { upsert: true, runValidators: true });
}

async function audit(req, action, target, meta = {}) {
  ensureCollections();
  const row = {
    id: nextId('audit', store.state.auditLogs),
    actorId: req.session?.user?.id || 'admin-system',
    action,
    target,
    metadata: meta,
    createdAt: new Date().toISOString(),
  };
    store.state.auditLogs.push(row);
  await persist('AuditLog', row);
  return row;
}

function redirect(res, path) {
  res.redirect(path);
}

async function createBooking(req, res, next) {
  try {
    const booking = await bookingService.createGuestBooking({
      listingId: cleanText(req.body.listingId),
      scheduleId: cleanText(req.body.scheduleId || ''),
      roomId: cleanText(req.body.roomId || ''),
      selected: cleanText(req.body.selected || req.body.seatNumber || ''),
      seatNumber: cleanText(req.body.seatNumber || ''),
      fullName: cleanText(req.body.fullName || 'Admin customer'),
      email: cleanText(req.body.email || 'customer@classictrip.test'),
      phone: cleanText(req.body.phone || '+256700000000'),
      addons: req.body.addons,
    });
    booking.source = 'admin_dashboard';
    booking.createdByAdminId = req.session?.user?.id || 'admin-system';
    await persist('Booking', booking, { bookingRef: booking.bookingRef });
    await audit(req, 'admin.booking.created', booking.bookingRef);
    redirect(res, '/admin/bookings');
  } catch (error) {
    next(error);
  }
}

async function createListing(req, res, next) {
  try {
    ensureCollections();
    const company = store.findCompany(req.body.companyId) || store.state.companies[0] || {};
    const title = cleanText(req.body.title || 'Admin listing');
    const serviceType = normalize(req.body.serviceType || 'bus') || 'bus';
    const listing = {
      id: nextId('listing', store.state.listings),
      slug: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Date.now().toString().slice(-4)}`,
      companyId: company.id || cleanText(req.body.companyId || 'company-01'),
      title,
      serviceType,
      type: serviceType,
      from: cleanText(req.body.from || ''),
      to: cleanText(req.body.to || ''),
      city: cleanText(req.body.city || ''),
      country: cleanText(req.body.country || company.country || 'Uganda'),
      currency: cleanText(req.body.currency || 'UGX'),
      priceFrom: amountValue(req.body.priceFrom || req.body.price, 0),
      remainingInventory: amountValue(req.body.inventory, 0),
      bookable: req.body.bookable !== 'off',
      status: normalize(req.body.status || 'active') || 'active',
      description: cleanText(req.body.description || ''),
      createdAt: new Date().toISOString(),
    };
    store.state.listings.unshift(listing);
    await persist('Listing', listing);
    await audit(req, 'admin.listing.created', listing.id, { companyId: listing.companyId });
    redirect(res, '/admin/listings');
  } catch (error) {
    next(error);
  }
}

async function createPromotion(req, res, next) {
  try {
    ensureCollections();
    const listing = store.findListing(req.body.listingId) || store.state.listings[0] || {};
    const campaign = {
      id: nextId('campaign', store.state.promotionCampaigns),
      companyId: cleanText(req.body.companyId || listing.companyId || 'company-01'),
      promoterId: cleanText(req.body.promoterId || ''),
      listingId: cleanText(listing.id || req.body.listingId || ''),
      name: cleanText(req.body.name || req.body.title || 'Admin campaign'),
      placement: cleanText(req.body.placement || 'marketplace_top'),
      budget: amountValue(req.body.budget, 0),
      clicks: 0,
      bookings: 0,
      status: normalize(req.body.status || 'active') || 'active',
      startsAt: req.body.startsAt || null,
      endsAt: req.body.endsAt || null,
      createdAt: new Date().toISOString(),
    };
    store.state.promotionCampaigns.unshift(campaign);
    if (listing.id) listing.isSponsored = true;
    await persist('PromotionCampaign', campaign);
    await audit(req, 'admin.promotion.created', campaign.id, { listingId: campaign.listingId });
    redirect(res, '/admin/ads');
  } catch (error) {
    next(error);
  }
}

async function createNotice(req, res, next) {
  try {
    ensureCollections();
    const message = cleanText(req.body.message || req.body.body || req.body.note);
    if (!message) {
      const error = new Error('Notice message is required');
      error.status = 422;
      throw error;
    }
    const ticket = {
      id: nextId('support', store.state.supportTickets),
      ownerType: normalize(req.body.audience || 'customers'),
      ownerId: cleanText(req.body.ownerId || ''),
      subject: cleanText(req.body.subject || 'Platform notice'),
      category: 'platform_notice',
      message,
      priority: normalize(req.body.priority || 'normal'),
      status: 'open',
      assignedTo: 'admin',
      createdBy: req.session?.user?.id || 'admin-system',
      createdAt: new Date().toISOString(),
    };
    store.state.supportTickets.unshift(ticket);
    await persist('SupportTicket', ticket);
    await audit(req, 'admin.notice.created', ticket.id, { audience: ticket.ownerType });
    redirect(res, '/admin/support');
  } catch (error) {
    next(error);
  }
}

async function sendNotification(req, res, next) {
  try {
    ensureCollections();
    const channels = String(req.body.channels || req.body.channel || 'email').split(',').map((item) => cleanText(item).toLowerCase()).filter(Boolean);
    const audience = normalize(req.body.audience || 'customers');
    const users = store.state.users.filter((user) => {
      if (audience.startsWith('promoter')) return user.role === 'promoter';
      if (audience.startsWith('partner')) return ['company_admin', 'company_employee'].includes(user.role);
      if (audience.startsWith('admin')) return user.role && user.role.includes('admin');
      return user.role === 'customer';
    }).slice(0, 25);
    if (!users.length) users.push({});
    await Promise.all(users.map((user) => notificationService.queueNotification({
      userId: user.id || null,
      channels,
      title: cleanText(req.body.title || req.body.subject || 'Classic Trip notice'),
      message: cleanText(req.body.message || req.body.body || 'Classic Trip update'),
      recipient: { email: user.email, phone: user.phone, whatsapp: user.phone, name: user.fullName },
      referenceType: 'admin_notification',
      referenceId: `admin-${Date.now()}`,
      meta: { audience },
    })));
    await audit(req, 'admin.notification.sent', audience, { channels });
    redirect(res, '/admin/notifications');
  } catch (error) {
    next(error);
  }
}

async function createCustomerNote(req, res, next) {
  try {
    ensureCollections();
    const customer = store.state.users.find((user) => user.id === req.body.customerId || user.email === req.body.customerId) || {};
    const ticket = {
      id: nextId('support', store.state.supportTickets),
      ownerType: 'customer',
      ownerId: cleanText(customer.id || req.body.customerId || 'customer'),
      subject: cleanText(req.body.subject || 'Customer note'),
      category: 'customer_note',
      message: cleanText(req.body.message || req.body.note || ''),
      priority: normalize(req.body.priority || 'normal'),
      status: 'open',
      assignedTo: req.session?.user?.id || 'admin-system',
      createdBy: req.session?.user?.id || 'admin-system',
      createdAt: new Date().toISOString(),
    };
    store.state.supportTickets.unshift(ticket);
    await persist('SupportTicket', ticket);
    await audit(req, 'admin.customer.note.created', ticket.ownerId, { ticketId: ticket.id });
    redirect(res, '/admin/customers');
  } catch (error) {
    next(error);
  }
}

async function inviteAdmin(req, res, next) {
  try {
    const user = store.upsertUser({
      fullName: cleanText(req.body.fullName || 'Admin user'),
      email: cleanText(req.body.email || `admin-${Date.now()}@classictrip.example`).toLowerCase(),
      phone: cleanText(req.body.phone || ''),
      role: normalize(req.body.role || 'admin') || 'admin',
      permissionsLabel: cleanText(req.body.permissionsLabel || 'Role based'),
      status: 'active',
      twoFactorEnabled: req.body.twoFactorEnabled === 'on',
      isVerified: true,
      invitedBy: req.session?.user?.id || 'admin-system',
    });
    await persist('User', user);
    await audit(req, 'admin.user.invited', user.id, { role: user.role });
    redirect(res, '/admin/admins');
  } catch (error) {
    next(error);
  }
}

async function createVerificationTask(req, res, next) {
  try {
    ensureCollections();
    const company = store.findCompany(req.body.companyId) || store.state.companies[0] || {};
    const ticket = {
      id: nextId('support', store.state.supportTickets),
      ownerType: 'company',
      ownerId: company.id || cleanText(req.body.companyId || ''),
      companyId: company.id || cleanText(req.body.companyId || ''),
      subject: cleanText(req.body.subject || `Verification review ${company.name || ''}`),
      category: 'verification',
      message: cleanText(req.body.message || req.body.note || 'Manual verification review opened.'),
      priority: normalize(req.body.priority || 'high'),
      status: 'review',
      assignedTo: cleanText(req.body.assignedTo || req.session?.user?.id || 'admin-system'),
      createdBy: req.session?.user?.id || 'admin-system',
      createdAt: new Date().toISOString(),
    };
    store.state.supportTickets.unshift(ticket);
    await persist('SupportTicket', ticket);
    await audit(req, 'admin.verification.task.created', ticket.ownerId, { ticketId: ticket.id });
    redirect(res, '/admin/kyc');
  } catch (error) {
    next(error);
  }
}

async function createRefund(req, res, next) {
  try {
    const booking = store.findBooking(req.body.bookingRef) || store.state.bookings[0];
    if (!booking) {
      const error = new Error('Booking not found');
      error.status = 404;
      throw error;
    }
    const refund = workflowService.requestRefund({
      bookingRef: booking.bookingRef,
      requesterId: cleanText(req.body.requesterId || booking.customerUserId || 'admin-system'),
      amount: amountValue(req.body.amount, booking.pricing?.total || 0),
      reason: cleanText(req.body.reason || 'Admin refund request'),
    });
    refund.createdBy = req.session?.user?.id || 'admin-system';
    await persist('RefundRequest', refund);
    await audit(req, 'admin.refund.created', refund.id, { bookingRef: booking.bookingRef });
    redirect(res, '/admin/refunds');
  } catch (error) {
    next(error);
  }
}

async function runPayout(req, res, next) {
  try {
    const transactionId = cleanText(req.body.transactionId);
    let transaction = transactionId
      ? walletService.approveWithdrawal(transactionId, req.session?.user?.id || 'admin-system')
      : null;
    if (!transaction) {
      transaction = store.state.walletTransactions.find((txn) => /withdrawal|payout/.test(normalize(txn.transactionType || txn.referenceType)) && !['completed', 'paid'].includes(normalize(txn.status)));
    }
    if (transaction && !transaction.approvedAt) walletService.approveWithdrawal(transaction.id, req.session?.user?.id || 'admin-system');
    if (transaction) await persist('WalletTransaction', transaction);
    await audit(req, 'admin.payout.run', transaction?.id || 'no-pending-payout', { note: cleanText(req.body.note || '') });
    redirect(res, '/admin/payments');
  } catch (error) {
    next(error);
  }
}

async function freezePayment(req, res, next) {
  try {
    const id = cleanText(req.body.transactionId || req.body.paymentId);
    const transaction = store.state.walletTransactions.find((txn) => txn.id === id);
    const payment = store.state.payments.find((item) => item.id === id || item.providerReference === id);
    if (transaction) {
      transaction.status = 'on_hold';
      transaction.holdReason = cleanText(req.body.reason || 'Admin review');
      transaction.updatedAt = new Date().toISOString();
      await persist('WalletTransaction', transaction);
    }
    if (payment) {
      payment.status = 'on_hold';
      payment.metadata = {
        ...(payment.metadata || {}),
        reviewReason: cleanText(req.body.reason || 'Admin review'),
        reviewedBy: req.session?.user?.id || 'admin-system',
      };
      payment.updatedAt = new Date().toISOString();
      await persist('Payment', payment);
    }
    await audit(req, 'admin.payment.frozen', id || 'unspecified', { reason: cleanText(req.body.reason || '') });
    redirect(res, '/admin/payments');
  } catch (error) {
    next(error);
  }
}

async function updateFinanceRules(req, res, next) {
  try {
    ensureCollections();
    store.state.platformSettings.financeRules = {
      platformFeePercent: amountValue(req.body.platformFeePercent || req.body.platformFee, 7),
      promoterCommissionPercent: amountValue(req.body.promoterCommissionPercent || req.body.promoterCommission, 3),
      partnerPayoutPercent: amountValue(req.body.partnerPayoutPercent || req.body.partnerPayout, 90),
      holdMinutes: amountValue(req.body.holdMinutes || req.body.holdTimer, 10),
      defaultCurrency: cleanText(req.body.defaultCurrency || 'UGX'),
      supportMessage: cleanText(req.body.supportMessage || ''),
      updatedAt: new Date().toISOString(),
      updatedBy: req.session?.user?.id || 'admin-system',
    };
    await audit(req, 'admin.finance.rules.updated', 'platform', store.state.platformSettings.financeRules);
    redirect(res, '/admin/settings');
  } catch (error) {
    next(error);
  }
}

async function updatePriceRule(req, res, next) {
  try {
    ensureCollections();
    const rule = {
      id: nextId('price-rule', store.state.platformSettings.priceRules || []),
      listingId: cleanText(req.body.listingId || ''),
      ruleName: cleanText(req.body.ruleName || req.body.name || 'Dashboard price rule'),
      percent: amountValue(req.body.percent || req.body.priceDelta, 0),
      startsAt: cleanText(req.body.startsAt || ''),
      endsAt: cleanText(req.body.endsAt || ''),
      note: cleanText(req.body.note || ''),
      createdAt: new Date().toISOString(),
    };
    if (!Array.isArray(store.state.platformSettings.priceRules)) store.state.platformSettings.priceRules = [];
    store.state.platformSettings.priceRules.unshift(rule);
    await audit(req, 'admin.price.rule.created', rule.id, rule);
    redirect(res, '/admin/listings');
  } catch (error) {
    next(error);
  }
}

async function updateTemplate(req, res, next) {
  try {
    ensureCollections();
    const key = normalize(req.body.templateKey || req.body.name || 'template');
    let template = store.state.notificationTemplates.find((item) => normalize(item.key) === key);
    if (!template) {
      template = { id: nextId('template', store.state.notificationTemplates), key };
      store.state.notificationTemplates.push(template);
    }
    template.subject = cleanText(req.body.subject || req.body.name || key);
    template.body = cleanText(req.body.body || req.body.message || '');
    template.status = normalize(req.body.status || 'active');
    template.updatedAt = new Date().toISOString();
    await audit(req, 'admin.notification.template.updated', key);
    redirect(res, '/admin/notifications');
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createBooking,
  createListing,
  createPromotion,
  createNotice,
  sendNotification,
  createCustomerNote,
  inviteAdmin,
  createVerificationTask,
  createRefund,
  runPayout,
  freezePayment,
  updateFinanceRules,
  updatePriceRule,
  updateTemplate,
};
