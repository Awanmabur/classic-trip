const express = require('express');
const dashboardController = require('../../controllers/promoter/dashboardController');
const linkController = require('../../controllers/promoter/linkController');
const commissionController = require('../../controllers/promoter/commissionController');
const withdrawalController = require('../../controllers/promoter/withdrawalController');
const campaignController = require('../../controllers/promoter/campaignController');
const profileController = require('../../controllers/promoter/profileController');
const supportController = require('../../controllers/promoter/supportController');
const reportController = require('../../controllers/reportController');
const { requireAuth } = require('../../middlewares/auth');
const { requireRole } = require('../../middlewares/roles');
const { supportRules } = require('../../validators/supportValidator');
const { withdrawalRules } = require('../../validators/withdrawalValidator');
const { validateRequest } = require('../../middlewares/validate');
const router = express.Router();

router.use('/promoter', requireAuth, requireRole('promoter', 'super_admin'));

router.get('/promoter/dashboard', dashboardController.index);
router.get('/promoter/links', dashboardController.index);
router.get('/promoter/commissions', dashboardController.index);
router.get('/promoter/withdrawals', dashboardController.index);
router.get('/promoter/campaigns', dashboardController.index);
router.get('/promoter/reports/:type.csv', reportController.promoter);
router.post('/promoter/links', linkController.create);
router.post('/promoter/links/:id/archive', linkController.archive);
router.get('/promoter/api/commissions', commissionController.index);
router.post('/promoter/withdrawals', withdrawalRules, validateRequest, withdrawalController.request);
router.post('/promoter/profile', profileController.update);
router.post('/promoter/verification', profileController.updateVerification);
router.post('/promoter/support', supportRules, validateRequest, supportController.create);
router.get('/promoter/api/campaigns', campaignController.index);
router.post('/promoter/campaigns', campaignController.create);

module.exports = router;
