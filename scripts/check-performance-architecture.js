#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const failures = [];

function check(label, condition) {
  if (condition) console.log(`✓ ${label}`);
  else {
    console.error(`✖ ${label}`);
    failures.push(label);
  }
}

const departure = read('src/modules/bus/services/busDepartureService.js');
const setup = read('src/modules/bus/services/busSetupService.js');
const collection = read('src/repositories/domain/mongoCollection.js');
const session = read('src/config/session.js');
const server = read('src/server.js');
const rateLimit = read('src/middlewares/rateLimit.js');
const auth = read('src/services/auth/authService.js');
const phone = read('src/services/auth/phoneVerificationService.js');
const render = read('render.yaml');
const flight = read('src/modules/flight/services/flightSetupService.js');

check('Bus segment inventory does not allocate one counter ID per row', !departure.includes("nextId('bus-seat-segment')"));
check('Flight seat inventory does not allocate one counter ID per seat', !flight.includes("nextId('flight-seat')"));
check('Departure batches share one resolved creation context', departure.includes('const context = await scheduleCreationContext(companyId, payload)'));
check('Departure batches defer and reconcile listing readiness once', departure.includes('deferListingSync: true') && departure.includes('Reconcile it once after the complete batch'));
check('Listing readiness groups inventory counts', setup.includes("countGroupedBy('scheduleId'"));
check('Listing readiness scopes the departure query by listing', /repository\.schedules\.list\(\{\s*companyId,\s*listingId: listingKey,/m.test(setup));
check('Bulk delete does not read all matching documents first', !/async deleteMany[\s\S]{0,220}repository\.list/.test(collection));
check('Redis is the preferred production session store', session.includes('new RedisStore') && session.includes('redisRuntime.activeClient()'));
check('Redis is the preferred shared rate-limit store', rateLimit.includes('new RedisRateLimitStore'));
check('Redis connects before app middleware is loaded', server.indexOf('await Promise.all([connectDb(), connectRedis()])') < server.indexOf("app = require('./app')"));
check('Signup email delivery is queued off the request path', auth.includes('enqueueNotification'));
check('Signup SMS delivery is queued off the request path', phone.includes('enqueueNotification'));
check('Render provisions separate web, worker and Key Value services', render.includes('type: worker') && render.includes('type: keyvalue') && render.includes('classic-trip-cache'));

if (failures.length) {
  console.error(`\n${failures.length} performance architecture check(s) failed.`);
  process.exit(1);
}
console.log('\n✓ Performance architecture checks passed.');
