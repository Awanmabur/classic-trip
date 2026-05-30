const API = window.API_BASE || location.origin;
const LS_TOKEN = "ct_access";
const LS_USER = "ct_user";

const ROLE_DASHBOARD_PATHS = {
  super_admin: "/super-admin",
  admin: "/super-admin",
  company_admin: "/company-admin",
  partner: "/company-admin",
  company_employee: "/company-employee",
  promoter: "/promoter-dashboard",
  customer: "/customer-dashboard"
};

const CUSTOMER_ROLES = ["customer", "promoter", "admin", "super_admin"];
const PROMOTER_ROLES = ["promoter", "admin", "super_admin"];
const COMPANY_ADMIN_ROLES = ["partner", "company_admin", "admin", "super_admin"];
const COMPANY_OPERATIONS_ROLES = ["partner", "company_admin", "company_employee", "admin", "super_admin"];
const ADMIN_ROLES = ["admin", "super_admin"];

function getToken() {
  return localStorage.getItem(LS_TOKEN) || "";
}

function setToken(token) {
  if (token) localStorage.setItem(LS_TOKEN, token);
  else localStorage.removeItem(LS_TOKEN);
}

function getUser() {
  try {
    return JSON.parse(localStorage.getItem(LS_USER) || "null");
  } catch (_err) {
    return null;
  }
}

function setUser(user) {
  if (user) localStorage.setItem(LS_USER, JSON.stringify(user));
  else localStorage.removeItem(LS_USER);
}

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function hasRole(role, allowed) {
  return Boolean(role && allowed.includes(role));
}

function dashboardPathForRole(role) {
  return ROLE_DASHBOARD_PATHS[role] || "/customer-dashboard";
}

