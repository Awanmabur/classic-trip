// One-time migration: seed src/models/Counter.js so idService.nextId() never collides with
// legacy `prefix-N` ids already sitting in MongoDB from the old non-atomic in-memory generator.
// Safe to re-run - it only ever raises a counter up to the current max, never lowers it.
//
// Usage: node scripts/migrate-seed-id-counters.js
require('dotenv').config();
const mongoose = require('mongoose');

const PREFIX_TO_MODEL = {
  company: 'Company',
  listing: 'Listing',
  route: 'Route',
  'route-stop': 'RouteStop',
  vehicle: 'Vehicle',
  schedule: 'TripSchedule',
  'trip-status': 'TripStatusUpdate',
  room: 'Room',
  branch: 'CompanyBranch',
  policy: 'CompanyPolicy',
  'driver-assignment': 'DriverAssignment',
  'driver-incident': 'DriverIncident',
  'company-employee': 'CompanyEmployee',
  'payment-intent': 'PaymentIntent',
  'receipt-invoice': 'ReceiptInvoice',
  'tax-fee': 'TaxFeeRecord',
  'finance-risk': 'FinanceRiskReview',
  'finance-statement': 'FinanceStatement',
  settlement: 'SettlementBatch',
  'payout-request': 'PayoutRequest',
  'payout-batch': 'PayoutBatch',
  reconciliation: 'ReconciliationReport',
};

async function run() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  await mongoose.connect(process.env.MONGO_URI);
  const Counter = require('../src/models/Counter');

  const results = [];
  for (const [prefix, modelName] of Object.entries(PREFIX_TO_MODEL)) {
    const Model = require(`../src/models/${modelName}`);
    const rows = await Model.find({ id: new RegExp(`^${prefix}-\\d+$`) }, { id: 1 }).lean();
    const maxSeq = rows.reduce((max, row) => {
      const suffix = Number(String(row.id).slice(prefix.length + 1));
      return Number.isFinite(suffix) && suffix > max ? suffix : max;
    }, 0);
    const before = await Counter.findById(prefix).lean();
    const beforeSeq = before?.seq || 0;
    const targetSeq = Math.max(beforeSeq, maxSeq);
    await Counter.updateOne({ _id: prefix }, { $set: { seq: targetSeq } }, { upsert: true });
    results.push({ prefix, existingDocs: rows.length, maxLegacyId: maxSeq, counterBefore: beforeSeq, counterAfter: targetSeq });
  }

  console.table(results);
  await mongoose.disconnect();
}

run().then(() => {
  console.log('Counter seeding complete.');
  process.exit(0);
}).catch((error) => {
  console.error('Counter seeding failed:', error.message);
  process.exit(1);
});
