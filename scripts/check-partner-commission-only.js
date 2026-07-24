'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const checks = [];
const check = (name, ok) => checks.push({ name, ok: Boolean(ok) });

const publicRoutes = read('src/routes/web/public.js');
const companyRoutes = read('src/routes/web/company.js');
const adminRoutes = read('src/routes/web/admin.js');
const partnerController = read('src/controllers/public/partnerController.js');
const authService = read('src/services/auth/authService.js');
const companyService = read('src/services/company/companyService.js');
const platformService = read('src/services/platform/platformConfigService.js');
const platformModel = read('src/models/PlatformSetting.js');
const companyModel = read('src/models/Company.js');
const bookingModel = read('src/models/Booking.js');
const commissionModel = read('src/models/Commission.js');
const commissionService = read('src/services/commission/commissionService.js');
const calculator = read('src/utils/calculateCommission.js');
const webhook = read('src/services/payment/webhookService.js');
const repositories = read('src/repositories/index.js');
const workspace = read('public/js/dashboard-workspace.js');
const partnerView = read('src/views/pages/auth/_partner-signup.ejs');
const settingsView = read('src/views/dashboards/shared/sections/settings.ejs');
const migration = read('scripts/migrate-partner-commission-only.js');
const packageJson = JSON.parse(read('package.json'));

for (const file of [
  'src/models/Subscription.js', 'src/models/SubscriptionOrder.js',
  'src/services/billing/billingService.js', 'src/repositories/domain/billingRepository.js',
  'src/controllers/public/billingController.js', 'src/validators/billingValidator.js',
  'src/views/pages/pricing.ejs', 'src/views/pages/billing-checkout.ejs',
  'src/views/pages/billing-success.ejs', 'src/views/pages/company-billing.ejs',
]) check(`${file} is removed`, !exists(file));

check('Partner signup posts directly to the canonical onboarding service', publicRoutes.includes("router.post('/partner/onboarding'") && /registerUser/.test(partnerController));
check('Partner signup has no selected plan or checkout field', !/planId|selectedPlan|checkout|renewal/i.test(partnerView));
check('Partner registration creates company commercial terms', /commercialTerms/.test(companyService) && /percentage_commission/.test(companyService));
check('Authentication has no billing service dependency', !/billingService|SubscriptionOrder|Subscription/.test(authService));
check('Public billing checkout endpoint is removed', !/\/billing\/checkout/.test(publicRoutes));
check('Retired pricing and company billing aliases are removed', !/\/pricing/.test(publicRoutes) && !/company\/billing/.test(companyRoutes));
check('Company upgrade endpoint is removed', !/upgrade|pendingUpgradeOrderRef/.test(companyRoutes));
check('Payment webhook cannot activate a partner plan', !/billingService|activateOrder|subscription/i.test(webhook));
check('Repository registry contains no partner subscription collections', !/subscriptionOrders|subscriptions:\s*'Subscription'/.test(repositories));
check('Platform model stores one partner commission percentage', /partnerCommissionPercent/.test(platformModel) && /promoterSharePercent/.test(platformModel));
check('Platform model contains no partner plan array', !/subscriptionPlans|monthlyFee|annualFee/.test(platformModel));
check('Company stores an auditable commission contract', /commercialTerms/.test(companyModel) && /commissionPercent/.test(companyModel) && /admin_override/.test(companyModel));
check('Booking persists an immutable commercial snapshot', /commercialTermsSnapshot/.test(bookingModel));
check('Commission record persists rates and amounts', ['partnerCommissionPercent','partnerPayoutPercent','promoterSharePercent','totalCommission'].every((field) => commissionModel.includes(field)));
check('Commission creation writes the frozen rate snapshot', ['partnerCommissionPercent','partnerPayoutPercent','promoterSharePercent','totalCommission'].every((field) => commissionService.includes(field)));
check('Partner amount is total minus one commission', /companyAmount\s*=\s*roundMoney\(Math\.max\(0, amount - totalCommission\)\)/.test(calculator));
check('Promoter reward is funded from total commission', /totalCommission \* rates\.promoterSharePercent/.test(calculator) && /platformFee\s*=\s*roundMoney\(Math\.max\(0, totalCommission - promoterAmount\)\)/.test(calculator));
check('Super Admin can update one partner percentage', adminRoutes.includes("/admin/companies/:slug/commission") && /updateCommercialTerms/.test(companyService));
check('Partner table exposes a commission action', /data-type="partner commission"/.test(workspace) && /commissionPercent/.test(workspace));
check('Global settings expose commission, not plans', /partner commission %/i.test(settingsView) && !/subscriptionPlans|monthlyFee|annualFee/.test(settingsView));
check('Migration converts legacy percentages', /deriveCommission/.test(migration) && /partnerCommissionPercent/.test(migration));
check('Migration removes retired company billing fields', /pendingUpgradeOrderRef/.test(migration) && /billingStatus/.test(migration));
check('Invitation schema and services contain no commission plan field', !/commissionPlan/.test(read('src/models/Invitation.js')) && !/commissionPlan/.test(read('src/services/onboarding/invitationService.js')));
check('Admin pipeline uses the percentage model, not a plan', /commercialModel:\s*'percentage_commission'/.test(read('src/services/onboarding/partnerPipelineService.js')) && /commissionPercent/.test(read('src/models/Agreement.js')) && !/payload\.commissionPlan/.test(read('src/services/onboarding/partnerPipelineService.js')));
check('Migration drops retired subscription collections', /collection\(name\)\.drop/.test(migration) && /subscriptionorders/.test(migration));
check('Migration has safe dry-run and explicit apply modes', /process\.argv\.includes\('--apply'\)/.test(migration) && /Dry run only/.test(migration));
check('Package exposes commission migration and release gate', packageJson.scripts['check:commission-only'] && packageJson.scripts['migrate:commission-only:dry'] && packageJson.scripts['migrate:commission-only']);

