const companyService = require('../company/companyService');
const authService = require('../auth/authService');
const paymentService = require('../payment/paymentService');
const notificationService = require('../notification/notificationService');
const generateCode = require('../../utils/generateCode');
const { env } = require('../../config/env');
const billingRepository = require('../../repositories/domain/billingRepository');
const { nextId } = require('../data/idService');
const { getCachedPlatformConfig } = require('../platform/platformConfigService');
const { resolveCurrency, requireCurrency } = require('../../utils/currency');

function cleanText(value, max = 1000) { return String(value || '').replace(/<[^>]*>/g, '').trim().replace(/\s+/g, ' ').slice(0, max); }
function normalize(value) { return cleanText(value).toLowerCase(); }
function addDays(days) { return new Date(Date.now() + Number(days || 0) * 86400000).toISOString(); }
function periodEnd(interval, startedAt = Date.now()) {
  const days = { month: 30, quarter: 90, year: 365 }[interval];
  return days ? new Date(new Date(startedAt).getTime() + days * 86400000).toISOString() : null;
}
function clonePlan(plan) { return plan ? { ...plan, features: [...(plan.features || [])], limits: { ...(plan.limits || {}) } } : null; }
function plans() {
  return getCachedPlatformConfig().subscriptionPlans
    .filter((plan) => plan.status === 'active')
    .map((plan) => ({ ...plan, features: [...plan.features], limits: { ...plan.limits } }));
}
function findPlan(planId = '') {
  const available = plans();
  const key = normalize(planId);
  if (key) return available.find((plan) => normalize(plan.id) === key) || null;
  return available.find((plan) => plan.recommended) || available[0] || null;
}
function requirePlan(planId) {
  const plan = findPlan(planId);
  if (!plan) {
    const error = new Error(plans().length ? 'Choose a valid active Classic Trip plan' : 'No subscription plans are configured. A Super Admin must create a plan in Platform Settings.');
    error.status = 422;
    error.code = plans().length ? 'invalid_subscription_plan' : 'subscription_plans_not_configured';
    throw error;
  }
  return plan;
}

function planForOrder(order = {}) {
  return findPlan(order.planId) || (order.planSnapshot && order.planSnapshot.id ? clonePlan(order.planSnapshot) : null);
}
function requirePlanForOrder(order = {}) {
  const plan = planForOrder(order);
  if (!plan) {
    const error = new Error('The subscription plan snapshot for this order is unavailable');
    error.status = 409;
    error.code = 'subscription_plan_snapshot_missing';
    throw error;
  }
  return plan;
}
async function findOrderLive(orderRef) { const key = cleanText(orderRef); return billingRepository.orders.findOne({ $or: [{ orderRef: key }, { id: key }] }); }
async function activeSubscriptionLive(companyId, options = {}) { return (await billingRepository.subscriptions.list({ companyId, status: 'active' }, { ...options, sort: { startedAt: -1 }, limit: 1 }))[0] || null; }
function orderContact(payload = {}, user = {}) { return { name: cleanText(payload.contactName || payload.fullName || user.fullName || payload.name, 160), email: cleanText(payload.email || user.email, 254).toLowerCase(), phone: cleanText(payload.phone || user.phone, 40), whatsapp: cleanText(payload.whatsapp || payload.phone || user.phone, 40) }; }
async function audit(action, target, entityType, entityId, actorId, status = 'success', session = null) {
  const row = { id: await nextId('audit'), actorId: actorId || 'billing-system', actorRole: 'system', action, target, entityType, entityId, status, createdAt: new Date().toISOString() };
  await billingRepository.auditLogs.save(row, { id: row.id }, { session: session || undefined });
  return row;
}
async function createOrder({ company, planId, orderType = 'onboarding', contact = {}, actorId = 'public-onboarding' }, options = {}) {
  const plan = requirePlan(planId);
  const order = { id: await nextId('subscription-order'), orderRef: generateCode('CTPLAN', 8), orderType, companyId: company.id, companySlug: company.slug, companyName: company.name, planId: plan.id, planName: plan.name, amount: plan.amount, currency: plan.currency, interval: plan.interval, planSnapshot: clonePlan(plan), status: 'pending_payment', paymentStatus: 'pending', provider: env.paymentProvider, providerReference: '', checkoutUrl: '', contact, createdBy: actorId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt: addDays(2) };
  await billingRepository.orders.save(order, { orderRef: order.orderRef }, { session: options.session });
  await audit(`billing.${orderType}_order_created`, order.orderRef, 'subscription_order', order.id, actorId, 'pending', options.session);
  return order;
}
function onboardingError(message, status = 422, code = 'partner_onboarding_failed') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function findExistingOnboardingUser(contact = {}) {
  const filters = [];
  if (contact.email) filters.push({ email: contact.email });
  if (contact.phone) filters.push({ phone: contact.phone });
  return filters.length ? billingRepository.users.findOne({ $or: filters }) : null;
}

