const { TYPE_ORDER, serializeTrip } = require("./tripSerializer");
const { fetchMarketplaceTrips } = require("./tripQueries");
const { serializePublicTenantContext } = require("../context");

const TYPE_LABELS = {
  bus: "Buses",
  hotel: "Hotels",
  flight: "Flights",
  train: "Trains",
  more: "More services"
};

const TYPE_ICONS = {
  bus: "fa-solid fa-bus",
  hotel: "fa-solid fa-hotel",
  flight: "fa-solid fa-plane",
  train: "fa-solid fa-train",
  more: "fa-solid fa-sparkles"
};

const TYPE_BADGES = {
  bus: "badgeInfo",
  hotel: "badgeOk",
  flight: "badgeWarn",
  train: "badgeHot",
  more: "badgeInfo"
};

function typeLabel(type = "") {
  return TYPE_LABELS[type] || TYPE_LABELS.more;
}

function typeIcon(type = "") {
  return TYPE_ICONS[type] || TYPE_ICONS.more;
}

function typeBadgeTone(type = "") {
  return TYPE_BADGES[type] || TYPE_BADGES.more;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function asDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function moneyMetric(items = []) {
  const priced = items.filter((item) => Number(item.basePrice || 0) > 0);
  if (!priced.length) return null;

  const currencies = unique(priced.map((item) => String(item.currency || "").trim().toUpperCase()));
  if (currencies.length !== 1) return null;

  const total = priced.reduce((sum, item) => sum + Number(item.basePrice || 0), 0);
  return {
    currency: currencies[0],
    average: Math.round(total / priced.length),
    lowest: Math.min(...priced.map((item) => Number(item.basePrice || 0))),
    highest: Math.max(...priced.map((item) => Number(item.basePrice || 0)))
  };
}

function listingTitle(item = {}) {
  if (item.title) return item.title;
  if (item.from && item.to) return `${item.from} to ${item.to}`;
  if (item.city && item.type === "hotel") return `${item.city} stay`;
  return "Live listing";
}

function routeLabel(item = {}) {
  if (item.from && item.to) return `${item.from} to ${item.to}`;
  if (item.city && item.country) return `${item.city}, ${item.country}`;
  if (item.city) return item.city;
  if (item.country) return item.country;
  return "Live route";
}

function routeKey(item = {}) {
  const parts = [
    item.type || "",
    item.from || "",
    item.to || "",
    item.city || "",
    item.country || ""
  ];
  return parts.join("|").toLowerCase();
}

function shortListingSummary(item = {}) {
  const remainingSeats = Number(item.remainingSeats || 0);
  const policy = String(item.policy || "").trim();
  const description = String(item.description || "").trim();

  if (description) return description;
  if (policy && remainingSeats > 0) {
    return `${policy} with ${remainingSeats} seats or rooms currently open.`;
  }
  if (policy) return policy;
  if (remainingSeats > 0) {
    return `${remainingSeats} seats or rooms are currently available from the live tenant backend.`;
  }
  return "Live availability and booking support are updated from the backend.";
}

function buildTypeStats(listings = []) {
  return TYPE_ORDER.map((type) => {
    const items = listings.filter((item) => item.type === type);
    const nextDeparture = items
      .map((item) => asDate(item.departureAt))
      .filter(Boolean)
      .sort((a, b) => a - b)[0] || null;
    const price = moneyMetric(items);

    return {
      type,
      label: typeLabel(type),
      icon: typeIcon(type),
      count: items.length,
      partners: unique(items.map((item) => item.partner)).length,
      remainingSeats: items.reduce((sum, item) => sum + Number(item.remainingSeats || 0), 0),
      nextDeparture: nextDeparture ? nextDeparture.toISOString() : "",
      price
    };
  });
}

function buildRouteHighlights(listings = []) {
  const groups = new Map();

  listings.forEach((item) => {
    const key = routeKey(item);
    const current = groups.get(key) || {
      key,
      type: item.type || "bus",
      label: routeLabel(item),
      count: 0,
      remainingSeats: 0,
      nextDeparture: "",
      price: null
    };

    current.count += 1;
    current.remainingSeats += Number(item.remainingSeats || 0);

    const itemDate = asDate(item.departureAt);
    const currentDate = asDate(current.nextDeparture);
    if (itemDate && (!currentDate || itemDate < currentDate)) {
      current.nextDeparture = itemDate.toISOString();
    }

    if (!current.price && Number(item.basePrice || 0) > 0 && item.currency) {
      current.price = {
        amount: Number(item.basePrice || 0),
        currency: item.currency
      };
    } else if (current.price && Number(item.basePrice || 0) > 0 && item.currency === current.price.currency) {
      current.price.amount = Math.min(current.price.amount, Number(item.basePrice || 0));
    }

    groups.set(key, current);
  });

  return [...groups.values()]
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.remainingSeats - a.remainingSeats;
    })
    .slice(0, 8);
}

