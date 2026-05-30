(function liveDashboards() {
  const role = window.__DASHBOARD_TEMPLATE_ROLE__;
  if (!role) return;

  const API = window.API_BASE || location.origin;
  const token = localStorage.getItem("ct_access") || "";
  const query = new URLSearchParams(window.location.search);
  const ownerIdParam = String(query.get("ownerId") || "").trim();
  const requestedPage = String(window.__DASHBOARD_START_PAGE__ || query.get("section") || window.location.hash.replace(/^#/, "") || "").trim();
  const user = (() => {
    try {
      return JSON.parse(localStorage.getItem("ct_user") || "null");
    } catch (_err) {
      return null;
    }
  })();

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function ready() {
    document.documentElement.dataset.liveDashboard = "ready";
  }

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmtDate(value) {
    if (!value) return "—";
    try {
      return new Date(value).toLocaleString();
    } catch (_err) {
      return String(value);
    }
  }

  function fmtMoney(currency, amount) {
    return `${currency || "UGX"} ${Number(amount || 0).toLocaleString()}`;
  }

  function badge(status) {
    const text = esc(status || "Unknown");
    const value = String(status || "").toLowerCase();
    let cls = "info";
    if (/(confirm|active|paid|completed|approved|ready|online|submitted|success|verified|enabled)/.test(value)) cls = "ok";
    if (/(pending|hold|review|upcoming|processing)/.test(value)) cls = "warn";
    if (/(cancel|suspend|refund|rejected|failed|fraud|offline)/.test(value)) cls = "bad";
    return `<span class="badge ${cls}">${text}</span>`;
  }

  function row(cells) {
    return `<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`;
  }

  function fillTable(selector, rows, colSpan, emptyText = "No records yet.") {
    const tbody = $(selector);
    if (!tbody) return;
    tbody.innerHTML = rows.length ? rows.join("") : `<tr><td colspan="${colSpan}">${esc(emptyText)}</td></tr>`;
  }

  function clearTables(ids) {
    ids.forEach(({ selector, cols, text }) => fillTable(selector, [], cols, text));
  }

  function setWelcome(title, subtitle) {
    const titleNode = $(".welcome h2");
    const subtitleNode = $(".welcome p");
    if (titleNode) titleNode.textContent = title;
    if (subtitleNode) subtitleNode.textContent = subtitle;
  }

  function setPageHeading(title, subtitle) {
    const titleNode = $("#pageHeading");
    const subtitleNode = $("#pageSub");
    if (titleNode) titleNode.textContent = title;
    if (subtitleNode) subtitleNode.textContent = subtitle;
  }

  function setStatNumbers(selector, values) {
    const nodes = $$(selector);
    values.forEach((value, index) => {
      if (nodes[index]) nodes[index].textContent = value;
    });
  }

  function classifyCustomerBookingStatus(booking) {
    const state = String(booking.status || "").toLowerCase();
    if (state === "cancelled") return "Cancelled";
    if (state === "refunded") return "Refund";
    if (state === "pending_payment") return "Hold";
    const travelDate = new Date(booking.travelDate || 0);
    return travelDate >= new Date() ? "Upcoming" : "Completed";
  }

  function customerBookingRow(booking, compact = false) {
    const status = classifyCustomerBookingStatus(booking);
    const cells = compact
      ? [
          esc(booking.code),
          esc(booking.service),
          esc(booking.company),
          esc(fmtDate(booking.travelDate)),
          badge(status),
          esc(fmtMoney(booking.currency, booking.amount))
        ]
      : [
          esc(booking.code),
          esc(booking.service),
          esc(booking.company),
          esc(fmtDate(booking.travelDate)),
          esc(booking.customer),
          badge(status),
          esc(fmtMoney(booking.currency, booking.amount)),
          '<span class="muted">Live</span>'
        ];
    return row(cells);
  }

  function bookingReceiptRow(booking) {
    const status = booking.status === "refunded" ? "Refunded" : booking.status === "pending_payment" ? "Pending" : "Paid";
    return row([
      esc(`RCT-${booking.code}`),
      esc(booking.code),
      esc(booking.status === "pending_payment" ? "Pending payment" : "Mock checkout"),
      esc(fmtDate(booking.createdAt || booking.travelDate)),
      esc(fmtMoney(booking.currency, booking.amount)),
      badge(status),
      '<span class="muted">Auto</span>'
    ]);
  }

  function walletTxnRow(txn) {
    return row([
      esc(String(txn._id || "").slice(-6).toUpperCase()),
      esc(String(txn.type || "").replace(/_/g, " ")),
      esc(txn.note || "Internal wallet ledger"),
      esc(fmtDate(txn.createdAt)),
      esc(fmtMoney(txn.currency, txn.amount)),
      badge("Completed"),
      '<span class="muted">Ledger</span>'
    ]);
  }

  function supportPlaceholder(subject, owner = "Classic Trip Support", status = "Open") {
    return row([
      esc(`SUP-${Math.random().toString(36).slice(2, 6).toUpperCase()}`),
      esc(owner),
      esc(subject),
      badge(status),
      esc(fmtDate(new Date())),
      '<span class="muted">Live</span>'
    ]);
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (!options.isForm && !headers["Content-Type"] && options.body != null) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(`${API}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body == null
        ? undefined
        : options.isForm
          ? options.body
          : JSON.stringify(options.body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.message || `Request failed: ${response.status}`);
    }
    return data;
  }

  function withOwnerScope(path) {
    if (!ownerIdParam) return path;
    const joiner = path.includes("?") ? "&" : "?";
    return `${path}${joiner}ownerId=${encodeURIComponent(ownerIdParam)}`;
  }

  function toast(message, bad = false) {
    const node = $("#toast");
    const text = $("#toastText") || node;
    if (!node || !text) return;
    text.textContent = message;
    node.style.borderColor = bad ? "rgba(239,68,68,.28)" : "rgba(34,197,94,.24)";
    node.style.background = bad ? "rgba(239,68,68,.14)" : "rgba(34,197,94,.12)";
    node.style.color = bad ? "#ffd3d3" : "";
    node.classList.add("show");
    window.clearTimeout(toast._timer);
    toast._timer = window.setTimeout(() => node.classList.remove("show"), 2600);
  }

  function openCrudModal(title, subtitle, body) {
    const modal = $("#crudModal");
    const titleNode = $("#crudTitle");
    const subNode = $("#crudSub");
    const bodyNode = $("#crudBody");
    if (!modal || !titleNode || !subNode || !bodyNode) return null;
    titleNode.textContent = title;
    subNode.textContent = subtitle;
    bodyNode.innerHTML = body;
    modal.classList.add("is-open");
    return bodyNode;
  }

  function closeCrudModal() {
    $("#crudModal")?.classList.remove("is-open");
  }

  function actionButton(label, action, attrs = "") {
    return `<button class="tinyBtn" data-company-action="${esc(action)}" ${attrs}>${esc(label)}</button>`;
  }

  function platformActionButton(label, action, attrs = "") {
    const value = normalizeText(action || label);
    const title = String(label || action || "Action").trim();
    if (value.startsWith("view")) {
      return `<button class="tinyBtn" type="button" title="${esc(title || "View")}" aria-label="${esc(title || "View")}" data-platform-action="${esc(action)}" ${attrs}><i class="fa-regular fa-eye"></i></button>`;
    }

    const isDanger = value === "invite-revoke" || value.startsWith("delete-") || (value === "partner-status" && /suspend/i.test(title));
    const icon = isDanger ? "fa-solid fa-trash" : "fa-regular fa-pen-to-square";
    return `<button class="tinyBtn${isDanger ? " danger" : ""}" type="button" title="${esc(title)}" aria-label="${esc(title)}" data-platform-action="${esc(action)}" ${attrs}><i class="${icon}"></i></button>`;
  }

  function businessKind(value) {
    const text = normalizeText(value);
    if (/(bus|coach|shuttle|van|taxi|ferry|transport)/.test(text)) return "bus";
    if (/(hotel|stay|lodge|apartment|villa|bnb|resort|guest house)/.test(text)) return "hotel";
    if (/(air|flight|airline)/.test(text)) return "airline";
    if (/(train|rail)/.test(text)) return "train";
    return "other";
  }

  async function copyText(text, message = "Copied.") {
    const value = String(text || "").trim();
    if (!value) {
      toast("Nothing to copy.", true);
      return false;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const node = document.createElement("textarea");
        node.value = value;
        node.setAttribute("readonly", "readonly");
        node.style.position = "absolute";
        node.style.left = "-9999px";
        document.body.appendChild(node);
        node.select();
        document.execCommand("copy");
        node.remove();
      }
      toast(message);
      return true;
    } catch (_err) {
      toast("Could not copy that value right now.", true);
      return false;
    }
  }

  function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function normalizeUiText(value) {
    return String(value ?? "")
      .replace(/â€”/g, "-")
      .replace(/Â·/g, " - ")
      .replace(/â†’/g, " -> ")
      .replace(/â€¢/g, " - ");
  }

  function esc(value) {
    return normalizeUiText(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmtDate(value) {
    if (!value) return "-";
    try {
      return normalizeUiText(new Date(value).toLocaleString());
    } catch (_err) {
      return normalizeUiText(String(value));
    }
  }

  function setSelectByText(select, value) {
    if (!select) return;
    const target = normalizeText(value);
    const match = Array.from(select.options || []).find((option) => normalizeText(option.textContent) === target || normalizeText(option.value) === target);
    if (match) select.value = match.value;
  }

  function companyScopeHref(path) {
    return withOwnerScope(path);
  }

  function dashboardRoute(path, page, extra = {}) {
    const params = new URLSearchParams();
    if (ownerIdParam) params.set("ownerId", ownerIdParam);
    if (page) params.set("section", page);
    Object.entries(extra).forEach(([key, value]) => {
      if (value == null || value === "") return;
      params.set(key, String(value));
    });
    return `${path}${params.toString() ? `?${params.toString()}` : ""}`;
  }

  function activateDashboardPage(page) {
    if (!page) return;
    const button = document.querySelector(`.navBtn[data-page="${CSS.escape(page)}"]`);
    if (button) {
      button.click();
      return;
    }

    $$(".section").forEach((section) => {
      section.classList.toggle("is-open", section.id === page);
    });
    $$(".navBtn").forEach((node) => {
      node.classList.toggle("is-active", node.dataset.page === page);
    });
  }

  function opsLinks(tripId) {
    return [
      `<a class="tinyBtn" href="${dashboardRoute("/tenant/company-admin", "seatrooms", { tripId })}">Occupancy</a>`,
      `<a class="tinyBtn" href="${dashboardRoute("/tenant/company-admin", "bookings", { tripId })}">Manifest</a>`
    ].join("");
  }

  async function downloadReport(type) {
    const response = await api(withOwnerScope(`/api/tenant/company/reports/${encodeURIComponent(type)}`));
    const report = response.report || {};
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${type}-report-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function renderCustomer() {
    const data = await api("/api/platform/dashboards/customer");
    const bookingRows = data.bookingRows || [];
    const walletTxns = data.walletTxns || [];

    setWelcome(
      `Welcome ${data.customer?.name || user?.email || "traveler"}. Your travel history is synced.`,
      "Manage upcoming tickets, receipts, wallet activity, and account-based bookings from the live backend."
    );
    setPageHeading("Customer Dashboard", "Live customer bookings, tickets, wallet activity, and support-ready account data.");
    setStatNumbers("#overview .statsGrid .statNumber", [
      String(data.stats?.totalBookings || 0),
      String((bookingRows || []).filter((booking) => classifyCustomerBookingStatus(booking) === "Upcoming").length),
      fmtMoney(data.stats?.walletCurrency, data.stats?.walletBalance),
      String((bookingRows || []).filter((booking) => booking.status === "confirmed").length)
    ]);
    setStatNumbers("#wallet .statsGrid .statNumber", [
      fmtMoney(data.wallet?.currency, data.wallet?.balance),
      fmtMoney(data.wallet?.currency, walletTxns.filter((txn) => /refund|restore/i.test(txn.type || "")).reduce((sum, txn) => sum + Number(txn.amount || 0), 0))
    ]);

    fillTable("#recentBookings", bookingRows.slice(0, 5).map((booking) => customerBookingRow(booking, true)), 6);
    fillTable("#bookingsTable", bookingRows.map((booking) => customerBookingRow(booking)), 8);
    fillTable("#receiptsTable", bookingRows.map(bookingReceiptRow), 7);
    fillTable("#walletTable", walletTxns.map(walletTxnRow), 7);
    fillTable(
      "#notificationsTable",
      bookingRows.slice(0, 5).map((booking) =>
        row([
          esc(`NTF-${booking.code}`),
          esc(`${booking.service} is linked to your account.`),
          esc(fmtDate(booking.createdAt || booking.travelDate)),
          badge("Unread"),
          '<span class="muted">Auto</span>'
        ])
      ),
      5,
      "No new notifications."
    );
    fillTable(
      "#refundsTable",
      bookingRows.filter((booking) => ["cancelled", "refunded"].includes(booking.status)).map((booking) =>
        row([
          esc(`RFD-${booking.code}`),
          esc(booking.code),
          esc(booking.customer),
          esc("Customer request"),
          esc(fmtMoney(booking.currency, booking.amount)),
          badge(booking.status === "refunded" ? "Approved" : "Pending"),
          '<span class="muted">Live</span>'
        ])
      ),
      7,
      "No refund records yet."
    );
    fillTable(
      "#supportTable",
      bookingRows.slice(0, 3).map((booking) =>
        supportPlaceholder(`Help needed for ${booking.service}`, booking.customer, "Open")
      ),
      6,
      "No support cases yet."
    );
    fillTable(
      "#reviewsTable",
      bookingRows.map((booking) =>
        row([
          esc(booking.code),
          esc(booking.service),
          esc(booking.company),
          esc(booking.status === "confirmed" ? "Pending" : "Not available"),
          esc(booking.status === "confirmed" ? "Write a review after travel." : "Not eligible yet"),
          badge(booking.status === "confirmed" ? "Pending" : "Draft"),
          '<span class="muted">Live</span>'
        ])
      ),
      7
    );
    fillTable(
      "#securityTable",
      [
        row([
          esc("Current session"),
          esc(user?.email || "Logged in"),
          esc("Browser access token"),
          badge("Active"),
          '<span class="muted">Protected</span>'
        ])
      ],
      5
    );
  }

  async function renderPromoter() {
    const data = await api("/api/platform/dashboards/promoter");
    const bookingRows = data.bookingRows || [];
    const shareLinks = data.shareLinks || [];
    const walletTxns = data.walletTxns || [];

    setWelcome(
      `Welcome ${data.promoter?.name || user?.email || "promoter"}. Your live referral activity is loaded.`,
      "Track live share links, referred bookings, wallet earnings, and promoter payouts from backend data."
    );
    setPageHeading("Promoter Dashboard", "Live referral links, commissions, bookings, wallet activity, and payout history.");
    setStatNumbers("#overview .statsGrid .statNumber", [
      String(shareLinks.length),
      String(bookingRows.length * 12),
      String(data.stats?.referredBookings || bookingRows.length),
      fmtMoney(data.wallet?.currency || data.stats?.walletCurrency, data.stats?.totalEarned || 0)
    ]);
    setStatNumbers("#withdrawals .statsGrid .statNumber", [
      fmtMoney(data.wallet?.currency, data.wallet?.balance),
      fmtMoney(data.wallet?.currency, 0)
    ]);

    fillTable(
      "#recentBookings",
      bookingRows.slice(0, 5).map((booking) =>
        row([
          esc(booking.code),
          esc(booking.service),
          esc(booking.customer),
          esc(fmtMoney(booking.currency, booking.amount)),
          esc(fmtMoney(booking.currency, booking.promoterCommission)),
          badge(booking.status)
        ])
      ),
      6
    );
    fillTable(
      "#linksTable",
      shareLinks.map((link) =>
        row([
          esc(link.shareUrl),
          esc(link.title),
          esc(String(link.type || "").toUpperCase()),
          esc(String(bookingRows.length * 12)),
          esc(String(bookingRows.filter((booking) => booking.service === link.title).length)),
          badge("Active"),
          '<span class="muted">Live</span>'
        ])
      ),
      7
    );
    fillTable(
      "#shareTable",
      shareLinks.map((link) =>
        row([
          esc(link.title),
          esc(String(link.type || "").toUpperCase()),
          esc(link.shareUrl),
          esc("Share-ready"),
          badge("Active"),
          '<span class="muted">Copy</span>'
        ])
      ),
      6
    );
    fillTable(
      "#commissionsTable",
      bookingRows.map((booking) =>
        row([
          esc(`COM-${booking.code}`),
          esc(booking.code),
          esc(fmtMoney(booking.currency, booking.amount)),
          esc("3%"),
          esc(fmtMoney(booking.currency, booking.promoterCommission)),
          badge(booking.status === "confirmed" ? "Earned" : "Pending"),
          '<span class="muted">Live</span>'
        ])
      ),
      7
    );
    fillTable(
      "#bookingsTable",
      bookingRows.map((booking) =>
        row([
          esc(booking.code),
          esc(booking.service),
          esc(booking.customer),
          esc(fmtMoney(booking.currency, booking.amount)),
          esc(fmtMoney(booking.currency, booking.promoterCommission)),
          badge(booking.status),
          '<span class="muted">Live</span>'
        ])
      ),
      7
    );
    fillTable(
      "#withdrawalsTable",
      walletTxns.filter((txn) => /debit/i.test(txn.type || "")).map((txn) =>
        row([
          esc(`WD-${String(txn._id).slice(-6).toUpperCase()}`),
          esc("Internal wallet"),
          esc(data.promoter?.email || user?.email || ""),
          esc(fmtDate(txn.createdAt)),
          esc(fmtMoney(txn.currency, txn.amount)),
          badge("Completed"),
          '<span class="muted">Ledger</span>'
        ])
      ),
      7,
      "No withdrawal records yet."
    );
    fillTable(
      "#payoutsTable",
      walletTxns.map(walletTxnRow),
      7,
      "No payout records yet."
    );
    fillTable(
      "#campaignsTable",
      shareLinks.map((link) =>
        row([
          esc(`CMP-${String(link.tripId || "").slice(-6).toUpperCase()}`),
          esc(link.title),
          esc("Referral campaign"),
          esc(String(bookingRows.filter((booking) => booking.service === link.title).length)),
          esc(fmtMoney(data.wallet?.currency, bookingRows.filter((booking) => booking.service === link.title).reduce((sum, booking) => sum + Number(booking.promoterCommission || 0), 0))),
          badge("Active"),
          '<span class="muted">Live</span>'
        ])
      ),
      7,
      "No campaigns yet."
    );
    fillTable("#fraudTable", [], 5, "No suspicious traffic flagged.");
    fillTable("#supportTable", [], 6, "No support cases yet.");

    const bars = $("#performanceBars");
    if (bars) {
      const grouped = {};
      bookingRows.forEach((booking) => {
        const key = booking.type || "trip";
        grouped[key] = (grouped[key] || 0) + 1;
      });
      bars.innerHTML = Object.entries(grouped).map(([label, value]) => `
        <div class="barCol">
          <div class="bar" style="height:${Math.max(16, value * 22)}px"></div>
          <span>${esc(label)}</span>
        </div>
      `).join("") || '<div class="muted">No performance data yet.</div>';
    }
  }

  async function renderCompanyAdmin() {
    const [data, listings, vehicles] = await Promise.all([
      api(withOwnerScope("/api/platform/dashboards/company-admin")),
      api(withOwnerScope("/api/tenant/routes/mine/list")),
      api(withOwnerScope("/api/tenant/vehicles"))
    ]);

    const bookingRows = data.bookingRows || [];
    const activeTrips = data.activeTrips || [];
    const employees = data.employees || [];
    const walletTxns = data.walletTxns || [];

    setWelcome(
      `Welcome back, ${data.company?.companyName || data.company?.name || user?.email || "company team"}. Your live company metrics are loaded.`,
      "Manage listings, trips, bookings, staff, earnings, and company operations from backend inventory."
    );
    setPageHeading("Partner Company Dashboard", "Live company listings, schedules, bookings, staff, and wallet-backed payout visibility.");
    setStatNumbers("#overview .statsGrid .statNumber", [
      fmtMoney(data.stats?.walletCurrency, data.stats?.walletBalance),
      String(data.stats?.confirmedBookings || bookingRows.length),
      `${Math.round((activeTrips.reduce((sum, trip) => sum + (trip.totalSeats ? (trip.bookedSeats / trip.totalSeats) * 100 : 0), 0) / Math.max(activeTrips.length, 1)) || 0)}%`,
      `${Number((listings.items || []).reduce((sum, item) => sum + Number(item.ratingAvg || 0), 0) / Math.max((listings.items || []).length, 1)).toFixed(1)}/5`
    ]);

    fillTable(
      "#recentBookings",
      bookingRows.slice(0, 5).map((booking) =>
        row([
          esc(booking.code),
          esc(booking.service),
          esc(booking.customer),
          esc(fmtDate(booking.travelDate)),
          badge(booking.status),
          esc(fmtMoney(booking.currency, booking.amount))
        ])
      ),
      6
    );
    fillTable(
      "#listingsTable",
      (listings.items || []).map((listing) =>
        row([
          esc(listing.title),
          esc(String(listing.type || "").toUpperCase()),
          esc(listing.type === "hotel" ? `${listing.city || ""} ${listing.address || ""}`.trim() : `${listing.from || ""} → ${listing.to || ""}`),
          esc(String(listing.type === "hotel" ? listing.amenities?.length || 0 : activeTrips.filter((trip) => trip.type === listing.type).length)),
          esc(fmtMoney(listing.currency, activeTrips.find((trip) => String(trip.title || "").includes(listing.title))?.basePrice || 0)),
          badge(listing.isActive ? "Active" : "Review"),
          '<span class="muted">Live</span>'
        ])
      ),
      7
    );
    fillTable(
      "#scheduleToday",
      activeTrips.map((trip) =>
        row([
          esc(String(trip._id).slice(-6).toUpperCase()),
          esc(trip.title),
          esc(fmtDate(trip.departureAt)),
          esc(trip.vehicleName || "Vehicle"),
          esc(`${trip.bookedSeats}/${trip.totalSeats}`),
          badge("Today"),
          '<span class="muted">Live</span>'
        ])
      ),
      7,
      "No scheduled trips yet."
    );
    fillTable(
      "#bookingsTable",
      bookingRows.map((booking) =>
        row([
          esc(booking.code),
          esc(booking.service),
          esc(booking.customer),
          esc(booking.seats || "—"),
          esc(fmtDate(booking.travelDate)),
          badge(booking.status),
          esc(fmtMoney(booking.currency, booking.amount)),
          '<span class="muted">Live</span>'
        ])
      ),
      8
    );
    fillTable(
      "#inventoryTable",
      (vehicles.items || []).map((vehicle) =>
        row([
          esc(vehicle.name),
          esc(String(vehicle.type || "").toUpperCase()),
          esc(vehicle.layoutName || "Custom"),
          esc(String(vehicle.totalSeats || 0)),
          esc("Live"),
          badge("Active"),
          '<span class="muted">Inventory</span>'
        ])
      ),
      7
    );
    fillTable(
      "#staffTable",
      employees.map((employee) =>
        row([
          esc(employee.name),
          esc("Company employee"),
          esc(data.company?.companyName || data.company?.name || "Branch"),
          esc("Operations"),
          esc(fmtDate(employee.createdAt)),
          badge(employee.status || "Active"),
          '<span class="muted">Live</span>'
        ])
      ),
      7,
      "No staff members yet."
    );
    fillTable(
      "#payoutsTable",
      walletTxns.map(walletTxnRow),
      7,
      "No payout ledger entries yet."
    );
    fillTable("#promotionsTable", [], 7, "No promotion campaigns yet.");
    fillTable("#reviewsTable", [], 6, "No live reviews yet.");
    fillTable("#supportTable", [], 6, "No support cases yet.");
  }

  async function renderEmployee() {
    const data = await api(withOwnerScope("/api/platform/dashboards/company-employee"));
    const bookingRows = data.bookingRows || [];
    const todayTrips = data.todayTrips || [];

    setWelcome(
      `Welcome ${data.employee?.name || user?.email || "team member"}. Your live shift data is ready.`,
      "Check bookings, schedules, passenger activity, and desk operations from the backend."
    );
    setPageHeading("Company Employee Dashboard", "Live shift operations, bookings, schedules, support, and check-in visibility.");
    setStatNumbers("#overview .statsGrid .statNumber", [
      String(data.stats?.confirmedBookings || 0),
      String(bookingRows.filter((booking) => booking.status === "pending_payment").length),
      String((data.operationNotes || []).length),
      fmtMoney(bookingRows[0]?.currency || "UGX", bookingRows.reduce((sum, booking) => sum + Number(booking.amount || 0), 0))
    ]);

    fillTable(
      "#tasksTable",
      (data.operationNotes || []).map((note, index) =>
        row([
          esc(`TASK-${index + 1}`),
          esc(note),
          esc(data.company?.companyName || data.company?.name || "Company"),
          badge("Open"),
          esc(fmtDate(new Date())),
          '<span class="muted">Ops</span>'
        ])
      ),
      6,
      "No operational tasks yet."
    );
    fillTable(
      "#checkinTable",
      bookingRows.map((booking) =>
        row([
          esc(booking.code),
          esc(booking.service),
          esc(booking.customer),
          esc(booking.seats || "—"),
          esc(fmtDate(booking.travelDate)),
          badge(booking.status === "confirmed" ? "Ready" : booking.status),
          '<span class="muted">Live</span>'
        ])
      ),
      7,
      "No check-in records yet."
    );
    fillTable(
      "#bookingsTable",
      bookingRows.map((booking) =>
        row([
          esc(booking.code),
          esc(booking.service),
          esc(booking.customer),
          esc(booking.seats || "—"),
          esc(fmtDate(booking.travelDate)),
          badge(booking.status),
          esc(fmtMoney(booking.currency, booking.amount)),
          '<span class="muted">Live</span>'
        ])
      ),
      8
    );
    fillTable(
      "#scheduleToday",
      todayTrips.map((trip) =>
        row([
          esc(String(trip._id).slice(-6).toUpperCase()),
          esc(trip.title),
          esc(fmtDate(trip.departureAt)),
          esc(trip.vehicleName || "Vehicle"),
          esc(`${trip.bookedSeats}/${trip.totalSeats}`),
          badge("Today"),
          '<span class="muted">Ops</span>'
        ])
      ),
      7,
      "No trips scheduled for today."
    );
    fillTable(
      "#inventoryTable",
      todayTrips.map((trip) =>
        row([
          esc(trip.title),
          esc(trip.vehicleName || "Inventory"),
          esc(String(trip.totalSeats || 0)),
          esc(String(trip.remainingSeats || 0)),
          esc(fmtDate(trip.departureAt)),
          badge("Live"),
          '<span class="muted">Ops</span>'
        ])
      ),
      7
    );
    fillTable(
      "#customersTable",
      bookingRows.map((booking) =>
        row([
          esc(booking.customer),
          esc(booking.contact || "—"),
          esc(booking.service),
          esc(fmtDate(booking.travelDate)),
          badge(booking.status),
          '<span class="muted">Passenger</span>'
        ])
      ),
      6
    );
    fillTable(
      "#paymentsTable",
      bookingRows.map((booking) =>
        row([
          esc(`PAY-${booking.code}`),
          esc(booking.code),
          esc(booking.customer),
          esc(fmtMoney(booking.currency, booking.amount)),
          badge(booking.paymentStatus || booking.status),
          '<span class="muted">Desk</span>'
        ])
      ),
      6
    );
    fillTable("#refundsTable", [], 7, "No refund requests yet.");
    fillTable("#supportTable", [], 6, "No support tasks yet.");
    fillTable("#handoverTable", [], 6, "No handover notes yet.");
  }

  async function renderCompanyAdminLive() {
    const [data, listings, vehicles, staffData, settingsData, supportData, noticesData, payoutData, reviewData] = await Promise.all([
      api(withOwnerScope("/api/platform/dashboards/company-admin")),
      api(withOwnerScope("/api/tenant/routes/mine/list")),
      api(withOwnerScope("/api/tenant/vehicles")),
      api(withOwnerScope("/api/tenant/company/staff")),
      api(withOwnerScope("/api/tenant/company/settings")),
      api(withOwnerScope("/api/tenant/company/support")),
      api(withOwnerScope("/api/tenant/company/notices")),
      api(withOwnerScope("/api/tenant/company/payout-requests")),
      api(withOwnerScope("/api/tenant/company/reviews"))
    ]);

    const bookingRows = data.bookingRows || [];
    const activeTrips = data.activeTrips || [];
    const employees = staffData.employees || data.employees || [];
    const invites = staffData.invites || [];
    const supportCases = supportData.items || [];
    const payoutRequests = payoutData.items || [];
    const reviews = reviewData.items || [];
    const company = settingsData.company || data.company || {};
    const tenantIdentity = settingsData.tenant || null;
    const tenantDomains = settingsData.domains || [];
    const storefront = settingsData.storefront || null;
    const routeItems = listings.items || [];
    const vehicleItems = vehicles.items || [];
    const liveListStats = $$(".liveList strong");
    const promotions = Object.values(
      bookingRows.reduce((acc, booking) => {
        if (!booking.promoter) return acc;
        const key = booking.service || booking.code;
        const current = acc[key] || {
          title: booking.service || "Promotion campaign",
          type: booking.type || "trip",
          bookings: 0,
          revenue: 0,
          commission: 0
        };
        current.bookings += 1;
        current.revenue += Number(booking.amount || 0);
        current.commission += Number(booking.promoterCommission || 0);
        acc[key] = current;
        return acc;
      }, {})
    );

    const refresh = async () => renderCompanyAdminLive();

    function removeDemoModalBindings() {
      $$("[data-modal]").forEach((node) => node.removeAttribute("data-modal"));
    }

    function ensureCompanySettingsEnhancements() {
      const formGrid = $("#settingsForm .formGrid");
      if (formGrid && !$("#settingsTimezoneField", formGrid)) {
        const wrapper = document.createElement("div");
        wrapper.className = "field";
        wrapper.id = "settingsTimezoneField";
        wrapper.innerHTML = `
          <label>Timezone</label>
          <div class="control">
            <i class="fa-solid fa-earth-africa"></i>
            <input name="timezone" placeholder="Africa/Kampala" />
          </div>
        `;
        formGrid.appendChild(wrapper);
      }

      if (formGrid && !$("#settingsStorefrontFieldset", formGrid)) {
        const wrapper = document.createElement("div");
        wrapper.className = "field full";
        wrapper.id = "settingsStorefrontFieldset";
        wrapper.innerHTML = `
          <label>Storefront branding</label>
          <div class="notice" style="margin-bottom:12px">These settings control how your tenant marketplace and auth pages look when customers open your storefront by domain or tenant slug.</div>
          <div class="formGrid">
            <div class="field"><label>Brand name</label><div class="control"><i class="fa-solid fa-signature"></i><input name="brandName" placeholder="Kampala Coaches" /></div></div>
            <div class="field"><label>Brand short name</label><div class="control"><i class="fa-solid fa-font"></i><input name="brandShortName" maxlength="6" placeholder="KC" /></div></div>
            <div class="field"><label>Support email</label><div class="control"><i class="fa-regular fa-envelope"></i><input name="supportEmail" type="email" placeholder="support@company.com" /></div></div>
            <div class="field"><label>Support phone</label><div class="control"><i class="fa-solid fa-phone"></i><input name="supportPhone" placeholder="+256..." /></div></div>
            <div class="field"><label>Primary color</label><div class="control"><i class="fa-solid fa-palette"></i><input name="primaryColor" placeholder="#4f8cff" /></div></div>
            <div class="field"><label>Accent color</label><div class="control"><i class="fa-solid fa-fill-drip"></i><input name="accentColor" placeholder="#ffb703" /></div></div>
            <div class="field"><label>Hot color</label><div class="control"><i class="fa-solid fa-fire"></i><input name="hotColor" placeholder="#ff3d00" /></div></div>
            <div class="field full"><label>Auth page title</label><div class="control"><i class="fa-solid fa-heading"></i><input name="authTitle" placeholder="Kampala Coaches account access" /></div></div>
            <div class="field full"><label>Auth page subtitle</label><div class="control"><textarea name="authSubtitle" placeholder="Explain what customers and staff can do on your tenant auth page."></textarea></div></div>
            <div class="field full"><label>Marketplace headline</label><div class="control"><i class="fa-solid fa-store"></i><input name="marketplaceTitle" placeholder="Book directly with Kampala Coaches." /></div></div>
            <div class="field full"><label>Marketplace subtitle</label><div class="control"><textarea name="marketplaceSubtitle" placeholder="Explain what customers can book and how your storefront works."></textarea></div></div>
            <div class="field full"><label>Marketplace intro</label><div class="control"><textarea name="marketplaceIntro" placeholder="Short public intro used in the marketplace and footer."></textarea></div></div>
            <div class="field full"><label>Support headline</label><div class="control"><i class="fa-solid fa-headset"></i><input name="supportHeadline" placeholder="Need help before or after you book?" /></div></div>
            <div class="field full"><label>Support blurb</label><div class="control"><textarea name="supportBlurb" placeholder="Public support message for auth and storefront pages."></textarea></div></div>
            <div class="field"><label>Feature one title</label><div class="control"><i class="fa-solid fa-star"></i><input name="featureOneTitle" placeholder="Direct booking support" /></div></div>
            <div class="field"><label>Feature one body</label><div class="control"><textarea name="featureOneBody" placeholder="Explain a strong selling point customers should see."></textarea></div></div>
            <div class="field"><label>Feature two title</label><div class="control"><i class="fa-solid fa-star"></i><input name="featureTwoTitle" placeholder="Live seat availability" /></div></div>
            <div class="field"><label>Feature two body</label><div class="control"><textarea name="featureTwoBody" placeholder="Describe another storefront highlight."></textarea></div></div>
            <div class="field"><label>Feature three title</label><div class="control"><i class="fa-solid fa-star"></i><input name="featureThreeTitle" placeholder="Fast ticket recovery" /></div></div>
            <div class="field"><label>Feature three body</label><div class="control"><textarea name="featureThreeBody" placeholder="Describe the third storefront highlight."></textarea></div></div>
            <div class="field full"><label>Promotions headline</label><div class="control"><i class="fa-solid fa-bullhorn"></i><input name="promoHeadline" placeholder="Featured routes and offers" /></div></div>
            <div class="field full"><label>Promotions body</label><div class="control"><textarea name="promoBody" placeholder="Short copy for promoted listings and featured campaigns."></textarea></div></div>
          </div>
        `;
        formGrid.appendChild(wrapper);
      }

      const settingsGrid = $("#settings .grid2");
      if (!settingsGrid) return null;

      let identityCard = $("#tenantIdentityCard", settingsGrid);
      if (!identityCard) {
        identityCard = document.createElement("div");
        identityCard.className = "card";
        identityCard.id = "tenantIdentityCard";
        const cards = Array.from(settingsGrid.children).filter((child) => child.classList?.contains("card"));
        if (cards[1]) {
          settingsGrid.replaceChild(identityCard, cards[1]);
        } else {
          settingsGrid.appendChild(identityCard);
        }
      }

      return identityCard;
    }

    function domainActionMarkup(domain) {
      const actions = [];
      if (String(domain.verificationStatus || "").toLowerCase() !== "verified") {
        actions.push(`<button class="tinyBtn" type="button" data-domain-action="verify" data-domain-id="${esc(domain.id)}">Verify</button>`);
      }
      if (String(domain.type || "").toLowerCase() !== "primary" && String(domain.verificationStatus || "").toLowerCase() === "verified") {
        actions.push(`<button class="tinyBtn" type="button" data-domain-action="set-primary" data-domain-id="${esc(domain.id)}">Set primary</button>`);
      }
      actions.push(`<button class="tinyBtn" type="button" data-domain-action="remove" data-domain-id="${esc(domain.id)}">Remove</button>`);
      return actions.join("");
    }

    function renderTenantIdentityCard() {
      const identityCard = ensureCompanySettingsEnhancements();
      if (!identityCard) return;

      const primaryDomain = tenantIdentity?.primaryDomain || tenantDomains.find((domain) => String(domain.type || "").toLowerCase() === "primary")?.hostname || "";
      const verifiedCount = tenantDomains.filter((domain) => String(domain.verificationStatus || "").toLowerCase() === "verified").length;
      const pendingCount = tenantDomains.filter((domain) => String(domain.verificationStatus || "").toLowerCase() === "pending").length;
      const portalUrl = tenantIdentity?.portalUrl || `${location.origin}/tenant/company-admin${tenantIdentity?.slug ? `?tenant=${encodeURIComponent(tenantIdentity.slug)}` : ""}`;
      const storefrontUrl = storefront?.storefrontUrl || `${location.origin}/?tenant=${encodeURIComponent(tenantIdentity?.slug || "")}`;
      const authUrl = storefront?.authUrl || `${location.origin}/login?tenant=${encodeURIComponent(tenantIdentity?.slug || "")}`;

      identityCard.innerHTML = `
        <div class="cardHead">
          <div class="cardTitle">
            <h3>Tenant identity</h3>
            <p>Manage the tenant slug, portal access, timezone, and connected domains for this company workspace.</p>
          </div>
        </div>
        <div class="splitGrid">
          <div class="splitItem">
            <div class="splitTop"><span>Tenant slug</span>${badge(tenantIdentity?.status || "trial")}</div>
            <strong>${esc(tenantIdentity?.slug || "not-configured")}</strong>
          </div>
          <div class="splitItem">
            <div class="splitTop"><span>Primary domain</span>${badge(primaryDomain ? "Configured" : "Missing")}</div>
            <strong>${esc(primaryDomain || "No primary domain yet")}</strong>
          </div>
          <div class="splitItem">
            <div class="splitTop"><span>Timezone</span>${badge("Live")}</div>
            <strong>${esc(tenantIdentity?.timezone || "Africa/Kampala")}</strong>
          </div>
          <div class="splitItem">
            <div class="splitTop"><span>Connected domains</span>${badge(`${verifiedCount} verified`)}</div>
            <strong>${esc(String(tenantDomains.length))}</strong>
            <div class="muted">${esc(`${pendingCount} pending verification`)}</div>
          </div>
        </div>
        <div class="splitGrid" style="margin-top:14px">
          <div class="splitItem">
            <div class="splitTop"><span>Storefront brand</span>${badge("Live")}</div>
            <strong>${esc(storefront?.displayName || company.companyName || company.name || "Company storefront")}</strong>
            <div class="muted">${esc(storefront?.marketplaceTitle || "Storefront headline not configured yet.")}</div>
          </div>
          <div class="splitItem">
            <div class="splitTop"><span>Support contact</span>${badge("Public")}</div>
            <strong>${esc(storefront?.supportEmail || storefront?.supportPhone || "No public support contact yet")}</strong>
            <div class="muted">${esc(storefront?.supportPhone && storefront?.supportEmail ? storefront.supportPhone : storefront?.authSubtitle || "Visible on the tenant auth page when set.")}</div>
          </div>
        </div>
        <div class="splitItem" style="margin-top:14px">
          <div class="splitTop"><span>Tenant portal</span>${badge("Ready")}</div>
          <div class="control" style="margin-top:10px">
            <i class="fa-solid fa-link"></i>
            <input id="tenantPortalUrl" value="${esc(portalUrl)}" readonly />
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
            <button class="btn btnBlue" type="button" data-domain-action="copy-portal" data-url="${esc(portalUrl)}"><i class="fa-solid fa-copy"></i> Copy portal link</button>
            <a class="btn" href="${esc(portalUrl)}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open portal</a>
          </div>
        </div>
        <div class="splitItem" style="margin-top:14px">
          <div class="splitTop"><span>Public storefront</span>${badge("Preview")}</div>
          <div class="control" style="margin-top:10px">
            <i class="fa-solid fa-store"></i>
            <input id="tenantStorefrontUrl" value="${esc(storefrontUrl)}" readonly />
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
            <button class="btn btnBlue" type="button" data-domain-action="copy-storefront" data-url="${esc(storefrontUrl)}"><i class="fa-solid fa-copy"></i> Copy storefront</button>
            <a class="btn" href="${esc(storefrontUrl)}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open storefront</a>
            <a class="btn" href="${esc(authUrl)}" target="_blank" rel="noopener"><i class="fa-solid fa-right-to-bracket"></i> Open auth page</a>
          </div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px">
            <span class="muted">Color preview</span>
            <span style="width:18px;height:18px;border-radius:999px;display:inline-block;border:1px solid rgba(255,255,255,.18);background:${esc(storefront?.primaryColor || "#4f8cff")}"></span>
            <span style="width:18px;height:18px;border-radius:999px;display:inline-block;border:1px solid rgba(255,255,255,.18);background:${esc(storefront?.accentColor || "#ffb703")}"></span>
            <span style="width:18px;height:18px;border-radius:999px;display:inline-block;border:1px solid rgba(255,255,255,.18);background:${esc(storefront?.hotColor || "#ff3d00")}"></span>
          </div>
        </div>
        <form class="formPanel" id="tenantDomainForm" style="margin-top:14px">
          <div class="formGrid">
            <div class="field full">
              <label>Add domain or subdomain</label>
              <div class="control">
                <i class="fa-solid fa-globe"></i>
                <input name="hostname" placeholder="portal.company.com" required />
              </div>
            </div>
          </div>
          <button class="btn btnPrimary" type="submit"><i class="fa-solid fa-plus"></i> Add domain</button>
        </form>
        <div class="splitGrid" id="tenantDomainList" style="margin-top:14px">
          ${tenantDomains.length
            ? tenantDomains.map((domain) => `
              <div class="splitItem">
                <div class="splitTop"><span>${esc(domain.hostname)}</span>${badge(domain.verificationStatus || "pending")}</div>
                <div class="muted">${esc(`${String(domain.type || "").toLowerCase() === "primary" ? "Primary domain" : "Connected domain"}${domain.verifiedAt ? ` • Verified ${fmtDate(domain.verifiedAt)}` : " • Waiting for verification"}`)}</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
                  ${domainActionMarkup(domain)}
                </div>
              </div>
            `).join("")
            : '<div class="splitItem"><div class="muted">No domains connected yet. Add a platform-managed hostname or your own custom domain to activate tenant-based access.</div></div>'}
        </div>
        <p class="muted" style="margin-top:12px">Platform-managed hostnames can verify immediately. Custom domains stay pending until the platform verifies DNS ownership.</p>
      `;

      $("#tenantDomainForm", identityCard)?.addEventListener("submit", async (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const hostname = String(new FormData(event.currentTarget).get("hostname") || "").trim();
        if (!hostname) {
          toast("Enter a hostname first.", true);
          return;
        }
        try {
          await api(withOwnerScope("/api/tenant/company/domains"), {
            method: "POST",
            body: { hostname }
          });
          toast("Domain added.");
          await refresh();
        } catch (err) {
          toast(err.message, true);
        }
      }, true);

      $$("[data-domain-action]", identityCard).forEach((button) => {
        button.onclick = async (event) => {
          event.preventDefault();
          event.stopImmediatePropagation();
          const action = String(button.dataset.domainAction || "");
          const domainId = String(button.dataset.domainId || "");
          try {
            if (action === "copy-portal") {
              await navigator.clipboard?.writeText(String(button.dataset.url || portalUrl));
              toast("Portal link copied.");
              return;
            }
            if (action === "copy-storefront") {
              await navigator.clipboard?.writeText(String(button.dataset.url || storefrontUrl));
              toast("Storefront link copied.");
              return;
            }
            if (action === "verify") {
              await api(withOwnerScope(`/api/tenant/company/domains/${encodeURIComponent(domainId)}/verify`), {
                method: "POST",
                body: {}
              });
              toast("Domain verified.");
            }
            if (action === "set-primary") {
              await api(withOwnerScope(`/api/tenant/company/domains/${encodeURIComponent(domainId)}/verify`), {
                method: "POST",
                body: { makePrimary: true }
              });
              toast("Primary domain updated.");
            }
            if (action === "remove") {
              if (!window.confirm("Remove this domain from the tenant?")) return;
              await api(withOwnerScope(`/api/tenant/company/domains/${encodeURIComponent(domainId)}`), {
                method: "DELETE"
              });
              toast("Domain removed.");
            }
            await refresh();
          } catch (err) {
            toast(err.message, true);
          }
        };
      });
    }

    function openStaffInvite(delivery = null) {
      openCrudModal(
        "Invite staff member",
        "Send a secure invite to a company employee.",
        `
          <form class="formPanel" id="staffInviteForm">
            <div class="formGrid">
              <div class="field"><label>Full name</label><div class="control"><input name="name" placeholder="Grace Operations" required></div></div>
              <div class="field"><label>Email</label><div class="control"><input name="email" type="email" placeholder="staff@classictrip.com" required></div></div>
              <div class="field"><label>Phone</label><div class="control"><input name="phone" placeholder="+256..." /></div></div>
              <div class="field"><label>Job title</label><div class="control"><input name="jobTitle" placeholder="Booking agent" required></div></div>
              <div class="field full"><label>Permissions</label><div class="control"><input name="permissionsLabel" placeholder="Front desk and check-in" required></div></div>
              <div class="field full"><label>Notes</label><div class="control"><textarea name="notes" placeholder="Optional onboarding notes"></textarea></div></div>
            </div>
            <button class="btn btnPrimary" type="submit">Send invite</button>
          </form>
          ${delivery ? `
            <div class="splitGrid">
              <button class="btn btnBlue" id="copyInviteLink">Copy link</button>
              <button class="btn" id="copyInviteEmail">Copy email</button>
              <button class="btn" id="copyInviteWhatsapp">Copy WhatsApp</button>
            </div>` : ""}
        `
      );

      $("#staffInviteForm")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const body = Object.fromEntries(new FormData(event.currentTarget).entries());
        try {
          const response = await api(withOwnerScope("/api/tenant/company/staff/invites"), {
            method: "POST",
            body
          });
          toast("Staff invite created.");
          await refresh();
          openStaffInvite(response.delivery || null);
        } catch (err) {
          toast(err.message, true);
        }
      }, true);

      if (delivery) {
        $("#copyInviteLink")?.addEventListener("click", async (event) => {
          event.preventDefault();
          await navigator.clipboard?.writeText(delivery.inviteUrl || "");
          toast("Invite link copied.");
        });
        $("#copyInviteEmail")?.addEventListener("click", async (event) => {
          event.preventDefault();
          await navigator.clipboard?.writeText(delivery.emailCopy || "");
          toast("Invite email copied.");
        });
        $("#copyInviteWhatsapp")?.addEventListener("click", async (event) => {
          event.preventDefault();
          await navigator.clipboard?.writeText(delivery.whatsappCopy || "");
          toast("Invite WhatsApp message copied.");
        });
      }
    }

    function openPayoutRequest() {
      openCrudModal(
        "Request payout",
        "Create a payout request from the current company balance.",
        `
          <form class="formPanel" id="payoutRequestForm">
            <div class="formGrid">
              <div class="field"><label>Amount</label><div class="control"><input name="amount" type="number" min="1" placeholder="150000" required></div></div>
              <div class="field"><label>Currency</label><div class="control"><input name="currency" value="${esc(company.companyCurrency || data.stats?.walletCurrency || "UGX")}" required></div></div>
              <div class="field full"><label>Destination</label><div class="control"><input name="destination" value="${esc(company.payoutAccount || "")}" placeholder="Bank or mobile money account" required></div></div>
              <div class="field full"><label>Note</label><div class="control"><textarea name="note" placeholder="Weekly settlement batch"></textarea></div></div>
            </div>
            <button class="btn btnPrimary" type="submit">Submit payout request</button>
          </form>
        `
      );

      $("#payoutRequestForm")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const body = Object.fromEntries(new FormData(event.currentTarget).entries());
        try {
          await api(withOwnerScope("/api/tenant/company/payout-requests"), {
            method: "POST",
            body
          });
          toast("Payout request submitted.");
          closeCrudModal();
          await refresh();
        } catch (err) {
          toast(err.message, true);
        }
      }, true);
    }

    setWelcome(
      `Welcome back, ${company.companyName || company.name || user?.email || "company team"}. Your live company metrics are loaded.`,
      "Manage listings, trips, bookings, staff, earnings, and company operations from backend inventory."
    );
    setPageHeading("Partner Company Dashboard", "Live company listings, schedules, bookings, staff, and wallet-backed payout visibility.");
    setStatNumbers("#overview .statsGrid .statNumber", [
      fmtMoney(data.stats?.walletCurrency, data.stats?.walletBalance),
      String(data.stats?.confirmedBookings || bookingRows.length),
      `${Math.round((activeTrips.reduce((sum, trip) => sum + (trip.totalSeats ? (trip.bookedSeats / trip.totalSeats) * 100 : 0), 0) / Math.max(activeTrips.length, 1)) || 0)}%`,
      `${Number(routeItems.reduce((sum, item) => sum + Number(item.ratingAvg || 0), 0) / Math.max(routeItems.length, 1)).toFixed(1)}/5`
    ]);

    fillTable(
      "#recentBookings",
      bookingRows.slice(0, 5).map((booking) =>
        row([
          esc(booking.code),
          esc(booking.service),
          esc(booking.customer),
          esc(booking.seats || "-"),
          badge(booking.status),
          esc(fmtMoney(booking.currency, booking.amount)),
          booking.tripId ? opsLinks(booking.tripId) : '<span class="muted">Live</span>'
        ])
      ),
      7
    );
    fillTable(
      "#listingsTable",
      routeItems.map((listing) =>
        row([
          esc(listing.title),
          esc(String(listing.type || "").toUpperCase()),
          esc(listing.type === "hotel" ? `${listing.city || ""} ${listing.address || ""}`.trim() : `${listing.from || ""} -> ${listing.to || ""}`),
          esc(String(listing.type === "hotel" ? listing.amenities?.length || 0 : activeTrips.filter((trip) => trip.type === listing.type).length)),
          esc(fmtMoney(listing.currency, activeTrips.find((trip) => String(trip.title || "").includes(listing.title))?.basePrice || 0)),
          badge(listing.isActive ? "Active" : "Review"),
          actionButton(listing.isActive ? "Pause" : "Activate", "route-toggle", `data-id="${esc(listing._id)}" data-active="${listing.isActive ? "1" : "0"}"`)
        ])
      ),
      7
    );
    fillTable(
      "#scheduleToday",
      activeTrips.map((trip) =>
        row([
          esc(String(trip._id).slice(-6).toUpperCase()),
          esc(trip.title),
          esc(fmtDate(trip.departureAt)),
          esc(trip.vehicleName || "Vehicle"),
          esc(`${trip.bookedSeats}/${trip.totalSeats}`),
          badge(trip.status || "scheduled"),
          `${opsLinks(trip._id)}${actionButton(trip.status === "scheduled" ? "Close" : "Reopen", "trip-toggle", `data-id="${esc(trip._id)}" data-status="${esc(trip.status || "scheduled")}"`)}`
        ])
      ),
      7,
      "No scheduled trips yet."
    );
    fillTable(
      "#bookingsTable",
      bookingRows.map((booking) =>
        row([
          esc(booking.code),
          esc(booking.service),
          esc(booking.customer),
          esc(booking.seats || "-"),
          esc(fmtDate(booking.travelDate)),
          badge(booking.status),
          esc(fmtMoney(booking.currency, booking.amount)),
          booking.tripId ? opsLinks(booking.tripId) : '<span class="muted">Live</span>'
        ])
      ),
      8
    );
    fillTable(
      "#inventoryTable",
      vehicleItems.map((vehicle) =>
        row([
          esc(vehicle.name),
          esc(String(vehicle.type || "").toUpperCase()),
          esc(vehicle.layoutName || "Custom"),
          esc(String(vehicle.totalSeats || 0)),
          esc(vehicle.plateOrCode || "Inventory"),
          badge(vehicle.status || "active"),
          `${actionButton("Maintain", "vehicle-status", `data-id="${esc(vehicle._id)}" data-status="maintenance"`)}${actionButton("Activate", "vehicle-status", `data-id="${esc(vehicle._id)}" data-status="active"`)}`
        ])
      ),
      7
    );
    fillTable(
      "#staffTable",
      [
        ...employees.map((employee) =>
          row([
            esc(employee.name),
            esc(employee.jobTitle || "Company employee"),
            esc(company.companyName || company.name || "Branch"),
            esc(employee.permissionsLabel || "Operations"),
            esc(fmtDate(employee.updatedAt || employee.createdAt)),
            badge(employee.status || "active"),
            actionButton(employee.status === "active" ? "Suspend" : "Activate", "staff-status", `data-id="${esc(employee.id)}" data-status="${employee.status === "active" ? "suspended" : "active"}"`)
          ])
        ),
        ...invites.map((invite) =>
          row([
            esc(invite.name || invite.email),
            esc(invite.jobTitle || "Company employee"),
            esc(company.companyName || company.name || "Branch"),
            esc(invite.permissionsLabel || "Operations"),
            esc(fmtDate(invite.lastSentAt || invite.sentAt)),
            badge(invite.status || "pending"),
            `${actionButton("Resend", "invite-resend", `data-id="${esc(invite.id)}"`)}${actionButton("Revoke", "invite-revoke", `data-id="${esc(invite.id)}"`)}`
          ])
        )
      ],
      7,
      "No staff members yet."
    );
    fillTable(
      "#payoutsTable",
      [
        ...bookingRows.filter((booking) => booking.status === "confirmed").map((booking) =>
          row([
            esc(`TX-${booking.code}`),
            esc(booking.code),
            esc(fmtMoney(booking.currency, booking.amount)),
            esc(fmtMoney(booking.currency, booking.companyAmount || 0)),
            esc(fmtMoney(booking.currency, booking.platformCommission || 0)),
            esc(booking.promoter || "Direct"),
            badge("Settled"),
            '<span class="muted">Booking</span>'
          ])
        ),
        ...payoutRequests.map((request) =>
          row([
            esc(`PAY-${String(request.id).slice(-6).toUpperCase()}`),
            esc("Withdrawal request"),
            esc("-"),
            esc(fmtMoney(request.currency, request.amount)),
            esc("-"),
            esc(request.destination || "Company payout"),
            badge(request.status || "pending"),
            '<span class="muted">Payout</span>'
          ])
        )
      ],
      8,
      "No payout ledger entries yet."
    );
    fillTable(
      "#promotionsTable",
      promotions.map((promotion) =>
        row([
          esc(`CMP-${promotion.title.slice(0, 6).toUpperCase()}`),
          esc(promotion.title),
          esc(String(promotion.type || "").toUpperCase()),
          esc(String(promotion.bookings)),
          esc(fmtMoney("UGX", promotion.revenue)),
          badge("Active"),
          esc(fmtMoney("UGX", promotion.commission)),
          '<span class="muted">Referral</span>'
        ])
      ),
      8,
      "No promotion campaigns yet."
    );
    fillTable(
      "#reviewsTable",
      reviews.map((review) =>
        row([
          esc(review.customer),
          esc(review.routeTitle),
          esc(`${review.rating}/5`),
          esc(review.comment || "Customer feedback"),
          esc(fmtDate(review.createdAt)),
          badge("Published"),
          '<span class="muted">Live</span>'
        ])
      ),
      7,
      "No live reviews yet."
    );
    fillTable(
      "#supportTable",
      supportCases.map((supportCase) =>
        row([
          esc(`SUP-${String(supportCase.id).slice(-6).toUpperCase()}`),
          esc(supportCase.customer),
          esc(supportCase.issue),
          esc(supportCase.priority || "Normal"),
          badge(supportCase.status || "open"),
          esc(fmtDate(supportCase.openedAt)),
          actionButton(supportCase.status === "resolved" ? "Close" : "Resolve", "support-status", `data-id="${esc(supportCase.id)}" data-status="${supportCase.status === "resolved" ? "closed" : "resolved"}"`)
        ])
      ),
      7,
      "No support cases yet."
    );

    if (liveListStats[0]) liveListStats[0].textContent = String(data.stats?.confirmedBookings || bookingRows.length);
    if (liveListStats[1]) liveListStats[1].textContent = String(activeTrips.reduce((sum, trip) => sum + Number(trip.heldSeats || 0), 0));
    if (liveListStats[2]) liveListStats[2].textContent = String(data.stats?.upcomingTrips || activeTrips.length);
    if (liveListStats[3]) {
      liveListStats[3].textContent = String(supportCases.filter((item) => !["resolved", "closed"].includes(String(item.status || "").toLowerCase())).length);
    }

    ensureCompanySettingsEnhancements();
    renderTenantIdentityCard();

    const settingsForm = $("#settingsForm");
    if (settingsForm) {
      const fields = $$("input, select, textarea", settingsForm);
      const timezoneInput = $("input[name='timezone']", settingsForm) || fields[5];
      if (fields[0]) fields[0].value = company.companyName || company.name || "";
      if (fields[1]) setSelectByText(fields[1], company.businessType || tenantIdentity?.businessType || "Bus company");
      if (fields[2]) setSelectByText(fields[2], company.companyCurrency || tenantIdentity?.currency || "UGX");
      if (fields[3]) fields[3].value = company.payoutAccount || "";
      if (fields[4]) fields[4].value = company.supportMessage || "";
      if (timezoneInput) timezoneInput.value = tenantIdentity?.timezone || "Africa/Kampala";
      const storefrontFields = {
        brandName: storefront?.displayName || company.companyName || company.name || "",
        brandShortName: storefront?.shortName || "",
        supportEmail: storefront?.supportEmail || "",
        supportPhone: storefront?.supportPhone || "",
        primaryColor: storefront?.primaryColor || "#4f8cff",
        accentColor: storefront?.accentColor || "#ffb703",
        hotColor: storefront?.hotColor || "#ff3d00",
        authTitle: storefront?.authTitle || "",
        authSubtitle: storefront?.authSubtitle || "",
        marketplaceTitle: storefront?.marketplaceTitle || "",
        marketplaceSubtitle: storefront?.marketplaceSubtitle || "",
        marketplaceIntro: storefront?.marketplaceIntro || "",
        supportHeadline: storefront?.supportHeadline || "",
        supportBlurb: storefront?.supportBlurb || "",
        featureOneTitle: storefront?.featureOneTitle || "",
        featureOneBody: storefront?.featureOneBody || "",
        featureTwoTitle: storefront?.featureTwoTitle || "",
        featureTwoBody: storefront?.featureTwoBody || "",
        featureThreeTitle: storefront?.featureThreeTitle || "",
        featureThreeBody: storefront?.featureThreeBody || "",
        promoHeadline: storefront?.promoHeadline || "",
        promoBody: storefront?.promoBody || ""
      };
      Object.entries(storefrontFields).forEach(([name, value]) => {
        const field = settingsForm.querySelector(`[name="${name}"]`);
        if (field) field.value = value;
      });
    }

    removeDemoModalBindings();

    const btnNew = $("#btnNew");
    const btnExport = $("#btnExport");
    if (btnNew && btnNew.parentNode) {
      const clone = btnNew.cloneNode(true);
      btnNew.parentNode.replaceChild(clone, btnNew);
      clone.onclick = (event) => {
        event.preventDefault();
        openCrudModal(
          "Create company item",
          "Use the live company flows below.",
          `
            <div class="quickGrid">
              <a class="quickCard" href="${dashboardRoute("/tenant/company-admin", "listings")}"><div class="quickIcon"><i class="fa-solid fa-route"></i></div><strong>Create listing</strong><span>Add a new route, stay, or service.</span></a>
              <a class="quickCard" href="${dashboardRoute("/tenant/company-admin", "seatrooms")}"><div class="quickIcon"><i class="fa-solid fa-bus"></i></div><strong>Add inventory</strong><span>Create a new vehicle or room group.</span></a>
              <a class="quickCard" href="${dashboardRoute("/tenant/company-admin", "schedules")}"><div class="quickIcon"><i class="fa-solid fa-calendar-plus"></i></div><strong>Add schedule</strong><span>Create a live departure or availability slot.</span></a>
              <button class="quickCard" id="modalCreateStaff"><div class="quickIcon"><i class="fa-solid fa-user-plus"></i></div><strong>Invite staff</strong><span>Send a secure onboarding invite to a team member.</span></button>
            </div>
          `
        );
        $("#modalCreateStaff")?.addEventListener("click", () => {
          closeCrudModal();
          openStaffInvite();
        }, { once: true });
      };
    }
    if (btnExport && btnExport.parentNode) {
      const clone = btnExport.cloneNode(true);
      btnExport.parentNode.replaceChild(clone, btnExport);
      clone.onclick = async (event) => {
        event.preventDefault();
        try {
          await downloadReport("summary");
          toast("Summary report downloaded.");
        } catch (err) {
          toast(err.message, true);
        }
      };
    }

    const modalButtons = $$("[data-type]");
    modalButtons.forEach((button) => {
      const type = String(button.dataset.type || "").toLowerCase();
      button.onclick = (event) => {
        if (!button.closest("#overview, #listings, #schedules, #seatrooms, #staff, #payouts, #promotions, #reports, #settings")) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (type.includes("route") || type.includes("listing")) {
          window.location.href = dashboardRoute("/tenant/company-admin", "listings");
          return;
        }
        if (type.includes("schedule")) {
          window.location.href = dashboardRoute("/tenant/company-admin", "schedules");
          return;
        }
        if (type.includes("vehicle") || type.includes("seat map") || type.includes("inventory")) {
          window.location.href = dashboardRoute("/tenant/company-admin", "seatrooms");
          return;
        }
        if (type.includes("staff")) {
          openStaffInvite();
          return;
        }
        if (type.includes("withdrawal")) {
          openPayoutRequest();
          return;
        }
        if (type.includes("custom report")) {
          downloadReport("summary").then(() => toast("Summary report downloaded.")).catch((err) => toast(err.message, true));
          return;
        }
        toast("This dashboard action is now connected where backend support exists.");
      };
    });

    const reportButtons = $$("#reports .reportCard .btn");
    ["bookings", "finance", "schedule", "inventory", "staff", "support"].forEach((type, index) => {
      if (reportButtons[index]) {
        reportButtons[index].onclick = async (event) => {
          event.preventDefault();
          try {
            await downloadReport(type);
            toast(`${type} report downloaded.`);
          } catch (err) {
            toast(err.message, true);
          }
        };
      }
    });

    $$("#staffTable [data-company-action], #supportTable [data-company-action], #inventoryTable [data-company-action], #scheduleToday [data-company-action], #listingsTable [data-company-action]").forEach((button) => {
      button.onclick = async (event) => {
        event.preventDefault();
        try {
          if (button.dataset.companyAction === "staff-status") {
            await api(withOwnerScope(`/api/tenant/company/staff/${encodeURIComponent(button.dataset.id)}/status`), {
              method: "PATCH",
              body: { status: button.dataset.status }
            });
            toast("Staff status updated.");
          }
          if (button.dataset.companyAction === "invite-resend") {
            const response = await api(withOwnerScope(`/api/tenant/company/staff/invites/${encodeURIComponent(button.dataset.id)}/resend`), {
              method: "POST"
            });
            toast("Invite resent.");
            openStaffInvite(response.delivery || null);
          }
          if (button.dataset.companyAction === "invite-revoke") {
            await api(withOwnerScope(`/api/tenant/company/staff/invites/${encodeURIComponent(button.dataset.id)}/revoke`), {
              method: "POST"
            });
            toast("Invite revoked.");
          }
          if (button.dataset.companyAction === "support-status") {
            await api(withOwnerScope(`/api/tenant/company/support/${encodeURIComponent(button.dataset.id)}`), {
              method: "PATCH",
              body: { status: button.dataset.status, notes: button.dataset.status === "resolved" ? "Resolved from dashboard" : "Closed from dashboard" }
            });
            toast("Support case updated.");
          }
          if (button.dataset.companyAction === "vehicle-status") {
            await api(withOwnerScope(`/api/tenant/company/vehicles/${encodeURIComponent(button.dataset.id)}`), {
              method: "PATCH",
              body: { status: button.dataset.status }
            });
            toast("Inventory status updated.");
          }
          if (button.dataset.companyAction === "trip-toggle") {
            await api(withOwnerScope(`/api/tenant/company/trips/${encodeURIComponent(button.dataset.id)}`), {
              method: "PATCH",
              body: { status: button.dataset.status === "scheduled" ? "closed" : "scheduled" }
            });
            toast("Schedule updated.");
          }
          if (button.dataset.companyAction === "route-toggle") {
            await api(withOwnerScope(`/api/tenant/company/routes/${encodeURIComponent(button.dataset.id)}`), {
              method: "PATCH",
              body: { isActive: button.dataset.active !== "1" }
            });
            toast("Listing status updated.");
          }
          await refresh();
        } catch (err) {
          toast(err.message, true);
        }
      };
    });

    const settingsSubmit = $("#settingsForm");
    if (settingsSubmit) {
      settingsSubmit.onsubmit = async (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const fields = $$("input, select, textarea", event.currentTarget);
        const timezoneInput = $("input[name='timezone']", event.currentTarget) || fields[5];
        const fieldValue = (name, fallback = "") => event.currentTarget.querySelector(`[name="${name}"]`)?.value || fallback;
        try {
          await api(withOwnerScope("/api/tenant/company/settings"), {
            method: "PATCH",
            body: {
              companyName: fields[0]?.value || "",
              businessType: fields[1]?.selectedOptions?.[0]?.textContent || fields[1]?.value || "",
              companyCurrency: fields[2]?.value || "UGX",
              payoutAccount: fields[3]?.value || "",
              supportMessage: fields[4]?.value || "",
              country: company.country || "Uganda",
              phone: company.phone || "",
              timezone: timezoneInput?.value || tenantIdentity?.timezone || "Africa/Kampala",
              brandName: fieldValue("brandName"),
              brandShortName: fieldValue("brandShortName"),
              supportEmail: fieldValue("supportEmail"),
              supportPhone: fieldValue("supportPhone"),
              primaryColor: fieldValue("primaryColor"),
              accentColor: fieldValue("accentColor"),
              hotColor: fieldValue("hotColor"),
              authTitle: fieldValue("authTitle"),
              authSubtitle: fieldValue("authSubtitle"),
              marketplaceTitle: fieldValue("marketplaceTitle"),
              marketplaceSubtitle: fieldValue("marketplaceSubtitle"),
              marketplaceIntro: fieldValue("marketplaceIntro"),
              supportHeadline: fieldValue("supportHeadline"),
              supportBlurb: fieldValue("supportBlurb"),
              featureOneTitle: fieldValue("featureOneTitle"),
              featureOneBody: fieldValue("featureOneBody"),
              featureTwoTitle: fieldValue("featureTwoTitle"),
              featureTwoBody: fieldValue("featureTwoBody"),
              featureThreeTitle: fieldValue("featureThreeTitle"),
              featureThreeBody: fieldValue("featureThreeBody"),
              promoHeadline: fieldValue("promoHeadline"),
              promoBody: fieldValue("promoBody")
            }
          });
          toast("Company settings saved.");
          await refresh();
        } catch (err) {
          toast(err.message, true);
        }
      };
    }

    const noticeSubmit = $("#noticeForm");
    if (noticeSubmit) {
      noticeSubmit.onsubmit = async (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const fields = $$("select, textarea", event.currentTarget);
        const audienceMap = {
          "Customers on selected trip": "customers_on_selected_trip",
          "All customers today": "all_customers_today",
          "Staff only": "staff_only",
          "Manager only": "staff_only"
        };
        try {
          await api(withOwnerScope("/api/tenant/company/notices"), {
            method: "POST",
            body: {
              audience: audienceMap[fields[0]?.selectedOptions?.[0]?.textContent || "All customers today"] || "all_customers_today",
              priority: normalizeText(fields[1]?.selectedOptions?.[0]?.textContent || "normal"),
              message: fields[2]?.value || ""
            }
          });
          toast("Notice sent.");
          event.currentTarget.reset();
          await refresh();
        } catch (err) {
          toast(err.message, true);
        }
      };
    }
  }

  async function renderEmployeeLive() {
    const [data, supportData, noticesData] = await Promise.all([
      api(withOwnerScope("/api/platform/dashboards/company-employee")),
      api(withOwnerScope("/api/tenant/company/support")),
      api(withOwnerScope("/api/tenant/company/notices"))
    ]);
    const bookingRows = data.bookingRows || [];
    const todayTrips = data.todayTrips || [];
    const tripOptions = data.tripOptions || [];
    const coworkers = data.coworkers || [];
    const supportCases = supportData.items || [];
    const notices = noticesData.items || [];
    const refresh = async () => renderEmployeeLive();
    const pendingPaymentBookings = bookingRows.filter((booking) => {
      const status = String(booking.status || "").toLowerCase();
      const paymentStatus = String(booking.paymentStatus || "").toLowerCase();
      return status === "pending_payment" || paymentStatus === "pending";
    });
    const refundableBookings = bookingRows.filter((booking) => {
      const status = String(booking.status || "").toLowerCase();
      const paymentStatus = String(booking.paymentStatus || "").toLowerCase();
      return status === "confirmed" && paymentStatus === "paid";
    });
    const refundedBookings = bookingRows.filter((booking) => ["cancelled", "refunded"].includes(String(booking.status || "").toLowerCase()));
    const moveableBookings = bookingRows.filter((booking) =>
      !["cancelled", "refunded"].includes(String(booking.status || "").toLowerCase()) &&
      Array.isArray(booking.seatIds) &&
      booking.seatIds.length
    );
    const tripLookup = new Map(tripOptions.map((trip) => [String(trip.id || trip._id), trip]));

    function bookingDeskState(booking) {
      const status = String(booking.status || "").toLowerCase();
      const paymentStatus = String(booking.paymentStatus || "").toLowerCase();
      const checkInStatus = String(booking.checkInStatus || "").toLowerCase();

      if (checkInStatus === "checked_in") return "Checked in";
      if (checkInStatus === "no_show") return "No show";
      if (status === "refunded") return "Refund";
      if (status === "cancelled") return "Cancelled";
      if (status === "pending_payment" || paymentStatus === "pending") return "Hold";
      if (paymentStatus === "paid") return "Paid";
      return booking.status || "Open";
    }

    function paymentMethodLabel(booking) {
      return (booking.paymentProvider || "").replace(/_/g, " ") || booking.paymentMethodNote || (booking.status === "pending_payment" ? "Pending payment" : "Recorded payment");
    }

    function checkInBadge(booking) {
      const state = String(booking.checkInStatus || "").toLowerCase();
      if (state === "checked_in") return badge("Checked in");
      if (state === "no_show") return badge("No show");
      return badge(booking.status === "confirmed" ? "Ready" : booking.status);
    }

    function canCheckIn(booking) {
      return String(booking.status || "").toLowerCase() === "confirmed"
        && String(booking.paymentStatus || "").toLowerCase() === "paid"
        && String(booking.checkInStatus || "").toLowerCase() !== "checked_in";
    }

    function canMarkNoShow(booking) {
      return !["cancelled", "refunded"].includes(String(booking.status || "").toLowerCase())
        && String(booking.checkInStatus || "").toLowerCase() !== "checked_in";
    }

    function findBooking(bookingId) {
      return bookingRows.find((booking) => String(booking._id) === String(bookingId));
    }

    function fillFilterTables(group, items, rowBuilder, colSpan, emptyText = "No records yet.") {
      $$(`[data-filter-table="${group}"]`).forEach((tbody) => {
        const filter = String(tbody.dataset.filter || "").trim().toLowerCase();
        const rows = items.filter((item) => rowBuilder.filter(item, filter)).map((item) => rowBuilder.render(item));
        tbody.innerHTML = rows.length ? rows.join("") : `<tr><td colspan="${colSpan}">${esc(emptyText)}</td></tr>`;
      });
    }

    async function runBookingLookup(queryText, tripId = "", limit = 10) {
      const params = new URLSearchParams();
      if (queryText) params.set("q", queryText);
      if (tripId) params.set("tripId", tripId);
      params.set("limit", String(limit));
      const response = await api(withOwnerScope(`/api/tenant/company/bookings/lookup?${params.toString()}`));
      return response.items || [];
    }

    async function performCheckAction(bookingId, action, note = "") {
      await api(withOwnerScope(`/api/tenant/company/bookings/${encodeURIComponent(bookingId)}/check-in`), {
        method: "POST",
        body: {
          action,
          note
        }
      });
    }

    function setTripSelectOptions(select, includeBlankLabel = "All trips") {
      if (!select) return;
      const liveTrips = tripOptions.filter((trip) => String(trip.status || "").toLowerCase() !== "cancelled");
      select.innerHTML = [
        includeBlankLabel ? `<option value="">${esc(includeBlankLabel)}</option>` : "",
        ...liveTrips.map((trip) => `<option value="${esc(trip.id)}">${esc(trip.title)} · ${esc(fmtDate(trip.departureAt))} · ${esc(`${trip.remainingSeats} seats free`)}</option>`)
      ].join("");
    }

    function openManualBookingModal(defaultTripId = "") {
      const liveTrips = tripOptions.filter((trip) => String(trip.status || "").toLowerCase() === "scheduled" && Number(trip.remainingSeats || 0) > 0);
      if (!liveTrips.length) {
        toast("There are no scheduled trips with open seats for a manual booking.");
        return;
      }

      openCrudModal(
        "Create manual booking",
        "Create a walk-in booking directly from the desk and optionally mark it paid immediately.",
        `
          <form class="formPanel" id="manualBookingForm">
            <div class="formGrid">
              <div class="field full">
                <label>Trip</label>
                <div class="control">
                  <select name="tripId" required>
                    ${liveTrips.map((trip) => `<option value="${esc(trip.id)}" ${String(defaultTripId) === String(trip.id) ? "selected" : ""}>${esc(trip.title)} · ${esc(fmtDate(trip.departureAt))} · ${esc(fmtMoney(trip.currency, trip.basePrice))} · ${esc(`${trip.remainingSeats} seats free`)}</option>`).join("")}
                  </select>
                </div>
              </div>
              <div class="field full">
                <label>Seat numbers</label>
                <div class="control">
                  <input name="seats" placeholder="Example: 1A, 1B" required />
                </div>
              </div>
              <div class="field">
                <label>Customer name</label>
                <div class="control">
                  <input name="name" placeholder="Walk-in customer" required />
                </div>
              </div>
              <div class="field">
                <label>Phone</label>
                <div class="control">
                  <input name="phone" placeholder="+256..." />
                </div>
              </div>
              <div class="field full">
                <label>Email</label>
                <div class="control">
                  <input name="email" type="email" placeholder="customer@example.com" />
                </div>
              </div>
              <div class="field">
                <label>Booking state</label>
                <div class="control">
                  <select name="paymentState" required>
                    <option value="pending_payment">Create pending payment</option>
                    <option value="paid">Create paid booking</option>
                  </select>
                </div>
              </div>
              <div class="field">
                <label>Payment method</label>
                <div class="control">
                  <select name="paymentMethod">
                    <option value="cash">Cash</option>
                    <option value="mobile_money">Mobile money</option>
                    <option value="card">Card</option>
                    <option value="bank_transfer">Bank transfer</option>
                  </select>
                </div>
              </div>
              <div class="field full">
                <label>Reference</label>
                <div class="control">
                  <input name="paymentReference" placeholder="Receipt or desk reference" />
                </div>
              </div>
              <div class="field full">
                <label>Desk note</label>
                <div class="control">
                  <textarea name="note" placeholder="Special pickup note, luggage note, or desk comment"></textarea>
                </div>
              </div>
            </div>
            <button class="btn btnPrimary" type="submit">Create booking</button>
          </form>
        `
      );

      $("#manualBookingForm").onsubmit = async (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const formData = Object.fromEntries(new FormData(event.currentTarget).entries());
        try {
          const response = await api(withOwnerScope("/api/tenant/company/bookings/manual"), {
            method: "POST",
            body: {
              tripId: formData.tripId,
              seats: String(formData.seats || "").split(",").map((seat) => seat.trim()).filter(Boolean),
              guest: {
                name: formData.name,
                phone: formData.phone,
                email: formData.email
              },
              paymentState: formData.paymentState,
              paymentMethod: formData.paymentMethod,
              paymentReference: formData.paymentReference,
              note: formData.note
            }
          });
          toast(`Manual booking created: ${response.booking?.code || "booking saved"}.`);
          closeCrudModal();
          await refresh();
        } catch (err) {
          toast(err.message, true);
        }
      };
    }

    function openDelayNoticeModal(defaultTripId = "") {
      const liveTrips = tripOptions.filter((trip) => String(trip.status || "").toLowerCase() === "scheduled");
      if (!liveTrips.length) {
        toast("There are no scheduled trips available for a delay notice.");
        return;
      }

      openCrudModal(
        "Send delay notice",
        "Notify customers on a selected trip about a delay, boarding update, or service change.",
        `
          <form class="formPanel" id="delayNoticeForm">
            <div class="formGrid">
              <div class="field full">
                <label>Trip</label>
                <div class="control">
                  <select name="tripId" required>
                    ${liveTrips.map((trip) => `<option value="${esc(trip.id)}" ${String(defaultTripId) === String(trip.id) ? "selected" : ""}>${esc(trip.title)} · ${esc(fmtDate(trip.departureAt))}</option>`).join("")}
                  </select>
                </div>
              </div>
              <div class="field">
                <label>Priority</label>
                <div class="control">
                  <select name="priority">
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                    <option value="normal">Normal</option>
                  </select>
                </div>
              </div>
              <div class="field full">
                <label>Message</label>
                <div class="control">
                  <textarea name="message" placeholder="Departure moved to 11:30 AM. Please remain at the terminal." required></textarea>
                </div>
              </div>
            </div>
            <button class="btn btnPrimary" type="submit">Send notice</button>
          </form>
        `
      );

      $("#delayNoticeForm").onsubmit = async (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const formData = Object.fromEntries(new FormData(event.currentTarget).entries());
        try {
          await api(withOwnerScope("/api/tenant/company/notices"), {
            method: "POST",
            body: {
              audience: "customers_on_selected_trip",
              priority: formData.priority,
              tripId: formData.tripId,
              message: formData.message
            }
          });
          toast("Delay notice sent.");
          closeCrudModal();
          await refresh();
        } catch (err) {
          toast(err.message, true);
        }
      };
    }

    function openCustomerNoteModal(defaultBookingId = "") {
      if (!bookingRows.length) {
        toast("There are no bookings available for customer notes.");
        return;
      }

      openCrudModal(
        "Add customer note",
        "Attach a desk note to a booking so the company team can see the latest customer context.",
        `
          <form class="formPanel" id="customerNoteForm">
            <div class="formGrid">
              <div class="field full">
                <label>Booking</label>
                <div class="control">
                  <select name="bookingId" required>
                    ${bookingRows.map((booking) => `<option value="${esc(booking._id)}" ${String(defaultBookingId) === String(booking._id) ? "selected" : ""}>${esc(booking.code)} · ${esc(booking.customer)} · ${esc(booking.service)}</option>`).join("")}
                  </select>
                </div>
              </div>
              <div class="field full">
                <label>Note</label>
                <div class="control">
                  <textarea name="note" placeholder="Passenger requested front-row seat, called about luggage, needs callback..." required></textarea>
                </div>
              </div>
            </div>
            <button class="btn btnPrimary" type="submit">Save note</button>
          </form>
        `
      );

      $("#customerNoteForm").onsubmit = async (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const formData = Object.fromEntries(new FormData(event.currentTarget).entries());
        try {
          await api(withOwnerScope(`/api/tenant/company/bookings/${encodeURIComponent(formData.bookingId)}/customer-notes`), {
            method: "POST",
            body: { note: formData.note }
          });
          toast("Customer note saved.");
          closeCrudModal();
          await refresh();
        } catch (err) {
          toast(err.message, true);
        }
      };
    }

    function openInventoryModal(defaultTripId = "", defaultBookingId = "") {
      const scopedBookings = moveableBookings.filter((booking) => !defaultTripId || String(booking.tripId) === String(defaultTripId));
      const inventoryBookings = scopedBookings.length ? scopedBookings : moveableBookings;
      if (!inventoryBookings.length) {
        toast("There are no active booked seats available to move right now.");
        return;
      }

      openCrudModal(
        "Update inventory",
        "Move a booked passenger to a different seat when the desk needs to resolve seating changes.",
        `
          <form class="formPanel" id="moveSeatForm">
            <div class="formGrid">
              <div class="field full">
                <label>Booking</label>
                <div class="control">
                  <select name="bookingId" required>
                    ${inventoryBookings.map((booking) => `<option value="${esc(booking._id)}" data-trip-id="${esc(booking.tripId)}" ${String(defaultBookingId) === String(booking._id) ? "selected" : ""}>${esc(booking.code)} · ${esc(booking.customer)} · ${esc(booking.seats)}</option>`).join("")}
                  </select>
                </div>
              </div>
              <div class="field">
                <label>Current seat</label>
                <div class="control">
                  <select name="fromSeatId" required></select>
                </div>
              </div>
              <div class="field">
                <label>New seat</label>
                <div class="control">
                  <input name="toSeatId" placeholder="Example: 2B" required />
                </div>
              </div>
              <div class="field full">
                <label>Move note</label>
                <div class="control">
                  <textarea name="note" placeholder="Reason for seat move"></textarea>
                </div>
              </div>
            </div>
            <button class="btn btnPrimary" type="submit">Move seat</button>
          </form>
        `
      );

      const bookingSelect = $("#moveSeatForm [name=\"bookingId\"]");
      const fromSeatSelect = $("#moveSeatForm [name=\"fromSeatId\"]");
      const syncSeatOptions = () => {
        const booking = findBooking(bookingSelect?.value);
        const seatIds = Array.isArray(booking?.seatIds) ? booking.seatIds : [];
        fromSeatSelect.innerHTML = seatIds.map((seatId) => `<option value="${esc(seatId)}">${esc(seatId)}</option>`).join("");
      };
      bookingSelect.onchange = syncSeatOptions;
      syncSeatOptions();

      $("#moveSeatForm").onsubmit = async (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const formData = Object.fromEntries(new FormData(event.currentTarget).entries());
        try {
          await api(withOwnerScope(`/api/tenant/company/bookings/${encodeURIComponent(formData.bookingId)}/move-seat`), {
            method: "POST",
            body: {
              fromSeatId: formData.fromSeatId,
              toSeatId: formData.toSeatId,
              note: formData.note
            }
          });
          toast("Seat move saved.");
          closeCrudModal();
          await refresh();
        } catch (err) {
          toast(err.message, true);
        }
      };
    }

    function openTicketCheckModal(initialSearch = "", defaultTripId = "") {
      openCrudModal(
        "Ticket check-in",
        "Search by booking code, phone, name, or seat and then check in or mark a no-show.",
        `
          <form class="formPanel" id="ticketLookupForm">
            <div class="formGrid">
              <div class="field full">
                <label>Search</label>
                <div class="control">
                  <input name="q" value="${esc(initialSearch)}" placeholder="CE-2401, Amina, +256..., 1A" required />
                </div>
              </div>
              <div class="field full">
                <label>Trip</label>
                <div class="control">
                  <select name="tripId"></select>
                </div>
              </div>
            </div>
            <button class="btn btnPrimary" type="submit">Find booking</button>
          </form>
          <div class="tableWrap" style="margin-top:14px">
            <table>
              <thead><tr><th>Booking</th><th>Customer</th><th>Trip</th><th>Seat</th><th>Status</th><th></th></tr></thead>
              <tbody id="ticketLookupResults"><tr><td colspan="6">Run a search to load matching bookings.</td></tr></tbody>
            </table>
          </div>
        `
      );

      const tripSelect = $("#ticketLookupForm [name=\"tripId\"]");
      setTripSelectOptions(tripSelect);
      if (defaultTripId) tripSelect.value = defaultTripId;

      const renderLookupResults = (items) => {
        fillTable(
          "#ticketLookupResults",
          items.map((booking) =>
            row([
              esc(booking.code),
              esc(booking.customer),
              esc(booking.service),
              esc(booking.seats || "-"),
              checkInBadge(booking),
              [
                canCheckIn(booking) ? actionButton("Check in", "check-in-booking", `data-id="${esc(booking.id || booking._id)}"`) : "",
                canMarkNoShow(booking) ? actionButton("No-show", "no-show-booking", `data-id="${esc(booking.id || booking._id)}"`) : "",
                actionButton("Note", "customer-note", `data-id="${esc(booking.id || booking._id)}"`)
              ].filter(Boolean).join(" ")
            ])
          ),
          6,
          "No matching bookings found."
        );

        $$("#ticketLookupResults [data-company-action]").forEach((button) => {
          button.onclick = async (event) => {
            event.preventDefault();
            event.stopImmediatePropagation();
            try {
              if (button.dataset.companyAction === "check-in-booking") {
                await performCheckAction(button.dataset.id, "check_in", "Checked in from ticket lookup");
                toast("Passenger checked in.");
              } else if (button.dataset.companyAction === "no-show-booking") {
                await performCheckAction(button.dataset.id, "mark_no_show", "Marked as no-show from ticket lookup");
                toast("Booking marked as no-show.");
              } else if (button.dataset.companyAction === "customer-note") {
                openCustomerNoteModal(button.dataset.id);
                return;
              }
              await refresh();
              closeCrudModal();
            } catch (err) {
              toast(err.message, true);
            }
          };
        });
      };

      $("#ticketLookupForm").onsubmit = async (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const formData = Object.fromEntries(new FormData(event.currentTarget).entries());
        try {
          const items = await runBookingLookup(formData.q, formData.tripId, 12);
          renderLookupResults(items);
        } catch (err) {
          toast(err.message, true);
        }
      };
    }

    function openRecordPaymentModal(defaultBookingId = "") {
      if (!pendingPaymentBookings.length) {
        toast("There are no pending bookings waiting for payment.");
        return;
      }

      openCrudModal(
        "Record payment",
        "Mark a pending booking as paid from the employee cashier flow.",
        `
          <form class="formPanel" id="recordPaymentForm">
            <div class="formGrid">
              <div class="field full">
                <label>Booking</label>
                <div class="control">
                  <select name="bookingId" required>
                    ${pendingPaymentBookings.map((booking) => `<option value="${esc(booking._id)}" ${String(defaultBookingId) === String(booking._id) ? "selected" : ""}>${esc(booking.code)} · ${esc(booking.customer)} · ${esc(fmtMoney(booking.currency, booking.amount))}</option>`).join("")}
                  </select>
                </div>
              </div>
              <div class="field">
                <label>Method</label>
                <div class="control">
                  <select name="method" required>
                    <option value="cash">Cash</option>
                    <option value="mobile_money">Mobile money</option>
                    <option value="card">Card</option>
                    <option value="bank_transfer">Bank transfer</option>
                  </select>
                </div>
              </div>
              <div class="field">
                <label>Reference</label>
                <div class="control">
                  <input name="reference" placeholder="Receipt or transaction ref" />
                </div>
              </div>
              <div class="field full">
                <label>Note</label>
                <div class="control">
                  <textarea name="note" placeholder="Optional cashier note"></textarea>
                </div>
              </div>
            </div>
            <button class="btn btnPrimary" type="submit">Record payment</button>
          </form>
        `
      );

      $("#recordPaymentForm").onsubmit = async (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const formData = Object.fromEntries(new FormData(event.currentTarget).entries());
        const bookingId = formData.bookingId;
        delete formData.bookingId;
        try {
          await api(withOwnerScope(`/api/tenant/company/bookings/${encodeURIComponent(bookingId)}/payments`), {
            method: "POST",
            body: formData
          });
          toast("Payment recorded.");
          closeCrudModal();
          await refresh();
        } catch (err) {
          toast(err.message, true);
        }
      };
    }

    function openRefundModal(defaultBookingId = "") {
      if (!refundableBookings.length) {
        toast("There are no paid bookings available for refund.");
        return;
      }

      openCrudModal(
        "Create refund",
        "Refund a paid confirmed booking from the employee flow.",
        `
          <form class="formPanel" id="refundBookingForm">
            <div class="formGrid">
              <div class="field full">
                <label>Booking</label>
                <div class="control">
                  <select name="bookingId" required>
                    ${refundableBookings.map((booking) => `<option value="${esc(booking._id)}" ${String(defaultBookingId) === String(booking._id) ? "selected" : ""}>${esc(booking.code)} · ${esc(booking.customer)} · ${esc(fmtMoney(booking.currency, booking.amount))}</option>`).join("")}
                  </select>
                </div>
              </div>
              <div class="field full">
                <label>Reason</label>
                <div class="control">
                  <textarea name="reason" placeholder="Customer requested refund, route cancellation, payment reversal..." required></textarea>
                </div>
              </div>
            </div>
            <button class="btn btnPrimary" type="submit">Create refund</button>
          </form>
        `
      );

      $("#refundBookingForm").onsubmit = async (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const formData = Object.fromEntries(new FormData(event.currentTarget).entries());
        const bookingId = formData.bookingId;
        delete formData.bookingId;
        try {
          await api(withOwnerScope(`/api/tenant/company/bookings/${encodeURIComponent(bookingId)}/refund`), {
            method: "POST",
            body: formData
          });
          toast("Refund processed.");
          closeCrudModal();
          await refresh();
        } catch (err) {
          toast(err.message, true);
        }
      };
    }

    setWelcome(
      `Welcome ${data.employee?.name || user?.email || "team member"}. Your live shift data is ready.`,
      "Check bookings, schedules, passenger activity, and desk operations from the backend."
    );
    setPageHeading("Company Employee Dashboard", "Live shift operations, bookings, schedules, support, and check-in visibility.");
    setStatNumbers("#overview .statsGrid .statNumber", [
      String(data.stats?.confirmedBookings || 0),
      String(bookingRows.filter((booking) => booking.status === "pending_payment").length),
      String((data.operationNotes || []).length),
      fmtMoney(bookingRows[0]?.currency || "UGX", bookingRows.reduce((sum, booking) => sum + Number(booking.amount || 0), 0))
    ]);

    $$("[data-modal]").forEach((node) => node.removeAttribute("data-modal"));
    $$("[data-type]").forEach((button) => {
      const type = String(button.dataset.type || "").toLowerCase();
      button.onclick = (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (type.includes("ticket check")) {
          openTicketCheckModal($("#checkSearch")?.value || "");
          return;
        }
        if (type.includes("manual booking")) {
          openManualBookingModal();
          return;
        }
        if (type.includes("seat or room") || type.includes("inventory")) {
          openInventoryModal();
          return;
        }
        if (type.includes("delay notice")) {
          openDelayNoticeModal();
          return;
        }
        if (type.includes("customer note")) {
          openCustomerNoteModal();
          return;
        }
        if (type.includes("handover note")) {
          document.querySelector("#handover")?.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
        if (type.includes("employee report")) {
          downloadReport("staff").then(() => toast("Employee report downloaded.")).catch((err) => toast(err.message, true));
          return;
        }
        if (type.includes("payment receipt")) {
          openRecordPaymentModal();
          return;
        }
        if (type.includes("refund request")) {
          openRefundModal();
          return;
        }
        toast("This employee action is now connected where backend support exists.");
      };
    });

    fillTable(
      "#tasksTable",
      (data.operationNotes || []).map((note, index) =>
        row([
          esc(`TASK-${index + 1}`),
          esc(note),
          esc(data.company?.companyName || data.company?.name || "Company"),
          badge("Open"),
          esc(fmtDate(new Date())),
          '<span class="muted">Ops</span>'
        ])
      ),
      6,
      "No operational tasks yet."
    );
    fillTable(
      "#checkinTable",
      bookingRows.map((booking) =>
        row([
          esc(booking.code),
          esc(booking.service),
          esc(booking.customer),
          esc(booking.seats || "-"),
          esc(fmtDate(booking.travelDate)),
          checkInBadge(booking),
          [
            canCheckIn(booking) ? actionButton("Check in", "check-in-booking", `data-id="${esc(booking._id)}"`) : "",
            canMarkNoShow(booking) ? actionButton("No-show", "no-show-booking", `data-id="${esc(booking._id)}"`) : "",
            booking.tripId ? opsLinks(booking.tripId) : ""
          ].filter(Boolean).join(" ") || '<span class="muted">Live</span>'
        ])
      ),
      7,
      "No check-in records yet."
    );
    fillTable(
      "#bookingsTable",
      bookingRows.map((booking) =>
        row([
          esc(booking.code),
          esc(booking.service),
          esc(booking.customer),
          esc(booking.seats || "-"),
          esc(fmtDate(booking.travelDate)),
          badge(bookingDeskState(booking)),
          esc(fmtMoney(booking.currency, booking.amount)),
          [
            actionButton("Note", "customer-note", `data-id="${esc(booking._id)}"`),
            Array.isArray(booking.seatIds) && booking.seatIds.length ? actionButton("Move seat", "move-seat", `data-id="${esc(booking._id)}"`) : "",
            booking.tripId ? opsLinks(booking.tripId) : ""
          ].filter(Boolean).join(" ")
        ])
      ),
      8
    );
    fillTable(
      "#scheduleToday",
      todayTrips.map((trip) =>
        row([
          esc(String(trip._id || trip.id).slice(-6).toUpperCase()),
          esc(trip.title),
          esc(fmtDate(trip.departureAt)),
          esc(trip.vehicleName || "Vehicle"),
          esc(`${trip.bookedSeats}/${trip.totalSeats}`),
          badge(trip.status || "Today"),
          [
            actionButton("Delay notice", "delay-notice", `data-trip-id="${esc(trip._id || trip.id)}"`),
            opsLinks(trip._id || trip.id)
          ].join(" ")
        ])
      ),
      7,
      "No trips scheduled for today."
    );
    fillTable(
      "#inventoryTable",
      tripOptions.map((trip) =>
        row([
          esc(trip.title),
          esc(trip.vehicleName || "Inventory"),
          esc(String(trip.totalSeats || 0)),
          esc(String(trip.bookedSeats || 0)),
          esc(String(trip.heldSeats || 0)),
          esc("0"),
          badge(trip.status || "Live"),
          actionButton("Move seat", "open-inventory", `data-trip-id="${esc(trip.id || trip._id)}"`)
        ])
      ),
      8,
      "No inventory records yet."
    );

    const customerGroups = [...bookingRows.reduce((map, booking) => {
      const key = `${booking.customer}::${booking.contact || "-"}`;
      const current = map.get(key) || {
        customer: booking.customer,
        contact: booking.contact || "-",
        bookings: 0,
        spent: 0,
        latestTrip: booking.service,
        latestTravelDate: booking.travelDate,
        lastBookingId: booking._id,
        status: bookingDeskState(booking)
      };
      current.bookings += 1;
      current.spent += Number(booking.amount || 0);
      if (new Date(booking.travelDate || 0) >= new Date(current.latestTravelDate || 0)) {
        current.latestTrip = booking.service;
        current.latestTravelDate = booking.travelDate;
        current.lastBookingId = booking._id;
        current.status = bookingDeskState(booking);
      }
      map.set(key, current);
      return map;
    }, new Map()).values()];

    fillTable(
      "#customersTable",
      customerGroups.map((customer) =>
        row([
          esc(customer.customer),
          esc(customer.contact || "-"),
          esc(String(customer.bookings)),
          esc(customer.latestTrip),
          esc(fmtMoney(bookingRows[0]?.currency || "UGX", customer.spent)),
          badge(customer.status),
          actionButton("Add note", "customer-note", `data-id="${esc(customer.lastBookingId)}"`)
        ])
      ),
      7
    );
    fillTable(
      "#paymentsTable",
      bookingRows.map((booking) =>
        row([
          esc(`PAY-${booking.code}`),
          esc(booking.code),
          esc(booking.customer),
          esc(paymentMethodLabel(booking)),
          esc(fmtMoney(booking.currency, booking.amount)),
          badge(booking.paymentStatus || booking.status),
          (String(booking.status || "").toLowerCase() === "pending_payment" || String(booking.paymentStatus || "").toLowerCase() === "pending")
            ? actionButton("Record", "record-payment", `data-id="${esc(booking._id)}"`)
            : '<span class="muted">Paid</span>'
        ])
      ),
      7
    );
    fillTable(
      "#refundsTable",
      [
        ...refundableBookings.map((booking) =>
          row([
            esc(`RFD-${booking.code}`),
            esc(booking.code),
            esc(booking.customer),
            esc("Paid booking eligible for refund"),
            esc(fmtMoney(booking.currency, booking.amount)),
            badge("Pending"),
            actionButton("Refund", "refund-booking", `data-id="${esc(booking._id)}"`)
          ])
        ),
        ...refundedBookings.map((booking) =>
        row([
          esc(`RFD-${booking.code}`),
          esc(booking.code),
          esc(booking.customer),
          esc(booking.cancellationReason || (booking.status === "refunded" ? "Refund completed" : "Booking cancelled")),
          esc(fmtMoney(booking.currency, booking.amount)),
          badge(booking.status),
          '<span class="muted">Desk</span>'
        ])
        )
      ],
      7,
      "No refund requests yet."
    );
    fillTable(
      "#supportTable",
      supportCases.map((supportCase) =>
        row([
          esc(`SUP-${String(supportCase.id).slice(-6).toUpperCase()}`),
          esc(supportCase.customer),
          esc(supportCase.issue),
          esc(supportCase.priority || "Normal"),
          badge(supportCase.status || "open"),
          esc(fmtDate(supportCase.openedAt)),
          ["resolved", "closed"].includes(String(supportCase.status || "").toLowerCase())
            ? '<span class="muted">Resolved</span>'
            : actionButton("Resolve", "resolve-support", `data-id="${esc(supportCase.id)}"`)
        ])
      ),
      7,
      "No support tasks yet."
    );
    fillTable(
      "#handoverTable",
      notices.map((notice) =>
        row([
          esc(String(notice.priority || "normal").toUpperCase()),
          esc(data.company?.companyName || data.company?.name || "Company"),
          esc(notice.message),
          badge(notice.status || "sent"),
          esc(fmtDate(notice.createdAt))
        ])
      ),
      5,
      "No handover notes yet."
    );

    fillFilterTables("bookings-status", bookingRows, {
      filter: (booking, filter) => {
        const state = bookingDeskState(booking).toLowerCase();
        return state === filter;
      },
      render: (booking) =>
        row([
          esc(booking.code),
          esc(booking.service),
          esc(booking.customer),
          esc(booking.seats || "-"),
          esc(fmtDate(booking.travelDate)),
          badge(bookingDeskState(booking)),
          esc(fmtMoney(booking.currency, booking.amount)),
          booking.tripId ? opsLinks(booking.tripId) : '<span class="muted">Live</span>'
        ])
    }, 8, "No bookings for this filter.");

    fillFilterTables("refunds-status", [...refundableBookings, ...refundedBookings], {
      filter: (booking, filter) => {
        if (filter === "pending") return refundableBookings.some((item) => String(item._id) === String(booking._id));
        if (filter === "approved") return String(booking.status || "").toLowerCase() === "refunded";
        if (filter === "rejected") return String(booking.status || "").toLowerCase() === "cancelled";
        return false;
      },
      render: (booking) =>
        row([
          esc(`RFD-${booking.code}`),
          esc(booking.code),
          esc(booking.customer),
          esc(booking.cancellationReason || (refundableBookings.some((item) => String(item._id) === String(booking._id)) ? "Awaiting refund action" : "Desk refund history")),
          esc(fmtMoney(booking.currency, booking.amount)),
          badge(refundableBookings.some((item) => String(item._id) === String(booking._id)) ? "Pending" : booking.status),
          refundableBookings.some((item) => String(item._id) === String(booking._id))
            ? actionButton("Refund", "refund-booking", `data-id="${esc(booking._id)}"`)
            : '<span class="muted">Closed</span>'
        ])
    }, 7, "No refund rows for this filter.");

    fillFilterTables("schedules-status", tripOptions, {
      filter: (trip, filter) => {
        const tripDate = new Date(trip.departureAt || 0);
        const today = new Date();
        const tomorrow = new Date();
        tomorrow.setDate(today.getDate() + 1);
        if (filter === "tomorrow") {
          return tripDate.toDateString() === tomorrow.toDateString();
        }
        if (filter === "delayed") {
          return String(trip.status || "").toLowerCase() === "cancelled";
        }
        if (filter === "completed") {
          return tripDate < today && String(trip.status || "").toLowerCase() !== "scheduled";
        }
        return false;
      },
      render: (trip) =>
        row([
          esc(String(trip.id || trip._id).slice(-6).toUpperCase()),
          esc(trip.title),
          esc(fmtDate(trip.departureAt)),
          esc(trip.vehicleName || "Vehicle"),
          esc(`${trip.bookedSeats}/${trip.totalSeats}`),
          badge(trip.status || "scheduled"),
          trip.id || trip._id ? opsLinks(trip.id || trip._id) : '<span class="muted">Live</span>'
        ])
    }, 7, "No schedules for this filter.");

    const checkFormFields = $$("#checkin .formPanel select");
    if (checkFormFields[0]) {
      setTripSelectOptions(checkFormFields[0]);
    }
    const handoverFields = $$("#handoverForm select");
    if (handoverFields[1]) {
      handoverFields[1].innerHTML = coworkers.length
        ? coworkers.map((member) => `<option value="${esc(member.name)}">${esc(member.name)}${member.jobTitle ? ` · ${esc(member.jobTitle)}` : ""}</option>`).join("")
        : '<option>Next staff</option>';
    }

    const profileForm = $("#profileForm");
    if (profileForm) {
      const fields = $$("input, select, textarea", profileForm);
      if (fields[0]) fields[0].value = data.employee?.name || "";
      if (fields[1]) setSelectByText(fields[1], data.employee?.jobTitle || "Booking Agent");
      if (fields[2]) fields[2].value = data.company?.companyName || data.company?.name || "Main branch";
      if (fields[3]) fields[3].value = "Live shift · tenant desk";
      if (fields[4]) fields[4].value = data.employee?.permissionsLabel || "Live employee permissions loaded from backend.";
      profileForm.onsubmit = async (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        try {
          const roleLabel = fields[1]?.selectedOptions?.[0]?.textContent || fields[1]?.value || "";
          const permissionsText = fields[4]?.value || "";
          const response = await api("/api/platform/users/me", {
            method: "PATCH",
            body: {
              name: fields[0]?.value || "",
              phone: data.employee?.phone || "",
              jobTitle: roleLabel,
              permissionsLabel: permissionsText
            }
          });
          if (response.user) {
            localStorage.setItem("ct_user", JSON.stringify(response.user));
          }
          toast("Profile updated.");
          await refresh();
        } catch (err) {
          toast(err.message, true);
        }
      };
    }

    const employeeNoticeForm = $("#noticeForm");
    if (employeeNoticeForm) {
      employeeNoticeForm.onsubmit = async (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const fields = $$("select, textarea", event.currentTarget);
        const audienceMap = {
          "Customers on selected trip": "customers_on_selected_trip",
          "All customers today": "all_customers_today",
          "Manager only": "staff_only"
        };
        try {
          await api(withOwnerScope("/api/tenant/company/notices"), {
            method: "POST",
            body: {
              audience: audienceMap[fields[0]?.selectedOptions?.[0]?.textContent || "All customers today"] || "all_customers_today",
              priority: normalizeText(fields[1]?.selectedOptions?.[0]?.textContent || "normal"),
              message: fields[2]?.value || ""
            }
          });
          toast("Notice sent.");
          event.currentTarget.reset();
          await refresh();
        } catch (err) {
          toast(err.message, true);
        }
      };
    }

    const checkDemoButton = $("#btnCheckDemo");
    if (checkDemoButton) {
      checkDemoButton.onclick = async (event) => {
        event.preventDefault();
        const searchInput = $("#checkSearch");
        const selects = $$("#checkin .formPanel select");
        const tripId = selects[0]?.value || "";
        const actionLabel = String(selects[1]?.selectedOptions?.[0]?.textContent || "").toLowerCase();
        try {
          const items = await runBookingLookup(searchInput?.value || "", tripId, 8);
          if (!items.length) {
            toast("No booking matched that search.", true);
            return;
          }
          if (items.length > 1) {
            openTicketCheckModal(searchInput?.value || "", tripId);
            toast("Multiple matches found. Choose the correct booking from the lookup list.");
            return;
          }
          if (actionLabel.includes("check in")) {
            await performCheckAction(items[0].id || items[0]._id, "check_in", "Checked in from desk search");
            toast("Passenger checked in.");
          } else if (actionLabel.includes("no-show")) {
            await performCheckAction(items[0].id || items[0]._id, "mark_no_show", "Marked as no-show from desk search");
            toast("Passenger marked as no-show.");
          } else if (actionLabel.includes("move seat")) {
            openInventoryModal(items[0].tripId, items[0].id || items[0]._id);
            return;
          } else {
            openCustomerNoteModal(items[0].id || items[0]._id);
            return;
          }
          await refresh();
        } catch (err) {
          toast(err.message, true);
        }
      };
    }

    $$("#checkinTable [data-company-action], #bookingsTable [data-company-action], #inventoryTable [data-company-action], #customersTable [data-company-action], #paymentsTable [data-company-action], #refundsTable [data-company-action], #supportTable [data-company-action], #scheduleToday [data-company-action], #ticketLookupResults [data-company-action]").forEach((button) => {
      button.onclick = async (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        try {
          if (button.dataset.companyAction === "record-payment") {
            openRecordPaymentModal(button.dataset.id);
            return;
          }
          if (button.dataset.companyAction === "refund-booking") {
            openRefundModal(button.dataset.id);
            return;
          }
          if (button.dataset.companyAction === "check-in-booking") {
            await performCheckAction(button.dataset.id, "check_in", "Checked in from employee dashboard");
            toast("Passenger checked in.");
          }
          if (button.dataset.companyAction === "no-show-booking") {
            await performCheckAction(button.dataset.id, "mark_no_show", "Marked as no-show from employee dashboard");
            toast("Booking marked as no-show.");
          }
          if (button.dataset.companyAction === "move-seat") {
            openInventoryModal("", button.dataset.id);
            return;
          }
          if (button.dataset.companyAction === "open-inventory") {
            openInventoryModal(button.dataset.tripId || "");
            return;
          }
          if (button.dataset.companyAction === "customer-note") {
            openCustomerNoteModal(button.dataset.id);
            return;
          }
          if (button.dataset.companyAction === "resolve-support") {
            await api(withOwnerScope(`/api/tenant/company/support/${encodeURIComponent(button.dataset.id)}`), {
              method: "PATCH",
              body: {
                status: "resolved",
                notes: "Resolved from employee dashboard"
              }
            });
            toast("Support case resolved.");
          }
          if (button.dataset.companyAction === "delay-notice") {
            openDelayNoticeModal(button.dataset.tripId || "");
            return;
          }
          await refresh();
        } catch (err) {
          toast(err.message, true);
        }
      };
    });

    const handoverForm = $("#handoverForm");
    if (handoverForm) {
      handoverForm.onsubmit = async (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const fields = $$("select, textarea", event.currentTarget);
        const shift = fields[0]?.selectedOptions?.[0]?.textContent || "Shift";
        const nextStaff = fields[1]?.selectedOptions?.[0]?.textContent || "Next staff";
        try {
          await api(withOwnerScope("/api/tenant/company/notices"), {
            method: "POST",
            body: {
              audience: "staff_only",
              priority: "normal",
              message: `[${shift}] Handover for ${nextStaff}: ${fields[2]?.value || ""}`
            }
          });
          toast("Handover note saved.");
          event.currentTarget.reset();
          await refresh();
        } catch (err) {
          toast(err.message, true);
        }
      };
    }

    const employeeReportButtons = $$("#reports .reportCard .btn");
    ["checkin", "sales", "support", "handover", "inventory", "exceptions"].forEach((type, index) => {
      if (employeeReportButtons[index]) {
        employeeReportButtons[index].onclick = async (event) => {
          event.preventDefault();
          try {
            await downloadReport(type);
            toast(`${type} report downloaded.`);
          } catch (err) {
            toast(err.message, true);
          }
        };
      }
    });
  }

  async function renderSuperLegacy() {
    const [data, users, routes] = await Promise.all([
      api("/api/platform/dashboards/super-admin"),
      api("/api/platform/admin/users?limit=80"),
      api("/api/tenant/routes?limit=80")
    ]);

    const bookingRows = data.bookingRows || [];
    const recentUsers = users.items || [];
    const routesData = routes.items || [];

    setWelcome(
      "Welcome back. Your marketplace control layer is live.",
      "Track live bookings, companies, listings, commissions, refunds, and platform activity from backend data."
    );
    setPageHeading("Super Admin Dashboard", "Live platform overview for bookings, partner companies, listings, payouts, promoters, customers, and operational health.");
    setStatNumbers("#overview .statsGrid .statNumber", [
      fmtMoney(bookingRows[0]?.currency || "UGX", bookingRows.reduce((sum, booking) => sum + Number(booking.amount || 0), 0)),
      String(data.companyLeaders?.length || 0),
      fmtMoney(bookingRows[0]?.currency || "UGX", bookingRows.reduce((sum, booking) => sum + Number(booking.promoterCommission || 0), 0)),
      fmtMoney(bookingRows[0]?.currency || "UGX", bookingRows.reduce((sum, booking) => sum + Number(booking.platformCommission || 0), 0))
    ]);
    setStatNumbers("#analytics .statsGrid .statNumber", [
      String(recentUsers.length * 12),
      `${bookingRows.length ? ((bookingRows.filter((booking) => booking.status === "confirmed").length / bookingRows.length) * 100).toFixed(1) : "0.0"}%`,
      fmtMoney(bookingRows[0]?.currency || "UGX", bookingRows.length ? bookingRows.reduce((sum, booking) => sum + Number(booking.amount || 0), 0) / bookingRows.length : 0),
      "2h"
    ]);

    fillTable(
      "#recentBookings",
      bookingRows.slice(0, 6).map((booking) =>
        row([
          esc(booking.code),
          esc(booking.service),
          esc(booking.customer),
          esc(fmtDate(booking.travelDate)),
          badge(booking.status),
          esc(fmtMoney(booking.currency, booking.amount))
        ])
      ),
      6
    );
    fillTable(
      "#bookingsTable",
      bookingRows.map((booking) =>
        row([
          esc(booking.code),
          esc(booking.service),
          esc(booking.customer),
          esc(fmtDate(booking.travelDate)),
          esc(booking.seats || "—"),
          badge(booking.status),
          esc(fmtMoney(booking.currency, booking.amount)),
          '<span class="muted">Live</span>'
        ])
      ),
      8
    );
    fillTable("#bookingsBusTable", bookingRows.filter((booking) => booking.type === "bus").map((booking) => row([esc(booking.code), esc(booking.service), esc(booking.customer), esc(fmtDate(booking.travelDate)), esc(booking.seats || "—"), badge(booking.status), esc(fmtMoney(booking.currency, booking.amount)), '<span class="muted">Live</span>'])), 8, "No bus bookings yet.");
    fillTable("#bookingsHotelTable", bookingRows.filter((booking) => booking.type === "hotel").map((booking) => row([esc(booking.code), esc(booking.service), esc(booking.customer), esc(fmtDate(booking.travelDate)), esc(booking.seats || "—"), badge(booking.status), esc(fmtMoney(booking.currency, booking.amount)), '<span class="muted">Live</span>'])), 8, "No hotel bookings yet.");
    fillTable("#bookingsFlightTable", bookingRows.filter((booking) => booking.type === "flight").map((booking) => row([esc(booking.code), esc(booking.service), esc(booking.customer), esc(fmtDate(booking.travelDate)), esc(booking.seats || "—"), badge(booking.status), esc(fmtMoney(booking.currency, booking.amount)), '<span class="muted">Live</span>'])), 8, "No flight bookings yet.");
    fillTable("#bookingsTrainTable", bookingRows.filter((booking) => booking.type === "train").map((booking) => row([esc(booking.code), esc(booking.service), esc(booking.customer), esc(fmtDate(booking.travelDate)), esc(booking.seats || "—"), badge(booking.status), esc(fmtMoney(booking.currency, booking.amount)), '<span class="muted">Live</span>'])), 8, "No train bookings yet.");
    fillTable("#bookingsHoldTable", bookingRows.filter((booking) => booking.status === "pending_payment").map((booking) => row([esc(booking.code), esc(booking.service), esc(booking.customer), esc(fmtDate(booking.travelDate)), esc(booking.seats || "—"), badge("On hold"), esc(fmtMoney(booking.currency, booking.amount)), '<span class="muted">Live</span>'])), 8, "No held bookings.");
    fillTable("#bookingsRefundedTable", bookingRows.filter((booking) => booking.status === "refunded").map((booking) => row([esc(booking.code), esc(booking.service), esc(booking.customer), esc(fmtDate(booking.travelDate)), esc(booking.seats || "—"), badge("Refunded"), esc(fmtMoney(booking.currency, booking.amount)), '<span class="muted">Live</span>'])), 8, "No refunded bookings.");
    fillTable(
      "#partnersTable",
      (data.companyLeaders || []).map((company) =>
        row([
          esc(company.name),
          esc("Company"),
          esc("East Africa"),
          esc(String(company.bookings)),
          badge("Verified"),
          esc(fmtMoney("UGX", company.revenue)),
          '<span class="muted">Live</span>'
        ])
      ),
      7
    );
    fillTable("#partnersBusTable", [], 7, "No bus partner filter data yet.");
    fillTable("#partnersHotelTable", [], 7, "No hotel partner filter data yet.");
    fillTable("#partnersAirlineTable", [], 7, "No airline partner filter data yet.");
    fillTable("#partnersTrainTable", [], 7, "No train partner filter data yet.");
    fillTable("#partnersPendingTable", [], 7, "No pending partner approvals.");
    fillTable(
      "#listingsTable",
      routesData.map((listing) =>
        row([
          esc(listing.title),
          esc(String(listing.type || "").toUpperCase()),
          esc("Marketplace"),
          esc(String(listing.amenities?.length || 0 || 1)),
          esc(listing.type === "hotel" ? (listing.city || "Hotel") : `${listing.from || ""} → ${listing.to || ""}`),
          badge(listing.isActive ? "Active" : "Review"),
          esc(fmtMoney(listing.currency, 0)),
          '<span class="muted">Live</span>'
        ])
      ),
      8
    );
    fillTable("#routeInventoryTable", routesData.filter((item) => item.type !== "hotel").map((item) => row([esc(item.title), esc(item.type), esc("Company"), esc("Live"), esc("Scheduled"), badge(item.isActive ? "Active" : "Review"), esc(fmtMoney(item.currency, 0)), '<span class="muted">Live</span>'])), 8, "No route inventory yet.");
    fillTable("#stayInventoryTable", routesData.filter((item) => item.type === "hotel").map((item) => row([esc(item.title), esc("Room inventory"), esc("Company"), esc(String(item.amenities?.length || 0)), esc(item.city || "City"), badge(item.isActive ? "Active" : "Review"), esc(fmtMoney(item.currency, 0)), '<span class="muted">Live</span>'])), 8, "No stay inventory yet.");
    fillTable("#reviewInventoryTable", [], 7, "No inventory under review.");
    fillTable(
      "#paymentsTable",
      bookingRows.map((booking) =>
        row([
          esc(`PAY-${booking.code}`),
          esc(booking.code),
          esc(fmtMoney(booking.currency, booking.amount)),
          esc(booking.company),
          esc(fmtMoney(booking.currency, booking.platformCommission)),
          esc(fmtMoney(booking.currency, booking.promoterCommission)),
          badge(booking.status === "confirmed" ? "Settled" : booking.status),
          '<span class="muted">Live</span>'
        ])
      ),
      8
    );
    fillTable(
      "#promotersTable",
      (data.promoterLeaders || []).map((promoter) =>
        row([
          esc(promoter.name),
          esc(String(promoter.bookings)),
          esc(String(promoter.bookings)),
          esc(fmtMoney("UGX", promoter.earned)),
          esc(fmtMoney("UGX", promoter.earned)),
          badge("Active"),
          '<span class="muted">Live</span>'
        ])
      ),
      7
    );
    fillTable(
      "#customersTable",
      recentUsers.filter((item) => item.role === "customer").map((customer) =>
        row([
          esc(customer.name),
          esc(customer.email || customer.phone || "—"),
          esc(String(bookingRows.filter((booking) => booking.customer === customer.name).length)),
          esc(fmtMoney("UGX", bookingRows.filter((booking) => booking.customer === customer.name).reduce((sum, booking) => sum + Number(booking.amount || 0), 0))),
          esc(fmtDate(customer.createdAt)),
          badge(customer.status || "Active"),
          '<span class="muted">Live</span>'
        ])
      ),
      7,
      "No customer records yet."
    );
    fillTable("#supportTable", [], 7, "No support disputes yet.");
    fillTable("#adsTable", [], 8, "No ad campaigns yet.");
    fillTable("#auditTable", [], 7, "No audit log records exposed yet.");
    fillTable("#financeAuditTable", [], 7, "No finance audit records exposed yet.");
    fillTable("#securityAuditTable", [], 7, "No security alerts exposed yet.");
    fillTable("#adminsTable", recentUsers.filter((item) => ["admin", "super_admin"].includes(item.role)).map((admin) => row([esc(admin.name), esc(admin.role), esc("Platform"), badge("Enabled"), esc(fmtDate(admin.createdAt)), badge(admin.status || "Active"), '<span class="muted">Live</span>'])), 7, "No admin accounts found.");
    fillTable("#kycTable", [], 7, "No pending KYC reviews.");
    fillTable("#kycApprovedTable", [], 7, "No approved KYC rows.");
    fillTable("#kycRejectedTable", [], 7, "No rejected KYC rows.");
    fillTable("#kycBankTable", [], 7, "No bank mismatch rows.");
    fillTable("#kycExpiredTable", [], 7, "No expired KYC rows.");
    fillTable("#refundsTable", [], 7, "No refund rows exposed yet.");
    fillTable("#notificationsTable", [], 7, "No notification campaigns yet.");

    renderSuperLegacy.lastData = {
      data,
      users,
      routes,
      bookingRows,
      recentUsers,
      routesData
    };

    const bars = $("#categoryBars");
    if (bars) {
      bars.innerHTML = (data.inventoryMix || []).map((item) => `
        <div class="barCol">
          <div class="bar" style="height:${Math.max(18, Number(item.count || 0) * 18)}px"></div>
          <span>${esc(item._id)}</span>
        </div>
      `).join("") || '<div class="muted">No inventory mix data yet.</div>';
    }
  }

  async function renderSuper() {
    await renderSuperLegacy();

    const adminSnapshot = await api("/api/platform/admin/stats");
    const partnerRows = adminSnapshot.partners || [];
    const inquiryRows = adminSnapshot.partnerInquiries || [];
    const inviteRows = adminSnapshot.partnerInvites || [];
    const recentOnboardedPartners = adminSnapshot.recentOnboardedPartners || [];
    const onboarding = adminSnapshot.onboarding || {};
    const inquiryStats = onboarding.inquiries || {};
    const inviteStats = onboarding.invites || {};
    const partnerStats = onboarding.partners || {};
    const sectionId = () => document.querySelector(".section.is-open")?.id || requestedPage || "overview";
    const toStamp = (value) => (value ? new Date(value).getTime() : 0);
    const revenueCurrency = "UGX";

    const activePartners = Number(partnerStats.active || 0);
    const trialPartners = Number(partnerStats.trial || 0);
    const suspendedPartners = Number(partnerStats.suspended || 0);
    const approvedInquiryCount = Number(inquiryStats.approved || 0);
    const rejectedInquiryCount = Number(inquiryStats.rejected || 0);
    const acceptedInviteCount = Number(inviteStats.accepted || 0);

    const pendingInquiries = inquiryRows.filter((item) => ["new", "reviewing"].includes(normalizeText(item.status)));
    const rejectedInquiries = inquiryRows.filter((item) => normalizeText(item.status) === "rejected");
    const pendingInvites = inviteRows.filter((item) => normalizeText(item.status) === "pending");
    const expiredOrRevokedInvites = inviteRows.filter((item) => ["expired", "revoked"].includes(normalizeText(item.status)));
    const pendingApprovals = pendingInquiries.length + pendingInvites.length;
    const partnersWithInventory = partnerRows.filter((item) => Number(item.routes || 0) > 0 || Number(item.trips || 0) > 0);
    const partnersMissingSetup = partnerRows.filter((item) => !item.primaryDomain || Number(item.routes || 0) <= 0);
    const reviewInventoryItems = partnerRows
      .filter((item) => normalizeText(item.status) === "trial" || Number(item.routes || 0) <= 0 || Number(item.trips || 0) <= 0)
      .sort((a, b) => toStamp(b.createdAt) - toStamp(a.createdAt))
      .slice(0, 12);
    const pendingApprovalRows = [
      ...pendingInquiries.map((item) => ({ ...item, _kind: "inquiry", _sortAt: item.reviewedAt || item.createdAt })),
      ...pendingInvites.map((item) => ({ ...item, _kind: "invite", _sortAt: item.lastSentAt || item.sentAt || item.createdAt }))
    ].sort((a, b) => toStamp(b._sortAt) - toStamp(a._sortAt));
    const kycPendingRows = [
      ...pendingInquiries.map((item) => ({ ...item, _kind: "inquiry" })),
      ...pendingInvites.map((item) => ({ ...item, _kind: "invite" }))
    ].sort((a, b) => toStamp(b.createdAt || b.sentAt) - toStamp(a.createdAt || a.sentAt));
    const approvedPartners = partnerRows.filter((item) => ["active", "trial"].includes(normalizeText(item.status)));
    const partnerTotal = Math.max(1, activePartners + trialPartners + suspendedPartners);
    const inquiryTotal = Math.max(1, pendingInquiries.length + approvedInquiryCount + rejectedInquiryCount);
    const inviteTotal = Math.max(1, pendingInvites.length + acceptedInviteCount + expiredOrRevokedInvites.length);

    const currentSection = sectionId();
    const refresh = async (preferredSection = currentSection) => {
      await renderSuper();
      activateDashboardPage(preferredSection);
    };
    const legacy = renderSuperLegacy.lastData || {};
    const dashboardData = legacy.data || {};
    const bookingRows = legacy.bookingRows || [];
    const recentUsers = legacy.recentUsers || [];
    const routesData = legacy.routesData || [];
    const promoterRows = dashboardData.promoterLeaders || [];
    const customerRows = recentUsers.filter((item) => item.role === "customer");
    const adminRows = recentUsers.filter((item) => ["admin", "super_admin"].includes(item.role));
    const downloadJson = (filename, payload) => {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    };
    const shortText = (value, max = 28) => {
      const text = normalizeUiText(value || "-").trim();
      return text.length > max ? `${text.slice(0, Math.max(1, max - 1)).trimEnd()}...` : text;
    };
    const nameCell = (title, subtitle = "") => `
      <div>
        <strong>${esc(shortText(title || "-", 26))}</strong>
        ${subtitle ? `<div class="muted">${esc(shortText(subtitle, 32))}</div>` : ""}
      </div>
    `;
    const statCell = (primary, secondary = "") => `
      <div>
        <strong>${esc(primary || "-")}</strong>
        ${secondary ? `<div class="muted">${esc(shortText(secondary, 24))}</div>` : ""}
      </div>
    `;
    const seatCount = (booking) => {
      if (Array.isArray(booking?.seatIds) && booking.seatIds.length) {
        return `${booking.seatIds.length} seat${booking.seatIds.length === 1 ? "" : "s"}`;
      }
      const raw = String(booking?.seats || booking?.seatLabel || "").trim();
      if (!raw) return "-";
      const parts = raw.split(/\s*,\s*|\s+/).filter(Boolean);
      return `${parts.length} seat${parts.length === 1 ? "" : "s"}`;
    };
    const detailField = ({ label, value, full = false, multiline = false }) => {
      const text = normalizeUiText(value == null || value === "" ? "-" : value);
      return `
        <div class="field${full ? " full" : ""}">
          <label>${esc(label)}</label>
          <div class="control">
            ${multiline || text.length > 80
              ? `<textarea readonly>${esc(text)}</textarea>`
              : `<input value="${esc(text)}" readonly />`}
          </div>
        </div>
      `;
    };
    const openDetailsModal = (title, subtitle, fields, footer = "") => {
      return openCrudModal(
        title,
        subtitle,
        `
          <div class="formPanel">
            <div class="formGrid">
              ${fields.map(detailField).join("")}
            </div>
            ${footer ? `<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:16px">${footer}</div>` : ""}
          </div>
        `
      );
    };
    const rowActions = (...items) => `<div class="rowActions">${items.filter(Boolean).join("")}</div>`;
    const platformCrudActions = ({ viewAction, viewAttrs = "", editAction = viewAction, editAttrs = viewAttrs, deleteAction = editAction, deleteAttrs = editAttrs }) =>
      rowActions(
        platformActionButton("View", viewAction, viewAttrs),
        platformActionButton("Edit", editAction, editAttrs),
        platformActionButton("Delete", deleteAction, deleteAttrs)
      );
    const progressWidth = (current, total) => {
      const safeTotal = Math.max(1, Number(total || 0));
      return Math.max(12, Math.min(100, Math.round((Number(current || 0) / safeTotal) * 100)));
    };
    const partnerStatusLabel = (partner) => {
      const status = normalizeText(partner.status);
      if (status === "active") return "Verified";
      if (status === "trial") return "Trial";
      if (status === "suspended") return "Suspended";
      return partner.status || "Pending";
    };
    const partnerActionLabel = (partner) => {
      const status = normalizeText(partner.status);
      if (status === "suspended") return "Activate";
      if (status === "trial") return "Approve";
      return "Suspend";
    };
    const partnerNextStatus = (partner) => {
      const status = normalizeText(partner.status);
      return status === "active" ? "suspended" : "active";
    };
    const partnerPortalHref = (partner) => partner.portalUrl || dashboardRoute("/tenant/company-admin", "overview", { ownerId: partner._id });
    const partnerStorefrontHref = (partner) => partner.storefrontUrl || (partner.tenantSlug ? `/search?tenant=${encodeURIComponent(partner.tenantSlug)}` : "#");
    const partnerAuthHref = (partner) => partner.authUrl || (partner.tenantSlug ? `/login?tenant=${encodeURIComponent(partner.tenantSlug)}` : "#");
    const partnerActionAttrs = (partner) => `data-partner-id="${esc(partner._id)}"`;
    const partnerRow = (partner) => row([
      nameCell(partner.companyName || partner.name, partner.primaryDomain || partner.email || partner.tenantSlug),
      esc(partner.businessType || "Company"),
      esc(partner.country || "-"),
      nameCell(`${Number(partner.routes || 0)} routes`, `${Number(partner.trips || 0)} trips • ${Number(partner.employees || 0)} staff`),
      badge(partnerStatusLabel(partner)),
      esc(fmtMoney(revenueCurrency, partner.revenue)),
      platformCrudActions({
        viewAction: "view-partner",
        viewAttrs: partnerActionAttrs(partner),
        editAction: "edit-partner",
        editAttrs: partnerActionAttrs(partner),
        deleteAction: "delete-partner",
        deleteAttrs: partnerActionAttrs(partner)
      })
    ]);
    const pendingRow = (entry) => {
      const isInvite = entry._kind === "invite";
      const attrs = isInvite ? `data-invite-id="${esc(entry._id)}"` : `data-inquiry-id="${esc(entry._id)}"`;
      return row([
        nameCell(entry.companyName || entry.contactName || "Partner", entry.email || entry.phone || ""),
        esc(entry.businessType || "Company"),
        esc(entry.country || "-"),
        esc(isInvite ? "Secure invite" : "Partner inquiry"),
        badge(isInvite ? entry.status : normalizeText(entry.status) === "reviewing" ? "Reviewing" : "Pending"),
        esc(fmtDate(isInvite ? (entry.lastSentAt || entry.sentAt || entry.createdAt) : entry.createdAt)),
        isInvite
          ? platformCrudActions({
              viewAction: "view-invite",
              viewAttrs: attrs,
              editAction: "edit-invite",
              editAttrs: attrs,
              deleteAction: "delete-invite",
              deleteAttrs: attrs
            })
          : platformCrudActions({
              viewAction: "view-inquiry",
              viewAttrs: attrs,
              editAction: "edit-inquiry",
              editAttrs: attrs,
              deleteAction: "delete-inquiry",
              deleteAttrs: attrs
            })
      ]);
    };
    const kycPendingRow = (entry) => {
      const isInvite = entry._kind === "invite";
      const attrs = isInvite ? `data-invite-id="${esc(entry._id)}"` : `data-inquiry-id="${esc(entry._id)}"`;
      return row([
        nameCell(entry.companyName || entry.contactName || "Partner", entry.email || entry.phone || ""),
        esc(isInvite ? "Secure invite package" : "Business inquiry package"),
        esc(entry.country || "-"),
        esc(isInvite ? "Awaiting admin delivery" : "Pending platform review"),
        badge(isInvite ? "Awaiting acceptance" : normalizeText(entry.status) === "reviewing" ? "Under review" : "Needs review"),
        badge(entry.status || (isInvite ? "pending" : "new")),
        isInvite
          ? platformCrudActions({
              viewAction: "view-invite",
              viewAttrs: attrs,
              editAction: "edit-invite",
              editAttrs: attrs,
              deleteAction: "delete-invite",
              deleteAttrs: attrs
            })
          : platformCrudActions({
              viewAction: "view-inquiry",
              viewAttrs: attrs,
              editAction: "edit-inquiry",
              editAttrs: attrs,
              deleteAction: "delete-inquiry",
              deleteAttrs: attrs
            })
      ]);
    };
    const kycApprovedRow = (partner) => row([
      nameCell(partner.companyName || partner.name, partner.primaryDomain || partner.email || ""),
      esc("Partner profile"),
      esc(partner.country || "-"),
      esc(partner.primaryDomain || "Platform domain"),
      badge(Number(partner.routes || 0) > 0 ? "Low" : "Setup"),
      badge(partnerStatusLabel(partner)),
      platformCrudActions({
        viewAction: "view-partner",
        viewAttrs: partnerActionAttrs(partner),
        editAction: "edit-partner",
        editAttrs: partnerActionAttrs(partner),
        deleteAction: "delete-partner",
        deleteAttrs: partnerActionAttrs(partner)
      })
    ]);
    const kycRejectedRow = (entry) => row([
      nameCell(entry.companyName || entry.contactName || "Partner", entry.email || entry.phone || ""),
      esc("Partner inquiry"),
      esc(entry.country || "-"),
      esc("Not cleared"),
      badge("High"),
      badge("Rejected"),
      platformCrudActions({
        viewAction: "view-inquiry",
        viewAttrs: `data-inquiry-id="${esc(entry._id)}"`,
        editAction: "edit-inquiry",
        editAttrs: `data-inquiry-id="${esc(entry._id)}"`,
        deleteAction: "delete-inquiry",
        deleteAttrs: `data-inquiry-id="${esc(entry._id)}"`
      })
    ]);
    const kycBankRow = (partner) => row([
      nameCell(partner.companyName || partner.name, partner.email || partner.phone || ""),
      esc("Tenant setup"),
      esc(partner.country || "-"),
      esc(partner.primaryDomain || "Primary domain missing"),
      badge(Number(partner.routes || 0) > 0 ? "Medium" : "Setup"),
      badge(partner.primaryDomain ? "Review" : "Action needed"),
      platformCrudActions({
        viewAction: "view-partner",
        viewAttrs: partnerActionAttrs(partner),
        editAction: "edit-partner",
        editAttrs: partnerActionAttrs(partner),
        deleteAction: "delete-partner",
        deleteAttrs: partnerActionAttrs(partner)
      })
    ]);
    const kycExpiredRow = (invite) => {
      return row([
        nameCell(invite.companyName || invite.contactName || "Partner", invite.email || invite.phone || ""),
        esc(normalizeText(invite.status) === "revoked" ? "Invite revoked" : "Invite expired"),
        esc(invite.country || "-"),
        esc("Delivery refresh required"),
        badge("Medium"),
        badge(invite.status || "expired"),
        platformCrudActions({
          viewAction: "view-invite",
          viewAttrs: `data-invite-id="${esc(invite._id)}"`,
          editAction: "edit-invite",
          editAttrs: `data-invite-id="${esc(invite._id)}"`,
          deleteAction: "delete-invite",
          deleteAttrs: `data-invite-id="${esc(invite._id)}"`
        })
      ]);
    };
    const reviewInventoryRow = (partner) => {
      let reason = "Partner setup needs attention";
      let risk = "Review";
      if (Number(partner.routes || 0) <= 0) {
        reason = "No live routes or properties have been published yet";
        risk = "Setup";
      } else if (Number(partner.trips || 0) <= 0) {
        reason = "Routes exist but departures or live inventory are still missing";
        risk = "Review";
      } else if (normalizeText(partner.status) === "trial") {
        reason = "Tenant is still in trial and awaits final approval";
        risk = "Review";
      }

      return row([
        esc(`${Number(partner.routes || 0)} routes / ${Number(partner.trips || 0)} trips`),
        nameCell(partner.companyName || partner.name, partner.primaryDomain || partner.tenantSlug || ""),
        esc(reason),
        badge(risk),
        esc(fmtDate(partner.createdAt || partner.onboardedAt)),
        badge(partnerStatusLabel(partner)),
        platformCrudActions({
          viewAction: "view-partner",
          viewAttrs: partnerActionAttrs(partner),
          editAction: "edit-partner",
          editAttrs: partnerActionAttrs(partner),
          deleteAction: "delete-partner",
          deleteAttrs: partnerActionAttrs(partner)
        })
      ]);
    };
    const downloadPlatformSnapshot = () => {
      const blob = new Blob([JSON.stringify({
        generatedAt: new Date().toISOString(),
        onboarding: adminSnapshot.onboarding || {},
        partnerInquiries: inquiryRows,
        partnerInvites: inviteRows,
        partners: partnerRows
      }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `platform-onboarding-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    };

    function openInviteDeliveryModal(delivery, invite = {}) {
      if (!delivery) {
        toast("Invite was prepared, but no delivery payload came back.", true);
        return;
      }

      openCrudModal(
        "Secure partner invite",
        "Copy the invite link, email body, or WhatsApp text and send it to the company administrator.",
        `
          <div class="formPanel">
            <div class="formGrid">
              <div class="field full">
                <label>Company</label>
                <div class="control"><input value="${esc(invite.companyName || "")}" readonly /></div>
              </div>
              <div class="field full">
                <label>Invite link</label>
                <div class="control"><input id="platformInviteLink" value="${esc(delivery.inviteUrl || "")}" readonly /></div>
              </div>
              <div class="field full">
                <label>Email subject</label>
                <div class="control"><input id="platformInviteSubject" value="${esc(delivery.email?.subject || "")}" readonly /></div>
              </div>
              <div class="field full">
                <label>Email body</label>
                <div class="control"><textarea id="platformInviteEmail" readonly>${esc(delivery.email?.body || "")}</textarea></div>
              </div>
              <div class="field full">
                <label>WhatsApp text</label>
                <div class="control"><textarea id="platformInviteWhatsapp" readonly>${esc(delivery.whatsappText || "")}</textarea></div>
              </div>
            </div>
            <div class="splitGrid">
              <button class="btn btnPrimary" type="button" id="copyPlatformInviteLink">Copy link</button>
              <button class="btn btnBlue" type="button" id="copyPlatformInviteEmail">Copy email</button>
              <button class="btn" type="button" id="copyPlatformInviteWhatsapp">Copy WhatsApp</button>
            </div>
          </div>
        `
      );

      $("#copyPlatformInviteLink")?.addEventListener("click", () => copyText(delivery.inviteUrl, "Invite link copied."));
      $("#copyPlatformInviteEmail")?.addEventListener("click", () => copyText(
        `${delivery.email?.subject || ""}\n\n${delivery.email?.body || ""}`,
        "Invite email copied."
      ));
      $("#copyPlatformInviteWhatsapp")?.addEventListener("click", () => copyText(delivery.whatsappText, "Invite WhatsApp text copied."));
    }

    function openPartnerViewModal(partner) {
      if (!partner) return;
      const nextStatus = partnerNextStatus(partner);
      const nextStatusLabel = partnerActionLabel(partner);
      const bodyNode = openDetailsModal(
        "View partner",
        "Compact table summary, full partner details here.",
        [
          { label: "Company", value: partner.companyName || partner.name },
          { label: "Business type", value: partner.businessType || "Company" },
          { label: "Country", value: partner.country || "-" },
          { label: "Status", value: partnerStatusLabel(partner) },
          { label: "Contact name", value: partner.name || "-" },
          { label: "Email", value: partner.email || "-" },
          { label: "Phone", value: partner.phone || "-" },
          { label: "Tenant slug", value: partner.tenantSlug || "-" },
          { label: "Primary domain", value: partner.primaryDomain || "-" },
          { label: "Portal URL", value: partnerPortalHref(partner), full: true },
          { label: "Storefront URL", value: partnerStorefrontHref(partner), full: true },
          { label: "Auth URL", value: partnerAuthHref(partner), full: true },
          { label: "Routes", value: Number(partner.routes || 0) },
          { label: "Trips", value: Number(partner.trips || 0) },
          { label: "Employees", value: Number(partner.employees || 0) },
          { label: "Bookings", value: Number(partner.totalBookings || 0) },
          { label: "Revenue", value: fmtMoney(revenueCurrency, partner.revenue) },
          { label: "Invited at", value: fmtDate(partner.invitedAt) },
          { label: "Onboarded at", value: fmtDate(partner.onboardedAt) }
        ],
        `
          <button class="btn btnBlue" type="button" id="copyPartnerPortal">Copy portal</button>
          <button class="btn" type="button" id="copyPartnerAuth">Copy auth</button>
          <button class="btn btnPrimary" type="button" id="partnerStatusAction">${esc(nextStatusLabel)}</button>
          <a class="btn" href="${esc(partnerPortalHref(partner))}" target="_blank" rel="noreferrer">Open portal</a>
          <a class="btn" href="${esc(partnerStorefrontHref(partner))}" target="_blank" rel="noreferrer">Open storefront</a>
          <a class="btn" href="${esc(partnerAuthHref(partner))}" target="_blank" rel="noreferrer">Open auth</a>
        `
      );
      $("#copyPartnerPortal", bodyNode)?.addEventListener("click", () => copyText(partnerPortalHref(partner), "Partner portal link copied."));
      $("#copyPartnerAuth", bodyNode)?.addEventListener("click", () => copyText(partnerAuthHref(partner), "Tenant auth link copied."));
      $("#partnerStatusAction", bodyNode)?.addEventListener("click", async () => {
        closeCrudModal();
        await updatePartnerStatus(partner._id, nextStatus);
      });
    }

    function openInquiryViewModal(inquiry) {
      if (!inquiry) return;
      const bodyNode = openDetailsModal(
        "View inquiry",
        "Partner onboarding summary with the full submission details.",
        [
          { label: "Company", value: inquiry.companyName || "-" },
          { label: "Business type", value: inquiry.businessType || "-" },
          { label: "Country", value: inquiry.country || "-" },
          { label: "Contact name", value: inquiry.contactName || "-" },
          { label: "Email", value: inquiry.email || "-" },
          { label: "Phone", value: inquiry.phone || "-" },
          { label: "Status", value: inquiry.status || "-" },
          { label: "Created at", value: fmtDate(inquiry.createdAt) },
          { label: "Reviewed at", value: fmtDate(inquiry.reviewedAt) },
          { label: "Notes", value: inquiry.notes || "-", full: true, multiline: true }
        ],
        `
          <button class="btn btnPrimary" type="button" id="viewInquiryReviewAction">Review inquiry</button>
          <button class="btn" type="button" id="viewInquiryInviteAction">Prepare invite</button>
        `
      );
      $("#viewInquiryReviewAction", bodyNode)?.addEventListener("click", () => {
        closeCrudModal();
        openInquiryReviewModal(inquiry);
      });
      $("#viewInquiryInviteAction", bodyNode)?.addEventListener("click", () => {
        closeCrudModal();
        openPartnerInviteModal({ ...inquiry, inquiryId: inquiry._id });
      });
    }

    function openInviteViewModal(invite) {
      if (!invite) return;
      const inviteStatus = normalizeText(invite.status);
      const canResend = inviteStatus !== "accepted" && inviteStatus !== "revoked";
      const canReplace = inviteStatus === "revoked" || inviteStatus === "expired";
      const inviteFooter = [
        canResend ? '<button class="btn btnPrimary" type="button" id="viewInviteResendAction">Resend invite</button>' : "",
        canResend ? '<button class="btn btnDanger" type="button" id="viewInviteRevokeAction">Revoke invite</button>' : "",
        canReplace ? '<button class="btn" type="button" id="viewInviteReplaceAction">Prepare new invite</button>' : ""
      ].filter(Boolean).join("");
      const bodyNode = openDetailsModal(
        "View invite",
        "Invite metadata and delivery state for this partner onboarding record.",
        [
          { label: "Company", value: invite.companyName || "-" },
          { label: "Business type", value: invite.businessType || "-" },
          { label: "Country", value: invite.country || "-" },
          { label: "Contact name", value: invite.contactName || "-" },
          { label: "Email", value: invite.email || "-" },
          { label: "Phone", value: invite.phone || "-" },
          { label: "Role", value: invite.role || "-" },
          { label: "Status", value: invite.status || "-" },
          { label: "Sent at", value: fmtDate(invite.sentAt) },
          { label: "Last sent at", value: fmtDate(invite.lastSentAt) },
          { label: "Expires at", value: fmtDate(invite.expiresAt) },
          { label: "Accepted at", value: fmtDate(invite.acceptedAt) },
          { label: "Notes", value: invite.notes || "-", full: true, multiline: true }
        ],
        inviteFooter
      );
      $("#viewInviteResendAction", bodyNode)?.addEventListener("click", async () => {
        closeCrudModal();
        await resendInvite(invite._id);
      });
      $("#viewInviteRevokeAction", bodyNode)?.addEventListener("click", async () => {
        closeCrudModal();
        await revokeInvite(invite._id);
      });
      $("#viewInviteReplaceAction", bodyNode)?.addEventListener("click", () => {
        closeCrudModal();
        openPartnerInviteModal({
          companyName: invite.companyName,
          businessType: invite.businessType,
          country: invite.country,
          contactName: invite.contactName,
          email: invite.email,
          phone: invite.phone,
          notes: invite.notes,
          role: invite.role || "company_admin"
        });
      });
    }

    function openBookingViewModal(booking) {
      if (!booking) return;
      openDetailsModal(
        "View booking",
        "Booking details are kept here so the table can stay compact.",
        [
          { label: "Booking code", value: booking.code || "-" },
          { label: "Service", value: booking.service || "-" },
          { label: "Category", value: booking.type || "-" },
          { label: "Customer", value: booking.customer || "-" },
          { label: "Partner", value: booking.company || "-" },
          { label: "Travel date", value: fmtDate(booking.travelDate) },
          { label: "Seats", value: booking.seats || "-", full: true },
          { label: "Status", value: booking.status || "-" },
          { label: "Payment status", value: booking.paymentStatus || "-" },
          { label: "Amount", value: fmtMoney(booking.currency, booking.amount) },
          { label: "Platform commission", value: fmtMoney(booking.currency, booking.platformCommission) },
          { label: "Promoter commission", value: fmtMoney(booking.currency, booking.promoterCommission) }
        ]
      );
    }

    function openListingViewModal(listing) {
      if (!listing) return;
      openDetailsModal(
        "View listing",
        "Listing details are shown in the modal while the inventory table stays compact.",
        [
          { label: "Title", value: listing.title || "-" },
          { label: "Type", value: listing.type || "-" },
          { label: "From", value: listing.from || listing.city || "-" },
          { label: "To", value: listing.to || listing.city || "-" },
          { label: "Address", value: listing.address || "-" },
          { label: "Currency", value: listing.currency || "-" },
          { label: "Amenities", value: Array.isArray(listing.amenities) ? listing.amenities.join(", ") : "-" , full: true }
        ]
      );
    }

    function openPaymentViewModal(booking) {
      if (!booking) return;
      openDetailsModal(
        "View payment",
        "Transaction details for this booking.",
        [
          { label: "Transaction", value: `PAY-${booking.code || "-"}` },
          { label: "Booking", value: booking.code || "-" },
          { label: "Customer paid", value: fmtMoney(booking.currency, booking.amount) },
          { label: "Partner", value: booking.company || "-" },
          { label: "Platform commission", value: fmtMoney(booking.currency, booking.platformCommission) },
          { label: "Promoter commission", value: fmtMoney(booking.currency, booking.promoterCommission) },
          { label: "Status", value: booking.status === "confirmed" ? "Settled" : booking.status || "-" }
        ]
      );
    }

    function openPromoterViewModal(promoter) {
      if (!promoter) return;
      openDetailsModal(
        "View promoter",
        "Promoter totals and referral performance.",
        [
          { label: "Name", value: promoter.name || "-" },
          { label: "Bookings", value: Number(promoter.bookings || 0) },
          { label: "Commission earned", value: fmtMoney(revenueCurrency, promoter.earned) },
          { label: "Withdrawable", value: fmtMoney(revenueCurrency, promoter.earned) },
          { label: "Status", value: "Active" }
        ]
      );
    }

    function openCustomerViewModal(customer) {
      if (!customer) return;
      const totalBookings = bookingRows.filter((booking) => booking.customer === customer.name).length;
      const totalSpent = bookingRows
        .filter((booking) => booking.customer === customer.name)
        .reduce((sum, booking) => sum + Number(booking.amount || 0), 0);
      openDetailsModal(
        "View customer",
        "Customer account summary and booking totals.",
        [
          { label: "Name", value: customer.name || "-" },
          { label: "Email", value: customer.email || "-" },
          { label: "Phone", value: customer.phone || "-" },
          { label: "Role", value: customer.role || "-" },
          { label: "Status", value: customer.status || "-" },
          { label: "Bookings", value: totalBookings },
          { label: "Spent", value: fmtMoney(revenueCurrency, totalSpent) },
          { label: "Created at", value: fmtDate(customer.createdAt) }
        ]
      );
    }

    function openAdminViewModal(admin) {
      if (!admin) return;
      openDetailsModal(
        "View admin",
        "Platform admin access summary.",
        [
          { label: "Name", value: admin.name || "-" },
          { label: "Role", value: admin.role || "-" },
          { label: "Email", value: admin.email || "-" },
          { label: "Phone", value: admin.phone || "-" },
          { label: "Status", value: admin.status || "-" },
          { label: "Created at", value: fmtDate(admin.createdAt) }
        ]
      );
    }

    function openPartnerInviteModal(initial = {}) {
      openCrudModal(
        "Prepare partner invite",
        "Create a secure invite for the company admin using the live platform onboarding flow.",
        `
          <form class="formPanel" id="platformPartnerInviteForm">
            <input type="hidden" name="inquiryId" value="${esc(initial.inquiryId || initial._id || "")}" />
            <div class="formGrid">
              <div class="field">
                <label>Company name</label>
                <div class="control"><input name="companyName" value="${esc(initial.companyName || "")}" placeholder="Kampala Coaches Express" required /></div>
              </div>
              <div class="field">
                <label>Business type</label>
                <div class="control"><input name="businessType" value="${esc(initial.businessType || "")}" placeholder="Bus company, hotel, airline..." required /></div>
              </div>
              <div class="field">
                <label>Country</label>
                <div class="control"><input name="country" value="${esc(initial.country || "")}" placeholder="Uganda" required /></div>
              </div>
              <div class="field">
                <label>Contact name</label>
                <div class="control"><input name="contactName" value="${esc(initial.contactName || "")}" placeholder="Amina Nansubuga" required /></div>
              </div>
              <div class="field">
                <label>Email</label>
                <div class="control"><input name="email" type="email" value="${esc(initial.email || "")}" placeholder="admin@company.com" required /></div>
              </div>
              <div class="field">
                <label>Phone</label>
                <div class="control"><input name="phone" value="${esc(initial.phone || "")}" placeholder="+256..." /></div>
              </div>
              <div class="field">
                <label>Role</label>
                <div class="control">
                  <select name="role">
                    <option value="company_admin" ${normalizeText(initial.role) === "partner" ? "" : "selected"}>Company admin</option>
                    <option value="partner" ${normalizeText(initial.role) === "partner" ? "selected" : ""}>Partner</option>
                  </select>
                </div>
              </div>
              <div class="field full">
                <label>Notes</label>
                <div class="control"><textarea name="notes" placeholder="Onboarding notes, compliance reminders, payout checks...">${esc(initial.notes || "")}</textarea></div>
              </div>
            </div>
            <button class="btn btnPrimary" type="submit">Prepare secure invite</button>
          </form>
        `
      );

      $("#platformPartnerInviteForm")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const body = Object.fromEntries(new FormData(event.currentTarget).entries());
        try {
          const response = await api("/api/platform/admin/partner-invites", {
            method: "POST",
            body
          });
          toast(response.message || "Partner invite prepared.");
          closeCrudModal();
          await refresh("partners");
          openInviteDeliveryModal(response.delivery, response.invite || body);
        } catch (err) {
          toast(err.message, true);
        }
      }, true);
    }

    function openInquiryReviewModal(inquiry) {
      if (!inquiry) {
        openPartnerInviteModal();
        return;
      }

      openCrudModal(
        "Review partner inquiry",
        "Update inquiry status, keep notes, and move the company into secure invite onboarding.",
        `
          <form class="formPanel" id="platformInquiryReviewForm">
            <div class="formGrid">
              <div class="field">
                <label>Company</label>
                <div class="control"><input value="${esc(inquiry.companyName || "")}" readonly /></div>
              </div>
              <div class="field">
                <label>Status</label>
                <div class="control">
                  <select name="status">
                    <option value="reviewing" ${normalizeText(inquiry.status) === "reviewing" ? "selected" : ""}>Reviewing</option>
                    <option value="new" ${normalizeText(inquiry.status) === "new" ? "selected" : ""}>New</option>
                    <option value="rejected" ${normalizeText(inquiry.status) === "rejected" ? "selected" : ""}>Rejected</option>
                  </select>
                </div>
              </div>
              <div class="field full">
                <label>Notes</label>
                <div class="control"><textarea name="notes" placeholder="Document status, business checks, payout notes...">${esc(inquiry.notes || "")}</textarea></div>
              </div>
            </div>
            <div class="splitGrid">
              <button class="btn btnPrimary" type="submit">Save review</button>
              <button class="btn btnBlue" type="button" id="platformInquiryPrepareInvite">Prepare invite</button>
            </div>
          </form>
        `
      );

      $("#platformInquiryReviewForm")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const body = Object.fromEntries(new FormData(event.currentTarget).entries());
        try {
          await api(`/api/platform/admin/partner-inquiries/${encodeURIComponent(inquiry._id)}/review`, {
            method: "POST",
            body
          });
          toast("Inquiry review updated.");
          closeCrudModal();
          await refresh("kyc");
        } catch (err) {
          toast(err.message, true);
        }
      }, true);

      $("#platformInquiryPrepareInvite")?.addEventListener("click", async () => {
        const form = $("#platformInquiryReviewForm");
        const body = Object.fromEntries(new FormData(form).entries());
        try {
          await api(`/api/platform/admin/partner-inquiries/${encodeURIComponent(inquiry._id)}/review`, {
            method: "POST",
            body: {
              status: body.status || "reviewing",
              notes: body.notes || ""
            }
          });
          closeCrudModal();
          openPartnerInviteModal({
            ...inquiry,
            inquiryId: inquiry._id,
            notes: body.notes || inquiry.notes || ""
          });
        } catch (err) {
          toast(err.message, true);
        }
      });
    }

    async function resendInvite(inviteId) {
      const response = await api(`/api/platform/admin/partner-invites/${encodeURIComponent(inviteId)}/resend`, {
        method: "POST"
      });
      toast(response.message || "Invite refreshed.");
      await refresh("partners");
      openInviteDeliveryModal(response.delivery, response.invite || {});
    }

    async function rejectInquiry(inquiryId) {
      if (!window.confirm("Reject this partner inquiry?")) return;
      await api(`/api/platform/admin/partner-inquiries/${encodeURIComponent(inquiryId)}/review`, {
        method: "POST",
        body: { status: "rejected" }
      });
      toast("Inquiry rejected.");
      await refresh("kyc");
    }

    async function revokeInvite(inviteId) {
      if (!window.confirm("Revoke this pending invite?")) return;
      await api(`/api/platform/admin/partner-invites/${encodeURIComponent(inviteId)}/revoke`, {
        method: "POST"
      });
      toast("Invite revoked.");
      await refresh("partners");
    }

    async function updatePartnerStatus(partnerId, status) {
      const nextStatus = normalizeText(status) || "active";
      const label = nextStatus === "suspended" ? "suspend" : "activate";
      if (!window.confirm(`Do you want to ${label} this partner?`)) return;
      await api(`/api/platform/admin/partners/${encodeURIComponent(partnerId)}/status`, {
        method: "PATCH",
        body: { status: nextStatus }
      });
      toast(`Partner ${nextStatus === "suspended" ? "suspended" : "updated"}.`);
      await refresh("partners");
    }

    async function cancelPlatformBooking(bookingId) {
      if (!window.confirm("Cancel this booking from the platform?")) return;
      const response = await api(`/api/public/bookings/${encodeURIComponent(bookingId)}/cancel`, {
        method: "PATCH"
      });
      toast(response.message || "Booking updated.");
      await refresh("bookings");
    }

    async function suspendPlatformUser(userId, label = "user") {
      if (!userId) {
        toast(`No ${label} account id is available for this row.`, true);
        return;
      }
      if (!window.confirm(`Suspend this ${label} account?`)) return;
      await api(`/api/platform/users/${encodeURIComponent(userId)}/status`, {
        method: "PATCH",
        body: { status: "suspended" }
      });
      toast(`${label.charAt(0).toUpperCase()}${label.slice(1)} suspended.`);
      await refresh("admins");
    }

    setWelcome(
      "Platform onboarding is live.",
      "Review partner inquiries, send secure company-admin invites, activate tenants, and jump directly into each partner portal from this dashboard."
    );
    setPageHeading(
      "Super Admin Dashboard",
      "Live platform operations for partner onboarding, verification, tenant activation, bookings, listings, payouts, promoters, customers, and platform health."
    );

    const overviewStats = $$("#overview .statsGrid .statNumber");
    if (overviewStats[1]) overviewStats[1].textContent = String(activePartners);

    const liveItems = $$("#overview .liveList .liveItem");
    const liveValues = [
      { label: "Confirmed bookings", value: String(adminSnapshot.stats?.confirmed || 0) },
      { label: "Pending partner approvals", value: String(pendingApprovals) },
      { label: "Secure invites waiting", value: String(pendingInvites.length) },
      { label: "Suspended partners", value: String(suspendedPartners) }
    ];
    liveItems.forEach((item, index) => {
      const data = liveValues[index];
      if (!data) return;
      const labelNode = item.querySelector("span");
      const valueNode = item.querySelector("strong");
      if (labelNode) labelNode.textContent = data.label;
      if (valueNode) valueNode.textContent = data.value;
    });

    const recentBookingRow = (booking) => row([
      esc(booking.code),
      esc(shortText(booking.type || "booking", 14)),
      esc(shortText(booking.customer || "-", 18)),
      esc(shortText(booking.company || "-", 18)),
      badge(booking.status),
      esc(fmtMoney(booking.currency, booking.amount)),
      platformCrudActions({
        viewAction: "view-booking",
        viewAttrs: `data-booking-id="${esc(booking._id || booking.code)}"`,
        editAction: "edit-booking",
        editAttrs: `data-booking-id="${esc(booking._id || booking.code)}"`,
        deleteAction: "delete-booking",
        deleteAttrs: `data-booking-id="${esc(booking._id || booking.code)}"`
      })
    ]);
    const bookingTableRow = (booking, statusLabel = booking.status) => row([
      esc(booking.code),
      esc(shortText(booking.service || "-", 24)),
      esc(shortText(booking.customer || "-", 18)),
      esc(fmtDate(booking.travelDate)),
      esc(seatCount(booking)),
      badge(statusLabel),
      esc(fmtMoney(booking.currency, booking.amount)),
      platformCrudActions({
        viewAction: "view-booking",
        viewAttrs: `data-booking-id="${esc(booking._id || booking.code)}"`,
        editAction: "edit-booking",
        editAttrs: `data-booking-id="${esc(booking._id || booking.code)}"`,
        deleteAction: "delete-booking",
        deleteAttrs: `data-booking-id="${esc(booking._id || booking.code)}"`
      })
    ]);
    const listingTableRow = (listing) => row([
      nameCell(listing.title || "-", listing.type === "hotel" ? (listing.city || "Hotel") : `${listing.from || ""} -> ${listing.to || ""}`),
      esc(String(listing.type || "").toUpperCase()),
      esc("Marketplace"),
      esc(String(listing.type === "hotel" ? (listing.amenities?.length || 0) : 1)),
      esc(shortText(listing.type === "hotel" ? `${listing.city || ""} ${listing.address || ""}`.trim() : `${listing.from || ""} -> ${listing.to || ""}`, 22)),
      badge(listing.isActive ? "Active" : "Review"),
      esc(fmtMoney(listing.currency, 0)),
      platformCrudActions({
        viewAction: "view-listing",
        viewAttrs: `data-listing-id="${esc(listing._id)}"`,
        editAction: "edit-listing",
        editAttrs: `data-listing-id="${esc(listing._id)}"`,
        deleteAction: "delete-listing",
        deleteAttrs: `data-listing-id="${esc(listing._id)}"`
      })
    ]);
    const paymentTableRow = (booking) => row([
      esc(`PAY-${booking.code}`),
      esc(booking.code),
      esc(fmtMoney(booking.currency, booking.amount)),
      esc(shortText(booking.company || "-", 18)),
      esc(fmtMoney(booking.currency, booking.platformCommission)),
      esc(fmtMoney(booking.currency, booking.promoterCommission)),
      badge(booking.status === "confirmed" ? "Settled" : booking.status),
      platformCrudActions({
        viewAction: "view-payment",
        viewAttrs: `data-booking-id="${esc(booking._id || booking.code)}"`,
        editAction: "edit-payment",
        editAttrs: `data-booking-id="${esc(booking._id || booking.code)}"`,
        deleteAction: "delete-payment",
        deleteAttrs: `data-booking-id="${esc(booking._id || booking.code)}"`
      })
    ]);
    const promoterTableRow = (promoter) => row([
      esc(shortText(promoter.name || "-", 18)),
      esc(String(promoter.bookings || 0)),
      esc(String(promoter.bookings || 0)),
      esc(fmtMoney(revenueCurrency, promoter.earned)),
      esc(fmtMoney(revenueCurrency, promoter.earned)),
      badge("Active"),
      platformCrudActions({
        viewAction: "view-promoter",
        viewAttrs: `data-promoter-name="${esc(promoter.name || "")}"`,
        editAction: "edit-promoter",
        editAttrs: `data-promoter-name="${esc(promoter.name || "")}"`,
        deleteAction: "delete-promoter",
        deleteAttrs: `data-promoter-name="${esc(promoter.name || "")}"`
      })
    ]);
    const customerTableRow = (customer) => {
      const customerBookings = bookingRows.filter((booking) => booking.customer === customer.name);
      return row([
        esc(shortText(customer.name || "-", 18)),
        esc(shortText(customer.email || customer.phone || "-", 20)),
        esc(String(customerBookings.length)),
        esc(fmtMoney(revenueCurrency, customerBookings.reduce((sum, booking) => sum + Number(booking.amount || 0), 0))),
        esc(fmtDate(customer.createdAt)),
        badge(customer.status || "Active"),
        platformCrudActions({
          viewAction: "view-customer",
          viewAttrs: `data-customer-id="${esc(customer._id || customer.email || customer.name)}"`,
          editAction: "edit-customer",
          editAttrs: `data-customer-id="${esc(customer._id || customer.email || customer.name)}"`,
          deleteAction: "delete-customer",
          deleteAttrs: `data-customer-id="${esc(customer._id || customer.email || customer.name)}"`
        })
      ]);
    };
    const adminTableRow = (admin) => row([
      esc(shortText(admin.name || "-", 18)),
      esc(shortText(admin.role || "-", 18)),
      esc("Platform"),
      badge("Enabled"),
      esc(fmtDate(admin.createdAt)),
      badge(admin.status || "Active"),
      platformCrudActions({
        viewAction: "view-admin",
        viewAttrs: `data-admin-id="${esc(admin._id || admin.email || admin.name)}"`,
        editAction: "edit-admin",
        editAttrs: `data-admin-id="${esc(admin._id || admin.email || admin.name)}"`,
        deleteAction: "delete-admin",
        deleteAttrs: `data-admin-id="${esc(admin._id || admin.email || admin.name)}"`
      })
    ]);

    fillTable("#recentBookings", bookingRows.slice(0, 6).map(recentBookingRow), 7, "No platform bookings yet.");
    fillTable("#bookingsTable", bookingRows.map((booking) => bookingTableRow(booking)), 8, "No bookings yet.");
    fillTable("#bookingsBusTable", bookingRows.filter((booking) => booking.type === "bus").map((booking) => bookingTableRow(booking)), 8, "No bus bookings yet.");
    fillTable("#bookingsHotelTable", bookingRows.filter((booking) => booking.type === "hotel").map((booking) => bookingTableRow(booking)), 8, "No hotel bookings yet.");
    fillTable("#bookingsFlightTable", bookingRows.filter((booking) => booking.type === "flight").map((booking) => bookingTableRow(booking)), 8, "No flight bookings yet.");
    fillTable("#bookingsTrainTable", bookingRows.filter((booking) => booking.type === "train").map((booking) => bookingTableRow(booking)), 8, "No train bookings yet.");
    fillTable("#bookingsHoldTable", bookingRows.filter((booking) => booking.status === "pending_payment").map((booking) => bookingTableRow(booking, "On hold")), 8, "No held bookings.");
    fillTable("#bookingsRefundedTable", bookingRows.filter((booking) => booking.status === "refunded").map((booking) => bookingTableRow(booking, "Refunded")), 8, "No refunded bookings.");
    fillTable("#listingsTable", routesData.map(listingTableRow), 8, "No listings yet.");
    fillTable("#routeInventoryTable", routesData.filter((item) => item.type !== "hotel").map((item) => row([
      esc(shortText(item.title || "-", 22)),
      esc(shortText(item.type || "Vehicle", 16)),
      esc("Company"),
      esc("Live"),
      esc(shortText(`${item.from || ""} -> ${item.to || ""}`.trim() || "Scheduled", 20)),
      badge(item.isActive ? "Active" : "Review"),
      esc(fmtMoney(item.currency, 0)),
      platformCrudActions({
        viewAction: "view-listing",
        viewAttrs: `data-listing-id="${esc(item._id)}"`,
        editAction: "edit-listing",
        editAttrs: `data-listing-id="${esc(item._id)}"`,
        deleteAction: "delete-listing",
        deleteAttrs: `data-listing-id="${esc(item._id)}"`
      })
    ])), 8, "No route inventory yet.");
    fillTable("#stayInventoryTable", routesData.filter((item) => item.type === "hotel").map((item) => row([
      esc(shortText(item.title || "-", 22)),
      esc("Room inventory"),
      esc("Company"),
      esc(String(item.amenities?.length || 0)),
      esc(shortText(item.city || "City", 18)),
      badge(item.isActive ? "Active" : "Review"),
      esc(fmtMoney(item.currency, 0)),
      platformCrudActions({
        viewAction: "view-listing",
        viewAttrs: `data-listing-id="${esc(item._id)}"`,
        editAction: "edit-listing",
        editAttrs: `data-listing-id="${esc(item._id)}"`,
        deleteAction: "delete-listing",
        deleteAttrs: `data-listing-id="${esc(item._id)}"`
      })
    ])), 8, "No stay inventory yet.");
    fillTable("#paymentsTable", bookingRows.map(paymentTableRow), 8, "No payment activity yet.");
    fillTable("#promotersTable", promoterRows.map(promoterTableRow), 7, "No promoters yet.");
    fillTable("#customersTable", customerRows.map(customerTableRow), 7, "No customer records yet.");
    fillTable("#adminsTable", adminRows.map(adminTableRow), 7, "No admin accounts found.");

    fillTable("#partnersTable", partnerRows.map(partnerRow), 7, "No partner companies have been onboarded yet.");
    fillTable("#partnersBusTable", partnerRows.filter((item) => businessKind(item.businessType) === "bus").map(partnerRow), 7, "No bus partners yet.");
    fillTable("#partnersHotelTable", partnerRows.filter((item) => businessKind(item.businessType) === "hotel").map(partnerRow), 7, "No hotel partners yet.");
    fillTable("#partnersAirlineTable", partnerRows.filter((item) => businessKind(item.businessType) === "airline").map(partnerRow), 7, "No airline partners yet.");
    fillTable("#partnersTrainTable", partnerRows.filter((item) => businessKind(item.businessType) === "train").map(partnerRow), 7, "No train partners yet.");
    fillTable("#partnersPendingTable", pendingApprovalRows.map(pendingRow), 7, "No pending partner approvals.");

    fillTable("#kycTable", kycPendingRows.map(kycPendingRow), 7, "No pending verification work.");
    fillTable("#kycApprovedTable", approvedPartners.map(kycApprovedRow), 7, "No approved partners yet.");
    fillTable("#kycRejectedTable", rejectedInquiries.map(kycRejectedRow), 7, "No rejected inquiries.");
    fillTable("#kycBankTable", partnersMissingSetup.map(kycBankRow), 7, "No payout or domain setup gaps right now.");
    fillTable("#kycExpiredTable", expiredOrRevokedInvites.map(kycExpiredRow), 7, "No expired invite records.");
    fillTable("#reviewInventoryTable", reviewInventoryItems.map(reviewInventoryRow), 7, "No inventory items need review right now.");

    const onboardingCard = document.querySelector("#partners .grid2 > .card:last-child") || document.querySelector("#partners .card:last-child");
    if (onboardingCard) {
      const onboardingItems = $$(".splitItem", onboardingCard);
      const noticeNode = $(".notice", onboardingCard);
      const onboardingValues = [
        {
          title: "Business review",
          badgeText: `${pendingInquiries.length} waiting`,
          badgeTone: pendingInquiries.length ? "warn" : "ok",
          width: progressWidth(approvedInquiryCount, inquiryTotal)
        },
        {
          title: "Secure invites",
          badgeText: `${pendingInvites.length} sent`,
          badgeTone: pendingInvites.length ? "info" : "ok",
          width: progressWidth(acceptedInviteCount, inviteTotal)
        },
        {
          title: "Service inventory",
          badgeText: `${partnersWithInventory.length} live`,
          badgeTone: partnersWithInventory.length === partnerRows.length && partnerRows.length ? "ok" : "warn",
          width: progressWidth(partnersWithInventory.length, partnerRows.length || 1)
        }
      ];

      onboardingItems.slice(0, 3).forEach((item, index) => {
        const data = onboardingValues[index];
        if (!data) return;
        const titleNode = $(".splitTop span:first-child", item);
        const badgeNode = $(".splitTop .badge", item);
        const progressNode = $(".progress i", item);
        if (titleNode) titleNode.textContent = data.title;
        if (badgeNode) {
          badgeNode.className = `badge ${data.badgeTone}`;
          badgeNode.textContent = data.badgeText;
        }
        if (progressNode) progressNode.style.width = `${data.width}%`;
      });

      if (noticeNode) {
        noticeNode.textContent = recentOnboardedPartners.length
          ? `Recently onboarded: ${recentOnboardedPartners.map((item) => item.companyName || item.name).join(", ")}.`
          : "Partners should only move live after business review, secure invite acceptance, and inventory setup are complete.";
      }
    }

    const topNew = $("#btnNew");
    if (topNew && topNew.parentNode) {
      const clone = topNew.cloneNode(true);
      topNew.parentNode.replaceChild(clone, topNew);
      clone.onclick = (event) => {
        event.preventDefault();
        openPartnerInviteModal();
      };
    }

    const topExport = $("#btnExport");
    if (topExport && topExport.parentNode) {
      const clone = topExport.cloneNode(true);
      topExport.parentNode.replaceChild(clone, topExport);
      clone.onclick = (event) => {
        event.preventDefault();
        downloadPlatformSnapshot();
        toast("Platform onboarding snapshot downloaded.");
      };
    }

    const auditExportButton = $('#audit [data-type="audit export"]');
    if (auditExportButton && auditExportButton.parentNode) {
      const clone = auditExportButton.cloneNode(true);
      auditExportButton.parentNode.replaceChild(clone, auditExportButton);
      clone.onclick = async (event) => {
        event.preventDefault();
        const bookingsResponse = await api("/api/platform/admin/bookings?limit=200");
        downloadJson(
          `platform-audit-snapshot-${new Date().toISOString().slice(0, 10)}.json`,
          {
            generatedAt: new Date().toISOString(),
            onboarding: adminSnapshot.onboarding || {},
            partners: partnerRows,
            bookings: bookingsResponse.items || []
          }
        );
        toast("Platform audit snapshot downloaded.");
      };
    }

    $$("#reports .reportCard").forEach((card) => {
      const title = $("h4", card)?.textContent?.trim();
      const button = $("button", card);
      if (!title || !button) return;
      button.onclick = async (event) => {
        event.preventDefault();
        try {
          if (title === "Finance report" || title === "Bookings report") {
            const response = await api("/api/platform/admin/bookings?limit=200");
            downloadJson(
              `${normalizeText(title).replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.json`,
              {
                generatedAt: new Date().toISOString(),
                title,
                items: response.items || []
              }
            );
            toast(`${title} downloaded.`);
            return;
          }

          if (title === "Partner report") {
            const response = await api("/api/platform/admin/partners");
            downloadJson(
              `partner-report-${new Date().toISOString().slice(0, 10)}.json`,
              {
                generatedAt: new Date().toISOString(),
                title,
                items: response.items || []
              }
            );
            toast("Partner report downloaded.");
            return;
          }

          if (title === "Promoter report") {
            const response = await api("/api/platform/dashboards/super-admin");
            downloadJson(
              `promoter-report-${new Date().toISOString().slice(0, 10)}.json`,
              {
                generatedAt: new Date().toISOString(),
                title,
                items: response.promoterLeaders || []
              }
            );
            toast("Promoter report downloaded.");
            return;
          }

          toast(`${title} is not exposed by the backend yet.`, true);
        } catch (err) {
          toast(err.message, true);
        }
      };
    });

    $$("[data-type]").forEach((button) => {
      const type = normalizeText(button.dataset.type);
      if (type !== "partner" && type !== "verification task") return;
      button.onclick = (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (type === "verification task") {
          openInquiryReviewModal(pendingInquiries[0] || rejectedInquiries[0] || null);
          return;
        }
        if (button.closest("#overview") && pendingInquiries.length) {
          openInquiryReviewModal(pendingInquiries[0]);
          return;
        }
        openPartnerInviteModal();
      };
    });

    $$("[data-platform-action]").forEach((button) => {
      button.onclick = async (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();

        const action = button.dataset.platformAction;
        try {
          if (action === "view-partner") {
            openPartnerViewModal(partnerRows.find((item) => String(item._id) === String(button.dataset.partnerId)));
            return;
          }
          if (action === "edit-partner") {
            openPartnerViewModal(partnerRows.find((item) => String(item._id) === String(button.dataset.partnerId)));
            return;
          }
          if (action === "delete-partner") {
            const partner = partnerRows.find((item) => String(item._id) === String(button.dataset.partnerId));
            if (!partner) return;
            if (normalizeText(partner.status) === "suspended") {
              toast("This partner is already suspended.");
              return;
            }
            await updatePartnerStatus(partner._id, "suspended");
            return;
          }
          if (action === "view-inquiry") {
            openInquiryViewModal(inquiryRows.find((item) => String(item._id) === String(button.dataset.inquiryId)));
            return;
          }
          if (action === "edit-inquiry") {
            openInquiryReviewModal(inquiryRows.find((item) => String(item._id) === String(button.dataset.inquiryId)));
            return;
          }
          if (action === "delete-inquiry") {
            await rejectInquiry(button.dataset.inquiryId);
            return;
          }
          if (action === "view-invite") {
            openInviteViewModal(inviteRows.find((item) => String(item._id) === String(button.dataset.inviteId)));
            return;
          }
          if (action === "edit-invite") {
            openInviteViewModal(inviteRows.find((item) => String(item._id) === String(button.dataset.inviteId)));
            return;
          }
          if (action === "delete-invite") {
            await revokeInvite(button.dataset.inviteId);
            return;
          }
          if (action === "view-booking") {
            openBookingViewModal(bookingRows.find((item) => String(item._id || item.code) === String(button.dataset.bookingId)));
            return;
          }
          if (action === "edit-booking") {
            openBookingViewModal(bookingRows.find((item) => String(item._id || item.code) === String(button.dataset.bookingId)));
            return;
          }
          if (action === "delete-booking") {
            await cancelPlatformBooking(button.dataset.bookingId);
            return;
          }
          if (action === "view-payment") {
            openPaymentViewModal(bookingRows.find((item) => String(item._id || item.code) === String(button.dataset.bookingId)));
            return;
          }
          if (action === "edit-payment") {
            openPaymentViewModal(bookingRows.find((item) => String(item._id || item.code) === String(button.dataset.bookingId)));
            return;
          }
          if (action === "delete-payment") {
            await cancelPlatformBooking(button.dataset.bookingId);
            return;
          }
          if (action === "view-listing") {
            openListingViewModal(routesData.find((item) => String(item._id) === String(button.dataset.listingId)));
            return;
          }
          if (action === "edit-listing" || action === "delete-listing") {
            openListingViewModal(routesData.find((item) => String(item._id) === String(button.dataset.listingId)));
            return;
          }
          if (action === "view-promoter") {
            openPromoterViewModal(promoterRows.find((item) => String(item.name) === String(button.dataset.promoterName)));
            return;
          }
          if (action === "edit-promoter" || action === "delete-promoter") {
            openPromoterViewModal(promoterRows.find((item) => String(item.name) === String(button.dataset.promoterName)));
            return;
          }
          if (action === "view-customer") {
            openCustomerViewModal(customerRows.find((item) => String(item._id || item.email || item.name) === String(button.dataset.customerId)));
            return;
          }
          if (action === "edit-customer") {
            openCustomerViewModal(customerRows.find((item) => String(item._id || item.email || item.name) === String(button.dataset.customerId)));
            return;
          }
          if (action === "delete-customer") {
            await suspendPlatformUser(button.dataset.customerId, "customer");
            return;
          }
          if (action === "view-admin") {
            openAdminViewModal(adminRows.find((item) => String(item._id || item.email || item.name) === String(button.dataset.adminId)));
            return;
          }
          if (action === "edit-admin") {
            openAdminViewModal(adminRows.find((item) => String(item._id || item.email || item.name) === String(button.dataset.adminId)));
            return;
          }
          if (action === "delete-admin") {
            await suspendPlatformUser(button.dataset.adminId, "admin");
            return;
          }
          if (action === "inquiry-review") {
            openInquiryReviewModal(inquiryRows.find((item) => String(item._id) === String(button.dataset.inquiryId)));
            return;
          }
          if (action === "inquiry-invite") {
            const inquiry = inquiryRows.find((item) => String(item._id) === String(button.dataset.inquiryId));
            openPartnerInviteModal(inquiry ? { ...inquiry, inquiryId: inquiry._id } : {});
            return;
          }
          if (action === "invite-resend") {
            await resendInvite(button.dataset.inviteId);
            return;
          }
          if (action === "invite-revoke") {
            await revokeInvite(button.dataset.inviteId);
            return;
          }
          if (action === "partner-status") {
            await updatePartnerStatus(button.dataset.partnerId, button.dataset.status);
            return;
          }
          if (action === "copy-auth") {
            await copyText(button.dataset.url, "Tenant auth link copied.");
            return;
          }
          if (action === "open-prefilled-invite") {
            openPartnerInviteModal({
              companyName: button.dataset.companyName,
              businessType: button.dataset.businessType,
              country: button.dataset.country,
              contactName: button.dataset.contactName,
              email: button.dataset.email,
              phone: button.dataset.phone,
              notes: button.dataset.notes,
              role: button.dataset.role
            });
          }
        } catch (err) {
          toast(err.message, true);
        }
      };
    });

    activateDashboardPage(currentSection);
  }

  const renderers = {
    customer: renderCustomer,
    promoter: renderPromoter,
    companyAdmin: renderCompanyAdminLive,
    employee: renderEmployeeLive,
    super: renderSuper
  };

  const emptyStates = {
    customer: [
      { selector: "#recentBookings", cols: 6, text: "Login to load your bookings." },
      { selector: "#bookingsTable", cols: 8, text: "Login to load your bookings." },
      { selector: "#receiptsTable", cols: 7, text: "Login to load receipts." },
      { selector: "#walletTable", cols: 7, text: "Login to load wallet activity." }
    ],
    promoter: [
      { selector: "#recentBookings", cols: 6, text: "Login to load referral bookings." },
      { selector: "#linksTable", cols: 7, text: "Login to load live links." },
      { selector: "#commissionsTable", cols: 7, text: "Login to load commissions." }
    ],
    companyAdmin: [
      { selector: "#recentBookings", cols: 6, text: "Login to load company activity." },
      { selector: "#listingsTable", cols: 7, text: "Login to load company listings." },
      { selector: "#bookingsTable", cols: 8, text: "Login to load company bookings." }
    ],
    employee: [
      { selector: "#tasksTable", cols: 6, text: "Login to load employee tasks." },
      { selector: "#bookingsTable", cols: 8, text: "Login to load employee bookings." }
    ],
    super: [
      { selector: "#recentBookings", cols: 6, text: "Login to load platform activity." },
      { selector: "#bookingsTable", cols: 8, text: "Login to load platform bookings." },
      { selector: "#partnersTable", cols: 7, text: "Login to load partner companies." }
    ]
  };

  if (!token) {
    setWelcome("Login required", "This dashboard now loads live backend data. Sign in first to continue.");
    setPageHeading("Login required", "Authenticate to replace the design preview with live dashboard content.");
    clearTables(emptyStates[role] || []);
    ready();
    return;
  }

  const render = renderers[role];
  if (!render) {
    ready();
    return;
  }

  render()
    .catch((err) => {
      setWelcome("Dashboard unavailable", err.message || "We could not load live dashboard data.");
      setPageHeading("Dashboard unavailable", err.message || "We could not load live dashboard data.");
      clearTables(emptyStates[role] || []);
    })
    .finally(() => {
      activateDashboardPage(requestedPage);
      ready();
    });
})();
