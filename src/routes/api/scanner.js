const express = require('express');
const scannerController = require('../../controllers/api/scannerController');
const { requireApiAuth, requireApiRole } = require('../../middlewares/apiAuth');
const router = express.Router();

router.use(requireApiAuth, requireApiRole('company_employee', 'company_admin', 'partner', 'admin', 'super_admin'));
router.post('/lookup', scannerController.lookup);
router.post('/validate', scannerController.validate);
router.post('/no-show', scannerController.noShow);

module.exports = router;