function escapeHtml(value) {
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

function captureReferral() {
  try {
    const params = new URLSearchParams(location.search);
    const ref = params.get("ref") || params.get("shareRef") || params.get("code");
    if (ref) localStorage.setItem("ct_ref", String(ref).trim());
  } catch (_err) {
    // ignore
  }
}

function getReferral() {
  return localStorage.getItem("ct_ref") || "";
}

async function api(path, { method = "GET", headers = {}, body = null, isForm = false } = {}) {
  const options = {
    method,
    headers: {
      ...headers,
      ...authHeaders()
    }
  };

  if (body != null) {
    if (isForm) {
      options.body = body;
    } else {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
  }

  const response = await fetch(`${API}${path}`, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.message || `Request failed: ${response.status}`);
  }
  return data;
}

function updateDashboardLink(user) {
  const link = document.getElementById("navDashboardLink");
  if (!link) return;

  if (!user) {
    link.href = "/dashboard";
    link.textContent = "Dashboard";
    return;
  }

  const labels = {
    super_admin: "Super Admin",
    admin: "Super Admin",
    company_admin: "Company Dashboard",
    partner: "Company Dashboard",
    company_employee: "Employee Dashboard",
    promoter: "Promoter Dashboard",
    customer: "Customer Dashboard"
  };

  link.href = dashboardPathForRole(user.role);
  link.textContent = labels[user.role] || "Dashboard";
}

function applyNavVisibility() {
  const user = getUser();
  const role = user?.role || null;

  updateDashboardLink(user);

  document.querySelectorAll("[data-guest]").forEach((el) => {
    el.style.display = user ? "none" : "";
  });

  const account = document.getElementById("navAccount");
  if (account) {
    account.textContent = user ? `${user.email || ""} - ${role || "user"}` : "";
    account.style.display = user ? "" : "none";
  }

  document.querySelectorAll("[data-auth]").forEach((el) => {
    const need = el.getAttribute("data-auth");
    if (!user) {
      el.style.display = "none";
      return;
    }

    if (need === "any") {
      el.style.display = "";
      return;
    }

    if (need === "customer") el.style.display = hasRole(role, CUSTOMER_ROLES) ? "" : "none";
    if (need === "promoter") el.style.display = hasRole(role, PROMOTER_ROLES) ? "" : "none";
    if (need === "partner") el.style.display = hasRole(role, COMPANY_ADMIN_ROLES) ? "" : "none";
    if (need === "employee") el.style.display = hasRole(role, COMPANY_OPERATIONS_ROLES) ? "" : "none";
    if (need === "admin") el.style.display = hasRole(role, ADMIN_ROLES) ? "" : "none";
  });
}

function renderTripCard(trip) {
  const route = trip.routeId || {};
  const vehicle = trip.vehicleId || {};
  const title = route.title || `${route.from || "-"} to ${route.to || "-"}`;
  const remaining = Math.max(0, (trip.totalSeats || 0) - (trip.bookedSeats || 0) - (trip.heldSeats || 0));

  return `
    <div class="cardItem">
      <h3>${escapeHtml(title)}</h3>
      <div class="meta">${escapeHtml((route.type || "trip").toUpperCase())} - ${escapeHtml(fmtDate(trip.departureAt))}</div>
      <div class="meta">${escapeHtml(vehicle.name || "Inventory")} - ${remaining} left</div>
      <div class="row">
        <div class="meta">${escapeHtml(fmtMoney(trip.currency, trip.basePrice))}</div>
        <a class="btn btn--primary" href="/trip/${encodeURIComponent(trip._id)}">Select</a>
      </div>
    </div>
  `;
}

function setMessage(el, text) {
  if (el) el.textContent = text || "";
}

function initRegisterRoleFields() {
  const role = document.getElementById("registerRole");
  const wrap = document.getElementById("companyEmailWrap");
  const input = document.getElementById("companyEmail");
  if (!role || !wrap || !input) return;

  const sync = () => {
    const employee = role.value === "company_employee";
    wrap.hidden = !employee;
    input.disabled = !employee;
    input.required = employee;
    if (!employee) input.value = "";
  };

  role.addEventListener("change", sync);
  sync();
}

function initDashboardRedirect() {
  if (document.body?.dataset.page !== "dashboard-redirect") return;
  const msg = document.getElementById("dashboardRedirectMsg");
  const user = getUser();

  if (!user) {
    setMessage(msg, "No active session found. Redirecting to login...");
    setTimeout(() => {
      location.href = "/login";
    }, 500);
    return;
  }

  setMessage(msg, `Opening ${user.role || "user"} dashboard...`);
  setTimeout(() => {
    location.href = dashboardPathForRole(user.role);
  }, 250);
}

function initHomeTabs() {
  const tabs = document.querySelectorAll(".segBtn");
  const hidden = document.getElementById("homeType");
  if (!tabs.length || !hidden) return;

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((item) => item.classList.remove("is-active"));
      tab.classList.add("is-active");
      hidden.value = tab.dataset.type || "bus";
    });
  });
}

function initLogin() {
  const form = document.getElementById("loginForm");
  const msg = document.getElementById("loginMsg");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage(msg, "Signing in...");
    const body = Object.fromEntries(new FormData(form).entries());

    try {
      const response = await api("/api/auth/login", { method: "POST", body });
      setToken(response.accessToken);
      setUser(response.user);
      applyNavVisibility();
      setMessage(msg, "Login successful. Redirecting...");
      setTimeout(() => {
        location.href = dashboardPathForRole(response.user?.role);
      }, 500);
    } catch (err) {
      setMessage(msg, `Error: ${err.message}`);
    }
  });
}

function initRegister() {
  const form = document.getElementById("registerForm");
  const msg = document.getElementById("registerMsg");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage(msg, "Creating account...");
    const body = Object.fromEntries(new FormData(form).entries());

    try {
      const response = await api("/api/auth/register", { method: "POST", body });
      setToken(response.accessToken);
      setUser(response.user);
      applyNavVisibility();
      setMessage(msg, "Account created. Redirecting...");
      setTimeout(() => {
        location.href = dashboardPathForRole(response.user?.role);
      }, 500);
    } catch (err) {
      setMessage(msg, `Error: ${err.message}`);
    }
  });
}

function initLogout() {
  const btn = document.getElementById("btnLogout");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch (_err) {
      // ignore logout failure
    }

    setToken("");
    setUser(null);
    applyNavVisibility();
    location.href = "/logout";
  });
}

