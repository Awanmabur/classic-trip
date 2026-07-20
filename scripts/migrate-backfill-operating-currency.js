// One-time migration: sets Company.operatingCurrency explicitly on companies created before the
// field existed. Never overrides an already-set operatingCurrency. For each such company, uses
// the most common currency across its own listings (falls back to 'UGX' if it has none) - the
// same value companyService's `company.operatingCurrency || 'UGX'` fallbacks already treat as
// authoritative at runtime, so this migration changes stored data, not app behavior.
// Safe to re-run - it only ever touches companies still missing the field.
//
// Usage: node scripts/migrate-backfill-operating-currency.js
require('dotenv').config();

async function main() {
  const { connectDb, mongoose } = require('../src/config/db');
  await connectDb();
  if (mongoose.connection.readyState !== 1) throw new Error('MongoDB did not connect');

  const Company = require('../src/models/Company');
  const Listing = require('../src/models/Listing');

  const companies = await Company.find({ operatingCurrency: { $in: [null, undefined] } }).lean();
  console.log(`Found ${companies.length} companies missing operatingCurrency.`);

  let updated = 0;
  for (const company of companies) {
    // eslint-disable-next-line no-await-in-loop
    const listings = await Listing.find({ companyId: company.id }).lean();
    let currency = 'UGX';
    if (listings.length) {
      const counts = new Map();
      listings.forEach((listing) => {
        const value = listing.currency || 'UGX';
        counts.set(value, (counts.get(value) || 0) + 1);
      });
      currency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
    // eslint-disable-next-line no-await-in-loop
    await Company.updateOne({ _id: company._id, operatingCurrency: { $in: [null, undefined] } }, { $set: { operatingCurrency: currency } });
    console.log(`  ${company.id} (${company.name}): operatingCurrency -> ${currency} (from ${listings.length} listing(s))`);
    updated += 1;
  }

  console.log(`\nDone. Updated ${updated} companies.`);
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error('MIGRATION FAILED:', error);
  process.exit(1);
});
