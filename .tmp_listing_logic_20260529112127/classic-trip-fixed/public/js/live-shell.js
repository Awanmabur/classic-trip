(function classicTripShell(global) {
  const doc = global.document;
  if (!doc) return;

  const $ = (selector, root = doc) => root.querySelector(selector);
  const $$ = (selector, root = doc) => Array.from(root.querySelectorAll(selector));

  function setTheme(storageKey, iconId) {
    const root = doc.documentElement;
    const button = $("#btnTheme") || $("#themeBtn");
    const icon = iconId ? $(`#${iconId}`) : $("#themeIcon");
    const stored = global.localStorage.getItem(storageKey);
    const initial = stored === "light" ? "light" : "dark";

    function apply(mode) {
      root.setAttribute("data-theme", mode);
      global.localStorage.setItem(storageKey, mode);
      if (icon) {
        icon.className = mode === "dark" ? "fa-solid fa-moon" : "fa-solid fa-sun";
      }
    }

    apply(initial);
    if (button) {
      button.addEventListener("click", () => {
        apply(root.getAttribute("data-theme") === "dark" ? "light" : "dark");
      });
    }
  }

  function initAuthShell() {
    const loginPanel = $("#loginPanel");
    const signupPanel = $("#signupPanel");
    if (!loginPanel || !signupPanel) return false;

    const panels = {
      login: loginPanel,
      signup: signupPanel,
      partner: $("#partnerPanel"),
      support: $("#supportPanel"),
      forgot: $("#forgotPanel")
    };
    const successBox = $("#successBox");
    const drawer = $("#drawer");
    const panelTitle = $("#panelTitle");
    const panelSub = $("#panelSub");

    const panelCopy = {
      login: ["Welcome back", "Login to manage bookings, saved trips, tickets and payments."],
      signup: ["Create your account", "Choose customer, promoter, partner, or employee access."],
      partner: ["Partner access", "Register a company, promote services and prepare your partner dashboard."],
      support: ["Support center", "Get help with bookings, payments, refunds, receipts and partner accounts."],
      forgot: ["Recover account", "Get a reset link or OTP for your Classic Trip account."]
    };

    global.openPanel = function openPanel(name) {
      Object.entries(panels).forEach(([key, node]) => {
        if (node) node.classList.toggle("active", key === name);
      });
      $$("[data-open-panel]").forEach((node) => {
        node.classList.toggle("active", node.dataset.openPanel === name);
      });
      if (successBox) successBox.classList.remove("show");
      if (panelTitle) panelTitle.textContent = panelCopy[name]?.[0] || panelCopy.login[0];
      if (panelSub) panelSub.textContent = panelCopy[name]?.[1] || panelCopy.login[1];
      global.history.replaceState(null, "", `#${name}`);
      drawer?.classList.remove("open");
      drawer?.setAttribute("aria-hidden", "true");
    };

    global.setRole = function setRole(role) {
      $$(".role").forEach((node) => node.classList.toggle("active", node.dataset.role === role));
      const isPartnerFlow = role === "partner" || role === "employee";
      $$(".partnerOnly").forEach((node) => {
        node.style.display = isPartnerFlow ? "" : "none";
      });
      const submit = $("#signupForm .submit");
      const labels = {
        customer: "Create customer account",
        promoter: "Create promoter account",
        partner: "Create partner account",
        employee: "Create employee account"
      };
      if (submit) {
        submit.innerHTML = `<i class="fa-solid fa-user-plus"></i>${labels[role] || labels.customer}`;
      }
    };

    setTheme("ct_auth_theme", "themeIcon");

    $$(".passwordToggle").forEach((button) => {
      button.addEventListener("click", () => {
        const input = button.parentElement?.querySelector("input");
        if (!input) return;
        input.type = input.type === "password" ? "text" : "password";
        const icon = button.querySelector("i");
        if (icon) {
          icon.className = input.type === "password" ? "fa-regular fa-eye" : "fa-regular fa-eye-slash";
        }
      });
    });

    $$("[data-open-panel]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        global.openPanel(button.dataset.openPanel);
        if (button.dataset.roleLink) global.setRole(button.dataset.roleLink);
      });
    });

    $$(".role").forEach((button) => {
      button.addEventListener("click", () => global.setRole(button.dataset.role));
    });

    $("#menuBtn")?.addEventListener("click", () => {
      drawer?.classList.add("open");
      drawer?.setAttribute("aria-hidden", "false");
    });
    $("#closeDrawer")?.addEventListener("click", () => {
      drawer?.classList.remove("open");
      drawer?.setAttribute("aria-hidden", "true");
    });
    drawer?.addEventListener("click", (event) => {
      if (event.target === drawer) {
        drawer.classList.remove("open");
        drawer.setAttribute("aria-hidden", "true");
      }
    });

    global.setRole("customer");
    const startPanel = String(global.__AUTH_DEFAULT_PANEL__ || global.location.hash.replace(/^#/, "") || "login").trim();
    global.openPanel(panelCopy[startPanel] ? startPanel : "login");
    return true;
  }

  function initMarketplaceShell() {
    const searchTabs = $("#searchTabs");
    const drawer = $("#drawer");
    if (!searchTabs || !drawer) return false;

    setTheme("ct_theme", "themeIcon");

    function syncSearchFields(type) {
      const isHotel = type === "hotel";
      $("#cityField")?.classList.toggle("hide", !isHotel);
      $("#fromField")?.classList.toggle("hide", isHotel);
      $("#toField")?.classList.toggle("hide", isHotel);
    }

    function setActiveBottom(id) {
      $$("#bottomNav button[data-target]").forEach((button) => {
        button.classList.toggle("active", button.dataset.target === id);
      });
    }

    function activateLinkTarget(id) {
      $$("#navLinks a, .drawerLinks a").forEach((node) => {
        const target = String(node.getAttribute("href") || "").replace(/^#/, "");
        node.classList.toggle("active", target === id);
      });
      setActiveBottom(id);
    }

    $("#menuBtn")?.addEventListener("click", () => drawer.classList.add("open"));
    $("#closeDrawer")?.addEventListener("click", () => drawer.classList.remove("open"));
    drawer.addEventListener("click", (event) => {
      if (event.target === drawer) drawer.classList.remove("open");
    });

    searchTabs.addEventListener("click", (event) => {
      const button = event.target.closest(".tab");
      if (!button) return;
      $$(".tab", searchTabs).forEach((node) => node.classList.toggle("active", node === button));
      syncSearchFields(button.dataset.type || "bus");
    });
    syncSearchFields($("#searchTabs .tab.active")?.dataset.type || "bus");

    $$("#navLinks a, .drawerLinks a").forEach((link) => {
      link.addEventListener("click", (event) => {
        const href = String(link.getAttribute("href") || "");
        if (!href.startsWith("#")) return;
        event.preventDefault();
        const id = href.slice(1);
        global.scrollToSectionId?.(id);
        drawer.classList.remove("open");
        activateLinkTarget(id);
      });
    });

    $("#bottomNav")?.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.dataset.action === "menu") {
        drawer.classList.add("open");
        return;
      }
      const id = button.dataset.target || "home";
      global.scrollToSectionId?.(id);
      setActiveBottom(id);
    });

    return true;
  }

  function initDashboardShell() {
    if (!global.__DASHBOARD_TEMPLATE_ROLE__ || !$("#sideNav")) return false;

    const body = doc.body;
    const sideNav = $("#sideNav");
    const openMenu = $("#openMenu");
    const sideBackdrop = $("#sideBackdrop");
    const sideSearch = $("#sideSearch");

    setTheme("ct_dashboard_theme", "themeIcon");

    function closeMenu() {
      body.classList.remove("menu-open");
    }

    function openPage(page) {
      if (!page) return;
      $$(".section").forEach((section) => {
        section.classList.toggle("is-open", section.id === page);
      });
      $$(".navBtn").forEach((button) => {
        button.classList.toggle("is-active", button.dataset.page === page);
      });
      global.history.replaceState(null, "", `${global.location.pathname}${global.location.search}#${page}`);
      closeMenu();
      global.scrollTo({ top: 0, behavior: "auto" });
    }

    function activateTab(button) {
      const targetId = button.dataset.tabTarget;
      if (!targetId) return;
      const group = button.closest(".innerTabs");
      group?.querySelectorAll(".tabBtn").forEach((node) => {
        node.classList.toggle("is-on", node === button);
      });
      const container = group?.parentElement;
      $$(".tabPane", container || doc).forEach((pane) => {
        pane.classList.toggle("is-open", pane.id === targetId);
      });
    }

    global.ClassicTripShell = {
      ...(global.ClassicTripShell || {}),
      openDashboardPage: openPage,
      activateDashboardTab: activateTab
    };

    sideNav.addEventListener("click", (event) => {
      const button = event.target.closest(".navBtn");
      if (!button) return;
      openPage(button.dataset.page);
    });

    $$("[data-jump]").forEach((button) => {
      button.addEventListener("click", () => openPage(button.dataset.jump));
    });

    $$(".innerTabs .tabBtn").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        activateTab(button);
      });
    });

    sideSearch?.addEventListener("input", () => {
      const query = String(sideSearch.value || "").trim().toLowerCase();
      $$(".navBtn", sideNav).forEach((button) => {
        button.style.display = button.textContent.toLowerCase().includes(query) ? "flex" : "none";
      });
    });

    openMenu?.addEventListener("click", () => body.classList.add("menu-open"));
    sideBackdrop?.addEventListener("click", closeMenu);

    doc.addEventListener("click", (event) => {
      const close = event.target.closest("[data-close-modal]");
      if (close) {
        event.preventDefault();
        close.closest(".modal")?.classList.remove("is-open");
      }
      if (event.target.classList?.contains("modal")) {
        event.target.classList.remove("is-open");
      }
    });

    doc.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      closeMenu();
      $$(".modal.is-open").forEach((modal) => modal.classList.remove("is-open"));
    });

    const startPage = String(global.__DASHBOARD_START_PAGE__ || global.location.hash.replace(/^#/, "") || $(".navBtn.is-active")?.dataset.page || "overview").trim();
    openPage(startPage);
    return true;
  }

  initAuthShell() || initMarketplaceShell() || initDashboardShell();
})(window);
