window.ClassicTrip = window.ClassicTrip || {};
window.ClassicTrip.toast = function(message){ const el=document.querySelector('#toast'); if(!el) return; el.textContent=message; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2200); };


/* Stay image fallback: local cover keeps marketplace media intact when a remote partner image cannot load. */
document.addEventListener('error', function classicTripImageFallback(event) {
  const image = event.target;
  if (!image || image.tagName !== 'IMG') return;
  const fallback = image.getAttribute('data-fallback-src');
  if (!fallback || image.dataset.fallbackApplied === '1') return;
  image.dataset.fallbackApplied = '1';
  image.src = fallback;
}, true);
