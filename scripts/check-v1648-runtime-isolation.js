#!/usr/bin/env node
'use strict';
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const root = path.resolve(__dirname, '..'); const read = f => fs.readFileSync(path.join(root,f),'utf8');
const pkg = require('../package.json'); let n=0; const check=(name,fn)=>{fn();n++;console.log(`✓ ${name}`)};
check('release is v1.6.48 or newer',()=>assert(/^1\.6\.(?:4[8-9]|[5-9]\d|\d{3,})$/.test(pkg.version)));
check('development npm start defaults to web-only',()=>{const s=read('scripts/start.js'); assert(s.includes("nodeEnv === 'development' ? devWorkerFlag === 'true' : productionWorkerRequested")); assert(s.includes('RUN_BACKGROUND_WORKER_DEV'));});
check('web rolling fallback is explicit only',()=>assert(read('scripts/start.js').includes("const webRollingFallback = nodeEnv !== 'development' && !runBackgroundWorker && explicitWebRollingFallback === 'true';")));
check('worker exit does not kill web process',()=>{const s=read('scripts/start.js'); assert(s.includes('options.critical === false')); assert(s.includes('web process remains online')); assert(s.includes('restart: true'));});
check('worker has capped Mongo pool',()=>{const e=read('src/config/env.js'), d=read('src/config/db.js'); assert(e.includes('MONGO_WORKER_MAX_POOL_SIZE')); assert(d.includes('effectivePoolMax')); assert(d.includes("CLASSIC_TRIP_PROCESS_ROLE"));});
check('scheduled jobs are serialized',()=>{const s=read('src/jobs/scheduler.js'); assert(s.includes('const queuedJobs = new Set()')); assert(s.includes('let activeJobName = null')); assert(s.includes('worker_busy:'));});
check('job deadline is warning not fake cancellation',()=>{const s=read('src/jobs/scheduler.js'); assert(!s.includes('Promise.race')); assert(s.includes('lease remains held until it really finishes'));});
check('commission sweep is bounded and only unreleased bookings',()=>{const s=read('src/jobs/releaseCommission.js'); assert(s.includes('commissionReleaseBatchSize')); assert(s.includes('earningsReleasedAt')); assert(!s.includes('limit: 5000'));});
check('fulfilled no-commission bookings are marked processed',()=>{const s=read('src/services/commission/releaseService.js'); assert(s.includes('if (!booking.earningsReleasedAt)'));});
check('rolling recovery processes small batches',()=>{const s=read('src/jobs/materializeSchedules.js'); assert(s.includes('eligibleRules.slice(0, env.jobs.materializeRuleBatchSize)')); assert(s.includes('{ maxCreates: 2 }'));});
check('safe runtime defaults are documented',()=>{const s=read('.env.example'); ['RUN_BACKGROUND_WORKER=false','RUN_BACKGROUND_WORKER_DEV=false','MONGO_WORKER_MAX_POOL_SIZE=6','COMMISSION_RELEASE_BATCH_SIZE=50','MATERIALIZE_RULE_BATCH_SIZE=6'].forEach(x=>assert(s.includes(x)));});
console.log(`\n${n}/11 v1.6.48 runtime isolation checks passed.`);
