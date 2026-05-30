const express = require('express');
const dashboardController = require('../../controllers/employee/dashboardController');
const scannerController = require('../../controllers/employee/scannerController');
const checkinController = require('../../controllers/employee/checkinController');
const actionController = require('../../controllers/employee/actionController');
const reportController = require('../../controllers/reportController');
const { requireAuth } = require('../../middlewares/auth');
const { requireRole } = require('../../middlewares/roles');
const router = express.Router();

router.use('/employee', requireAuth, requireRole('company_employee', 'company_admin', 'super_admin'));

router.get('/employee/dashboard', dashboardController.index);
router.get('/employee/reports/:type.csv', reportController.employee);
router.post('/employee/scanner/lookup', scannerController.lookup);
router.post('/employee/scanner/validate', scannerController.validate);
router.post('/employee/scanner/no-show', scannerController.noShow);
router.post('/employee/bookings/:bookingRef/check-in', checkinController.checkIn);
router.post('/employee/bookings/:bookingRef/no-show', checkinController.noShow);
router.post('/employee/bookings', actionController.createBooking);
router.post('/employee/inventory', actionController.updateInventory);
router.post('/employee/schedules/delay', actionController.sendDelayNotice);
router.post('/employee/payments', actionController.recordPayment);
router.post('/employee/refunds', actionController.requestRefund);
router.post('/employee/support/notice', actionController.createSupportNotice);
router.post('/employee/support/customer-note', actionController.createCustomerNote);
router.post('/employee/support/:id', actionController.updateSupport);
router.post('/employee/handovers', actionController.createHandover);
router.post('/employee/profile', actionController.updateProfile);
router.post('/employee/reports/custom', reportController.employeeCustom);

module.exports = router;
