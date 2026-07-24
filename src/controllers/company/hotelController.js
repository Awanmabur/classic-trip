const hotelService = require('../../services/hotel/hotelService');
const ticketPdfService = require('../../services/pdf/ticketPdfService');
const { resolveCompanyId } = require('../../utils/companyScope');
const { platformCurrency } = require('../../utils/currency');

function companyId(req) { return resolveCompanyId(req); }
function actorId(req) { return req.session?.user?.id || 'company-admin'; }
function redirect(res, path, anchor = '') { return res.redirect(`${path}${anchor}`); }

async function createProperty(req, res, next) { try { await hotelService.createProperty(companyId(req), req.body, actorId(req)); return redirect(res, '/company/hotel-properties'); } catch (error) { return next(error); } }
async function updateProperty(req, res, next) { try { await hotelService.updateProperty(companyId(req), req.params.id, req.body, actorId(req)); return redirect(res, '/company/hotel-properties'); } catch (error) { return next(error); } }
async function archiveProperty(req, res, next) { try { await hotelService.archiveProperty(companyId(req), req.params.id, actorId(req)); return redirect(res, '/company/hotel-properties'); } catch (error) { return next(error); } }
async function createRoomType(req, res, next) { try { await hotelService.createRoomType(companyId(req), req.body, actorId(req)); return redirect(res, '/company/room-types'); } catch (error) { return next(error); } }
async function updateRoomType(req, res, next) { try { await hotelService.updateRoomType(companyId(req), req.params.id, req.body, actorId(req)); return redirect(res, '/company/room-types'); } catch (error) { return next(error); } }
async function setRoomTypeInventory(req, res, next) { try { await hotelService.setRoomTypeInventory(companyId(req), req.params.id, req.body, actorId(req)); return redirect(res, '/company/room-types'); } catch (error) { return next(error); } }
async function archiveRoomType(req, res, next) { try { await hotelService.archiveRoomType(companyId(req), req.params.id, actorId(req)); return redirect(res, '/company/room-types'); } catch (error) { return next(error); } }
async function createRatePlan(req, res, next) { try { await hotelService.createRatePlan(companyId(req), req.body, actorId(req)); return redirect(res, '/company/rate-plans'); } catch (error) { return next(error); } }
async function updateRatePlan(req, res, next) { try { await hotelService.updateRatePlan(companyId(req), req.params.id, req.body, actorId(req)); return redirect(res, '/company/rate-plans'); } catch (error) { return next(error); } }
async function archiveRatePlan(req, res, next) { try { await hotelService.archiveRatePlan(companyId(req), req.params.id, actorId(req)); return redirect(res, '/company/rate-plans'); } catch (error) { return next(error); } }
async function createRoomUnits(req, res, next) { try { await hotelService.createRoomUnits(companyId(req), req.body, actorId(req)); return redirect(res, '/company/room-units'); } catch (error) { return next(error); } }
async function updateRoomUnit(req, res, next) { try { await hotelService.updateRoomUnit(companyId(req), req.params.id, req.body, actorId(req)); return redirect(res, '/company/room-units'); } catch (error) { return next(error); } }
async function archiveRoomUnit(req, res, next) { try { await hotelService.archiveRoomUnit(companyId(req), req.params.id, actorId(req)); return redirect(res, '/company/room-units'); } catch (error) { return next(error); } }
async function createInventory(req, res, next) { try { await hotelService.createNightInventory(companyId(req), req.body, actorId(req)); return redirect(res, '/company/room-calendar'); } catch (error) { return next(error); } }
async function updateInventoryStatus(req, res, next) { try { await hotelService.updateNightStatus(companyId(req), req.params.id, req.body, actorId(req)); return redirect(res, '/company/room-calendar'); } catch (error) { return next(error); } }
async function archiveInventory(req, res, next) { try { await hotelService.archiveNightInventory(companyId(req), req.params.id, actorId(req)); return redirect(res, '/company/room-calendar'); } catch (error) { return next(error); } }
async function checkIn(req, res, next) { try { await hotelService.markStay(companyId(req), req.params.bookingRef, 'checked_in', actorId(req), { overrideReason: req.body.overrideReason }); return redirect(res, '/company/in-house-guests'); } catch (error) { return next(error); } }
async function checkOut(req, res, next) { try { await hotelService.markStay(companyId(req), req.params.bookingRef, 'checked_out', actorId(req), { overrideReason: req.body.overrideReason }); return redirect(res, '/company/departures'); } catch (error) { return next(error); } }
async function noShow(req, res, next) { try { await hotelService.markNoShow(companyId(req), req.params.bookingRef, actorId(req), { reason: req.body.reason || req.body.note, overrideReason: req.body.overrideReason }); return redirect(res, '/company/arrivals'); } catch (error) { return next(error); } }
function voucherActorBase(req) { return String(req.originalUrl || req.url || '').startsWith('/employee/') ? '/employee' : '/company'; }
async function voucher(req, res, next) {
  try {
    const data = await hotelService.operationalVoucher(companyId(req), req.params.bookingRef);
    const base = voucherActorBase(req);
    return res.render('pages/hotel-voucher-detail', {
      seo: { title: `${data.booking.bookingRef} hotel voucher | Classic Trip` },
      ...data,
      actorBase: base,
      dashboardPath: base === '/employee' ? '/employee/dashboard/arrivals' : '/company/arrivals',
      defaultCurrency: platformCurrency(),
    });
  } catch (error) { return next(error); }
}
async function voucherPdf(req, res, next) {
  try {
    const data = await hotelService.operationalVoucher(companyId(req), req.params.bookingRef);
    if (!data.ticketReady) return res.status(409).send('The hotel voucher is available only for a successfully paid, valid booking.');
    const buffer = await ticketPdfService.buildTicketPdfBuffer(data.booking, data.listing);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${data.booking.bookingRef}-hotel-voucher.pdf"`);
    res.setHeader('Content-Length', buffer.length);
    return res.send(buffer);
  } catch (error) { return next(error); }
}
async function updateHousekeeping(req, res, next) { try { await hotelService.updateHousekeeping(companyId(req), req.params.unitId, req.body, actorId(req)); return redirect(res, '/company/housekeeping'); } catch (error) { return next(error); } }

