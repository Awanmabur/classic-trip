'use strict';
(() => {
  function clean(value) { return String(value || '').trim(); }
  function unique(values) { return Array.from(new Set(values.filter(Boolean))); }
  function optionsFor(select, values, placeholder, selected) {
    if (!select) return;
    const current = clean(selected || select.value);
    select.innerHTML = '';
    const first = document.createElement('option');
    first.value = '';
    first.textContent = placeholder;
    select.appendChild(first);
    values.forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      option.selected = value === current;
      select.appendChild(option);
    });
    if (current && !values.includes(current)) select.value = '';
  }

  document.querySelectorAll('[data-route-pair-container]').forEach((container) => {
    const origin = container.querySelector('[data-route-origin-select]');
    const destination = container.querySelector('[data-route-destination-select]');
    const dataNode = container.querySelector('[data-route-pairs-json]');
    if (!origin || !destination || !dataNode) return;
    let pairs = [];
    try { pairs = JSON.parse(dataNode.textContent || '[]'); } catch (_) { pairs = []; }
    pairs = pairs.map((row) => ({ origin: clean(row.origin), destination: clean(row.destination) })).filter((row) => row.origin && row.destination);
    if (!pairs.length) return;
    const allOrigins = unique(pairs.map((row) => row.origin));
    const allDestinations = unique(pairs.map((row) => row.destination));
    const originPlaceholder = origin.options[0]?.textContent || 'Select departure';
    const destinationPlaceholder = destination.options[0]?.textContent || 'Select destination';

    function sync(changed) {
      const selectedOrigin = clean(origin.value);
      const selectedDestination = clean(destination.value);
      const allowedDestinations = selectedOrigin
        ? unique(pairs.filter((row) => row.origin === selectedOrigin).map((row) => row.destination))
        : allDestinations;
      const allowedOrigins = selectedDestination
        ? unique(pairs.filter((row) => row.destination === selectedDestination).map((row) => row.origin))
        : allOrigins;
      if (changed !== 'destination') optionsFor(destination, allowedDestinations, destinationPlaceholder, selectedDestination);
      if (changed !== 'origin') optionsFor(origin, allowedOrigins, originPlaceholder, selectedOrigin);
    }

    origin.addEventListener('change', () => sync('origin'));
    destination.addEventListener('change', () => sync('destination'));
    sync('init');
  });
})();
