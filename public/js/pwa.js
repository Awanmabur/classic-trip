(() => {
  'use strict';

  const APP_NAME = 'Classic Trip';
  const APP_SLOGAN = 'Move, stay and fly with confidence.';
  const DISMISS_KEY = 'classicTripInstallDismissedAt';
  const SESSION_KEY = 'classicTripInstallSeen';
  const SPLASH_KEY = 'classicTripStandaloneSplashSeen';
  const DISMISS_FOR_MS = 7 * 24 * 60 * 60 * 1000;
  const silentPaths = ['/checkout', '/payment', '/tickets/', '/taxi/track', '/flights/order/'];

  let deferredInstallPrompt = null;
  let promptElement = null;

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function isIos() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent || '');
  }

  function isSecureInstallContext() {
    return window.isSecureContext || ['localhost', '127.0.0.1'].includes(window.location.hostname);
  }

  function recentlyDismissed() {
    try {
      const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
      return dismissedAt > 0 && Date.now() - dismissedAt < DISMISS_FOR_MS;
    } catch (_) {
      return false;
    }
  }

  function rememberDismissal() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (_) { /* Storage may be unavailable. */ }
  }

  function safeSessionGet(key) {
    try { return sessionStorage.getItem(key); } catch (_) { return null; }
  }

  function safeSessionSet(key, value) {
    try { sessionStorage.setItem(key, value); } catch (_) { /* Storage may be unavailable. */ }
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !isSecureInstallContext()) return;
    try {
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    } catch (error) {
      if (window.location.hostname === 'localhost') console.warn('Classic Trip service worker registration failed:', error.message);
    }
  }

  function showStandaloneSplash() {
    if (!isStandalone() || safeSessionGet(SPLASH_KEY) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    safeSessionSet(SPLASH_KEY, '1');

    const splash = document.createElement('div');
    splash.className = 'pwaLaunchSplash';
    splash.setAttribute('aria-hidden', 'true');
    splash.innerHTML = `
      <div class="pwaLaunchBrand">
        <img src="/images/logo-symbol-192.png" alt="">
        <strong>${APP_NAME}</strong>
        <span>${APP_SLOGAN}</span>
      </div>`;
    document.body.appendChild(splash);
    requestAnimationFrame(() => splash.classList.add('is-visible'));
    window.setTimeout(() => {
      splash.classList.remove('is-visible');
      window.setTimeout(() => splash.remove(), 240);
    }, 620);
  }

  function promptCopy() {
    if (isIos()) return 'Install Classic Trip from Safari: tap Share, then choose Add to Home Screen.';
    if (deferredInstallPrompt) return 'Install once for faster access to bookings, tickets, stays, flights and local rides.';
    return 'Use your browser menu and choose Install Classic Trip or Add to Home Screen.';
  }

  function removePrompt() {
    promptElement?.classList.remove('is-visible');
    window.setTimeout(() => promptElement?.remove(), 220);
    promptElement = null;
  }

  function createPrompt({ force = false } = {}) {
    if (isStandalone()) return null;
    if (!force && (recentlyDismissed() || safeSessionGet(SESSION_KEY))) return null;
    if (silentPaths.some((prefix) => window.location.pathname.startsWith(prefix))) return null;
    if (!deferredInstallPrompt && !isIos() && !force) return null;
    if (promptElement) return promptElement;

    safeSessionSet(SESSION_KEY, '1');
    const element = document.createElement('aside');
    element.className = 'pwaInstallPrompt';
    element.setAttribute('role', 'dialog');
    element.setAttribute('aria-label', 'Install Classic Trip');
    element.innerHTML = `
      <button type="button" class="pwaInstallClose" aria-label="Close install prompt"><i class="fa-solid fa-xmark"></i></button>
      <div class="pwaInstallIdentity">
        <span class="pwaInstallLogo"><img src="/images/logo-symbol-192.png" alt="Classic Trip logo"></span>
        <span class="pwaInstallCopy"><strong>${APP_NAME}</strong><b>${APP_SLOGAN}</b><small data-pwa-install-detail>${promptCopy()}</small></span>
      </div>
      <div class="pwaInstallActions">
        <button type="button" class="btn btnPrimary" data-pwa-install><i class="fa-solid fa-download"></i> Install app</button>
        <button type="button" class="btn btnGhost" data-pwa-dismiss>Not now</button>
      </div>`;

    const close = () => {
      rememberDismissal();
      removePrompt();
    };

    element.querySelector('.pwaInstallClose')?.addEventListener('click', close);
    element.querySelector('[data-pwa-dismiss]')?.addEventListener('click', close);
    element.querySelector('[data-pwa-install]')?.addEventListener('click', async () => {
      const detail = element.querySelector('[data-pwa-install-detail]');
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
        if (choice.outcome === 'accepted') removePrompt();
        else if (detail) detail.textContent = 'Installation was not completed. You can install later from the profile menu.';
        deferredInstallPrompt = null;
        return;
      }
      if (detail) detail.textContent = promptCopy();
      element.classList.add('show-instructions');
    });

    document.body.appendChild(element);
    promptElement = element;
    requestAnimationFrame(() => element.classList.add('is-visible'));
    return element;
  }

  function addDrawerInstallAction() {
    if (isStandalone() || document.querySelector('[data-open-install-prompt]')) return;
    const drawerPanel = document.querySelector('.drawerPanel');
    if (!drawerPanel) return;

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'btn btnGhost pwaDrawerInstallAction';
    action.dataset.openInstallPrompt = 'true';
    action.innerHTML = '<i class="fa-solid fa-download"></i> Install Classic Trip';
    action.addEventListener('click', () => createPrompt({ force: true }));

    const finalActions = drawerPanel.querySelector('.drawerFinalActions');
    if (finalActions) finalActions.prepend(action);
    else drawerPanel.appendChild(action);
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    window.setTimeout(() => createPrompt(), 900);
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    try { localStorage.removeItem(DISMISS_KEY); } catch (_) { /* Storage may be unavailable. */ }
    removePrompt();
  });

  window.ClassicTripPWA = {
    openInstallPrompt: () => createPrompt({ force: true }),
    isStandalone,
  };

  function initialise() {
    registerServiceWorker();
    showStandaloneSplash();
    addDrawerInstallAction();
    if (isIos()) window.setTimeout(() => createPrompt(), 1200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialise, { once: true });
  else initialise();
})();
