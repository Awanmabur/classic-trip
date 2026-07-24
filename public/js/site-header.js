(() => {
  'use strict';

  const drawer = document.getElementById('siteDrawer');
  const menuButton = document.getElementById('siteMenuBtn');
  const themeIcon = document.getElementById('siteThemeIcon');

  function applyTheme(theme) {
    if (!['light', 'dark'].includes(theme)) return;
    document.documentElement.setAttribute('data-theme', theme);
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

  const initialTheme = savedTheme();
  if (initialTheme) applyTheme(initialTheme);
  setMenuButtonVisibility();
  window.addEventListener('resize', setMenuButtonVisibility, { passive: true });

  document.addEventListener('click', (event) => {
    const actionTarget = event.target.closest('[data-site-action]');
    if (event.target === drawer) drawer?.classList.remove('open');
    if (!actionTarget) return;

    const action = actionTarget.dataset.siteAction;
    if (action === 'theme') {
      const nextTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      applyTheme(nextTheme);
      persistTheme(nextTheme);
    } else if (action === 'drawer-toggle') {
      drawer?.classList.toggle('open');
    } else if (action === 'drawer-close') {
      drawer?.classList.remove('open');
    } else if (action === 'navigate') {
      const url = actionTarget.dataset.url;
      if (url?.startsWith('/')) window.location.assign(url);
    }
  });
})();
