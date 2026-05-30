const mongoose = require("mongoose");
const { NODE_ENV, PLATFORM_MONGO_URI } = require("../app");

const platformConnection = mongoose.connection;

async function connectPlatformDb() {
  if (platformConnection.readyState === 1) return platformConnection;

  mongoose.set("strictQuery", true);
  await mongoose.connect(PLATFORM_MONGO_URI, {
    autoIndex: NODE_ENV !== "production",
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 10000
  });

  console.log("Platform MongoDB connected");
  return platformConnection;
}

async function disconnectPlatformDb() {
  if (platformConnection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

module.exports = {
  platformConnection,
  connectPlatformDb,
  disconnectPlatformDb
};
