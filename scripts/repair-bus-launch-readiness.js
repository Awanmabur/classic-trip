#!/usr/bin/env node
'use strict';

require('dotenv').config();
const { connectDb, mongoose } = require('../src/config/db');
const Listing = require('../src/models/Listing');
const TripSchedule = require('../src/models/TripSchedule');
const busDepartureService = require('../src/modules/bus/services/busDepartureService');
const busSetupService = require('../src/modules/bus/services/busSetupService');

function normalize(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function repairableFailures(result = {}) {
  return (result.failures || []).filter((failure) => ['published_seat_map_missing', 'seat_segment_inventory_missing'].includes(failure));
}

async function main() {
  process.env.CLASSIC_TRIP_PROCESS_ROLE = process.env.CLASSIC_TRIP_PROCESS_ROLE || 'bus-launch-repair';
  await connectDb();
  const now = new Date();
  const listings = await Listing.find({ serviceType: 'bus', status: { $ne: 'archived' } }).lean();
  const summary = {
    repairedAt: new Date().toISOString(),
    listingsConsidered: listings.length,
    schedulesConsidered: 0,
    inventoryRepairs: 0,
    legacyActivePublished: 0,
    alreadyValidPublished: 0,
    manualReview: [],
    listingReadiness: [],
  };

  for (const listing of listings) {
    const schedules = await TripSchedule.find({
      companyId: listing.companyId,
      listingId: listing.id,
      departAt: { $gt: now },
      status: { $in: ['draft', 'active', 'published'] },
    }).sort({ departAt: 1 }).limit(60).lean();
    summary.schedulesConsidered += schedules.length;

    for (const raw of schedules) {
      let schedule = raw;
      let validation = await busDepartureService.validateSchedulePublish(listing.companyId, schedule);
      const repairable = repairableFailures(validation);
      if (repairable.length) {
        try {
          await busDepartureService.repairScheduleInventory(listing.companyId, schedule.id, 'bus-launch-repair');
          summary.inventoryRepairs += 1;
          schedule = await TripSchedule.findOne({ companyId: listing.companyId, id: schedule.id }).lean();
          validation = await busDepartureService.validateSchedulePublish(listing.companyId, schedule);
        } catch (error) {
          summary.manualReview.push({ listingId: listing.id, scheduleId: schedule.id, status: schedule.status, reason: error.message });
          continue;
        }
      }

      if (normalize(schedule.status) === 'active') {
        try {
          await busDepartureService.publishSchedule(listing.companyId, schedule.id, 'bus-launch-repair');
          summary.legacyActivePublished += 1;
          continue;
        } catch (error) {
          summary.manualReview.push({ listingId: listing.id, scheduleId: schedule.id, status: schedule.status, reason: error.message });
          continue;
        }
      }

      if (normalize(schedule.status) === 'published') {
        if (validation.publishable) summary.alreadyValidPublished += 1;
        else summary.manualReview.push({ listingId: listing.id, scheduleId: schedule.id, status: schedule.status, reason: (validation.failures || []).join('; ') || 'Published departure needs manual review' });
      }
    }

    const readiness = await busSetupService.listingReadiness(listing.companyId, listing.id);
    summary.listingReadiness.push({
      companyId: listing.companyId,
      listingId: listing.id,
      title: listing.title,
      publicReady: readiness.publicReady,
      bookingReady: readiness.bookingReady,
      failures: readiness.failures,
    });
  }

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error('Bus launch-readiness repair failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
