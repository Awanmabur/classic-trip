const { env } = require('./env');

module.exports = {
  enabled: Boolean(env.google.clientId && env.google.clientSecret),
  clientID: env.google.clientId,
  clientSecret: env.google.clientSecret,
  callbackURL: env.google.callbackUrl,
};