// Execute the split calculator without loading MongoDB/Mongoose. This proves the
// commercial contract itself, not only the presence of expected source text.
const platformConfigPath = require.resolve('../src/services/platform/platformConfigService');
const calculatorPath = require.resolve('../src/utils/calculateCommission');
const originalPlatformCache = require.cache[platformConfigPath];
const originalCalculatorCache = require.cache[calculatorPath];
try {
  require.cache[platformConfigPath] = {
    id: platformConfigPath,
    filename: platformConfigPath,
    loaded: true,
    exports: {
      getCachedPlatformConfig: () => ({
        partnerCommissionPercent: 10,
        promoterSharePercent: 30,
      }),
    },
    children: [],
    paths: [],
  };
  delete require.cache[calculatorPath];
  const calculateCommission = require(calculatorPath);
  const direct = calculateCommission(100000, false);
  check('Default split pays partner 90% without referral', direct.companyAmount === 90000 && direct.totalCommission === 10000 && direct.platformFee === 10000 && direct.promoterAmount === 0);
  const referred = calculateCommission(100000, true);
  check('Promoter reward is carved from Classic Trip commission', referred.companyAmount === 90000 && referred.totalCommission === 10000 && referred.platformFee === 7000 && referred.promoterAmount === 3000);
  const overridden = calculateCommission(100000, false, { partnerCommissionPercent: 12.5 });
  check('Partner-specific override freezes the requested percentage', overridden.companyAmount === 87500 && overridden.totalCommission === 12500 && overridden.partnerCommissionPercent === 12.5);
} finally {
  if (originalPlatformCache) require.cache[platformConfigPath] = originalPlatformCache;
  else delete require.cache[platformConfigPath];
  if (originalCalculatorCache) require.cache[calculatorPath] = originalCalculatorCache;
  else delete require.cache[calculatorPath];
}

const failed = checks.filter((row) => !row.ok);
if (failed.length) {
  console.error(`Commission-only checks failed (${checks.length - failed.length}/${checks.length}).`);
  failed.forEach((row) => console.error(`- ${row.name}`));
  process.exit(1);
}
console.log(`Commission-only checks passed (${checks.length}/${checks.length}).`);
