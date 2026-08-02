'use strict';

(() => {
  const tabList = document.getElementById('searchTabs');
  const panelsRoot = document.getElementById('serviceSearchPanels');
  if (!tabList || !panelsRoot) return;

  const tabs = Array.from(tabList.querySelectorAll('[data-service-tab]'));
  const panels = Array.from(panelsRoot.querySelectorAll('[data-search-panel]'));
  const primaryButton = document.getElementById('primarySearchBtn');
  const smartButton = document.getElementById('smartSearchBtn');

  const routes = Object.freeze({
    bus: '/search',
    hotel: '/stays',
    flight: '/flights',
    local_transport: '/taxi',
    tour: '/tours',
    car_rental: '/car-rentals',
    cargo: '/cargo',
  });

  const labels = Object.freeze({
    bus: 'buses',
    hotel: 'stays',
    flight: 'flights',
    local_transport: 'rides',
    tour: 'tours',
    car_rental: 'cars',
    cargo: 'cargo services',
  });

  function normalizeService(value) {
    const key = String(value || '').trim();
    return Object.prototype.hasOwnProperty.call(routes, key) ? key : 'bus';
  }

  function selectedService() {
    return normalizeService(tabList.querySelector('[data-service-tab].active')?.dataset.serviceTab);
  }

  function setPanelEnabled(panel, enabled) {
    panel.hidden = !enabled;
    panel.toggleAttribute('inert', !enabled);
    panel.classList.toggle('active', enabled);
    panel.setAttribute('aria-hidden', enabled ? 'false' : 'true');
    panel.querySelectorAll('input, select, textarea, button').forEach((control) => {
      control.disabled = !enabled;
    });
  }

  function activateService(value) {
    const service = normalizeService(value);
    tabs.forEach((tab) => {
      const active = tab.dataset.serviceTab === service;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.tabIndex = active ? 0 : -1;
    });
    panels.forEach((panel) => setPanelEnabled(panel, panel.dataset.searchPanel === service));

    const label = labels[service];
    if (primaryButton) primaryButton.innerHTML = `<i class="fa-solid fa-magnifying-glass"></i> Search ${label}`;
    if (smartButton) smartButton.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> Smart ${label} search`;
    tabList.dataset.activeService = service;
  }

  function activePanel() {
    const service = selectedService();
    return panels.find((panel) => panel.dataset.searchPanel === service && !panel.hidden) || null;
  }

  function runSearch() {
    const service = selectedService();
    const panel = activePanel();
    if (!panel) return;

    const params = new URLSearchParams({ serviceType: service });
    panel.querySelectorAll('[data-search-param]').forEach((field) => {
      const key = String(field.dataset.searchParam || '').trim();
      const value = String(field.value || '').trim();
      if (key && value) params.set(key, value);
    });
    if (service === 'flight' && params.get('returnDate')) params.set('tripType', 'round_trip');
    window.location.assign(`${routes[service]}?${params.toString()}`);
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => activateService(tab.dataset.serviceTab));
  });

  tabList.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const current = Math.max(0, tabs.indexOf(document.activeElement));
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    tabs[next]?.focus();
    activateService(tabs[next]?.dataset.serviceTab);
  });

  [primaryButton, smartButton].forEach((button) => button?.addEventListener('click', runSearch));

  const today = new Date().toISOString().slice(0, 10);
  panelsRoot.querySelectorAll('input[type="date"]').forEach((input) => { input.min = today; });
  [
    ['stayCheckInInput', 'stayCheckOutInput'],
    ['flightDepartInput', 'flightReturnInput'],
    ['rentalPickupDateInput', 'rentalReturnDateInput'],
  ].forEach(([startId, endId]) => {
    const start = document.getElementById(startId);
    const end = document.getElementById(endId);
    if (!start || !end) return;
    const sync = () => {
      end.min = start.value || today;
      if (start.value && end.value && end.value < start.value) end.value = start.value;
    };
    start.addEventListener('change', sync);
    sync();
  });

  const requested = new URLSearchParams(window.location.search).get('serviceType');
  activateService(requested || 'bus');
})();
