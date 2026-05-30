document.addEventListener('submit', (event) => {
  const form = event.target.closest('[data-booking-form]');
  if (!form) return;
  const btn = form.querySelector('[type=submit]') || (form.id ? document.querySelector(`[form="${form.id}"][type=submit]`) : null);
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Confirming';
  }
});
