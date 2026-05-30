const router = require("express").Router();
const { auth, requireRole } = require("../../middleware/auth");
const controller = require("../../controllers/platform/dashboardController");

router.get("/super-admin", auth, requireRole("super_admin", "admin"), controller.superAdmin);
router.get("/company-admin", auth, requireRole("company_admin", "partner", "admin", "super_admin"), controller.companyAdmin);
router.get("/company-employee", auth, requireRole("company_employee", "company_admin", "partner", "admin", "super_admin"), controller.companyEmployee);
router.get("/customer", auth, requireRole("customer", "admin", "super_admin"), controller.customer);
router.get("/promoter", auth, requireRole("promoter", "admin", "super_admin"), controller.promoter);

module.exports = router;
