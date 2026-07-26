(() => {
  'use strict';

  const APP_NAME = 'Classic Trip';
  const APP_SLOGAN = 'Move, stay and fly with confidence.';
  const DISMISS_KEY = 'classicTripInstallDismissedAt';
  const SPLASH_KEY = 'classicTripStandaloneSplashSeen';
  const DISMISS_FOR_MS = 24 * 60 * 60 * 1000;
  const AUTO_PROMPT_DELAY_MS = 1400;
  const SPLASH_DURATION_MS = 2200;
  const SPLASH_FADE_MS = 280;
  const APP_ORIENTATION = 'portrait-primary';
  const silentPaths = ['/checkout', '/payment', '/tickets/', '/taxi/track', '/flights/order/'];

  let deferredInstallPrompt = null;
  let promptElement = null;
  let serviceWorkerReady = false;

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }


  async function keepInstalledAppPortrait() {
    if (!isStandalone()) return false;
    const orientation = window.screen && window.screen.orientation;
    if (!orientation || typeof orientation.lock !== 'function') return false;

    try {
      await orientation.lock(APP_ORIENTATION);
      return true;
    } catch (_) {
      // Some browsers rely only on the web-app manifest or the phone's system rotation lock.
      return false;
    }
  }

  function isIos() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent || '');
  }

  function isAndroid() {
    return /android/i.test(window.navigator.userAgent || '');
  }

  function isMobile() {
    return isIos() || isAndroid() || window.matchMedia('(max-width: 760px)').matches;
  }

  function isSecureInstallContext() {
    return window.isSecureContext || ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
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

  function clearDismissal() {
    try { localStorage.removeItem(DISMISS_KEY); } catch (_) { /* Storage may be unavailable. */ }
  }

  function safeSessionGet(key) {
    try { return sessionStorage.getItem(key); } catch (_) { return null; }
  }

  function safeSessionSet(key, value) {
    try { sessionStorage.setItem(key, value); } catch (_) { /* Storage may be unavailable. */ }
  }

  function installState() {
    if (isStandalone()) return 'installed';
    if (!isSecureInstallContext()) return 'insecure';
    if (deferredInstallPrompt) return 'native-ready';
    if (isIos()) return 'ios-manual';
    if (isAndroid()) return serviceWorkerReady ? 'android-manual' : 'preparing';
    return serviceWorkerReady ? 'desktop-manual' : 'preparing';
  }

  function copyForState(state) {
    if (state === 'native-ready') return 'Install once for faster access to bookings, tickets, stays, flights and local rides.';
    if (state === 'ios-manual') return 'In Safari, tap Share, then choose Add to Home Screen.';
    if (state === 'android-manual') return 'Open the browser menu, then choose Install app or Add to Home screen.';
    if (state === 'desktop-manual') return 'Open your browser menu and choose Install Classic Trip.';
    if (state === 'insecure') return `Installation is blocked on ${window.location.protocol}//${window.location.host}. Open Classic Trip through HTTPS to install it on this phone.`;
    return 'Preparing the secure app installer…';
  }

  function buttonCopyForState(state) {
    if (state === 'native-ready') return '<i class="fa-solid fa-download"></i> Install app';
    if (state === 'insecure') return '<i class="fa-solid fa-lock"></i> HTTPS required';
    if (state === 'preparing') return '<i class="fa-solid fa-spinner fa-spin"></i> Preparing';
    return '<i class="fa-solid fa-mobile-screen-button"></i> Show steps';
  }

  function instructionMarkup(state) {
    if (state === 'ios-manual') {
      return '<ol><li>Open this page in Safari.</li><li>Tap the Share button.</li><li>Choose <strong>Add to Home Screen</strong>.</li><li>Tap <strong>Add</strong>.</li></ol>';
    }
    if (state === 'android-manual') {
      return '<ol><li>Open the browser menu (⋮).</li><li>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li><li>Confirm <strong>Install</strong>.</li></ol>';
    }
    if (state === 'desktop-manual') {
      return '<ol><li>Open the browser menu.</li><li>Choose <strong>Install Classic Trip</strong> or <strong>Install app</strong>.</li><li>Confirm installation.</li></ol>';
    }
    if (state === 'insecure') {
      return '<p>Phone browsers do not allow app installation from a normal local-network HTTP address. Use your HTTPS production domain or a trusted HTTPS development tunnel, then reopen this page.</p>';
    }
    return '<p>The browser is preparing the installer. Keep this page open for a moment, or use the browser menu if an install option is already available.</p>';
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !isSecureInstallContext()) return false;
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
      await registration.update().catch(() => {});
      await navigator.serviceWorker.ready;
      serviceWorkerReady = true;
      updatePrompt();
      return true;
    } catch (error) {
      serviceWorkerReady = false;
      updatePrompt('Service worker registration failed. Reload once, then use the browser menu to install.');
      if (window.location.hostname === 'localhost') console.warn('Classic Trip service worker registration failed:', error.message);
      return false;
    }
  }

  function showStandaloneSplash() {
    if (!isStandalone() || safeSessionGet(SPLASH_KEY) || document.getElementById('classicTripLaunchSplash')) return;
    safeSessionSet(SPLASH_KEY, '1');

    const splash = document.createElement('div');
    splash.id = 'classicTripLaunchSplash';
    splash.className = 'pwaLaunchSplash';
    splash.setAttribute('role', 'status');
    splash.setAttribute('aria-label', `${APP_NAME}. ${APP_SLOGAN}`);
    splash.innerHTML = `
      <div class="pwaLaunchBrand">
        <img src="/images/logo-maskable-512.png" alt="Classic Trip logo">
        <strong>${APP_NAME}</strong>
        <span>${APP_SLOGAN}</span>
      </div>`;

    document.body.classList.add('pwa-splash-open');
    document.body.appendChild(splash);
    requestAnimationFrame(() => splash.classList.add('is-visible'));

    window.setTimeout(() => {
      splash.classList.remove('is-visible');
      window.setTimeout(() => {
        splash.remove();
        document.body.classList.remove('pwa-splash-open');
      }, SPLASH_FADE_MS);
    }, SPLASH_DURATION_MS);
  }

  function removePrompt() {
    promptElement?.classList.remove('is-visible');
    window.setTimeout(() => promptElement?.remove(), 220);
    promptElement = null;
  }

  function updatePrompt(overrideMessage = '') {
    if (!promptElement) return;
    const state = installState();
    promptElement.dataset.installState = state;
    const detail = promptElement.querySelector('[data-pwa-install-detail]');
    const button = promptElement.querySelector('[data-pwa-install]');
    if (detail) detail.textContent = overrideMessage || copyForState(state);
    if (button) {
      button.innerHTML = buttonCopyForState(state);
      button.disabled = state === 'preparing';
      button.setAttribute('aria-disabled', state === 'preparing' ? 'true' : 'false');
    }
  }

  function showInstructions(element, state) {
    const instructions = element.querySelector('[data-pwa-install-instructions]');
    if (!instructions) return;
    instructions.innerHTML = instructionMarkup(state);
    instructions.hidden = false;
    element.classList.add('show-instructions');
  }

  function createPrompt({ force = false } = {}) {
    if (isStandalone()) return null;
    if (!force && recentlyDismissed()) return null;
    if (!force && silentPaths.some((prefix) => window.location.pathname.startsWith(prefix))) return null;
    if (promptElement) {
      updatePrompt();
      return promptElement;
    }

    const element = document.createElement('aside');
    element.className = 'pwaInstallPrompt';
    element.setAttribute('role', 'dialog');
    element.setAttribute('aria-modal', 'false');
    element.setAttribute('aria-label', 'Install Classic Trip');
    element.innerHTML = `
      <button type="button" class="pwaInstallClose" aria-label="Close install prompt"><i class="fa-solid fa-xmark"></i></button>
      <div class="pwaInstallIdentity">
        <span class="pwaInstallLogo"><img src="/images/logo-maskable-192.png" alt="Classic Trip logo"></span>
        <span class="pwaInstallCopy"><strong>${APP_NAME}</strong><b>${APP_SLOGAN}</b><small data-pwa-install-detail></small></span>
      </div>
      <div class="pwaInstallInstructions" data-pwa-install-instructions hidden></div>
      <div class="pwaInstallActions">
        <button type="button" class="btn btnPrimary" data-pwa-install></button>
        <button type="button" class="btn btnGhost" data-pwa-dismiss>Not now</button>
      </div>`;

    const close = () => {
      rememberDismissal();
      removePrompt();
    };

    element.querySelector('.pwaInstallClose')?.addEventListener('click', close);
    element.querySelector('[data-pwa-dismiss]')?.addEventListener('click', close);
    element.querySelector('[data-pwa-install]')?.addEventListener('click', async () => {
      const state = installState();
      if (state === 'native-ready' && deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
        if (choice.outcome === 'accepted') {
          clearDismissal();
          removePrompt();
        } else {
          updatePrompt('Installation was not completed. You can install later from the Profile menu.');
        }
        deferredInstallPrompt = null;
        return;
      }
      showInstructions(element, state);
    });

    document.body.appendChild(element);
    promptElement = element;
    updatePrompt();
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
    action.addEventListener('click', () => {
      clearDismissal();
      createPrompt({ force: true });
    });

    const finalActions = drawerPanel.querySelector('.drawerFinalActions');
    if (finalActions) finalActions.prepend(action);
    else drawerPanel.appendChild(action);
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    clearDismissal();
    if (promptElement) updatePrompt();
    else window.setTimeout(() => createPrompt(), 250);
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    clearDismissal();
    removePrompt();
  });

  window.addEventListener('online', () => updatePrompt());
  window.addEventListener('orientationchange', () => {
    if (isStandalone()) window.setTimeout(() => keepInstalledAppPortrait(), 80);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && isStandalone()) keepInstalledAppPortrait();
  });
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    serviceWorkerReady = true;
    updatePrompt();
  });

  window.ClassicTripPWA = {
    openInstallPrompt: () => {
      clearDismissal();
      return createPrompt({ force: true });
    },
    isStandalone,
    status: () => ({ state: installState(), serviceWorkerReady, secureContext: isSecureInstallContext(), orientation: APP_ORIENTATION }),
  };

  async function initialise() {
    await keepInstalledAppPortrait();
    showStandaloneSplash();
    addDrawerInstallAction();
    registerServiceWorker();

    if (!isStandalone() && !silentPaths.some((prefix) => window.location.pathname.startsWith(prefix))) {
      window.setTimeout(() => {
        if (isMobile() || deferredInstallPrompt || !recentlyDismissed()) createPrompt();
      }, AUTO_PROMPT_DELAY_MS);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialise, { once: true });
  else initialise();
})();
