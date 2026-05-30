const { APP_URL, TENANT_LOCAL_DOMAIN_SUFFIX } = require("../../../config/app");
const { Domain, Tenant } = require("../../../models/platform");

const ACTIVE_TENANT_STATUSES = ["trial", "active"];
const HOSTNAME_PATTERN = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;

function appHostname() {
  try {
    return String(new URL(APP_URL).hostname || "").trim().toLowerCase();
  } catch (_error) {
    return "";
  }
}

function normalizeHostname(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
}

function ensureValidHostname(hostname) {
  if (!HOSTNAME_PATTERN.test(hostname)) {
    const error = new Error("Enter a valid hostname like portal.example.com");
    error.statusCode = 400;
    throw error;
  }
}

function isPlatformManagedHostname(hostname = "") {
  const baseHostname = appHostname();
  if (!baseHostname || hostname === baseHostname) return false;
  const localSuffixMatch = TENANT_LOCAL_DOMAIN_SUFFIX
    ? hostname.endsWith(`.${TENANT_LOCAL_DOMAIN_SUFFIX}`)
    : false;
  return hostname.endsWith(`.${baseHostname}`) || localSuffixMatch;
}

function shouldAutoVerifyHostname(hostname = "") {
  return isPlatformManagedHostname(hostname);
}

function buildTenantWebUrl(tenant = {}, pathname = "/") {
  const base = new URL(String(APP_URL || "http://localhost:3000"));
  const normalizedPathname = pathname.startsWith("/") ? pathname : `/${pathname}`;

  if (tenant?.primaryDomain) {
    base.hostname = tenant.primaryDomain;
  } else if (tenant?.slug) {
    base.searchParams.set("tenant", tenant.slug);
  }

  base.pathname = normalizedPathname;
  return base.toString();
}

function buildTenantPortalUrl(tenant = {}) {
  return buildTenantWebUrl(tenant, "/tenant/company-admin");
}

function serializeTenantDomain(domain) {
  return {
    id: String(domain._id),
    hostname: domain.hostname,
    type: domain.type,
    verificationStatus: domain.verificationStatus,
    verifiedAt: domain.verifiedAt || null,
    createdAt: domain.createdAt || null
  };
}

function serializeTenantIdentity(tenant, domains = []) {
  if (!tenant) return null;

  return {
    id: String(tenant._id),
    slug: tenant.slug,
    name: tenant.name,
    status: tenant.status,
    primaryDomain: tenant.primaryDomain || "",
    timezone: tenant.timezone || "Africa/Kampala",
    currency: tenant.currency || "UGX",
    businessType: tenant.businessType || "",
    country: tenant.country || "",
    portalUrl: buildTenantPortalUrl(tenant),
    platformManagedHostnames: domains
      .filter((domain) => isPlatformManagedHostname(domain.hostname))
      .map((domain) => domain.hostname)
  };
}

async function listTenantDomains(tenantId) {
  return Domain.find({ tenantId }).sort({ type: 1, hostname: 1 }).lean();
}

async function findTenantByHostname(rawHostname = "") {
  const hostname = normalizeHostname(rawHostname);
  if (!hostname) return null;

  const domain = await Domain.findOne({
    hostname,
    verificationStatus: "verified"
  }).lean();

  if (domain?.tenantId) {
    return Tenant.findOne({
      _id: domain.tenantId,
      status: { $in: ACTIVE_TENANT_STATUSES }
    }).lean();
  }

  return Tenant.findOne({
    primaryDomain: hostname,
    status: { $in: ACTIVE_TENANT_STATUSES }
  }).lean();
}

async function setPrimaryTenantDomain(tenantId, hostname = "") {
  const normalizedHostname = normalizeHostname(hostname);
  const tenant = await Tenant.findById(tenantId);
  if (!tenant) {
    const error = new Error("Tenant not found");
    error.statusCode = 404;
    throw error;
  }

  tenant.primaryDomain = normalizedHostname;
  await tenant.save();

  await Domain.updateMany({ tenantId }, { $set: { type: "custom" } });
  if (normalizedHostname) {
    await Domain.findOneAndUpdate(
      { tenantId, hostname: normalizedHostname },
      { $set: { type: "primary", verificationStatus: "verified", verifiedAt: new Date() } }
    );
  }

  return tenant;
}

async function createTenantDomain({ tenant, hostname }) {
  const normalizedHostname = normalizeHostname(hostname);
  ensureValidHostname(normalizedHostname);

  const existing = await Domain.findOne({ hostname: normalizedHostname });
  if (existing && String(existing.tenantId) !== String(tenant._id)) {
    const error = new Error("That hostname is already connected to another tenant");
    error.statusCode = 409;
    throw error;
  }
  if (existing) {
    const error = new Error("That hostname already exists for this tenant");
    error.statusCode = 409;
    throw error;
  }

  const autoVerified = shouldAutoVerifyHostname(normalizedHostname);
  const domain = await Domain.create({
    tenantId: tenant._id,
    hostname: normalizedHostname,
    type: tenant.primaryDomain ? "custom" : "primary",
    verificationStatus: autoVerified ? "verified" : "pending",
    verifiedAt: autoVerified ? new Date() : null
  });

  let updatedTenant = tenant;
  if (!tenant.primaryDomain && autoVerified) {
    updatedTenant = await setPrimaryTenantDomain(tenant._id, normalizedHostname);
  }

  return { domain, tenant: updatedTenant };
}

async function verifyTenantDomain({ tenant, domainId, makePrimary = false }) {
  const domain = await Domain.findOne({ _id: domainId, tenantId: tenant._id });
  if (!domain) {
    const error = new Error("Domain not found");
    error.statusCode = 404;
    throw error;
  }

  domain.verificationStatus = "verified";
  domain.verifiedAt = new Date();
  await domain.save();

  let updatedTenant = tenant;
  if (makePrimary || !tenant.primaryDomain) {
    updatedTenant = await setPrimaryTenantDomain(tenant._id, domain.hostname);
  }

  return { domain, tenant: updatedTenant };
}

async function removeTenantDomain({ tenant, domainId }) {
  const domain = await Domain.findOne({ _id: domainId, tenantId: tenant._id });
  if (!domain) {
    const error = new Error("Domain not found");
    error.statusCode = 404;
    throw error;
  }

  await domain.deleteOne();

  let updatedTenant = await Tenant.findById(tenant._id);
  if (domain.hostname === tenant.primaryDomain) {
    const replacement = await Domain.findOne({
      tenantId: tenant._id,
      verificationStatus: "verified"
    }).sort({ createdAt: 1 });

    if (replacement) {
      updatedTenant = await setPrimaryTenantDomain(tenant._id, replacement.hostname);
    } else if (updatedTenant) {
      updatedTenant.primaryDomain = "";
      await updatedTenant.save();
    }
  }

  return { tenant: updatedTenant || tenant, removedDomainId: String(domain._id) };
}

module.exports = {
  appHostname,
  buildTenantPortalUrl,
  buildTenantWebUrl,
  createTenantDomain,
  findTenantByHostname,
  isPlatformManagedHostname,
  listTenantDomains,
  normalizeHostname,
  removeTenantDomain,
  serializeTenantDomain,
  serializeTenantIdentity,
  setPrimaryTenantDomain,
  shouldAutoVerifyHostname,
  verifyTenantDomain
};
