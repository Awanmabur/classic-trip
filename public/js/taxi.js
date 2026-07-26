(function () {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  let bootstrap = {};
  try { bootstrap = JSON.parse($('#taxiPageBootstrap')?.textContent || '{}'); } catch (_) { bootstrap = {}; }

  const state = {
    selected: null,
    quotes: [],
    timeMode: 'now',
    places: { pickup: null, destination: null },
    stops: new Map(),
    stopCounter: 0,
    timers: {},
    map: null,
    routeLayer: null,
    markers: [],
  };

  const storageKey = (name) => `classicTripRidePlace:${name}`;
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const uid = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const cash = (price = {}) => `${price.currency || ''} ${Number(price.total || 0).toLocaleString('en-GB')}`.trim();

  function message(text, kind = 'error') {
    const node = $('#taxiMessage');
    if (!node) return;
    node.textContent = text || '';
    node.className = `travelMessage${text ? ` show ${kind}` : ''}`;
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(options.headers || {}) },
      ...options,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || 'Request failed');
    return data;
  }

  function setLocationStatus(text) {
    const node = $('#taxiLocationStatus');
    if (node) node.textContent = text;
  }

  function pointFromPlace(place) {
    if (!place) return null;
    const latitude = Number(place.latitude);
    const longitude = Number(place.longitude);
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? [latitude, longitude] : null;
  }

  function markerIcon(kind, label) {
    if (!window.L) return null;
    return window.L.divIcon({
      className: 'ctMapMarkerWrap',
      html: `<span class="ctMapMarker ${esc(kind)}" aria-label="${esc(label)}"><i class="fa-solid ${kind === 'pickup' ? 'fa-circle-dot' : kind === 'driver' ? 'fa-location-arrow' : kind === 'stop' ? 'fa-circle' : 'fa-location-dot'}"></i></span>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });
  }

  function initMap() {
    const holder = $('#taxiMap');
    if (!holder || !window.L) {
      $('#taxiMapStatus')?.classList.add('mapUnavailable');
      return;
    }
    const config = bootstrap.map || {};
    state.map = window.L.map(holder, { zoomControl: true, attributionControl: true, preferCanvas: true })
      .setView([Number(config.defaultLatitude || 0.3476), Number(config.defaultLongitude || 32.5825)], Number(config.defaultZoom || 12));
    window.L.tileLayer(config.tileUrl || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: config.tileAttribution || '&copy; OpenStreetMap contributors',
    }).addTo(state.map);
    setTimeout(() => state.map?.invalidateSize(), 80);
  }

  function clearMapLayers() {
    if (!state.map) return;
    if (state.routeLayer) state.map.removeLayer(state.routeLayer);
    state.routeLayer = null;
    state.markers.forEach((marker) => state.map.removeLayer(marker));
    state.markers = [];
  }

  function orderedStops() {
    return [...state.stops.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([, value]) => value).filter(Boolean);
  }

  function drawRoute(route = null) {
    if (!state.map || !window.L) return;
    clearMapLayers();
    const pickup = pointFromPlace(state.places.pickup);
    const destination = pointFromPlace(state.places.destination);
    const stopPoints = orderedStops().map(pointFromPlace).filter(Boolean);
    const routePoints = Array.isArray(route?.geometry)
      ? route.geometry.map((row) => pointFromPlace(row)).filter(Boolean)
      : [pickup, ...stopPoints, destination].filter(Boolean);

    const addMarker = (latlng, kind, label) => {
      if (!latlng) return;
      const marker = window.L.marker(latlng, { icon: markerIcon(kind, label), keyboard: true, title: label }).addTo(state.map);
      marker.bindTooltip(label, { direction: 'top', offset: [0, -12] });
      state.markers.push(marker);
    };
    addMarker(pickup, 'pickup', 'Pickup');
    stopPoints.forEach((latlng, index) => addMarker(latlng, 'stop', `Stop ${index + 1}`));
    addMarker(destination, 'destination', 'Destination');

    if (routePoints.length >= 2) {
      state.routeLayer = window.L.polyline(routePoints, { weight: 5, opacity: 0.92, lineCap: 'round', lineJoin: 'round' }).addTo(state.map);
      const group = window.L.featureGroup([state.routeLayer, ...state.markers]);
      state.map.fitBounds(group.getBounds().pad(0.18), { maxZoom: 16, animate: true });
    } else if (routePoints.length === 1) {
      state.map.setView(routePoints[0], 15, { animate: true });
    }

    const status = $('#taxiMapStatus');
    if (status) {
      const isLive = route?.source === 'live';
      status.className = `mapStatus${routePoints.length ? ' hasRoute' : ''}${isLive ? ' liveRoute' : ''}`;
      status.innerHTML = routePoints.length >= 2
        ? `<i class="fa-solid ${isLive ? 'fa-route' : 'fa-map-location-dot'}"></i><span>${isLive ? 'Live road route loaded.' : 'Route preview shown. Live routing is used when configured.'}</span>`
        : '<i class="fa-solid fa-map-location-dot"></i><span>Choose pickup and destination to preview your route.</span>';
    }
  }

  function updatePreview(route = null) {
    const pickup = state.places.pickup;
    const destination = state.places.destination;
    $('#routePickupLabel').textContent = pickup?.shortName || pickup?.name || pickup?.address || 'Pickup';
    $('#routePickupMeta').textContent = pickup ? [pickup.city, pickup.district, pickup.country].filter(Boolean).join(', ') || pickup.address : 'Choose your starting point';
    $('#routeDestinationLabel').textContent = destination?.shortName || destination?.name || destination?.address || 'Destination';
    $('#routeDestinationMeta').textContent = destination ? [destination.city, destination.district, destination.country].filter(Boolean).join(', ') || destination.address : 'Choose where you are going';
    drawRoute(route);
  }

  function staticInput(type) { return $(`#${type}Search`); }
  function staticBox(type) { return $(`#${type}Suggestions`); }

  function writeHiddenPlace(type, place) {
    if (!['pickup', 'destination'].includes(type)) return;
    const values = {
      PlaceId: place.id || place.placeId || '',
      Latitude: Number(place.latitude),
      Longitude: Number(place.longitude),
      City: place.city || '',
      District: place.district || '',
      Country: place.country || '',
      CountryCode: place.countryCode || '',
    };
    Object.entries(values).forEach(([suffix, value]) => {
      const node = $(`#${type}${suffix}`);
      if (node) node.value = value;
    });
  }

  function setStaticPlace(type, place, options = {}) {
    state.places[type] = place;
    const input = staticInput(type);
    if (input) input.value = place.address || place.name || place.shortName || '';
    writeHiddenPlace(type, place);
    staticBox(type)?.classList.add('hidden');
    if (options.saveAs) localStorage.setItem(storageKey(options.saveAs), JSON.stringify(place));
    updatePreview();
  }

  function clearStaticPlace(type) {
    state.places[type] = null;
    ['PlaceId', 'Latitude', 'Longitude', 'City', 'District', 'Country', 'CountryCode'].forEach((suffix) => {
      const node = $(`#${type}${suffix}`);
      if (node) node.value = '';
    });
    updatePreview();
  }

  function placeIcon(place = {}) {
    if (place.type === 'airport') return 'fa-plane';
    if (place.type === 'office') return 'fa-building';
    if (place.type === 'hotel') return 'fa-hotel';
    return 'fa-location-dot';
  }

  function renderSuggestions(box, places, onSelect) {
    if (!box) return;
    box.innerHTML = places.length
      ? places.map((place, index) => `<button type="button" class="placeSuggestion" data-place-index="${index}"><i class="fa-solid ${placeIcon(place)}"></i><span><b>${esc(place.name || place.address)}</b><small>${esc([place.city, place.district, place.country].filter(Boolean).join(', '))}</small></span></button>`).join('')
      : '<div class="placeEmpty">No trusted place found. Try a nearby landmark, office, stay, airport or town.</div>';
    box.classList.remove('hidden');
    $$('[data-place-index]', box).forEach((button) => button.addEventListener('click', () => onSelect(places[Number(button.dataset.placeIndex)])));
  }

  async function searchPlaces(query, box, onSelect) {
    if (String(query || '').trim().length < 2) {
      box?.classList.add('hidden');
      return;
    }
    try {
      const result = await api(`/api/v1/places/search?q=${encodeURIComponent(String(query).trim())}&limit=12`);
      renderSuggestions(box, result.places || [], onSelect);
    } catch (_) {
      renderSuggestions(box, [], onSelect);
    }
  }

  ['pickup', 'destination'].forEach((type) => {
    const input = staticInput(type);
    const box = staticBox(type);
    if (!input) return;
    input.addEventListener('input', () => {
      clearStaticPlace(type);
      clearTimeout(state.timers[type]);
      state.timers[type] = setTimeout(() => searchPlaces(input.value, box, (place) => setStaticPlace(type, place)), 240);
    });
    input.addEventListener('focus', () => {
      if (input.value.trim().length >= 2 && !state.places[type]) searchPlaces(input.value, box, (place) => setStaticPlace(type, place));
    });
  });

  function addStopRow() {
    if (state.stops.size >= 4) return message('A ride may include at most four stops.');
    const key = ++state.stopCounter;
    const holder = $('#rideStopsList');
    const row = document.createElement('div');
    row.className = 'rideStopRow placeField';
    row.dataset.stopKey = String(key);
    row.innerHTML = `<div class="travelControl"><i class="fa-solid fa-location-dot"></i><input type="text" placeholder="Stop ${key}: landmark, office or town" aria-label="Ride stop ${key}" autocomplete="off"><button class="inputIconBtn removeStopBtn" type="button" aria-label="Remove stop"><i class="fa-solid fa-xmark"></i></button></div><div class="placeSuggestions hidden" role="listbox"></div>`;
    holder.appendChild(row);
    const input = $('input', row);
    const box = $('.placeSuggestions', row);
    const selectStop = (place) => {
      state.stops.set(key, place);
      input.value = place.address || place.name || '';
      box.classList.add('hidden');
      updatePreview();
    };
    input.addEventListener('input', () => {
      state.stops.delete(key);
      clearTimeout(state.timers[`stop-${key}`]);
      state.timers[`stop-${key}`] = setTimeout(() => searchPlaces(input.value, box, selectStop), 240);
      updatePreview();
    });
    input.addEventListener('focus', () => {
      if (input.value.trim().length >= 2 && !state.stops.has(key)) searchPlaces(input.value, box, selectStop);
    });
    $('.removeStopBtn', row).addEventListener('click', () => {
      state.stops.delete(key);
      row.remove();
      updatePreview();
    });
    input.focus();
  }

  $('#addRideStop')?.addEventListener('click', addStopRow);
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.placeField')) $$('.placeSuggestions').forEach((box) => box.classList.add('hidden'));
  });

  function currentLocation() {
    if (!navigator.geolocation) return message('Current location is not supported by this browser.');
    setLocationStatus('Getting your current location…');
    navigator.geolocation.getCurrentPosition((position) => {
      const place = {
        id: 'current-location', placeId: 'current-location', name: 'Current location', shortName: 'Current location', address: 'Current GPS location',
        latitude: position.coords.latitude, longitude: position.coords.longitude, city: '', district: '', country: '', countryCode: '', type: 'current_location',
      };
      setStaticPlace('pickup', place);
      setLocationStatus(`Current pickup ready · accuracy about ${Math.round(position.coords.accuracy || 0)} m.`);
    }, () => {
      message('Allow location access or choose a pickup from the trusted suggestions.');
      setLocationStatus('Location permission was not granted.');
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  }

  async function airportShortcut() {
    const country = state.places.pickup?.country || '';
    const term = /south sudan/i.test(country) ? 'Juba International Airport' : /kenya/i.test(country) ? 'Jomo Kenyatta International Airport' : 'Entebbe International Airport';
    try {
      const result = await api(`/api/v1/places/search?q=${encodeURIComponent(term)}&limit=5`);
      const airport = (result.places || []).find((row) => row.type === 'airport') || result.places?.[0];
      if (!airport) throw new Error('No configured airport was found for this market.');
      setStaticPlace('destination', airport);
    } catch (error) { message(error.message); }
  }

  function savedShortcut(name) {
    const saved = localStorage.getItem(storageKey(name));
    if (saved) {
      try { return setStaticPlace('pickup', JSON.parse(saved)); } catch (_) { localStorage.removeItem(storageKey(name)); }
    }
    if (state.places.pickup) {
      setStaticPlace('pickup', state.places.pickup, { saveAs: name });
      return message(`${name === 'home' ? 'Home' : 'Work'} saved from your current pickup.`, 'success');
    }
    message(`Choose your ${name} pickup first, then press ${name === 'home' ? 'Home' : 'Work'} again to save it.`);
  }

  $$('[data-ride-shortcut]').forEach((button) => button.addEventListener('click', () => {
    const action = button.dataset.rideShortcut;
    if (action === 'current') currentLocation();
    else if (action === 'airport') airportShortcut();
    else savedShortcut(action);
  }));
  $('[data-current-pickup]')?.addEventListener('click', currentLocation);

  $$('[data-ride-time]').forEach((button) => button.addEventListener('click', () => {
    state.timeMode = button.dataset.rideTime;
    $$('[data-ride-time]').forEach((item) => item.classList.toggle('active', item === button));
    $('#scheduledRideField').classList.toggle('hidden', state.timeMode !== 'scheduled');
    if (state.timeMode === 'scheduled') $('#scheduledPickupAt').focus();
  }));

  const min = new Date(Date.now() + 15 * 60 * 1000);
  $('#scheduledPickupAt').min = new Date(min.getTime() - min.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  function publicStop(place) {
    return {
      placeId: place.id || place.placeId,
      address: place.address || place.name,
      latitude: Number(place.latitude), longitude: Number(place.longitude),
      city: place.city || '', district: place.district || '', country: place.country || '', countryCode: place.countryCode || '',
    };
  }

  function quotePayload() {
    const pickup = state.places.pickup;
    const destination = state.places.destination;
    if (!pickup || !destination) throw new Error('Choose both pickup and destination from the suggestions, or use current location.');
    const payload = {
      pickupPlaceId: pickup.id || pickup.placeId, pickupAddress: pickup.address || pickup.name, pickupLatitude: pickup.latitude, pickupLongitude: pickup.longitude, pickupCity: pickup.city, pickupDistrict: pickup.district, pickupCountry: pickup.country, pickupCountryCode: pickup.countryCode,
      destinationPlaceId: destination.id || destination.placeId, destinationAddress: destination.address || destination.name, destinationLatitude: destination.latitude, destinationLongitude: destination.longitude, destinationCity: destination.city, destinationDistrict: destination.district, destinationCountry: destination.country, destinationCountryCode: destination.countryCode,
      passengerCount: Number($('#passengerCount').value || 1), luggageCount: Number($('#luggageCount').value || 0),
      stops: orderedStops().map(publicStop),
    };
    if (state.timeMode === 'scheduled') {
      if (!$('#scheduledPickupAt').value) throw new Error('Choose the scheduled pickup date and time.');
      payload.scheduledPickupAt = $('#scheduledPickupAt').value;
      payload.serviceType = 'scheduled';
    }
    return payload;
  }

  function renderQuotes(result) {
    state.quotes = result.quotes || [];
    $('#taxiQuotesPanel').classList.remove('hidden');
    $('#taxiQuoteCount').textContent = `${state.quotes.length} ride${state.quotes.length === 1 ? '' : 's'}`;
    const service = String(result.criteria.serviceType || 'instant').replaceAll('_', ' ');
    const routeSource = result.criteria.route?.source === 'live' ? 'live road route' : 'route estimate';
    $('#taxiQuoteSummary').textContent = `${service} · ${result.criteria.distanceKm} km · about ${result.criteria.durationMinutes} minutes · ${routeSource}`;
    $('#routeDistance').textContent = `${result.criteria.distanceKm} km`;
    $('#routeDuration').textContent = `${result.criteria.durationMinutes} min`;
    updatePreview(result.criteria.route || null);

    $('#taxiQuotes').innerHTML = state.quotes.map((quote, index) => {
      const type = String(quote.vehicleClass?.vehicleType || quote.vehicleClass?.code || '').toLowerCase();
      const icon = /boda|motor/.test(type) ? 'fa-motorcycle' : /van|suv/.test(type) ? 'fa-van-shuttle' : 'fa-car-side';
      const capacity = Number(quote.vehicleClass?.passengerCapacity || 1);
      return `<article class="quoteCard safeRideQuote"><div class="quoteTop"><div class="safeRideClass"><span class="rideClassIcon"><i class="fa-solid ${icon}"></i></span><div><div class="offerRoute">${esc(quote.vehicleClass?.name || 'Ride')}</div><div class="quoteMeta"><span>Up to ${capacity} passenger${capacity === 1 ? '' : 's'}</span><span>${Number(quote.vehicleClass?.luggageCapacity || 0)} luggage</span><span>${esc(String(quote.serviceType || '').replaceAll('_', ' '))}</span></div></div></div><div><div class="quotePrice">${cash(quote.price)}</div><div class="muted safeFareLabel">Locked upfront price</div></div></div><div class="fareBreakdown"><span>Base ${esc(quote.price?.currency || '')} ${Number(quote.price?.baseFare || 0).toLocaleString('en-GB')}</span><span>Distance ${esc(quote.price?.currency || '')} ${Math.round(Number(quote.price?.distanceFare || 0)).toLocaleString('en-GB')}</span>${Number(quote.price?.airportFee || 0) ? `<span>Airport fee ${esc(quote.price.currency)} ${Math.round(Number(quote.price.airportFee)).toLocaleString('en-GB')}</span>` : ''}</div><button class="btn btnPrimary" type="button" data-book-quote="${index}">Choose ${esc(quote.vehicleClass?.name || 'ride')}</button></article>`;
    }).join('');
    $$('[data-book-quote]').forEach((button) => button.addEventListener('click', () => openCheckout(state.quotes[Number(button.dataset.bookQuote)])));
    $('#taxiQuotesPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function openCheckout(quote) {
    state.selected = quote;
    $('#taxiRideCheckout')?.remove();
    const section = document.createElement('section');
    section.id = 'taxiRideCheckout';
    section.className = 'travelerCard safeRideCheckout';
    section.innerHTML = `<div class="travelerTitle"><div><h3>Passenger and payment</h3><span class="muted">${esc(quote.vehicleClass?.name)} · ${cash(quote.price)}</span></div><button class="btn btnGhost btnIconOnly" type="button" data-close-taxi-checkout aria-label="Close checkout"><i class="fa-solid fa-xmark"></i></button></div><form id="taxiRideForm" class="travelForm"><div class="travelFormGrid"><div class="travelField"><label>Passenger name</label><div class="travelControl"><i class="fa-regular fa-user"></i><input name="contactName" required autocomplete="name"></div></div><div class="travelField"><label>Phone</label><div class="travelControl"><i class="fa-solid fa-phone"></i><input name="phone" required inputmode="tel" autocomplete="tel"></div></div><div class="travelField"><label>Email (optional)</label><div class="travelControl"><i class="fa-regular fa-envelope"></i><input type="email" name="email" autocomplete="email"></div></div><div class="travelField"><label>Payment</label><div class="travelControl"><i class="fa-solid fa-wallet"></i><select name="provider"><option value="mtn_momo">MTN Mobile Money</option><option value="airtel_money">Airtel Money</option><option value="pesapal">Card or Pesapal</option><option value="flutterwave">Flutterwave</option><option value="paystack">Paystack</option><option value="dpo">DPO</option></select></div></div></div><div class="secureNote"><i class="fa-solid fa-lock"></i><span>You will receive a private trip lookup code and pickup PIN. Share the pickup PIN only after the assigned driver arrives.</span></div><button class="btn btnPrimary checkoutSubmit" type="submit"><i class="fa-solid fa-lock"></i> Confirm and pay ${cash(quote.price)}</button><div class="travelMessage" id="taxiRideMessage" role="status" aria-live="polite"></div></form>`;
    $('#taxiQuotesPanel').appendChild(section);
    $('[data-close-taxi-checkout]', section).addEventListener('click', () => section.remove());
    $('#taxiRideForm').addEventListener('submit', submitRide);
    section.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function rideMessage(text, kind = 'error') {
    const node = $('#taxiRideMessage');
    if (!node) return;
    node.textContent = text || '';
    node.className = `travelMessage${text ? ` show ${kind}` : ''}`;
  }

  async function submitRide(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = $('button[type="submit"]', form);
    if (submit) submit.disabled = true;
    rideMessage('Creating your protected ride…', 'success');
    try {
      const idem = uid('taxi-ride');
      const result = await api('/api/v1/taxi/rides', {
        method: 'POST',
        headers: { 'Idempotency-Key': idem },
        body: JSON.stringify({
          quoteId: state.selected.quoteId,
          quoteToken: state.selected.quoteToken,
          contactName: form.contactName.value,
          phone: form.phone.value,
          email: form.email.value,
          passengerCount: Number($('#passengerCount').value || 1),
          luggageCount: Number($('#luggageCount').value || 0),
          idempotencyKey: idem,
        }),
      });
      const bookingRef = result.booking?.bookingRef || result.ride?.bookingRef;
      const lookupCode = result.booking?.guestLookupCode || '';
      const pickupPin = result.pickupPin || '';
      sessionStorage.setItem(`classicTripTaxiLookup:${bookingRef}`, lookupCode);
      sessionStorage.setItem(`classicTripTaxiPin:${bookingRef}`, pickupPin);
      const paymentIdem = uid('taxi-payment');
      const payment = await api(`/api/v1/taxi/rides/${encodeURIComponent(bookingRef)}/payment`, {
        method: 'POST',
        headers: { 'Idempotency-Key': paymentIdem },
        body: JSON.stringify({ provider: form.provider.value, idempotencyKey: paymentIdem }),
      });
      rideMessage(`Ride ${bookingRef} created. Keep pickup PIN ${pickupPin} private.`, 'success');
      if (payment.checkoutUrl) return window.location.assign(payment.checkoutUrl);
      window.location.assign(`/taxi/rides/${encodeURIComponent(bookingRef)}?lookupCode=${encodeURIComponent(lookupCode)}`);
    } catch (error) {
      rideMessage(error.message);
      if (submit) submit.disabled = false;
    }
  }

  $('#taxiQuoteForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = $('button[type="submit"]', event.currentTarget);
    if (submit) submit.disabled = true;
    message('Checking live road distance, service coverage and verified ride classes…', 'success');
    try {
      const result = await api('/api/v1/taxi/quotes', { method: 'POST', body: JSON.stringify(quotePayload()) });
      renderQuotes(result);
      message('Choose the verified ride that fits your journey.', 'success');
    } catch (error) {
      message(error.message);
    } finally {
      if (submit) submit.disabled = false;
    }
  });

  const query = bootstrap.query || {};
  if (query.origin) { $('#pickupSearch').value = query.origin; searchPlaces(query.origin, $('#pickupSuggestions'), (place) => setStaticPlace('pickup', place)); }
  if (query.destination) { $('#destinationSearch').value = query.destination; searchPlaces(query.destination, $('#destinationSuggestions'), (place) => setStaticPlace('destination', place)); }

  initMap();
  updatePreview();
  window.addEventListener('resize', () => state.map?.invalidateSize());
})();
