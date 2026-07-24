const bookingService = require('../../services/booking/bookingService');
const dashboardActionService = require('../../services/dashboard/actionService');
const companyService = require('../../services/company/companyService');
const notificationService = require('../../services/notification/notificationService');
const walletService = require('../../services/wallet/walletService');
const workflowService = require('../../services/support/workflowService');
const timelineService = require('../../services/support/timelineService');
const correspondenceService = require('../../services/support/correspondenceService');
const invitationService = require('../../services/onboarding/invitationService');
const verificationService = require('../../services/onboarding/verificationService');
const settlementService = require('../../services/finance/settlementService');
const repository = require('../../repositories/domain/adminActionRepository');
const platformSettingsRepository = require('../../repositories/domain/platformSettingsRepository');
const { savePlatformConfig, getPlatformConfig } = require('../../services/platform/platformConfigService');
const { resolveCurrency } = require('../../utils/currency');
const { nextId } = require('../../services/data/idService');

const ADMIN_ROLES = new Set(['admin', 'finance_admin', 'support_admin', 'operations_admin', 'content_admin']);
const CAMPAIGN_PLACEMENTS = new Set(['marketplace_top', 'route_card', 'hotel_card', 'banner', 'promoter_share', 'route_boost', 'homepage_feature']);
const CAMPAIGN_STATUSES = new Set(['draft', 'active', 'expired']);
const TICKET_PRIORITIES = new Set(['low', 'medium', 'normal', 'high', 'urgent']);
const CHANNELS = new Set(['email', 'sms', 'whatsapp', 'push']);

function cleanText(value, max = 3000) {
  return String(value || '').replace(/<[^>]*>/g, '').trim().replace(/\s+/g, ' ').slice(0, max);
}
function normalize(value) { return cleanText(value, 100).toLowerCase().replace(/[\s-]+/g, '_'); }
function amountValue(value, fallback = 0) {
  const amount = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(amount) ? amount : fallback;
}
function error(message, status = 422) { const value = new Error(message); value.status = status; return value; }
function actor(req) { return req.session?.user?.id || 'admin-system'; }
function actorRole(req) { return req.session?.user?.role || 'super_admin'; }
function redirect(res, path) { res.redirect(path); }
function enumValue(value, allowed, fallback, label) {
  const normalized = normalize(value || fallback);
  if (!allowed.has(normalized)) throw error(`Invalid ${label}`, 422);
  return normalized;
}
function validDate(value, label) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw error(`Invalid ${label}`, 422);
  return date.toISOString();
}

async function audit(req, action, target, metadata = {}, options = {}) {
  const row = {
    id: await nextId('audit'), actorId: actor(req), actorRole: actorRole(req), action,
    target: cleanText(target, 240), targetType: options.entityType || metadata.entityType || '', targetId: cleanText(target, 240),
    entityType: options.entityType || metadata.entityType || '', entityId: cleanText(target, 240),
    metadata, meta: metadata, status: options.status || 'success', createdAt: new Date().toISOString(),
  };
  await repository.auditLogs.save(row, { id: row.id }, { session: options.session || undefined });
  return row;
}

async function createBooking(req, res, next) {
  try {
    const listingId = cleanText(req.body.listingId, 180);
    const listing = await repository.listings.findOne({ id: listingId });
    if (!listing) throw error('Approved listing not found', 404);
    await dashboardActionService.createManualBooking(listing.companyId, {
      ...req.body,
      listingId,
      source: 'admin_manual',
      actorId: actor(req),
      createdByEmployeeId: actor(req),
    }, actor(req), { canRecordPayment: true });
    return redirect(res, '/admin/bookings');
  } catch (err) { return next(err); }
}

async function createListing(req, res, next) {
  try {
    const companyId = cleanText(req.body.companyId, 180);
    if (!companyId) throw error('Company is required', 422);
    const listing = await companyService.createListing(companyId, req.body);
    await audit(req, 'admin.listing.created', listing.id, { entityType: 'listing', companyId: listing.companyId }, { entityType: 'listing' });
    redirect(res, '/admin/listings');
  } catch (err) { next(err); }
}

