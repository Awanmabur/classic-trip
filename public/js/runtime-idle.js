'use strict';
(function () {
  const current = document.currentScript;
  const modules = String(current?.dataset?.modules || '').split('|').map(value => value.trim()).filter(Boolean);
  const startMode = String(current?.dataset?.start || 'idle').trim().toLowerCase();
  if (!modules.length) return;
  let started = false;
  function load() {
    if (started) return;
    started = true;
    modules.forEach((src) => {
      const absoluteSrc = new URL(src, window.location.href).href;
      if (Array.from(document.scripts).some((script) => script.src === absoluteSrc)) return;
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      document.head.appendChild(script);
    });
  }
  function afterFirstPaint() {
    window.requestAnimationFrame(() => window.requestAnimationFrame(load));
  }
  function scheduleIdle() {
    if ('requestIdleCallback' in window) window.requestIdleCallback(load, { timeout: 1800 });
    else window.setTimeout(load, 600);
  }
  function start() {
    if (startMode === 'paint') afterFirstPaint();
    else scheduleIdle();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
