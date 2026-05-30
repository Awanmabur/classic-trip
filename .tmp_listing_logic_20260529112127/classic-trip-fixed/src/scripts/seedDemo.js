const mongoose = require("mongoose");

const { connectDB } = require("../config/db");
const Route = require("../models/route");
const Trip = require("../models/trip");
const User = require("../models/user");
const Vehicle = require("../models/vehicle");
const { getPlatformUser } = require("../services/platform");
const { getOrCreateWallet } = require("../services/wallet");
const { generateBusLayout } = require("../controllers/seatLayout");
const { hashPassword } = require("../utils/password");

const DEMO_PASSWORD = "DemoPass123!";
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function futureAt(daysFromNow, hour, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function plusHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function makeSeatId(row, position) {
  return `${row}${LETTERS[position] || `S${position + 1}`}`;
}

function makeAisleLayout({ rows, leftSeats, rightSeats }) {
  const seats = [];
  const cols = leftSeats + rightSeats + 1;

  for (let row = 1; row <= rows; row += 1) {
    for (let col = 1; col <= leftSeats; col += 1) {
      const id = makeSeatId(row, col - 1);
      seats.push({ id, label: id, row, col, isAisle: false, isDisabled: false });
    }

    seats.push({
      id: `AISLE-${row}`,
      label: "",
      row,
      col: leftSeats + 1,
      isAisle: true,
      isDisabled: true
    });

    for (let col = 1; col <= rightSeats; col += 1) {
      const absoluteCol = leftSeats + 1 + col;
      const id = makeSeatId(row, leftSeats + col - 1);
      seats.push({ id, label: id, row, col: absoluteCol, isAisle: false, isDisabled: false });
    }
  }

  return {
    cols,
    seats,
    totalSeats: seats.filter((seat) => !seat.isAisle && !seat.isDisabled).length
  };
}

function makeRoomLayout({ rows, cols }) {
  const seats = [];
  let roomNumber = 101;

  for (let row = 1; row <= rows; row += 1) {
    for (let col = 1; col <= cols; col += 1) {
      const id = `RM${roomNumber}`;
      seats.push({
        id,
        label: `Room ${roomNumber}`,
        row,
        col,
        isAisle: false,
        isDisabled: false
      });
      roomNumber += 1;
    }
  }

  return { cols, seats, totalSeats: seats.length };
}

async function upsertUser({ name, email, role, phone = "", referralCode = "", companyId = null }) {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const update = {
    name,
    email: String(email).toLowerCase().trim(),
    phone,
    role,
    companyId,
    status: "active",
    passwordHash
  };

  if (referralCode) {
    update.referralCode = referralCode;
  }

  return User.findOneAndUpdate(
    { email: update.email },
    { $set: update },
    { returnDocument: "after", upsert: true, setDefaultsOnInsert: true }
  );
}

async function upsertRoute(query, payload) {
  return Route.findOneAndUpdate(
    query,
    { $set: payload },
    { returnDocument: "after", upsert: true, setDefaultsOnInsert: true }
  );
}

async function upsertVehicle(query, payload) {
  return Vehicle.findOneAndUpdate(
    query,
    { $set: payload },
    { returnDocument: "after", upsert: true, setDefaultsOnInsert: true }
  );
}

async function upsertTrip(query, payload) {
  return Trip.findOneAndUpdate(
    query,
    { $set: payload },
    { returnDocument: "after", upsert: true, setDefaultsOnInsert: true }
  );
}

async function seed() {
  await connectDB();

  const platform = await getPlatformUser();
  const superAdmin = await upsertUser({
    name: "Classic Trip Super Admin",
    email: "super@classictrip.demo",
    role: "super_admin",
    phone: "+256700111999"
  });

  const promoter = await upsertUser({
    name: "Amina Promoter",
    email: "promoter@classictrip.demo",
    role: "promoter",
    phone: "+256700111000",
    referralCode: "CT-AMINA3"
  });

  const customer = await upsertUser({
    name: "Moses Customer",
    email: "customer@classictrip.demo",
    role: "customer",
    phone: "+256700111010"
  });

  const busPartner = await upsertUser({
    name: "Kampala Coaches",
    email: "bus@classictrip.demo",
    role: "company_admin",
    phone: "+256700111101"
  });

  const trainPartner = await upsertUser({
    name: "Great Lakes Rail",
    email: "train@classictrip.demo",
    role: "company_admin",
    phone: "+256700111202"
  });

  const flightPartner = await upsertUser({
    name: "East Africa Air",
    email: "flight@classictrip.demo",
    role: "company_admin",
    phone: "+256700111303"
  });

  const hotelPartner = await upsertUser({
    name: "Classic Heights Stays",
    email: "hotel@classictrip.demo",
    role: "company_admin",
    phone: "+256700111404"
  });

  const employee = await upsertUser({
    name: "Grace Operations",
    email: "employee@classictrip.demo",
    role: "company_employee",
    phone: "+256700111505",
    companyId: busPartner._id
  });

  await Promise.all([
    getOrCreateWallet(platform._id, "UGX"),
    getOrCreateWallet(superAdmin._id, "UGX"),
    getOrCreateWallet(promoter._id, "UGX"),
    getOrCreateWallet(customer._id, "UGX"),
    getOrCreateWallet(busPartner._id, "UGX"),
    getOrCreateWallet(trainPartner._id, "UGX"),
    getOrCreateWallet(flightPartner._id, "UGX"),
    getOrCreateWallet(hotelPartner._id, "UGX"),
    getOrCreateWallet(employee._id, "UGX")
  ]);

  const busRoute = await upsertRoute(
    { ownerId: busPartner._id, type: "bus", title: "Kampala to Jinja Express" },
    {
      ownerId: busPartner._id,
      type: "bus",
      title: "Kampala to Jinja Express",
      description: "Fast intercity bus departures with direct boarding and luggage support.",
      country: "Uganda",
      city: "Kampala",
      from: "Kampala",
      to: "Jinja",
      currency: "UGX",
      isActive: true
    }
  );

  const trainRoute = await upsertRoute(
    { ownerId: trainPartner._id, type: "train", title: "Kampala to Nairobi Rail" },
    {
      ownerId: trainPartner._id,
      type: "train",
      title: "Kampala to Nairobi Rail",
      description: "Long-distance rail inventory for regional travelers and cargo-light passengers.",
      country: "Uganda",
      city: "Kampala",
      from: "Kampala",
      to: "Nairobi",
      currency: "UGX",
      isActive: true
    }
  );

  const flightRoute = await upsertRoute(
    { ownerId: flightPartner._id, type: "flight", title: "Entebbe to Kigali Air" },
    {
      ownerId: flightPartner._id,
      type: "flight",
      title: "Entebbe to Kigali Air",
      description: "Regional air inventory with morning and afternoon departures.",
      country: "Uganda",
      city: "Entebbe",
      from: "Entebbe",
      to: "Kigali",
      currency: "UGX",
      isActive: true
    }
  );

  const hotelRoute = await upsertRoute(
    { ownerId: hotelPartner._id, type: "hotel", title: "Classic Heights Hotel Kampala" },
    {
      ownerId: hotelPartner._id,
      type: "hotel",
      title: "Classic Heights Hotel Kampala",
      description: "City-center stay inventory with breakfast, airport transfer, and fast guest checkout.",
      country: "Uganda",
      city: "Kampala",
      address: "Plot 14 Nakasero Hill, Kampala",
      stars: 4,
      amenities: ["Breakfast", "Airport transfer", "Wi-Fi", "Pool"],
      policy: "Flexible cancellation up to 24 hours before check-in.",
      currency: "UGX",
      isActive: true
    }
  );

  const busLayout = generateBusLayout({ rows: 12, config: "2x2" });
  const trainLayout = makeAisleLayout({ rows: 8, leftSeats: 2, rightSeats: 3 });
  const flightLayout = makeAisleLayout({ rows: 6, leftSeats: 2, rightSeats: 2 });
  const hotelLayout = makeRoomLayout({ rows: 3, cols: 4 });

  const busVehicle = await upsertVehicle(
    { ownerId: busPartner._id, type: "bus", name: "Classic Bus 001" },
    {
      ownerId: busPartner._id,
      type: "bus",
      name: "Classic Bus 001",
      plateOrCode: "UBA 210B",
      layoutName: "2x2",
      rows: 12,
      cols: busLayout.cols,
      seats: busLayout.seats,
      totalSeats: busLayout.totalSeats
    }
  );

  const trainVehicle = await upsertVehicle(
    { ownerId: trainPartner._id, type: "train", name: "Rail Coach GLR-1" },
    {
      ownerId: trainPartner._id,
      type: "train",
      name: "Rail Coach GLR-1",
      plateOrCode: "GLR-1",
      layoutName: "custom",
      rows: 8,
      cols: trainLayout.cols,
      seats: trainLayout.seats,
      totalSeats: trainLayout.totalSeats
    }
  );

  const flightVehicle = await upsertVehicle(
    { ownerId: flightPartner._id, type: "flight", name: "EA Air 737 Demo" },
    {
      ownerId: flightPartner._id,
      type: "flight",
      name: "EA Air 737 Demo",
      plateOrCode: "5X-CT1",
      layoutName: "custom",
      rows: 6,
      cols: flightLayout.cols,
      seats: flightLayout.seats,
      totalSeats: flightLayout.totalSeats
    }
  );

  const hotelVehicle = await upsertVehicle(
    { ownerId: hotelPartner._id, type: "hotel", name: "Classic Heights Rooms" },
    {
      ownerId: hotelPartner._id,
      type: "hotel",
      name: "Classic Heights Rooms",
      plateOrCode: "CH-ROOMS",
      layoutName: "custom",
      rows: 3,
      cols: hotelLayout.cols,
      seats: hotelLayout.seats,
      totalSeats: hotelLayout.totalSeats
    }
  );

  const busDeparture = futureAt(1, 7, 30);
  const trainDeparture = futureAt(2, 6, 0);
  const flightDeparture = futureAt(1, 15, 45);
  const hotelAvailability = futureAt(1, 14, 0);

  await upsertTrip(
    { vehicleId: busVehicle._id, departureAt: busDeparture },
    {
      ownerId: busPartner._id,
      routeId: busRoute._id,
      vehicleId: busVehicle._id,
      departureAt: busDeparture,
      arriveAt: plusHours(busDeparture, 2.5),
      basePrice: 25000,
      currency: "UGX",
      totalSeats: busVehicle.totalSeats,
      bookedSeats: 0,
      heldSeats: 0,
      status: "scheduled"
    }
  );

  await upsertTrip(
    { vehicleId: trainVehicle._id, departureAt: trainDeparture },
    {
      ownerId: trainPartner._id,
      routeId: trainRoute._id,
      vehicleId: trainVehicle._id,
      departureAt: trainDeparture,
      arriveAt: plusHours(trainDeparture, 12),
      basePrice: 90000,
      currency: "UGX",
      totalSeats: trainVehicle.totalSeats,
      bookedSeats: 0,
      heldSeats: 0,
      status: "scheduled"
    }
  );

  await upsertTrip(
    { vehicleId: flightVehicle._id, departureAt: flightDeparture },
    {
      ownerId: flightPartner._id,
      routeId: flightRoute._id,
      vehicleId: flightVehicle._id,
      departureAt: flightDeparture,
      arriveAt: plusHours(flightDeparture, 1.25),
      basePrice: 380000,
      currency: "UGX",
      totalSeats: flightVehicle.totalSeats,
      bookedSeats: 0,
      heldSeats: 0,
      status: "scheduled"
    }
  );

  await upsertTrip(
    { vehicleId: hotelVehicle._id, departureAt: hotelAvailability },
    {
      ownerId: hotelPartner._id,
      routeId: hotelRoute._id,
      vehicleId: hotelVehicle._id,
      departureAt: hotelAvailability,
      arriveAt: plusHours(hotelAvailability, 21),
      basePrice: 180000,
      currency: "UGX",
      totalSeats: hotelVehicle.totalSeats,
      bookedSeats: 0,
      heldSeats: 0,
      status: "scheduled"
    }
  );

  console.log("Demo marketplace seeded.");
  console.log(`Promoter referral code: ${promoter.referralCode}`);
  console.log("Demo login password for seeded accounts: DemoPass123!");
  console.log("Seeded dashboard logins:");
  console.log(" - super@classictrip.demo (super admin)");
  console.log(" - bus@classictrip.demo (company admin)");
  console.log(" - employee@classictrip.demo (company employee)");
  console.log(" - customer@classictrip.demo (customer)");
  console.log(" - promoter@classictrip.demo (promoter)");
  console.log("Additional company admins:");
  console.log(" - train@classictrip.demo");
  console.log(" - flight@classictrip.demo");
  console.log(" - hotel@classictrip.demo");
}

seed()
  .catch((err) => {
    console.error("Failed to seed demo marketplace.");
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
