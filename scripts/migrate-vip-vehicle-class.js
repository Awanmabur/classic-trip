'use strict';

require('dotenv').config();
const { connectDb, mongoose } = require('../src/config/db');
const Vehicle = require('../src/models/Vehicle');
const SeatMapTemplate = require('../src/models/SeatMapTemplate');
const SeatMapVersion = require('../src/models/SeatMapVersion');
const { seatMapChecksum } = require('../src/modules/bus/domain/busDomain');
const { compatibilitySeats } = require('../src/modules/bus/services/busSetupService');

const apply = process.argv.includes('--apply');
const limitArg = process.argv.find((value) => value.startsWith('--limit='));
const limit = limitArg ? Math.max(1, Number(limitArg.split('=')[1]) || 5000) : 5000;

function normalize(value) { return String(value || '').trim().toLowerCase(); }
function inferredClass(vehicle = {}, versions = []) {
  if (normalize(vehicle.vehicleClass) === 'vip' || normalize(vehicle.defaultSeatClass) === 'vip') return 'vip';
  if (versions.some((version) => normalize(version.vehicleClass) === 'vip')) return 'vip';
  const versionSeats = versions.flatMap((version) => Array.isArray(version.seats) ? version.seats : []);
  const legacySeats = Array.isArray(vehicle.seatTemplate) ? vehicle.seatTemplate : [];
  return [...versionSeats, ...legacySeats].some((seat) => normalize(seat.seatClass || seat.seatType) === 'vip') ? 'vip' : 'standard';
}
function normalizeVersion(version = {}, vehicleClass = 'standard') {
  const targetClass = vehicleClass === 'vip' ? 'VIP' : 'Standard';
  const seats = (version.seats || []).map((seat) => {
    const crew = normalize(seat.seatType) === 'crew' || normalize(seat.seatClass) === 'crew';
    return {
      ...seat,
      seatClass: crew ? 'Crew' : targetClass,
      priceDelta: 0,
    };
  });
  const normalized = { ...version, vehicleClass, seats };
  normalized.checksum = seatMapChecksum(normalized);
  return normalized;
}

async function main() {
  await connectDb();
  const vehicles = await Vehicle.find({ serviceType: 'bus' }).sort({ createdAt: 1 }).limit(limit).lean();
  const summary = { mode: apply ? 'apply' : 'dry-run', vehiclesScanned: vehicles.length, vehiclesChanged: 0, versionsChanged: 0, templatesChanged: 0, vipVehicles: 0, standardVehicles: 0 };
  for (const vehicle of vehicles) {
    const versions = await SeatMapVersion.find({ companyId: vehicle.companyId, vehicleId: vehicle.id }).sort({ version: 1 }).lean();
    const template = await SeatMapTemplate.findOne({ companyId: vehicle.companyId, vehicleId: vehicle.id }).lean();
    const vehicleClass = inferredClass(vehicle, versions);
    if (vehicleClass === 'vip') summary.vipVehicles += 1; else summary.standardVehicles += 1;
    const normalizedVersions = versions.map((version) => normalizeVersion(version, vehicleClass));
    const versionChanges = normalizedVersions.filter((version, index) => JSON.stringify({ vehicleClass: versions[index].vehicleClass, seats: versions[index].seats, checksum: versions[index].checksum }) !== JSON.stringify({ vehicleClass: version.vehicleClass, seats: version.seats, checksum: version.checksum }));
    const activeVersion = normalizedVersions.find((version) => String(version.id) === String(vehicle.activeSeatMapVersionId))
      || normalizedVersions.filter((version) => version.status === 'published').sort((a, b) => Number(b.version || 0) - Number(a.version || 0))[0]
      || normalizedVersions[normalizedVersions.length - 1];
    const projectedSeats = activeVersion ? compatibilitySeats(activeVersion) : (vehicle.seatTemplate || []).map((seat) => ({ ...seat, seatType: vehicleClass === 'vip' ? 'vip' : seat.isDisabled ? 'disabled' : 'standard', seatClass: seat.isDisabled ? 'Disabled' : vehicleClass === 'vip' ? 'VIP' : 'Standard', priceDelta: 0 }));
    const vehicleChanged = normalize(vehicle.vehicleClass) !== vehicleClass
      || normalize(vehicle.defaultSeatClass) !== vehicleClass
      || Number(vehicle.vipPriceDelta || 0) !== 0
      || JSON.stringify(vehicle.seatTemplate || []) !== JSON.stringify(projectedSeats);
    if (vehicleChanged) summary.vehiclesChanged += 1;
    summary.versionsChanged += versionChanges.length;
    if (template && (normalize(template.vehicleClass) !== vehicleClass)) summary.templatesChanged += 1;
    if (!apply) continue;
    for (const version of versionChanges) {
      await SeatMapVersion.updateOne({ companyId: vehicle.companyId, id: version.id }, { $set: { vehicleClass: version.vehicleClass, seats: version.seats, checksum: version.checksum, updatedAt: new Date() } });
    }
    if (template) await SeatMapTemplate.updateOne({ companyId: vehicle.companyId, id: template.id }, { $set: { vehicleClass, updatedAt: new Date() } });
    await Vehicle.updateOne({ companyId: vehicle.companyId, id: vehicle.id }, { $set: { vehicleClass, defaultSeatClass: vehicleClass === 'vip' ? 'VIP' : 'Standard', vipPriceDelta: 0, seatTemplate: projectedSeats, updatedAt: new Date() } });
  }
  console.log(JSON.stringify(summary, null, 2));
  if (!apply && (summary.vehiclesChanged || summary.versionsChanged || summary.templatesChanged)) console.log('Dry run only. Back up the database, then rerun with --apply.');
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
}).finally(async () => {
  await mongoose.disconnect().catch(() => {});
});
