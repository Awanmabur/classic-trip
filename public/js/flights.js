'use strict';

(() => {
  const app = document.getElementById('flightBookingApp');
  if (!app) return;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const state = { airports: [], search: null, offer: null, seatMaps: new Map(), selectedSeats: new Map() };
  let bootstrap = {};
  try { bootstrap = JSON.parse($('#flightPageBootstrap')?.textContent || '{}'); } catch (_) { bootstrap = {}; }

  const csrf = () => $('meta[name="csrf-token"]')?.content || '';
  const uid = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = (row = {}) => `${esc(row.currency || '')} ${Math.round(Number(row.total || 0)).toLocaleString()}`.trim();
  const dateTime = (value) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }); };

  function setMessage(id, text, kind = 'error') {
    const node = $(`#${id}`); if (!node) return;
    node.textContent = text || ''; node.className = `travelMessage${text ? ` show ${kind}` : ''}`;
  }
  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf(), ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || 'The request could not be completed.');
    return data;
  }

  async function loadAirports() {
    try {
      const data = await api('/api/v1/flights/airports');
      state.airports = Array.isArray(data.airports) ? data.airports : [];
      $('#airportOptions').innerHTML = state.airports.map((airport) => `<option value="${esc(airport.iataCode || airport.id)}">${esc(airport.city || '')} · ${esc(airport.name || '')} · ${esc(airport.country || '')}</option>`).join('');
      $('#flightSearchStatus').textContent = `${state.airports.length} active airports available.`;
    } catch (error) { $('#flightSearchStatus').textContent = error.message; }
  }

  function updateTravelers() {
    const adults = Math.max(1, Number($('#flightAdults').value || 1));
    const children = Math.max(0, Number($('#flightChildren').value || 0));
    const infants = Math.max(0, Number($('#flightInfants').value || 0));
    $('#flightInfants').max = String(adults);
    $('#travelerCountLabel').textContent = `${adults} adult${adults === 1 ? '' : 's'}${children ? `, ${children} child${children === 1 ? '' : 'ren'}` : ''}${infants ? `, ${infants} infant${infants === 1 ? '' : 's'}` : ''}`;
  }

  function segmentHtml(segment, label = '') {
    return `<div class="offerRoute"><span>${esc(segment.originAirportId)}</span><i class="fa-solid fa-arrow-right-long"></i><span>${esc(segment.destinationAirportId)}</span>${label ? `<span class="badge badgeInfo">${esc(label)}</span>` : ''}</div><div class="offerMeta"><span><i class="fa-solid fa-plane"></i> ${esc(segment.flightNumber)}</span><span><i class="fa-regular fa-clock"></i> ${esc(dateTime(segment.departAt))}</span><span>Arrives ${esc(dateTime(segment.arriveAt))}</span></div>`;
  }

  function renderOffers(data) {
    const rows = data.criteria?.tripType === 'round_trip' ? (data.roundTrips || []) : (data.outbound || []);
    $('#flightResultsPanel').classList.remove('hidden');
    $('#flightCheckoutPanel').classList.add('hidden');
    $('#flightOfferCount').textContent = `${rows.length} offer${rows.length === 1 ? '' : 's'}`;
    $('#flightResultSummary').textContent = `${data.criteria?.origin?.city || data.criteria?.origin?.iataCode || ''} to ${data.criteria?.destination?.city || data.criteria?.destination?.iataCode || ''} · ${String(data.criteria?.cabinClass || 'economy').replaceAll('_', ' ')}`;
    $('#flightOffers').innerHTML = rows.length ? rows.map((row, index) => {
      const segments = row.segments?.length ? row.segments : [row.departure, row.returnDeparture].filter(Boolean);
      const policy = row.policy?.outbound || row.policy || {};
      const baggage = row.baggage?.outbound || row.baggage || {};
      return `<article class="offerCard"><div class="offerTop"><div><div class="offerMeta"><span>${esc(row.airline?.name || row.listing?.title || 'Airline')}</span><span>${esc(row.fare?.name || 'Fare')}</span><span>${esc(row.sourceMode === 'native_inventory' ? 'Native inventory' : 'Certified supplier')}</span></div>${segments.map((segment, i) => segmentHtml(segment, segments.length > 1 ? (i === 0 ? 'Outbound' : 'Return') : '')).join('<div style="height:9px"></div>')}</div><div><div class="offerPrice">${money(row.price)}</div><div class="muted" style="font-size:12px;font-weight:800;text-align:right">Total for all travelers</div></div></div><div class="offerMeta"><span><i class="fa-solid fa-suitcase"></i> Checked ${Number(baggage.checkedKg || 0)} kg</span><span><i class="fa-solid fa-briefcase"></i> Cabin ${Number(baggage.cabinKg || 0)} kg</span><span><i class="fa-solid ${policy.refundable ? 'fa-rotate-left' : 'fa-ban'}"></i> ${policy.refundable ? 'Refundable' : 'Non-refundable'}</span><span><i class="fa-solid fa-chair"></i> ${Number(row.availableSeats || 0)} seats</span></div><div class="travelActions"><button class="btn btnPrimary" type="button" data-select-offer="${index}"><i class="fa-solid fa-chair"></i> Select seats</button></div></article>`;
    }).join('') : '<div class="empty">No published flight inventory matched this search. Try another date, cabin, or airport.</div>';
    $$('[data-select-offer]').forEach((button) => button.addEventListener('click', () => chooseOffer(rows[Number(button.dataset.selectOffer)])));
    $('#flightResultsPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function chooseOffer(publicOffer) {
    setMessage('flightMessage', '');
    try {
      const data = await api(`/api/v1/flights/offers/${encodeURIComponent(publicOffer.offerId)}/reprice`, { method: 'POST', body: JSON.stringify({ offerToken: publicOffer.offerToken }) });
      state.offer = { ...publicOffer, ...data.offer, offerId: publicOffer.offerId, offerToken: publicOffer.offerToken };
      state.seatMaps.clear(); state.selectedSeats.clear();
      const segments = state.offer.segments || [];
      $('#selectedFlightSummary').innerHTML = `<div class="offerTop"><div>${segments.map((segment, i) => segmentHtml(segment, segments.length > 1 ? (i === 0 ? 'Outbound' : 'Return') : '')).join('<div style="height:8px"></div>')}</div><div class="offerPrice">${money(state.offer.priceSnapshot || publicOffer.price)}</div></div>`;
      await renderSeatMaps(segments);
      renderTravelerForms(state.offer.passengerCounts || state.search?.criteria?.counts || { adults: 1, children: 0, infants: 0 });
      $('#flightCheckoutPanel').classList.remove('hidden');
      $('#flightCheckoutPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) { setMessage('flightMessage', error.message); }
  }

  async function renderSeatMaps(segments) {
    const holder = $('#flightSeatMaps'); holder.innerHTML = '';
    for (const segment of segments) {
      const data = await api(`/api/v1/flights/departures/${encodeURIComponent(segment.departureId)}/seat-map?cabinClass=${encodeURIComponent(segment.cabinClass || 'economy')}`);
      state.seatMaps.set(segment.departureId, data);
      state.selectedSeats.set(segment.departureId, []);
      const section = document.createElement('section'); section.className = 'travelerCard';
      section.innerHTML = `<div class="travelerTitle"><div><h3>${esc(data.departure.flightNumber)} seat map</h3><span class="muted">${esc(data.departure.originAirportId)} → ${esc(data.departure.destinationAirportId)} · choose ${Number(state.offer.passengerCounts?.totalSeats || 1)} seats</span></div><span class="badge badgeInfo" data-seat-count="${esc(segment.departureId)}">0 selected</span></div><div class="seatMap">${(data.seats || []).map((seat) => `<button class="flightSeat ${seat.status !== 'available' ? 'unavailable' : ''}" type="button" data-seat-departure="${esc(segment.departureId)}" data-seat-number="${esc(seat.seatNumber)}" ${seat.status !== 'available' ? 'disabled' : ''}><input type="checkbox" tabindex="-1"><span>${esc(seat.seatNumber)}</span></button>`).join('')}</div>`;
      holder.appendChild(section);
    }
    $$('[data-seat-number]', holder).forEach((button) => button.addEventListener('click', () => toggleSeat(button)));
  }

  function toggleSeat(button) {
    const departureId = button.dataset.seatDeparture;
    const seatNumber = button.dataset.seatNumber;
    const rows = state.selectedSeats.get(departureId) || [];
    const max = Number(state.offer?.passengerCounts?.totalSeats || 1);
    const existing = rows.indexOf(seatNumber);
    if (existing >= 0) rows.splice(existing, 1);
    else if (rows.length < max) rows.push(seatNumber);
    else return setMessage('flightOrderMessage', `Select only ${max} seat${max === 1 ? '' : 's'} for each flight.`);
    state.selectedSeats.set(departureId, rows);
    button.classList.toggle('selected', rows.includes(seatNumber));
    const counter = $(`[data-seat-count="${CSS.escape(departureId)}"]`); if (counter) counter.textContent = `${rows.length} selected`;
    setMessage('flightOrderMessage', '');
  }

  function renderTravelerForms(counts) {
    const types = [...Array(Number(counts.adults || 1)).fill('adult'), ...Array(Number(counts.children || 0)).fill('child'), ...Array(Number(counts.infants || 0)).fill('infant')];
    $('#flightTravelers').innerHTML = types.map((type, index) => `<section class="travelerCard" data-traveler-index="${index}"><div class="travelerTitle"><h3>Traveler ${index + 1}</h3><span class="badge badgeInfo">${esc(type)}</span></div><input type="hidden" name="passengerType" value="${esc(type)}"><div class="travelFormGrid three"><div class="travelField"><label>Title</label><div class="travelControl"><select name="title"><option>Mr</option><option>Ms</option><option>Mrs</option><option>Dr</option><option>Child</option></select></div></div><div class="travelField"><label>First name</label><div class="travelControl"><input name="firstName" required></div></div><div class="travelField"><label>Last name</label><div class="travelControl"><input name="lastName" required></div></div><div class="travelField"><label>Date of birth</label><div class="travelControl"><input type="date" name="dateOfBirth" required></div></div><div class="travelField"><label>Sex</label><div class="travelControl"><select name="sex"><option value="male">Male</option><option value="female">Female</option><option value="unspecified">Prefer not to say</option></select></div></div><div class="travelField"><label>Nationality</label><div class="travelControl"><input name="nationality" required></div></div><div class="travelField"><label>Document type</label><div class="travelControl"><select name="documentType"><option value="national_id">National ID</option><option value="passport">Passport</option><option value="travel_document">Travel document</option></select></div></div><div class="travelField"><label>Document number</label><div class="travelControl"><input name="documentNumber" autocomplete="off" required></div></div><div class="travelField"><label>Document expiry</label><div class="travelControl"><input type="date" name="documentExpiry"></div></div><div class="travelField"><label>Issuing country</label><div class="travelControl"><input name="documentIssuingCountry"></div></div><div class="travelField"><label>Frequent flyer</label><div class="travelControl"><input name="frequentFlyerNumber"></div></div></div></section>`).join('');
  }

  function collectTravelers() {
    return $$('[data-traveler-index]', $('#flightTravelers')).map((card) => {
      const value = (name) => $(`[name="${name}"]`, card)?.value || '';
      return { passengerType: value('passengerType'), title: value('title'), firstName: value('firstName'), lastName: value('lastName'), dateOfBirth: value('dateOfBirth'), sex: value('sex'), nationality: value('nationality'), documentType: value('documentType'), documentNumber: value('documentNumber'), documentExpiry: value('documentExpiry') || null, documentIssuingCountry: value('documentIssuingCountry'), frequentFlyerNumber: value('frequentFlyerNumber') };
    });
  }

  function collectSeats() {
    const result = [];
    for (const segment of state.offer?.segments || []) {
      const selected = state.selectedSeats.get(segment.departureId) || [];
      selected.forEach((seatNumber, travelerIndex) => result.push({ departureId: segment.departureId, seatNumber, travelerIndex }));
    }
    return result;
  }

  async function submitOrder(event) {
    event.preventDefault(); setMessage('flightOrderMessage', '');
    const form = event.currentTarget;
    try {
      const travelers = collectTravelers();
      const expectedSeats = Number(state.offer?.passengerCounts?.totalSeats || 1);
      for (const segment of state.offer?.segments || []) {
        const selected = state.selectedSeats.get(segment.departureId) || [];
        if (selected.length !== 0 && selected.length !== expectedSeats) throw new Error(`Choose all ${expectedSeats} seats for flight ${segment.flightNumber}, or leave the map empty for automatic assignment.`);
      }
      const body = {
        offerId: state.offer.offerId || state.offer.id, offerToken: state.offer.offerToken,
        travelers, seats: collectSeats(), contactName: form.contactName.value, email: form.email.value,
        phone: form.phone.value, emergencyPhone: form.emergencyPhone.value, idempotencyKey: uid('flight-order'),
      };
      const result = await api('/api/v1/flights/orders', { method: 'POST', headers: { 'Idempotency-Key': body.idempotencyKey }, body: JSON.stringify(body) });
      const lookupCode = result.booking?.guestLookupCode || '';
      const bookingRef = result.booking?.bookingRef || result.order?.bookingRef;
      sessionStorage.setItem(`classicTripFlightLookup:${bookingRef}`, lookupCode);
      setMessage('flightOrderMessage', `Order ${bookingRef} created. Your private lookup code is ${lookupCode}. Starting secure payment…`, 'success');
      const paymentIdempotency = uid('flight-payment');
      const payment = await api(`/api/v1/flights/orders/${encodeURIComponent(bookingRef)}/payment`, { method: 'POST', headers: { 'Idempotency-Key': paymentIdempotency }, body: JSON.stringify({ provider: form.paymentProvider.value, idempotencyKey: paymentIdempotency }) });
      if (payment.checkoutUrl) return window.location.assign(payment.checkoutUrl);
      window.location.assign(`/flights/orders/${encodeURIComponent(bookingRef)}?lookupCode=${encodeURIComponent(lookupCode)}`);
    } catch (error) { setMessage('flightOrderMessage', error.message); }
  }

  $('#flightSearchForm').addEventListener('submit', async (event) => {
    event.preventDefault(); setMessage('flightMessage', '');
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const data = await api('/api/v1/flights/search', { method: 'POST', body: JSON.stringify(payload) });
      state.search = data; renderOffers(data);
    } catch (error) { setMessage('flightMessage', error.message); }
  });
  $('#flightOrderForm').addEventListener('submit', submitOrder);
  $('#backToFlightResults').addEventListener('click', () => { $('#flightCheckoutPanel').classList.add('hidden'); $('#flightResultsPanel').scrollIntoView({ behavior: 'smooth' }); });
  $$('[data-trip-type]').forEach((button) => button.addEventListener('click', () => {
    $$('[data-trip-type]').forEach((row) => row.classList.toggle('active', row === button));
    $('#flightTripType').value = button.dataset.tripType;
    const round = button.dataset.tripType === 'round_trip';
    $('#returnDateField').classList.toggle('hidden', !round); $('#flightReturnDate').required = round;
  }));
  ['flightAdults', 'flightChildren', 'flightInfants'].forEach((id) => $(`#${id}`).addEventListener('input', updateTravelers));

  const today = new Date().toISOString().slice(0, 10); $('#flightDepartureDate').min = today; $('#flightReturnDate').min = today;
  const query = bootstrap.query || {};
  if (query.origin) $('#flightOrigin').value = query.origin;
  if (query.destination) $('#flightDestination').value = query.destination;
  if (query.date || query.departureDate) $('#flightDepartureDate').value = query.date || query.departureDate;
  if (query.returnDate) { $('[data-trip-type="round_trip"]').click(); $('#flightReturnDate').value = query.returnDate; }
  updateTravelers(); loadAirports();
})();
