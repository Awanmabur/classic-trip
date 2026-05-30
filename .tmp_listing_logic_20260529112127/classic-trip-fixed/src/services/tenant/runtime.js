const { getTenantConnection } = require("../../core/tenancy/tenantConnectionManager");
const { Tenant, TripCatalog } = require("../../models/platform");
const { User } = require("../../models/shared");
const { getTenantModels } = require("../../models/tenant");

async function resolveTenantByOwnerUserId(ownerUserId) {
  if (!ownerUserId) return null;
  return Tenant.findOne({ ownerUserId }).lean();
}

async function resolveTenantRecordFromUser(user, ownerIdOverride = "") {
  if (!user) return null;

  if (["admin", "super_admin"].includes(user.role) && ownerIdOverride) {
    const ownerUser = await User.findById(ownerIdOverride)
      .select("tenantId tenantSlug companyId role companyName name")
      .lean();

    if (ownerUser?.tenantId) return Tenant.findById(ownerUser.tenantId).lean();
    if (ownerUser?.tenantSlug) return Tenant.findOne({ slug: ownerUser.tenantSlug }).lean();
    if (ownerUser?.role === "company_employee" && ownerUser?.companyId) {
      return resolveTenantByOwnerUserId(ownerUser.companyId);
    }

    return resolveTenantByOwnerUserId(ownerIdOverride);
  }

  if (user.tenantId) return Tenant.findById(user.tenantId).lean();

  if (user.tenantSlug) return Tenant.findOne({ slug: user.tenantSlug }).lean();
  if (user.role === "company_employee" && user.companyId) return resolveTenantByOwnerUserId(user.companyId);

  return resolveTenantByOwnerUserId(user.userId);
}

async function getTenantAccessForUser(user, ownerIdOverride = "") {
  const tenant = await resolveTenantRecordFromUser(user, ownerIdOverride);

  if (!tenant) {
    const error = new Error(
      ownerIdOverride
        ? "Tenant not found for the requested company"
        : "Tenant context is required"
    );
    error.statusCode = 404;
    throw error;
  }

  const connection = await getTenantConnection(tenant);
  return {
    tenant,
    connection,
    models: getTenantModels(connection),
    tenantId: String(tenant._id),
    tenantSlug: tenant.slug,
    ownerUserId: String(tenant.ownerUserId || ownerIdOverride || user?.userId || "")
  };
}

async function getTenantAccessForRequest(req, options = {}) {
  const ownerIdOverride = String(options.ownerIdOverride || req.query?.ownerId || "").trim();
  return getTenantAccessForUser(req.user, ownerIdOverride);
}

async function getTenantAccessByCatalog(publicTripId) {
  const catalog = await TripCatalog.findById(publicTripId).lean();
  if (!catalog) return { catalog: null, tenant: null, connection: null, models: null };

  const access = await getTenantAccessByTenantId(catalog.tenantId);
  return { catalog, ...access };
}

function catalogMatchesTenantScope(catalog, tenantOrTenantId = null) {
  if (!catalog || !tenantOrTenantId) return true;
  const scopedTenantId = typeof tenantOrTenantId === "object"
    ? tenantOrTenantId?._id
    : tenantOrTenantId;
  if (!scopedTenantId) return true;
  return String(catalog.tenantId || "") === String(scopedTenantId);
}

async function getTenantAccessByTenantId(tenantId) {
  const tenant = tenantId ? await Tenant.findById(tenantId).lean() : null;
  if (!tenant) return { tenant: null, connection: null, models: null };

  const connection = await getTenantConnection(tenant);
  return {
    tenant,
    connection,
    models: getTenantModels(connection)
  };
}

module.exports = {
  catalogMatchesTenantScope,
  getTenantAccessByCatalog,
  getTenantAccessByTenantId,
  getTenantAccessForRequest,
  getTenantAccessForUser,
  resolveTenantByOwnerUserId,
  resolveTenantRecordFromUser
};