async function createPromotion(req, res, next) {
  try {
    const listingId = cleanText(req.body.listingId, 180);
    const listing = await repository.listings.findOne({ id: listingId });
    if (!listing) throw error('Listing not found', 404);
    const companyId = cleanText(req.body.companyId || listing.companyId, 180);
    if (companyId !== listing.companyId) throw error('Campaign company must own the listing', 409);
    const startsAt = validDate(req.body.startsAt, 'campaign start date');
    const endsAt = validDate(req.body.endsAt, 'campaign end date');
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) throw error('Campaign end date must be after its start date', 422);
    const budget = amountValue(req.body.budget, 0);
    if (budget < 0) throw error('Campaign budget cannot be negative', 422);
    const campaign = {
      id: await nextId('campaign'), companyId, promoterId: cleanText(req.body.promoterId, 180), listingId: listing.id,
      name: cleanText(req.body.name || req.body.title || 'Admin campaign', 180),
      placement: enumValue(req.body.placement, CAMPAIGN_PLACEMENTS, 'marketplace_top', 'campaign placement'),
      budget, clicks: 0, bookings: 0,
      status: enumValue(req.body.status, CAMPAIGN_STATUSES, 'active', 'campaign status'), startsAt, endsAt,
      createdAt: new Date().toISOString(),
    };
    listing.isSponsored = campaign.status === 'active'; listing.updatedAt = new Date().toISOString();
    await repository.withTransaction(async (session) => {
      await repository.campaigns.save(campaign, { id: campaign.id }, { session });
      await repository.listings.save(listing, { id: listing.id }, { session });
      await audit(req, 'admin.promotion.created', campaign.id, { entityType: 'promotion_campaign', listingId: campaign.listingId }, { session, entityType: 'promotion_campaign' });
    });
    redirect(res, '/admin/ads');
  } catch (err) { next(err); }
}

async function createNotice(req, res, next) {
  try {
    const message = cleanText(req.body.message || req.body.body || req.body.note, 4000);
    if (!message) throw error('Notice message is required', 422);
    const ticket = {
      id: await nextId('support'), ownerType: 'platform', ownerId: 'platform',
      subject: cleanText(req.body.subject || 'Platform notice', 300), category: 'platform_notice', message,
      audience: cleanText(req.body.audience || 'customers', 180),
      priority: enumValue(req.body.priority, TICKET_PRIORITIES, 'normal', 'ticket priority'), status: 'open',
      assignedTo: actor(req), createdBy: actor(req), createdAt: new Date().toISOString(),
    };
    await repository.withTransaction(async (session) => {
      await repository.tickets.save(ticket, { id: ticket.id }, { session });
      await audit(req, 'admin.notice.created', ticket.id, { entityType: 'support_ticket', audience: ticket.audience }, { session, entityType: 'support_ticket' });
    });
    redirect(res, '/admin/support');
  } catch (err) { next(err); }
}

async function sendNotification(req, res, next) {
  try {
    const channels = [...new Set(String(req.body.channels || req.body.channel || 'email').split(',').map(normalize).filter((item) => CHANNELS.has(item)))];
    if (!channels.length) throw error('At least one supported notification channel is required', 422);
    const audience = normalize(req.body.audience || 'customers');
    const roleFilter = audience.startsWith('promoter') ? ['promoter']
      : audience.startsWith('partner') ? ['company_admin', 'company_employee', 'driver']
        : audience.startsWith('admin') ? ['super_admin', 'admin', 'finance_admin', 'support_admin', 'operations_admin', 'content_admin']
          : ['customer'];
    const users = await repository.users.list({ role: { $in: roleFilter }, status: 'active' }, { sort: { createdAt: -1 }, limit: 500 });
    const title = cleanText(req.body.title || req.body.subject || 'Classic Trip notice', 300);
    const message = cleanText(req.body.message || req.body.body || 'Classic Trip update', 4000);
    if (!message) throw error('Notification message is required', 422);
    const referenceId = await nextId('admin-notification');
    for (let index = 0; index < users.length; index += 25) {
      const batch = users.slice(index, index + 25);
      await Promise.all(batch.map((user) => notificationService.queueNotification({
        userId: user.id, channels, title, message,
        recipient: { email: user.email, phone: user.phone, whatsapp: user.phone, name: user.fullName },
        referenceType: 'admin_notification', referenceId, ownerType: 'platform', ownerId: 'platform', audience,
        meta: { audience, actorId: actor(req) },
      })));
    }
    await audit(req, 'admin.notification.sent', referenceId, { entityType: 'notification', audience, channels, recipients: users.length }, { entityType: 'notification' });
    redirect(res, '/admin/notifications');
  } catch (err) { next(err); }
}

