'use strict';

const { platformCurrency } = require('../../utils/currency');
const { formatRouteLabel } = require('../../utils/routeLabel');
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

function documentMeta(booking = {}) {
  const serviceType = String(booking.serviceType || '').toLowerCase();
  if (serviceType === 'hotel') return { suffix: 'hotel-voucher', title: 'Classic Trip Hotel Voucher', short: 'Hotel voucher', qrCaption: 'Verify at reception' };
  if (serviceType === 'flight') return { suffix: 'flight-eticket', title: 'Classic Trip Flight E-ticket', short: 'Flight e-ticket', qrCaption: 'Verify at check-in' };
  if (serviceType === 'local_transport') return { suffix: 'ride-receipt', title: 'Classic Trip Ride Receipt', short: 'Ride receipt', qrCaption: 'Protected ride reference' };
  if (serviceType === 'tour') return { suffix: 'tour-voucher', title: 'Classic Trip Tour Voucher', short: 'Tour voucher', qrCaption: 'Verify with tour operator' };
  if (serviceType === 'car_rental') return { suffix: 'rental-voucher', title: 'Classic Trip Car Rental Voucher', short: 'Rental voucher', qrCaption: 'Verify at vehicle handover' };
  if (serviceType === 'cargo') return { suffix: 'cargo-receipt', title: 'Classic Trip Cargo Receipt', short: 'Cargo receipt', qrCaption: 'Verify at shipment handover' };
  return { suffix: 'bus-ticket', title: 'Classic Trip Bus Ticket', short: 'Bus ticket', qrCaption: 'Scan at boarding' };
}

function buildTicketPdfPayload(booking) {
  const meta = documentMeta(booking);
  return {
    fileName: `${booking.bookingRef}-${meta.suffix}.pdf`,
    title: meta.title,
    bookingRef: booking.bookingRef,
    qrCodeValue: booking.qrCodeValue,
    note: 'PDF travel document is generated from the authoritative paid booking snapshot.',
  };
}

function displaySeatNo(value, serviceType = '') {
  const raw = String(value || '').trim();
  if (!raw) return 'Selected inventory';
  if (serviceType !== 'bus') return raw;
  const withoutPrefix = raw.replace(/^seat\s*(no\.?|number)?\s*/i, '').trim();
  const prefixed = withoutPrefix.match(/^[A-Za-z](\d+)$/);
  const normalized = prefixed ? prefixed[1] : withoutPrefix;
  return `Seat No ${normalized || raw}`;
}

function formatDateTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
}

