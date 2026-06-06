const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { env } = require('../../config/env');
const { uploadBuffer } = require('../media/cloudinaryService');

function clean(value, fallback = '') {
  return String(value || fallback).replace(/<[^>]*>/g, '').trim();
}

function money(amount, currency = 'UGX') {
  return `${currency} ${Math.round(Number(amount) || 0).toLocaleString()}`;
}

function buildTicketPdfPayload(booking) {
  return {
    fileName: `${booking.bookingRef}.pdf`,
    title: 'Classic Trip Ticket',
    bookingRef: booking.bookingRef,
    qrCodeValue: booking.qrCodeValue,
    note: 'PDF ticket is generated with PDFKit and can be uploaded to Cloudinary for production storage.',
  };
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
  return new Promise(async (resolve, reject) => {
    try {
      const payload = buildTicketPdfPayload(booking);
      const guest = booking.guestSnapshot || {};
      const passenger = (booking.passengers || [])[0] || {};
      const pricing = booking.pricing || {};
      const qr = await qrBuffer(booking.qrCodeValue || booking.bookingRef);
      const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: payload.title } });
      const chunks = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.rect(0, 0, 595, 128).fill('#111827');
      doc.fillColor('#ffffff').fontSize(24).text('Classic Trip Ticket', 48, 38);
      doc.fontSize(12).fillColor('#cbd5e1').text(clean(listing.title, booking.serviceType || 'Travel service'), 48, 72, { width: 340 });
      doc.roundedRect(410, 32, 120, 36, 4).fill('#ffffff');
      doc.fillColor('#111827').fontSize(13).text(clean(booking.bookingStatus, 'confirmed').toUpperCase(), 426, 43);

      doc.fillColor('#111827').fontSize(28).text(clean(booking.bookingRef), 48, 154);
      doc.image(qr, 410, 148, { width: 120, height: 120 });
      doc.fontSize(8).fillColor('#64748b').text('Scan at check-in', 430, 274);

      let y = 216;
      writeLine(doc, 'Customer', guest.fullName || 'Guest customer', y); y += 30;
      writeLine(doc, 'Email', guest.email || 'Not provided', y); y += 30;
      writeLine(doc, 'Phone', guest.phone || 'Not provided', y); y += 30;
      writeLine(doc, 'Seat / room', passenger.seatOrRoom || 'Selected inventory', y); y += 30;
      writeLine(doc, 'Payment', booking.paymentStatus || 'pending', y); y += 30;
      writeLine(doc, 'Total', money(pricing.total, pricing.currency || 'UGX'), y); y += 30;
      writeLine(doc, 'Reference', booking.paymentRef || booking.paymentProvider || '-', y);

      doc.moveTo(48, 480).lineTo(545, 480).strokeColor('#e5e7eb').stroke();
      doc.fontSize(11).fillColor('#111827').text('QR value', 48, 506);
      doc.fontSize(9).fillColor('#475569').text(clean(booking.qrCodeValue || booking.bookingRef), 48, 526, { width: 497 });
      doc.fontSize(9).fillColor('#64748b').text('This ticket is valid for one successful employee scan. Keep the booking reference and contact details available for manual lookup.', 48, 716, { width: 497 });

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