async function createCustomerNote(req, res, next) {
  try {
    const customerKey = cleanText(req.body.customerId, 254);
    if (!customerKey) throw error('Customer is required', 422);
    const customer = await repository.users.findOne({ role: 'customer', $or: [{ id: customerKey }, { email: customerKey.toLowerCase() }] });
    if (!customer) throw error('Customer not found', 404);
    const message = cleanText(req.body.message || req.body.note, 4000);
    if (!message) throw error('Customer note is required', 422);
    const ticket = {
      id: await nextId('support'), ownerType: 'customer', ownerId: customer.id, userId: customer.id,
      subject: cleanText(req.body.subject || 'Customer note', 300), category: 'customer_note', message,
      priority: enumValue(req.body.priority, TICKET_PRIORITIES, 'normal', 'ticket priority'), status: 'open',
      assignedTo: actor(req), createdBy: actor(req), createdAt: new Date().toISOString(),
    };
    await repository.withTransaction(async (session) => {
      await repository.tickets.save(ticket, { id: ticket.id }, { session });
      await audit(req, 'admin.customer.note.created', customer.id, { entityType: 'support_ticket', ticketId: ticket.id }, { session, entityType: 'support_ticket' });
    });
    redirect(res, '/admin/customers');
  } catch (err) { next(err); }
}

async function inviteAdmin(req, res, next) {
  let provisionalUser = null;
  let createdProvisionalUser = false;
  try {
    const role = enumValue(req.body.role, ADMIN_ROLES, 'admin', 'administrator role');
    const email = cleanText(req.body.email, 254).toLowerCase();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw error('A valid administrator email is required', 422);
    const existing = await repository.users.findOne({ email });
    if (existing && existing.status === 'active') throw error('An active account already uses this email', 409);
    provisionalUser = existing || {
      fullName: cleanText(req.body.fullName || 'Admin user', 180), email,
      phone: cleanText(req.body.phone, 50), role, permissionsLabel: cleanText(req.body.permissionsLabel || 'Role based', 300),
      status: 'pending', twoFactorEnabled: false, isVerified: false, verificationStatus: 'pending', invitedBy: actor(req), createdAt: new Date().toISOString(),
    };
    createdProvisionalUser = !existing;
    Object.assign(provisionalUser, { fullName: cleanText(req.body.fullName || provisionalUser.fullName || 'Admin user', 180), phone: cleanText(req.body.phone || provisionalUser.phone, 50), role, status: 'pending', isVerified: false, twoFactorEnabled: false, onboardingStatus: 'mfa_setup_required', updatedAt: new Date().toISOString() });
    if (createdProvisionalUser) Object.assign(provisionalUser, await repository.users.insert(provisionalUser));
    else await repository.users.save(provisionalUser, { id: provisionalUser.id });
    const invitation = await invitationService.createInvitation({
      type: 'admin', role, userId: provisionalUser.id, fullName: provisionalUser.fullName, email, phone: provisionalUser.phone,
      permissions: req.body.permissions || '', validDays: 3, termsSummary: 'Administrator access requires password setup, email verification, and two-factor authentication.',
    }, actor(req), 'admin');
    await audit(req, 'admin.user.invited', provisionalUser.id, { entityType: 'user', role, invitationId: invitation.id }, { entityType: 'user' });
    redirect(res, '/admin/admins');
  } catch (err) {
    if (createdProvisionalUser && provisionalUser && !provisionalUser.passwordHash) await repository.users.deleteOne({ id: provisionalUser.id }).catch(() => {});
    next(err);
  }
}

async function createVerificationTask(req, res, next) {
  try {
    const companyId = cleanText(req.body.companyId, 180);
    const company = await repository.companies.findOne({ id: companyId });
    if (!company) throw error('Company not found', 404);
    const review = await verificationService.getReview('company', company.id);
    const ticket = {
      id: await nextId('support'), ownerType: 'company', ownerId: company.id, companyId: company.id,
      subject: cleanText(req.body.subject || `Verification review ${company.name}`, 300), category: 'verification',
      message: cleanText(req.body.message || req.body.note || 'Manual verification review opened.', 4000),
      priority: enumValue(req.body.priority, TICKET_PRIORITIES, 'high', 'ticket priority'), status: 'pending',
      assignedTo: cleanText(req.body.assignedTo || actor(req), 180), createdBy: actor(req),
      metadata: { verificationReviewId: review.id }, createdAt: new Date().toISOString(),
    };
    await repository.withTransaction(async (session) => {
      await repository.tickets.save(ticket, { id: ticket.id }, { session });
      await audit(req, 'admin.verification.task.created', company.id, { entityType: 'verification_review', ticketId: ticket.id, reviewId: review.id }, { session, entityType: 'verification_review' });
    });
    redirect(res, '/admin/kyc');
  } catch (err) { next(err); }
}

