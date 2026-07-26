(() => {
  'use strict';
  document.addEventListener('change', (event) => {
    const trigger = event.target.closest('[data-page-action="submit-form"]');
    if (trigger?.form) trigger.form.requestSubmit();
  });
  function dismissSiteFlash(flash) {
    if (!flash || flash.dataset.dismissing === 'true') return;
    flash.dataset.dismissing = 'true';
    flash.style.opacity = '0';
    flash.style.transform = 'translateY(-6px)';
    window.setTimeout(() => flash.remove(), 220);
  }

  document.addEventListener('click', (event) => {
    const dismiss = event.target.closest('[data-dismiss-site-flash]');
    if (dismiss) {
      dismissSiteFlash(dismiss.closest('[data-site-flash]'));
      return;
    }
    const trigger = event.target.closest('[data-page-action]');
    if (!trigger) return;
    if (trigger.dataset.pageAction === 'print') window.print();
  });

  document.querySelectorAll('[data-site-flash-stack] [data-site-flash]').forEach((flash, index) => {
    window.setTimeout(() => dismissSiteFlash(flash), 4800 + (index * 250));
  });
})();
