const manifestService = require('../../services/operations/manifestService');
const { resolveCompanyId } = require('../../utils/companyScope');

function companyId(req) { return resolveCompanyId(req); }
function generatedBy(req) { return req.session?.user?.fullName || req.session?.user?.email || 'Classic Trip operator'; }

async function manifestPage(req, res, next) {
  try {
    const manifest = await manifestService.buildManifestLive(companyId(req), req.params.scheduleId, { generatedBy: generatedBy(req), printMode: req.query.mode || 'before_departure' });
    res.render('pages/driver-manifest-print', { seo: { title: `${manifest.schedule.id} manifest | Classic Trip` }, manifest, mode: req.query.mode || 'print' });
  } catch (error) { next(error); }
}
async function manifestCsv(req, res, next) {
  try {
    const report = await manifestService.manifestCsvLive(companyId(req), req.params.scheduleId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="${report.filename}"`); res.send(report.csv);
  } catch (error) { next(error); }
}
async function manifestExcel(req, res, next) {
  try {
    const report = await manifestService.manifestExcelLive(companyId(req), req.params.scheduleId);
    res.setHeader('Content-Type', report.contentType); res.setHeader('Content-Disposition', `attachment; filename="${report.filename}"`); res.send(report.body);
  } catch (error) { next(error); }
}
async function manifestPdf(req, res, next) {
  try {
    const buffer = await manifestService.manifestPdfBuffer(companyId(req), req.params.scheduleId, { generatedBy: generatedBy(req) });
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${req.params.scheduleId}-manifest.pdf"`); res.setHeader('Content-Length', buffer.length); res.send(buffer);
  } catch (error) { next(error); }
}
async function customerManifestPage(req, res, next) {
  try {
    const scopedCompanyId = companyId(req);
    const [rows, filterOptions] = await Promise.all([
      manifestService.buildCustomerListLive(scopedCompanyId, req.query || {}),
      manifestService.customerManifestFilterOptionsLive(scopedCompanyId),
    ]);
    res.render('pages/company-customer-manifest', { seo: { title: 'Customer manifest | Classic Trip' }, rows, filters: req.query || {}, filterOptions, generatedBy: generatedBy(req), companyId: scopedCompanyId });
  } catch (error) { next(error); }
}
async function customerManifestCsv(req, res, next) {
  try {
    const report = await manifestService.filteredCustomerCsvLive(companyId(req), req.query || {});
    res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="${report.filename}"`); res.send(report.csv);
  } catch (error) { next(error); }
}
async function customerManifestExcel(req, res, next) {
  try {
    const report = await manifestService.filteredCustomerExcelLive(companyId(req), req.query || {});
    res.setHeader('Content-Type', report.contentType); res.setHeader('Content-Disposition', `attachment; filename="${report.filename}"`); res.send(report.body);
  } catch (error) { next(error); }
}
async function customerManifestPdf(req, res, next) {
  try {
    const buffer = await manifestService.filteredCustomerPdfBuffer(companyId(req), req.query || {});
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', 'attachment; filename="company-customer-manifest.pdf"'); res.setHeader('Content-Length', buffer.length); res.send(buffer);
  } catch (error) { next(error); }
}
async function ticketDetail(req, res, next) {
  try {
    const ticket = await manifestService.bookingForCompanyLive(companyId(req), req.params.bookingRef);
    res.render('pages/driver-ticket-detail', { seo: { title: `${ticket.booking.bookingRef} operational ticket | Classic Trip` }, ticket });
  } catch (error) { next(error); }
}
async function seatTicketDetail(req, res, next) {
  try {
    const ticket = await manifestService.bookingForSeatLive(companyId(req), req.params.scheduleId, req.params.seatNumber);
    res.render('pages/driver-ticket-detail', { seo: { title: `${ticket.booking.bookingRef} operational ticket | Classic Trip` }, ticket });
  } catch (error) { next(error); }
}
module.exports = { manifestPage, manifestCsv, manifestExcel, manifestPdf, customerManifestPage, customerManifestCsv, customerManifestExcel, customerManifestPdf, ticketDetail, seatTicketDetail };
