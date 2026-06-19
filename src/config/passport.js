const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const google = require('./google');
const googleAuthService = require('../services/auth/googleAuthService');

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

if (google.enabled) {
  passport.use(new GoogleStrategy({
    clientID: google.clientID,
    clientSecret: google.clientSecret,
    callbackURL: google.callbackURL,
    passReqToCallback: true,
  }, async (req, accessToken, refreshToken, profile, done) => {
    try {
      const intent = req.session?.googleIntent || { role: req.session?.googleIntentRole || 'customer' };
      const user = await googleAuthService.findOrCreateGoogleUser(profile, intent);
      return done(null, user);
    } catch (error) {
      return done(error);
    }
  }));
}

module.exports = passport;
