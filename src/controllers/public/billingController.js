const billingService = require('../../services/billing/billingService');
const { env } = require('../../config/env');

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
    const { order } = await billingService.createOnboardingOrder(req.body, req);
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
    const companyId = req.session?.user?.companyId || req.body.companyId || 'company-01';
    const { order } = await billingService.createUpgradeOrder(companyId, req.body.planId, req.session?.user || {});
    return res.redirect(`/billing/checkout/${order.orderRef}`);
  } catch (error) {
    return next(error);
  }
}

function renderCompanyBilling(req, res) {
  const companyId = req.session?.user?.companyId || 'company-01';
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
