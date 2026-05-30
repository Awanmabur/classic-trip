const express = require('express');
const dashboardController = require('../../controllers/promoter/dashboardController');
const linkController = require('../../controllers/promoter/linkController');
const commissionController = require('../../controllers/promoter/commissionController');
const withdrawalController = require('../../controllers/promoter/withdrawalController');
const campaignController = require('../../controllers/promoter/campaignController');
const reportController = require('../../controllers/reportController');
const { requireAuth } = require('../../middlewares/auth');
const { requireRole } = require('../../middlewares/roles');
const router = express.Router();

router.use('/promoter', requireAuth, requireRole('promoter', 'super_admin'));

router.get('/promoter/dashboard', dashboardController.index);
router.get('/promoter/links', dashboardController.index);
router.get('/promoter/commissions', dashboardController.index);
router.get('/promoter/withdrawals', dashboardController.index);
router.get('/promoter/campaigns', dashboardController.index);
router.get('/promoter/reports/:type.csv', reportController.promoter);
router.post('/promoter/links', linkController.create);
router.get('/promoter/api/commissions', commissionController.index);
router.post('/promoter/withdrawals', withdrawalController.request);
router.get('/promoter/api/campaigns', campaignController.index);

module.exports = router;
