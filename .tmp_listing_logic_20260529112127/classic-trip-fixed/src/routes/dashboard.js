const router = require('express').Router();
const { auth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const c = require('../controllers/dashboard');

router.get('/super-admin', auth, requireRole('super_admin', 'admin'), c.superAdmin);
router.get('/company-admin', auth, requireRole('company_admin', 'partner', 'admin', 'super_admin'), c.companyAdmin);
router.get('/company-employee', auth, requireRole('company_employee', 'company_admin', 'partner', 'admin', 'super_admin'), c.companyEmployee);
router.get('/customer', auth, requireRole('customer', 'admin', 'super_admin'), c.customer);
router.get('/promoter', auth, requireRole('promoter', 'admin', 'super_admin'), c.promoter);

module.exports = router;
