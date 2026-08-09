
'use strict';
(() => {
  function clean(value) { return String(value || '').trim(); }
  function unique(values) { return Array.from(new Set((values || []).map(clean).filter(Boolean))); }
  function setOptions(select, values, placeholder, preferred) {
    if (!select) return;
    const wanted = clean(preferred || select.value);
    select.innerHTML = '';
    const first = document.createElement('option');
    first.value = '';
    first.textContent = placeholder;
    select.appendChild(first);
    unique(values).forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      option.selected = value === wanted;
      select.appendChild(option);
    });
    if (wanted && !unique(values).includes(wanted)) select.value = '';
  }

  document.querySelectorAll('[data-marketplace-db-search-form]').forEach((form) => {
    const origin = form.querySelector('[data-marketplace-origin]');
    const destination = form.querySelector('[data-marketplace-destination]');
    const service = form.querySelector('[data-marketplace-service]');
    const dataNode = form.querySelector('[data-marketplace-db-search-json]');
    if (!origin || !destination || !service || !dataNode) return;
    let data = {};
    try { data = JSON.parse(dataNode.textContent || '{}') || {}; } catch (_) { data = {}; }
    const generalOrigins = unique(data.all && data.all.origins);
    const generalDestinations = unique(data.all && data.all.destinations);
    const busOrigins = unique(data.bus && data.bus.origins);
    const busDestinations = unique(data.bus && data.bus.destinations);
    const pairs = Array.isArray(data.bus && data.bus.pairs)
      ? data.bus.pairs.map((row) => ({ origin: clean(row.origin), destination: clean(row.destination) })).filter((row) => row.origin && row.destination)
      : [];
    const initialOrigin = clean(origin.value);
    const initialDestination = clean(destination.value);

    function busSync(changed) {
      const selectedOrigin = clean(origin.value);
      const selectedDestination = clean(destination.value);
      const destinations = selectedOrigin ? unique(pairs.filter((row) => row.origin === selectedOrigin).map((row) => row.destination)) : busDestinations;
      const origins = selectedDestination ? unique(pairs.filter((row) => row.destination === selectedDestination).map((row) => row.origin)) : busOrigins;
      if (changed !== 'destination') setOptions(destination, destinations, 'Any destination', selectedDestination);
      if (changed !== 'origin') setOptions(origin, origins, 'Any origin', selectedOrigin);
    }

    function syncService(preserveInitial = false) {
      const isBus = clean(service.value).toLowerCase() === 'bus';
      const wantedOrigin = preserveInitial ? initialOrigin : origin.value;
      const wantedDestination = preserveInitial ? initialDestination : destination.value;
      if (isBus) {
        setOptions(origin, busOrigins, 'Any origin', wantedOrigin);
        setOptions(destination, busDestinations, 'Any destination', wantedDestination);
        busSync('init');
      } else {
        setOptions(origin, generalOrigins, 'Any origin', wantedOrigin);
        setOptions(destination, generalDestinations, 'Any destination', wantedDestination);
      }
    }

    service.addEventListener('change', () => syncService(false));
    origin.addEventListener('change', () => { if (clean(service.value).toLowerCase() === 'bus') busSync('origin'); });
    destination.addEventListener('change', () => { if (clean(service.value).toLowerCase() === 'bus') busSync('destination'); });
    syncService(true);
  });
})();
