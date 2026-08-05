'use strict';

(() => {
  const app = document.getElementById('taxiTrackApp');
  if (!app) return;

  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
  const cleanStatus = (value) => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  const dateTime = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  };
  const money = (price = {}) => {
    const amount = Number(price.total ?? price.amount ?? 0);
    return `${esc(price.currency || '')} ${Number.isFinite(amount) ? Math.round(amount).toLocaleString('en-GB') : '0'}`.trim();
  };
  const point = (row = {}) => {
    const latitude = Number(row.latitude);
    const longitude = Number(row.longitude);
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? [latitude, longitude] : null;
  };

  let bootstrap = {};
  try { bootstrap = JSON.parse($('#taxiTrackBootstrap')?.textContent || '{}'); } catch (_) { bootstrap = {}; }

  const reference = String(bootstrap.reference || '').trim();
  const lookupStorageKey = `classicTripTaxiLookup:${reference}`;
  const initialLookup = String(bootstrap.lookupCode || '').trim();
  let lookupCode = initialLookup || sessionStorage.getItem(lookupStorageKey) || '';
  let refreshTimer = null;
  let requestInFlight = false;
  let lastPayload = null;
  let map = null;
  let routeLayer = null;
  let markerLayer = null;

  const lookupInput = $('#taxiLookupCode');
  if (lookupInput && !lookupInput.value) lookupInput.value = lookupCode;
  if (lookupCode) sessionStorage.setItem(lookupStorageKey, lookupCode);

  function message(text, kind = 'error') {
    const node = $('#taxiTrackMessage');
    if (!node) return;
    node.textContent = text || '';
    node.className = `travelMessage${text ? ` show ${kind}` : ''}`;
  }

  function setBusy(button, busy, label = 'Working…') {
    if (!button) return;
    if (!button.dataset.defaultHtml) button.dataset.defaultHtml = button.innerHTML;
    button.disabled = Boolean(busy);
    button.setAttribute('aria-busy', busy ? 'true' : 'false');
    button.innerHTML = busy ? `<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> ${esc(label)}` : button.dataset.defaultHtml;
  }

  function currentLookupCode() {
    const typed = lookupInput?.value.trim() || '';
    lookupCode = typed || lookupCode || sessionStorage.getItem(lookupStorageKey) || '';
    if (lookupCode) sessionStorage.setItem(lookupStorageKey, lookupCode);
    return lookupCode;
  }

  function geometryFrom(payload = {}) {
    const route = payload.ride?.routeSnapshot || payload.ride?.estimateSnapshot?.route || payload.booking?.bookingLegs?.[0]?.routeSnapshot || {};
    const geometry = Array.isArray(route.geometry) ? route.geometry.map(point).filter(Boolean) : [];
    if (geometry.length >= 2) return geometry;
    const fallback = [
      point(payload.ride?.pickup),
      ...(Array.isArray(payload.ride?.stops) ? payload.ride.stops.map(point) : []),
      point(payload.ride?.destination),
    ].filter(Boolean);
    return fallback;
  }

  function mapConfig() {
    const config = bootstrap.map || {};
    return {
      tileUrl: config.tileUrl || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      tileAttribution: config.tileAttribution || '&copy; OpenStreetMap contributors',
      defaultLatitude: Number(config.defaultLatitude || 0.3476),
      defaultLongitude: Number(config.defaultLongitude || 32.5825),
      defaultZoom: Number(config.defaultZoom || 12),
    };
  }

  function ensureMap() {
    const mapNode = $('#taxiLiveTrackingMap');
    if (!mapNode || !window.L || typeof window.L.map !== 'function') return null;
    if (map) {
      window.setTimeout(() => map.invalidateSize(), 30);
      return map;
    }
    const config = mapConfig();
    map = window.L.map(mapNode, { zoomControl: true, scrollWheelZoom: false }).setView(
      [config.defaultLatitude, config.defaultLongitude],
      config.defaultZoom,
    );
    window.L.tileLayer(config.tileUrl, {
      attribution: config.tileAttribution,
      maxZoom: 19,
      crossOrigin: true,
    }).addTo(map);
    routeLayer = window.L.layerGroup().addTo(map);
    markerLayer = window.L.layerGroup().addTo(map);
    return map;
  }

  function markerIcon(icon, className) {
    return window.L.divIcon({
      className: 'ctMapMarkerShell',
      html: `<span class="ctMapMarker ${className}"><i class="fa-solid ${icon}" aria-hidden="true"></i></span>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });
  }

  function updateMap(payload = {}) {
    const instance = ensureMap();
    if (!instance || !routeLayer || !markerLayer) return;
    routeLayer.clearLayers();
    markerLayer.clearLayers();

    const geometry = geometryFrom(payload);
    if (geometry.length >= 2) {
      window.L.polyline(geometry, { weight: 5, opacity: 0.85, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayer);
    }

    const pickup = point(payload.ride?.pickup);
    const destination = point(payload.ride?.destination);
    const driver = point(payload.location);
    const stops = Array.isArray(payload.ride?.stops) ? payload.ride.stops.map(point).filter(Boolean) : [];

    if (pickup) window.L.marker(pickup, { icon: markerIcon('fa-location-dot', 'pickup') }).bindTooltip('Pickup').addTo(markerLayer);
    stops.forEach((stop, index) => window.L.marker(stop, { icon: markerIcon('fa-circle', 'stop') }).bindTooltip(`Stop ${index + 1}`).addTo(markerLayer));
    if (destination) window.L.marker(destination, { icon: markerIcon('fa-flag-checkered', 'destination') }).bindTooltip('Destination').addTo(markerLayer);
    if (driver) window.L.marker(driver, { icon: markerIcon('fa-motorcycle', 'driver') }).bindTooltip('Driver location').addTo(markerLayer);

    const boundsPoints = [...geometry, pickup, destination, driver, ...stops].filter(Boolean);
    if (boundsPoints.length >= 2) instance.fitBounds(window.L.latLngBounds(boundsPoints), { padding: [30, 30], maxZoom: 16 });
    else if (boundsPoints.length === 1) instance.setView(boundsPoints[0], 15);
    window.setTimeout(() => instance.invalidateSize(), 50);
  }

  function routeStops(ride = {}) {
    const rows = [
      { type: 'pickup', icon: 'fa-location-dot', title: ride.pickup?.address || 'Pickup', meta: [ride.pickup?.city, ride.pickup?.district].filter(Boolean).join(' · ') },
      ...(Array.isArray(ride.stops) ? ride.stops.map((stop, index) => ({ type: 'stop', icon: 'fa-circle', title: stop.address || `Stop ${index + 1}`, meta: [stop.city, stop.district].filter(Boolean).join(' · ') })) : []),
      { type: 'destination', icon: 'fa-flag-checkered', title: ride.destination?.address || 'Destination', meta: [ride.destination?.city, ride.destination?.district].filter(Boolean).join(' · ') },
    ];
    return rows.map((row) => `<div class="rideRoutePoint ${esc(row.type)}"><span class="rideRouteIcon"><i class="fa-solid ${esc(row.icon)}" aria-hidden="true"></i></span><div><strong>${esc(row.title)}</strong>${row.meta ? `<span>${esc(row.meta)}</span>` : ''}</div></div>`).join('');
  }

  function actionMarkup(payload = {}) {
    const ride = payload.ride || {};
    const terminal = ['completed', 'cancelled', 'refunded', 'failed', 'customer_no_show'].includes(ride.status);
    const cancellable = !terminal && !['ride_started', 'in_progress', 'pickup_verified', 'safety_hold'].includes(ride.status);
    const receipt = payload.booking?.paymentStatus === 'successful';
    return `<div class="rideActionGrid">
      ${receipt ? `<a class="btn btnGhost" href="/tickets/${encodeURIComponent(ride.bookingRef)}.pdf?accessCode=${encodeURIComponent(currentLookupCode())}"><i class="fa-solid fa-file-pdf" aria-hidden="true"></i> Receipt</a>` : ''}
      <button class="btn btnGhost" type="button" data-ride-action="share"><i class="fa-solid fa-share-nodes" aria-hidden="true"></i> Share trip</button>
      ${cancellable ? `<button class="btn btnDangerSoft" type="button" data-ride-action="show-cancel"><i class="fa-solid fa-ban" aria-hidden="true"></i> Cancel ride</button>` : ''}
      <button class="btn btnDangerSoft" type="button" data-ride-action="show-safety"><i class="fa-solid fa-shield-heart" aria-hidden="true"></i> Safety help</button>
    </div>`;
  }

  function render(payload = {}) {
    lastPayload = payload;
    const ride = payload.ride || {};
    const holder = $('#taxiTrackDetails');
    if (!holder) return;
    holder.classList.remove('hidden');
    const statusClass = ride.status === 'completed' ? 'badgeOk' : ['cancelled', 'failed', 'customer_no_show'].includes(ride.status) ? 'badgeWarn' : 'badgeInfo';
    const route = ride.routeSnapshot || ride.estimateSnapshot?.route || {};
    const latestLocation = payload.location;

    holder.innerHTML = `
      <section class="travelPanel rideSummaryPanel">
        <div class="travelPanelHead rideSummaryHead">
          <div>
            <span class="badge ${statusClass}"><i class="fa-solid fa-route" aria-hidden="true"></i> ${esc(cleanStatus(ride.status))}</span>
            <h2>Ride ${esc(ride.rideRef || ride.bookingRef || reference)}</h2>
            <p class="muted">Pickup ${esc(dateTime(ride.scheduledPickupAt))}</p>
          </div>
          <div class="rideFareBlock"><span>Accepted fare</span><strong>${money(ride.finalFareSnapshot || ride.pricing || {})}</strong></div>
        </div>
        <div class="trackingGrid">
          <div class="trackingMetric"><strong>${esc(payload.vehicleClass?.name || 'Finding ride')}</strong><span>Ride class</span></div>
          <div class="trackingMetric"><strong>${esc(payload.driver?.name || 'Finding driver')}</strong><span>Driver</span></div>
          <div class="trackingMetric"><strong>${esc(payload.vehicle?.registrationNumber || 'Pending')}</strong><span>Vehicle</span></div>
          <div class="trackingMetric"><strong>${esc(ride.pickupPin || 'Private')}</strong><span>Pickup PIN</span></div>
        </div>
        ${actionMarkup(payload)}
      </section>

      <section class="travelPanel liveTrackingPanel">
        <div class="travelPanelHead"><div><h3>Live trip map</h3><p class="muted">Road route and verified driver updates.</p></div><span class="badge ${route.source === 'live' ? 'badgeOk' : 'badgeInfo'}">${route.source === 'live' ? 'Live road route' : 'Stored route'}</span></div>
        <div id="taxiLiveTrackingMap" class="liveMap" role="img" aria-label="Ride route and current driver location"></div>
        <div class="rideMapMeta">
          <span><i class="fa-solid fa-road" aria-hidden="true"></i> ${Number(ride.estimateSnapshot?.distanceKm || route.distanceKm || 0).toFixed(1)} km</span>
          <span><i class="fa-solid fa-clock" aria-hidden="true"></i> ${Math.round(Number(ride.estimateSnapshot?.durationMinutes || route.durationMinutes || 0))} min</span>
          <span><i class="fa-solid fa-location-crosshairs" aria-hidden="true"></i> ${latestLocation ? `Updated ${esc(dateTime(latestLocation.capturedAt))}` : 'Driver location pending'}</span>
        </div>
        <div class="rideRouteList">${routeStops(ride)}</div>
      </section>

      <section class="travelPanel">
        <div class="travelPanelHead"><div><h3>Driver and vehicle</h3><p class="muted">Only verified, customer-safe details are shown.</p></div></div>
        <div class="rideIdentityGrid">
          ${payload.driver ? `<article class="offerCard rideIdentityCard"><span class="rideIdentityIcon"><i class="fa-solid fa-user-check" aria-hidden="true"></i></span><div><strong>${esc(payload.driver.name)}</strong><div class="offerMeta"><span>${Number(payload.driver.ratingAverage || 0).toFixed(1)} rating</span><span>${Number(payload.driver.completedRideCount || 0)} completed rides</span></div></div><span class="badge badgeOk">Verified</span></article>` : '<div class="empty">Dispatch is locating an eligible verified rider or driver.</div>'}
          ${payload.vehicle ? `<article class="offerCard rideIdentityCard"><span class="rideIdentityIcon"><i class="fa-solid fa-${ride.serviceType === 'instant' && /boda|motor/i.test(payload.vehicleClass?.name || '') ? 'motorcycle' : 'car-side'}" aria-hidden="true"></i></span><div><strong>${esc(`${payload.vehicle.make || ''} ${payload.vehicle.model || ''}`.trim())}</strong><div class="offerMeta"><span>${esc(payload.vehicle.registrationNumber)}</span><span>${esc(payload.vehicle.color || '')}</span><span>${Number(payload.vehicle.passengerCapacity || 0)} passengers</span></div></div></article>` : ''}
        </div>
      </section>

      <section class="travelPanel">
        <div class="travelPanelHead"><div><h3>Ride timeline</h3><p class="muted">Dispatch and trip transitions are recorded securely.</p></div></div>
        <div class="timeline">${(payload.events || []).map((event) => `<div class="timelineItem"><span class="timelineMark"></span><div><strong>${esc(cleanStatus(event.eventType || event.statusTo))}</strong><span>${esc(dateTime(event.occurredAt || event.createdAt))}</span></div></div>`).join('') || '<div class="empty">No ride events yet.</div>'}</div>
      </section>

      <section class="travelPanel rideActionForms hidden" id="rideCancelPanel">
        <div class="travelPanelHead"><div><h3>Cancel this ride</h3><p class="muted">A refund request is created automatically when payment has already succeeded.</p></div><button class="iconBtn" type="button" data-ride-action="hide-forms" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div>
        <form id="rideCancelForm" class="stackForm"><label>Reason for cancellation<textarea name="reason" rows="3" minlength="5" maxlength="1000" required placeholder="Explain why you need to cancel"></textarea></label><button class="btn btnDanger" type="submit"><i class="fa-solid fa-ban"></i> Confirm cancellation</button></form>
      </section>

      <section class="travelPanel rideActionForms hidden" id="rideSafetyPanel">
        <div class="travelPanelHead"><div><h3>Report a safety or service issue</h3><p class="muted">Critical reports can place the ride on safety hold for Super Admin review.</p></div><button class="iconBtn" type="button" data-ride-action="hide-forms" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div>
        <form id="rideSafetyForm" class="stackForm"><div class="formGrid two"><label>Issue type<select name="category" required><option value="safety">Safety concern</option><option value="collision">Collision</option><option value="harassment">Harassment</option><option value="lost_item">Lost item</option><option value="vehicle">Vehicle issue</option><option value="route">Route issue</option><option value="payment">Payment issue</option><option value="other">Other</option></select></label><label>Severity<select name="severity" required><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical emergency</option><option value="low">Low</option></select></label></div><label>What happened?<textarea name="description" rows="4" minlength="10" maxlength="3000" required placeholder="Give clear details so the safety team can act"></textarea></label><button class="btn btnDanger" type="submit"><i class="fa-solid fa-shield-heart"></i> Submit safety report</button></form>
      </section>`;

    bindActions();
    window.setTimeout(() => updateMap(payload), 0);
  }

  function stopRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
  }

  function scheduleRefresh(payload = {}) {
    stopRefresh();
    const terminal = ['completed', 'cancelled', 'refunded', 'failed', 'customer_no_show'].includes(payload.ride?.status);
    if (!terminal) refreshTimer = window.setInterval(() => load({ quiet: true }), 15000);
  }

  async function load({ quiet = false } = {}) {
    if (requestInFlight || !reference) return;
    const code = currentLookupCode();
    requestInFlight = true;
    const submitButton = $('#taxiLookupForm button[type="submit"]');
    if (!quiet) setBusy(submitButton, true, 'Opening ride…');
    try {
      const response = await fetch(`/api/v1/taxi/rides/${encodeURIComponent(reference)}/tracking?lookupCode=${encodeURIComponent(code)}`, {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || payload.error || 'Ride tracking could not be opened.');
      render(payload);
      scheduleRefresh(payload);
      if (!quiet) message('Ride opened securely.', 'success');
    } catch (error) {
      stopRefresh();
      $('#taxiTrackDetails')?.classList.add('hidden');
      message(error.message || 'Ride tracking could not be opened.');
    } finally {
      requestInFlight = false;
      if (!quiet) setBusy(submitButton, false);
    }
  }

  async function postAction(path, body, button, busyLabel) {
    setBusy(button, true, busyLabel);
    try {
      const response = await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ...body, lookupCode: currentLookupCode() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || payload.error || 'The request could not be completed.');
      return payload;
    } finally {
      setBusy(button, false);
    }
  }

  function hideActionForms() {
    $('#rideCancelPanel')?.classList.add('hidden');
    $('#rideSafetyPanel')?.classList.add('hidden');
  }

  async function shareTrip() {
    const ride = lastPayload?.ride || {};
    const shareData = {
      title: `Classic Trip ride ${ride.rideRef || reference}`,
      text: `Track my Classic Trip ride ${ride.rideRef || reference}. The private lookup code is shared separately for safety.`,
      url: window.location.href.split('?')[0],
    };
    try {
      if (navigator.share) await navigator.share(shareData);
      else {
        await navigator.clipboard.writeText(shareData.url);
        message('Secure tracking link copied. Share the lookup code separately.', 'success');
      }
    } catch (error) {
      if (error?.name !== 'AbortError') message('The tracking link could not be shared.');
    }
  }

  function bindActions() {
    document.querySelectorAll('[data-ride-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset.rideAction;
        if (action === 'share') shareTrip();
        if (action === 'show-cancel') { hideActionForms(); $('#rideCancelPanel')?.classList.remove('hidden'); $('#rideCancelPanel')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
        if (action === 'show-safety') { hideActionForms(); $('#rideSafetyPanel')?.classList.remove('hidden'); $('#rideSafetyPanel')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
        if (action === 'hide-forms') hideActionForms();
      });
    });

    $('#rideCancelForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      try {
        await postAction(`/api/v1/taxi/rides/${encodeURIComponent(reference)}/cancel`, { reason: new FormData(form).get('reason') }, button, 'Cancelling…');
        message('Ride cancelled. Any eligible refund has been sent for processing.', 'success');
        await load({ quiet: true });
      } catch (error) { message(error.message || 'The ride could not be cancelled.'); }
    });

    $('#rideSafetyForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      const data = Object.fromEntries(new FormData(form).entries());
      try {
        await postAction(`/api/v1/taxi/rides/${encodeURIComponent(reference)}/incidents`, data, button, 'Sending report…');
        form.reset();
        hideActionForms();
        message('Safety report received. The operations team can now review it.', 'success');
        await load({ quiet: true });
      } catch (error) { message(error.message || 'The safety report could not be submitted.'); }
    });
  }

  $('#taxiLookupForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    load();
  });
  window.addEventListener('beforeunload', stopRefresh);
  load();
})();
