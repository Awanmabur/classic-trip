const { platformCurrency } = require('../../utils/currency');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { env } = require('../../config/env');
const { uploadBuffer } = require('../media/cloudinaryService');

function clean(value, fallback = '') {
  return String(value || fallback).replace(/<[^>]*>/g, '').trim();
}

function money(amount, currency = platformCurrency()) {
  return `${currency} ${Math.round(Number(amount) || 0).toLocaleString()}`;
}

function buildTicketPdfPayload(booking) {
  const isHotel = booking.serviceType === 'hotel';
  return {
    fileName: `${booking.bookingRef}${isHotel ? '-hotel-voucher' : '-ticket'}.pdf`,
    title: isHotel ? 'Classic Trip Hotel Voucher' : 'Classic Trip Ticket',
    bookingRef: booking.bookingRef,
    qrCodeValue: booking.qrCodeValue,
    note: 'PDF ticket is generated with PDFKit and can be uploaded to Cloudinary for production storage.',
  };
}

function displaySeatNo(value, serviceType = '') {
  const raw = String(value || '').trim();
  if (!raw) return 'Selected inventory';
  if (serviceType !== 'bus') return raw;
  const withoutPrefix = raw.replace(/^seat\s*(no\.?|number)?\s*/i, '').trim();
  const prefixed = withoutPrefix.match(/^[A-Za-z](\d+)$/);
  const clean = prefixed ? prefixed[1] : withoutPrefix;
  return `Seat No ${clean || raw}`;
}

function writeLine(doc, label, value, y) {
  doc.fontSize(9).fillColor('#64748b').text(label.toUpperCase(), 48, y, { width: 160 });
  doc.fontSize(12).fillColor('#111827').text(clean(value, '-'), 190, y, { width: 230 });
}

async function qrBuffer(value) {
  const dataUrl = await QRCode.toDataURL(value || 'CLASSIC-TRIP');
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

async function buildTicketPdfBuffer(booking, listing = {}) {
  const paymentStatus = String(booking?.paymentStatus || '').toLowerCase();
  const bookingStatus = String(booking?.bookingStatus || '').toLowerCase();
  if (paymentStatus !== 'successful' || ['cancelled', 'refunded', 'voided', 'failed', 'expired'].includes(bookingStatus)) {
    const error = new Error('Ticket or hotel voucher PDF is available only for a valid successfully paid booking');
    error.status = 409;
    error.statusCode = 409;
    throw error;
  }
  return new Promise(async (resolve, reject) => {
    try {
      const payload = buildTicketPdfPayload(booking);
      const guest = booking.guestSnapshot || {};
      const passenger = (booking.passengers || [])[0] || {};
      const pricing = booking.pricing || {};
      const addons = (Array.isArray(booking.addons) && booking.addons.length)
        ? booking.addons
        : (Array.isArray(pricing.addons) ? pricing.addons : []);
      const addonNames = addons.map((addon) => `${clean(addon.name, 'Add-on')}${Number(addon.quantity || 1) > 1 ? ` x ${addon.quantity}` : ''}`).join(', ');
      const tripType = booking.tripType === 'round_trip' || (booking.bookingLegs || []).length > 1 ? 'Return ticket' : 'One-way ticket';
      const isHotel = booking.serviceType === 'hotel';
      const hotelStay = booking.hotelStay || {};
      const roomLabels = (booking.passengers || []).map((row) => row.roomNumber || row.seatOrRoom || row.roomType).filter(Boolean);
      const guestCount = Number(hotelStay.adults || 0) + Number(hotelStay.children || 0) || (booking.passengers || []).length || 1;
      const qr = await qrBuffer(booking.qrCodeValue || booking.bookingRef);
      const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: payload.title } });
      const chunks = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.rect(0, 0, 595, 128).fill('#111827');
      doc.fillColor('#ffffff').fontSize(24).text(isHotel ? 'Classic Trip Hotel Voucher' : 'Classic Trip Ticket', 48, 38);
      doc.fontSize(12).fillColor('#cbd5e1').text(clean(listing.title, booking.serviceType || 'Travel service'), 48, 72, { width: 340 });
      doc.roundedRect(410, 32, 120, 36, 4).fill('#ffffff');
      doc.fillColor('#111827').fontSize(13).text(clean(booking.bookingStatus, 'confirmed').toUpperCase(), 426, 43);

      doc.fillColor('#111827').fontSize(28).text(clean(booking.bookingRef), 48, 154);
      doc.image(qr, 410, 148, { width: 120, height: 120 });
      doc.fontSize(8).fillColor('#64748b').text(isHotel ? 'Verify at reception' : 'Scan at boarding', 424, 274, { width: 130, align: 'center' });

      let y = 216;
      writeLine(doc, 'Customer', guest.fullName || 'Guest customer', y); y += 30;
      writeLine(doc, 'Email', guest.email || 'Not provided', y); y += 30;
      writeLine(doc, 'Phone', guest.phone || 'Not provided', y); y += 30;
      writeLine(doc, booking.serviceType === 'bus' ? 'Seat' : 'Room / inventory', isHotel ? (roomLabels.join(', ') || displaySeatNo(passenger.seatOrRoom, booking.serviceType)) : displaySeatNo(passenger.seatOrRoom, booking.serviceType), y); y += 30;
      if (booking.serviceType === 'bus') {
        writeLine(doc, 'Trip type', tripType, y); y += 30;
      } else {
        writeLine(doc, 'Check-in', hotelStay.checkIn || '-', y); y += 30;
        writeLine(doc, 'Check-out', hotelStay.checkOut || '-', y); y += 30;
        writeLine(doc, 'Rooms / guests', `${Number(hotelStay.roomCount || roomLabels.length || 1)} room(s), ${guestCount} guest(s)`, y); y += 30;
      }
      writeLine(doc, 'Payment', booking.paymentStatus || 'pending', y); y += 30;
      if (addonNames) { writeLine(doc, 'Optional extras', addonNames.slice(0, 110), y); y += 30; }
      writeLine(doc, 'Total', money(pricing.total, pricing.currency || platformCurrency()), y); y += 30;
      writeLine(doc, 'Reference', booking.paymentRef || booking.paymentProvider || '-', y); y += 30;

      const separatorY = Math.max(500, y + 6);
      doc.moveTo(48, separatorY).lineTo(545, separatorY).strokeColor('#e5e7eb').stroke();
      doc.fontSize(11).fillColor('#111827').text('QR value', 48, separatorY + 26);
      doc.fontSize(9).fillColor('#475569').text(clean(booking.qrCodeValue || booking.bookingRef), 48, separatorY + 46, { width: 497 });
      doc.fontSize(9).fillColor('#64748b').text(isHotel
        ? 'This paid hotel voucher must be verified against the live booking record at reception. A cancelled or refunded booking is not valid for check-in.'
        : 'This ticket is valid for one successful employee scan. Keep the booking reference and contact details available for manual lookup.', 48, 716, { width: 497 });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

async function uploadTicketPdf(booking, listing = {}) {
  if (!env.cloudinary.cloudName || !env.cloudinary.apiKey || !env.cloudinary.apiSecret) {
    return { status: 'skipped', reason: 'Cloudinary is not configured' };
  }
  const buffer = await buildTicketPdfBuffer(booking, listing);
  return uploadBuffer(buffer, `${env.cloudinary.folder}/tickets`, { resourceType: 'raw' });
}

module.exports = { buildTicketPdfPayload, buildTicketPdfBuffer, uploadTicketPdf };
