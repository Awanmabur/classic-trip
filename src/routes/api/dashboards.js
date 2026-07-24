const express = require('express');
const dashboardController = require('../../controllers/api/dashboardController');
const { requireApiAuth, requireApiRole } = require('../../middlewares/apiAuth');
const { requirePlatformMfa } = require('../../middlewares/mfa');
const { enforceCompanyScope } = require('../../middlewares/companyAccess');
const { sensitiveActionLimiter } = require('../../middlewares/rateLimit');
const router = express.Router();

router.use(requireApiAuth, requireApiRole('customer', 'promoter', 'driver', 'company_employee', 'company_admin', 'partner', 'content_admin', 'support_admin', 'finance_admin', 'operations_admin', 'admin', 'super_admin'), requirePlatformMfa, enforceCompanyScope);
router.get('/data', dashboardController.data);
router.get('/:role/data', dashboardController.data);
router.post('/actions/:action', sensitiveActionLimiter, dashboardController.action);

module.exports = router;