function initSearch() {
  const form = document.getElementById("searchForm");
  const results = document.getElementById("results");
  const meta = document.getElementById("resultsMeta");
  if (!form || !results || !meta) return;

  function syncFromQuery() {
    const params = new URLSearchParams(location.search);
    ["type", "from", "to", "date", "country", "city"].forEach((key) => {
      const field = form.querySelector(`[name="${key}"]`);
      if (field && params.get(key)) field.value = params.get(key);
    });
    return params;
  }

  async function run(params) {
    results.innerHTML = "";
    meta.textContent = "Loading...";

    const query = new URLSearchParams();
    ["type", "from", "to", "date", "country", "city"].forEach((key) => {
      const value = params.get(key);
      if (value) query.set(key, value);
    });
    query.set("limit", "18");

    const response = await api(`/api/trips?${query.toString()}`);
    const items = response.items || [];

    results.innerHTML = items.length
      ? items.map(renderTripCard).join("")
      : `<div class="muted">No results found. Try another route or date.</div>`;

    meta.textContent = `${response.total || items.length} results`;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const params = new URLSearchParams(new FormData(form));
    history.replaceState({}, "", `/search?${params.toString()}`);
    run(params).catch((err) => {
      meta.textContent = `Error: ${err.message}`;
    });
  });

  const params = syncFromQuery();
  if ([...params.keys()].length) {
    run(params).catch((err) => {
      meta.textContent = `Error: ${err.message}`;
    });
  }
}

