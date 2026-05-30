const express = require('express');
const dashboardController = require('../../controllers/customer/dashboardController');
const bookingController = require('../../controllers/customer/bookingController');
const refundController = require('../../controllers/customer/refundController');
const profileController = require('../../controllers/customer/profileController');
const reviewController = require('../../controllers/customer/reviewController');
const reportController = require('../../controllers/reportController');
const { requireAuth } = require('../../middlewares/auth');
const { requireRole } = require('../../middlewares/roles');
const router = express.Router();

router.use('/account', requireAuth, requireRole('customer', 'super_admin'));

router.get('/account', dashboardController.index);
router.get('/account/bookings', dashboardController.index);
router.get('/account/profile', dashboardController.index);
router.get('/account/reports/:type.csv', reportController.customer);
router.post('/account/bookings/:bookingRef/cancel', bookingController.cancel);
router.post('/account/refunds', refundController.requestRefund);
router.post('/account/profile', profileController.update);
router.post('/account/reviews', reviewController.create);

module.exports = router;
