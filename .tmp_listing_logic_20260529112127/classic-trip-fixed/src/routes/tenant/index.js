const router = require("express").Router();

const { dashboardTemplate } = require("../../utils/render");

function buildTenantRedirect(path, extraParams = {}) {
  return (req, res) => {
    const params = new URLSearchParams();
    Object.entries(req.query || {}).forEach(([key, value]) => {
      if (value == null || value === "") return;
      params.set(key, String(value));
    });
    Object.entries(typeof extraParams === "function" ? extraParams(req) : extraParams).forEach(([key, value]) => {
      if (value == null || value === "") return;
      params.set(key, String(value));
    });
    const query = params.toString();
    res.redirect(query ? `${path}?${query}` : path);
  };
}

router.get("/tenant", buildTenantRedirect("/tenant/company-admin"));
router.get("/tenant/dashboard", buildTenantRedirect("/tenant/company-admin"));
router.get("/tenant/company-admin", dashboardTemplate("tenant/company-admin", "companyAdmin"));
router.get("/tenant/company-employee", dashboardTemplate("tenant/company-employee", "employee"));
router.get("/tenant/vehicles/new", buildTenantRedirect("/tenant/company-admin", { section: "seatrooms" }));
router.get("/tenant/routes/new", buildTenantRedirect("/tenant/company-admin", { section: "listings" }));
router.get("/tenant/trips/new", buildTenantRedirect("/tenant/company-admin", { section: "schedules" }));
router.get(
  "/tenant/trips/:id/occupancy",
  buildTenantRedirect("/tenant/company-admin", (req) => ({
    section: "seatrooms",
    tripId: req.params.id
  }))
);
router.get(
  "/tenant/trips/:id/manifest",
  buildTenantRedirect("/tenant/company-admin", (req) => ({
    section: "bookings",
    tripId: req.params.id
  }))
);

module.exports = router;
