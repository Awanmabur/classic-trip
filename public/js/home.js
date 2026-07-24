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
  };

  const serviceIcons = {
    bus: 'fa-bus',
    hotel: 'fa-hotel',
  };

  const initialLimit = () => (window.matchMedia('(max-width: 680px)').matches ? 3 : 6);
  const visibleCounts = Object.fromEntries(Object.keys(groupConfig).map((group) => [group, initialLimit()]));
  let activeCorridor = 'all';

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
    return `${escapeHtml(code)} ${Math.round(value).toLocaleString()}`;
  }

  function toast(message) {
    const element = $('#toast');
    if (!element) return;
    element.textContent = String(message || '');
    element.classList.add('show');
    clearTimeout(window.__classicTripToast);
    window.__classicTripToast = setTimeout(() => element.classList.remove('show'), 2400);
  }

  function csrfToken() {
    return $('meta[name="csrf-token"]')?.getAttribute('content') || '';
  }

  function listingId(item) {
    return String(item?.id || item?._id || '').trim();
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
    if (item?.isSponsored) return { className: 'promo', icon: 'fa-bullhorn', text: 'Sponsored' };
    if (item?.bookable) return { className: 'available', icon: 'fa-circle-check', text: Number.isFinite(remaining) ? `${remaining} available` : 'Available' };
    if (Number.isFinite(remaining) && remaining <= 0) return { className: 'full', icon: 'fa-circle-xmark', text: 'No inventory' };
    return { className: 'promo', icon: 'fa-clock', text: 'View service' };
  }

  function cardHtml(item) {
    const id = listingId(item);
    const group = String(item.group || item.serviceType || 'more');
    const type = String(item.serviceType || item.type || group || 'service').toLowerCase();
    const isBus = type === 'bus';
    const icon = serviceIcons[type] || 'fa-ticket';
    const badge = availabilityBadge(item);
    const image = safeImageUrl(item.img || item.image || item.media?.[0]?.url || '');
    const route = item.routeLabel || [item.from, item.to].filter(Boolean).join(' → ');
    const place = isBus ? (route || 'Route information') : (item.location || item.city || route || 'Property location');
    const rating = Number(item.ratingAverage || item.rating);
    const ratingText = Number.isFinite(rating) && rating > 0 ? rating.toFixed(1) : 'New';
    const partner = item.partner || item.companyName || 'Service partner';
    const amount = Number(item.priceFrom ?? item.price ?? 0);
    const price = amount > 0 ? money(amount, item.currency) : 'Price pending';
    const description = item.sub || item.shortDescription || item.description || (isBus
      ? 'Public bus service with live departure and seat availability.'
      : 'Verified hotel property with dated room availability and secure booking.');
    const priceHint = item.bookable
      ? (isBus ? 'Starting fare · choose boarding and drop-off' : 'Starting price · per available room night')
      : 'Open service details';

    return `<article class="listing marketplaceListingCard${isBus ? ' referenceBusCard' : ''}" data-id="${escapeHtml(id)}" data-group="${escapeHtml(group)}" data-corridor="${escapeHtml(item.corridor || 'regional')}">
      <a class="listingThumbLink" href="${escapeHtml(listingUrl(item))}" aria-label="View ${escapeHtml(item.title || 'service')}">
        <div class="thumb">
          ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(item.title || 'Service image')}">` : '<div class="listingImageEmpty"><i class="fa-solid fa-image"></i></div>'}
          <div class="cornerBadge ${escapeHtml(badge.className)}"><i class="fa-solid ${escapeHtml(badge.icon)}"></i> ${escapeHtml(badge.text)}</div>
          <div class="thumbBadges"><span class="badge badgeOk"><i class="fa-solid fa-star"></i> ${escapeHtml(ratingText)}</span><span class="badge badgeInfo"><i class="fa-solid ${escapeHtml(icon)}"></i> ${escapeHtml(item.typeLabel || (isBus ? 'Bus' : type === 'hotel' ? 'Hotel' : 'Service'))}</span></div>
        </div>
      </a>
      <div class="listingBody">
        <h3 class="listingTitle"><a href="${escapeHtml(listingUrl(item))}">${escapeHtml(item.title || 'Untitled service')}</a></h3>
        <div class="meta"><span><i class="fa-solid ${isBus ? 'fa-route' : 'fa-location-dot'}"></i> ${escapeHtml(place)}</span><span><i class="fa-solid fa-building"></i> ${escapeHtml(partner)}</span></div>
        <p class="desc">${escapeHtml(description)}</p>
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
    container.innerHTML = shown.length
      ? shown.map(cardHtml).join('')
      : `<div class="card marketplaceEmptyCard" data-home-empty="${escapeHtml(group)}"><strong>No published ${escapeHtml(config.label)} yet</strong><p class="muted">Services will appear after their complete records and bookable inventory are published.</p></div>`;

    const button = document.getElementById(`more-${group}`);
    if (button) {
      const remaining = rows.length - shown.length;
      button.classList.toggle('hide', remaining <= 0);
      button.innerHTML = `<i class="fa-solid fa-plus"></i> More ${Math.min(initialLimit(), Math.max(remaining, 0))}`;
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
    visibleCounts[group] = Math.min(visibleCounts[group] + initialLimit(), rows.length);
    renderGroup(group);
    updateSavedButtons();
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
    $('#drawer')?.classList.remove('open');
  }

  function filterRoute(corridor) {
    activeCorridor = corridor || 'all';
    activateButtonSet('#routeFilters button, #drawerRouteFilters button', activeCorridor);
    applyCorridorHighlight();
    const match = listings.find((item) => equivalentCorridor(item.corridor) === equivalentCorridor(activeCorridor));
    if (match && groupConfig[match.group]) {
      const rows = listings.filter((item) => item.group === match.group);
      visibleCounts[match.group] = Math.max(visibleCounts[match.group], rows.findIndex((item) => listingId(item) === listingId(match)) + 1);
      renderGroup(match.group);
      updateSavedButtons();
      applyCorridorHighlight();
      scrollToSection(groupConfig[match.group].section);
    } else {
      scrollToSection('bus');
      if (activeCorridor !== 'all') toast('No published service currently matches this corridor.');
    }
    $('#drawer')?.classList.remove('open');
  }

  function runSearch() {
    const activeTab = $('#searchTabs .tab.active');
    const serviceType = activeTab?.dataset.type || 'bus';
    const params = new URLSearchParams({ serviceType });
    const date = $('#dateInput')?.value;
    if (date) params.set('date', date);
    if (serviceType === 'hotel') {
      const city = $('#cityInput')?.value.trim();
      if (city) params.set('city', city);
    } else {
      const origin = $('#fromInput')?.value.trim();
      const destination = $('#toInput')?.value.trim();
      if (origin) params.set('origin', origin);
      if (destination) params.set('destination', destination);
    }
    window.location.assign(`/search?${params.toString()}`);
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
  }

  function shareDataset(button) {
    const url = safeInternalUrl(button.dataset.u, '/');
    const absoluteUrl = new URL(url, window.location.origin).href;
    if (navigator.share) navigator.share({ title: button.dataset.t || 'Classic Trip', url: absoluteUrl }).catch(() => {});
    else navigator.clipboard?.writeText(absoluteUrl).then(() => toast('Share link copied.')).catch(() => {});
  }

  setupDrawerFilters();
  render();

  const savedTheme = localStorage.getItem('classicTripTheme') || localStorage.getItem('ct-theme') || localStorage.getItem('ct_auth_theme');
  if (savedTheme) setTheme(savedTheme);
  const dateInput = $('#dateInput');
  if (dateInput) dateInput.min = new Date().toISOString().slice(0, 10);

  $('#themeBtn')?.addEventListener('click', () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));
  $('#menuBtn')?.addEventListener('click', () => $('#drawer')?.classList.add('open'));
  $('#closeDrawer')?.addEventListener('click', () => $('#drawer')?.classList.remove('open'));
  $('#drawer')?.addEventListener('click', (event) => { if (event.target.id === 'drawer') $('#drawer').classList.remove('open'); });

  $('#searchTabs')?.addEventListener('click', (event) => {
    const tab = event.target.closest('.tab');
    if (!tab) return;
    $$('.tab', $('#searchTabs')).forEach((item) => item.classList.toggle('active', item === tab));
    const hotel = tab.dataset.type === 'hotel';
    $('#cityField')?.classList.toggle('hide', !hotel);
    $('#fromField')?.classList.toggle('hide', hotel);
    $('#toField')?.classList.toggle('hide', hotel);
  });

  document.addEventListener('click', (event) => {
    const actionElement = event.target.closest('[data-home-action]');
    if (actionElement) {
      const action = actionElement.dataset.homeAction;
      if (action === 'scroll-section') scrollToSection(actionElement.dataset.sectionId);
      else if (action === 'navigate' && actionElement.dataset.url?.startsWith('/')) window.location.assign(actionElement.dataset.url);
      else if (action === 'drawer-toggle') $('#drawer')?.classList.toggle('open');
      else if (action === 'run-search') runSearch();
      else if (action === 'filter-cards') filterCards(actionElement.dataset.filter || 'all');
      else if (action === 'filter-route') filterRoute(actionElement.dataset.filter || 'all');
      else if (action === 'show-more') showMore(actionElement.dataset.group);
      else if (action === 'save-listing') saveListing(actionElement.dataset.id);
      else if (action === 'share-listing') shareListing(actionElement.dataset.id);
      else if (action === 'share-dataset') shareDataset(actionElement);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const card = event.target.closest('.listing');
    if (card && !event.target.closest('a,button,input,select,textarea,label')) {
      const item = listings.find((row) => listingId(row) === String(card.dataset.id || ''));
      if (item) window.location.assign(listingUrl(item));
    }
  });

  document.addEventListener('keydown', (event) => {
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
      $('#drawer')?.classList.remove('open');
    });
  });
})();
