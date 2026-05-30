(function bootstrapClassicTripCore(global) {
  const API = String(global.API_BASE || global.location.origin || "").replace(/\/$/, "");
  const LS_TOKEN = "ct_access";
  const LS_USER = "ct_user";
  const PUBLIC_TENANT_CONTEXT = global.__PUBLIC_TENANT_CONTEXT__ || null;

  const ROLE_DASHBOARD_PATHS = {
    super_admin: "/platform/admin",
    admin: "/platform/admin",
    company_admin: "/tenant/company-admin",
    partner: "/tenant/company-admin",
    company_employee: "/tenant/company-employee",
    promoter: "/promoter-dashboard",
    customer: "/customer-dashboard"
  };

  const ROLES = {
    customer: ["customer", "promoter", "admin", "super_admin"],
    promoter: ["promoter", "admin", "super_admin"],
    companyAdmin: ["partner", "company_admin", "admin", "super_admin"],
    companyOperations: ["partner", "company_admin", "company_employee", "admin", "super_admin"],
    admin: ["admin", "super_admin"]
  };

  function getToken() {
    return global.localStorage.getItem(LS_TOKEN) || "";
  }

  function setToken(token) {
    if (token) global.localStorage.setItem(LS_TOKEN, token);
    else global.localStorage.removeItem(LS_TOKEN);
  }

  function getUser() {
    try {
      return JSON.parse(global.localStorage.getItem(LS_USER) || "null");
    } catch (_err) {
      return null;
    }
  }

  function setUser(user) {
    if (user) global.localStorage.setItem(LS_USER, JSON.stringify(user));
    else global.localStorage.removeItem(LS_USER);
  }

  function hasRole(role, allowed) {
    return Boolean(role && Array.isArray(allowed) && allowed.includes(role));
  }

  function dashboardPathForRole(role) {
    return ROLE_DASHBOARD_PATHS[role] || "/customer-dashboard";
  }

  function authHeaders() {
    const token = getToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const tenantSlug = String(PUBLIC_TENANT_CONTEXT?.tenantSlug || "").trim();
    if (tenantSlug) headers["x-tenant-slug"] = tenantSlug;
    return headers;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmtMoney(currency, amount) {
    return `${currency || "UGX"} ${Number(amount || 0).toLocaleString()}`;
  }

  function fmtDate(value) {
    if (!value) return "";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleString();
  }

  function setMessage(node, message) {
    if (node) node.textContent = message || "";
  }

  function captureReferral() {
    try {
      const params = new URLSearchParams(global.location.search);
      const ref = params.get("ref") || params.get("shareRef") || params.get("code");
      if (ref) global.localStorage.setItem("ct_ref", String(ref).trim());
    } catch (_err) {
      // ignore malformed query params
    }
  }

  function getReferral() {
    return global.localStorage.getItem("ct_ref") || "";
  }

  async function api(path, { method = "GET", headers = {}, body = null, isForm = false } = {}) {
    const options = {
      method,
      credentials: "same-origin",
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

    const response = await global.fetch(`${API}${path}`, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.message || `Request failed: ${response.status}`);
    }
    return data;
  }

  function updateDashboardLink(user) {
    const link = global.document.getElementById("navDashboardLink");
    if (!link) return;

    if (!user) {
      link.href = "/login";
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
    const role = user?.role || "";

    updateDashboardLink(user);

    global.document.querySelectorAll("[data-guest]").forEach((node) => {
      node.style.display = user ? "none" : "";
    });

    const account = global.document.getElementById("navAccount");
    if (account) {
      const label = user?.email || user?.phone || user?.name || "";
      account.textContent = user ? `${label} - ${role || "user"}` : "";
      account.style.display = user ? "" : "none";
    }

    global.document.querySelectorAll("[data-auth]").forEach((node) => {
      const need = node.getAttribute("data-auth");
      if (!user) {
        node.style.display = "none";
        return;
      }

      if (need === "any") {
        node.style.display = "";
        return;
      }

      if (need === "customer") node.style.display = hasRole(role, ROLES.customer) ? "" : "none";
      if (need === "promoter") node.style.display = hasRole(role, ROLES.promoter) ? "" : "none";
      if (need === "partner") node.style.display = hasRole(role, ROLES.companyAdmin) ? "" : "none";
      if (need === "employee") node.style.display = hasRole(role, ROLES.companyOperations) ? "" : "none";
      if (need === "admin") node.style.display = hasRole(role, ROLES.admin) ? "" : "none";
    });
  }

  function initLogout() {
    const button = global.document.getElementById("btnLogout");
    if (!button) return;

    button.addEventListener("click", async () => {
      try {
        await api("/api/public/auth/logout", { method: "POST" });
      } catch (_err) {
        // ignore logout failures while clearing local state
      }

      setToken("");
      setUser(null);
      applyNavVisibility();
      global.location.href = "/logout";
    });
  }

  function initDashboardRedirect() {
    if (global.document.body?.dataset.page !== "dashboard-redirect") return;
    const message = global.document.getElementById("dashboardRedirectMsg");
    const user = getUser();

    if (!user) {
      setMessage(message, "No active session found. Redirecting to login...");
      global.setTimeout(() => {
        global.location.href = "/login";
      }, 500);
      return;
    }

    setMessage(message, `Opening ${user.role || "user"} dashboard...`);
    global.setTimeout(() => {
      global.location.href = dashboardPathForRole(user.role);
    }, 250);
  }

  global.ClassicTrip = {
    API,
    LS_TOKEN,
    LS_USER,
    ROLES,
    api,
    applyNavVisibility,
    authHeaders,
    captureReferral,
    dashboardPathForRole,
    escapeHtml,
    fmtDate,
    fmtMoney,
    getReferral,
    getToken,
    getUser,
    PUBLIC_TENANT_CONTEXT,
    hasRole,
    setMessage,
    setToken,
    setUser
  };

  captureReferral();
  applyNavVisibility();
  initLogout();
  initDashboardRedirect();
})(window);