async function createRefund(req, res, next) {
  try {
    const bookingRef = cleanText(req.body.bookingRef, 180);
    const booking = await repository.bookings.findOne({ $or: [{ bookingRef }, { id: bookingRef }] });
    if (!booking) throw error('Booking not found', 404);
    const refund = await workflowService.requestRefundLive({
      bookingRef: booking.bookingRef, requesterId: cleanText(req.body.requesterId || booking.customerUserId || actor(req), 180),
      amount: amountValue(req.body.amount, booking.pricing?.total || 0), reason: cleanText(req.body.reason || 'Admin refund request', 3000),
      companyId: booking.companyId, actorType: 'admin',
    });
    await audit(req, 'admin.refund.created', refund.id, { entityType: 'refund_request', bookingRef: booking.bookingRef }, { entityType: 'refund_request' });
    redirect(res, '/admin/refunds');
  } catch (err) { next(err); }
}

async function runPayout(req, res, next) {
  try {
    const transactionId = cleanText(req.body.transactionId, 180);
    if (!transactionId) throw error('Payout transaction is required', 422);
    const transaction = await walletService.approveWithdrawalPersisted(transactionId, actor(req));
    if (!transaction) throw error('Payout transaction not found', 404);
    await audit(req, 'admin.payout.run', transaction.id, { entityType: 'wallet_transaction', note: cleanText(req.body.note, 1000) }, { entityType: 'wallet_transaction' });
    redirect(res, '/admin/payments');
  } catch (err) { next(err); }
}

async function freezePayment(req, res, next) {
  try {
    const id = cleanText(req.body.transactionId || req.body.paymentId, 240);
    if (!id) throw error('Payment or transaction identifier is required', 422);
    const [transaction, payment] = await Promise.all([
      repository.walletTransactions.findOne({ id }),
      repository.payments.findOne({ $or: [{ id }, { providerReference: id }, { paymentRef: id }] }),
    ]);
    if (!transaction && !payment) throw error('Payment or transaction not found', 404);
    const reason = cleanText(req.body.reason || 'Admin review', 2000);
    await repository.withTransaction(async (session) => {
      if (transaction) {
        transaction.status = 'held'; transaction.holdReason = reason; transaction.reviewedBy = actor(req); transaction.reviewedAt = new Date().toISOString();
        await repository.walletTransactions.save(transaction, { id: transaction.id }, { session });
      }
      if (payment) {
        payment.metadata = { ...(payment.metadata || {}), reviewStatus: 'held', reviewReason: reason, reviewedBy: actor(req), reviewedAt: new Date().toISOString() };
        await repository.payments.save(payment, { idempotencyKey: payment.idempotencyKey || payment.id }, { session });
      }
      await audit(req, 'admin.payment.frozen', id, { entityType: payment ? 'payment' : 'wallet_transaction', reason }, { session, entityType: payment ? 'payment' : 'wallet_transaction' });
    });
    await settlementService.createFinanceRiskReview(payment ? 'payment' : 'wallet_transaction', payment?.id || transaction?.id, {
      ownerType: transaction?.ownerType || '', ownerId: transaction?.ownerId || payment?.companyId || '', amount: payment?.amount || transaction?.amount || 0,
      currency: resolveCurrency(payment?.currency, transaction?.currency), metadata: { reason, manuallyHeld: true },
    }, actor(req));
    redirect(res, '/admin/payments');
  } catch (err) { next(err); }
}

