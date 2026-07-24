'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

test('runtime repositories are MongoDB-only', () => {
  const runtime = walk(path.join(root, 'src')).filter((file) => file.endsWith('.js'));
  for (const file of runtime) {
    const source = fs.readFileSync(file, 'utf8');
    expect(source).not.toMatch(/require\([^)]*memoryDatabase/);
    expect(source).not.toMatch(/require\([^)]*persistentStore/);
    expect(source).not.toContain('HybridCollection');
    expect(source).not.toMatch(/mirrorSave|mirrorMany|mirrorPosition/);
  }
});

test('Mongo collection fails closed when the database is unavailable', () => {
  const source = read('src/repositories/domain/mongoCollection.js');
  expect(source).toContain('assertReady()');
  expect(source).toContain("MongoDB is unavailable");
  expect(source).not.toContain('fallback');
});

test('room and seat holds have no process-memory arrays', () => {
  const rooms = read('src/services/booking/roomReservationService.js');
  const seats = read('src/services/booking/seatLockService.js');
  expect(rooms).not.toMatch(/reservations\s*=\s*\[\]/);
  expect(rooms).toMatch(/inventoryHoldService/);
  expect(seats).toMatch(/InventoryHold|inventoryHoldService/);
});

test('media storage fails closed instead of returning fake URLs', () => {
  const source = read('src/services/media/cloudinaryService.js');
  expect(source).toContain('MEDIA_PROVIDER_NOT_CONFIGURED');
  expect(source).not.toMatch(/classic-trip-dev|devAsset|fallback:\s*true/);
});
