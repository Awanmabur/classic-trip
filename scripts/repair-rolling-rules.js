#!/usr/bin/env node
'use strict';

require('dotenv').config();
const { connectDb, mongoose } = require('../src/config/db');
const materializeSchedules = require('../src/jobs/materializeSchedules');

async function main() {
  process.env.CLASSIC_TRIP_PROCESS_ROLE = process.env.CLASSIC_TRIP_PROCESS_ROLE || 'rolling-repair';
  await connectDb();
  const result = await materializeSchedules.run(new Date());
  console.log(JSON.stringify({
    repairedAt: new Date().toISOString(),
    rulesConsidered: Number(result.rulesConsidered || 0),
    rulesBlocked: Number(result.rulesBlocked || 0),
    schedulesCreated: Number(result.schedulesCreated || 0),
    schedulesPublished: Number(result.schedulesPublished || 0),
    schedulesDraft: Number(result.schedulesDraft || 0),
    daysSkipped: Number(result.daysSkipped || 0),
    rollingWindowDays: Number(result.rollingWindowDays || 30),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error('Rolling-rule repair failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    materializeSchedules.stopWebFallback?.();
    await mongoose.disconnect().catch(() => {});
  });
