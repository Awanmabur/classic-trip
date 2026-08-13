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
// personalized HTML globally; it only lets the authenticated server build its
// page-scoped snapshot/projection ahead of the click.
(function dashboardNavigationWarmup() {
  const nav = document.getElementById('sideNav');
  if (!nav || navigator.connection?.saveData) return;
  const warmed = new Set();
  const inflight = new Set();
  function eligible(link) {
    if (!link || link.target === '_blank' || link.hasAttribute('download')) return '';
    try {
      const url = new URL(link.href, location.href);
      if (url.origin !== location.origin || url.href === location.href) return '';
      if (!/^\/(admin|company|account|employee|driver|promoter|support|finance|operations|content)(\/|$)/.test(url.pathname)) return '';
      return url.href;
    } catch (_) { return ''; }
  }
  function warm(link) {
    const url = eligible(link);
    if (!url || warmed.has(url) || inflight.has(url)) return;
    inflight.add(url);
    fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      priority: 'low',
      headers: { 'X-Classic-Trip-Prefetch': '1' },
    }).then((response) => {
      if (response.ok) warmed.add(url);
    }).catch(() => {}).finally(() => inflight.delete(url));
  }
  nav.addEventListener('pointerover', (event) => warm(event.target.closest('a.navBtn')), { passive: true });
  nav.addEventListener('focusin', (event) => warm(event.target.closest('a.navBtn')));
  nav.addEventListener('touchstart', (event) => warm(event.target.closest('a.navBtn')), { passive: true });
  const idleWarm = () => {
    const links = Array.from(nav.querySelectorAll('a.navBtn:not(.active)')).slice(0, 2);
    links.forEach((link, index) => setTimeout(() => warm(link), index * 250));
  };
  if ('requestIdleCallback' in window) requestIdleCallback(idleWarm, { timeout: 1800 });
  else setTimeout(idleWarm, 900);
})();
