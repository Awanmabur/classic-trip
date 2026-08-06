'use strict';
(function () {
  const warmed = new Set();
  const selector = 'a[href^="/listings/"]';
  function eligible(link) {
    if (!link || link.target === '_blank' || link.hasAttribute('download')) return '';
    try {
      const url = new URL(link.href, location.href);
      return url.origin === location.origin && /^\/listings\/[^/]+\/[^/]+/.test(url.pathname) ? url.href : '';
    } catch (_) { return ''; }
  }
  function warm(link) {
    const url = eligible(link);
    if (!url || warmed.has(url) || navigator.connection?.saveData) return;
    warmed.add(url);
    fetch(url, { method: 'GET', credentials: 'same-origin', cache: 'force-cache', priority: 'low', headers: { 'X-Classic-Trip-Prefetch': '1' } }).catch(() => warmed.delete(url));
  }
  document.addEventListener('pointerover', event => warm(event.target.closest(selector)), { passive: true });
  document.addEventListener('focusin', event => warm(event.target.closest(selector)));
  document.addEventListener('touchstart', event => warm(event.target.closest(selector)), { passive: true });
  const startVisibleWarmup = () => {
    const links = Array.from(document.querySelectorAll(selector)).slice(0, 8);
    if (!('IntersectionObserver' in window)) return links.slice(0, 2).forEach(warm);
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      warm(entry.target);
      observer.unobserve(entry.target);
    }), { rootMargin: '180px' });
    links.forEach(link => observer.observe(link));
  };
  if ('requestIdleCallback' in window) requestIdleCallback(startVisibleWarmup, { timeout: 1200 });
  else setTimeout(startVisibleWarmup, 500);
})();
