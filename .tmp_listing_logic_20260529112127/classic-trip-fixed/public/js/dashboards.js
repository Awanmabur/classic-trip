(function dashboardApp() {
  const API = window.API_BASE || location.origin;
  const token = localStorage.getItem("ct_access") || "";
  const user = (() => {
    try {
      return JSON.parse(localStorage.getItem("ct_user") || "null");
    } catch (_err) {
      return null;
    }
  })();

  const shell = document.querySelector("[data-dashboard]");
  if (!shell) return;

  const type = shell.dataset.dashboard;
  const msg = document.getElementById("dashMsg");
  const roleEl = document.getElementById("dashRole");
  const statsEl = document.getElementById("dashStats");
  const overviewEl = document.getElementById("dashOverview");
  const activityEl = document.getElementById("dashActivity");
  const financeEl = document.getElementById("dashFinance");
  const toolsEl = document.getElementById("dashTools");
  const bookingsEl = document.querySelector("#dashBookings tbody");

  const endpoints = {
    super: "/api/dashboards/super-admin",
    companyAdmin: "/api/dashboards/company-admin",
    employee: "/api/dashboards/company-employee",
    customer: "/api/dashboards/customer",
    promoter: "/api/dashboards/promoter"
  };

  if (roleEl) {
    roleEl.textContent = user ? `${user.email || ""} - ${user.role || "user"}` : "Not logged in";
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
    try {
      return new Date(value).toLocaleString();
    } catch (_err) {
      return String(value || "");
    }
  }

  function fmtMoney(currency, amount) {
    return `${currency || "UGX"} ${Number(amount || 0).toLocaleString()}`;
  }

  function fmtRevenue(items) {
    return (items || []).map((item) => `${item._id}: ${Number(item.total || 0).toLocaleString()} (${item.bookings || 0})`).join(" | ") || "No confirmed revenue yet";
  }

  async function api(path) {
    const response = await fetch(`${API}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.message || `Request failed ${response.status}`);
    return data;
  }

  function kpi(label, value, note = "") {
    return `
      <div class="kpi">
        <span>${esc(label)}</span>
        <strong>${esc(value)}</strong>
        <small>${esc(note)}</small>
      </div>
    `;
  }

  function featureCard(title, bodyHtml, footerHtml = "") {
    return `
      <article class="feature">
        <h3>${esc(title)}</h3>
        <div class="featureBody">${bodyHtml}</div>
        ${footerHtml ? `<div class="featureFooter">${footerHtml}</div>` : ""}
      </article>
    `;
  }

  function listMarkup(items, emptyText) {
    if (!items || !items.length) return `<div class="muted">${esc(emptyText)}</div>`;
    return `<div class="miniList">${items.map((item) => `<div class="miniList__item">${item}</div>`).join("")}</div>`;
  }

  function renderBookingTable(items) {
    if (!bookingsEl) return;
    bookingsEl.innerHTML = (items || []).length
      ? items.map((booking) => `
        <tr>
          <td>${esc(booking.code)}</td>
          <td>${esc(booking.customer)}<br><small>${esc(booking.contact)}</small></td>
          <td>${esc(booking.service)}<br><small>${esc(booking.type)}</small></td>
          <td>${esc(fmtDate(booking.travelDate))}</td>
          <td>${esc(booking.seats || "-")}</td>
          <td>${esc(fmtMoney(booking.currency, booking.amount))}</td>
          <td><span class="status">${esc(booking.status)}</span></td>
          <td><small>Promoter: ${esc(fmtMoney(booking.currency, booking.promoterCommission))}<br>Platform: ${esc(fmtMoney(booking.currency, booking.platformCommission))}<br>Company: ${esc(fmtMoney(booking.currency, booking.companyAmount))}</small></td>
        </tr>
      `).join("")
      : `<tr><td colspan="8">No booking records yet.</td></tr>`;
  }

  function renderStats(kind, data) {
    const stats = data.stats || {};
    let rows = [];

    if (kind === "super") {
      rows = [
        ["Users", stats.users, "All accounts"],
        ["Company admins", stats.companyAdmins, "Operator owners"],
        ["Employees", stats.companyEmployees, "Staff accounts"],
        ["Customers", stats.customers, "Buyer accounts"],
        ["Promoters", stats.promoterUsers, "Referral sellers"],
        ["Live listings", stats.activeListings, "Routes and hotels"],
        ["Vehicles", stats.vehicles, "Buses, flights, trains, rooms"],
        ["Live trips", stats.liveTrips, "Scheduled inventory"],
        ["Bookings", stats.totalBookings, "All ticket records"],
        ["Confirmed", stats.confirmedBookings, "Paid or completed"],
        ["Guest bookings", stats.guestBookings, "No-login checkouts"],
        ["Referred bookings", stats.referredBookings, "Promoter-linked sales"]
      ];
    }

    if (kind === "companyAdmin") {
      rows = [
        ["Listings", stats.listings, "Routes and hotels"],
        ["Vehicles", stats.vehicles, "Operating inventory"],
        ["Scheduled trips", stats.scheduledTrips, "Current services"],
        ["Upcoming", stats.upcomingTrips, "Future departures"],
        ["Bookings", stats.totalBookings, "All company bookings"],
        ["Confirmed", stats.confirmedBookings, "Completed sales"],
        ["Guest bookings", stats.guestBookings, "No-login buyers"],
        ["Referred sales", stats.referredSales, "Promoter traffic"],
        ["Wallet", fmtMoney(stats.walletCurrency, stats.walletBalance), "Current balance"],
        ["Revenue", fmtRevenue(stats.revenue), "Confirmed turnover"]
      ];
    }

    if (kind === "employee") {
      rows = [
        ["Today trips", stats.todayTripCount, "Operational schedule"],
        ["Future trips", stats.futureTrips, "Upcoming services"],
        ["Confirmed", stats.confirmedBookings, "Ready passengers"],
        ["Pending payment", stats.pendingPayments, "Needs review"]
      ];
    }

    if (kind === "customer") {
      rows = [
        ["Bookings", stats.totalBookings, "All account bookings"],
        ["Upcoming", stats.upcomingBookings, "Future travel"],
        ["Cancelled", stats.cancelledBookings, "Ended trips"],
        ["Wallet", fmtMoney(stats.walletCurrency, stats.walletBalance), "Balance ready"]
      ];
    }

    if (kind === "promoter") {
      rows = [
        ["Referred bookings", stats.referredBookings, "Confirmed sales"],
        ["Total earned", fmtMoney(data.wallet?.currency || stats.walletCurrency, stats.totalEarned), "3 percent share"],
        ["Wallet", fmtMoney(stats.walletCurrency, stats.walletBalance), "Available balance"],
        ["Share links", stats.activeShareLinks, "Ready to promote"]
      ];
    }

    statsEl.innerHTML = rows.map((row) => kpi(row[0], row[1], row[2])).join("");
  }

  function renderOverview(kind, data) {
    const cards = [];

    if (kind === "super") {
      cards.push(featureCard(
        "Platform revenue",
        `<div class="metaLine">${esc(fmtRevenue(data.stats?.revenue))}</div>`,
        `<div class="muted">Revenue is based on confirmed booking amounts.</div>`
      ));

      cards.push(featureCard(
        "Inventory mix",
        listMarkup((data.inventoryMix || []).map((item) => `<strong>${esc(item._id)}</strong> - ${esc(item.count)}`), "No inventory yet")
      ));

      cards.push(featureCard(
        "Top companies",
        listMarkup((data.companyLeaders || []).map((company) => `<strong>${esc(company.name)}</strong> - ${esc(company.bookings)} bookings - ${esc(company.revenue.toLocaleString())}`), "No company leaders yet")
      ));
    }

    if (kind === "companyAdmin") {
      cards.push(featureCard(
        "Company profile",
        `<div class="metaLine"><strong>${esc(data.company?.name || "Company")}</strong></div><div class="metaLine">${esc(data.company?.email || "")}</div>`
      ));

      cards.push(featureCard(
        "Employees",
        listMarkup((data.employees || []).map((employee) => `<strong>${esc(employee.name)}</strong> - ${esc(employee.email)}`), "No employees assigned yet")
      ));

      cards.push(featureCard(
        "Inventory mix",
        listMarkup((data.inventoryMix || []).map((item) => `<strong>${esc(item._id)}</strong> - ${esc(item.count)}`), "No active listings yet")
      ));
    }

    if (kind === "employee") {
      cards.push(featureCard(
        "Assigned company",
        `<div class="metaLine"><strong>${esc(data.company?.name || "Company")}</strong></div><div class="metaLine">${esc(data.company?.email || "")}</div>`
      ));

      cards.push(featureCard(
        "Employee account",
        `<div class="metaLine"><strong>${esc(data.employee?.name || "")}</strong></div><div class="metaLine">${esc(data.employee?.email || "")}</div>`
      ));

      cards.push(featureCard(
        "Operations note",
        listMarkup((data.operationNotes || []).map((note) => esc(note)), "No notes yet")
      ));
    }

    if (kind === "customer") {
      cards.push(featureCard(
        "Customer profile",
        `<div class="metaLine"><strong>${esc(data.customer?.name || "")}</strong></div><div class="metaLine">${esc(data.customer?.email || "")}</div>`
      ));

      cards.push(featureCard(
        "Wallet balance",
        `<div class="metaLine"><strong>${esc(fmtMoney(data.wallet?.currency, data.wallet?.balance))}</strong></div><div class="metaLine">Available for future wallet-enabled bookings.</div>`
      ));

      cards.push(featureCard(
        "Upcoming trips",
        listMarkup((data.upcomingRows || []).map((booking) => `<strong>${esc(booking.service)}</strong> - ${esc(fmtDate(booking.travelDate))}`), "No upcoming bookings yet")
      ));
    }

    if (kind === "promoter") {
      cards.push(featureCard(
        "Referral code",
        `<div class="codePill">${esc(data.promoter?.referralCode || "No code")}</div>`,
        `<div class="muted">Attach this code to any trip link you share.</div>`
      ));

      cards.push(featureCard(
        "Wallet balance",
        `<div class="metaLine"><strong>${esc(fmtMoney(data.wallet?.currency, data.wallet?.balance))}</strong></div><div class="metaLine">Commission settles into the wallet after confirmed bookings.</div>`
      ));

      cards.push(featureCard(
        "Recent earnings",
        listMarkup((data.bookingRows || []).slice(0, 5).map((booking) => `<strong>${esc(booking.service)}</strong> - ${esc(fmtMoney(booking.currency, booking.promoterCommission))}`), "No promoter earnings yet")
      ));
    }

    overviewEl.innerHTML = cards.join("");
  }

  function renderActivity(kind, data) {
    const cards = [];

    if (kind === "super") {
      cards.push(featureCard(
        "Recent users",
        listMarkup((data.recentUsers || []).map((item) => `<strong>${esc(item.name)}</strong> - ${esc(item.role)} - ${esc(item.email)}`), "No recent users")
      ));

      cards.push(featureCard(
        "Top promoters",
        listMarkup((data.promoterLeaders || []).map((item) => `<strong>${esc(item.name)}</strong> - ${esc(item.bookings)} sales - ${esc(item.earned.toLocaleString())}`), "No promoter activity yet")
      ));
    }

    if (kind === "companyAdmin") {
      cards.push(featureCard(
        "Active trips",
        listMarkup((data.activeTrips || []).map((trip) => `<strong>${esc(trip.title)}</strong> - ${esc(fmtDate(trip.departureAt))} - ${esc(trip.remainingSeats)} left`), "No active trips yet")
      ));

      cards.push(featureCard(
        "Wallet activity",
        listMarkup((data.walletTxns || []).map((txn) => `<strong>${esc(txn.type)}</strong> - ${esc(fmtMoney(txn.currency, txn.amount))}`), "No wallet activity yet")
      ));
    }

    if (kind === "employee") {
      cards.push(featureCard(
        "Today trips",
        listMarkup((data.todayTrips || []).map((trip) => `<strong>${esc(trip.title)}</strong> - ${esc(fmtDate(trip.departureAt))} - ${esc(trip.vehicleName)}`), "No trips scheduled for today")
      ));

      cards.push(featureCard(
        "Support priorities",
        listMarkup([
          "Verify tickets against manifest before boarding.",
          "Escalate refund requests to company admin.",
          "Watch pending payment bookings before departure."
        ], "No operations priorities")
      ));
    }

    if (kind === "customer") {
      cards.push(featureCard(
        "Wallet activity",
        listMarkup((data.walletTxns || []).map((txn) => `<strong>${esc(txn.type)}</strong> - ${esc(fmtMoney(txn.currency, txn.amount))}`), "No wallet activity yet")
      ));

      cards.push(featureCard(
        "Travel actions",
        listMarkup([
          "Use guest checkout when you want speed.",
          "Use account checkout when you want history and wallet access.",
          "Keep your booking code for support or check-in."
        ], "No travel actions")
      ));
    }

    if (kind === "promoter") {
      cards.push(featureCard(
        "Ready share links",
        listMarkup((data.shareLinks || []).slice(0, 4).map((item) => `
          <div class="shareRow">
            <div>
              <strong>${esc(item.title)}</strong><br>
              <small>${esc(item.type)}</small>
            </div>
            <button class="btn small" type="button" data-copy="${esc(item.shareUrl)}">Copy</button>
          </div>
        `), "No share links yet")
      ));

      cards.push(featureCard(
        "Wallet activity",
        listMarkup((data.walletTxns || []).map((txn) => `<strong>${esc(txn.type)}</strong> - ${esc(fmtMoney(txn.currency, txn.amount))}`), "No wallet activity yet")
      ));
    }

    activityEl.innerHTML = cards.join("");
  }

  function renderFinance(kind, data) {
    const cards = [];

    if (kind === "super" || kind === "companyAdmin") {
      cards.push(featureCard(
        "Split rule",
        `<div class="splitNote">With promoter: 3 percent promoter, 7 percent platform, 90 percent company. Without promoter: 10 percent platform, 90 percent company.</div>`
      ));

      cards.push(featureCard(
        "Wallet snapshot",
        `<div class="metaLine"><strong>${esc(fmtMoney(data.wallet?.currency || data.stats?.walletCurrency, data.wallet?.balance || data.stats?.walletBalance || 0))}</strong></div><div class="metaLine">Immediate internal settlement balance.</div>`
      ));
    }

    if (kind === "employee") {
      cards.push(featureCard(
        "Finance visibility",
        `<div class="metaLine">Employees do not manage payouts directly. Use manifests and ticket checks, then escalate finance issues to company admin.</div>`
      ));
    }

    if (kind === "customer") {
      cards.push(featureCard(
        "Wallet balance",
        `<div class="metaLine"><strong>${esc(fmtMoney(data.wallet?.currency, data.wallet?.balance))}</strong></div><div class="metaLine">Available for wallet-supported bookings.</div>`
      ));

      cards.push(featureCard(
        "Support rule",
        `<div class="metaLine">Use your booking code or account history when requesting help, refunds, or changes.</div>`
      ));
    }

    if (kind === "promoter") {
      cards.push(featureCard(
        "Commission rule",
        `<div class="metaLine">Promoters earn 3 percent when a confirmed booking comes through their referral link.</div>`
      ));

      cards.push(featureCard(
        "Wallet balance",
        `<div class="metaLine"><strong>${esc(fmtMoney(data.wallet?.currency, data.wallet?.balance))}</strong></div><div class="metaLine">Commission is credited internally after confirmation.</div>`
      ));
    }

    financeEl.innerHTML = cards.join("");
  }

  function renderTools(kind) {
    const toolMap = {
      super: [
        ["User management", "Manage roles, suspended accounts, and company staff.", "/admin/users", "Open users"],
        ["Booking audit", "Review platform-wide bookings, guest orders, and split outcomes.", "/admin/bookings", "Open bookings"],
        ["Marketplace view", "See what customers and promoters see on the live marketplace.", "/", "Open home"]
      ],
      companyAdmin: [
        ["Operations", "View company occupancy, manifests, and performance from one place.", "/partner", "Open ops"],
        ["Create listing", "Add routes, flights, trains, or hotels.", "/partner/routes/new", "New listing"],
        ["Create vehicle", "Add bus, train, flight, or room layouts.", "/partner/vehicles/new", "New vehicle"],
        ["Schedule trip", "Create departures or inventory availability.", "/partner/trips/new", "New trip"]
      ],
      employee: [
        ["Operations", "Open the company operations page for occupancy and trip monitoring.", "/partner", "Open ops"],
        ["Marketplace", "Search live inventory when customers need help locating a service.", "/search", "Search"],
        ["Wallet", "Open wallet if staff support flow needs balance checks.", "/wallet", "Open wallet"]
      ],
      customer: [
        ["Book again", "Search buses, trains, flights, and hotels.", "/search", "Search"],
        ["My bookings", "Return to account booking history.", "/me/bookings", "Open bookings"],
        ["Wallet", "Review wallet activity and balance.", "/wallet", "Open wallet"]
      ],
      promoter: [
        ["Find more inventory", "Search live trips and stays to share with your audience.", "/search", "Search"],
        ["Wallet", "Review promoter commission balance.", "/wallet", "Open wallet"],
        ["Marketplace home", "Grab more inventory from the main landing page.", "/", "Open home"]
      ]
    };

    toolsEl.innerHTML = (toolMap[kind] || [])
      .map((item) => featureCard(item[0], `<div class="metaLine">${esc(item[1])}</div>`, `<a class="btn small" href="${item[2]}">${esc(item[3])}</a>`))
      .join("");
  }

  document.body.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy]");
    if (!button) return;
    const value = button.getAttribute("data-copy") || "";
    await navigator.clipboard.writeText(value);
    button.textContent = "Copied";
    setTimeout(() => {
      button.textContent = "Copy";
    }, 1200);
  });

  if (!token) {
    msg.innerHTML = `Please login first. <a href="/login">Go to login</a>`;
    return;
  }

  (async () => {
    try {
      const data = await api(endpoints[type]);
      msg.textContent = "Dashboard loaded.";
      renderStats(type, data);
      renderOverview(type, data);
      renderActivity(type, data);
      renderFinance(type, data);
      renderTools(type);
      renderBookingTable(data.bookingRows || []);
    } catch (err) {
      msg.textContent = `Error: ${err.message}`;
    }
  })();
})();