function initTrip() {
  const tripId = window.TRIP_ID;
  if (!tripId) return;

  const titleEl = document.getElementById("tripTitle");
  const metaEl = document.getElementById("tripMeta");
  const gridEl = document.getElementById("seatGrid");
  const noteEl = document.getElementById("seatNote");
  const selCount = document.getElementById("selCount");
  const selPrice = document.getElementById("selPrice");
  const selStatus = document.getElementById("selStatus");
  const btnHold = document.getElementById("btnHold");
  const btnConfirm = document.getElementById("btnConfirm");
  const refPill = document.getElementById("refPill");
  const shareLink = document.getElementById("shareLink");
  const btnCopyShare = document.getElementById("btnCopyShare");
  const shareMsg = document.getElementById("shareMsg");
  const btnGuest = document.getElementById("btnGuestConfirm");
  const guestMsg = document.getElementById("gNote");

  let trip = null;
  let selected = new Set();
  let heldByYou = new Set();

  function updateSummary() {
    const count = selected.size;
    if (selCount) selCount.textContent = String(count);
    if (selPrice) selPrice.textContent = trip ? fmtMoney(trip.currency, trip.basePrice * count) : "-";
    if (selStatus) {
      selStatus.textContent = heldByYou.size ? "Held" : "Not held";
      selStatus.className = heldByYou.size ? "" : "muted";
    }
  }

  function renderSeats(vehicle, availability) {
    const cols = vehicle.cols || 6;
    const booked = new Set(availability.bookedSeats || []);
    const held = new Set(availability.heldSeats || []);
    const seats = vehicle.seats || [];
    const maxRow = vehicle.rows || Math.max(...seats.map((seat) => seat.row || 1), 1);
    const grid = Array.from({ length: maxRow * cols }, () => null);

    gridEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

    seats.forEach((seat) => {
      const row = Number(seat.row || 1) - 1;
      const col = Number(seat.col || 1) - 1;
      grid[row * cols + col] = seat;
    });

    gridEl.innerHTML = grid.map((seat) => {
      if (!seat) return `<div class="seat is-aisle"></div>`;

      const id = seat.seatId || seat.id || seat.label;
      const isAisle = Boolean(seat.isAisle);
      const taken = booked.has(id);
      const onHold = held.has(id);
      const classes = [
        "seat",
        isAisle ? "is-aisle" : "",
        taken ? "is-taken" : "",
        onHold ? "is-held" : "",
        selected.has(id) ? "is-selected" : ""
      ].filter(Boolean).join(" ");

      return `<div class="${classes}" data-seat="${escapeHtml(id)}" data-aisle="${isAisle ? 1 : 0}" data-taken="${taken ? 1 : 0}">${isAisle ? "" : escapeHtml(id)}</div>`;
    }).join("");

    gridEl.onclick = (event) => {
      const seat = event.target.closest("[data-seat]");
      if (!seat) return;
      if (seat.getAttribute("data-aisle") === "1" || seat.getAttribute("data-taken") === "1") return;

      const id = seat.getAttribute("data-seat");
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);

      if (heldByYou.size) heldByYou.clear();
      seat.classList.toggle("is-selected");
      updateSummary();
    };
  }

  async function ensureReferralCode() {
    const user = getUser();
    if (!user) return "";
    if (user.referralCode) return user.referralCode;

    try {
      const promo = await api("/api/promotions/me");
      const code = promo.user?.referralCode || "";
      if (code) setUser({ ...user, referralCode: code });
      return code;
    } catch (_err) {
      return "";
    }
  }

  (async () => {
    try {
      const tripResponse = await api(`/api/trips/${tripId}`);
      const seatResponse = await api(`/api/seats/trip/${tripId}`);
      trip = tripResponse.trip;

      if (titleEl) titleEl.textContent = `${trip.routeId?.title || "Trip"} - ${trip.vehicleId?.name || ""}`;
      if (metaEl) {
        metaEl.textContent = `${(trip.routeId?.type || "TRIP").toUpperCase()} - ${fmtDate(trip.departureAt)} - ${fmtMoney(trip.currency, trip.basePrice)} - ${seatResponse.trip.remainingSeats} seats left`;
      }

      renderSeats(seatResponse.vehicle, seatResponse.availability);
      updateSummary();

      if (refPill) refPill.textContent = getReferral() || "None";

      if (shareLink && getUser()) {
        const code = await ensureReferralCode();
        const url = `${location.origin}/trip/${tripId}?ref=${encodeURIComponent(code)}`;
        shareLink.value = url;

        if (btnCopyShare) {
          btnCopyShare.onclick = async () => {
            await navigator.clipboard.writeText(url);
            setMessage(shareMsg, "Copied.");
            setTimeout(() => setMessage(shareMsg, ""), 1200);
          };
        }
      }
    } catch (err) {
      setMessage(metaEl, `Error: ${err.message}`);
    }
  })();

  if (btnHold) {
    btnHold.onclick = async () => {
      const user = getUser();
      if (!getToken() || !hasRole(user?.role, CUSTOMER_ROLES)) {
        setMessage(noteEl, "Login with a customer or promoter account first.");
        return;
      }
      if (!selected.size) {
        setMessage(noteEl, "Select seats first.");
        return;
      }

      setMessage(noteEl, "Holding seats...");
      try {
        const response = await api(`/api/seats/trip/${tripId}/hold`, {
          method: "POST",
          body: { seats: [...selected] }
        });

        heldByYou = new Set(response.heldByYou || []);
        setMessage(noteEl, `Held: ${[...heldByYou].join(", ")} for ${response.holdMinutes} minutes.`);
        updateSummary();

        const refresh = await api(`/api/seats/trip/${tripId}`);
        renderSeats(refresh.vehicle, refresh.availability);
      } catch (err) {
        setMessage(noteEl, `Error: ${err.message}`);
      }
    };
  }

  if (btnConfirm) {
    btnConfirm.onclick = async () => {
      const user = getUser();
      if (!getToken() || !hasRole(user?.role, CUSTOMER_ROLES)) {
        setMessage(noteEl, "Login with a customer or promoter account first, or use guest booking.");
        return;
      }
      if (!selected.size) {
        setMessage(noteEl, "Select seats first.");
        return;
      }

      setMessage(noteEl, "Confirming booking...");
      try {
        const useWallet = Boolean(document.getElementById("useWallet")?.checked);
        const response = await api("/api/bookings/confirm", {
          method: "POST",
          body: {
            tripId,
            seats: [...selected],
            paymentProvider: "none",
            referralCode: getReferral(),
            useWallet
          }
        });

        setMessage(noteEl, `Booking created: ${response.booking._id}`);
        selected.clear();
        heldByYou.clear();
        updateSummary();

        setTimeout(() => {
          location.href = "/me/bookings";
        }, 700);
      } catch (err) {
        setMessage(noteEl, `Error: ${err.message}`);
      }
    };
  }

  if (btnGuest) {
    btnGuest.onclick = async () => {
      if (getToken()) {
        setMessage(guestMsg, "You are already logged in. Use the main confirm button if you want wallet or account history.");
        return;
      }
      if (!selected.size) {
        setMessage(guestMsg, "Select seats first.");
        return;
      }

      const guest = {
        name: document.getElementById("gName")?.value || "",
        email: document.getElementById("gEmail")?.value || "",
        phone: document.getElementById("gPhone")?.value || ""
      };

      setMessage(guestMsg, "Booking as guest...");
      try {
        const response = await api("/api/bookings/guest/confirm", {
          method: "POST",
          body: {
            tripId,
            seats: [...selected],
            guest,
            referralCode: getReferral()
          }
        });

        setMessage(guestMsg, "Booking created. Redirecting...");
        selected.clear();
        updateSummary();

        setTimeout(() => {
          location.href = `/guest/booking/${encodeURIComponent(response.booking.guestLookupCode)}`;
        }, 700);
      } catch (err) {
        setMessage(guestMsg, `Error: ${err.message}`);
      }
    };
  }
}

