const store = require('../data/persistentStore');
const companyService = require('../company/companyService');
const paymentService = require('../payment/paymentService');
const notificationService = require('../notification/notificationService');
const generateCode = require('../../utils/generateCode');
const { env } = require('../../config/env');
const repositories = require('../../repositories');

const PLAN_CATALOG = [
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'For a new partner launching a few services.',
    amount: 99000,
    currency: 'UGX',
    interval: 'month',
    badge: 'Launch',
    features: ['5 live listings', '3 staff accounts', 'Ticket scanner', 'Email and SMS ticket delivery', 'Basic support workflow'],
    limits: { listings: 5, staff: 3, campaigns: 1 },
  },
  {
    id: 'growth',
    name: 'Growth',
    tagline: 'For operators ready to sell and promote every week.',
    amount: 249000,
    currency: 'UGX',
    interval: 'month',
    badge: 'Recommended',
    recommended: true,
    features: ['25 live listings', '15 staff accounts', 'Promotions and route boosts', 'Payout reports', 'Refund and dispute workflow'],
    limits: { listings: 25, staff: 15, campaigns: 5 },
  },
  {
    id: 'scale',
    name: 'Scale',
    tagline: 'For multi-branch travel brands and larger inventory teams.',
    amount: 599000,
    currency: 'UGX',
    interval: 'month',
    badge: 'Enterprise',
    features: ['Unlimited listings', 'Unlimited staff', 'Priority onboarding queue', 'Advanced reports', 'Dedicated launch support'],
    limits: { listings: 0, staff: 0, campaigns: 0 },
  },
];

function ensureBillingState() {
  if (!Array.isArray(store.state.subscriptionOrders)) store.state.subscriptionOrders = [];
  if (!Array.isArray(store.state.subscriptions)) store.state.subscriptions = [];
  if (!Array.isArray(store.state.payments)) store.state.payments = [];
  if (!Array.isArray(store.state.auditLogs)) store.state.auditLogs = [];
  if (!Array.isArray(store.state.supportTickets)) store.state.supportTickets = [];
}

function cleanText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

function normalize(value) {
  return String(value || '').toLowerCase().trim();
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

function addDays(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function plans() {
  return PLAN_CATALOG.map((plan) => ({ ...plan, features: [...plan.features], limits: { ...plan.limits } }));
}

function findPlan(planId = 'growth') {
  const key = normalize(planId || 'growth');
  return plans().find((plan) => normalize(plan.id) === key) || plans().find((plan) => plan.id === 'growth');
}

function findOrder(orderRef) {
  ensureBillingState();
  const key = normalize(orderRef);
  return store.state.subscriptionOrders.find((order) => normalize(order.orderRef) === key || normalize(order.id) === key) || null;
}

function activeSubscription(companyId) {
  ensureBillingState();
  return store.state.subscriptions
    .filter((subscription) => subscription.companyId === companyId && subscription.status === 'active')
    .sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0))[0] || null;
}

async function persistCompany(company) {
  await repositories.companies.upsert(company);
}

async function persistUser(user) {
  await repositories.users.upsert(user);
}

async function persistPayment(payment) {
  await repositories.payments.upsert(payment);
}

async function persistOrder(order) {
  await repositories.subscriptionOrders.upsert(order);
}

async function persistSubscription(subscription) {
  await repositories.subscriptions.upsert(subscription);
}

async function persistSupportTicket(ticket) {
  await repositories.supportTickets.upsert(ticket);
}

function orderContact(payload = {}, user = {}) {
  return {
    name: cleanText(payload.contactName || payload.fullName || user.fullName || payload.name),
    email: cleanText(payload.email || user.email).toLowerCase(),
    phone: cleanText(payload.phone || user.phone),
    whatsapp: cleanText(payload.whatsapp || payload.phone || user.phone),
  };
}