async function updateFinanceRules(req, res, next) {
  try {
    const current = await getPlatformConfig();
    const partnerCommissionPercent = amountValue(req.body.partnerCommissionPercent ?? req.body.platformCommissionPercent, current.partnerCommissionPercent);
    const promoterSharePercent = amountValue(req.body.promoterSharePercent, current.promoterSharePercent);
    const customerServiceFeePercent = amountValue(req.body.customerServiceFeePercent, current.customerServiceFeePercent);
    const customerServiceFeeFlat = amountValue(req.body.customerServiceFeeFlat, current.customerServiceFeeFlat);
    const customerTaxPercent = amountValue(req.body.customerTaxPercent, current.customerTaxPercent);
    const holdMinutes = amountValue(req.body.holdMinutes ?? req.body.holdTimer, current.holdMinutes);
    const defaultCurrency = cleanText(req.body.defaultCurrency || current.defaultCurrency, 8).toUpperCase();
    const supportedCurrencies = [...new Set(String(req.body.supportedCurrencies || current.supportedCurrencies.join(','))
      .split(/[\s,;]+/).map((value) => cleanText(value, 8).toUpperCase()).filter(Boolean))];
    if (!/^[A-Z]{3}$/.test(defaultCurrency)) throw error('Default currency must use a three-letter ISO currency code', 422);
    if (supportedCurrencies.some((code) => !/^[A-Z]{3}$/.test(code))) throw error('Supported currencies must use three-letter ISO currency codes', 422);
    if (!supportedCurrencies.includes(defaultCurrency)) supportedCurrencies.unshift(defaultCurrency);
    const settings = await savePlatformConfig({
      platformName: cleanText(req.body.platformName || current.platformName, 180),
      supportedCurrencies,
      supportEmail: cleanText(req.body.supportEmail || current.supportEmail, 320),
      supportMessage: cleanText(req.body.supportMessage || current.supportMessage, 2000),
      financeRules: {
        partnerCommissionPercent,
        promoterSharePercent,
        customerServiceFeePercent,
        customerServiceFeeFlat,
        customerTaxPercent,
        holdMinutes,
        defaultCurrency,
        commercialTermsVersion: `commission-${Date.now()}`,
        supportMessage: cleanText(req.body.supportMessage || current.supportMessage, 2000),
        updatedAt: new Date().toISOString(),
        updatedBy: actor(req),
      },
      updatedBy: actor(req),
    });
    await audit(req, 'admin.finance.rules.updated', 'platform', { entityType: 'platform_setting', ...settings }, { entityType: 'platform_setting' });
    redirect(res, '/admin/settings');
  } catch (err) { next(err); }
}

async function updatePriceRule(req, res, next) {
  try {
    const listingId = cleanText(req.body.listingId, 180);
    if (listingId && !(await repository.listings.findOne({ id: listingId }))) throw error('Listing not found', 404);
    const percent = amountValue(req.body.percent || req.body.priceDelta, 0);
    if (percent < -100 || percent > 500) throw error('Price adjustment must be between -100% and 500%', 422);
    const startsAt = validDate(req.body.startsAt, 'price rule start date');
    const endsAt = validDate(req.body.endsAt, 'price rule end date');
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) throw error('Price rule end date must be after its start date', 422);
    const rule = {
      id: await nextId('price-rule'), listingId, ruleName: cleanText(req.body.ruleName || req.body.name || 'Dashboard price rule', 180),
      percent, startsAt, endsAt, note: cleanText(req.body.note, 1000), status: 'active', createdBy: actor(req), createdAt: new Date().toISOString(),
    };
    const settings = await platformSettingsRepository.get();
    settings.priceRules = [rule, ...(Array.isArray(settings.priceRules) ? settings.priceRules.filter((item) => item.id !== rule.id) : [])].slice(0, 500);
    settings.updatedBy = actor(req);
    await platformSettingsRepository.save(settings);
    await audit(req, 'admin.price.rule.created', rule.id, { entityType: 'price_rule', ...rule }, { entityType: 'price_rule' });
    redirect(res, '/admin/listings');
  } catch (err) { next(err); }
}