function initMyBookings() {
  const list = document.getElementById("myBookings");
  const msg = document.getElementById("myBookingsMsg");
  if (!list || !msg) return;

  const user = getUser();
  if (!getToken() || !hasRole(user?.role, CUSTOMER_ROLES)) {
    setMessage(msg, "Login with a customer or promoter account to see your bookings.");
    return;
  }

  (async () => {
    try {
      const response = await api("/api/bookings/me");
      const items = response.items || [];

      list.innerHTML = items.length
        ? items.map((booking) => {
          const trip = booking.tripId || {};
          const route = trip.routeId || {};
          const title = route.title || "Booking";
          const seats = (booking.seats || []).map((seat) => seat.seatId).join(", ");
          return `
            <div class="cardItem">
              <h3>${escapeHtml(title)}</h3>
              <div class="meta">${escapeHtml(String(booking.status || "").toUpperCase())} - ${escapeHtml(fmtDate(booking.travelDate))}</div>
              <div class="meta">Seats: ${escapeHtml(seats || "-")}</div>
              <div class="row">
                <div class="meta">${escapeHtml(fmtMoney(booking.currency, booking.amount))}</div>
                <button class="btn btn--ghost" data-cancel="${escapeHtml(booking._id)}" type="button">Cancel</button>
              </div>
            </div>
          `;
        }).join("")
        : `<div class="muted">No bookings yet.</div>`;

      list.onclick = async (event) => {
        const button = event.target.closest("[data-cancel]");
        if (!button) return;
        button.disabled = true;
        try {
          await api(`/api/bookings/${button.dataset.cancel}/cancel`, { method: "PATCH" });
          location.reload();
        } catch (err) {
          setMessage(msg, `Error: ${err.message}`);
          button.disabled = false;
        }
      };
    } catch (err) {
      setMessage(msg, `Error: ${err.message}`);
    }
  })();
}

function initPartnerDashboard() {
  const tripsEl = document.getElementById("partnerTrips");
  const msg = document.getElementById("partnerMsg");
  if (!tripsEl || !msg) return;

  const user = getUser();
  if (!user || !hasRole(user.role, COMPANY_OPERATIONS_ROLES)) {
    setMessage(msg, "Login with a company role first.");
    return;
  }

  (async () => {
    try {
      const response = await api("/api/partners/dashboard");
      const stats = response.stats || {};
      const trips = response.recentTrips || [];

      if (document.getElementById("kTrips")) document.getElementById("kTrips").textContent = stats.trips ?? "0";
      if (document.getElementById("kBookings")) document.getElementById("kBookings").textContent = stats.totalBookings ?? "0";
      if (document.getElementById("kConfirmed")) document.getElementById("kConfirmed").textContent = stats.confirmedBookings ?? "0";

      tripsEl.innerHTML = trips.length
        ? trips.map((trip) => `
          <div class="cardItem">
            <h3>${escapeHtml(fmtDate(trip.departureAt))}</h3>
            <div class="meta">Trip ID: ${escapeHtml(trip._id)}</div>
            <div class="row">
              <a class="btn btn--ghost" href="/partner/trips/${encodeURIComponent(trip._id)}/occupancy">Occupancy</a>
              <a class="btn btn--primary" href="/partner/trips/${encodeURIComponent(trip._id)}/manifest">Manifest</a>
            </div>
          </div>
        `).join("")
        : `<div class="muted">No trips yet.</div>`;
    } catch (err) {
      setMessage(msg, `Error: ${err.message}`);
    }
  })();
}

