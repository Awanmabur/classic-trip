const billingService = require('../../services/billing/billingService');
const { env } = require('../../config/env');
const { resolveCompanyId } = require('../../utils/companyScope');

function renderPlans(req, res) {
  return res.render('pages/pricing', {
    seo: {
      title: 'Partner plans | Classic Trip',
      description: 'Choose a Classic Trip partner plan for onboarding, listings, payments, promotions, and staff workflows.',
    },
    plans: billingService.plans(),
    selectedPlanId: req.query.plan || 'growth',
  });
}

function renderOnboarding(req, res) {
  const selectedPlanId = req.query.plan || 'growth';
  return res.render('pages/partner-onboarding', {
    seo: {
      title: 'Partner onboarding | Classic Trip',
      description: 'Create a partner account, select a plan, and continue to secure payment.',
    },
    plans: billingService.plans(),
    selectedPlanId,
    selectedPlan: billingService.findPlan(selectedPlanId),
    form: req.query,
  });
}

async function createOnboarding(req, res, next) {
  try {
    const { order, user } = await billingService.createOnboardingOrder(req.body, req);
    // The onboarding flow creates/updates the company_admin account but previously never
    // logged the browser into it - the session stayed whatever it was before (often
    // anonymous), so req.session.user.companyId was unset on every later request. That's
    // exactly what fed the `|| 'company-01'` fallbacks across the company controllers,
    // silently showing the new partner someone else's (the seeded demo company's) data.
    await new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
    req.session.user = { ...user, passwordHash: undefined };
    return res.redirect(`/billing/checkout/${order.orderRef}`);
  } catch (error) {
    return next(error);
  }
}

function renderCheckout(req, res, next) {
  const order = billingService.findOrder(req.params.orderRef);
  if (!order) return next();
  return res.render('pages/billing-checkout', {
    seo: { title: `Pay ${order.planName} plan | Classic Trip` },
    order,
    company: require('../../services/data/persistentStore').findCompany(order.companyId),
    plan: billingService.findPlan(order.planId),
    providers: require('../../services/payment/paymentService').providerSummary(),
    defaultProvider: env.paymentProvider,
  });
}

async function payOrder(req, res, next) {
  try {
    const result = await billingService.initiateOrderPayment(req.params.orderRef, req.body);
    return res.redirect(`/billing/success/${result.order.orderRef}`);
  } catch (error) {
    return next(error);
  }
}

function renderSuccess(req, res, next) {
  const order = billingService.findOrder(req.params.orderRef);
  if (!order) return next();
  const company = require('../../services/data/persistentStore').findCompany(order.companyId);
  return res.render('pages/billing-success', {
    seo: { title: `Plan ${order.paymentStatus === 'successful' ? 'active' : 'pending'} | Classic Trip` },
    order,
    company,
    plan: billingService.findPlan(order.planId),
    subscription: billingService.activeSubscription(order.companyId),
  });
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

function renderCompanyBilling(req, res) {
  const companyId = resolveCompanyId(req);
  const store = require('../../services/data/persistentStore');
  return res.render('pages/company-billing', {
    seo: { title: 'Company billing | Classic Trip' },
    company: store.findCompany(companyId),
    billing: billingService.companyBillingSummary(companyId),
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
