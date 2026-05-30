const router = require("express").Router();

const { dashboardTemplate } = require("../../utils/render");

const redirectTo = (path) => (_req, res) => res.redirect(path);
const superAdminDashboard = (page = "") =>
  dashboardTemplate("platform/super-admin", "super", {
    head: page ? [`<script>window.__DASHBOARD_START_PAGE__=${JSON.stringify(page)};</script>`] : []
  });

router.get("/platform", redirectTo("/platform/admin"));
router.get("/platform/dashboard", redirectTo("/platform/admin"));
router.get("/platform/overview", redirectTo("/platform/admin"));

[
  ["/platform/admin", superAdminDashboard()],
  ["/platform/admin/users", superAdminDashboard("admins")],
  ["/platform/admin/bookings", superAdminDashboard("bookings")]
].forEach(([path, handler]) => router.get(path, handler));

module.exports = router;