async function updateTemplate(req, res, next) {
  try {
    const key = normalize(req.body.templateKey || req.body.name || 'template').replace(/[^a-z0-9_]/g, '_');
    if (!key) throw error('Template key is required', 422);
    const subject = cleanText(req.body.subject || req.body.name || key, 300);
    const body = cleanText(req.body.body || req.body.message, 5000);
    if (!body) throw error('Template body is required', 422);
    const status = ['active', 'disabled'].includes(normalize(req.body.status || 'active')) ? normalize(req.body.status || 'active') : 'active';
    const settings = await platformSettingsRepository.get();
    const templates = Array.isArray(settings.notificationTemplates) ? settings.notificationTemplates : [];
    let template = templates.find((item) => normalize(item.key) === key);
    if (!template) { template = { id: await nextId('template'), key }; templates.push(template); }
    Object.assign(template, { subject, body, status, updatedBy: actor(req), updatedAt: new Date().toISOString() });
    settings.notificationTemplates = templates.slice(-500);
    settings.updatedBy = actor(req);
    await platformSettingsRepository.save(settings);
    await audit(req, 'admin.notification.template.updated', key, { entityType: 'notification_template', templateId: template.id }, { entityType: 'notification_template' });
    redirect(res, '/admin/notifications');
  } catch (err) { next(err); }
}

async function replySupport(req, res, next) {
  try {
    await timelineService.replySupportTicket({ ticketId: req.params.id || req.params.ticketId, actorType: 'admin', actorId: actor(req), message: req.body.message, status: req.body.status || 'open', visibility: req.body.visibility || 'shared' });
    redirect(res, '/admin/support');
  } catch (err) { next(err); }
}

async function createInternalNote(req, res, next) {
  try {
    await correspondenceService.createInternalNote({ bookingRef: req.body.bookingRef, supportTicketId: req.body.supportTicketId, subject: req.body.subject || 'Internal note', message: req.body.message || req.body.note, actorType: 'admin', actorId: actor(req), actorName: req.session?.user?.fullName || req.session?.user?.email || 'Admin', metadata: { source: 'admin_internal_note' } });
    redirect(res, '/admin/support');
  } catch (err) { next(err); }
}

async function approveReschedule(req, res, next) {
  try {
    await timelineService.reviewReschedule(req.params.id, { status: 'approved', actorId: actor(req), approvedScheduleId: req.body.approvedScheduleId || req.body.requestedScheduleId || '', reviewNote: req.body.reviewNote || 'Approved for operations follow-up.' });
    redirect(res, '/admin/support');
  } catch (err) { next(err); }
}
async function rejectReschedule(req, res, next) {
  try {
    await timelineService.reviewReschedule(req.params.id, { status: 'rejected', actorId: actor(req), reviewNote: req.body.reviewNote || 'Rejected after support review.' });
    redirect(res, '/admin/support');
  } catch (err) { next(err); }
}

async function approveDriverRequest(req, res, next) {
  let invitation = null;
  try {
    const ticket = await repository.tickets.findOne({ id: req.params.id, category: 'driver_invitation_request', status: 'pending_super_admin_approval' });
    if (!ticket) throw error('Driver request not found or already reviewed', 404);
    const companyId = ticket.companyId || ticket.ownerId;
    const company = await repository.companies.findOne({ id: companyId, status: 'active', verificationStatus: 'verified' });
    if (!company) throw error('Driver company must be active and verified', 409);
    const requested = ticket.requestedDriver || ticket.metadata?.requestedDriver || {};
    const fullName = cleanText(requested.fullName || req.body.fullName, 180);
    const phone = cleanText(requested.phone || req.body.phone, 50);
    const email = cleanText(requested.email || req.body.email, 254).toLowerCase();
    if (!fullName) throw error('Driver full name is required', 422);
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw error('A valid driver email is required for the signed invitation', 422);
    const conflict = await repository.users.findOne({ $or: [{ email }, ...(phone ? [{ phone }] : [])] });
    if (conflict) throw error('A Classic Trip account already uses this driver email or phone. Use an account-linking support review instead of creating another identity.', 409);
    const vehicleId = cleanText(requested.vehicleId || req.body.vehicleId, 180);
    const scheduleId = cleanText(requested.scheduleId || req.body.scheduleId, 180);
    if (vehicleId && !(await repository.vehicles.findOne({ id: vehicleId, companyId: company.id }))) throw error('Selected vehicle does not belong to this company', 409);
    if (scheduleId && !(await repository.schedules.findOne({ id: scheduleId, companyId: company.id }))) throw error('Selected schedule does not belong to this company', 409);

    invitation = await invitationService.createInvitation({
      type: 'driver',
      companyId: company.id,
      companyName: company.name,
      fullName,
      email,
      phone,
      roleTitle: 'Driver',
      permissions: ['manifest.view', 'checkin.assist', 'trip.status.update', 'incident.create'],
      branchId: cleanText(req.body.branchId || req.body.branch || '', 180),
      vehicleId,
      scheduleId,
      licenseNumber: cleanText(requested.licenseNumber || req.body.licenseNumber, 120),
      licenseClass: cleanText(requested.licenseClass || req.body.licenseClass, 80),
      requestTicketId: ticket.id,
      driverEmployeeId: cleanText(ticket.metadata?.driverEmployeeId || '', 180),
      termsSummary: 'Driver access requires identity, licence, safety, company-assignment, and permission verification before operational access.',
    }, actor(req), 'admin');

    const driverEmployeeId = cleanText(ticket.metadata?.driverEmployeeId || '', 180);
    if (driverEmployeeId) {
      const employee = await repository.employees.findOne({ id: driverEmployeeId, companyId: company.id });
      if (employee) {
        employee.invitationId = invitation.id;
        employee.status = 'invited';
        employee.onboardingStatus = 'invitation_sent';
        employee.invitedAt = new Date().toISOString();
        employee.updatedAt = employee.invitedAt;
        await repository.employees.save(employee, { id: employee.id });
      }
    }

    ticket.status = 'resolved';
    ticket.resolutionNotes = `Signed driver invitation sent to ${email}. The account remains operationally locked until acceptance and driver verification.`;
    ticket.resolvedBy = actor(req);
    ticket.resolvedAt = new Date().toISOString();
    ticket.metadata = {
      ...(ticket.metadata || {}),
      requestedDriver: requested,
      approvalStatus: 'invitation_sent',
      invitationId: invitation.id,
      requestedVehicleId: vehicleId,
      requestedScheduleId: scheduleId,
    };
    await repository.withTransaction(async (session) => {
      await repository.tickets.save(ticket, { id: ticket.id }, { session });
      await audit(req, 'admin.driver_request.invitation_sent', ticket.id, {
        entityType: 'support_ticket', companyId: company.id, invitationId: invitation.id,
      }, { session, entityType: 'support_ticket' });
    });
    redirect(res, '/admin/support');
  } catch (err) {
    if (invitation?.id) await invitationService.revokeInvitation(invitation.id, actor(req), 'Driver request approval did not complete').catch(() => {});
    next(err);
  }
}

