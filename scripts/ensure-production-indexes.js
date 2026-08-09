#!/usr/bin/env node
'use strict';

const { validateEnv } = require('../src/config/env');
const { connectDb, mongoose } = require('../src/config/db');
const repositories = require('../src/repositories');
const { reconcileModelIndexes } = require('./lib/index-reconciler');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  validateEnv();
  await connectDb();

  const modelNames = [...new Set([...Object.values(repositories.entityModelMap), 'PlatformActivity'])];
  const failures = [];
  const totals = { verified: 0, created: 0, dropped: 0, models: 0 };

  for (const modelName of modelNames) {
    try {
      require(`../src/models/${modelName}`);
      const Model = mongoose.model(modelName);
      const result = await reconcileModelIndexes(Model, { dryRun });
      totals.verified += result.verified;
      totals.created += result.created;
      totals.dropped += result.dropped;
      totals.models += 1;
    } catch (error) {
      failures.push(`${modelName}: ${error.message}`);
    }
  }

  if (failures.length) {
    console.error(`✖ Index reconciliation failed for ${failures.length} model(s):`);
    failures.forEach((failure) => console.error(`  - ${failure}`));
    process.exitCode = 1;
    return;
  }

  const action = dryRun ? 'planned' : 'completed';
  console.log(
    `✓ Production index reconciliation ${action} for ${totals.models} models `
      + `(${totals.verified} already valid, ${totals.created} created/recreated, ${totals.dropped} conflicting indexes replaced).`,
  );
}

main()
  .catch((error) => { console.error(`✖ ${error.message}`); process.exitCode = 1; })
  .finally(async () => { await mongoose.disconnect().catch(() => {}); });
