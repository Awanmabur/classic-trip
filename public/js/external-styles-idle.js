'use strict';
(function () {
  const current = document.currentScript;
  const styles = String(current?.dataset?.styles || '').split('|').map((value) => value.trim()).filter(Boolean);
  if (!styles.length) return;
  let started = false;
  function load() {
    if (started) return;
    started = true;
    styles.forEach((href) => {
      const absoluteHref = new URL(href, window.location.href).href;
      if (Array.from(document.styleSheets).some((sheet) => sheet.href === absoluteHref)) return;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      document.head.appendChild(link);
    });
  }
  function schedule() {
    if ('requestIdleCallback' in window) window.requestIdleCallback(load, { timeout: 900 });
    else window.setTimeout(load, 250);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once: true });
  else schedule();
})();