async function rejectDriverRequest(req, res, next) {
  try {
    const ticket = await repository.tickets.findOne({ id: req.params.id, category: 'driver_invitation_request', status: 'pending_super_admin_approval' });
    if (!ticket) throw error('Driver request not found or already reviewed', 404);
    const reason = cleanText(req.body.reason || req.body.note || 'Rejected by Super Admin', 2000);
    if (ticket.metadata?.invitationId) {
      await invitationService.revokeInvitation(ticket.metadata.invitationId, actor(req), reason).catch(() => {});
    }
    const driverEmployeeId = cleanText(ticket.metadata?.driverEmployeeId || '', 180);
    if (driverEmployeeId) {
      const employee = await repository.employees.findOne({ id: driverEmployeeId, companyId: ticket.companyId || ticket.ownerId });
      if (employee && !employee.userId) {
        employee.status = 'rejected';
        employee.onboardingStatus = 'request_rejected';
        employee.rejectedAt = new Date().toISOString();
        employee.updatedAt = employee.rejectedAt;
        await repository.employees.save(employee, { id: employee.id });
      }
    }
    ticket.status = 'closed'; ticket.resolutionNotes = reason; ticket.resolvedBy = actor(req); ticket.resolvedAt = new Date().toISOString();
    ticket.metadata = { ...(ticket.metadata || {}), approvalStatus: 'rejected', rejectionReason: reason, rejectedBy: actor(req), rejectedAt: new Date().toISOString() };
    await repository.withTransaction(async (session) => {
      await repository.tickets.save(ticket, { id: ticket.id }, { session });
      await audit(req, 'admin.driver_request.rejected', ticket.id, { entityType: 'support_ticket', companyId: ticket.companyId || ticket.ownerId, reason }, { session, entityType: 'support_ticket' });
    });
    redirect(res, '/admin/support');
  } catch (err) { next(err); }
}

module.exports = {
  createBooking, createListing, createPromotion, createNotice, sendNotification, createCustomerNote,
  inviteAdmin, approveDriverRequest, rejectDriverRequest, createVerificationTask, createRefund,
  runPayout, freezePayment, updateFinanceRules, updatePriceRule, updateTemplate,
  replySupport, createInternalNote, approveReschedule, rejectReschedule,
};
