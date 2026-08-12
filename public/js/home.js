'use strict';

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  let bootstrap = {};
  try {
    bootstrap = JSON.parse($('#classicTripBootstrap')?.textContent || '{}');
  } catch (_) {
    bootstrap = {};
  }

  const listings = Array.isArray(bootstrap.listings) ? bootstrap.listings : [];
  const marketplace = bootstrap.marketplace && typeof bootstrap.marketplace === 'object' ? bootstrap.marketplace : {};
  const platformConfig = bootstrap.platformConfig && typeof bootstrap.platformConfig === 'object' ? bootstrap.platformConfig : {};
  const defaultCurrency = String(platformConfig.defaultCurrency || '').trim().toUpperCase();
  const loggedIn = Boolean(document.body?.dataset.userId);

  const groupConfig = {
    bus: { container: 'cards', section: 'bus', label: 'bus services' },
    hotel: { container: 'hotelCards', section: 'hotel', label: 'hotels' },
    flight: { container: 'flightCards', section: 'flight', label: 'flights' },
    local_transport: { container: 'taxiCards', section: 'local-transport', label: 'local rides' },
    tour: { container: 'tourCards', section: 'tour', label: 'tours and activities' },
    car_rental: { container: 'rentalCards', section: 'car-rental', label: 'car rentals' },
    cargo: { container: 'cargoCards', section: 'cargo', label: 'cargo services' },
  };

  const serviceIcons = {
    bus: 'fa-bus',
    hotel: 'fa-hotel',
    flight: 'fa-plane',
    local_transport: 'fa-taxi',
    tour: 'fa-map-location-dot',
    car_rental: 'fa-car-side',
    cargo: 'fa-box',
  };

  const initialLimits = Object.freeze({ bus: 4, hotel: 4, flight: 4, local_transport: 4, tour: 4, car_rental: 4, cargo: 4 });
  const incrementFor = (group) => initialLimits[group] || 4;
  const visibleCounts = Object.fromEntries(Object.keys(groupConfig).map((group) => [group, incrementFor(group)]));
  const sectionViews = Object.fromEntries(Object.keys(groupConfig).map((group) => {
    let saved = 'cards';
    try { saved = localStorage.getItem(`classicTripSectionView:${group}`) || 'cards'; } catch (_) {}
    return [group, saved === 'bars' ? 'bars' : 'cards'];
  }));
  let activeCorridor = 'all';
  let drawerReturnFocus = null;

  function routeDisplay(origin, destination, fallback = '') {
    const from = String(origin || '').trim();
    const to = String(destination || '').trim();
    if (from && to) return `${from} ⇄ ${to}`;
    return String(fallback || from || to || '').trim().replace(/\s+(?:to|→|->|↔|⇄)\s+/gi, ' ⇄ ');
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
  }

  function safeInternalUrl(value, fallback = '/') {
    try {
      const url = new URL(String(value || fallback), window.location.origin);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== window.location.origin) return fallback;
      return `${url.pathname}${url.search}${url.hash}`;
    } catch (_) {
      return fallback;
    }
  }

  function safeImageUrl(value) {
    try {
      const url = new URL(String(value || ''), window.location.origin);
      if (!['http:', 'https:'].includes(url.protocol) || !['http:', 'https:'].includes(url.protocol)) return '';
      return url.origin === window.location.origin ? `${url.pathname}${url.search}` : url.href;
    } catch (_) {
      return '';
    }
  }

  function money(amount, currency) {
    const code = String(currency || defaultCurrency || '').trim().toUpperCase();
    const value = Number(amount);
    if (!code || !Number.isFinite(value)) return 'Price unavailable';
    return `${escapeHtml(code)} ${Math.round(value).toLocaleString('en-GB')}`;
  }

  function toast(message) {
    const element = $('#toast');
    if (!element) return;
    element.textContent = String(message || '');
    element.classList.add('show');
    clearTimeout(window.__classicTripToast);
    window.__classicTripToast = setTimeout(() => element.classList.remove('show'), 2400);
  }

  function drawerFocusable() {
    return Array.from($('#drawer')?.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])
      .filter((node) => !node.hidden && node.getAttribute('aria-hidden') !== 'true');
  }

  function setDrawer(open, restoreFocus = true) {
    const drawer = $('#drawer');
    if (!drawer) return;
    if (open) drawerReturnFocus = document.activeElement;
    drawer.classList.toggle('open', open);
    drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.body.classList.toggle('site-drawer-open', open);
    $$('[aria-controls="drawer"]').forEach((button) => button.setAttribute('aria-expanded', open ? 'true' : 'false'));
    if (open) window.setTimeout(() => drawerFocusable()[0]?.focus(), 0);
    else if (restoreFocus && drawerReturnFocus instanceof HTMLElement) drawerReturnFocus.focus();
  }

  function csrfToken() {
    return $('meta[name="csrf-token"]')?.getAttribute('content') || '';
  }

  function listingId(item) {
    return String(item?.listingId || item?.id || item?._id || '').trim();
  }

  function catalogKey(item) {
    return String(item?.catalogKey || item?.id || item?._id || '').trim();
  }

  function listingUrl(item) {
    const type = encodeURIComponent(String(item?.serviceType || 'service'));
    const identifier = encodeURIComponent(String(item?.slug || listingId(item)));
    return safeInternalUrl(item?.url, `/listings/${type}/${identifier}`);
  }

  function bookingUrl(item) {
    return item?.bookable ? safeInternalUrl(item?.bookingUrl, listingUrl(item)) : listingUrl(item);
  }

  function savedIds() {
    try {
      const parsed = JSON.parse(localStorage.getItem('classicTripSavedListingIds') || '[]');
      return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
    } catch (_) {
      return new Set();
    }
  }

  function storeSavedIds(ids) {
    localStorage.setItem('classicTripSavedListingIds', JSON.stringify(Array.from(ids)));
  }

  function updateSavedButtons() {
    const saved = savedIds();
    $$('[data-save-id]').forEach((button) => {
      const isSaved = saved.has(String(button.dataset.saveId || ''));
      button.classList.toggle('loved', isSaved);
      const icon = $('i', button);
      if (icon) icon.className = isSaved ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
      button.setAttribute('aria-pressed', isSaved ? 'true' : 'false');
    });
  }

  async function saveListing(id) {
    const item = listings.find((row) => listingId(row) === String(id || ''));
    if (!item) return toast('Listing not found.');

    const saved = savedIds();
    if (saved.has(String(id))) return toast('This listing is already saved.');

    if (loggedIn) {
      try {
        const response = await fetch('/account/saved', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'x-csrf-token': csrfToken(),
          },
          body: new URLSearchParams({ listingId: String(id) }).toString(),
        });
        if (!response.ok) throw new Error('Unable to save this listing.');
      } catch (error) {
        return toast(error.message || 'Unable to save this listing.');
      }
    }

    saved.add(String(id));
    storeSavedIds(saved);
    updateSavedButtons();
    toast(loggedIn ? 'Listing saved to your account.' : 'Listing saved on this device.');
  }

  function shareListing(id) {
    const item = listings.find((row) => listingId(row) === String(id || ''));
    if (!item) return toast('Listing not found.');
    const url = new URL(listingUrl(item), window.location.origin).href;
    const shareData = { title: item.title || 'Classic Trip listing', url };
    if (navigator.share) {
      navigator.share(shareData).catch(() => {});
      return;
    }
    navigator.clipboard?.writeText(url).then(() => toast('Share link copied.')).catch(() => toast('Open the listing to copy its link.'));
  }

  function nextDepartureLabel(item) {
    if (!item?.nextDepartAt) return 'No published departure';
    const date = new Date(item.nextDepartAt);
    if (Number.isNaN(date.getTime())) return 'Departure time unavailable';
    return date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function availabilityBadge(item) {
    const remaining = Number(item?.remainingInventory ?? item?.availability);
    const departureCount = Number(item?.departureCount ?? item?.publishedDepartureCount);
    const isBus = String(item?.serviceType || item?.type || '').toLowerCase() === 'bus';
    if (item?.isSponsored) return { className: 'promo', icon: 'fa-bullhorn', text: 'Sponsored' };
    if (isBus) {
      if (Number.isFinite(departureCount) && departureCount > 0) return { className: 'available', icon: 'fa-calendar-check', text: `${departureCount} departure${departureCount === 1 ? '' : 's'}` };
      return { className: 'full', icon: 'fa-calendar-xmark', text: 'No departures' };
    }
    if (item?.bookable) return { className: 'available', icon: 'fa-circle-check', text: Number.isFinite(remaining) ? `${remaining} available` : 'Available' };
    if (Number.isFinite(remaining) && remaining <= 0) return { className: 'full', icon: 'fa-circle-xmark', text: 'No inventory' };
    return { className: 'promo', icon: 'fa-clock', text: 'View service' };
  }

  function companyRoutesHtml(item, isBus, view = 'cards') {
    if (!isBus) return '';
    if (!Array.isArray(item.routes) || !item.routes.length) return '<div class="companyRouteList is-empty" aria-label="Routes"><span class="companyRoutePlaceholder" aria-hidden="true">Routes</span></div>';
    const routeRows = 2;
    const laneCount = Math.min(routeRows, item.routes.length);
    const lanes = Array.from({ length: laneCount }, () => []);
    const laneWeights = Array.from({ length: laneCount }, () => 0);
    item.routes.forEach((route) => {
      const label = routeDisplay(route.origin, route.destination, route.label) || 'Bus route';
      let laneIndex = 0;
      for (let index = 1; index < laneWeights.length; index += 1) {
        if (laneWeights[index] < laneWeights[laneIndex]) laneIndex = index;
      }
      lanes[laneIndex].push(label);
      laneWeights[laneIndex] += Math.max(10, label.length) + 5;
    });
    const laneHtml = lanes.map((lane) => `<div class="companyRouteLane">${lane.map((label) => `<span class="companyRouteChip" title="${escapeHtml(label)}"><i class="fa-solid fa-route"></i> ${escapeHtml(label)}</span>`).join('')}</div>`).join('');
    return `<div class="companyRouteList" aria-label="All company routes" tabindex="0"><div class="companyRouteTrack">${laneHtml}</div></div>`;
  }

  function cardHtml(item, view = 'cards') {
    const id = listingId(item);
    const key = catalogKey(item);
    const group = String(item.group || item.serviceType || 'more');
    const type = String(item.serviceType || item.type || group || 'service').toLowerCase();
    const isBus = type === 'bus';
    const isHotel = type === 'hotel';
    const isFlight = type === 'flight';
    const isTaxi = type === 'local_transport';
    const isTour = type === 'tour';
    const isRental = type === 'car_rental';
    const isCargo = type === 'cargo';
    const icon = serviceIcons[type] || 'fa-ticket';
    const badge = availabilityBadge(item);
    const image = safeImageUrl(item.img || item.image || item.media?.[0]?.secureUrl || item.media?.[0]?.url || '');
    const route = routeDisplay(item.from, item.to, item.routeLabel);
    const place = (isBus || isFlight || isCargo) ? (route || item.location || item.city || 'Route information') : (item.location || item.city || route || (isTaxi ? 'Service zone' : isTour ? 'Meeting area' : isRental ? 'Pickup location' : 'Property location'));
    const rating = Number(item.ratingAverage || item.rating);
    const ratingText = Number.isFinite(rating) && rating > 0 ? rating.toFixed(1) : 'New';
    const partner = item.partner || item.companyName || 'Service partner';
    const partnerRepeatsTitle = String(partner).trim().toLowerCase() === String(item.title || '').trim().toLowerCase();
    const amount = Number(item.priceFrom ?? item.price ?? 0);
    const currencyCode = String(item.currency || '').toUpperCase();
    const amountText = Math.round(amount || 0).toLocaleString('en-GB');
    const price = amount > 0 ? `${isBus ? '<span class=\"pricePrefix\">From</span> ' : ''}<span class=\"priceCurrency\">${escapeHtml(currencyCode)}</span> <span class=\"priceAmount\">${escapeHtml(amountText)}</span>` : 'Price pending';
    const amenities = Array.isArray(item.amenities) ? item.amenities.map((value) => typeof value === 'string' ? value : (value?.name || value?.label || '')).map((value) => String(value || '').trim()).filter(Boolean) : [];
    const amenityList = (() => {
      if (!amenities.length) return '<div class="listingAmenityList is-empty" aria-label="Amenities"><span class="listingAmenityPlaceholder" aria-hidden="true">Amenities</span></div>';
      const laneCount = Math.min(2, amenities.length);
      const lanes = Array.from({ length: laneCount }, () => []);
      const laneWeights = Array.from({ length: laneCount }, () => 0);
      amenities.forEach((amenity) => {
        let laneIndex = 0;
        for (let index = 1; index < laneWeights.length; index += 1) {
          if (laneWeights[index] < laneWeights[laneIndex]) laneIndex = index;
        }
        lanes[laneIndex].push(amenity);
        laneWeights[laneIndex] += Math.max(8, amenity.length) + 4;
      });
      const rows = lanes.map((lane) => `<div class="listingAmenityLane">${lane.map((amenity) => `<span class="listingAmenityChip" title="${escapeHtml(amenity)}"><i class="fa-solid fa-circle-check"></i> ${escapeHtml(amenity)}</span>`).join('')}</div>`).join('');
      return `<div class="listingAmenityList" aria-label="Amenities" tabindex="0"><div class="listingAmenityTrack">${rows}</div></div>`;
    })();
    const routeList = companyRoutesHtml(item, isBus, view);
    const priceHint = item.bookable
      ? (isBus ? 'Cheapest route fare' : isHotel ? 'Starting price · per available night' : isFlight ? 'Starting airfare · live dated departure' : isTaxi ? 'Estimated fare · request an exact quote' : isTour ? 'Per participant · choose activity date' : isRental ? 'Per day · choose pickup and return' : isCargo ? 'Shipment price · add cargo details' : 'Starting price')
      : 'Open service details';

    return `<article class="listing marketplaceListingCard serviceCard serviceCard--${escapeHtml(type)}${isBus ? ' referenceBusCard' : ''}" data-id="${escapeHtml(id)}" data-catalog-key="${escapeHtml(key)}" data-group="${escapeHtml(group)}" data-service-type="${escapeHtml(type)}" data-stay-type="${escapeHtml(item.stayType || '')}" data-corridor="${escapeHtml(item.corridor || 'regional')}">
      <a class="listingThumbLink" href="${escapeHtml(listingUrl(item))}" aria-label="View ${escapeHtml(item.title || 'service')}">
        <div class="thumb">
          ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(item.title || 'Service image')}" loading="lazy" decoding="async">` : '<div class="listingImageEmpty"><i class="fa-solid fa-image"></i></div>'}
          <div class="thumbBadges"><span class="badge badgeOk"><i class="fa-solid fa-star"></i> ${escapeHtml(ratingText)}</span><span class="badge badgeInfo"><i class="fa-solid ${escapeHtml(icon)}"></i> ${escapeHtml(item.typeLabel || (isBus ? 'Bus' : isHotel ? 'Stay' : isFlight ? 'Flight' : isTaxi ? 'Local taxi' : isTour ? 'Tour' : isRental ? 'Car rental' : isCargo ? 'Cargo' : 'Service'))}</span></div>
        </div>
      </a>
      <div class="cornerBadge ${escapeHtml(badge.className)}"><i class="fa-solid ${escapeHtml(badge.icon)}"></i> ${escapeHtml(badge.text)}</div>
      <div class="listingBody">
        <h3 class="listingTitle"><a href="${escapeHtml(listingUrl(item))}">${escapeHtml(item.title || 'Untitled service')}</a></h3>
        ${(!isBus || !partnerRepeatsTitle) ? `<div class="meta">${!isBus ? `<span><i class="fa-solid ${(isFlight || isCargo) ? 'fa-route' : 'fa-location-dot'}"></i> ${escapeHtml(place)}</span>` : ''}${!partnerRepeatsTitle ? `<span><i class="fa-solid fa-building"></i> ${escapeHtml(partner)}</span>` : ''}</div>` : ''}
        ${routeList}
        ${amenityList}
        <div class="priceRow"><div><div class="price">${price}</div><div class="small">${escapeHtml(priceHint)}</div></div><div class="actions"><a class="btn btnGhost" href="${escapeHtml(listingUrl(item))}"><i class="fa-regular fa-eye"></i> View</a>${item.bookable ? `<a class="btn btnPrimary" href="${escapeHtml(bookingUrl(item))}"><i class="fa-solid fa-ticket"></i> Book</a>` : ''}</div></div>
      </div>
    </article>`;
  }

  function renderGroup(group) {
    const config = groupConfig[group];
    const container = document.getElementById(config.container);
    if (!container) return;
    const rows = listings.filter((item) => String(item.group || 'more') === group);
    const shown = rows.slice(0, visibleCounts[group]);
    const view = sectionViews[group] || 'cards';
    container.dataset.view = view;
    container.innerHTML = shown.length
      ? shown.map((item) => cardHtml(item, view)).join('')
      : `<div class="card marketplaceEmptyCard" data-home-empty="${escapeHtml(group)}"><strong>No published ${escapeHtml(config.label)} yet</strong><p class="muted">Services will appear after their complete records and bookable inventory are published.</p></div>`;
    const section = document.querySelector(`[data-marketplace-section="${group}"]`);
    section?.querySelectorAll('[data-home-action="set-section-view"]').forEach((toggle) => {
      const active = toggle.dataset.view === container.dataset.view;
      toggle.classList.toggle('active', active);
      toggle.setAttribute('aria-pressed', active ? 'true' : 'false');
      toggle.setAttribute('aria-label', `${config.label} ${toggle.dataset.view === 'bars' ? 'list' : 'card'} view`);
    });

    const button = document.getElementById(`more-${group}`);
    if (button) {
      const remaining = rows.length - shown.length;
      button.classList.toggle('hide', remaining <= 0);
      button.disabled = remaining <= 0;
      button.innerHTML = `<i class="fa-solid fa-plus"></i> More ${escapeHtml(config.label)}${remaining > 0 ? ` (${Math.min(incrementFor(group), remaining)})` : ''}`;
    }
  }

  function render() {
    Object.keys(groupConfig).forEach(renderGroup);
    updateSavedButtons();
    applyCorridorHighlight();
    updateSectionSummaries();
  }

  function updateSectionSummaries() {
    const typeStats = Array.isArray(marketplace.typeStats) ? marketplace.typeStats : [];
    typeStats.forEach((stat) => {
      const section = document.getElementById(groupConfig[stat.type]?.section || '');
      const description = section?.querySelector('.sectionHead p');
      if (!description || !Number(stat.count)) return;
      const parts = [`${Number(stat.count)} published`];
      if (Number.isFinite(Number(stat.remainingSeats))) parts.push(`${Number(stat.remainingSeats)} available`);
      description.textContent = parts.join(' • ');
    });
  }

  function showMore(group) {
    if (!groupConfig[group]) return;
    const rows = listings.filter((item) => String(item.group || 'more') === group);
    visibleCounts[group] = Math.min(visibleCounts[group] + incrementFor(group), rows.length);
    renderGroup(group);
    updateSavedButtons();
  }

  function setSectionView(group, view) {
    if (!groupConfig[group]) return;
    const normalized = view === 'bars' ? 'bars' : 'cards';
    sectionViews[group] = normalized;
    try { localStorage.setItem(`classicTripSectionView:${group}`, normalized); } catch (_) {}
    renderGroup(group);
    updateSavedButtons();
    applyCorridorHighlight();
    const section = document.querySelector(`[data-marketplace-section="${group}"]`);
    section?.querySelectorAll('[data-home-action="set-section-view"]').forEach((button) => {
      const active = button.dataset.view === normalized;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function equivalentCorridor(code) {
    const reversePairs = { 'ke-ug': 'ug-ke', 'ug-ke': 'ug-ke' };
    return reversePairs[code] || code;
  }

  function applyCorridorHighlight() {
    $$('.listing').forEach((card) => {
      const cardCorridor = equivalentCorridor(card.dataset.corridor || '');
      const selected = equivalentCorridor(activeCorridor);
      card.classList.toggle('routeMatch', activeCorridor !== 'all' && cardCorridor === selected);
    });
  }

  function navigationOffset() {
    return Math.ceil($('.nav')?.getBoundingClientRect().height || 0) + 10;
  }

  function scrollToElement(element) {
    if (!element) return;
    const top = element.getBoundingClientRect().top + window.scrollY - navigationOffset();
    window.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' });
  }

  function scrollToSection(id) {
    scrollToElement(document.getElementById(id));
  }

  function activateButtonSet(selector, selected) {
    $$(selector).forEach((button) => button.classList.toggle('active', button.dataset.filter === selected));
  }

  function filterCards(group) {
    activateButtonSet('#categoryFilters button, #drawerCategoryFilters button', group);
    scrollToSection(group === 'all' ? 'bus' : (groupConfig[group]?.section || 'bus'));
    setDrawer(false);
  }

  function filterRoute(corridor) {
    activeCorridor = corridor || 'all';
    activateButtonSet('#routeFilters button, #drawerRouteFilters button', activeCorridor);
    applyCorridorHighlight();
    const match = listings.find((item) => equivalentCorridor(item.corridor) === equivalentCorridor(activeCorridor));
    if (match && groupConfig[match.group]) {
      const rows = listings.filter((item) => item.group === match.group);
      visibleCounts[match.group] = Math.max(visibleCounts[match.group], rows.findIndex((item) => catalogKey(item) === catalogKey(match)) + 1);
      renderGroup(match.group);
      updateSavedButtons();
      applyCorridorHighlight();
      scrollToSection(groupConfig[match.group].section);
    } else {
      scrollToSection('bus');
      if (activeCorridor !== 'all') toast('No published service currently matches this corridor.');
    }
    setDrawer(false);
  }

  function setupDrawerFilters() {
    const holder = $('#drawerFilters');
    if (!holder) return;
    const categories = $('#categoryFilters')?.cloneNode(true);
    const routes = $('#routeFilters')?.cloneNode(true);
    if (categories) categories.id = 'drawerCategoryFilters';
    if (routes) routes.id = 'drawerRouteFilters';
    holder.replaceChildren();
    const categoryTitle = document.createElement('div');
    categoryTitle.innerHTML = '<div class="drawerFilterTitle">Categories</div><div class="drawerFilterHint">Choose what to browse.</div>';
    holder.appendChild(categoryTitle);
    if (categories) holder.appendChild(categories);
    const routeHolder = document.createElement('div');
    routeHolder.innerHTML = '<div class="drawerFilterTitle">Country routes</div><div class="drawerFilterHint">Highlight an available corridor.</div>';
    if (routes) routeHolder.appendChild(routes);
    holder.appendChild(routeHolder);
  }

  function setTheme(theme) {
    const normalized = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', normalized);
    localStorage.setItem('classicTripTheme', normalized);
    const icon = $('#themeIcon');
    if (icon) icon.className = normalized === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute('content', normalized === 'dark' ? '#070a12' : '#f8fafc');
  }

  function shareDataset(button) {
    const url = safeInternalUrl(button.dataset.u, '/');
    const absoluteUrl = new URL(url, window.location.origin).href;
    if (navigator.share) navigator.share({ title: button.dataset.t || 'Classic Trip', url: absoluteUrl }).catch(() => {});
    else navigator.clipboard?.writeText(absoluteUrl).then(() => toast('Share link copied.')).catch(() => {});
  }

  setupDrawerFilters();
  render();

  const savedTheme = localStorage.getItem('classicTripTheme') || localStorage.getItem('ct-theme') || localStorage.getItem('ct_auth_theme') || 'dark';
  setTheme(savedTheme);
  $('#themeBtn')?.addEventListener('click', () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));
  $('#menuBtn')?.addEventListener('click', () => setDrawer(true));
  $('#closeDrawer')?.addEventListener('click', () => setDrawer(false));
  $('#drawer')?.addEventListener('click', (event) => { if (event.target.id === 'drawer') setDrawer(false); });


  document.addEventListener('click', (event) => {
    const actionElement = event.target.closest('[data-home-action]');
    if (actionElement) {
      const action = actionElement.dataset.homeAction;
      if (action === 'scroll-section') scrollToSection(actionElement.dataset.sectionId);
      else if (action === 'navigate' && actionElement.dataset.url?.startsWith('/')) window.location.assign(actionElement.dataset.url);
      else if (action === 'drawer-toggle') setDrawer(!$('#drawer')?.classList.contains('open'));
      else if (action === 'filter-cards') filterCards(actionElement.dataset.filter || 'all');
      else if (action === 'filter-route') filterRoute(actionElement.dataset.filter || 'all');
      else if (action === 'show-more') showMore(actionElement.dataset.group);
      else if (action === 'set-section-view') setSectionView(actionElement.dataset.group, actionElement.dataset.view);
      else if (action === 'save-listing') saveListing(actionElement.dataset.id);
      else if (action === 'share-listing') shareListing(actionElement.dataset.id);
      else if (action === 'share-dataset') shareDataset(actionElement);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const card = event.target.closest('.listing');
    if (card && !event.target.closest('a,button,input,select,textarea,label')) {
      const item = listings.find((row) => catalogKey(row) === String(card.dataset.catalogKey || card.dataset.id || ''));
      if (item) window.location.assign(listingUrl(item));
    }
  });

  document.addEventListener('keydown', (event) => {
    if ($('#drawer')?.classList.contains('open')) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setDrawer(false);
        return;
      }
      if (event.key === 'Tab') {
        const focusable = drawerFocusable();
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (first && event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
          return;
        }
        if (last && !event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
          return;
        }
      }
    }
    if (!['Enter', ' '].includes(event.key) || !event.target.classList?.contains('listing')) return;
    event.preventDefault();
    const item = listings.find((row) => listingId(row) === String(event.target.dataset.id || ''));
    if (item) window.location.assign(listingUrl(item));
  });

  $$('#navLinks a, .drawerLinks a').forEach((link) => {
    link.addEventListener('click', (event) => {
      const href = link.getAttribute('href') || '';
      if (!href.startsWith('#')) return;
      event.preventDefault();
      scrollToSection(href.slice(1));
      setDrawer(false);
    });
  });
})();

// Keep the service tab row natively swipeable without intercepting taps/clicks.
(() => {
  const tabs = document.getElementById('searchTabs');
  if (!tabs) return;
  tabs.addEventListener('wheel', (event) => {
    if (tabs.scrollWidth <= tabs.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    tabs.scrollLeft += event.deltaY;
  }, { passive: false });
})();