async function resolveOnboardingOwner(payload = {}, contact = {}, req = null) {
  const existing = await findExistingOnboardingUser(contact);
  const signedInId = cleanText(req?.session?.user?.id, 180);

  if (existing) {
    // Never turn knowledge of an email address into an authenticated session.
    // An existing account may continue plan onboarding only from its own
    // already-authenticated company-owner session.
    if (!signedInId || signedInId !== existing.id) {
      throw onboardingError('An account with this email or phone already exists. Sign in before continuing partner onboarding.', 409, 'account_exists');
    }
    if (existing.role !== 'company_admin' || !existing.companyId) {
      throw onboardingError('Only a company owner can continue partner plan onboarding.', 403, 'company_owner_required');
    }
    const company = await billingRepository.companies.findOne({ id: existing.companyId });
    if (!company) throw onboardingError('The partner company linked to this account could not be found.', 404, 'company_not_found');
    return { user: existing, company, created: false };
  }

  const user = await authService.registerUser({
    role: 'company_admin',
    fullName: contact.name,
    email: contact.email,
    phone: contact.phone,
    password: payload.password,
    company: payload.name,
    companyType: payload.companyType,
    country: payload.country,
    city: payload.city,
    description: payload.description,
    operatingCurrency: payload.operatingCurrency,
    signupSource: 'pricing_partner_onboarding',
  });
  const company = await billingRepository.companies.findOne({ id: user.companyId });
  if (!company) throw onboardingError('Partner account was created without a company workspace.', 500, 'company_provisioning_failed');
  return { user, company, created: true };
}

