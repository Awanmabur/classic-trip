const session = require('express-session');
const MongoStore = require('connect-mongo');
const { RedisStore } = require('connect-redis');
const { env } = require('./env');
const redisRuntime = require('./redis');

function sessionDbName() {
  if (env.mongoDbName) return env.mongoDbName;
  try {
    return String(new URL(env.mongoUri).pathname || '').replace(/^\/+|\/+$/g, '') || 'classic-trip';
  } catch (_) {
    return 'classic-trip';
  }
}

module.exports = function sessionConfig() {
  const config = {
    name: 'ct.sid',
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: env.isProduction,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  };
  const redisClient = redisRuntime.activeClient();
  if (redisClient && env.nodeEnv !== 'test') {
    config.store = new RedisStore({
      client: redisClient,
      prefix: `${env.redis.prefix}sessions:`,
      ttl: 7 * 24 * 60 * 60,
    });
  } else if (env.mongoUri && env.isProduction && env.nodeEnv !== 'test') {
    // Durable fallback for deployments that have not enabled Redis yet.
    config.store = MongoStore.create({
      mongoUrl: env.mongoUri,
      collectionName: 'express_sessions',
      mongoOptions: {
        dbName: sessionDbName(),
        minPoolSize: 0,
        maxPoolSize: 5,
        maxIdleTimeMS: 60000,
        waitQueueTimeoutMS: Math.max(5000, env.mongoPool.waitQueueTimeoutMs),
        serverSelectionTimeoutMS: 10000,
      },
      // Default touchAfter is 0, which makes connect-mongo write to Mongo on every
      // single request just to refresh the session's expiry, even when nothing in
      // the session changed. 24h means a session is only re-touched once a day.
      touchAfter: 24 * 3600,
    });
  }
  return session(config);
};
