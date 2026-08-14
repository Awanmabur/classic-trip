'use strict';

const { connectDb, mongoose } = require('../src/config/db');
const { env } = require('../src/config/env');
const sensitiveFieldService = require('../src/services/security/sensitiveFieldService');
const Booking = require('../src/models/Booking');
const Passenger = require('../src/models/Passenger');
const HotelGuest = require('../src/models/HotelGuest');

const apply = process.argv.includes('--apply');

function clean(value) { return String(value || '').trim(); }
function isCiphertext(value) { return /^v[12]\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(clean(value)); }

function protectedFields(value, context) {
  const text = clean(value);
  if (!text) return { encrypted: '', last4: '' };
  if (isCiphertext(text)) return { encrypted: text, last4: '' };
  return {
    encrypted: apply ? sensitiveFieldService.encrypt(text, context) : '[encrypted-on-apply]',
    last4: sensitiveFieldService.last4(text),
  };
}

function passengerContext(serviceType = '') {
  if (serviceType === 'bus') return 'bus-passenger-identity';
  if (serviceType === 'hotel') return 'hotel-guest-identity';
  return 'booking-passenger-identity';
}

async function migrateFlatCollection(Model, context, stats, label) {
  const cursor = Model.collection.find(
    { identityNumber: { $exists: true, $type: 'string', $ne: '' } },
    { projection: { identityNumber: 1, identityNumberEncrypted: 1, identityNumberLast4: 1 } }
  );
  for await (const row of cursor) {
    const legacy = clean(row.identityNumber);
    if (!legacy) continue;
    const protectedValue = protectedFields(legacy, context);
    stats[`${label}Documents`] += 1;
    if (!apply) continue;
    await Model.collection.updateOne(
      { _id: row._id },
      {
        $set: {
          identityNumberEncrypted: clean(row.identityNumberEncrypted) || protectedValue.encrypted,
          identityNumberLast4: clean(row.identityNumberLast4) || protectedValue.last4 || sensitiveFieldService.last4(legacy),
        },
        $unset: { identityNumber: '' },
      }
    );
  }
}

function migrateIdentityObject(value, context, stats, counterPrefix) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { value, changed: false };
  const next = { ...value };
  const legacy = clean(next.identityNumber || next.documentNumber);
  if (!legacy) return { value: next, changed: false };
  const protectedValue = protectedFields(legacy, context);
  next.identityNumberEncrypted = clean(next.identityNumberEncrypted || next.documentNumberEncrypted) || protectedValue.encrypted;
  next.identityNumberLast4 = clean(next.identityNumberLast4 || next.documentNumberLast4) || protectedValue.last4 || sensitiveFieldService.last4(legacy);
  delete next.identityNumber;
  delete next.documentNumber;
  stats[counterPrefix] += 1;
  return { value: next, changed: true };
}

async function migrateBookingSnapshots(stats) {
  const cursor = Booking.collection.find({
    $or: [
      { 'passengers.identityNumber': { $exists: true, $ne: '' } },
      { 'passengers.documentNumber': { $exists: true, $ne: '' } },
      { 'buyerSnapshot.documentNumber': { $exists: true, $ne: '' } },
      { 'buyerSnapshot.identityNumber': { $exists: true, $ne: '' } },
      { 'guestSnapshot.identityNumber': { $exists: true, $ne: '' } },
      { 'guestSnapshot.documentNumber': { $exists: true, $ne: '' } },
    ],
  }, {
    projection: { serviceType: 1, passengers: 1, buyerSnapshot: 1, guestSnapshot: 1 },
  });

  for await (const booking of cursor) {
    let changed = false;
    const set = {};
    const serviceType = clean(booking.serviceType).toLowerCase();
    const context = passengerContext(serviceType);

    if (Array.isArray(booking.passengers)) {
      const passengers = booking.passengers.map((passenger) => {
        const migrated = migrateIdentityObject(passenger, context, stats, 'bookingPassengerSnapshots');
        changed = changed || migrated.changed;
        return migrated.value;
      });
      if (changed) set.passengers = passengers;
    }

    const buyer = migrateIdentityObject(booking.buyerSnapshot, 'booking-buyer-document', stats, 'bookingBuyerSnapshots');
    if (buyer.changed) { set.buyerSnapshot = buyer.value; changed = true; }

    const guest = migrateIdentityObject(booking.guestSnapshot, serviceType === 'hotel' ? 'hotel-guest-identity' : context, stats, 'bookingGuestSnapshots');
    if (guest.changed) { set.guestSnapshot = guest.value; changed = true; }

    if (!changed) continue;
    stats.bookingDocuments += 1;
    if (apply) await Booking.collection.updateOne({ _id: booking._id }, { $set: set });
  }
}

async function verifyNoPlaintext() {
  const [passengers, hotelGuests, bookings] = await Promise.all([
    Passenger.collection.countDocuments({ identityNumber: { $exists: true, $type: 'string', $ne: '' } }),
    HotelGuest.collection.countDocuments({ identityNumber: { $exists: true, $type: 'string', $ne: '' } }),
    Booking.collection.countDocuments({
      $or: [
        { 'passengers.identityNumber': { $exists: true, $ne: '' } },
        { 'passengers.documentNumber': { $exists: true, $ne: '' } },
        { 'buyerSnapshot.documentNumber': { $exists: true, $ne: '' } },
        { 'buyerSnapshot.identityNumber': { $exists: true, $ne: '' } },
        { 'guestSnapshot.identityNumber': { $exists: true, $ne: '' } },
        { 'guestSnapshot.documentNumber': { $exists: true, $ne: '' } },
      ],
    }),
  ]);
  return { passengers, hotelGuests, bookings, total: passengers + hotelGuests + bookings };
}

async function main() {
  if (apply && !clean(process.env.DATA_ENCRYPTION_KEY)) {
    throw new Error('DATA_ENCRYPTION_KEY must be explicitly set before applying the identity encryption migration. Use the same stable key in every web/worker process.');
  }
  await connectDb();
  const stats = {
    mode: apply ? 'apply' : 'dry-run',
    database: mongoose.connection.name,
    passengerDocuments: 0,
    hotelGuestDocuments: 0,
    bookingDocuments: 0,
    bookingPassengerSnapshots: 0,
    bookingBuyerSnapshots: 0,
    bookingGuestSnapshots: 0,
  };

  await migrateFlatCollection(Passenger, 'bus-passenger-identity', stats, 'passenger');
  await migrateFlatCollection(HotelGuest, 'hotel-guest-identity', stats, 'hotelGuest');
  await migrateBookingSnapshots(stats);
  const remainingPlaintext = await verifyNoPlaintext();

  console.log(JSON.stringify({ ...stats, remainingPlaintext }, null, 2));
  if (apply && remainingPlaintext.total > 0) {
    throw new Error(`Sensitive identity migration left ${remainingPlaintext.total} record group(s) with plaintext identity data`);
  }
  if (!apply) console.log('Dry run only. Set the production DATA_ENCRYPTION_KEY and rerun with --apply to encrypt/unset legacy plaintext identity values.');
  else console.log('✓ Sensitive identity migration completed and plaintext identity fields were removed.');
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await mongoose.disconnect().catch(() => {}); });
