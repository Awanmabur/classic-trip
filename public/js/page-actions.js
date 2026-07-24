(() => {
  'use strict';
  document.addEventListener('change', (event) => {
    const trigger = event.target.closest('[data-page-action="submit-form"]');
    if (trigger?.form) trigger.form.requestSubmit();
  });
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-page-action]');
    if (!trigger) return;
    if (trigger.dataset.pageAction === 'print') window.print();
  });
})();
