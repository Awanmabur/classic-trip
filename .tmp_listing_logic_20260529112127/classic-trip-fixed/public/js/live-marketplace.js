(function liveMarketplace(global) {
  const ct = global.ClassicTrip;
  if (!ct) return;
  const tenantContext = ct.PUBLIC_TENANT_CONTEXT || null;
  const routeParams = new URLSearchParams(global.location.search);
  const requestedTripId = String(global.__OPEN_TRIP_ID__ || routeParams.get("tripId") || routeParams.get("listing") || "").trim();
  const requestedGuestBookingCode = String(global.__GUEST_BOOKING_CODE__ || routeParams.get("guestBooking") || "").trim();
  const requestedSection = String(global.__MARKETPLACE_START_SECTION__ || routeParams.get("section") || "").trim();

  const CATEGORY_IDS = {
    bus: "cards",
    hotel: "hotelCards",
    flight: "flightCards",
    train: "trainCards",
    more: "moreCards"
  };

  const CITY_CODES = {
    kampala: "ug",
    entebbe: "ug",
    jinja: "ug",
    gulu: "ug",
    mukono: "ug",
    murchison: "ug",
    uganda: "ug",
    nairobi: "ke",
    mombasa: "ke",
    kenya: "ke",
    kigali: "rw",
    rwanda: "rw",
    arusha: "tz",
    zanzibar: "tz",
    morogoro: "tz",
    "dar es salaam": "tz",
    tanzania: "tz",
    bujumbura: "bi",
    burundi: "bi",
    juba: "ss",
    "south sudan": "ss",
    "addis ababa": "et",
    ethiopia: "et",
    djibouti: "dj",
    mogadishu: "so",
    somalia: "so",
    goma: "drc",
    "dr congo": "drc",
    congo: "drc"
  };

  const state = {
    bootstrap: null,
    masterListings: [],
    searchListings: null,
    categoryFilter: "all",
    routeFilter: "all",
    visible: {
      bus: 6,
      hotel: 6,
      flight: 6,
      train: 6,
      more: 6
    },
    current: null,
    seatMap: null,
    selected: new Set(),
    heldByYou: new Set(),
    holdExpiresAt: null,
    holdTimer: null,
    addons: new Set(),
    guestBookings: loadGuestBookings(),
    savedIds: loadSavedIds(),
    bookingIndex: new Map()
  };

  const BOOKING_ROLES = new Set(["customer", "promoter", "admin", "super_admin"]);
  const HOLD_ROLES = new Set(["customer", "promoter", "admin", "super_admin"]);

  function $(selector, root = document) {
    return root.querySelector(selector);
  }

  function applyBrandTheme() {
    if (!tenantContext?.tenantScoped) return;
    const root = global.document.documentElement;
    if (tenantContext.primaryColor) root.style.setProperty("--primary", tenantContext.primaryColor);
    if (tenantContext.accentColor) root.style.setProperty("--accent", tenantContext.accentColor);
    if (tenantContext.hotColor) root.style.setProperty("--hot", tenantContext.hotColor);
  }

  function applyTenantMarketplaceBranding() {
    if (!tenantContext?.tenantScoped) return;

    const brandName = tenantContext.displayName || "Classic Trip";
    const shortName = tenantContext.shortName || "CT";
    const title = tenantContext.marketplaceTitle || `Book directly with ${brandName}.`;
    const subtitle = tenantContext.marketplaceSubtitle || `Live bookings and inventory from ${brandName}.`;
    const footerText = `${brandName} operates on the Classic Trip tenant platform with live schedules, checkout, customer support, and inventory updates.`;

    global.document.title = `${brandName} | Marketplace`;
    global.document.querySelector('meta[name="description"]')?.setAttribute("content", subtitle);
    global.document.querySelectorAll(".brand span:last-child").forEach((node) => {
      node.textContent = brandName;
    });
    global.document.querySelectorAll(".mark").forEach((node) => {
      node.textContent = shortName;
    });
    const heroTitle = global.document.querySelector(".heroTitle");
    if (heroTitle) heroTitle.textContent = title;
    const heroSub = global.document.querySelector(".heroSub");
    if (heroSub) heroSub.textContent = subtitle;
    const topBadge = global.document.querySelector(".heroBadgesTop .badge");
    if (topBadge) {
      topBadge.innerHTML = `<i class="fa-solid fa-building"></i> ${ct.escapeHtml(tenantContext.businessType || "Tenant storefront")}`;
    }
    const footerBrandText = global.document.querySelector("footer .brand + p");
    if (footerBrandText) footerBrandText.textContent = footerText;
    const footerBottom = global.document.querySelector(".footerBottom span");
    if (footerBottom) footerBottom.textContent = `(c) 2026 ${brandName}. Tenant storefront powered by Classic Trip.`;
  }

  function setReady() {
    document.documentElement.dataset.liveMarketplace = "ready";
  }

  function toast(message) {
    const node = document.getElementById("toast");
    if (!node) return;
    node.textContent = message;
    node.classList.add("show");
    global.setTimeout(() => node.classList.remove("show"), 2400);
  }

  function closeBlog() {
    const modal = document.getElementById("blogModal");
    if (modal) modal.classList.remove("open");
  }

  function corridorCode(item) {
    const fromCode = placeCode(item.from || item.city || item.country);
    const toCode = placeCode(item.to || item.city || item.country);

    if (!fromCode && !toCode) return "regional";
    if (fromCode && toCode && fromCode === toCode) return `${fromCode}-local`;
    if (fromCode && toCode) return [fromCode, toCode].sort().join("-");
    return `${fromCode || toCode}-local`;
  }

  function placeCode(value) {
    const raw = String(value || "").trim().toLowerCase();
    return CITY_CODES[raw] || "";
  }

  function enrichListing(item) {
    return {
      ...item,
      group: CATEGORY_IDS[item.type] ? item.type : "more",
      corridor: corridorCode(item)
    };
  }

  function loadSavedIds() {
    try {
      return JSON.parse(global.localStorage.getItem("ct_saved_listing_ids") || "[]");
    } catch (_err) {
      return [];
    }
  }

  function saveSavedIds() {
    global.localStorage.setItem("ct_saved_listing_ids", JSON.stringify(state.savedIds));
  }

  function loadGuestBookings() {
    try {
      return JSON.parse(global.localStorage.getItem("ct_guest_bookings") || "[]");
    } catch (_err) {
      return [];
    }
  }

  function saveGuestBookings() {
    global.localStorage.setItem("ct_guest_bookings", JSON.stringify(state.guestBookings));
  }

  function scrollToSection(id) {
    const node = document.getElementById(id);
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function applyRouteIntent() {
    if (requestedSection) {
      scrollToSection(requestedSection);
    }

    if (requestedGuestBookingCode) {
      try {
        const response = await ct.api(`/api/public/bookings/guest/${encodeURIComponent(requestedGuestBookingCode)}`);
        const booking = normalizeBooking(response.booking || {});
        renderBookings([booking]);
        scrollToSection("my-bookings");
        renderReceipt(booking);
      } catch (err) {
        toast(err.message);
      }
    }

    if (requestedTripId) {
      await global.openListing(requestedTripId, false);
    }
  }

  function safeArray(items) {
    return Array.isArray(items) ? items : [];
  }

  function typeLabel(type) {
    return {
      bus: "Buses",
      hotel: "Hotels",
      flight: "Flights",
      train: "Trains",
      more: "More services"
    }[type] || "Live services";
  }

  function typeTone(type) {
    return {
      bus: "badgeInfo",
      hotel: "badgeOk",
      flight: "badgeWarn",
      train: "badgeHot"
    }[type] || "badgeInfo";
  }

  function metricText(metric, fallback = "Live pricing") {
    if (!metric?.currency || !Number.isFinite(Number(metric.amount ?? metric.average))) {
      return fallback;
    }
    return ct.fmtMoney(metric.currency, Number(metric.amount ?? metric.average));
  }

  function renderHeroSurface(payload = {}) {
    const hero = payload.hero || {};
    const badges = safeArray(hero.badges);
    const stats = safeArray(hero.stats);

    const badgeWrap = document.querySelector(".heroBadgesTop");
    if (badgeWrap && badges.length) {
      badgeWrap.innerHTML = badges.map((item, index) => `
        <span class="chip ${index === 0 ? "active" : ""}">
          <i class="${ct.escapeHtml(item.icon || "fa-solid fa-circle-info")}"></i> ${ct.escapeHtml(item.label || "Live update")}
        </span>
      `).join("");
    }

    const statsWrap = document.querySelector(".stats");
    if (statsWrap && stats.length) {
      statsWrap.innerHTML = stats.map((item) => `
        <div class="stat">
          <b>${ct.escapeHtml(String(item.value || "0"))}</b>
          <span>${ct.escapeHtml(item.label || "Live metric")}</span>
        </div>
      `).join("");
    }
  }

  function renderTypeSummaries(payload = {}) {
    const typeStats = new Map(safeArray(payload.typeStats).map((item) => [item.type, item]));
    [
      { sectionId: "bus", type: "bus" },
      { sectionId: "hotel", type: "hotel" },
      { sectionId: "flight", type: "flight" },
      { sectionId: "train", type: "train" }
    ].forEach(({ sectionId, type }) => {
      const node = document.querySelector(`#${sectionId} .sectionHead p`);
      const stats = typeStats.get(type);
      if (!node || !stats) return;

      const pieces = [];
      if (stats.count) pieces.push(`${stats.count} live ${typeLabel(type).toLowerCase()}`);
      if (stats.remainingSeats) pieces.push(`${stats.remainingSeats} places still open`);
      if (stats.price) pieces.push(`from ${metricText({ amount: stats.price.lowest, currency: stats.price.currency })}`);
      if (stats.nextDeparture) pieces.push(`next ${ct.fmtDate(stats.nextDeparture)}`);
      node.textContent = pieces.join(" - ") || "Live availability is synced from the backend.";
    });

    const moreNode = document.querySelector("#more .sectionHead p");
    if (moreNode) {
      const routes = safeArray(payload.routeHighlights);
      moreNode.textContent = routes.length
        ? `${routes.length} backend route summaries and expansion-ready services are already being tracked.`
        : "Expansion-ready services will appear here as backend inventory grows.";
    }
  }

  function promoCardMarkup(card = {}) {
    return `
      <article class="promoCard">
        <div class="promoIcon"><i class="${ct.escapeHtml(card.icon || "fa-solid fa-sparkles")}"></i></div>
        <span class="badge ${ct.escapeHtml(card.tone || "badgeInfo")}">${ct.escapeHtml(card.badge || "Live")}</span>
        <h3>${ct.escapeHtml(card.title || "Storefront update")}</h3>
        <p>${ct.escapeHtml(card.body || "This card is generated from the tenant backend and storefront settings.")}</p>
        <button
          class="btn btnGhost"
          type="button"
          data-marketplace-action="${ct.escapeHtml(card.action?.kind || "section")}"
          data-marketplace-value="${ct.escapeHtml(card.action?.value || "bus")}"
        >
          ${ct.escapeHtml(card.ctaLabel || "Explore")}
        </button>
      </article>
    `;
  }

  function renderPromotions(payload = {}) {
    const section = payload.promotions || {};
    const cards = safeArray(section.cards);
    const introTitle = document.querySelector("#ads .pageIntro h3");
    const introBody = document.querySelector("#ads .pageIntro p");
    const introButton = document.querySelector("#ads .pageIntro .btn");
    const cardsWrap = document.getElementById("adsCards");

    if (introTitle) introTitle.textContent = section.headline || "Promotion center";
    if (introBody) introBody.textContent = section.body || "Featured routes, storefront content, and promoted inventory show up here from live backend data.";
    if (introButton) {
      introButton.innerHTML = '<i class="fa-solid fa-store"></i> Explore live inventory';
      introButton.onclick = (event) => {
        event.preventDefault();
        scrollToSection("bus");
      };
    }
    if (cardsWrap) {
      cardsWrap.innerHTML = cards.length
        ? cards.map(promoCardMarkup).join("")
        : emptyCard("No featured promotions have been configured yet.");
    }
  }

  function guideCardMarkup(card = {}) {
    const price = card.price ? metricText({ amount: card.price.amount, currency: card.price.currency }, "") : "";
    return `
      <article class="promoCard blogCard">
        <div class="blogImage">
          <img src="${ct.escapeHtml(card.image || "")}" alt="${ct.escapeHtml(card.title || "Travel guide")}">
          <span class="badge ${ct.escapeHtml(card.tone || "badgeInfo")} blogTag">${ct.escapeHtml(card.tag || "Guide")}</span>
          <div class="blogIconActions">
            <button class="miniIcon" type="button" title="Open" data-marketplace-action="trip" data-marketplace-value="${ct.escapeHtml(card.listingId || "")}">
              <i class="fa-regular fa-eye"></i>
            </button>
            <button class="miniIcon" type="button" title="Save" onclick="saveListing('${ct.escapeHtml(card.listingId || "")}')">
              <i class="fa-regular fa-heart"></i>
            </button>
            <button class="miniIcon" type="button" title="Share" onclick="shareListing('${ct.escapeHtml(card.listingId || "")}')">
              <i class="fa-solid fa-share-nodes"></i>
            </button>
          </div>
        </div>
        <div class="blogBody">
          <h3>${ct.escapeHtml(card.title || "Travel guide")}</h3>
          <div class="blogMeta">
            <span><i class="fa-regular fa-calendar"></i> ${ct.escapeHtml(card.departureAt ? ct.fmtDate(card.departureAt) : "Live update")}</span>
            <span><i class="fa-solid fa-location-dot"></i> ${ct.escapeHtml(card.location || "Travel route")}</span>
            <span><i class="fa-solid fa-building"></i> ${ct.escapeHtml(price || card.partner || "Tenant inventory")}</span>
          </div>
          <p>${ct.escapeHtml(card.excerpt || "Helpful travel details generated from live tenant data.")}</p>
          <div class="blogActions">
            <button class="btn btnGhost" type="button" data-marketplace-action="trip" data-marketplace-value="${ct.escapeHtml(card.listingId || "")}">
              <i class="fa-regular fa-eye"></i> Open live listing
            </button>
          </div>
        </div>
      </article>
    `;
  }

  function renderGuides(payload = {}) {
    const section = payload.guides || {};
    const cards = safeArray(section.cards);
    const introTitle = document.querySelector("#blogs .pageIntro h3");
    const introBody = document.querySelector("#blogs .pageIntro p");
    const introButton = document.querySelector("#blogs .pageIntro .btn");
    const cardsWrap = document.getElementById("blogCards");

    if (introTitle) introTitle.textContent = section.headline || "Travel guidance from live listings";
    if (introBody) introBody.textContent = section.body || "The strongest routes and upcoming departures are turned into quick guide cards here.";
    if (introButton) {
      introButton.innerHTML = '<i class="fa-solid fa-headset"></i> Get booking help';
      introButton.onclick = (event) => {
        event.preventDefault();
        global.location.href = tenantContext?.authUrl || "/support";
      };
    }
    if (cardsWrap) {
      cardsWrap.innerHTML = cards.length
        ? cards.map(guideCardMarkup).join("")
        : emptyCard("Guides will appear automatically when live listings are available.");
    }
  }

  function renderFooterSurface(payload = {}) {
    const support = payload.support || {};
    const footer = payload.footer || {};
    const brandText = document.querySelector(".footerBrand p");
    if (brandText) brandText.textContent = footer.brandBlurb || tenantContext?.marketplaceIntro || tenantContext?.marketplaceSubtitle || brandText.textContent;

    const brandItems = document.querySelectorAll(".footerBrand span");
    if (brandItems[0]) {
      brandItems[0].innerHTML = `<i class="fa-solid fa-shield-halved"></i> ${ct.escapeHtml(support.headline || "Secure checkout and live help")}`;
    }
    if (brandItems[1]) {
      brandItems[1].innerHTML = `<i class="fa-solid fa-envelope"></i> ${ct.escapeHtml(support.email || support.phone || "Customer support ready")}`;
    }
    if (brandItems[2]) {
      brandItems[2].innerHTML = `<i class="fa-solid fa-circle-info"></i> ${ct.escapeHtml(support.blurb || footer.note || "Live tenant-backed storefront support is active.")}`;
    }

    const footerBottom = document.querySelectorAll(".footerBottom span");
    if (footerBottom[0]) {
      footerBottom[0].textContent = `(c) 2026 ${tenantContext?.displayName || "Classic Trip"}. ${footer.note || "Live storefront powered by Classic Trip."}`;
    }
    if (footerBottom[1]) {
      footerBottom[1].textContent = footer.legalLine || `${payload.stats?.liveListings || 0} live listings, direct support, and tenant-backed inventory`;
    }
  }

  function renderBootstrapContent(payload = {}) {
    renderHeroSurface(payload);
    renderTypeSummaries(payload);
    renderPromotions(payload);
    renderGuides(payload);
    renderFooterSurface(payload);
  }

  function performMarketplaceAction(kind, value) {
    if (!kind) return;
    if (kind === "section") {
      scrollToSection(value || "bus");
      return;
    }
    if (kind === "trip" && value) {
      global.openListing?.(value, false);
      return;
    }
    if (kind === "url" && value) {
      global.location.href = value;
    }
  }

  function wireTopBar() {
    const loginButton = document.querySelector(".navActions .login");
    const startButton = document.querySelector(".navActions .btnPrimary");
    const user = ct.getUser();

    if (loginButton) {
      loginButton.addEventListener("click", () => {
        global.location.href = user ? ct.dashboardPathForRole(user.role) : "/login";
      });
      loginButton.innerHTML = user
        ? '<i class="fa-solid fa-gauge-high"></i> Dashboard'
        : '<i class="fa-regular fa-user"></i> Login';
    }

    if (startButton) {
      startButton.addEventListener("click", (event) => {
        event.preventDefault();
        scrollToSection("bus");
      });
    }
  }

  function addonOptions(type) {
    if (type === "flight") {
      return [
        { key: "baggage", label: "Extra baggage 20kg", price: 90000 },
        { key: "meal", label: "Preferred meal", price: 35000 }
      ];
    }
    if (type === "hotel") {
      return [
        { key: "breakfast", label: "Breakfast", price: 25000 },
        { key: "pickup", label: "Airport pickup", price: 70000 }
      ];
    }
    return [
      { key: "insurance", label: "Travel insurance", price: 5000 },
      { key: "luggage", label: "Extra luggage", price: 10000 }
    ];
  }

  function currentPool() {
    return state.searchListings || state.masterListings;
  }

  function activeSelection() {
    return [...new Set([...state.heldByYou, ...state.selected])];
  }

  function addonTotal() {
    return addonOptions(state.current?.type || "bus")
      .filter((item) => state.addons.has(item.key))
      .reduce((sum, item) => sum + item.price, 0);
  }

  function listingMarkup(item) {
    const selected = state.savedIds.includes(item._id);
    const price = ct.fmtMoney(item.currency, item.basePrice);
    const remaining = item.remainingSeats ?? 0;
    const rating = item.ratingAvg > 0 ? item.ratingAvg.toFixed(1) : "New";
    const availableBadge = remaining > 0 ? "available" : "full";
    const badgeText = remaining > 0 ? `${remaining} left` : "Sold out";

    return `
      <article class="listing revealIn" data-id="${ct.escapeHtml(item._id)}" tabindex="0">
        <div class="thumb">
          <img src="${ct.escapeHtml(item.image)}" alt="${ct.escapeHtml(item.title)}">
          <div class="cornerBadge ${availableBadge}">${ct.escapeHtml(badgeText)}</div>
          <div class="thumbBadges">
            <span class="badge badgeInfo"><i class="fa-solid fa-star"></i> ${ct.escapeHtml(rating)}</span>
            <span class="badge badgeOk"><i class="fa-solid fa-shield-halved"></i> Live</span>
          </div>
          <div class="thumbActions">
            <button class="miniIcon" type="button" onclick="saveListing('${ct.escapeHtml(item._id)}');event.stopPropagation();" title="Save">
              <i class="${selected ? "fa-solid" : "fa-regular"} fa-heart"></i>
            </button>
            <button class="miniIcon" type="button" onclick="shareListing('${ct.escapeHtml(item._id)}');event.stopPropagation();" title="Share">
              <i class="fa-solid fa-share-nodes"></i>
            </button>
          </div>
        </div>
        <div class="listingBody">
          <h3 class="listingTitle">${ct.escapeHtml(item.title)}</h3>
          <div class="meta">
            <span><i class="fa-regular fa-clock"></i> ${ct.escapeHtml(ct.fmtDate(item.departureAt))}</span>
            <span><i class="fa-solid fa-building"></i> ${ct.escapeHtml(item.partner)}</span>
          </div>
          <p class="desc">${ct.escapeHtml(item.description || item.policy || "Book directly from live backend data.")}</p>
          <div class="priceRow">
            <div>
              <div class="price">${ct.escapeHtml(price)}</div>
              <div class="small">${ct.escapeHtml(item.from || item.city || "Classic Trip")} to ${ct.escapeHtml(item.to || item.city || "destination")}</div>
            </div>
            <div class="actions">
              <button class="btn btnGhost" type="button" onclick="openListing('${ct.escapeHtml(item._id)}');event.stopPropagation();">
                <i class="fa-regular fa-eye"></i> Details
              </button>
              <button class="btn btnPrimary" type="button" onclick="openListing('${ct.escapeHtml(item._id)}', true);event.stopPropagation();">
                <i class="fa-solid fa-ticket"></i> Book
              </button>
            </div>
          </div>
        </div>
      </article>
    `;
  }

  function emptyCard(message) {
    return `
      <article class="ticketCard">
        <div class="ticketTop">
          <div>
            <span class="badge badgeInfo"><i class="fa-solid fa-circle-info"></i> Empty</span>
            <h3 class="ticketTitle" style="margin-top:8px">${ct.escapeHtml(message)}</h3>
          </div>
        </div>
      </article>
    `;
  }

  function renderGroups(items) {
    const grouped = {
      bus: items.filter((item) => item.group === "bus"),
      hotel: items.filter((item) => item.group === "hotel"),
      flight: items.filter((item) => item.group === "flight"),
      train: items.filter((item) => item.group === "train"),
      more: items.filter((item) => !["bus", "hotel", "flight", "train"].includes(item.group))
    };

    Object.entries(CATEGORY_IDS).forEach(([group, containerId]) => {
      const container = document.getElementById(containerId);
      const moreButton = document.getElementById(`more-${group}`);
      if (!container) return;

      const visibleCount = state.visible[group] || 6;
      const groupItems = grouped[group].slice(0, visibleCount);
      container.innerHTML = groupItems.length
        ? groupItems.map(listingMarkup).join("")
        : emptyCard(group === "more" ? "More services will appear when backend inventory expands." : "No live listings match the current filters.");

      if (moreButton) {
        moreButton.classList.toggle("hide", grouped[group].length <= visibleCount);
      }
    });

    renderSaved();
  }

  function applyFilters() {
    const filtered = currentPool()
      .filter((item) => state.categoryFilter === "all" || item.group === state.categoryFilter)
      .filter((item) => state.routeFilter === "all" || item.corridor === state.routeFilter);

    renderGroups(filtered);
  }

  function syncActiveButtons(selector, predicate) {
    document.querySelectorAll(selector).forEach((button) => {
      button.classList.toggle("active", predicate(button));
    });
  }

  function searchParams() {
    const type = document.querySelector("#searchTabs .tab.active")?.dataset.type || "";
    return {
      type,
      from: String(document.getElementById("fromInput")?.value || "").trim(),
      to: String(document.getElementById("toInput")?.value || "").trim(),
      city: String(document.getElementById("cityInput")?.value || "").trim(),
      date: String(document.getElementById("dateInput")?.value || "").trim()
    };
  }

  function writeSearchQuery(params) {
    const next = new URL(global.location.href);
    ["type", "from", "to", "city", "date"].forEach((key) => {
      if (params[key]) next.searchParams.set(key, params[key]);
      else next.searchParams.delete(key);
    });
    global.history.replaceState({}, "", `${next.pathname}${next.search}`);
  }

  function hydrateSearchFromQuery() {
    const params = new URLSearchParams(global.location.search);
    const type = params.get("type");
    if (type) {
      document.querySelectorAll("#searchTabs .tab").forEach((button) => {
        button.classList.toggle("active", button.dataset.type === type);
      });
    }
    if (params.get("from")) document.getElementById("fromInput").value = params.get("from");
    if (params.get("to")) document.getElementById("toInput").value = params.get("to");
    if (params.get("city")) document.getElementById("cityInput").value = params.get("city");
    if (params.get("date")) document.getElementById("dateInput").value = params.get("date");
  }

  function normalizeApiTrip(trip) {
    if (trip && trip.title && trip.vehicle && !trip.routeId) {
      return enrichListing({
        ...trip,
        _id: String(trip._id),
        basePrice: Number(trip.basePrice || 0),
        bookedSeats: Number(trip.bookedSeats || 0),
        heldSeats: Number(trip.heldSeats || 0),
        remainingSeats: Number(
          trip.remainingSeats != null
            ? trip.remainingSeats
            : Math.max(0, Number(trip.totalSeats || 0) - Number(trip.bookedSeats || 0) - Number(trip.heldSeats || 0))
        ),
        vehicle: {
          id: trip.vehicle?.id ? String(trip.vehicle.id) : "",
          name: trip.vehicle?.name || "",
          type: trip.vehicle?.type || trip.type || "bus",
          layoutName: trip.vehicle?.layoutName || "",
          rows: Number(trip.vehicle?.rows || 0),
          cols: Number(trip.vehicle?.cols || 0)
        }
      });
    }

    const route = trip.routeId || {};
    const vehicle = trip.vehicleId || {};
    return enrichListing({
      _id: String(trip._id),
      type: route.type || "bus",
      title: route.title || `${route.from || route.city || "Classic"} ⇄ ${route.to || route.city || "Trip"}`,
      description: route.description || "",
      country: route.country || "",
      city: route.city || "",
      from: route.from || route.city || "",
      to: route.to || route.city || "",
      partner: vehicle.name || "Classic Trip Partner",
      departureAt: trip.departureAt,
      arriveAt: trip.arriveAt,
      basePrice: Number(trip.basePrice || 0),
      currency: trip.currency || route.currency || "UGX",
      policy: route.policy || "Instant confirmation",
      ratingAvg: Number(route.ratingAvg || 0),
      ratingCount: Number(route.ratingCount || 0),
      totalSeats: Number(trip.totalSeats || vehicle.totalSeats || 0),
      bookedSeats: Number(trip.bookedSeats || 0),
      heldSeats: Number(trip.heldSeats || 0),
      remainingSeats: Math.max(0, Number(trip.totalSeats || 0) - Number(trip.bookedSeats || 0) - Number(trip.heldSeats || 0)),
      image:
        route.images?.[0]?.url ||
        "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=70",
      vehicle: {
        id: vehicle._id ? String(vehicle._id) : "",
        name: vehicle.name || "",
        type: vehicle.type || route.type || "bus",
        layoutName: vehicle.layoutName || "",
        rows: Number(vehicle.rows || 0),
        cols: Number(vehicle.cols || 0)
      }
    });
  }

  async function runSearch(initial = false) {
    const params = searchParams();
    const hasSearch = Object.values(params).some(Boolean);
    writeSearchQuery(params);

    if (!hasSearch) {
      state.searchListings = null;
      applyFilters();
      if (!initial) toast("Showing live marketplace inventory");
      return;
    }

    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    query.set("limit", "50");

    try {
      const response = await ct.api(`/api/public/trips?${query.toString()}`);
      state.searchListings = (response.items || []).map(normalizeApiTrip);
      applyFilters();
      const first = state.searchListings[0];
      if (first) scrollToSection(first.group || "bus");
      toast(`${response.total || state.searchListings.length} live results loaded`);
    } catch (err) {
      toast(err.message);
    }
  }

  function buildSeatCells(vehicle) {
    const seats = Array.isArray(vehicle?.seats) && vehicle.seats.length
      ? vehicle.seats
      : buildFallbackSeats(vehicle?.rows || 4, vehicle?.cols || 4);
    const rows = Math.max(...seats.map((seat) => Number(seat.row || 1)), vehicle?.rows || 1);
    const cols = Math.max(...seats.map((seat) => Number(seat.col || 1)), vehicle?.cols || 1);
    return { seats, rows, cols };
  }

  function buildFallbackSeats(rows, cols) {
    const items = [];
    for (let row = 1; row <= rows; row += 1) {
      for (let col = 1; col <= cols; col += 1) {
        items.push({
          id: `${String.fromCharCode(64 + row)}${col}`,
          row,
          col
        });
      }
    }
    return items;
  }

  function renderLayout() {
    const layoutBox = document.getElementById("layoutBox");
    if (!layoutBox || !state.seatMap) return;

    const availability = state.seatMap.availability || {};
    const booked = new Set(availability.bookedSeats || []);
    const held = new Set((availability.heldSeats || []).filter((seatId) => !state.heldByYou.has(seatId)));
    const layout = buildSeatCells(state.seatMap.vehicle || {});
    const type = state.current?.type || "bus";

    const cells = [];
    for (let row = 1; row <= layout.rows; row += 1) {
      for (let col = 1; col <= layout.cols; col += 1) {
        const seat = layout.seats.find((item) => Number(item.row) === row && Number(item.col) === col);
        if (!seat || seat.isAisle) {
          cells.push('<span class="aisle"></span>');
          continue;
        }

        const id = String(seat.id || seat.label || `${String.fromCharCode(64 + row)}${col}`);
        const taken = booked.has(id);
        const heldElsewhere = held.has(id);
        const selected = state.selected.has(id);
        const mine = state.heldByYou.has(id);
        const className = type === "hotel" ? "room" : "seat";

        cells.push(`
          <button
            class="${className} ${taken ? "taken" : ""} ${heldElsewhere ? "holding" : ""} ${selected ? "selected" : ""} ${mine ? "selected" : ""}"
            type="button"
            ${taken || heldElsewhere ? "disabled" : ""}
            onclick="togglePick('${ct.escapeHtml(id)}')"
          >
            ${ct.escapeHtml(id)}
          </button>
        `);
      }
    }

    layoutBox.innerHTML = `
      <div class="vehicleFront">${ct.escapeHtml((state.seatMap.vehicle?.name || "Vehicle").toUpperCase())}</div>
      <div style="display:grid;grid-template-columns:repeat(${layout.cols}, minmax(42px, 1fr));gap:8px;justify-content:center">
        ${cells.join("")}
      </div>
    `;
  }

  function updateSummary() {
    const chosen = activeSelection();
    const quantity = chosen.length;
    const base = quantity * Number(state.current?.basePrice || 0);
    const fee = Math.round(base * 0.07);
    const total = base + fee + addonTotal();

    const setText = (id, value) => {
      const node = document.getElementById(id);
      if (node) node.textContent = value;
    };

    setText("selectedOut", quantity ? chosen.join(", ") : "None");
    setText("baseOut", ct.fmtMoney(state.current?.currency, base));
    setText("feeOut", ct.fmtMoney(state.current?.currency, fee));
    setText("totalOut", ct.fmtMoney(state.current?.currency, total));
    setText("checkoutListing", state.current?.title || "-");
    setText("checkoutSelected", quantity ? chosen.join(", ") : "-");
    setText("checkoutTotal", ct.fmtMoney(state.current?.currency, total));
  }

  function renderAddons() {
    const node = document.getElementById("addons");
    if (!node) return;
    const items = addonOptions(state.current?.type || "bus");
    node.innerHTML = items.map((item) => `
      <label class="addon">
        <span><input type="checkbox" value="${item.key}" ${state.addons.has(item.key) ? "checked" : ""} onchange="calc()"> ${ct.escapeHtml(item.label)}</span>
        <b>${ct.escapeHtml(ct.fmtMoney(state.current?.currency, item.price))}</b>
      </label>
    `).join("");
  }

  function updateModalContent() {
    if (!state.current) return;
    const item = state.current;
    const setHtml = (id, value) => {
      const node = document.getElementById(id);
      if (node) node.innerHTML = value;
    };
    const setText = (id, value) => {
      const node = document.getElementById(id);
      if (node) node.textContent = value;
    };

    setHtml("modalType", `<i class="fa-solid fa-ticket"></i> ${ct.escapeHtml(item.type)}`);
    setText("modalTitle", item.title);
    setText("modalSub", `${item.partner} - ${item.from || item.city || "Classic Trip"} -> ${item.to || item.city || "Destination"}`);
    setText("modalHeroTitle", item.title);
    setText("modalHeroSub", item.description || item.policy || "Live trip data from the backend.");
    setText("layoutTitle", item.type === "hotel" ? "Choose room" : "Choose your seat");
    setText("layoutHint", item.type === "hotel" ? "Live room availability from backend inventory." : "Live seat availability from the backend.");
    const image = document.getElementById("modalImg");
    if (image) image.src = item.image;
    renderAddons();
    renderLayout();
    updateSummary();
  }

  function openModal() {
    const modal = document.getElementById("viewModal");
    if (!modal) return;
    modal.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  async function refreshSeatMap() {
    if (!state.current) return;
    const response = await ct.api(`/api/public/seats/trip/${encodeURIComponent(state.current._id)}`);
    state.seatMap = response;
    renderLayout();
    updateSummary();
  }

  function startHoldCountdown() {
    const timer = document.getElementById("timer");
    if (state.holdTimer) global.clearInterval(state.holdTimer);

    if (!state.holdExpiresAt || !timer) {
      timer.textContent = "10:00";
      return;
    }

    function tick() {
      const seconds = Math.max(0, Math.round((state.holdExpiresAt - Date.now()) / 1000));
      const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
      const remainder = String(seconds % 60).padStart(2, "0");
      timer.textContent = `${minutes}:${remainder}`;
      if (seconds <= 0) {
        global.clearInterval(state.holdTimer);
        state.holdTimer = null;
        state.heldByYou.clear();
        state.holdExpiresAt = null;
        refreshSeatMap().catch(() => {});
        toast("Seat hold expired");
      }
    }

    tick();
    state.holdTimer = global.setInterval(tick, 1000);
  }

  function closeModal() {
    const modal = document.getElementById("viewModal");
    if (modal) modal.classList.remove("open");
    document.body.style.overflow = "";
  }

  function closeReceipt() {
    const modal = document.getElementById("receiptModal");
    if (modal) modal.classList.remove("open");
  }

  function bookingCode(booking) {
    return booking.guestLookupCode || `CT-${String(booking._id || "").slice(-6).toUpperCase()}`;
  }

  function normalizeBooking(booking) {
    const title = booking.serviceName
      || booking.tripId?.routeId?.title
      || `${booking.serviceFrom || "Classic"} ⇄ ${booking.serviceTo || "Trip"}`;
    const type = booking.serviceType || booking.tripId?.routeId?.type || "trip";
    const contact = booking.guest?.email || booking.guest?.phone || booking.userId?.email || "";

    return {
      id: String(booking._id || booking.id || bookingCode(booking)),
      code: bookingCode(booking),
      title,
      type,
      selected: Array.isArray(booking.seats) ? booking.seats.map((seat) => seat.seatId).join(", ") : booking.selected || "",
      total: ct.fmtMoney(booking.currency, booking.amount || booking.total || 0),
      customer: booking.guest?.name || booking.customer || "Classic Trip Customer",
      contact,
      date: ct.fmtDate(booking.createdAt || booking.date || booking.travelDate),
      channel: booking.userId ? "Account" : "Guest lookup",
      status: booking.status || "confirmed"
    };
  }

  function renderReceipt(booking) {
    const receiptPaper = document.getElementById("receiptPaper");
    if (!receiptPaper) return;
    document.getElementById("receiptTitle").textContent = booking.title;
    document.getElementById("receiptSub").textContent = `${booking.code} - ${booking.status}`;
    receiptPaper.innerHTML = `
      <div class="receiptRow"><span>Booking code</span><b>${ct.escapeHtml(booking.code)}</b></div>
      <div class="receiptRow"><span>Service</span><b>${ct.escapeHtml(booking.title)}</b></div>
      <div class="receiptRow"><span>Selected</span><b>${ct.escapeHtml(booking.selected || "N/A")}</b></div>
      <div class="receiptRow"><span>Customer</span><b>${ct.escapeHtml(booking.customer)}</b></div>
      <div class="receiptRow"><span>Contact</span><b>${ct.escapeHtml(booking.contact || "N/A")}</b></div>
      <div class="receiptRow"><span>Total</span><b>${ct.escapeHtml(booking.total)}</b></div>
      <div class="receiptRow"><span>Status</span><b>${ct.escapeHtml(booking.status)}</b></div>
      <div class="receiptRow"><span>Channel</span><b>${ct.escapeHtml(booking.channel)}</b></div>
      <div class="receiptRow"><span>Date</span><b>${ct.escapeHtml(booking.date)}</b></div>
    `;
    const modal = document.getElementById("receiptModal");
    if (modal) modal.classList.add("open");
  }

  function renderBookings(items) {
    const node = document.getElementById("bookingCards");
    if (!node) return;
    state.bookingIndex.clear();

    if (!items.length) {
      node.innerHTML = emptyCard("No bookings yet. Complete a live checkout to populate this section.");
      return;
    }

    node.innerHTML = items.map((booking, index) => {
      state.bookingIndex.set(booking.id, booking);
      return `
        <article class="ticketCard">
          <div class="ticketTop">
            <div>
              <span class="badge badgeOk"><i class="fa-solid fa-ticket"></i> ${ct.escapeHtml(booking.status)}</span>
              <h3 class="ticketTitle" style="margin-top:8px">${ct.escapeHtml(booking.title)}</h3>
              <div class="ticketMeta">
                <span><i class="fa-regular fa-clock"></i> ${ct.escapeHtml(booking.date)}</span>
                <span><i class="fa-solid fa-receipt"></i> ${ct.escapeHtml(booking.selected)}</span>
              </div>
            </div>
            <div class="ticketCode">${ct.escapeHtml(booking.code)}</div>
          </div>
          <div class="kv">
            <div><span>Customer</span><b>${ct.escapeHtml(booking.customer)}</b></div>
            <div><span>Total</span><b>${ct.escapeHtml(booking.total)}</b></div>
            <div><span>Channel</span><b>${ct.escapeHtml(booking.channel)}</b></div>
          </div>
          <div class="ticketActions">
            <button class="btn btnGhost" type="button" onclick="openReceipt('${ct.escapeHtml(booking.id)}')"><i class="fa-regular fa-eye"></i> Receipt</button>
            <button class="btn btnPrimary" type="button" onclick="shareBooking('${ct.escapeHtml(booking.id)}')"><i class="fa-solid fa-share-nodes"></i> Share</button>
          </div>
        </article>
      `;
    }).join("");
  }

  function renderSaved() {
    const node = document.getElementById("savedCards");
    if (!node) return;

    const items = state.savedIds
      .map((id) => state.masterListings.find((listing) => listing._id === id))
      .filter(Boolean);

    if (!items.length) {
      node.innerHTML = emptyCard("No saved listings yet. Tap the heart icon on any live listing.");
      return;
    }

    node.innerHTML = items.map((item) => `
      <article class="ticketCard">
        <div class="ticketTop">
          <div>
            <span class="badge badgeHot"><i class="fa-regular fa-heart"></i> Saved</span>
            <h3 class="ticketTitle" style="margin-top:8px">${ct.escapeHtml(item.title)}</h3>
            <div class="ticketMeta">
              <span><i class="fa-solid fa-building"></i> ${ct.escapeHtml(item.partner)}</span>
              <span><i class="fa-regular fa-clock"></i> ${ct.escapeHtml(ct.fmtDate(item.departureAt))}</span>
            </div>
          </div>
          <div class="ticketCode">${ct.escapeHtml(ct.fmtMoney(item.currency, item.basePrice))}</div>
        </div>
        <div class="ticketActions">
          <button class="btn btnGhost" type="button" onclick="saveListing('${ct.escapeHtml(item._id)}')"><i class="fa-solid fa-heart"></i> Remove</button>
          <button class="btn btnPrimary" type="button" onclick="openListing('${ct.escapeHtml(item._id)}', true)"><i class="fa-solid fa-ticket"></i> Book</button>
        </div>
      </article>
    `).join("");
  }

  async function refreshBookings() {
    const user = ct.getUser();

    try {
      if (ct.getToken() && BOOKING_ROLES.has(user?.role)) {
        const response = await ct.api("/api/public/bookings/me");
        renderBookings((response.items || []).map(normalizeBooking));
      } else {
        renderBookings(state.guestBookings);
      }
    } catch (err) {
      renderBookings(state.guestBookings);
    }
  }

  async function bootstrap() {
    applyBrandTheme();
    applyTenantMarketplaceBranding();
    wireTopBar();
    hydrateSearchFromQuery();
    ct.captureReferral();

    try {
      const response = await ct.api("/api/public/marketplace/bootstrap");
      state.bootstrap = response;
      state.masterListings = (response.all || []).map(enrichListing);
      renderBootstrapContent(response);
      applyFilters();
      await refreshBookings();
      if (global.location.search) {
        await runSearch(true);
      }
      await applyRouteIntent();
    } catch (err) {
      toast(err.message);
    } finally {
      setReady();
    }
  }

  global.filterCards = function filterCards(type, button) {
    state.categoryFilter = type;
    syncActiveButtons("#categoryFilters button, #drawerCategoryFilters button", (node) => node === button || node.textContent.toLowerCase().includes(type) || (type === "all" && node.textContent.toLowerCase().includes("all")));
    applyFilters();
  };

  global.filterRoute = function filterRoute(key, button) {
    state.routeFilter = key;
    syncActiveButtons("#routeFilters button, #drawerRouteFilters button", (node) => node === button || node.textContent.toLowerCase().includes(key.replace("-", " ")) || (key === "all" && node.textContent.toLowerCase().includes("all east africa")));
    applyFilters();
  };

  global.showMore = function showMore(group) {
    state.visible[group] = (state.visible[group] || 6) + 6;
    applyFilters();
  };

  global.demoSearch = function demoSearch() {
    runSearch(false);
  };

  global.saveListing = function saveListing(id) {
    if (state.savedIds.includes(id)) {
      state.savedIds = state.savedIds.filter((item) => item !== id);
      toast("Listing removed from saved");
    } else {
      state.savedIds = [...new Set([...state.savedIds, id])];
      toast("Listing saved");
    }
    saveSavedIds();
    applyFilters();
  };

  global.shareListing = async function shareListing(id) {
    const item = state.masterListings.find((listing) => listing._id === id);
    if (!item) return;
    const ref = ct.getUser()?.referralCode || ct.getReferral();
    const url = new URL(`/trip/${id}`, global.location.origin);
    if (ref) url.searchParams.set("ref", ref);

    try {
      if (global.navigator.share) {
        await global.navigator.share({ title: item.title, url: url.toString() });
      } else if (global.navigator.clipboard?.writeText) {
        await global.navigator.clipboard.writeText(url.toString());
      }
      toast("Share link ready");
    } catch (_err) {
      toast("Could not share this listing right now.");
    }
  };

  global.openListing = async function openListing(id, bookNow) {
    const item = state.masterListings.find((listing) => listing._id === id) || state.searchListings?.find((listing) => listing._id === id);
    if (!item) return;

    state.current = item;
    state.selected.clear();
    state.heldByYou.clear();
    state.addons.clear();
    state.holdExpiresAt = null;
    startHoldCountdown();

    try {
      state.seatMap = await ct.api(`/api/public/seats/trip/${encodeURIComponent(id)}`);
      updateModalContent();
      openModal();
      if (bookNow) toast("Live checkout loaded");
    } catch (err) {
      toast(err.message);
    }
  };

  global.togglePick = function togglePick(id) {
    if (state.selected.has(id)) {
      state.selected.delete(id);
    } else {
      state.selected.add(id);
    }
    updateSummary();
    renderLayout();
  };

  global.calc = function calc() {
    state.addons.clear();
    document.querySelectorAll("#addons input:checked").forEach((input) => {
      state.addons.add(String(input.value || "").trim());
    });
    updateSummary();
  };

  global.holdSelection = async function holdSelection() {
    if (!state.current) return;
    if (!ct.getToken()) {
      toast("Login to use the 10 minute hold feature.");
      return;
    }
    if (!HOLD_ROLES.has(ct.getUser()?.role)) {
      toast("This account type cannot hold seats from the public marketplace.");
      return;
    }
    if (!state.selected.size) {
      toast("Select at least one seat or room first.");
      return;
    }

    try {
      const response = await ct.api(`/api/public/seats/trip/${encodeURIComponent(state.current._id)}/hold`, {
        method: "POST",
        body: { seats: [...state.selected] }
      });
      state.heldByYou = new Set(response.heldByYou || []);
      state.selected.clear();
      state.holdExpiresAt = response.expiresAt ? new Date(response.expiresAt).getTime() : null;
      startHoldCountdown();
      await refreshSeatMap();
      toast("Selection held for 10 minutes");
    } catch (err) {
      toast(err.message);
    }
  };

  async function releaseHeldSeats() {
    if (!ct.getToken() || !state.current || !state.heldByYou.size) return;
    await ct.api(`/api/public/seats/trip/${encodeURIComponent(state.current._id)}/hold`, {
      method: "DELETE",
      body: { seats: [...state.heldByYou] }
    });
  }

  global.resetSelection = async function resetSelection() {
    try {
      await releaseHeldSeats();
    } catch (_err) {
      // ignore release failures during reset
    }

    state.selected.clear();
    state.heldByYou.clear();
    state.addons.clear();
    state.holdExpiresAt = null;
    startHoldCountdown();
    updateSummary();
    refreshSeatMap().catch(() => {});
    toast("Selection reset");
  };

  global.goPaymentPage = function goPaymentPage() {
    if (!activeSelection().length) {
      toast("Select at least one seat or room first.");
      return;
    }
    const body = document.querySelector(".sheetBody");
    const checkout = document.getElementById("checkoutStep");
    if (body) body.style.display = "none";
    if (checkout) checkout.classList.add("active");
    updateSummary();
  };

  global.backToSelection = function backToSelection() {
    const body = document.querySelector(".sheetBody");
    const checkout = document.getElementById("checkoutStep");
    if (body) body.style.display = "grid";
    if (checkout) checkout.classList.remove("active");
  };

  global.confirmBooking = async function confirmBooking() {
    if (!state.current) return;
    const seats = activeSelection();
    if (!seats.length) {
      toast("Select at least one seat or room first.");
      return;
    }

    const guest = {
      name: String(document.getElementById("nameInput")?.value || "").trim(),
      phone: String(document.getElementById("phoneInput")?.value || "").trim(),
      email: String(document.getElementById("emailInput")?.value || "").trim()
    };

    if (!ct.getToken() && !guest.name && !guest.phone && !guest.email) {
      toast("Enter guest contact details to complete checkout.");
      return;
    }

    try {
      const checkout = await ct.api("/api/public/payments/checkout", {
        method: "POST",
        body: {
          tripId: state.current._id,
          seats,
          provider: "mock",
          referralCode: ct.getReferral(),
          guest
        }
      });

      const completion = await ct.api(`/api/public/payments/${encodeURIComponent(checkout.payment._id)}/mock-complete`, {
        method: "POST",
        body: { status: "success" }
      });

      const booking = normalizeBooking(completion.booking);
      if (!ct.getToken()) {
        state.guestBookings = [booking, ...state.guestBookings].slice(0, 12);
        saveGuestBookings();
      }

      renderReceipt(booking);
      await refreshBookings();
      closeModal();
      global.backToSelection();
      state.selected.clear();
      state.heldByYou.clear();
      state.addons.clear();
      toast("Booking confirmed");
    } catch (err) {
      toast(err.message);
    }
  };

  global.closeModal = closeModal;
  global.closeReceipt = closeReceipt;
  global.closeBlog = closeBlog;
  global.scrollToSectionId = scrollToSection;
  global.openReceipt = function openReceipt(id) {
    const booking = state.bookingIndex.get(id);
    if (booking) renderReceipt(booking);
  };
  global.shareBooking = async function shareBooking(id) {
    const booking = state.bookingIndex.get(id);
    if (!booking) return;
    const text = `${booking.title} - ${booking.code} - ${booking.total}`;
    try {
      if (global.navigator.share) {
        await global.navigator.share({ title: booking.title, text });
      } else if (global.navigator.clipboard?.writeText) {
        await global.navigator.clipboard.writeText(text);
      }
      toast("Booking details ready to share");
    } catch (_err) {
      toast("Could not share booking details right now.");
    }
  };

  document.addEventListener("click", (event) => {
    const actionNode = event.target?.closest?.("[data-marketplace-action]");
    if (actionNode) {
      event.preventDefault();
      performMarketplaceAction(
        String(actionNode.dataset.marketplaceAction || ""),
        String(actionNode.dataset.marketplaceValue || "")
      );
      return;
    }
    if (event.target?.id === "viewModal") closeModal();
    if (event.target?.id === "receiptModal") closeReceipt();
  });

  bootstrap();
})(window);
