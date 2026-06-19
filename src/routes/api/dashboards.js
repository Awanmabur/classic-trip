const express = require('express');
const dashboardController = require('../../controllers/api/dashboardController');
const { requireApiAuth, requireApiRole } = require('../../middlewares/apiAuth');
const { enforceCompanyScope } = require('../../middlewares/companyAccess');
const router = express.Router();

router.use(requireApiAuth, requireApiRole('customer', 'promoter', 'company_employee', 'company_admin', 'partner', 'admin', 'super_admin'), enforceCompanyScope);
router.get('/data', dashboardController.data);
router.get('/:role/data', dashboardController.data);
router.post('/actions/:action', dashboardController.action);

module.exports = router;
