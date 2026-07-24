const express = require('express');
const scannerController = require('../../controllers/api/scannerController');
const { requireApiAuth, requireApiRole } = require('../../middlewares/apiAuth');
const { requirePlatformMfa } = require('../../middlewares/mfa');
const { enforceCompanyScope } = require('../../middlewares/companyAccess');
const { sensitiveActionLimiter } = require('../../middlewares/rateLimit');
const router = express.Router();

router.use(requireApiAuth, requireApiRole('company_employee', 'company_admin', 'admin', 'super_admin'), requirePlatformMfa, enforceCompanyScope);
router.post('/lookup', sensitiveActionLimiter, scannerController.lookup);
router.post('/validate', sensitiveActionLimiter, scannerController.validate);
router.post('/no-show', sensitiveActionLimiter, scannerController.noShow);

module.exports = router;
