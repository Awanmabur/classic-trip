'use strict';

require('dotenv').config();
const { connectDb, mongoose } = require('../src/config/db');
const Company = require('../src/models/Company');
const Booking = require('../src/models/Booking');
const Payment = require('../src/models/Payment');
const WalletTransaction = require('../src/models/WalletTransaction');
const { normalizeCountry, currencyForCountry } = require('../src/config/countryMarkets');

const apply = process.argv.includes('--apply');

async function hasFinancialHistory(companyId) {
  const [bookings, payments, walletRows] = await Promise.all([
    Booking.exists({ $or: [{ companyId }, { agentCompanyId: companyId }, { providerCompanyId: companyId }], status: { $nin: ['draft', 'expired', 'failed'] } }),
    Payment.exists({ companyId, status: { $in: ['successful', 'refunded'] } }),
    WalletTransaction.exists({ ownerType: 'company', ownerId: companyId }),
  ]);
  return Boolean(bookings || payments || walletRows);
}

async function main() {
  await connectDb();
  const companies = await Company.find({}).select('id name country operatingCurrency status verificationStatus settings').lean();
  const result = { mode: apply ? 'apply' : 'dry-run', scanned: companies.length, alreadyCorrect: 0, safelyUpdatable: [], manualReview: [], unsupportedCountry: [] };

  for (const company of companies) {
    const country = normalizeCountry(company.country);
    const desiredCurrency = currencyForCountry(country);
    const currentCurrency = String(company.operatingCurrency || '').toUpperCase();
    if (!country || !desiredCurrency) {
      result.unsupportedCountry.push({ companyId: company.id, name: company.name, country: company.country || '' });
      continue;
    }
    if (currentCurrency === desiredCurrency) {
      result.alreadyCorrect += 1;
      continue;
    }
    const financialHistory = await hasFinancialHistory(company.id);
    const record = { companyId: company.id, name: company.name, country, currentCurrency, desiredCurrency };
    if (financialHistory) {
      result.manualReview.push(record);
      if (apply) {
        await Company.updateOne({ id: company.id }, { $set: {
          'settings.currencyReviewRequired': true,
          'settings.expectedCountryCurrency': desiredCurrency,
          'settings.currencyReviewReason': 'Existing financial history prevents automatic currency rewrite',
          'settings.currencyReviewFlaggedAt': new Date(),
        } });
      }
      continue;
    }
    result.safelyUpdatable.push(record);
    if (apply) {
      await Company.updateOne({ id: company.id }, {
        $set: { country, operatingCurrency: desiredCurrency, 'settings.currencyReviewRequired': false, 'settings.countryCurrencySynchronizedAt': new Date() },
        $unset: { 'settings.expectedCountryCurrency': '', 'settings.currencyReviewReason': '', 'settings.currencyReviewFlaggedAt': '' },
      });
    }
  }

  console.log(JSON.stringify(result, null, 2));
  if (result.manualReview.length) console.log('Manual review is required for financially active currency mismatches; no historic monetary record was rewritten.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await mongoose.disconnect().catch(() => {}); });
