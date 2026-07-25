'use strict';

const flightService = require('../../modules/flight/services/flightService');
const taxiService = require('../../modules/taxi/services/taxiService');
const { platformCurrency } = require('../../utils/currency');
const { resolveCompanyId } = require('../../utils/companyScope');
const { effectivePermissionsFresh } = require('../../middlewares/permissions');

function companyId(req) { return String(resolveCompanyId(req) || '').trim(); }
function isEmployeeRoute(req) { return String(req.originalUrl || req.path || '').startsWith('/employee/'); }
function operationsTarget(req, service) { return isEmployeeRoute(req) ? `/employee/dashboard/${service}-operations` : `/company/${service}-operations`; }
function flightManifestBase(req) { return isEmployeeRoute(req) ? '/employee/flights' : '/company/flights'; }
function redirect(res, target) { return res.redirect(target); }
function clean(value, max = 200) { return String(value || '').trim().slice(0, max); }

function seatMapFromForm(body = {}) {
  if (Array.isArray(body.seatMap)) return body.seatMap;
  if (typeof body.seatMap === 'string' && body.seatMap.trim().startsWith('[')) {
    try { return JSON.parse(body.seatMap); } catch (_) { /* use layout builder below */ }
  }
  const layout = clean(body.seatColumns || 'ABC-DEF', 20).toUpperCase();
  const rows = Math.max(1, Math.min(100, Number(body.seatRows || 1)));
  const cabinClass = clean(body.cabinClass || 'economy', 30).toLowerCase().replace(/[\s-]+/g, '_');
  const columns = layout.split('').filter((value) => /[A-Z]/.test(value));
  const aisleIndex = layout.indexOf('-');
  const leftColumns = aisleIndex >= 0 ? layout.slice(0, aisleIndex).split('').filter((value) => /[A-Z]/.test(value)) : columns.slice(0, Math.ceil(columns.length / 2));
  const rightColumns = aisleIndex >= 0 ? layout.slice(aisleIndex + 1).split('').filter((value) => /[A-Z]/.test(value)) : columns.slice(Math.ceil(columns.length / 2));
  return Array.from({ length: rows }, (_, rowIndex) => columns.map((column) => {
    let seatType = 'middle';
    if (column === leftColumns[0] || column === rightColumns[rightColumns.length - 1]) seatType = 'window';
    else if (column === leftColumns[leftColumns.length - 1] || column === rightColumns[0]) seatType = 'aisle';
    return { seatNumber: `${rowIndex + 1}${column}`, row: rowIndex + 1, column, cabinClass, seatType };
  })).flat();
}

async function createAircraft(req, res, next) {
  try { await flightService.createAircraft(companyId(req), { ...req.body, seatMap: seatMapFromForm(req.body) }); return redirect(res, operationsTarget(req, 'flight')); } catch (error) { return next(error); }
}
async function updateAircraftStatus(req, res, next) {
  try { await flightService.updateAircraftStatus(companyId(req), req.params.id, req.body.status); return redirect(res, operationsTarget(req, 'flight')); } catch (error) { return next(error); }
}
async function createFlightFare(req, res, next) {
  try { await flightService.createFare(companyId(req), { ...req.body, currency: req.body.currency || platformCurrency() }); return redirect(res, operationsTarget(req, 'flight')); } catch (error) { return next(error); }
}
async function createFlightSchedule(req, res, next) {
  try { await flightService.createSchedule(companyId(req), req.body); return redirect(res, operationsTarget(req, 'flight')); } catch (error) { return next(error); }
}
async function publishFlightSchedule(req, res, next) {
  try { await flightService.publishSchedule(companyId(req), req.params.id); return redirect(res, operationsTarget(req, 'flight')); } catch (error) { return next(error); }
}
async function transitionFlightSchedule(req, res, next) {
  try { await flightService.transitionSchedule(companyId(req), req.params.id, req.body, req.session?.user?.id || 'company-admin'); return redirect(res, req.body.next || operationsTarget(req, 'flight')); } catch (error) { return next(error); }
}
async function transitionFlightTicket(req, res, next) {
  try { await flightService.transitionTicket(companyId(req), req.params.ticketNumber, req.body.status, req.session?.user?.id || 'company-staff'); return redirect(res, req.body.next || `${flightManifestBase(req)}/schedules/${encodeURIComponent(req.body.scheduleId || '')}/manifest`); } catch (error) { return next(error); }
}

