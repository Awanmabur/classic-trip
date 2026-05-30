const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { MONGO_URI } = require("../config/env");
const User = require("../models/user");
const Route = require("../models/route");
const Vehicle = require("../models/vehicle");
const Trip = require("../models/trip");

function seats(rows, cols) {
  const out = [];
  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) {
      out.push({ id: `${String.fromCharCode(64 + r)}${c}`, row: r, col: c, label: `${String.fromCharCode(64 + r)}${c}`, isAisle: false });
    }
  }
  return out;
}

function at(days, hour, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function addHours(date, hours, minutes = 0) {
  return new Date(date.getTime() + (hours * 60 + minutes) * 60000);
}

const images = {
  bus: "https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&w=1600&q=60",
  bus2: "https://images.unsplash.com/photo-1505852679233-d9fd70aff56d?auto=format&fit=crop&w=1600&q=60",
  hotel: "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=1600&q=60",
  hotel2: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1600&q=60",
  flight: "https://images.unsplash.com/photo-1529070538774-1843cb3265df?auto=format&fit=crop&w=1600&q=60",
  train: "https://images.unsplash.com/photo-1474487548417-781cb71495f3?auto=format&fit=crop&w=1600&q=60"
};

const data = [
  { type: "bus", title: "Kampala ⇄ Juba Executive Coach", description: "Direct coach service with AC, charging ports and instant ticket confirmation.", country: "Uganda", city: "Kampala", from: "Kampala", to: "Juba", currency: "UGX", price: 120000, start: at(1, 7, 30), dur: [10, 30], seats: [10, 4], vehicle: "Classic Express Bus 01", img: images.bus },
  { type: "bus", title: "Kampala ⇄ Nairobi Comfort Coach", description: "Comfortable cross-border bus for East African travellers.", country: "Uganda", city: "Kampala", from: "Kampala", to: "Nairobi", currency: "UGX", price: 155000, start: at(1, 18, 0), dur: [12, 0], seats: [12, 4], vehicle: "LakeLine Coach", img: images.bus2 },
  { type: "bus", title: "Juba ⇄ Nimule Border Shuttle", description: "Fast shuttle service for border movement. ID required.", country: "South Sudan", city: "Juba", from: "Juba", to: "Nimule", currency: "SSP", price: 18000, start: at(2, 6, 40), dur: [2, 20], seats: [8, 4], vehicle: "Nile Transit Shuttle", img: images.bus },
  { type: "hotel", title: "Kampala City View Hotel", description: "Central Kampala hotel with breakfast, Wi-Fi and flexible check-in.", country: "Uganda", city: "Kampala", address: "Kampala Road", stars: 4, currency: "UGX", price: 180000, start: at(1, 14, 0), dur: [22, 0], seats: [5, 4], vehicle: "City View Rooms", img: images.hotel },
  { type: "hotel", title: "Juba Nile Comfort Hotel", description: "Business-friendly hotel near the city centre with airport pickup options.", country: "South Sudan", city: "Juba", address: "Nile Street", stars: 4, currency: "USD", price: 65, start: at(1, 14, 0), dur: [22, 0], seats: [5, 4], vehicle: "Nile Comfort Rooms", img: images.hotel2 },
  { type: "flight", title: "EBB → JUB Direct Flight", description: "Direct regional flight from Entebbe to Juba with instant e-ticket.", country: "Uganda", city: "Entebbe", from: "Entebbe", to: "Juba", currency: "USD", price: 210, start: at(3, 9, 0), dur: [1, 35], seats: [15, 6], vehicle: "Classic Air CRJ", img: images.flight },
  { type: "flight", title: "NBO → EBB Morning Flight", description: "Morning connection from Nairobi to Entebbe with carry-on allowance.", country: "Kenya", city: "Nairobi", from: "Nairobi", to: "Entebbe", currency: "USD", price: 185, start: at(2, 8, 20), dur: [1, 20], seats: [15, 6], vehicle: "East Africa Air", img: images.flight },
  { type: "train", title: "Nairobi ⇄ Mombasa SGR", description: "Fast train between Nairobi and Mombasa with reserved seats.", country: "Kenya", city: "Nairobi", from: "Nairobi", to: "Mombasa", currency: "KES", price: 1500, start: at(2, 8, 0), dur: [5, 30], seats: [20, 5], vehicle: "SGR Express", img: images.train },
  { type: "train", title: "Kampala ⇄ Mukono Commuter Train", description: "Affordable rail commute with quick boarding and instant confirmation.", country: "Uganda", city: "Kampala", from: "Kampala", to: "Mukono", currency: "UGX", price: 5000, start: at(1, 17, 30), dur: [1, 0], seats: [12, 5], vehicle: "Kampala Commuter", img: images.train }
];

async function upsertUser({ name, email, role, referralCode }) {
  const passwordHash = await bcrypt.hash("Password123!", 10);
  return User.findOneAndUpdate(
    { email },
    { $set: { name, email, role, status: "active", passwordHash, referralCode } },
    { upsert: true, new: true }
  );
}

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB");

  const partner = await upsertUser({ name: "Classic Trip Company Admin", email: "company@classictrip.test", role: "company_admin" });
  const employee = await upsertUser({ name: "Classic Trip Employee", email: "employee@classictrip.test", role: "company_employee" });
  employee.companyId = partner._id;
  await employee.save();
  await upsertUser({ name: "Classic Customer", email: "customer@classictrip.test", role: "customer" });
  await upsertUser({ name: "Classic Promoter", email: "promoter@classictrip.test", role: "promoter", referralCode: "CT-PROMO3" });
  await upsertUser({ name: "Classic Super Admin", email: "super@classictrip.test", role: "super_admin" });
  await upsertUser({ name: "Classic Admin", email: "admin@classictrip.test", role: "admin" });

  for (const item of data) {
    const route = await Route.findOneAndUpdate(
      { title: item.title },
      { $set: {
        ownerId: partner._id,
        type: item.type,
        title: item.title,
        description: item.description,
        country: item.country,
        city: item.city,
        from: item.from || "",
        to: item.to || "",
        address: item.address || "",
        stars: item.stars || 0,
        amenities: item.type === "hotel" ? ["Wi-Fi", "Breakfast", "Parking"] : [],
        policy: "Instant confirmation • Guest checkout allowed",
        currency: item.currency,
        isActive: true,
        images: [{ url: item.img, publicId: `seed-${item.type}` }],
        ratingAvg: 4.7,
        ratingCount: 24
      } },
      { upsert: true, new: true }
    );

    const [rows, cols] = item.seats;
    const seatList = seats(rows, cols);
    const vehicle = await Vehicle.findOneAndUpdate(
      { ownerId: partner._id, name: item.vehicle },
      { $set: {
        ownerId: partner._id,
        type: item.type,
        name: item.vehicle,
        plateOrCode: item.vehicle.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 18),
        layoutName: `${cols} cols`,
        rows,
        cols,
        seats: seatList,
        totalSeats: seatList.length,
        images: [{ url: item.img, publicId: `seed-vehicle-${item.type}` }]
      } },
      { upsert: true, new: true }
    );

    const departureAt = item.start;
    const arriveAt = addHours(departureAt, item.dur[0], item.dur[1]);
    await Trip.findOneAndUpdate(
      { routeId: route._id, vehicleId: vehicle._id, departureAt },
      { $set: {
        ownerId: partner._id,
        routeId: route._id,
        vehicleId: vehicle._id,
        departureAt,
        arriveAt,
        basePrice: item.price,
        currency: item.currency,
        totalSeats: vehicle.totalSeats,
        status: "scheduled"
      }, $setOnInsert: { bookedSeats: 0, heldSeats: 0 } },
      { upsert: true, new: true }
    );
  }

  console.log("Seed complete.");
  console.log("Company admin login: company@classictrip.test / Password123!");
  console.log("Employee login: employee@classictrip.test / Password123!");
  console.log("Customer login: customer@classictrip.test / Password123!");
  console.log("Promoter login: promoter@classictrip.test / Password123!");
  console.log("Super admin login: super@classictrip.test / Password123!");
  console.log("Promoter referral code: CT-PROMO3");
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
