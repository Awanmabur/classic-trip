const router = require("express").Router();

const { dashboardTemplate, renderView } = require("../../utils/render");
const { serializePublicTenantContext } = require("../../services/public/context");

function publicTenantScript(req) {
  return `<script>window.__PUBLIC_TENANT_CONTEXT__=${JSON.stringify(serializePublicTenantContext(req.tenant || null))};</script>`;
}

function authTemplate(defaultPanel, extras = {}) {
  return renderView("public/auth", {
    head: [
      publicTenantScript,
      `<script>window.__AUTH_DEFAULT_PANEL__=${JSON.stringify(defaultPanel)};if(!location.hash){location.hash='#${defaultPanel}';}</script>`,
      ...(extras.head || [])
    ],
    bodyEnd: [
      '<script defer src="/public/js/live-core.js"></script>',
      '<script defer src="/public/js/live-shell.js"></script>',
      '<script defer src="/public/js/live-auth.js"></script>',
      ...(extras.bodyEnd || [])
    ]
  });
}

function marketplaceTemplate(extras = {}) {
  return renderView("public/marketplace", {
    head: [
      publicTenantScript,
      "<style>html[data-live-marketplace='loading'] body{visibility:hidden}</style>",
      "<script>document.documentElement.dataset.liveMarketplace='loading';</script>",
      ...(extras.head || [])
    ],
    bodyEnd: [
      '<script defer src="/public/js/live-core.js"></script>',
      '<script defer src="/public/js/live-shell.js"></script>',
      '<script defer src="/public/js/live-marketplace.js"></script>',
      ...(extras.bodyEnd || [])
    ]
  });
}

function customerDashboardPage(page) {
  return dashboardTemplate("public/customer", "customer", {
    head: page ? [`<script>window.__DASHBOARD_START_PAGE__=${JSON.stringify(page)};</script>`] : []
  });
}

router.get("/", marketplaceTemplate());
router.get("/search", marketplaceTemplate());
router.get(
  "/trip/:id",
  marketplaceTemplate({
    head: [
      (req) => `<script>window.__OPEN_TRIP_ID__=${JSON.stringify(req.params.id)};</script>`
    ]
  })
);

router.get("/auth", authTemplate("login"));
router.get("/login", authTemplate("login"));
router.get("/register", authTemplate("signup"));
router.get("/partner-join", authTemplate("partner"));
router.get("/support", authTemplate("support"));
router.get(
  "/invite/:token",
  authTemplate("signup", {
    head: [
      (req) => `<script>window.__PARTNER_INVITE_TOKEN__=${JSON.stringify(req.params.token)};window.__AUTH_DEFAULT_PANEL__="signup";if(!location.hash){location.hash="#signup";}</script>`
    ]
  })
);
router.get("/logout", (_req, res) => res.redirect("/login"));

// Google OAuth (server-side flow)
const googleAuthController = require("../../controllers/public/googleAuthController");
router.get("/auth/google", googleAuthController.initiate);
router.get("/auth/google/callback", googleAuthController.callback);

router.get("/dashboard", (_req, res) => res.redirect("/login"));
router.get("/customer-dashboard", dashboardTemplate("public/customer", "customer"));
router.get("/promoter-dashboard", dashboardTemplate("public/promoter", "promoter"));

router.get("/me/bookings", customerDashboardPage("bookings"));
router.get("/wallet", customerDashboardPage("wallet"));
router.get(
  "/guest/booking/:code",
  marketplaceTemplate({
    head: [
      (req) => `<script>window.__GUEST_BOOKING_CODE__=${JSON.stringify(req.params.code)};window.__MARKETPLACE_START_SECTION__="my-bookings";</script>`
    ]
  })
);

module.exports = router;
