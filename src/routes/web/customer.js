const express = require('express');
const dashboardController = require('../../controllers/customer/dashboardController');
const bookingController = require('../../controllers/customer/bookingController');
const refundController = require('../../controllers/customer/refundController');
const profileController = require('../../controllers/customer/profileController');
const reviewController = require('../../controllers/customer/reviewController');
const actionController = require('../../controllers/customer/actionController');
const supportController = require('../../controllers/customer/supportController');
const rescheduleController = require('../../controllers/customer/rescheduleController');
const reportController = require('../../controllers/reportController');
const { requireAuth } = require('../../middlewares/auth');
const { requireRole } = require('../../middlewares/roles');
const { supportRules } = require('../../validators/supportValidator');
const { validateRequest } = require('../../middlewares/validate');
const { sensitiveActionLimiter } = require('../../middlewares/rateLimit');
const customerService = require('../../services/customer/customerService');
const router = express.Router();

router.use('/account', requireAuth, requireRole('customer', 'super_admin'));
router.post('/account/*', sensitiveActionLimiter);

router.get('/account', dashboardController.index);
router.get('/account/bookings', dashboardController.index);
router.get('/account/profile', dashboardController.index);
router.get('/account/support', dashboardController.index);
router.get('/account/reschedules', dashboardController.index);
router.get('/account/passengers', dashboardController.index);
router.get('/account/reports/:type.csv', reportController.customer);
router.get('/account/:page', dashboardController.index);
router.post('/account/bookings/:bookingRef/cancel', bookingController.cancel);
router.post('/account/refunds', refundController.requestRefund);
router.post('/account/support', supportRules, validateRequest, supportController.create);
router.post('/account/reschedules', rescheduleController.requestReschedule);
router.post('/account/profile', profileController.update);
router.post('/account/reviews', reviewController.create);
router.post('/account/saved', actionController.saveTrip);
router.post('/account/wallet/top-up', actionController.topUpWallet);
router.post('/account/promoter', actionController.becomePromoter);
router.post('/account/security', actionController.updateSecurity);

router.get('/saved', requireAuth, requireRole('customer', 'super_admin'), async (req, res, next) => {
  try {
    const userId = req.session?.user?.id;
    const savedListings = userId ? await customerService.savedListingsFor(userId) : [];
    res.render('pages/saved', {
      seo: { title: 'Saved trips | Classic Trip', description: 'Your saved bus and hotel trips.' },
      csrfToken: req.csrfToken ? req.csrfToken() : '', savedListings,
    });
  } catch (err) { next(err); }
});

router.get('/my-bookings', requireAuth, requireRole('customer', 'super_admin'), async (req, res, next) => {
  try {
    const userId = req.session?.user?.id;
    const bookings = userId ? await customerService.bookingsFor(userId) : [];
    res.render('pages/my-bookings', {
      seo: { title: 'My bookings | Classic Trip', description: 'All your Classic Trip bookings.' },
      csrfToken: req.csrfToken ? req.csrfToken() : '', bookings,
    });
  } catch (err) { next(err); }
});

module.exports = router;
