const { connectDb, mongoose } = require('../src/config/db');
const { seedModelNames, loadSeedModels } = require('../src/seeds/seedAll');

async function main() {
  await connectDb();
  if (mongoose.connection.readyState !== 1) {
    console.error('MongoDB is not connected. Check MONGO_URI and local mongod.');
    process.exit(1);
  }
  loadSeedModels();
  let total = 0;
  for (const name of seedModelNames) {
    const Model = mongoose.model(name);
    const count = await Model.countDocuments({});
    total += count;
    console.log(`${name.padEnd(32)} ${count}`);
  }
  console.log('-'.repeat(40));
  console.log(`Total MongoDB records: ${total}`);
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