const FLIGHT_MANIFEST_COLUMNS = [
  ['ticketNumber', 'Ticket'], ['bookingRef', 'Booking'], ['travelerName', 'Traveler'], ['passengerType', 'Type'],
  ['documentNumber', 'Document'], ['nationality', 'Nationality'], ['seatNumber', 'Seat'], ['cabinClass', 'Cabin'], ['status', 'Status'], ['contactPhone', 'Phone'],
];
function csvEscape(value) { const text = String(value ?? ''); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
function manifestCsv(data) {
  return [FLIGHT_MANIFEST_COLUMNS.map(([, label]) => csvEscape(label)).join(','), ...data.rows.map((row) => FLIGHT_MANIFEST_COLUMNS.map(([key]) => csvEscape(row[key])).join(','))].join('\n');
}
async function flightManifest(req, res, next) {
  try {
    const data = await flightService.manifest(companyId(req), req.params.scheduleId);
    const accessBase = flightManifestBase(req);
    const permissions = isEmployeeRoute(req) ? await effectivePermissionsFresh(req.session?.user || {}) : [];
    const canUpdateTickets = !isEmployeeRoute(req) || permissions.includes('flight.ticket.update');
    return res.render('pages/flight-manifest-print', { seo: { title: `${data.schedule.flightNumber} manifest | Classic Trip` }, ...data, accessBase, canUpdateTickets });
  } catch (error) { return next(error); }
}
async function flightManifestCsv(req, res, next) {
  try { const data = await flightService.manifest(companyId(req), req.params.scheduleId); res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="${data.schedule.flightNumber}-manifest.csv"`); return res.send(manifestCsv(data)); } catch (error) { return next(error); }
}
async function flightManifestPdf(req, res, next) {
  try {
    const data = await flightService.manifest(companyId(req), req.params.scheduleId);
    const PDFDocument = require('pdfkit');
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    doc.on('data', (chunk) => chunks.push(chunk));
    const finished = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
    doc.fontSize(18).text(`Flight ${data.schedule.flightNumber} passenger manifest`);
    doc.fontSize(10).text(`${data.origin?.iataCode || ''} ${data.origin?.city || ''} to ${data.destination?.iataCode || ''} ${data.destination?.city || ''}`);
    doc.text(`Departure: ${new Date(data.schedule.departureAt).toISOString()}`);
    doc.moveDown();
    data.rows.forEach((row, index) => {
      if (doc.y > 740) doc.addPage();
      doc.fontSize(10).text(`${index + 1}. ${row.travelerName} | ${row.ticketNumber} | Seat ${row.seatNumber || '-'} | ${row.cabinClass || '-'} | ${row.documentNumber || 'No document'}`);
    });
    doc.end();
    const buffer = await finished;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${data.schedule.flightNumber}-manifest.pdf"`);
    return res.send(buffer);
  } catch (error) { return next(error); }
}

async function createTaxiZone(req, res, next) {
  try { await taxiService.createServiceZone(companyId(req), req.body); return redirect(res, operationsTarget(req, 'taxi')); } catch (error) { return next(error); }
}
async function createTaxiVehicle(req, res, next) {
  try { await taxiService.createVehicle(companyId(req), req.body); return redirect(res, operationsTarget(req, 'taxi')); } catch (error) { return next(error); }
}
async function updateTaxiVehicleStatus(req, res, next) {
  try { await taxiService.updateVehicleStatus(companyId(req), req.params.id, req.body.status); return redirect(res, operationsTarget(req, 'taxi')); } catch (error) { return next(error); }
}
async function createTaxiFare(req, res, next) {
  try { await taxiService.createFareRule(companyId(req), { ...req.body, currency: req.body.currency || platformCurrency() }); return redirect(res, operationsTarget(req, 'taxi')); } catch (error) { return next(error); }
}
async function dispatchTaxi(req, res, next) {
  try { await taxiService.dispatchDueRides(Number(req.body.limit || 100), companyId(req)); return redirect(res, operationsTarget(req, 'taxi')); } catch (error) { return next(error); }
}
async function transitionTaxiRide(req, res, next) {
  try { await taxiService.transitionRide({ rideRef: req.params.rideRef, actorId: req.session?.user?.id || 'company-admin', actorType: 'partner_staff', companyId: companyId(req), toStatus: req.body.status, pickupPin: req.body.pickupPin, note: req.body.note }); return redirect(res, req.body.next || operationsTarget(req, 'taxi')); } catch (error) { return next(error); }
}

module.exports = {
  createAircraft, updateAircraftStatus, createFlightFare, createFlightSchedule, publishFlightSchedule, transitionFlightSchedule, transitionFlightTicket,
  flightManifest, flightManifestCsv, flightManifestPdf,
  createTaxiZone, createTaxiVehicle, updateTaxiVehicleStatus, createTaxiFare, dispatchTaxi, transitionTaxiRide,
};
