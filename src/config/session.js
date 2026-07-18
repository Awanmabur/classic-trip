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
      // 'auto' checks req.secure per-request (respecting `trust proxy`) instead of
      // hardcoding from NODE_ENV. A hardcoded `secure: env.isProduction` meant the
      // session cookie was silently dropped by the browser whenever the app ran in
      // production mode over plain HTTP (e.g. local production-mode testing), since
      // browsers refuse to store `secure` cookies from a non-HTTPS response - login
      // would "succeed" (redirect) but never actually persist a session.
      secure: 'auto',
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  };
  // In development, the app is designed to keep running with the in-memory
  // demo store when MongoDB is unavailable. Avoid creating a Connect-Mongo
  // session store in that mode, because it opens its own Mongo client and can
  // crash the server after connectDb() has already chosen the safe fallback.
  // Production still requires MONGO_URI and keeps durable sessions.
  if (env.mongoUri && env.isProduction && env.nodeEnv !== 'test') {
    config.store = MongoStore.create({ mongoUrl: env.mongoUri, collectionName: 'express_sessions' });
  }
  return session(config);
};