function createOrder({ company, planId, orderType = 'onboarding', contact = {}, actorId = 'public-onboarding' }) {
  ensureBillingState();
  const plan = findPlan(planId);
  const order = {
    id: nextId('subscription-order', store.state.subscriptionOrders),
    orderRef: generateCode('CTPLAN', 8),
    orderType,
    companyId: company.id,
    companySlug: company.slug,
    companyName: company.name,
    planId: plan.id,
    planName: plan.name,
    amount: plan.amount,
    currency: plan.currency,
    interval: plan.interval,
    status: 'pending_payment',
    paymentStatus: 'pending',
    provider: env.paymentProvider,
    providerReference: '',
    checkoutUrl: '',
    contact,
    createdBy: actorId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: addDays(2),
  };
  store.state.subscriptionOrders.unshift(order);
  store.state.auditLogs.push({
    id: nextId('audit', store.state.auditLogs),
    actorId,
    action: `billing.${orderType}_order_created`,
    target: order.orderRef,
    entityType: 'subscription_order',
    entityId: order.id,
    status: 'pending',
    createdAt: new Date().toISOString(),
  });
  return order;
}

async function createOnboardingOrder(payload = {}, req = null) {
  const contact = orderContact(payload);
  const company = await companyService.createCompany({
    name: payload.name,
    companyType: payload.companyType,
    country: payload.country,
    city: payload.city || '',
    email: contact.email,
    phone: contact.phone,
    description: payload.description || `Partner onboarding for ${cleanText(payload.name)}`,
    operatingCurrency: payload.operatingCurrency,
  });
  const user = store.upsertUser({
    fullName: contact.name || `${company.name} admin`,
    email: contact.email,
    phone: contact.phone,
    role: 'company_admin',
    companyId: company.id,
    status: 'pending',
    isVerified: false,
  });
  company.ownerId = user.id;
  company.settings = {
    ...(company.settings || {}),
    billingStatus: 'checkout_pending',
    selectedPlanId: findPlan(payload.planId).id,
    onboardingStep: 'plan_payment',
  };
  const order = createOrder({
    company,
    planId: payload.planId,
    orderType: 'onboarding',
    contact,
    actorId: user.id || contact.email || 'public-onboarding',
  });
  const ticket = {
    id: nextId('support', store.state.supportTickets),
    ownerType: 'company',
    ownerId: company.id,
    companyId: company.id,
    category: 'Partner onboarding',
    subject: `Partner onboarding: ${company.name}`,
    message: `Plan ${order.planName} selected. Contact ${contact.name || contact.email} at ${contact.email} / ${contact.phone}.`,
    priority: 'high',
    status: 'open',
    assignedTo: 'admin-onboarding',
    createdBy: contact.email || 'partner-onboarding',
    createdAt: new Date().toISOString(),
    meta: { source: 'plan_onboarding', companySlug: company.slug, orderRef: order.orderRef, ip: req?.ip || '' },
  };
  store.state.supportTickets.unshift(ticket);
  await persistCompany(company);
  await persistUser(user);
  await persistOrder(order);
  await persistSupportTicket(ticket);
  return { company, user, order, plan: findPlan(order.planId) };
}

async function createUpgradeOrder(companyId, planId, actor = {}) {
  ensureBillingState();
  const company = store.findCompany(companyId);
  if (!company) {
    const error = new Error('Company not found for upgrade');
    error.status = 404;
    throw error;
  }
  const contact = orderContact({}, actor);
  const order = createOrder({
    company,
    planId,
    orderType: 'upgrade',
    contact,
    actorId: actor.id || company.ownerId || 'company-admin',
  });
  company.settings = {
    ...(company.settings || {}),
    billingStatus: 'upgrade_pending',
    selectedPlanId: order.planId,
    pendingUpgradeOrderRef: order.orderRef,
  };
  company.updatedAt = new Date().toISOString();
  await persistCompany(company);
  await persistOrder(order);
  return { company, order, plan: findPlan(order.planId) };
}

function paymentIdempotencyKey(order, payload = {}) {
  return payload.idempotencyKey || payload.eventId || payload.providerReference || `${payload.provider || order.provider || 'mock'}:${order.orderRef}:${payload.status || 'initiated'}`;
}

