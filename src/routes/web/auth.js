const express = require('express');
const passport = require('passport');
const google = require('../../config/google');
const authController = require('../../controllers/auth/authController');
const googleController = require('../../controllers/auth/googleController');
const phoneVerificationController = require('../../controllers/auth/phoneVerificationController');
const { authLimiter, forgotPasswordLimiter } = require('../../middlewares/rateLimit');
const { loginRules, registerRules, resetPasswordRules, phoneCodeRules, mfaCodeRules } = require('../../validators/authValidator');
const { validateRequest } = require('../../middlewares/validate');

const router = express.Router();

router.get('/login', authController.showLogin);
router.get('/register', authController.showLogin);
router.get('/onboarding/status', authController.showOnboardingStatus);
router.get('/account/phone-verification', phoneVerificationController.show);
router.post('/account/phone-verification/request', authLimiter, phoneVerificationController.requestCode);
router.post('/account/phone-verification/verify', authLimiter, phoneCodeRules, validateRequest, phoneVerificationController.verify);
router.get('/auth/mfa/setup', authController.showMfaSetup);
router.post('/auth/mfa/setup', authLimiter, mfaCodeRules, validateRequest, authController.confirmMfaSetup);
router.get('/auth/mfa/challenge', authController.showMfaChallenge);
router.post('/auth/mfa/challenge', authLimiter, mfaCodeRules, validateRequest, authController.verifyMfaChallenge);
router.post('/login', authLimiter, loginRules, validateRequest, authController.login);
router.post('/register', authLimiter, registerRules, validateRequest, authController.register);
router.post('/forgot-password', forgotPasswordLimiter, authController.forgotPassword);
router.get('/reset-password/:token', authController.showResetPassword);
router.post('/reset-password', authLimiter, resetPasswordRules, validateRequest, authController.resetPassword);
router.post('/logout', authController.logout);
router.get('/logout', (req, res) => res.redirect('/login')); // Logout is a POST action, not a dashboard page.
router.get('/verify-email/:token', authController.verifyEmail);
router.post('/account/resend-verification', authLimiter, authController.resendVerification);

if (google.enabled) {
  router.get('/auth/google', googleController.setGoogleIntent, passport.authenticate('google', { scope: ['profile', 'email'] }));
  router.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/login' }), googleController.afterGoogleLogin);
} else {
  router.get('/auth/google', googleController.disabled);
  router.get('/auth/google/callback', googleController.disabled);
}

module.exports = router;