function buildHero(context, stats, typeStats = []) {
  const activeTypeCount = typeStats.filter((item) => item.count > 0).length;

  return {
    badges: [
      {
        icon: "fa-solid fa-shield-halved",
        label: context.tenantScoped ? `${context.displayName} live storefront` : "Secure checkout"
      },
      {
        icon: "fa-solid fa-clock",
        label: `${stats.departuresNext24h} departures in the next 24h`
      },
      {
        icon: "fa-solid fa-users",
        label: `${stats.partners} partner operations live`
      },
      {
        icon: "fa-solid fa-headset",
        label: context.supportPhone || context.supportEmail || context.supportHeadline
      }
    ],
    stats: [
      {
        value: String(stats.liveListings),
        label: "Live listings"
      },
      {
        value: String(stats.availableNow),
        label: "Seats / rooms open"
      },
      {
        value: String(stats.countries),
        label: "Countries covered"
      },
      {
        value: String(activeTypeCount || stats.types),
        label: "Active booking categories"
      }
    ]
  };
}

function featureCardsFromContext(context = {}) {
  const items = [
    {
      title: context.featureOneTitle,
      body: context.featureOneBody,
      icon: "fa-solid fa-star",
      badge: "Storefront",
      ctaLabel: "Open storefront",
      action: { kind: "url", value: context.searchUrl || context.storefrontUrl || "/" }
    },
    {
      title: context.featureTwoTitle,
      body: context.featureTwoBody,
      icon: "fa-solid fa-sparkles",
      badge: "Experience",
      ctaLabel: "Browse listings",
      action: { kind: "section", value: "bus" }
    },
    {
      title: context.featureThreeTitle,
      body: context.featureThreeBody,
      icon: "fa-solid fa-heart-pulse",
      badge: "Support",
      ctaLabel: "Get help",
      action: { kind: "url", value: context.authUrl || "/support" }
    }
  ];

  return items.filter((item) => item.title && item.body);
}

function generatedPromoCards(typeStats = [], routeHighlights = [], context = {}) {
  const cards = [];

  typeStats
    .filter((item) => item.count > 0)
    .slice(0, 3)
    .forEach((item) => {
      cards.push({
        id: `promo-type-${item.type}`,
        icon: item.icon,
        badge: item.label,
        tone: typeBadgeTone(item.type),
        title: `${item.count} live ${item.label.toLowerCase()}`,
        body: item.remainingSeats
          ? `${item.remainingSeats} seats or rooms are still open, with inventory synced directly from the tenant backend.`
          : `Fresh ${item.label.toLowerCase()} inventory is being managed from the tenant workspace.`,
        ctaLabel: `Browse ${item.label.toLowerCase()}`,
        action: { kind: "section", value: item.type }
      });
    });

  routeHighlights
    .slice(0, 2)
    .forEach((item) => {
      if (cards.length >= 4) return;
      cards.push({
        id: `promo-route-${item.key}`,
        icon: typeIcon(item.type),
        badge: "Top route",
        tone: typeBadgeTone(item.type),
        title: item.label,
        body: item.count > 1
          ? `${item.count} live departures or stays are active on this route right now.`
          : `Live inventory is active on this route and ready for direct booking.`,
        ctaLabel: "View live options",
        action: { kind: "section", value: item.type }
      });
    });

  if (cards.length < 4) {
    cards.push({
      id: "promo-support",
      icon: "fa-solid fa-headset",
      badge: "Help",
      tone: "badgeInfo",
      title: context.supportHeadline || "Need help before you book?",
      body: context.supportBlurb || "Customers can reach support for booking help, ticket access, and payment follow-up.",
      ctaLabel: "Open auth page",
      action: { kind: "url", value: context.authUrl || "/login" }
    });
  }

  return cards.slice(0, 4);
}

