const { Tenant } = require("../../models/platform");
const { findTenantByHostname, normalizeHostname } = require("../../services/platform/tenants");
const { getTenantConnection } = require("./tenantConnectionManager");
const { setTenantContext } = require("./tenantContext");

function tenantSlugFromRequest(req) {
  return String(
    req.params?.tenantSlug
      || req.query?.tenant
      || req.headers["x-tenant-slug"]
      || req.user?.tenantSlug
      || ""
  )
    .trim()
    .toLowerCase();
}

function requestHostname(req) {
  const forwardedHost = String(req.headers["x-forwarded-host"] || "")
    .split(",")[0]
    .trim();
  const host = forwardedHost || req.hostname || req.headers.host || "";
  return normalizeHostname(host);
}

async function resolveTenant(req, _res, next) {
  try {
    const hostname = requestHostname(req);
    if (hostname) {
      const tenantByHostname = await findTenantByHostname(hostname);
      if (tenantByHostname) {
        const connection = await getTenantConnection(tenantByHostname);
        setTenantContext(req, tenantByHostname, connection);
        return next();
      }
    }

    const slug = tenantSlugFromRequest(req);
    if (!slug) return next();

    const tenant = await Tenant.findOne({
      slug,
      status: { $in: ["trial", "active"] }
    }).lean();

    if (!tenant) return next();

    const connection = await getTenantConnection(tenant);
    setTenantContext(req, tenant, connection);
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  resolveTenant
};
