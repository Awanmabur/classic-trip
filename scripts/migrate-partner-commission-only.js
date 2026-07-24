'use strict';

require('dotenv').config();
const { connectDb, mongoose } = require('../src/config/db');
const { getPlatformConfig } = require('../src/services/platform/platformConfigService');

const apply = process.argv.includes('--apply');
const now = new Date();

function bounded(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : fallback;
}

function deriveCommission(finance = {}, fallback = 10) {
  if (Number.isFinite(Number(finance.partnerCommissionPercent))) return bounded(finance.partnerCommissionPercent, fallback);
  if (Number.isFinite(Number(finance.partnerPayoutPercent))) return bounded(100 - Number(finance.partnerPayoutPercent), fallback);
  return bounded(Number(finance.platformFeePercent || 0) + Number(finance.promoterCommissionPercent || 0), fallback);
}

async function collectionExists(db, name) {
  return Boolean(await db.listCollections({ name }, { nameOnly: true }).hasNext());
}

async function main() {
  await connectDb();
  const db = mongoose.connection.db;
  const platform = await db.collection('platformsettings').findOne({}) || {};
  const finance = platform.financeRules || {};
  const commissionPercent = deriveCommission(finance, 10);
  const promoterGross = bounded(finance.promoterCommissionPercent, 0);
  const promoterSharePercent = Number.isFinite(Number(finance.promoterSharePercent))
    ? bounded(finance.promoterSharePercent, 30)
    : commissionPercent > 0 ? bounded((promoterGross / commissionPercent) * 100, 30) : 30;
  const termsVersion = `commission-migration-${now.toISOString().replace(/[-:.TZ]/g, '')}`;

  const companies = await db.collection('companies').find({}).project({
    id: 1, ownerId: 1, commercialTerms: 1, settings: 1, createdAt: 1,
  }).toArray();

  const companyUpdates = companies.map((company) => {
    const current = company.commercialTerms || {};
    const companyCommission = bounded(current.commissionPercent, commissionPercent);
    return {
      updateOne: {
        filter: { _id: company._id },
        update: {
          $set: {
            commercialTerms: {
              model: 'percentage_commission',
              commissionPercent: companyCommission,
              promoterFunding: 'platform_commission',
              termsVersion: current.termsVersion || termsVersion,
              acceptedAt: current.acceptedAt || company.createdAt || now,
              acceptedBy: current.acceptedBy || company.ownerId || 'migration',
              source: current.source === 'admin_override' ? 'admin_override' : 'platform_default',
              updatedAt: now,
              updatedBy: 'migration:commission-only',
            },
            'settings.commercialModel': 'percentage_commission',
          },
          $unset: {
            'settings.subscription': '',
            'settings.selectedPlanId': '',
            'settings.pendingUpgradeOrderRef': '',
            'settings.billingStatus': '',
            'settings.currentPeriodEnd': '',
            subscriptionPlan: '',
            selectedPlanId: '',
            billingStatus: '',
            pendingUpgradeOrderRef: '',
            currentPeriodEnd: '',
          },
        },
      },
    };
  });

  const retiredCollections = [];
  for (const name of ['subscriptions', 'subscriptionorders']) {
    if (await collectionExists(db, name)) retiredCollections.push(name);
  }

  const summary = {
    mode: apply ? 'apply' : 'dry-run',
    database: mongoose.connection.name,
    defaultPartnerCommissionPercent: commissionPercent,
    promoterSharePercent,
    companiesToNormalize: companyUpdates.length,
    retiredCollections,
    agreementRecordsToNormalize: await collectionExists(db, 'agreements') ? await db.collection('agreements').countDocuments({}) : 0,
    invitationCommercialFieldsToRemove: await collectionExists(db, 'invitations') ? await db.collection('invitations').countDocuments({ commissionPlan: { $exists: true } }) : 0,
    platformFieldsToRemove: [
      'subscriptionPlans',
      'financeRules.platformFeePercent',
      'financeRules.promoterCommissionPercent',
      'financeRules.partnerPayoutPercent',
      'financeRules.promoterDefaultPercent',
    ],
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!apply) {
    console.log('Dry run only. Back up the database, then run npm run migrate:commission-only to apply.');
    return;
  }

  await db.collection('platformsettings').updateOne({}, {
    $set: {
      'financeRules.partnerCommissionPercent': commissionPercent,
      'financeRules.promoterSharePercent': promoterSharePercent,
      'financeRules.commercialTermsVersion': termsVersion,
      'financeRules.updatedAt': now,
      'financeRules.updatedBy': 'migration:commission-only',
    },
    $unset: {
      subscriptionPlans: '',
      'financeRules.platformFeePercent': '',
      'financeRules.promoterCommissionPercent': '',
      'financeRules.partnerPayoutPercent': '',
      'financeRules.promoterDefaultPercent': '',
      'financeRules.monthlyFee': '',
      'financeRules.annualFee': '',
    },
  }, { upsert: true });

  if (companyUpdates.length) await db.collection('companies').bulkWrite(companyUpdates, { ordered: false });
  if (await collectionExists(db, 'agreements')) {
    await db.collection('agreements').updateMany({}, {
      $set: {
        commercialModel: 'percentage_commission',
        commissionPercent,
        promoterFunding: 'platform_commission',
      },
      $unset: {
        commissionModel: '',
        commissionPlan: '',
        subscriptionPlan: '',
        selectedPlanId: '',
        billingStatus: '',
      },
    });
  }
  if (await collectionExists(db, 'invitations')) {
    await db.collection('invitations').updateMany({}, {
      $unset: {
        commissionPlan: '',
        subscriptionPlan: '',
        selectedPlanId: '',
        billingStatus: '',
      },
    });
  }
  for (const name of retiredCollections) await db.collection(name).drop();
  await getPlatformConfig({ refresh: true });
  console.log('Commission-only migration completed successfully.');
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await mongoose.disconnect().catch(() => {}); });
