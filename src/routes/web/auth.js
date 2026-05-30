const express = require('express');
const passport = require('passport');
const google = require('../../config/google');
const authController = require('../../controllers/auth/authController');
const googleController = require('../../controllers/auth/googleController');
const { authLimiter } = require('../../middlewares/rateLimit');

const router = express.Router();

router.get('/login', authController.showLogin);
router.get('/register', authController.showLogin);
router.post('/login', authLimiter, authController.login);
router.post('/register', authLimiter, authController.register);
router.post('/logout', authController.logout);
router.get('/logout', authController.logout);

if (google.enabled) {
  router.get('/auth/google', googleController.setGoogleIntent, passport.authenticate('google', { scope: ['profile', 'email'] }));
  router.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/login' }), googleController.afterGoogleLogin);
} else {
  router.get('/auth/google', googleController.disabled);
  router.get('/auth/google/callback', googleController.disabled);
}

module.exports = router;
