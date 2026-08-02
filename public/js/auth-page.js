'use strict';

(() => {
  const html = document.documentElement;
  const themeBtn = document.getElementById('themeBtn');
  const themeIcon = document.getElementById('themeIcon');
  const drawer = document.getElementById('drawer');
  const successBox = document.getElementById('successBox');
  const toast = document.getElementById('toast');
  const roleInput = document.getElementById('roleInput');
  const googleSignupLink = document.getElementById('googleSignupLink');
  const panelTitle = document.getElementById('panelTitle');
  const panelSub = document.getElementById('panelSub');
  const panels = {
    login: document.getElementById('loginPanel'),
    signup: document.getElementById('signupPanel'),
    partner: document.getElementById('partnerPanel'),
    support: document.getElementById('supportPanel'),
    forgot: document.getElementById('forgotPanel'),
  };

  const panelCopy = Object.freeze({
    login: ['Welcome back', 'Login to manage bookings, saved trips, tickets and payments.'],
    signup: ['Create your account', 'Choose customer or promoter access. Staff and drivers use secure invitations.'],
    partner: ['Partner onboarding', 'Apply as a bus operator, stay partner, flight agent, boda rider, car driver or fleet owner.'],
    support: ['Support center', 'Get help with bookings, payments, refunds, receipts and partner accounts.'],
    forgot: ['Recover account', 'Get a reset link or OTP for your Classic Trip account.'],
  });

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    window.setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function setTheme(value) {
    const mode = value === 'light' ? 'light' : 'dark';
    html.setAttribute('data-theme', mode);
    try {
      localStorage.setItem('classicTripTheme', mode);
      localStorage.removeItem('ct-theme');
      localStorage.removeItem('ct_auth_theme');
    } catch (_) {
      // Storage can be unavailable in private or restricted browser contexts.
    }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'dark' ? '#070a12' : '#f8fafc');
    if (themeIcon) themeIcon.className = mode === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
  }

  function openPanel(value) {
    const name = panels[value] ? value : 'login';
    Object.entries(panels).forEach(([key, panel]) => {
      if (!panel) return;
      const active = key === name;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
      panel.setAttribute('aria-hidden', active ? 'false' : 'true');
      panel.toggleAttribute('inert', !active);
    });
    document.querySelectorAll('[data-open-panel]').forEach((button) => {
      const active = button.dataset.openPanel === name;
      button.classList.toggle('active', active);
      if (button.closest('.toggle')) button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    successBox?.classList.remove('show');
    if (panelTitle) panelTitle.textContent = panelCopy[name][0];
    if (panelSub) panelSub.textContent = panelCopy[name][1];
    try { history.replaceState(null, '', `#${name}`); } catch (_) { /* no-op */ }
    drawer?.classList.remove('open');
    drawer?.setAttribute('aria-hidden', 'true');
  }

  function updateGoogleSignupLink() {
    if (!roleInput || !googleSignupLink) return;
    const role = ['customer', 'promoter'].includes(roleInput.value) ? roleInput.value : 'customer';
    googleSignupLink.href = `/auth/google?${new URLSearchParams({ role }).toString()}`;
  }

  function setRole(value) {
    const role = value === 'promoter' ? 'promoter' : 'customer';
    document.querySelectorAll('.role').forEach((button) => button.classList.toggle('active', button.dataset.role === role));
    if (!roleInput) return;
    roleInput.value = role;
    const submit = document.querySelector('#signupForm .submit');
    if (submit) submit.innerHTML = `<i class="fa-solid fa-user-plus"></i>${role === 'promoter' ? 'Create promoter account' : 'Create customer account'}`;
    updateGoogleSignupLink();
  }

  let savedTheme = 'dark';
  try {
    savedTheme = localStorage.getItem('classicTripTheme') || localStorage.getItem('ct-theme') || localStorage.getItem('ct_auth_theme') || 'dark';
  } catch (_) {
    savedTheme = 'dark';
  }
  setTheme(savedTheme);

  themeBtn?.addEventListener('click', () => setTheme(html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));

  document.querySelectorAll('[data-open-panel]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      openPanel(button.dataset.openPanel);
      if (button.dataset.roleLink) setRole(button.dataset.roleLink);
    });
  });

  document.querySelectorAll('.role').forEach((button) => button.addEventListener('click', () => setRole(button.dataset.role)));
  updateGoogleSignupLink();

  document.querySelectorAll('.passwordToggle').forEach((button) => {
    button.addEventListener('click', () => {
      const input = button.parentElement?.querySelector('input');
      const icon = button.querySelector('i');
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
      if (icon) icon.className = input.type === 'password' ? 'fa-regular fa-eye' : 'fa-regular fa-eye-slash';
    });
  });

  document.querySelectorAll('form').forEach((form) => {
    form.addEventListener('submit', () => {
      const submitButton = form.querySelector('button[type="submit"]');
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.setAttribute('aria-disabled', 'true');
      }
      const messages = {
        signupForm: 'Creating your account...',
        supportForm: 'Sending your support request...',
        forgotForm: 'Sending your reset link...',
        partnerOnboardingForm: 'Submitting your partner application...',
      };
      const message = messages[form.id];
      if (!message) return;
      if (successBox) {
        successBox.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${message}`;
        successBox.classList.add('show');
      }
      showToast(message);
    });
  });

  document.getElementById('menuBtn')?.addEventListener('click', () => {
    drawer?.classList.add('open');
    drawer?.setAttribute('aria-hidden', 'false');
  });
  document.getElementById('closeDrawer')?.addEventListener('click', () => {
    drawer?.classList.remove('open');
    drawer?.setAttribute('aria-hidden', 'true');
  });
  drawer?.addEventListener('click', (event) => {
    if (event.target === drawer) {
      drawer.classList.remove('open');
      drawer.setAttribute('aria-hidden', 'true');
    }
  });

  const requestedRole = new URLSearchParams(window.location.search).get('role');
  const requestedPanel = window.location.hash.replace('#', '');
  if (['partner', 'company', 'company_admin'].includes(String(requestedRole || '').toLowerCase())) openPanel('partner');
  else if (Object.prototype.hasOwnProperty.call(panels, requestedPanel)) openPanel(requestedPanel);
  else openPanel('login');
})();
