(function liveAuth(global) {
  const ct = global.ClassicTrip;
  if (!ct) return;
  const tenantContext = ct.PUBLIC_TENANT_CONTEXT || null;

  const successBox = document.getElementById("successBox");
  const toastEl = document.getElementById("toast");
  const inviteToken = String(global.__PARTNER_INVITE_TOKEN__ || "").trim();
  let inviteDetails = null;

  function applyBrandTheme() {
    if (!tenantContext?.tenantScoped) return;
    const root = global.document.documentElement;
    if (tenantContext.primaryColor) root.style.setProperty("--primary", tenantContext.primaryColor);
    if (tenantContext.accentColor) root.style.setProperty("--accent", tenantContext.accentColor);
    if (tenantContext.hotColor) root.style.setProperty("--hot", tenantContext.hotColor);
  }

  function applyTenantAuthBranding() {
    if (!tenantContext?.tenantScoped) return;

    const brandName = tenantContext.displayName || "Classic Trip";
    const shortName = tenantContext.shortName || "CT";
    const authTitle = tenantContext.authTitle || `${brandName} account access`;
    const authSubtitle = tenantContext.authSubtitle || `Access ${brandName} services and customer support.`;
    const supportLabel = tenantContext.supportPhone || tenantContext.supportEmail || "Live tenant support";
    const supportHeadline = tenantContext.supportHeadline || `Get help from ${brandName}`;
    const supportBlurb = tenantContext.supportBlurb || `Contact ${brandName} for booking help, payment support, and ticket recovery.`;

    global.document.title = `${brandName} | Login, Signup & Support`;
    global.document.querySelector('meta[name="description"]')?.setAttribute("content", authSubtitle);
    global.document.querySelectorAll(".brand span:last-child").forEach((node) => {
      node.textContent = brandName;
    });
    global.document.querySelectorAll(".mark").forEach((node) => {
      node.textContent = shortName;
    });
    const eyebrow = global.document.querySelector(".eyebrow");
    if (eyebrow) eyebrow.textContent = `${brandName} account access`;
    const heroTitle = global.document.querySelector(".heroText h1");
    if (heroTitle) heroTitle.textContent = authTitle;
    const heroSub = global.document.querySelector(".heroText p");
    if (heroSub) heroSub.textContent = authSubtitle;
    const tipNotice = global.document.querySelector(".notice strong");
    if (tipNotice?.parentElement) {
      tipNotice.parentElement.innerHTML = `<strong>${ct.escapeHtml(supportHeadline)}:</strong> ${ct.escapeHtml(supportBlurb)} Contact ${ct.escapeHtml(supportLabel)} if you need help.`;
    }
    const partnerHeading = global.document.querySelector("#partnerPanel h2");
    if (partnerHeading) partnerHeading.textContent = `Work with ${brandName}`;
    global.document.querySelectorAll(".supportTile span").forEach((node, index) => {
      if (index === 0) node.textContent = tenantContext.supportEmail || supportBlurb;
      if (index === 1) node.textContent = tenantContext.supportPhone || supportLabel;
      if (index === 2) node.textContent = supportHeadline;
    });
  }

  function toast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add("show");
    global.setTimeout(() => toastEl.classList.remove("show"), 2400);
  }

  function setSuccess(message, ok) {
    if (!successBox) return;
    successBox.innerHTML = `<i class="fa-solid ${ok ? "fa-circle-check" : "fa-circle-exclamation"}"></i> ${ct.escapeHtml(message)}`;
    successBox.classList.toggle("show", Boolean(message));
    successBox.style.borderColor = ok ? "rgba(34,197,94,.24)" : "rgba(239,68,68,.28)";
    successBox.style.background = ok ? "rgba(34,197,94,.10)" : "rgba(239,68,68,.12)";
    successBox.style.color = ok ? "#22c55e" : "#ff9494";
  }

  function ensureField(form, id, labelText, placeholder) {
    let wrap = form.querySelector(`#${id}`)?.closest(".field");
    if (wrap) return wrap;

    wrap = document.createElement("div");
    wrap.className = "field employeeOnly";
    wrap.style.display = "none";
    wrap.innerHTML = `
      <label>${labelText}</label>
      <div class="control">
        <i class="fa-regular fa-envelope"></i>
        <input id="${id}" name="${id}" type="email" placeholder="${placeholder}">
      </div>
    `;
    const passwordRow = form.querySelector(".row2:last-of-type");
    if (passwordRow && passwordRow.parentNode) {
      passwordRow.parentNode.insertBefore(wrap, passwordRow);
    } else {
      form.appendChild(wrap);
    }
    return wrap;
  }

  function ensureMessageNode(form, id) {
    let node = document.getElementById(id);
    if (node) return node;
    node = document.createElement("div");
    node.id = id;
    node.className = "notice";
    node.style.display = "none";
    form.parentNode.appendChild(node);
    return node;
  }

  function setMessage(node, message, ok) {
    if (!node) return;
    node.style.display = message ? "block" : "none";
    node.style.borderColor = ok ? "rgba(34,197,94,.24)" : "rgba(79,140,255,.22)";
    node.style.background = ok ? "rgba(34,197,94,.10)" : "rgba(79,140,255,.09)";
    node.style.color = ok ? "#c8ffd8" : "";
    node.textContent = message || "";
  }

  function setReadonlyField(field, value, readOnly = true) {
    if (!field) return;
    field.value = value || "";
    field.readOnly = readOnly;
    field.disabled = field.tagName === "SELECT" ? readOnly : false;
  }

  function splitName(fullName) {
    const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
    return {
      firstName: parts[0] || "",
      lastName: parts.slice(1).join(" ")
    };
  }

  function activeRole() {
    return document.querySelector(".role.active")?.dataset.role || "customer";
  }

  function syncSignupRole() {
    const form = document.getElementById("signupForm");
    if (!form) return;

    let hiddenRole = form.querySelector('input[name="role"]');
    if (!hiddenRole) {
      hiddenRole = document.createElement("input");
      hiddenRole.type = "hidden";
      hiddenRole.name = "role";
      form.appendChild(hiddenRole);
    }

    const employeeField = ensureField(
      form,
      "companyEmail",
      "Company admin email",
      "company-admin@classictrip.com"
    );

    if (form.dataset.inviteMode === "true") {
      hiddenRole.value = "company_admin";
      employeeField.style.display = "none";
      const employeeInput = employeeField.querySelector("input");
      if (employeeInput) {
        employeeInput.required = false;
        employeeInput.value = "";
      }
      return;
    }

    const role = activeRole();

    hiddenRole.value = role === "employee" ? "employee" : role;
    employeeField.style.display = role === "employee" ? "" : "none";
    const input = employeeField.querySelector("input");
    if (input) {
      input.required = role === "employee";
      if (role !== "employee") input.value = "";
    }
  }

  function redirectAfterAuth(user) {
    global.location.href = ct.dashboardPathForRole(user?.role);
  }

  function bindLogin() {
    const form = document.getElementById("loginForm");
    if (!form) return;
    const message = ensureMessageNode(form, "loginMsg");

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      setSuccess("", true);
      setMessage(message, "Signing in...", false);

      const body = Object.fromEntries(new FormData(form).entries());

      try {
        const response = await ct.api("/api/public/auth/login", {
          method: "POST",
          body: {
            identity: String(body.identity || "").trim(),
            password: body.password
          }
        });

        ct.setToken(response.accessToken);
        ct.setUser(response.user);
        setMessage(message, "Login successful. Redirecting...", true);
        setSuccess("Account access confirmed.", true);
        toast("Login successful");
        global.setTimeout(() => redirectAfterAuth(response.user), 450);
      } catch (err) {
        setMessage(message, err.message, false);
        setSuccess(err.message, false);
      }
    }, true);
  }

  function bindSignup() {
    const form = document.getElementById("signupForm");
    if (!form) return;
    const message = ensureMessageNode(form, "signupMsg");
    syncSignupRole();

    document.querySelectorAll(".role").forEach((button) => {
      button.addEventListener("click", () => {
        global.setTimeout(syncSignupRole, 0);
      });
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      setSuccess("", true);
      setMessage(message, "Creating your account...", false);

      const body = Object.fromEntries(new FormData(form).entries());
      if (String(body.password || "") !== String(body.confirmPassword || "")) {
        setMessage(message, "Passwords do not match.", false);
        setSuccess("Passwords do not match.", false);
        return;
      }

      try {
        const endpoint = inviteToken
          ? `/api/public/invitations/${encodeURIComponent(inviteToken)}/accept`
          : "/api/public/auth/register";
        const payload = inviteToken
          ? {
              firstName: body.firstName,
              lastName: body.lastName,
              phone: body.phone,
              password: body.password,
              company: body.company || "",
              businessType: body.businessType || "",
              country: body.country || ""
            }
          : {
              firstName: body.firstName,
              lastName: body.lastName,
              email: body.email,
              phone: body.phone,
              password: body.password,
              role: body.role || activeRole(),
              companyEmail: body.companyEmail || "",
              company: body.company || "",
              businessType: body.businessType || "",
              country: body.country || ""
            };

        const response = await ct.api(endpoint, {
          method: "POST",
          body: payload
        });

        ct.setToken(response.accessToken);
        ct.setUser(response.user);
        setMessage(message, inviteToken ? "Invite accepted. Redirecting..." : "Account created. Redirecting...", true);
        setSuccess(inviteToken ? "Partner invite accepted successfully." : "Account created successfully.", true);
        toast(inviteToken ? "Invite accepted" : "Account created");
        global.setTimeout(() => redirectAfterAuth(response.user), 500);
      } catch (err) {
        setMessage(message, err.message, false);
        setSuccess(err.message, false);
      }
    }, true);
  }

  function bindInviteAcceptance() {
    if (!inviteToken) return;

    const form = document.getElementById("signupForm");
    const message = document.getElementById("signupMsg") || ensureMessageNode(form, "signupMsg");
    if (!form || !message) return;

    form.dataset.inviteMode = "true";
    if (typeof global.openPanel === "function") global.openPanel("signup");
    if (typeof global.setRole === "function") global.setRole("partner");

    const roleGrid = document.querySelector(".roleGrid");
    if (roleGrid) roleGrid.style.display = "none";

    const intro = document.createElement("div");
    intro.className = "notice";
    intro.id = "inviteNotice";
    form.parentNode.insertBefore(intro, form);

    const companyField = form.querySelector('input[name="company"]');
    const businessField = form.querySelector('select[name="businessType"]');
    const countryField = form.querySelector('select[name="country"]');
    const emailField = form.querySelector('input[name="email"]');
    const phoneField = form.querySelector('input[name="phone"]');
    const firstNameField = form.querySelector('input[name="firstName"]');
    const lastNameField = form.querySelector('input[name="lastName"]');
    const submit = form.querySelector(".submit");

    if (submit) {
      submit.innerHTML = '<i class="fa-solid fa-user-plus"></i>Accept invite and create account';
    }

    setMessage(message, "Loading invite details...", false);

    ct.api(`/api/public/invitations/${encodeURIComponent(inviteToken)}`)
      .then((response) => {
        inviteDetails = response.invite || null;
        if (!inviteDetails) throw new Error("Invite details are unavailable");

        const names = splitName(inviteDetails.contactName);
        const isStaffInvite = inviteDetails.role === "company_employee" || inviteDetails.inviteKind === "staff";
        if (typeof global.openPanel === "function") global.openPanel("signup");
        if (typeof global.setRole === "function") global.setRole(isStaffInvite ? "employee" : "partner");

        if (companyField) {
          companyField.closest(".partnerOnly")?.style.setProperty("display", "");
          setReadonlyField(companyField, inviteDetails.companyName, true);
        }
        if (businessField) {
          businessField.closest(".partnerOnly")?.style.setProperty("display", "");
          setReadonlyField(businessField, inviteDetails.businessType, true);
        }
        if (countryField) {
          countryField.closest(".partnerOnly")?.style.setProperty("display", "");
          setReadonlyField(countryField, inviteDetails.country, true);
        }
        if (emailField) setReadonlyField(emailField, inviteDetails.email, true);
        if (phoneField && !phoneField.value) phoneField.value = inviteDetails.phone || "";
        if (firstNameField && !firstNameField.value) firstNameField.value = inviteDetails.firstName || names.firstName;
        if (lastNameField && !lastNameField.value) lastNameField.value = inviteDetails.lastName || names.lastName;

        intro.innerHTML = isStaffInvite
          ? `You are joining <strong>${ct.escapeHtml(inviteDetails.companyName || "this company")}</strong> as <strong>${ct.escapeHtml(inviteDetails.jobTitle || "company staff")}</strong>. This invite expires on <strong>${ct.escapeHtml(ct.fmtDate(inviteDetails.expiresAt))}</strong>.`
          : `You are setting up <strong>${ct.escapeHtml(inviteDetails.companyName || "partner company")}</strong> as a company admin account. This invite expires on <strong>${ct.escapeHtml(ct.fmtDate(inviteDetails.expiresAt))}</strong>.`;
        setMessage(message, "Invite loaded. Complete your password to finish onboarding.", true);
        setSuccess(isStaffInvite ? "Staff invite ready for onboarding." : "Platform invite ready for onboarding.", true);
      })
      .catch((err) => {
        intro.innerHTML = `This invite is unavailable: <strong>${ct.escapeHtml(err.message)}</strong>`;
        setMessage(message, err.message, false);
        setSuccess(err.message, false);
        form.querySelectorAll("input, select, button").forEach((node) => {
          if (node.type !== "button") node.disabled = true;
        });
      })
      .finally(syncSignupRole);
  }

  function bindPartnerInquiry() {
    const form = document.getElementById("partnerForm");
    if (!form) return;
    const message = ensureMessageNode(form, "partnerMsg");

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      setMessage(message, "Sending partner request...", false);

      const fields = form.querySelectorAll("input, select");
      const values = Array.from(fields).map((field) => String(field.value || "").trim());

      try {
        const response = await ct.api("/api/public/partner-inquiries", {
          method: "POST",
          body: {
            companyName: values[0] || "",
            businessType: values[1] || "",
            country: values[2] || "",
            contactName: values[3] || "",
            email: values[4] || "",
            phone: values[5] || ""
          }
        });

        form.reset();
        setMessage(message, response.message, true);
        setSuccess(response.message, true);
        toast("Partner request sent");
      } catch (err) {
        setMessage(message, err.message, false);
        setSuccess(err.message, false);
      }
    }, true);
  }

  function bindSupport() {
    const form = document.getElementById("supportForm");
    if (!form) return;
    const message = ensureMessageNode(form, "supportMsg");

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      setMessage(message, "Sending support request...", false);

      const fields = form.querySelectorAll("input, select");
      const values = Array.from(fields).map((field) => String(field.value || "").trim());

      try {
        const response = await ct.api("/api/public/support-requests", {
          method: "POST",
          body: {
            name: values[0] || "",
            contact: values[1] || "",
            topic: values[2] || "",
            bookingReference: values[3] || "",
            message: values[4] || ""
          }
        });

        form.reset();
        setMessage(message, response.message, true);
        setSuccess(response.message, true);
        toast("Support request sent");
      } catch (err) {
        setMessage(message, err.message, false);
        setSuccess(err.message, false);
      }
    }, true);
  }

  function bindRecovery() {
    const form = document.getElementById("forgotForm");
    if (!form) return;
    const message = ensureMessageNode(form, "forgotMsg");

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      setMessage(message, "Submitting recovery request...", false);

      const field = form.querySelector('input[name="identity"], input[type="text"]');
      const identity = String(field?.value || "").trim();

      try {
        const response = await ct.api("/api/public/recovery-requests", {
          method: "POST",
          body: { identity }
        });
        form.reset();
        setMessage(message, response.message, true);
        setSuccess(response.message, true);
        toast("Recovery request saved");
      } catch (err) {
        setMessage(message, err.message, false);
        setSuccess(err.message, false);
      }
    }, true);
  }

  ct.captureReferral();
  applyBrandTheme();
  applyTenantAuthBranding();
  bindLogin();
  bindSignup();
  bindInviteAcceptance();
  bindPartnerInquiry();
  bindSupport();
  bindRecovery();
})(window);
