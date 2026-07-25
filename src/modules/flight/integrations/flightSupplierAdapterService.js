'use strict';

const crypto = require('crypto');

const adapters = new Map();

function problem(message, status = 503, code = 'flight_supplier_adapter_unavailable') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function clean(value, max = 120) { return String(value || '').trim().slice(0, max); }
function token(seed, length = 10) { return crypto.createHash('sha256').update(String(seed)).digest('hex').slice(0, length).toUpperCase(); }

function registerAdapter(key, adapter) {
  const normalized = clean(key, 120).toLowerCase();
  if (!normalized || !adapter || typeof adapter.confirmAndTicket !== 'function') throw new TypeError('A flight supplier adapter requires a key and confirmAndTicket function');
  adapters.set(normalized, adapter);
}

function hasAdapter(key) { return adapters.has(clean(key, 120).toLowerCase()); }

function assertBookingCapability({ supplier = {}, access = {}, agencyProfile = {} }) {
  if (supplier.status !== 'active') throw problem('Flight supplier is not active', 409, 'flight_supplier_inactive');
  if (!supplier.ticketingEnabled || supplier.mode === 'referral') throw problem('Selected supplier does not support ticket issuance', 409, 'flight_supplier_not_ticketing');
  if (!access.permissions?.book) throw problem('This agency is not authorised to book the selected supplier', 403, 'flight_supplier_booking_denied');
  if (!access.permissions?.ticket || !agencyProfile.ticketingAuthorityApproved) {
    throw problem('This agency can search offers but is not authorised to issue supplier tickets', 403, 'flight_ticketing_authority_required');
  }
  if (supplier.mode !== 'contracted_allotment' && !hasAdapter(supplier.adapterKey)) {
    throw problem('The certified supplier adapter is not registered; booking is disabled rather than simulated', 503, 'flight_supplier_adapter_unavailable');
  }
}

async function confirmAndTicket({ supplier = {}, access = {}, agencyProfile = {}, booking = {}, order = {}, departure = {}, passengers = [], seats = [] }) {
  assertBookingCapability({ supplier, access, agencyProfile });
  if (supplier.mode === 'contracted_allotment') {
    const supplierCode = clean(supplier.supplierCode || 'SUP', 12).replace(/[^A-Z0-9]/gi, '').toUpperCase() || 'SUP';
    const supplierOrderRef = `${supplierCode}-${token(`${booking.bookingRef}:order`, 12)}`;
    const pnr = token(`${booking.bookingRef}:pnr`, 6);
    return {
      supplierOrderRef,
      pnr,
      confirmedAt: new Date().toISOString(),
      tickets: passengers.map((passenger, index) => ({
        passengerIndex: index,
        passengerName: passenger.fullName || passenger.name || `Traveler ${index + 1}`,
        seatNumber: seats[index]?.seatNumber || passenger.seatNumber || '',
        ticketNumber: `${supplierCode}-${token(`${booking.bookingRef}:${index}:ticket`, 13)}`,
      })),
      rawReference: '',
    };
  }
  const adapter = adapters.get(clean(supplier.adapterKey, 120).toLowerCase());
  return adapter.confirmAndTicket({ supplier, access, agencyProfile, booking, order, departure, passengers, seats, idempotencyKey: `flight-ticket:${booking.bookingRef}` });
}

module.exports = { registerAdapter, hasAdapter, assertBookingCapability, confirmAndTicket };
