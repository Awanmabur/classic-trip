(function () {
  'use strict';

  var STORAGE_KEY = 'classicTripContactHubPositionV1';
  var EDGE_GAP = 12;
  var DRAG_THRESHOLD = 6;

  function safeParse(value) {
    try { return JSON.parse(value || ''); } catch (_) { return null; }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function initHub(hub) {
    if (!hub || hub.dataset.ctReady === 'true') return;
    hub.dataset.ctReady = 'true';

    var toggle = hub.querySelector('[data-ct-contact-toggle]');
    var menu = hub.querySelector('[data-ct-contact-menu]');
    if (!toggle || !menu) return;

    var drag = null;
    var suppressClick = false;

    function setOpen(open) {
      hub.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      menu.setAttribute('aria-hidden', open ? 'false' : 'true');
      toggle.setAttribute('aria-label', open ? 'Close Classic Trip contact options' : 'Open Classic Trip contact options');
      var icon = toggle.querySelector('i');
      if (icon) icon.className = open ? 'fa-solid fa-xmark' : 'fa-solid fa-headset';
    }

    function setSide(side) {
      var normalized = side === 'left' ? 'left' : 'right';
      hub.dataset.side = normalized;
      if (normalized === 'left') {
        hub.style.left = EDGE_GAP + 'px';
        hub.style.right = 'auto';
      } else {
        hub.style.right = EDGE_GAP + 'px';
        hub.style.left = 'auto';
      }
    }

    function setTop(top) {
      var height = toggle.getBoundingClientRect().height || 58;
      var maxTop = Math.max(EDGE_GAP, window.innerHeight - height - EDGE_GAP);
      hub.style.top = clamp(Number(top) || EDGE_GAP, EDGE_GAP, maxTop) + 'px';
      hub.style.bottom = 'auto';
    }

    function savePosition() {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
          side: hub.dataset.side === 'left' ? 'left' : 'right',
          top: Math.round(parseFloat(hub.style.top) || hub.getBoundingClientRect().top || EDGE_GAP)
        }));
      } catch (_) {}
    }

    function applySavedPosition() {
      var saved = null;
      try { saved = safeParse(window.localStorage.getItem(STORAGE_KEY)); } catch (_) {}
      if (!saved || !Number.isFinite(Number(saved.top))) return;
      setSide(saved.side);
      setTop(Number(saved.top));
      hub.classList.add('is-positioned');
    }

    function snapToNearestSide() {
      var rect = hub.getBoundingClientRect();
      var side = rect.left + (rect.width / 2) < window.innerWidth / 2 ? 'left' : 'right';
      setSide(side);
      setTop(rect.top);
      hub.classList.add('is-positioned');
      savePosition();
    }

    toggle.addEventListener('pointerdown', function (event) {
      if (event.button != null && event.button !== 0) return;
      var rect = hub.getBoundingClientRect();
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        moved: false
      };
      suppressClick = false;
      try { toggle.setPointerCapture(event.pointerId); } catch (_) {}
    });

    toggle.addEventListener('pointermove', function (event) {
      if (!drag || drag.pointerId !== event.pointerId) return;
      var dx = event.clientX - drag.startX;
      var dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

      drag.moved = true;
      suppressClick = true;
      setOpen(false);
      hub.classList.add('is-dragging', 'is-positioned');

      var size = toggle.getBoundingClientRect().width || 58;
      var left = clamp(event.clientX - drag.offsetX, EDGE_GAP, Math.max(EDGE_GAP, window.innerWidth - size - EDGE_GAP));
      var top = clamp(event.clientY - drag.offsetY, EDGE_GAP, Math.max(EDGE_GAP, window.innerHeight - size - EDGE_GAP));
      hub.style.left = left + 'px';
      hub.style.right = 'auto';
      hub.style.top = top + 'px';
      hub.style.bottom = 'auto';
      event.preventDefault();
    });

    function finishDrag(event) {
      if (!drag || (event && drag.pointerId !== event.pointerId)) return;
      var moved = drag.moved;
      try { toggle.releasePointerCapture(drag.pointerId); } catch (_) {}
      drag = null;
      hub.classList.remove('is-dragging');
      if (moved) snapToNearestSide();
    }

    toggle.addEventListener('pointerup', finishDrag);
    toggle.addEventListener('pointercancel', finishDrag);

    toggle.addEventListener('click', function (event) {
      if (suppressClick) {
        suppressClick = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.stopPropagation();
      setOpen(!hub.classList.contains('is-open'));
    });

    menu.addEventListener('click', function (event) { event.stopPropagation(); });
    document.addEventListener('click', function () { setOpen(false); });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { setOpen(false); toggle.focus(); }
    });
    window.addEventListener('resize', function () {
      if (!hub.classList.contains('is-positioned')) return;
      setTop(parseFloat(hub.style.top) || hub.getBoundingClientRect().top);
      setSide(hub.dataset.side);
      savePosition();
    }, { passive: true });

    applySavedPosition();
  }

  function init() { document.querySelectorAll('[data-ct-contact-hub]').forEach(initHub); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
