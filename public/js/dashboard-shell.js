'use strict';
(function () {
  if (window.__classicTripDashboardShellReady) return;
  window.__classicTripDashboardShellReady = true;
  const body = document.body;
  const menuButton = document.getElementById('openMenu');
  const backdrop = document.getElementById('sideBackdrop');
  const themeButton = document.getElementById('btnTheme');
  const themeIcon = document.getElementById('themeIcon');
  const search = document.getElementById('sideSearch');
  const closeMenu = () => body.classList.remove('menu-open');
  menuButton?.addEventListener('click', () => body.classList.add('menu-open'));
  backdrop?.addEventListener('click', closeMenu);
  document.getElementById('sideNav')?.addEventListener('click', (event) => {
    if (event.target.closest('a.navBtn')) closeMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) closeMenu();
  }, { passive: true });
  function updateThemeIcon(theme) {
    if (themeIcon) themeIcon.className = theme === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
  }
  updateThemeIcon(document.documentElement.dataset.theme || 'dark');
  themeButton?.addEventListener('click', () => {
    const root = document.documentElement;
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'dark' ? '#070a12' : '#f8fafc');
    try { localStorage.setItem('classicTripTheme', next); } catch (_) { /* storage may be unavailable */ }
    updateThemeIcon(next);
  });
  search?.addEventListener('input', (event) => {
    const query = String(event.target.value || '').toLowerCase().trim();
    document.querySelectorAll('#sideNav .navBtn').forEach((button) => {
      button.style.display = button.textContent.toLowerCase().includes(query) ? 'flex' : 'none';
    });
  });
})();