function compactRoute(point = {}) {
  return clean(point.address || point.name || point.city || point.district || point.iataCode || point.id, '-');
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
    const error = new Error('The travel document is available only for a valid successfully paid booking');
    error.status = 409;
    error.statusCode = 409;
    throw error;
  }

  return new Promise(async (resolve, reject) => {
    try {
      const payload = buildTicketPdfPayload(booking);
      const meta = documentMeta(booking);
      const serviceType = String(booking.serviceType || '').toLowerCase();
      const isBus = serviceType === 'bus';
      const isHotel = serviceType === 'hotel';
      const isFlight = serviceType === 'flight';
      const isTaxi = serviceType === 'local_transport';
      const isTour = serviceType === 'tour';
      const isRental = serviceType === 'car_rental';
      const isCargo = serviceType === 'cargo';
      const guest = booking.guestSnapshot || booking.buyerSnapshot || {};
      const passenger = (booking.passengers || [])[0] || {};
      const pricing = booking.pricing || {};
      const addons = (Array.isArray(booking.addons) && booking.addons.length)
        ? booking.addons
        : (Array.isArray(pricing.addons) ? pricing.addons : []);
      const addonNames = addons.map((addon) => `${clean(addon.name, 'Add-on')}${Number(addon.quantity || 1) > 1 ? ` x ${addon.quantity}` : ''}`).join(', ');
      const tripType = booking.tripType === 'round_trip' || (booking.bookingLegs || []).length > 1 ? 'Return ticket' : 'One-way ticket';
      const hotelStay = booking.hotelStay || {};
      const reservation = booking.serviceReservation || {};
      const roomLabels = (booking.passengers || []).map((row) => row.roomNumber || row.seatOrRoom || row.roomType).filter(Boolean);
      const guestCount = Number(hotelStay.adults || 0) + Number(hotelStay.children || 0) || (booking.passengers || []).length || 1;
      const flightLegs = (booking.bookingLegs || []).filter((leg) => leg && (leg.departureId || leg.flightNumber));
      const rideLeg = (booking.bookingLegs || []).find((leg) => leg && (leg.type === 'taxi' || leg.pickup || leg.destination)) || {};
      const ticketLegs = Array.isArray(booking.ticketLegs) ? booking.ticketLegs : [];
      const qr = await qrBuffer(booking.qrCodeValue || booking.bookingRef);
      const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: payload.title } });
      const chunks = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.rect(0, 0, 595, 128).fill('#111827');
      doc.fillColor('#ffffff').fontSize(24).text(meta.title, 48, 38);
      doc.fontSize(12).fillColor('#cbd5e1').text(clean(listing.title, serviceType || 'Travel service'), 48, 72, { width: 340 });
      doc.roundedRect(410, 32, 120, 36, 4).fill('#ffffff');
      doc.fillColor('#111827').fontSize(13).text(clean(booking.bookingStatus, 'confirmed').toUpperCase(), 426, 43);

      doc.fillColor('#111827').fontSize(28).text(clean(booking.bookingRef), 48, 154);
      doc.image(qr, 410, 148, { width: 120, height: 120 });
      doc.fontSize(8).fillColor('#64748b').text(meta.qrCaption, 424, 274, { width: 130, align: 'center' });

      let y = 216;
      writeLine(doc, isHotel ? 'Lead guest' : isFlight ? 'Booking contact' : isTaxi ? 'Passenger' : isTour ? 'Lead participant' : isRental ? 'Renter' : isCargo ? 'Sender' : 'Customer', guest.fullName || passenger.fullName || passenger.name || 'Guest customer', y); y += 30;
      writeLine(doc, 'Email', guest.email || passenger.email || 'Not provided', y); y += 30;
      writeLine(doc, 'Phone', guest.phone || passenger.phone || 'Not provided', y); y += 30;

      if (isBus) {
        writeLine(doc, 'Seat', displaySeatNo(passenger.seatOrRoom || passenger.seatNumber, serviceType), y); y += 30;
        writeLine(doc, 'Trip type', tripType, y); y += 30;
        const firstLeg = (booking.bookingLegs || [])[0] || {};
        if (firstLeg.origin || firstLeg.destination) { writeLine(doc, 'Journey', formatRouteLabel(clean(firstLeg.origin, '-'), clean(firstLeg.destination, '-')), y); y += 30; }
      } else if (isHotel) {
        writeLine(doc, 'Check-in', hotelStay.checkIn || '-', y); y += 30;
        writeLine(doc, 'Check-out', hotelStay.checkOut || '-', y); y += 30;
        writeLine(doc, 'Rooms / guests', `${Number(hotelStay.roomCount || roomLabels.length || 1)} room(s), ${guestCount} guest(s)`, y); y += 30;
        if (roomLabels.length) { writeLine(doc, 'Room inventory', roomLabels.join(', ').slice(0, 110), y); y += 30; }
      } else if (isFlight) {
        const itinerary = flightLegs.map((leg) => `${clean(leg.originAirportId)}-${clean(leg.destinationAirportId)}`).filter(Boolean).join(' / ');
        const flights = flightLegs.map((leg) => clean(leg.flightNumber)).filter(Boolean).join(', ');
        const seats = [...new Set(ticketLegs.map((leg) => clean(leg.seatNumber)).filter(Boolean))].join(', ');
        const ticketNumbers = [...new Set(ticketLegs.map((leg) => clean(leg.ticketNumber)).filter(Boolean))].join(', ');
        writeLine(doc, 'Travelers', String((booking.passengers || []).length || 1), y); y += 30;
        writeLine(doc, 'Itinerary', itinerary || '-', y); y += 30;
        writeLine(doc, 'Flights', flights || '-', y); y += 30;
        writeLine(doc, 'Departure', formatDateTime(flightLegs[0]?.departAt), y); y += 30;
        writeLine(doc, 'Seats', seats || 'Assigned at check-in', y); y += 30;
        writeLine(doc, 'Ticket numbers', ticketNumbers || 'Pending issuance', y); y += 30;
      } else if (isTaxi) {
        const pickup = rideLeg.pickup || ticketLegs[0]?.pickup || {};
        const destination = rideLeg.destination || ticketLegs[0]?.destination || {};
        writeLine(doc, 'Pickup', compactRoute(pickup), y); y += 30;
        writeLine(doc, 'Destination', compactRoute(destination), y); y += 30;
        writeLine(doc, 'Pickup time', formatDateTime(rideLeg.scheduledPickupAt || ticketLegs[0]?.scheduledPickupAt), y); y += 30;
        writeLine(doc, 'Ride type', clean(rideLeg.serviceType || passenger.seatOrRoom || 'Private ride'), y); y += 30;
        if (ticketLegs[0]?.rideRef || rideLeg.rideRef) { writeLine(doc, 'Ride reference', ticketLegs[0]?.rideRef || rideLeg.rideRef, y); y += 30; }
      } else if (isTour) {
        writeLine(doc, 'Tour date', reservation.serviceDate || '-', y); y += 30;
        writeLine(doc, 'Participants', String(Number(reservation.participantCount || (booking.passengers || []).length || 1)), y); y += 30;
        writeLine(doc, 'Meeting point', clean(reservation.meetingPoint || reservation.pickupLocation || listing.address, 'See operator instructions').slice(0, 110), y); y += 30;
        if (reservation.language) { writeLine(doc, 'Language', reservation.language, y); y += 30; }
      } else if (isRental) {
        writeLine(doc, 'Vehicle', clean(reservation.vehicleCategory || listing.vehicleCategory, 'Reserved vehicle'), y); y += 30;
        writeLine(doc, 'Pickup', `${clean(reservation.pickupDate, '-')} ${clean(reservation.pickupTime)}`.trim(), y); y += 30;
        writeLine(doc, 'Return', `${clean(reservation.returnDate, '-')} ${clean(reservation.returnTime)}`.trim(), y); y += 30;
        writeLine(doc, 'Rental period', `${Number(reservation.rentalDays || 1)} day(s)`, y); y += 30;
        writeLine(doc, 'Locations', formatRouteLabel(clean(reservation.pickupLocation, '-'), clean(reservation.returnLocation, '-')).slice(0, 110), y); y += 30;
        writeLine(doc, 'Driver option', clean(reservation.driverOption, 'self drive').replace(/_/g, ' '), y); y += 30;
      } else if (isCargo) {
        writeLine(doc, 'Pickup date', reservation.pickupDate || '-', y); y += 30;
        writeLine(doc, 'Route', formatRouteLabel(clean(reservation.pickupLocation, '-'), clean(reservation.deliveryLocation, '-')).slice(0, 110), y); y += 30;
        writeLine(doc, 'Shipment', `${Number(reservation.packageCount || 1)} package(s), ${Number(reservation.weightKg || 0)} kg, ${clean(reservation.cargoType, 'cargo')}`, y); y += 30;
        writeLine(doc, 'Recipient', `${clean(reservation.recipientName, 'Not set')} ${clean(reservation.recipientPhone)}`.trim(), y); y += 30;
        if (reservation.dimensions) { writeLine(doc, 'Dimensions', reservation.dimensions, y); y += 30; }
      }

      writeLine(doc, 'Payment', booking.paymentStatus || 'pending', y); y += 30;
      if (addonNames) { writeLine(doc, 'Optional extras', addonNames.slice(0, 110), y); y += 30; }
      writeLine(doc, 'Total', money(pricing.total, pricing.currency || platformCurrency()), y); y += 30;
      writeLine(doc, 'Payment reference', booking.paymentRef || booking.paymentProvider || '-', y); y += 30;

      const separatorY = Math.min(675, Math.max(510, y + 6));
      doc.moveTo(48, separatorY).lineTo(545, separatorY).strokeColor('#e5e7eb').stroke();
      doc.fontSize(11).fillColor('#111827').text('Protected reference', 48, separatorY + 24);
      doc.fontSize(9).fillColor('#475569').text(clean(booking.qrCodeValue || booking.bookingRef), 48, separatorY + 44, { width: 497 });
      const notes = {
        bus: 'This paid bus ticket is valid only for the listed passenger, journey and seat. Staff validate it against the live booking record.',
        hotel: 'This paid hotel voucher must be verified against the live reservation at reception. A cancelled or refunded stay is not valid for check-in.',
        flight: 'This e-ticket reflects the authoritative paid flight order. Airline check-in, document, schedule-change and boarding rules still apply.',
        local_transport: 'This receipt identifies the protected ride booking. Driver identity, vehicle assignment and live tracking are available only through the secure ride page.',
        tour: 'This paid tour voucher is valid for the booked date and participant count. The operator verifies it against the live reservation.',
        car_rental: 'This rental voucher is valid for the listed renter, vehicle and pickup/return period. Identity and licence checks may be required at handover.',
        cargo: 'This cargo receipt identifies the paid shipment request. The cargo partner verifies the sender, recipient, packages and weight before handover.',
      };
      doc.fontSize(9).fillColor('#64748b').text(notes[serviceType] || 'This travel document must be verified against the live Classic Trip booking record.', 48, 716, { width: 497 });
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
