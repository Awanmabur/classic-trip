const billingService = require('../../services/billing/billingService');
const { env } = require('../../config/env');
const { resolveCompanyId } = require('../../utils/companyScope');
const billingRepository = require('../../repositories/domain/billingRepository');
const authService = require('../../services/auth/authService');

function renderPlans(req, res) {
  const plans = billingService.plans();
  const requested = billingService.findPlan(req.query.plan);
  return res.render('pages/pricing', {
    seo: {
      title: 'Partner plans | Classic Trip',
      description: 'Choose a Classic Trip partner plan for onboarding, listings, payments, promotions, and staff workflows.',
    },
    plans,
    selectedPlanId: requested?.id || billingService.findPlan()?.id || '',
  });
}

async function renderOnboarding(req, res) {
  const plan = String(req.query?.plan || '').trim();
  const query = new URLSearchParams({ role: 'partner', ...(plan ? { plan } : {}) });
  return res.redirect(303, `/register?${query.toString()}#partner`);
}

function assertPartnerOrderAccess(req, order) {
  const user = req.session?.user;
  if (!user) {
    const error = new Error('Sign in with the partner account that created this order.');
    error.status = 401;
    error.code = 'authentication_required';
    throw error;
  }
  if (user.role !== 'company_admin' || String(user.companyId || '') !== String(order.companyId || '')) {
    const error = new Error('You do not have access to this partner billing order.');
    error.status = 403;
    error.code = 'billing_order_forbidden';
    throw error;
  }
}

async function createOnboarding(req, res, next) {
  try {
    const { order, user } = await billingService.createOnboardingOrder(req.body, req);
    // The onboarding flow creates/updates the company_admin account but previously never
    // logged the browser into it - the session stayed whatever it was before (often
    // anonymous), so req.session.user.companyId was unset on every later request. That's
    // exactly what fed the `|| 'company-01'` fallbacks across the company controllers,
    // silently showing the new partner someone else's (the another company's) data.
    await new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
    req.session.user = authService.sanitizeUser(user);
    return res.redirect(`/billing/checkout/${order.orderRef}`);
  } catch (error) {
    if (req.flash) req.flash('error', error.message || 'Partner onboarding could not be completed.');
    const plan = String(req.body?.planId || '').trim();
    const query = new URLSearchParams({ role: 'partner', ...(plan ? { plan } : {}) });
    return res.redirect(`/register?${query.toString()}#partner`);
  }
}

async function renderCheckout(req, res, next) {
  try {
    const order = await billingService.findOrderLive(req.params.orderRef);
    if (!order) return next();
    assertPartnerOrderAccess(req, order);
    return res.render('pages/billing-checkout', {
    seo: { title: `Pay ${order.planName} plan | Classic Trip` },
    order,
    company: await billingRepository.companies.findOne({ id: order.companyId }),
    plan: billingService.findPlan(order.planId),
    providers: require('../../services/payment/paymentService').providerSummary(),
      defaultProvider: env.paymentProvider,
    });
  } catch (error) {
    if (error.status === 401) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    return next(error);
  }
}

async function payOrder(req, res, next) {
  try {
    const order = await billingService.findOrderLive(req.params.orderRef);
    if (!order) return next();
    assertPartnerOrderAccess(req, order);
    const result = await billingService.initiateOrderPayment(req.params.orderRef, req.body);
    return res.redirect(`/billing/success/${result.order.orderRef}`);
  } catch (error) {
    return next(error);
  }
}

async function renderSuccess(req, res, next) {
  try {
    const order = await billingService.findOrderLive(req.params.orderRef);
    if (!order) return next();
    assertPartnerOrderAccess(req, order);
    const company = await billingRepository.companies.findOne({ id: order.companyId });
    return res.render('pages/billing-success', {
    seo: { title: `Plan ${order.paymentStatus === 'successful' ? 'active' : 'pending'} | Classic Trip` },
    order,
    company,
    plan: billingService.findPlan(order.planId),
      subscription: await billingService.activeSubscriptionLive(order.companyId),
    });
  } catch (error) {
    if (error.status === 401) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    return next(error);
  }
}

async function createUpgrade(req, res, next) {
  try {
    const companyId = resolveCompanyId(req, { allowOverride: true });
    const { order } = await billingService.createUpgradeOrder(companyId, req.body.planId, req.session?.user || {});
    return res.redirect(`/billing/checkout/${order.orderRef}`);
  } catch (error) {
    return next(error);
  }
}

async function renderCompanyBilling(req, res) {
  const companyId = resolveCompanyId(req);
  return res.render('pages/company-billing', {
    seo: { title: 'Company billing | Classic Trip' },
    company: await billingRepository.companies.findOne({ id: companyId }),
    billing: await billingService.companyBillingSummaryLive(companyId),
  });
}

module.exports = {
  renderPlans,
  renderOnboarding,
  createOnboarding,
  renderCheckout,
  payOrder,
  renderSuccess,
  createUpgrade,
  renderCompanyBilling,
};
