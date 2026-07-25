(function () {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const bootstrap = JSON.parse($('#taxiPageBootstrap')?.textContent || '{}');
  const state = { selected: null, quotes: [], timeMode: 'now', places: { pickup: null, destination: null, stop: null }, timers: {} };
  const storageKey = (name) => `classicTripRidePlace:${name}`;
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const uid = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const cash = (price = {}) => `${price.currency || ''} ${Number(price.total || 0).toLocaleString('en-GB')}`.trim();
  const message = (text, kind = 'error') => { const node = $('#taxiMessage'); node.textContent = text || ''; node.className = `travelMessage${text ? ` show ${kind}` : ''}`; };
  async function api(url, options = {}) { const response = await fetch(url, { headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(options.headers || {}) }, ...options }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.message || data.error || 'Request failed'); return data; }
  function setLocationStatus(text) { $('#taxiLocationStatus').textContent = text; }
  function placeInput(type) { return $(`#${type}Search`); }
  function suggestionBox(type) { return $(`#${type}Suggestions`); }
  function setPlace(type, place, options = {}) {
    state.places[type] = place;
    const input = placeInput(type); if (input) input.value = place.address || place.name || place.shortName || '';
    if (type !== 'stop') {
      const prefix = type;
      $(`#${prefix}PlaceId`).value = place.id || place.placeId || '';
      $(`#${prefix}Latitude`).value = Number(place.latitude);
      $(`#${prefix}Longitude`).value = Number(place.longitude);
      $(`#${prefix}City`).value = place.city || '';
      $(`#${prefix}District`).value = place.district || '';
      $(`#${prefix}Country`).value = place.country || '';
      $(`#${prefix}CountryCode`).value = place.countryCode || '';
    }
    suggestionBox(type)?.classList.add('hidden');
    if (options.saveAs) localStorage.setItem(storageKey(options.saveAs), JSON.stringify(place));
    updatePreview();
  }
  function clearPlace(type) {
    state.places[type] = null;
    if (type !== 'stop') ['PlaceId','Latitude','Longitude','City','District','Country','CountryCode'].forEach((suffix) => { const node = $(`#${type}${suffix}`); if (node) node.value = ''; });
    updatePreview();
  }
  function updatePreview() {
    const pickup = state.places.pickup; const destination = state.places.destination;
    $('#routePickupLabel').textContent = pickup?.shortName || pickup?.name || pickup?.address || 'Pickup';
    $('#routePickupMeta').textContent = pickup ? [pickup.city, pickup.district, pickup.country].filter(Boolean).join(', ') : 'Choose your starting point';
    $('#routeDestinationLabel').textContent = destination?.shortName || destination?.name || destination?.address || 'Destination';
    $('#routeDestinationMeta').textContent = destination ? [destination.city, destination.district, destination.country].filter(Boolean).join(', ') : 'Choose where you are going';
  }
  function renderSuggestions(type, places) {
    const box = suggestionBox(type); if (!box) return;
    box.innerHTML = places.length ? places.map((place, index) => `<button type="button" class="placeSuggestion" data-place-index="${index}"><i class="fa-solid ${place.type === 'airport' ? 'fa-plane' : place.type === 'office' ? 'fa-building' : 'fa-location-dot'}"></i><span><b>${esc(place.name || place.address)}</b><small>${esc([place.city, place.district, place.country].filter(Boolean).join(', '))}</small></span></button>`).join('') : '<div class="placeEmpty">No trusted place found. Try a nearby landmark, office, hotel or town.</div>';
    box.classList.remove('hidden');
    $$('[data-place-index]', box).forEach((button) => button.addEventListener('click', () => setPlace(type, places[Number(button.dataset.placeIndex)])));
  }
  async function searchPlaces(type, query) {
    if (query.trim().length < 2) { suggestionBox(type)?.classList.add('hidden'); return; }
    try { const result = await api(`/api/v1/places/search?q=${encodeURIComponent(query.trim())}&limit=10`); renderSuggestions(type, result.places || []); } catch (_) { renderSuggestions(type, []); }
  }
  ['pickup','destination','stop'].forEach((type) => { const input = placeInput(type); if (!input) return; input.addEventListener('input', () => { clearPlace(type); clearTimeout(state.timers[type]); state.timers[type] = setTimeout(() => searchPlaces(type, input.value), 220); }); input.addEventListener('focus', () => { if (input.value.trim().length >= 2 && !state.places[type]) searchPlaces(type, input.value); }); });
  document.addEventListener('click', (event) => { if (!event.target.closest('.placeField')) $$('.placeSuggestions').forEach((box) => box.classList.add('hidden')); });

  function currentLocation() {
    if (!navigator.geolocation) return message('Current location is not supported by this browser.');
    setLocationStatus('Getting your current location…');
    navigator.geolocation.getCurrentPosition((position) => { const place = { id: 'current-location', placeId: 'current-location', name: 'Current location', shortName: 'Current location', address: 'Current location', latitude: position.coords.latitude, longitude: position.coords.longitude, city: '', district: '', country: '', countryCode: '', type: 'current_location' }; setPlace('pickup', place); setLocationStatus('Current pickup is ready.'); }, () => { message('Allow location access or choose a pickup from the suggestions.'); setLocationStatus('Location permission was not granted.'); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  }
  async function airportShortcut() {
    const country = state.places.pickup?.country || '';
    const term = /south sudan/i.test(country) ? 'Juba International Airport' : 'Entebbe International Airport';
    try { const result = await api(`/api/v1/places/search?q=${encodeURIComponent(term)}&limit=5`); const airport = (result.places || []).find((row) => row.type === 'airport') || result.places?.[0]; if (!airport) throw new Error('Airport place is not configured yet'); setPlace('destination', airport); } catch (error) { message(error.message); }
  }
  function savedShortcut(name) {
    const saved = localStorage.getItem(storageKey(name));
    if (saved) { try { return setPlace('pickup', JSON.parse(saved)); } catch (_) {}
    }
    if (state.places.pickup) { setPlace('pickup', state.places.pickup, { saveAs: name }); return message(`${name === 'home' ? 'Home' : 'Work'} saved from your current pickup.`, 'success'); }
    message(`Choose your ${name} pickup first, then press ${name === 'home' ? 'Home' : 'Work'} again to save it.`);
  }
  $$('[data-ride-shortcut]').forEach((button) => button.addEventListener('click', () => { const action = button.dataset.rideShortcut; if (action === 'current') currentLocation(); else if (action === 'airport') airportShortcut(); else savedShortcut(action); }));
  $('[data-current-pickup]')?.addEventListener('click', currentLocation);

  $$('[data-ride-time]').forEach((button) => button.addEventListener('click', () => { state.timeMode = button.dataset.rideTime; $$('[data-ride-time]').forEach((item) => item.classList.toggle('active', item === button)); $('#scheduledRideField').classList.toggle('hidden', state.timeMode !== 'scheduled'); if (state.timeMode === 'scheduled') $('#scheduledPickupAt').focus(); }));
  $('#extraStopToggle').addEventListener('change', () => { const show = $('#extraStopToggle').value === 'yes'; $('#extraStopField').classList.toggle('hidden', !show); if (!show) { state.places.stop = null; $('#stopSearch').value = ''; } });
  const min = new Date(Date.now() + 15 * 60 * 1000); $('#scheduledPickupAt').min = new Date(min.getTime() - min.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  function quotePayload() {
    const pickup = state.places.pickup; const destination = state.places.destination;
    if (!pickup || !destination) throw new Error('Choose both pickup and destination from the suggestions, or use current location.');
    const payload = {
      pickupPlaceId: pickup.id || pickup.placeId, pickupAddress: pickup.address || pickup.name, pickupLatitude: pickup.latitude, pickupLongitude: pickup.longitude, pickupCity: pickup.city, pickupDistrict: pickup.district, pickupCountry: pickup.country, pickupCountryCode: pickup.countryCode,
      destinationPlaceId: destination.id || destination.placeId, destinationAddress: destination.address || destination.name, destinationLatitude: destination.latitude, destinationLongitude: destination.longitude, destinationCity: destination.city, destinationDistrict: destination.district, destinationCountry: destination.country, destinationCountryCode: destination.countryCode,
      passengerCount: Number($('#passengerCount').value || 1), luggageCount: Number($('#luggageCount').value || 0),
    };
    if (state.timeMode === 'scheduled') { if (!$('#scheduledPickupAt').value) throw new Error('Choose the scheduled pickup date and time.'); payload.scheduledPickupAt = $('#scheduledPickupAt').value; payload.serviceType = 'scheduled'; }
    if (state.places.stop) payload.stops = [{ placeId: state.places.stop.id, address: state.places.stop.address || state.places.stop.name, latitude: state.places.stop.latitude, longitude: state.places.stop.longitude, city: state.places.stop.city, district: state.places.stop.district, country: state.places.stop.country, countryCode: state.places.stop.countryCode }];
    return payload;
  }
  function renderQuotes(result) {
    state.quotes = result.quotes || [];
    $('#taxiQuotesPanel').classList.remove('hidden'); $('#taxiQuoteCount').textContent = `${state.quotes.length} ride${state.quotes.length === 1 ? '' : 's'}`;
    const service = String(result.criteria.serviceType || 'instant').replaceAll('_', ' ');
    $('#taxiQuoteSummary').textContent = `${service} · ${result.criteria.distanceKm} km · about ${result.criteria.durationMinutes} minutes`;
    $('#routeDistance').textContent = `${result.criteria.distanceKm} km`; $('#routeDuration').textContent = `${result.criteria.durationMinutes} min`;
    $('#taxiQuotes').innerHTML = state.quotes.map((quote, index) => { const type = String(quote.vehicleClass?.vehicleType || quote.vehicleClass?.code || '').toLowerCase(); const icon = /boda|motor/.test(type) ? 'fa-motorcycle' : 'fa-car-side'; return `<article class="quoteCard safeRideQuote"><div class="quoteTop"><div class="safeRideClass"><span class="rideClassIcon"><i class="fa-solid ${icon}"></i></span><div><div class="offerRoute">${esc(quote.vehicleClass?.name || 'Ride')}</div><div class="quoteMeta"><span>Up to ${Number(quote.vehicleClass?.passengerCapacity || 1)} passenger${Number(quote.vehicleClass?.passengerCapacity || 1) === 1 ? '' : 's'}</span><span>${Number(quote.vehicleClass?.luggageCapacity || 0)} luggage</span></div></div></div><div><div class="quotePrice">${cash(quote.price)}</div><div class="muted safeFareLabel">Upfront estimate</div></div></div><button class="btn btnPrimary" type="button" data-book-quote="${index}">Choose ${esc(quote.vehicleClass?.name || 'ride')}</button></article>`; }).join('');
    $$('[data-book-quote]').forEach((button) => button.addEventListener('click', () => openCheckout(state.quotes[Number(button.dataset.bookQuote)])));
    $('#taxiQuotesPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function openCheckout(quote) {
    state.selected = quote; $('#taxiRideCheckout')?.remove();
    const section = document.createElement('section'); section.id = 'taxiRideCheckout'; section.className = 'travelerCard safeRideCheckout';
    section.innerHTML = `<div class="travelerTitle"><div><h3>Passenger and payment</h3><span class="muted">${esc(quote.vehicleClass?.name)} · ${cash(quote.price)}</span></div><button class="btn btnGhost" type="button" data-close-taxi-checkout aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div><form id="taxiRideForm" class="travelForm"><div class="travelFormGrid"><div class="travelField"><label>Passenger name</label><div class="travelControl"><i class="fa-regular fa-user"></i><input name="contactName" required></div></div><div class="travelField"><label>Phone</label><div class="travelControl"><i class="fa-solid fa-phone"></i><input name="phone" required inputmode="tel"></div></div><div class="travelField"><label>Email (optional)</label><div class="travelControl"><i class="fa-regular fa-envelope"></i><input type="email" name="email"></div></div><div class="travelField"><label>Payment</label><div class="travelControl"><i class="fa-solid fa-wallet"></i><select name="provider"><option value="mtn_momo">MTN Mobile Money</option><option value="airtel_money">Airtel Money</option><option value="pesapal">Card or Pesapal</option><option value="flutterwave">Flutterwave</option><option value="paystack">Paystack</option><option value="dpo">DPO</option></select></div></div></div><div class="secureNote"><i class="fa-solid fa-lock"></i><span>You will receive a private lookup code and pickup PIN. Do not share the pickup PIN until the driver arrives.</span></div><button class="btn btnPrimary" type="submit"><i class="fa-solid fa-lock"></i> Confirm and pay ${cash(quote.price)}</button><div class="travelMessage" id="taxiRideMessage"></div></form>`;
    $('#taxiQuotesPanel').appendChild(section); $('[data-close-taxi-checkout]', section).addEventListener('click', () => section.remove()); $('#taxiRideForm').addEventListener('submit', submitRide); section.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function rideMessage(text, kind = 'error') { const node = $('#taxiRideMessage'); if (!node) return; node.textContent = text || ''; node.className = `travelMessage${text ? ` show ${kind}` : ''}`; }
  async function submitRide(event) {
    event.preventDefault(); rideMessage('Creating your ride…', 'success'); const form = event.currentTarget;
    try { const idem = uid('taxi-ride'); const result = await api('/api/v1/taxi/rides', { method: 'POST', headers: { 'Idempotency-Key': idem }, body: JSON.stringify({ quoteId: state.selected.quoteId, quoteToken: state.selected.quoteToken, contactName: form.contactName.value, phone: form.phone.value, email: form.email.value, passengerCount: Number($('#passengerCount').value || 1), luggageCount: Number($('#luggageCount').value || 0), idempotencyKey: idem }) }); const bookingRef = result.booking?.bookingRef || result.ride?.bookingRef; const lookupCode = result.booking?.guestLookupCode || ''; const pickupPin = result.pickupPin || ''; sessionStorage.setItem(`classicTripTaxiLookup:${bookingRef}`, lookupCode); sessionStorage.setItem(`classicTripTaxiPin:${bookingRef}`, pickupPin); const paymentIdem = uid('taxi-payment'); const payment = await api(`/api/v1/taxi/rides/${encodeURIComponent(bookingRef)}/payment`, { method: 'POST', headers: { 'Idempotency-Key': paymentIdem }, body: JSON.stringify({ provider: form.provider.value, idempotencyKey: paymentIdem }) }); rideMessage(`Ride ${bookingRef} created. Keep pickup PIN ${pickupPin} private.`, 'success'); if (payment.checkoutUrl) return window.location.assign(payment.checkoutUrl); window.location.assign(`/taxi/rides/${encodeURIComponent(bookingRef)}?lookupCode=${encodeURIComponent(lookupCode)}`); } catch (error) { rideMessage(error.message); }
  }
  $('#taxiQuoteForm').addEventListener('submit', async (event) => { event.preventDefault(); message('Finding available rides…', 'success'); try { const result = await api('/api/v1/taxi/quotes', { method: 'POST', body: JSON.stringify(quotePayload()) }); renderQuotes(result); message('Choose the ride that fits you.', 'success'); } catch (error) { message(error.message); } });
  const query = bootstrap.query || {}; if (query.origin) { $('#pickupSearch').value = query.origin; searchPlaces('pickup', query.origin); } if (query.destination) { $('#destinationSearch').value = query.destination; searchPlaces('destination', query.destination); }
  updatePreview();
})();