async function createOnboardingOrder(payload = {}, req = null) {
  let contact = orderContact(payload);
  if (!contact.email || !contact.phone) throw onboardingError('Email and phone are required for partner onboarding');

  const owner = await resolveOnboardingOwner(payload, contact, req);
  const { user, company } = owner;
  // Account identity comes from the authenticated/persisted owner, never from
  // mutable billing form fields after an account already exists.
  contact = orderContact(payload, user);
  contact.email = cleanText(user.email || contact.email, 254).toLowerCase();
  contact.phone = cleanText(user.phone || contact.phone, 40);

  let result;
  await billingRepository.withTransaction(async (session) => {
    Object.assign(company, {
      name: cleanText(payload.name || company.name, 180),
      legalName: cleanText(payload.legalName || company.legalName || payload.name, 200),
      registrationNumber: cleanText(payload.registrationNumber || company.registrationNumber, 120),
      taxNumber: cleanText(payload.taxNumber || company.taxNumber, 120),
      headOfficeAddress: cleanText(payload.headOfficeAddress || company.headOfficeAddress, 400),
      website: cleanText(payload.website || company.website, 300),
      companyType: cleanText(payload.companyType || company.companyType, 80),
      country: cleanText(payload.country || company.country, 100),
      city: cleanText(payload.city || company.city, 140),
      description: cleanText(payload.description || company.description || `Partner onboarding for ${cleanText(payload.name)}`, 2000),
      operatingCurrency: requireCurrency(payload.operatingCurrency || company.operatingCurrency, 'Operating currency'),
      ownerId: company.ownerId || user.id,
      supportContacts: {
        ...(company.supportContacts || {}),
        email: contact.email,
        phone: contact.phone,
        whatsapp: cleanText(payload.whatsapp || contact.phone, 40),
      },
      settings: {
        ...(company.settings || {}),
        canPublish: false,
        instantConfirmation: false,
        billingStatus: 'checkout_pending',
        selectedPlanId: requirePlan(payload.planId).id,
        onboardingStep: 'plan_payment',
      },
      updatedAt: new Date().toISOString(),
    });
    Object.assign(user, {
      companyId: company.id,
      status: 'active',
      verificationStatus: user.verificationStatus || 'pending',
      onboardingStatus: 'plan_payment',
      updatedAt: new Date().toISOString(),
    });

    const order = await createOrder({ company, planId: payload.planId, orderType: 'onboarding', contact, actorId: user.id }, { session });
    const ticket = {
      id: await nextId('support'), ownerType: 'company', ownerId: company.id, companyId: company.id,
      category: 'Partner onboarding', subject: `Partner onboarding: ${company.name}`,
      message: `Plan ${order.planName} selected. Contact ${contact.name || contact.email} at ${contact.email} / ${contact.phone}.`,
      priority: 'high', status: 'open', assignedTo: 'admin-onboarding', createdBy: user.id,
      createdAt: new Date().toISOString(),
      metadata: { source: 'plan_onboarding', companySlug: company.slug, orderRef: order.orderRef, ip: req?.ip || '', accountCreated: owner.created },
    };
    await billingRepository.users.save(user, { id: user.id }, { session });
    await billingRepository.companies.save(company, { id: company.id }, { session });
    await billingRepository.supportTickets.save(ticket, { id: ticket.id }, { session });
    result = { company, user, order, ticket, plan: requirePlanForOrder(order), accountCreated: owner.created };
  });

  return result;
}
async function createUpgradeOrder(companyId, planId, actor = {}) {
  const company = await billingRepository.companies.findOne({ id: companyId });
  if (!company) { const error = new Error('Company not found for upgrade'); error.status = 404; throw error; }
  let order;
  await billingRepository.withTransaction(async (session) => {
    order = await createOrder({ company, planId, orderType: 'upgrade', contact: orderContact({}, actor), actorId: actor.id || company.ownerId || 'company-admin' }, { session });
    company.settings = { ...(company.settings || {}), billingStatus: 'upgrade_pending', selectedPlanId: order.planId, pendingUpgradeOrderRef: order.orderRef }; company.updatedAt = new Date().toISOString();
    await billingRepository.companies.save(company, { id: company.id }, { session });
  });
  return { company, order, plan: requirePlanForOrder(order) };
}
function paymentIdempotencyKey(order, payload = {}) { return payload.idempotencyKey || payload.eventId || payload.providerReference || `${payload.provider || order.provider || env.paymentProvider}:${order.orderRef}:${payload.status || 'initiated'}`; }
async function recordOrderPayment(order, payload = {}, status = 'pending', options = {}) {
  const idempotencyKey = paymentIdempotencyKey(order, payload);
  const existing = await billingRepository.payments.findOne({ idempotencyKey }, { session: options.session });
  if (existing) return { payment: existing, idempotent: true };
  const payment = { id: await nextId('payment'), bookingId: order.id, bookingRef: order.orderRef, companyId: order.companyId, provider: payload.provider || order.provider || env.paymentProvider, providerReference: payload.providerReference || payload.reference || order.providerReference || idempotencyKey, paymentRef: payload.paymentRef || payload.providerReference || '', methodNote: payload.paymentMethod || payload.methodNote || '', amount: Number(payload.amount || order.amount || 0), grossAmount: Number(payload.amount || order.amount || 0), currency: resolveCurrency(payload.currency, order.currency), status, settlementStatus: status === 'successful' ? 'settled' : 'pending', paidAt: status === 'successful' ? new Date().toISOString() : null, failedAt: status === 'failed' ? new Date().toISOString() : null, checkoutUrl: payload.checkoutUrl || order.checkoutUrl || '', idempotencyKey, rawPayload: payload.rawPayload || payload, metadata: { referenceType: 'subscription_order', orderRef: order.orderRef, planId: order.planId, orderType: order.orderType }, createdAt: new Date().toISOString() };
  await billingRepository.payments.save(payment, { idempotencyKey }, { session: options.session });
  return { payment, idempotent: false };
}
async function activateOrder(order, payment = null) {
  let result;
  await billingRepository.withTransaction(async (session) => {
    const company = await billingRepository.companies.findOne({ id: order.companyId }, { session });
    if (!company) { const error = new Error('Company not found for subscription activation'); error.status = 404; throw error; }
    const plan = requirePlanForOrder(order); const previous = await activeSubscriptionLive(company.id, { session });
    if (previous) { previous.status = 'replaced'; previous.endedAt = new Date().toISOString(); await billingRepository.subscriptions.save(previous, { id: previous.id }, { session }); }
    let subscription = await billingRepository.subscriptions.findOne({ orderRef: order.orderRef, status: 'active' }, { session });
    if (!subscription) subscription = { id: await nextId('subscription'), companyId: company.id, companySlug: company.slug, planId: plan.id, planName: plan.name, amount: plan.amount, currency: plan.currency, interval: plan.interval, status: 'active', orderRef: order.orderRef, paymentId: payment?.id || '', providerReference: payment?.providerReference || order.providerReference || '', startedAt: new Date().toISOString(), currentPeriodStart: new Date().toISOString(), currentPeriodEnd: periodEnd(plan.interval), limits: { ...plan.limits }, planSnapshot: clonePlan(plan) };
    Object.assign(order, { status: 'active', paymentStatus: 'successful', activatedAt: subscription.startedAt, subscriptionId: subscription.id, updatedAt: new Date().toISOString() });
    company.settings = { ...(company.settings || {}), billingStatus: 'active', subscription: { id: subscription.id, planId: plan.id, planName: plan.name, status: subscription.status, currentPeriodEnd: subscription.currentPeriodEnd, limits: subscription.limits }, selectedPlanId: plan.id, pendingUpgradeOrderRef: '', onboardingStep: company.verificationStatus === 'verified' ? 'complete' : 'verification' }; company.updatedAt = new Date().toISOString();
    await billingRepository.subscriptions.save(subscription, { id: subscription.id }, { session }); await billingRepository.orders.save(order, { orderRef: order.orderRef }, { session }); await billingRepository.companies.save(company, { id: company.id }, { session }); await audit('billing.subscription_activated', order.orderRef, 'subscription', subscription.id, order.createdBy || company.ownerId || 'billing-system', 'success', session);
    result = { company, order, subscription, plan, previous };
  });
  await notificationService.queueNotification({ userId: result.company.ownerId || null, channels: ['email', 'sms'], title: `Classic Trip ${result.plan.name} plan active`, message: `${result.company.name} is now on the ${result.plan.name} plan. Your partner verification can continue from the dashboard.`, recipient: result.order.contact, referenceType: 'subscription', referenceId: result.subscription.id, meta: { companyId: result.company.id, orderRef: result.order.orderRef, planId: result.plan.id } });
  return result;
}
async function initiateOrderPayment(orderRef, payload = {}) {
  const order = await findOrderLive(orderRef);
  if (!order) { const error = new Error('Subscription order not found'); error.status = 404; throw error; }
  if (order.status === 'active') return { order, plan: requirePlanForOrder(order), subscription: await activeSubscriptionLive(order.companyId), alreadyPaid: true };
  const provider = paymentService.resolveProviderName(payload.provider || payload.paymentProvider || env.paymentProvider);
  const providerPayment = await paymentService.initiatePayment({ ...payload, provider, bookingRef: order.orderRef, orderRef: order.orderRef, reference: order.orderRef, amount: order.amount, currency: order.currency, customer: order.contact, metadata: { referenceType: 'subscription_order', orderRef: order.orderRef, companyId: order.companyId, planId: order.planId } });
  Object.assign(order, { provider: providerPayment.provider || provider, providerReference: providerPayment.providerReference || '', checkoutUrl: providerPayment.checkoutUrl || '', paymentStatus: providerPayment.status || 'pending', status: providerPayment.status === 'successful' ? 'paid' : 'pending_payment', updatedAt: new Date().toISOString() });
  const { payment, idempotent } = await recordOrderPayment(order, { ...providerPayment, provider: order.provider, amount: order.amount, currency: order.currency, paymentMethod: payload.paymentMethod, idempotencyKey: `init:${order.orderRef}:${order.providerReference || order.provider}` }, order.paymentStatus);
  await billingRepository.orders.save(order, { orderRef: order.orderRef });
  if (order.paymentStatus === 'successful') return { ...(await activateOrder(order, payment)), payment, idempotent };
  await notificationService.queueNotification({ userId: null, channels: ['email', 'sms'], title: `Payment pending ${order.orderRef}`, message: `${order.companyName} ${order.planName} plan payment is pending confirmation.`, recipient: order.contact, referenceType: 'subscription_order', referenceId: order.id, meta: { orderRef: order.orderRef, checkoutUrl: order.checkoutUrl } });
  return { order, plan: requirePlanForOrder(order), payment, idempotent };
}
async function processPaymentWebhook(payload = {}) {
  const orderRef = payload.orderRef || payload.reference || payload.bookingRef || payload.meta?.orderRef || payload.metadata?.orderRef;
  const order = await findOrderLive(orderRef); if (!order) return null;
  const receivedAmount = Number(payload.amount || order.amount); const receivedCurrency = String(payload.currency || order.currency).toUpperCase();
  if (Math.abs(receivedAmount - Number(order.amount || 0)) > 0.0001 || receivedCurrency !== resolveCurrency(order.currency)) { const error = new Error('Subscription payment amount or currency mismatch'); error.status = 409; throw error; }
  const rawStatus = normalize(payload.status || 'pending'); const status = ['successful', 'success', 'paid', 'completed'].includes(rawStatus) ? 'successful' : ['failed', 'declined', 'cancelled'].includes(rawStatus) ? 'failed' : 'pending';
  const { payment, idempotent } = await recordOrderPayment(order, payload, status);
  if (idempotent) return { valid: true, idempotent: true, payment, order, subscription: await activeSubscriptionLive(order.companyId) };
  Object.assign(order, { paymentStatus: status, status: status === 'successful' ? 'paid' : status === 'failed' ? 'failed' : 'pending_payment', provider: payload.provider || order.provider, providerReference: payload.providerReference || payload.reference || order.providerReference, updatedAt: new Date().toISOString() });
  await billingRepository.orders.save(order, { orderRef: order.orderRef });
  if (status === 'successful') return { valid: true, processed: true, payment, ...(await activateOrder(order, payment)) };
  return { valid: true, processed: true, payment, order, plan: requirePlanForOrder(order) };
}
async function companyBillingSummaryLive(companyId) { const [subscription, orders] = await Promise.all([activeSubscriptionLive(companyId), billingRepository.orders.list({ companyId }, { sort: { createdAt: -1 }, limit: 10 })]); return { plans: plans(), subscription, plan: subscription ? (findPlan(subscription.planId) || clonePlan(subscription.planSnapshot)) : null, pendingOrder: orders.find((row) => ['pending_payment', 'paid'].includes(row.status)) || null, orders }; }
module.exports = { plans, findPlan, requirePlan, planForOrder, requirePlanForOrder, findOrder: findOrderLive, findOrderLive, activeSubscription: activeSubscriptionLive, activeSubscriptionLive, companyBillingSummary: companyBillingSummaryLive, companyBillingSummaryLive, createOnboardingOrder, createUpgradeOrder, initiateOrderPayment, processPaymentWebhook };
