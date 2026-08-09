(function () {
  'use strict';
  function initHub(hub) {
    if (!hub || hub.dataset.ctReady === 'true') return;
    hub.dataset.ctReady = 'true';
    var toggle = hub.querySelector('[data-ct-contact-toggle]');
    var menu = hub.querySelector('[data-ct-contact-menu]');
    if (!toggle || !menu) return;
    function setOpen(open) {
      hub.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      menu.setAttribute('aria-hidden', open ? 'false' : 'true');
      toggle.setAttribute('aria-label', open ? 'Close Classic Trip contact options' : 'Open Classic Trip contact options');
      var icon = toggle.querySelector('i');
      if (icon) icon.className = open ? 'fa-solid fa-xmark' : 'fa-solid fa-headset';
    }
    toggle.addEventListener('click', function (event) {
      event.stopPropagation();
      setOpen(!hub.classList.contains('is-open'));
    });
    menu.addEventListener('click', function (event) { event.stopPropagation(); });
    document.addEventListener('click', function () { setOpen(false); });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { setOpen(false); toggle.focus(); }
    });
  }
  function init() { document.querySelectorAll('[data-ct-contact-hub]').forEach(initHub); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
