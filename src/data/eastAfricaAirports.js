'use strict';

const { connectDb, mongoose } = require('../config/db');
const Airport = require('../models/Airport');

const EAST_AFRICA_AIRPORTS = Object.freeze([
  { id:'airport-ebb', iataCode:'EBB', icaoCode:'HUEN', name:'Entebbe International Airport', city:'Entebbe', country:'Uganda', timezone:'Africa/Kampala', latitude:0.0424, longitude:32.4435 },
  { id:'airport-nbo', iataCode:'NBO', icaoCode:'HKJK', name:'Jomo Kenyatta International Airport', city:'Nairobi', country:'Kenya', timezone:'Africa/Nairobi', latitude:-1.3192, longitude:36.9278 },
  { id:'airport-wil', iataCode:'WIL', icaoCode:'HKNW', name:'Wilson Airport', city:'Nairobi', country:'Kenya', timezone:'Africa/Nairobi', latitude:-1.3217, longitude:36.8148 },
  { id:'airport-mba', iataCode:'MBA', icaoCode:'HKMO', name:'Moi International Airport', city:'Mombasa', country:'Kenya', timezone:'Africa/Nairobi', latitude:-4.0348, longitude:39.5942 },
  { id:'airport-kis', iataCode:'KIS', icaoCode:'HKKI', name:'Kisumu International Airport', city:'Kisumu', country:'Kenya', timezone:'Africa/Nairobi', latitude:-0.0861, longitude:34.7289 },
  { id:'airport-kgl', iataCode:'KGL', icaoCode:'HRYR', name:'Kigali International Airport', city:'Kigali', country:'Rwanda', timezone:'Africa/Kigali', latitude:-1.9686, longitude:30.1395 },
  { id:'airport-dar', iataCode:'DAR', icaoCode:'HTDA', name:'Julius Nyerere International Airport', city:'Dar es Salaam', country:'Tanzania', timezone:'Africa/Dar_es_Salaam', latitude:-6.8781, longitude:39.2026 },
  { id:'airport-jro', iataCode:'JRO', icaoCode:'HTKJ', name:'Kilimanjaro International Airport', city:'Kilimanjaro', country:'Tanzania', timezone:'Africa/Dar_es_Salaam', latitude:-3.4294, longitude:37.0745 },
  { id:'airport-znz', iataCode:'ZNZ', icaoCode:'HTZA', name:'Abeid Amani Karume International Airport', city:'Zanzibar', country:'Tanzania', timezone:'Africa/Dar_es_Salaam', latitude:-6.2220, longitude:39.2249 },
  { id:'airport-mwz', iataCode:'MWZ', icaoCode:'HTMW', name:'Mwanza Airport', city:'Mwanza', country:'Tanzania', timezone:'Africa/Dar_es_Salaam', latitude:-2.4445, longitude:32.9327 },
  { id:'airport-jub', iataCode:'JUB', icaoCode:'HSSJ', name:'Juba International Airport', city:'Juba', country:'South Sudan', timezone:'Africa/Juba', latitude:4.8720, longitude:31.6011 },
  { id:'airport-bjm', iataCode:'BJM', icaoCode:'HBBA', name:'Melchior Ndadaye International Airport', city:'Bujumbura', country:'Burundi', timezone:'Africa/Bujumbura', latitude:-3.3240, longitude:29.3185 },
  { id:'airport-gom', iataCode:'GOM', icaoCode:'FZNA', name:'Goma International Airport', city:'Goma', country:'DR Congo', timezone:'Africa/Lubumbashi', latitude:-1.6708, longitude:29.2385 },
  { id:'airport-fih', iataCode:'FIH', icaoCode:'FZAA', name:"N'djili International Airport", city:'Kinshasa', country:'DR Congo', timezone:'Africa/Kinshasa', latitude:-4.3858, longitude:15.4446 },
  { id:'airport-mgq', iataCode:'MGQ', icaoCode:'HCMM', name:'Aden Adde International Airport', city:'Mogadishu', country:'Somalia', timezone:'Africa/Mogadishu', latitude:2.0144, longitude:45.3047 },
]);

async function bootstrapEastAfricaAirports({ connect = true, disconnect = true } = {}) {
  if (connect && mongoose.connection.readyState !== 1) await connectDb();
  const operations = EAST_AFRICA_AIRPORTS.map((airport) => ({
    updateOne: {
      filter: { iataCode: airport.iataCode },
      update: { $set: { ...airport, status: 'active', updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      upsert: true,
    },
  }));
  const result = operations.length ? await Airport.bulkWrite(operations, { ordered: false }) : null;
  const summary = {
    airports: EAST_AFRICA_AIRPORTS.length,
    matched: Number(result?.matchedCount || 0),
    modified: Number(result?.modifiedCount || 0),
    inserted: Number(result?.upsertedCount || 0),
  };
  if (disconnect && mongoose.connection.readyState !== 0) await mongoose.disconnect();
  return summary;
}

if (require.main === module) {
  require('dotenv').config();
  bootstrapEastAfricaAirports()
    .then((summary) => console.log(JSON.stringify(summary, null, 2)))
    .catch(async (error) => {
      console.error(error.message || error);
      if (mongoose.connection.readyState !== 0) await mongoose.disconnect().catch(() => {});
      process.exitCode = 1;
    });
}

module.exports = { EAST_AFRICA_AIRPORTS, bootstrapEastAfricaAirports };
