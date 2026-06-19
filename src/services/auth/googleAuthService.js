const authService = require('./authService');

async function findOrCreateGoogleUser(profile, intent = {}) {
  return authService.findOrCreateGoogleUser(profile, intent);
}

module.exports = { findOrCreateGoogleUser };
