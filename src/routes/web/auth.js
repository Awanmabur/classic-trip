const express = require('express');
const passport = require('passport');
const google = require('../../config/google');
const authController = require('../../controllers/auth/authController');
const googleController = require('../../controllers/auth/googleController');
const { authLimiter } = require('../../middlewares/rateLimit');
const { loginRules, registerRules } = require('../../validators/authValidator');
const { validateRequest } = require('../../middlewares/validate');

const router = express.Router();

router.get('/login', authController.showLogin);
router.get('/register', authController.showLogin);
router.post('/login', authLimiter, loginRules, validateRequest, authController.login);
router.post('/register', authLimiter, registerRules, validateRequest, authController.register);
router.post('/forgot-password', authLimiter, authController.forgotPassword);
router.get('/reset-password/:token', authController.showResetPassword);
router.post('/reset-password', authLimiter, authController.resetPassword);
router.post('/logout', authController.logout);
router.get('/logout', (req, res) => res.redirect('/login')); // Logout is a POST action, not a dashboard page.

if (google.enabled) {
  router.get('/auth/google', googleController.setGoogleIntent, passport.authenticate('google', { scope: ['profile', 'email'] }));
  router.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/login' }), googleController.afterGoogleLogin);
} else {
  router.get('/auth/google', googleController.disabled);
  router.get('/auth/google/callback', googleController.disabled);
}

module.exports = router;