function recordOrderPayment(order, payload = {}, status = 'pending') {
  ensureBillingState();
  const idempotencyKey = paymentIdempotencyKey(order, payload);
  const existing = store.state.payments.find((payment) => payment.idempotencyKey === idempotencyKey);
  if (existing) return { payment: existing, idempotent: true };
  const payment = {
    id: nextId('payment', store.state.payments),
    bookingId: order.id,
    bookingRef: order.orderRef,
    companyId: order.companyId,
    provider: payload.provider || order.provider || env.paymentProvider,
    providerReference: payload.providerReference || payload.reference || order.providerReference || idempotencyKey,
    paymentRef: payload.paymentRef || payload.providerReference || '',
    methodNote: payload.paymentMethod || payload.methodNote || '',
    amount: Number(payload.amount || order.amount || 0),
    grossAmount: Number(payload.amount || order.amount || 0),
    currency: payload.currency || order.currency || 'UGX',
    status,
    settlementStatus: status === 'successful' ? 'completed' : 'pending',
    paidAt: status === 'successful' ? new Date().toISOString() : null,
    failedAt: status === 'failed' ? new Date().toISOString() : null,
    checkoutUrl: payload.checkoutUrl || order.checkoutUrl || '',
    idempotencyKey,
    rawPayload: payload.rawPayload || payload,
    metadata: { referenceType: 'subscription_order', orderRef: order.orderRef, planId: order.planId, orderType: order.orderType },
    createdAt: new Date().toISOString(),
  };
  store.state.payments.push(payment);
  return { payment, idempotent: false };
}

async function activateOrder(order, payment = null) {
  const company = store.findCompany(order.companyId);
  if (!company) {
    const error = new Error('Company not found for subscription activation');
    error.status = 404;
    throw error;
  }
  const plan = findPlan(order.planId);
  const previous = activeSubscription(company.id);
  if (previous) {
    previous.status = 'replaced';
    previous.endedAt = new Date().toISOString();
  }
  const subscription = {
    id: nextId('subscription', store.state.subscriptions),
    companyId: company.id,
    companySlug: company.slug,
    planId: plan.id,
    planName: plan.name,
    amount: plan.amount,
    currency: plan.currency,
    interval: plan.interval,
    status: 'active',
    orderRef: order.orderRef,
    paymentId: payment?.id || '',
    providerReference: payment?.providerReference || order.providerReference || '',
    startedAt: new Date().toISOString(),
    currentPeriodStart: new Date().toISOString(),
    currentPeriodEnd: addDays(30),
    limits: { ...plan.limits },
  };
  store.state.subscriptions.unshift(subscription);
  order.status = 'active';
  order.paymentStatus = 'successful';
  order.activatedAt = subscription.startedAt;
  order.subscriptionId = subscription.id;
  order.updatedAt = new Date().toISOString();
  company.settings = {
    ...(company.settings || {}),
    billingStatus: 'active',
    subscription: {
      id: subscription.id,
      planId: plan.id,
      planName: plan.name,
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
      limits: subscription.limits,
    },
    selectedPlanId: plan.id,
    pendingUpgradeOrderRef: '',
    onboardingStep: company.verificationStatus === 'verified' ? 'complete' : 'verification',
  };
  company.updatedAt = new Date().toISOString();
  store.state.auditLogs.push({
    id: nextId('audit', store.state.auditLogs),
    actorId: order.createdBy || company.ownerId || 'billing-system',
    action: 'billing.subscription_activated',
    target: order.orderRef,
    entityType: 'subscription',
    entityId: subscription.id,
    status: 'success',
    createdAt: new Date().toISOString(),
  });
  if (previous) await persistSubscription(previous);
  await persistSubscription(subscription);
  await persistOrder(order);
  await persistCompany(company);
  await notificationService.queueNotification({
    userId: company.ownerId || null,
    channels: ['email', 'sms'],
    title: `Classic Trip ${plan.name} plan active`,
    message: `${company.name} is now on the ${plan.name} plan. Your partner verification can continue from the dashboard.`,
    recipient: order.contact,
    referenceType: 'subscription',
    referenceId: subscription.id,
    meta: { companyId: company.id, orderRef: order.orderRef, planId: plan.id },
  });
  return { company, order, subscription, plan };
}

