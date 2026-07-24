'use strict';

const repositories = require('..');


async function get() {
  const row = await repositories.platformSettings.findOne({});
  if (!row) return {};
  const plain = { ...row };
  delete plain._id;
  delete plain.__v;
  return plain;
}

async function save(settings, options = {}) {
  const row = { ...settings, updatedAt: settings.updatedAt || new Date().toISOString() };
  await repositories.platformSettings.upsert(row, {}, { session: options.session || undefined });
  return row;
}

async function removeRetiredCommercialFields() {
  if (!repositories.mongoReady()) return;
  await repositories.platformSettings.Model.collection.updateOne({}, {
    $unset: {
      subscriptionPlans: '',
      'financeRules.platformFeePercent': '',
      'financeRules.promoterCommissionPercent': '',
      'financeRules.partnerPayoutPercent': '',
      'financeRules.promoterDefaultPercent': '',
      'financeRules.monthlyFee': '',
      'financeRules.annualFee': '',
    },
  });
}

module.exports = { get, save, removeRetiredCommercialFields };
