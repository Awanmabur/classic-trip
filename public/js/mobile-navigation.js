(() => {
  'use strict';

  function initialiseMobileNavigation() {
    const bottomNav = document.querySelector('.bottomNav');
    const drawer = document.querySelector('.drawer');
    if (!bottomNav && !drawer) return;

    let lastY = Math.max(window.scrollY || 0, 0);
    let idleTimer = null;
    let ticking = false;

    function mobileNavigationEnabled() {
      return window.matchMedia('(max-width: 1050px)').matches;
    }

    function showBottomNav() {
      bottomNav?.classList.remove('is-scroll-hidden');
    }

    function hideBottomNav() {
      if (mobileNavigationEnabled()) bottomNav?.classList.add('is-scroll-hidden');
    }

    function scheduleIdleReveal() {
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        if (!document.body.classList.contains('site-drawer-open') && !document.body.classList.contains('site-input-active')) {
          showBottomNav();
        }
      }, 650);
    }

    function handleScrollFrame() {
      const currentY = Math.max(window.scrollY || 0, 0);
      const delta = currentY - lastY;

      if (!mobileNavigationEnabled() || currentY < 28) {
        showBottomNav();
      } else if (Math.abs(delta) >= 4) {
        hideBottomNav();
        scheduleIdleReveal();
      }

      lastY = currentY;
      ticking = false;
    }

    function handleScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(handleScrollFrame);
    }

    function syncDrawerState() {
      const open = Boolean(drawer?.classList.contains('open'));
      document.body.classList.toggle('site-drawer-open', open);
      if (open) hideBottomNav();
      else scheduleIdleReveal();
    }

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', () => {
      if (!mobileNavigationEnabled()) showBottomNav();
      syncDrawerState();
    }, { passive: true });

    document.addEventListener('focusin', (event) => {
      if (!mobileNavigationEnabled()) return;
      if (!event.target.matches('input, select, textarea, [contenteditable="true"]')) return;
      document.body.classList.add('site-input-active');
      hideBottomNav();
    });

    document.addEventListener('focusout', () => {
      window.setTimeout(() => {
        if (!document.activeElement?.matches('input, select, textarea, [contenteditable="true"]')) {
          document.body.classList.remove('site-input-active');
          scheduleIdleReveal();
        }
      }, 120);
    });

    if (drawer) {
      new MutationObserver(syncDrawerState).observe(drawer, { attributes: true, attributeFilter: ['class'] });
    }

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        lastY = Math.max(window.scrollY || 0, 0);
        showBottomNav();
        syncDrawerState();
      }
    });

    syncDrawerState();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialiseMobileNavigation, { once: true });
  else initialiseMobileNavigation();
})();
