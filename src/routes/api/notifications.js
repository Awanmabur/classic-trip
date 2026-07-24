const express = require('express');
const notificationController = require('../../controllers/api/notificationController');
const { requireApiAuth, requireApiRole } = require('../../middlewares/apiAuth');
const { requirePlatformMfa } = require('../../middlewares/mfa');
const { sensitiveActionLimiter } = require('../../middlewares/rateLimit');

const router = express.Router();

router.use(requireApiAuth, requireApiRole('customer', 'promoter', 'company_employee', 'company_admin', 'driver', 'support_admin', 'finance_admin', 'operations_admin', 'admin', 'super_admin'), requirePlatformMfa);
router.get('/config', notificationController.config);
router.get('/', notificationController.list);
router.post('/subscribe', sensitiveActionLimiter, notificationController.subscribe);
router.post('/unsubscribe', sensitiveActionLimiter, notificationController.unsubscribe);
router.post('/:id/read', sensitiveActionLimiter, notificationController.markRead);

module.exports = router;
