const { buildTenantPortalUrl, buildTenantWebUrl } = require("../platform/tenants");

const PLATFORM_CONTEXT = {
  scope: "platform",
  tenantScoped: false,
  tenantId: "",
  tenantSlug: "",
  displayName: "Classic Trip",
  shortName: "CT",
  businessType: "",
  country: "",
  currency: "UGX",
  timezone: "Africa/Kampala",
  primaryDomain: "",
  supportEmail: "",
  supportPhone: "",
  portalUrl: "",
  storefrontUrl: "",
  searchUrl: "",
  authUrl: "",
  primaryColor: "#4f8cff",
  accentColor: "#ffb703",
  hotColor: "#ff3d00",
  authTitle: "Classic Trip account access",
  authSubtitle: "Customers can manage tickets, promoters can track commission, and partners can list buses, hotels, flights, trains and more from one clean account system.",
  marketplaceTitle: "Book transport, stays & experiences in one place.",
  marketplaceSubtitle: "Partners list buses, hotels, flights, trains and more. Customers can view the real structure, pick seats or rooms, hold them for 10 minutes, then complete checkout.",
  marketplaceIntro: "Browse live schedules, availability, and direct booking support from a modern multi-tenant travel platform.",
  supportHeadline: "Need help before or after you book?",
  supportBlurb: "Classic Trip supports booking help, payment follow-up, ticket access, and partner onboarding from one shared platform.",
  featureOneTitle: "",
  featureOneBody: "",
  featureTwoTitle: "",
  featureTwoBody: "",
  featureThreeTitle: "",
  featureThreeBody: "",
  promoHeadline: "Featured offers and boosted listings",
  promoBody: "Partners can promote services, highlight key routes, and surface time-sensitive campaigns directly from the platform."
};

function shortNameFor(value = "") {
  const parts = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) return PLATFORM_CONTEXT.shortName;

  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 3);
}

function settingValue(settings, key, fallback = "") {
  if (!settings) return fallback;
  if (typeof settings.get === "function") return settings.get(key) || fallback;
  return settings[key] || fallback;
}

function serializePublicTenantContext(tenant) {
  if (!tenant) return { ...PLATFORM_CONTEXT };

  const displayName = String(tenant.name || "Classic Trip Partner").trim() || "Classic Trip Partner";
  const settings = tenant.settings || null;
  const brandName = String(settingValue(settings, "brandName", displayName)).trim() || displayName;
  const businessType = String(tenant.businessType || "").trim();
  const country = String(tenant.country || "").trim();
  const businessLabel = businessType ? businessType.toLowerCase() : "travel service";
  const placeLabel = country ? ` in ${country}` : "";

  return {
    scope: "tenant",
    tenantScoped: true,
    tenantId: String(tenant._id || ""),
    tenantSlug: tenant.slug || "",
    displayName: brandName,
    shortName: String(settingValue(settings, "brandShortName", shortNameFor(brandName || displayName))).trim() || shortNameFor(brandName || displayName),
    businessType,
    country,
    currency: tenant.currency || PLATFORM_CONTEXT.currency,
    timezone: tenant.timezone || PLATFORM_CONTEXT.timezone,
    primaryDomain: tenant.primaryDomain || "",
    supportEmail: String(settingValue(settings, "supportEmail", tenant.ownerEmail || "")).trim(),
    supportPhone: String(settingValue(settings, "supportPhone", tenant.phone || "")).trim(),
    portalUrl: buildTenantPortalUrl(tenant),
    storefrontUrl: buildTenantWebUrl(tenant, "/"),
    searchUrl: buildTenantWebUrl(tenant, "/search"),
    authUrl: buildTenantWebUrl(tenant, "/login"),
    primaryColor: String(settingValue(settings, "primaryColor", PLATFORM_CONTEXT.primaryColor)).trim() || PLATFORM_CONTEXT.primaryColor,
    accentColor: String(settingValue(settings, "accentColor", PLATFORM_CONTEXT.accentColor)).trim() || PLATFORM_CONTEXT.accentColor,
    hotColor: String(settingValue(settings, "hotColor", PLATFORM_CONTEXT.hotColor)).trim() || PLATFORM_CONTEXT.hotColor,
    authTitle: settingValue(settings, "authTitle", `${brandName} account access`),
    authSubtitle: settingValue(
      settings,
      "authSubtitle",
      `Customers can book directly with ${brandName}, and team members can access the live ${businessLabel} workspace${placeLabel}.`
    ),
    marketplaceTitle: settingValue(settings, "marketplaceTitle", `Book directly with ${brandName}.`),
    marketplaceSubtitle: settingValue(
      settings,
      "marketplaceSubtitle",
      `${brandName} publishes live schedules, stays, availability, and checkout from its own tenant workspace${placeLabel}.`
    ),
    marketplaceIntro: settingValue(
      settings,
      "marketplaceIntro",
      `Explore live schedules, stays, and direct booking support from ${brandName}${placeLabel}.`
    ),
    supportHeadline: settingValue(
      settings,
      "supportHeadline",
      `Need help with ${brandName} bookings?`
    ),
    supportBlurb: settingValue(
      settings,
      "supportBlurb",
      `Contact ${brandName} for booking help, payment follow-up, ticket access, and service updates${placeLabel}.`
    ),
    featureOneTitle: settingValue(settings, "featureOneTitle", ""),
    featureOneBody: settingValue(settings, "featureOneBody", ""),
    featureTwoTitle: settingValue(settings, "featureTwoTitle", ""),
    featureTwoBody: settingValue(settings, "featureTwoBody", ""),
    featureThreeTitle: settingValue(settings, "featureThreeTitle", ""),
    featureThreeBody: settingValue(settings, "featureThreeBody", ""),
    promoHeadline: settingValue(
      settings,
      "promoHeadline",
      `${brandName} featured offers`
    ),
    promoBody: settingValue(
      settings,
      "promoBody",
      `${brandName} can spotlight important routes, stay deals, and travel campaigns directly on its storefront.`
    )
  };
}

module.exports = {
  PLATFORM_CONTEXT,
  serializePublicTenantContext
};