async function initiateOrderPayment(orderRef, payload = {}) {
  const order = findOrder(orderRef);
  if (!order) {
    const error = new Error('Subscription order not found');
    error.status = 404;
    throw error;
  }
  if (order.status === 'active') return { order, plan: findPlan(order.planId), subscription: activeSubscription(order.companyId), alreadyPaid: true };
  const provider = payload.provider || payload.paymentProvider || env.paymentProvider;
  const providerPayment = await paymentService.initiatePayment({
    ...payload,
    provider,
    bookingRef: order.orderRef,
    orderRef: order.orderRef,
    reference: order.orderRef,
    amount: order.amount,
    currency: order.currency,
    customer: order.contact,
    metadata: { referenceType: 'subscription_order', orderRef: order.orderRef, companyId: order.companyId, planId: order.planId },
  });
  order.provider = providerPayment.provider || provider;
  order.providerReference = providerPayment.providerReference || '';
  order.checkoutUrl = providerPayment.checkoutUrl || '';
  order.paymentStatus = providerPayment.status || 'pending';
  order.status = order.paymentStatus === 'successful' ? 'paid' : 'pending_payment';
  order.updatedAt = new Date().toISOString();
  const { payment, idempotent } = recordOrderPayment(order, {
    ...providerPayment,
    provider: order.provider,
    amount: order.amount,
    currency: order.currency,
    paymentMethod: payload.paymentMethod,
    idempotencyKey: `init:${order.orderRef}:${order.providerReference || order.provider}`,
  }, order.paymentStatus);
  await persistPayment(payment);
  await persistOrder(order);
  if (order.paymentStatus === 'successful') {
    const activated = await activateOrder(order, payment);
    return { ...activated, payment, idempotent };
  }
  await notificationService.queueNotification({
    userId: null,
    channels: ['email', 'sms'],
    title: `Payment pending ${order.orderRef}`,
    message: `${order.companyName} ${order.planName} plan payment is pending confirmation.`,
    recipient: order.contact,
    referenceType: 'subscription_order',
    referenceId: order.id,
    meta: { orderRef: order.orderRef, checkoutUrl: order.checkoutUrl },
  });
  return { order, plan: findPlan(order.planId), payment, idempotent };
}

async function processPaymentWebhook(payload = {}) {
  ensureBillingState();
  const orderRef = payload.orderRef || payload.reference || payload.bookingRef || payload.meta?.orderRef || payload.metadata?.orderRef;
  const order = findOrder(orderRef);
  if (!order) return null;
  const rawStatus = normalize(payload.status || 'pending');
  const status = ['successful', 'success', 'paid', 'completed'].includes(rawStatus)
    ? 'successful'
    : ['failed', 'declined', 'cancelled'].includes(rawStatus)
      ? 'failed'
      : 'pending';
  const { payment, idempotent } = recordOrderPayment(order, payload, status);
  if (idempotent) return { valid: true, idempotent: true, payment, order, subscription: activeSubscription(order.companyId) };
  order.paymentStatus = status;
  order.status = status === 'successful' ? 'paid' : status === 'failed' ? 'failed' : 'pending_payment';
  order.provider = payload.provider || order.provider;
  order.providerReference = payload.providerReference || payload.reference || order.providerReference;
  order.updatedAt = new Date().toISOString();
  await persistPayment(payment);
  await persistOrder(order);
  if (status === 'successful') {
    const activated = await activateOrder(order, payment);
    return { valid: true, processed: true, payment, ...activated };
  }
  return { valid: true, processed: true, payment, order, plan: findPlan(order.planId) };
}

function companyBillingSummary(companyId) {
  ensureBillingState();
  const subscription = activeSubscription(companyId);
  const pendingOrder = store.state.subscriptionOrders.find((order) => order.companyId === companyId && ['pending_payment', 'paid'].includes(order.status));
  const plan = subscription ? findPlan(subscription.planId) : null;
  return {
    plans: plans(),
    subscription,
    plan,
    pendingOrder,
    orders: store.state.subscriptionOrders.filter((order) => order.companyId === companyId).slice(0, 10),
  };
}

module.exports = {
  plans,
  findPlan,
  findOrder,
  activeSubscription,
  companyBillingSummary,
  createOnboardingOrder,
  createUpgradeOrder,
  initiateOrderPayment,
  processPaymentWebhook,
};
