const { connectPlatformDb, disconnectPlatformDb, platformConnection } = require("./platformDb");

async function connectDB() {
  await connectPlatformDb();
}

module.exports = {
  connectDB,
  connectPlatformDb,
  disconnectPlatformDb,
  platformConnection
};
