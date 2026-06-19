(function () {
  'use strict';

  function panelFor(step) {
    return document.querySelector('[data-booking-step-panel="' + step + '"]');
  }

  function showStep(step) {
    document.querySelectorAll('[data-booking-step-panel]').forEach(function (panel) {
      panel.classList.toggle('is-active', panel.dataset.bookingStepPanel === step);
    });
    document.querySelectorAll('[data-booking-step-indicator]').forEach(function (indicator) {
      indicator.classList.toggle('is-active', indicator.dataset.bookingStepIndicator === step);
    });
  }

  function buyerRequiredFields(form) {
    return ['fullName', 'phone', 'email']
      .map(function (name) { return form.querySelector('[name="' + name + '"]'); })
      .filter(Boolean);
  }

  function validateBuyer(form) {
    return buyerRequiredFields(form).every(function (field) {
      if (field.checkValidity()) return true;
      field.reportValidity();
      return false;
    });
  }

  document.addEventListener('click', function (event) {
    var next = event.target.closest('[data-booking-next]');
    if (next) {
      var form = next.closest('form') || document.querySelector('[data-booking-form]');
      if (next.dataset.bookingNext !== 'buyer' && form && !validateBuyer(form)) return;
      showStep(next.dataset.bookingNext);
      panelFor(next.dataset.bookingNext)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    var prev = event.target.closest('[data-booking-prev]');
    if (prev) {
      showStep(prev.dataset.bookingPrev);
      panelFor(prev.dataset.bookingPrev)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  document.addEventListener('submit', function (event) {
    var form = event.target.closest('[data-booking-form]');
    if (!form) return;

    if (!validateBuyer(form)) {
      event.preventDefault();
      showStep('buyer');
      return;
    }

    var btn = form.querySelector('[type=submit]');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Confirming';
    }
  });
}());