function buildPromotionSection(context = {}, typeStats = [], routeHighlights = []) {
  const cards = [...featureCardsFromContext(context), ...generatedPromoCards(typeStats, routeHighlights, context)];

  return {
    headline: context.promoHeadline,
    body: context.promoBody,
    cards: cards.slice(0, 4)
  };
}

function buildGuideCards(listings = []) {
  return listings.slice(0, 4).map((item) => ({
    id: `guide-${item._id}`,
    listingId: item._id,
    sectionId: item.type || "bus",
    type: item.type || "bus",
    image: item.image,
    tag: item.type === "hotel" ? "Stay guide" : item.type === "flight" ? "Flight tips" : item.type === "train" ? "Rail guide" : "Route guide",
    tone: typeBadgeTone(item.type),
    title: `${routeLabel(item)}: what to know before you book`,
    excerpt: shortListingSummary(item),
    departureAt: item.departureAt || "",
    location: routeLabel(item),
    partner: item.partner || "Classic Trip Partner",
    price: Number(item.basePrice || 0) > 0
      ? {
          amount: Number(item.basePrice || 0),
          currency: item.currency || "UGX"
        }
      : null
  }));
}

function buildGuideSection(context = {}, listings = []) {
  return {
    headline: context.marketplaceIntro || "Travel stories and route guidance from live inventory",
    body: context.marketplaceSubtitle,
    cards: buildGuideCards(listings)
  };
}

function buildSupportSection(context = {}) {
  return {
    headline: context.supportHeadline,
    blurb: context.supportBlurb,
    email: context.supportEmail,
    phone: context.supportPhone,
    authUrl: context.authUrl,
    searchUrl: context.searchUrl,
    portalUrl: context.portalUrl
  };
}

function buildFooterSection(context = {}, stats = {}) {
  return {
    brandBlurb: context.marketplaceIntro || context.marketplaceSubtitle,
    note: context.tenantScoped
      ? `${context.displayName} is publishing live inventory, customer support, and checkout through its own tenant workspace.`
      : "Classic Trip combines live inventory, public booking, support, and partner operations in one multi-tenant travel platform.",
    legalLine: `${stats.liveListings} live listings · ${stats.availableNow} places open · tenant-backed availability`
  };
}

async function buildMarketplaceBootstrap(tenant = null) {
  const context = serializePublicTenantContext(tenant);
  const listings = await fetchMarketplaceTrips(80, {
    tenantId: tenant?._id || "",
    tenantSlug: tenant?.slug || ""
  });

  const featured = TYPE_ORDER.reduce((acc, type) => {
    acc[type] = listings.filter((item) => item.type === type).slice(0, 12);
    return acc;
  }, {});

  const countries = unique(listings.map((item) => item.country)).sort();
  const departuresNext24h = listings.filter((item) => {
    const departure = asDate(item.departureAt);
    if (!departure) return false;
    const diff = departure.getTime() - Date.now();
    return diff >= 0 && diff <= 24 * 60 * 60 * 1000;
  }).length;

  const stats = {
    liveListings: listings.length,
    countries: countries.length,
    types: TYPE_ORDER.length,
    partners: unique(listings.map((item) => item.partner || item.tenantSlug || item.tenantId)).length,
    availableNow: listings.reduce((sum, item) => sum + Number(item.remainingSeats || 0), 0),
    departuresNext24h
  };

  const typeStats = buildTypeStats(listings);
  const routeHighlights = buildRouteHighlights(listings);

  return {
    generatedAt: new Date().toISOString(),
    tenant: context,
    stats,
    hero: buildHero(context, stats, typeStats),
    typeStats,
    routeHighlights,
    promotions: buildPromotionSection(context, typeStats, routeHighlights),
    guides: buildGuideSection(context, listings),
    support: buildSupportSection(context),
    footer: buildFooterSection(context, stats),
    countries,
    featured,
    all: listings
  };
}

module.exports = {
  buildMarketplaceBootstrap,
  fetchMarketplaceTrips,
  serializeTrip,
  TYPE_ORDER
};