function initVehicleNew() {
  const form = document.getElementById("vehicleForm");
  const msg = document.getElementById("vehicleMsg");
  const layout = document.getElementById("layoutName");
  const customWrap = document.getElementById("customSeatsWrap");
  if (!form || !msg || !layout || !customWrap) return;

  const user = getUser();
  if (!user || !hasRole(user.role, COMPANY_ADMIN_ROLES)) {
    setMessage(msg, "Login with a company admin account first.");
    return;
  }

  layout.onchange = () => {
    customWrap.style.display = layout.value === "custom" ? "" : "none";
  };
  layout.onchange();

  form.onsubmit = async (event) => {
    event.preventDefault();
    setMessage(msg, "Creating vehicle...");
    try {
      const response = await api("/api/vehicles", {
        method: "POST",
        body: new FormData(form),
        isForm: true
      });
      setMessage(msg, `Vehicle created: ${response.vehicle._id}`);
      form.reset();
      layout.onchange();
    } catch (err) {
      setMessage(msg, `Error: ${err.message}`);
    }
  };
}

function initRouteNew() {
  const form = document.getElementById("routeForm");
  const msg = document.getElementById("routeMsg");
  const type = document.getElementById("routeType");
  const routeFields = document.getElementById("routeFields");
  const hotelFields = document.getElementById("hotelFields");
  if (!form || !msg || !type || !routeFields || !hotelFields) return;

  const user = getUser();
  if (!user || !hasRole(user.role, COMPANY_ADMIN_ROLES)) {
    setMessage(msg, "Login with a company admin account first.");
    return;
  }

  const sync = () => {
    const hotel = type.value === "hotel";
    routeFields.style.display = hotel ? "none" : "";
    hotelFields.style.display = hotel ? "" : "none";
  };

  type.onchange = sync;
  sync();

  form.onsubmit = async (event) => {
    event.preventDefault();
    setMessage(msg, "Creating listing...");
    try {
      const response = await api("/api/routes", {
        method: "POST",
        body: new FormData(form),
        isForm: true
      });
      setMessage(msg, `Listing created: ${response.route._id}`);
      form.reset();
      sync();
    } catch (err) {
      setMessage(msg, `Error: ${err.message}`);
    }
  };
}

async function fillSelect(select, items, label) {
  if (!select) return;
  select.innerHTML = (items || []).map((item) => `<option value="${item._id}">${escapeHtml(label(item))}</option>`).join("");
}

function initTripNew() {
  const form = document.getElementById("tripForm");
  const msg = document.getElementById("tripMsg");
  if (!form || !msg) return;

  const user = getUser();
  if (!user || !hasRole(user.role, COMPANY_ADMIN_ROLES)) {
    setMessage(msg, "Login with a company admin account first.");
    return;
  }

  (async () => {
    try {
      const routes = await api("/api/routes/mine/list");
      const vehicles = await api("/api/vehicles");
      await fillSelect(document.getElementById("routeId"), routes.items || [], (route) => `${(route.type || "").toUpperCase()} - ${route.title}`);
      await fillSelect(document.getElementById("vehicleId"), vehicles.items || [], (vehicle) => `${(vehicle.type || "").toUpperCase()} - ${vehicle.name} - ${vehicle.layoutName} - ${vehicle.totalSeats} seats`);
    } catch (err) {
      setMessage(msg, `Error: ${err.message}`);
    }
  })();

  form.onsubmit = async (event) => {
    event.preventDefault();
    setMessage(msg, "Creating trip...");
    const body = Object.fromEntries(new FormData(form).entries());
    try {
      const response = await api("/api/trips", { method: "POST", body });
      setMessage(msg, `Trip created: ${response.trip._id}`);
      form.reset();
    } catch (err) {
      setMessage(msg, `Error: ${err.message}`);
    }
  };
}

