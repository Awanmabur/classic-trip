(() => {
  'use strict';

  const drawer = document.getElementById('siteDrawer');
  const menuButton = document.getElementById('siteMenuBtn');
  const themeIcon = document.getElementById('siteThemeIcon');

  function applyTheme(theme) {
    if (!['light', 'dark'].includes(theme)) return;
    document.documentElement.setAttribute('data-theme', theme);
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute('content', theme === 'dark' ? '#070a12' : '#f8fafc');
    if (themeIcon) themeIcon.className = theme === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
  }

  function savedTheme() {
    try { return localStorage.getItem('classicTripTheme') || localStorage.getItem('ct-theme') || localStorage.getItem('ct_auth_theme'); } catch { return null; }
  }

  function persistTheme(theme) {
    try { localStorage.setItem('classicTripTheme', theme); localStorage.removeItem('ct-theme'); localStorage.removeItem('ct_auth_theme'); } catch { /* Storage can be unavailable. */ }
  }

  function setMenuButtonVisibility() {
    if (menuButton) menuButton.style.display = window.innerWidth < 1051 ? '' : 'none';
  }

  function drawerFocusable() {
    if (!drawer) return [];
    return Array.from(drawer.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'))
      .filter((node) => node.getClientRects().length > 0);
  }

  function setDrawerOpen(open, { restoreFocus = false } = {}) {
    if (!drawer) return;
    drawer.classList.toggle('open', open);
    drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
    menuButton?.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.body.classList.toggle('siteDrawerOpen', open);
    if (open) window.requestAnimationFrame(() => drawerFocusable()[0]?.focus());
    else if (restoreFocus) menuButton?.focus();
  }

  const initialTheme = savedTheme() || 'dark';
  applyTheme(initialTheme);
  setMenuButtonVisibility();
  window.addEventListener('resize', setMenuButtonVisibility, { passive: true });

  document.addEventListener('click', (event) => {
    const actionTarget = event.target.closest('[data-site-action]');
    if (event.target === drawer) setDrawerOpen(false, { restoreFocus: true });
    if (!actionTarget) return;

    const action = actionTarget.dataset.siteAction;
    if (action === 'theme') {
      const nextTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      applyTheme(nextTheme);
      persistTheme(nextTheme);
    } else if (action === 'drawer-toggle') {
      setDrawerOpen(!drawer?.classList.contains('open'));
    } else if (action === 'drawer-close') {
      setDrawerOpen(false, { restoreFocus: true });
    } else if (action === 'navigate') {
      const url = actionTarget.dataset.url;
      if (url?.startsWith('/')) window.location.assign(url);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (!drawer?.classList.contains('open')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setDrawerOpen(false, { restoreFocus: true });
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = drawerFocusable();
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
})();
