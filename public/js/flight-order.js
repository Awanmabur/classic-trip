'use strict';
(() => {
  const app = document.getElementById('flightOrderApp'); if (!app) return;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const dt = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }); };
  const cash = (p = {}) => `${esc(p.currency || '')} ${Math.round(Number(p.total || 0)).toLocaleString()}`;
  let data = {}; try { data = JSON.parse($('#flightOrderBootstrap')?.textContent || '{}'); } catch (_) {}
  function message(text, kind = 'error') { const n = $('#flightOrderLookupMessage'); n.textContent = text || ''; n.className = `travelMessage${text ? ` show ${kind}` : ''}`; }
  async function load() {
    const code = $('#flightLookupCode').value.trim() || sessionStorage.getItem(`classicTripFlightLookup:${data.reference}`) || '';
    message('');
    try {
      const response = await fetch(`/api/v1/flights/orders/${encodeURIComponent(data.reference)}?lookupCode=${encodeURIComponent(code)}`);
      const row = await response.json().catch(() => ({})); if (!response.ok) throw new Error(row.message || row.error || 'Flight order could not be opened.');
      const booking = row.booking || {}; const order = row.order || {}; const holder = $('#flightOrderDetails'); holder.classList.remove('hidden');
      holder.innerHTML = `<section class="travelPanel"><div class="travelPanelHead"><div><span class="badge ${booking.paymentStatus === 'successful' ? 'badgeOk' : 'badgeWarn'}"><i class="fa-solid fa-circle-check"></i> ${esc(booking.bookingStatus || order.status)}</span><h2 style="margin-top:10px">Flight order ${esc(booking.bookingRef)}</h2><p class="muted">PNR: ${esc(order.supplierBookingReference || 'Pending ticket confirmation')}</p></div><div><div class="offerPrice">${cash(booking.pricing || order.pricing || {})}</div><a class="btn btnGhost" style="margin-top:10px" href="/tickets/${encodeURIComponent(booking.bookingRef)}.pdf${code ? `?accessCode=${encodeURIComponent(code)}` : ''}"><i class="fa-solid fa-file-pdf"></i> Download e-ticket PDF</a></div></div><div class="trackingGrid"><div class="trackingMetric"><b>${esc(booking.paymentStatus || 'pending')}</b><span>Payment</span></div><div class="trackingMetric"><b>${esc(order.ticketingStatus || 'pending')}</b><span>Ticketing</span></div><div class="trackingMetric"><b>${(row.travelers || []).length}</b><span>Travelers</span></div><div class="trackingMetric"><b>${(order.segmentSnapshot || []).length}</b><span>Flight segments</span></div></div></section><section class="travelPanel"><div class="travelPanelHead"><div><h3>Itinerary</h3><p class="muted">Times are shown from the dated flight departure.</p></div></div><div class="offerList">${(order.segmentSnapshot || []).map((s) => `<div class="offerCard"><div class="offerRoute"><span>${esc(s.originAirportId)}</span><span aria-hidden="true">⇄</span><span>${esc(s.destinationAirportId)}</span></div><div class="offerMeta"><span>${esc(s.flightNumber)}</span><span>Departs ${esc(dt(s.departAt))}</span><span>Arrives ${esc(dt(s.arriveAt))}</span><span>${esc(String(s.cabinClass || '').replaceAll('_', ' '))}</span></div></div>`).join('')}</div></section><section class="travelPanel"><div class="travelPanelHead"><div><h3>E-tickets and passengers</h3><p class="muted">Document numbers remain masked.</p></div></div><div class="offerList">${(row.travelers || []).map((t) => { const ticket = (row.tickets || []).find((x) => x.travelerId === t.id); const seats = (row.assignments || []).filter((x) => x.travelerId === t.id).map((x) => x.seatNumber).join(', '); return `<div class="offerCard"><div class="offerTop"><div><b>${esc(t.firstName)} ${esc(t.lastName)}</b><div class="offerMeta"><span>${esc(t.documentType)} ••••${esc(t.documentNumberLast4)}</span><span>Seat ${esc(seats || 'assigned at check-in')}</span></div></div><div><span class="badge ${ticket?.status === 'issued' ? 'badgeOk' : 'badgeWarn'}">${esc(ticket?.status || 'pending')}</span><div class="muted" style="margin-top:6px;font-size:12px;font-weight:900">${esc(ticket?.ticketNumber || '')}</div></div></div></div>`; }).join('')}</div></section>`;
      message('Flight order opened securely.', 'success');
    } catch (error) { $('#flightOrderDetails').classList.add('hidden'); message(error.message); }
  }
  $('#flightLookupForm').addEventListener('submit', (event) => { event.preventDefault(); load(); });
  load();
})();