const manifestColumns = [
  { key: 'bookingRef', label: 'Booking' },
  { key: 'guestName', label: 'Lead guest' },
  { key: 'guestCount', label: 'Guests' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'identity', label: 'Identity' },
  { key: 'nationality', label: 'Nationality' },
  { key: 'property', label: 'Property' },
  { key: 'roomType', label: 'Room type' },
  { key: 'roomNumbers', label: 'Room(s)' },
  { key: 'occupancy', label: 'Occupancy' },
  { key: 'checkIn', label: 'Check-in' },
  { key: 'checkOut', label: 'Check-out' },
  { key: 'estimatedArrivalTime', label: 'ETA' },
  { key: 'actualCheckIn', label: 'Actual in' },
  { key: 'actualCheckOut', label: 'Actual out' },
  { key: 'paymentStatus', label: 'Payment' },
  { key: 'settlementStatus', label: 'Settlement' },
  { key: 'status', label: 'Stay status' },
  { key: 'emergencyContact', label: 'Emergency contact' },
  { key: 'specialRequests', label: 'Special requests' },
];

function defaultHotelDate() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Kampala' }); }
function manifestListingId(req) { return String(req.params?.listingId || req.query?.listingId || '').trim(); }
function manifestFileScope(listingId) { return listingId || 'all-properties'; }
function manifestActorBase(req) { return String(req.originalUrl || req.url || '').startsWith('/employee/') ? '/employee' : '/company'; }
function manifestBasePath(listingId, req) { const base = manifestActorBase(req); return listingId ? `${base}/hotels/${encodeURIComponent(listingId)}/manifest` : `${base}/hotels/manifest`; }

async function manifest(req, res, next) {
  try {
    const mode = req.query.mode || 'arrivals';
    const date = req.query.date || defaultHotelDate();
    const listingId = manifestListingId(req);
    const rows = await hotelService.manifestRecords(companyId(req), listingId, mode, date);
    return res.render('pages/hotel-manifest-print', { seo: { title: 'Hotel manifest | Classic Trip' }, rows, columns: manifestColumns, mode, date, listingId, manifestBasePath: manifestBasePath(listingId, req) });
  } catch (error) { return next(error); }
}
async function manifestCsv(req, res, next) {
  try {
    const mode = req.query.mode || 'arrivals';
    const date = req.query.date || defaultHotelDate();
    const listingId = manifestListingId(req);
    const rows = await hotelService.manifestRecords(companyId(req), listingId, mode, date);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="hotel-${mode}-${date}-${manifestFileScope(listingId)}.csv"`);
    return res.send(hotelService.toCsv(manifestColumns, rows));
  } catch (error) { return next(error); }
}
async function manifestPdf(req, res, next) {
  try {
    const mode = req.query.mode || 'arrivals';
    const date = req.query.date || defaultHotelDate();
    const listingId = manifestListingId(req);
    const rows = await hotelService.manifestRecords(companyId(req), listingId, mode, date);
    const buffer = await hotelService.pdfBuffer(`Hotel ${mode} manifest — ${date}`, rows, manifestColumns);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="hotel-${mode}-${date}-${manifestFileScope(listingId)}.pdf"`);
    return res.send(buffer);
  } catch (error) { return next(error); }
}

module.exports = {
  createProperty, updateProperty, archiveProperty,
  createRoomType, updateRoomType, setRoomTypeInventory, archiveRoomType,
  createRatePlan, updateRatePlan, archiveRatePlan,
  createRoomUnits, updateRoomUnit, archiveRoomUnit,
  createInventory, updateInventoryStatus, archiveInventory,
  checkIn, checkOut, noShow, voucher, voucherPdf, updateHousekeeping,
  manifest, manifestCsv, manifestPdf,
};
