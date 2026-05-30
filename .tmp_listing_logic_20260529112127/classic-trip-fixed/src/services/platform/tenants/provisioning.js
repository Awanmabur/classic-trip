const { buildTenantDbName } = require("../../../core/tenancy/tenantConnectionManager");
const { TENANT_LOCAL_DOMAIN_SUFFIX } = require("../../../config/app");
const { Domain, Tenant } = require("../../../models/platform");
const { User } = require("../../../models/shared");
const { createTenantDomain, setPrimaryTenantDomain } = require("./domains");

const PARTNER_ROLES = new Set(["partner", "company_admin"]);

function sanitizeSlug(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function tenantStatusForUser(user) {
  return user?.status === "suspended" ? "suspended" : "active";
}

function tenantNameForUser(user) {
  return String(user?.companyName || user?.name || "Classic Trip Partner").trim();
}

async function buildUniqueTenantSlug(baseValue = "") {
  const base = sanitizeSlug(baseValue) || "classic-trip-partner";
  let attempt = 0;

  while (attempt < 100) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const existing = await Tenant.findOne({ slug }).select("_id").lean();
    if (!existing) return slug;
    attempt += 1;
  }

  return `${base}-${Date.now()}`;
}

async function findExistingTenantForUser(user) {
  if (user?.tenantId) {
    const byId = await Tenant.findById(user.tenantId);
    if (byId) return byId;
  }

  if (user?.tenantSlug) {
    const bySlug = await Tenant.findOne({ slug: user.tenantSlug });
    if (bySlug) return bySlug;
  }

  const byOwner = await Tenant.findOne({ ownerUserId: user._id });
  if (byOwner) return byOwner;

  const byEmail = await Tenant.findOne({ ownerEmail: String(user?.email || "").toLowerCase().trim() });
  if (byEmail) return byEmail;

  return null;
}

async function syncOwnerUser(user, tenant) {
  let dirty = false;

  if (String(user.tenantId || "") !== String(tenant._id)) {
    user.tenantId = tenant._id;
    dirty = true;
  }

  if (String(user.tenantSlug || "") !== String(tenant.slug || "")) {
    user.tenantSlug = tenant.slug || "";
    dirty = true;
  }

  if (dirty) {
    await user.save();
  }

  return user;
}

async function syncEmployeeUsersForTenant(ownerUser, tenant) {
  await User.updateMany(
    {
      role: "company_employee",
      companyId: ownerUser._id
    },
    {
      $set: {
        tenantId: tenant._id,
        tenantSlug: tenant.slug,
        companyName: ownerUser.companyName || ownerUser.name || "",
        businessType: ownerUser.businessType || "",
        country: ownerUser.country || "",
        companyCurrency: ownerUser.companyCurrency || "UGX"
      }
    }
  );
}

async function ensureDefaultLocalhostDomain(tenant) {
  if (!tenant?.slug || tenant.primaryDomain) return tenant;

  const hostname = `${tenant.slug}.${TENANT_LOCAL_DOMAIN_SUFFIX || "localhost"}`;
  const existing = await Domain.findOne({ tenantId: tenant._id, hostname }).lean();

  if (existing) {
    return setPrimaryTenantDomain(tenant._id, hostname);
  }

  const result = await createTenantDomain({ tenant, hostname });
  return result.tenant || tenant;
}

async function ensureTenantForPartnerUser(userInput) {
  const user = userInput?._id && typeof userInput.save === "function"
    ? userInput
    : await User.findById(userInput?._id || userInput);

  if (!user) {
    throw new Error("Partner user not found");
  }

  if (!PARTNER_ROLES.has(String(user.role || ""))) {
    throw new Error("Only partner company users can own tenants");
  }

  let tenant = await findExistingTenantForUser(user);
  const payload = {
    name: tenantNameForUser(user),
    status: tenantStatusForUser(user),
    businessType: String(user.businessType || "").trim(),
    country: String(user.country || "").trim(),
    currency: String(user.companyCurrency || "UGX").trim() || "UGX",
    ownerUserId: user._id,
    ownerName: String(user.name || "").trim(),
    ownerEmail: String(user.email || "").toLowerCase().trim(),
    phone: String(user.phone || "").trim()
  };

  if (!tenant) {
    const slug = await buildUniqueTenantSlug(
      user.companyName || user.name || user.email?.split("@")[0] || "classic-trip-partner"
    );

    tenant = await Tenant.create({
      ...payload,
      slug,
      databaseName: buildTenantDbName(slug),
      provisionedAt: new Date()
    });
  } else {
    Object.assign(tenant, payload);

    if (!tenant.slug) {
      tenant.slug = await buildUniqueTenantSlug(
        user.companyName || user.name || user.email?.split("@")[0] || "classic-trip-partner"
      );
    }

    if (!tenant.databaseName) {
      tenant.databaseName = buildTenantDbName(tenant.slug);
    }

    if (!tenant.provisionedAt) {
      tenant.provisionedAt = new Date();
    }

    await tenant.save();
  }

  tenant = await ensureDefaultLocalhostDomain(tenant);

  await syncOwnerUser(user, tenant);
  await syncEmployeeUsersForTenant(user, tenant);

  return tenant;
}

async function setTenantStatusForOwner(ownerUserId, status = "active") {
  const tenant = await Tenant.findOne({ ownerUserId });
  if (!tenant) return null;

  tenant.status = status === "suspended" ? "suspended" : "active";
  await tenant.save();
  return tenant;
}

module.exports = {
  buildUniqueTenantSlug,
  ensureTenantForPartnerUser,
  sanitizeSlug,
  setTenantStatusForOwner,
  tenantStatusForUser
};