function initOccupancy() {
  const tripId = window.TRIP_ID;
  const meta = document.getElementById("occMeta");
  if (!meta || !tripId) return;

  const user = getUser();
  if (!user || !hasRole(user.role, COMPANY_OPERATIONS_ROLES)) {
    setMessage(meta, "Login with a company role first.");
    return;
  }

  (async () => {
    try {
      const response = await api(`/api/partners/trips/${tripId}/occupancy`);
      meta.textContent = `Departure: ${fmtDate(response.trip.departureAt)}`;

      if (document.getElementById("oTotal")) document.getElementById("oTotal").textContent = response.trip.totalSeats;
      if (document.getElementById("oBooked")) document.getElementById("oBooked").textContent = response.trip.bookedSeats;
      if (document.getElementById("oHeld")) document.getElementById("oHeld").textContent = response.trip.heldSeats;
      if (document.getElementById("oRemaining")) document.getElementById("oRemaining").textContent = response.trip.remainingSeats;

      const wrap = document.getElementById("seatsTaken");
      if (wrap) {
        wrap.innerHTML = (response.seatsTaken || []).length
          ? (response.seatsTaken || []).slice(0, 200).map((seat) => `<span class="pillSeat">${escapeHtml(seat)}</span>`).join("")
          : `<div class="muted">No booked seats yet.</div>`;
      }
    } catch (err) {
      setMessage(meta, `Error: ${err.message}`);
    }
  })();
}

function initManifest() {
  const tripId = window.TRIP_ID;
  const meta = document.getElementById("manMeta");
  const wrap = document.getElementById("manifest");
  const msg = document.getElementById("manMsg");
  if (!meta || !wrap || !msg || !tripId) return;

  const user = getUser();
  if (!user || !hasRole(user.role, COMPANY_OPERATIONS_ROLES)) {
    setMessage(meta, "Login with a company role first.");
    return;
  }

  (async () => {
    try {
      const response = await api(`/api/partners/trips/${tripId}/manifest`);
      meta.textContent = `Departure: ${fmtDate(response.trip.departureAt)}`;
      const bookings = response.bookings || [];

      wrap.innerHTML = bookings.length
        ? bookings.map((booking) => {
          const seats = (booking.seats || []).map((seat) => seat.seatId).join(", ");
          const userInfo = booking.userId || null;
          const guest = booking.guest || {};
          const name = userInfo ? userInfo.name : (guest.name || "Guest");
          const contact = userInfo ? (userInfo.email || userInfo.phone || "") : (guest.email || guest.phone || booking.guestLookupCode || "");
          return `
            <div class="cardItem">
              <h3>${escapeHtml(name)} - ${escapeHtml(String(booking.status || "").toUpperCase())}</h3>
              <div class="meta">${escapeHtml(contact)}</div>
              <div class="meta">Seats: ${escapeHtml(seats || "-")}</div>
              <div class="meta">${escapeHtml(fmtMoney(booking.currency, booking.amount))}</div>
            </div>
          `;
        }).join("")
        : `<div class="muted">No bookings yet.</div>`;
    } catch (err) {
      setMessage(msg, `Error: ${err.message}`);
    }
  })();
}

(function bootstrap() {
  captureReferral();
  applyNavVisibility();
  initRegisterRoleFields();
  initDashboardRedirect();
  initHomeTabs();
  initLogin();
  initRegister();
  initLogout();
  initSearch();
  initTrip();
  initMyBookings();
  initPartnerDashboard();
  initVehicleNew();
  initRouteNew();
  initTripNew();
  initOccupancy();
  initManifest();
})();
