#!/usr/bin/env node
const { validateEnv } = require('../src/config/env');
const { connectDb, mongoose } = require('../src/config/db');
const repositories = require('../src/repositories');

async function main() {
  validateEnv();
  await connectDb();
  const modelNames = [...new Set(Object.values(repositories.entityModelMap))];
  const failures = [];
  let created = 0;
  for (const modelName of modelNames) {
    try {
      require(`../src/models/${modelName}`);
      const Model = mongoose.model(modelName);
      await Model.createIndexes();
      created += 1;
    } catch (error) {
      failures.push(`${modelName}: ${error.message}`);
    }
  }
  if (failures.length) {
    console.error(`✖ Index creation failed for ${failures.length} model(s):`);
    failures.forEach((failure) => console.error(`  - ${failure}`));
    process.exitCode = 1;
  } else {
    console.log(`✓ Production indexes verified for ${created} models.`);
  }
}

main()
  .catch((error) => { console.error(`✖ ${error.message}`); process.exitCode = 1; })
  .finally(async () => { await mongoose.disconnect().catch(() => {}); });
