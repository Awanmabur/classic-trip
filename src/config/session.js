const session = require('express-session');
const MongoStore = require('connect-mongo');
const { env } = require('./env');

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
  // Production sessions are durable and require MongoDB. Development may use
  // Express' process-local store only for local debugging; it is never used in production.
  if (env.mongoUri && env.isProduction && env.nodeEnv !== 'test') {
    config.store = MongoStore.create({
      mongoUrl: env.mongoUri,
      collectionName: 'express_sessions',
      // Default touchAfter is 0, which makes connect-mongo write to Mongo on every
      // single request just to refresh the session's expiry, even when nothing in
      // the session changed. 24h means a session is only re-touched once a day.
      touchAfter: 24 * 3600,
    });
  }
  return session(config);
};
