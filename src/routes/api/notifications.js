const express = require('express');
const notificationController = require('../../controllers/api/notificationController');
const { requireApiAuth, requireApiRole } = require('../../middlewares/apiAuth');

const router = express.Router();

router.use(requireApiAuth, requireApiRole('customer', 'promoter', 'company_employee', 'company_admin', 'driver', 'support_admin', 'finance_admin', 'operations_admin', 'admin', 'super_admin'));
router.get('/config', notificationController.config);
router.get('/', notificationController.list);
router.post('/subscribe', notificationController.subscribe);
router.post('/unsubscribe', notificationController.unsubscribe);
router.post('/:id/read', notificationController.markRead);

module.exports = router;