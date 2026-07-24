const crypto = require('crypto');

function normalize(value = '') {
  return String(value || '').trim().toLowerCase();
}

function timingSafeStringEqual(a, b) {
  if (!a || !b) return false;
  const aBuf = Buffer.from(String(a));
  const bBuf = Buffer.from(String(b));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function normalizePhone(value = '') {
  return String(value || '').replace(/[^\d]/g, '');
}

function phoneCandidates(value = '') {
  const digits = normalizePhone(value);
  if (!digits) return new Set();
  const candidates = new Set([digits]);
  if (digits.startsWith('00')) candidates.add(digits.slice(2));
  if (digits.startsWith('0') && digits.length >= 9) candidates.add(digits.slice(1));
  // Permit a local 9-digit number to match a full international number, but do not accept
  // arbitrary short suffixes. Both sides must contribute a complete local subscriber number.
  if (digits.length > 9 && digits.length <= 15) candidates.add(digits.slice(-9));
  return candidates;
}

function accessCodeFor(booking = {}) {
  return String(booking.guestLookupCode || booking.lookupCode || '').trim();
}

function grantSessionAccess(req, bookingRef) {
  if (!req || !bookingRef) return;
  req.session = req.session || {};
  req.session.ticketAccess = req.session.ticketAccess || {};
  req.session.ticketAccess[String(bookingRef)] = true;
}

function hasSessionAccess(req, bookingRef) {
  return Boolean(req?.session?.ticketAccess?.[String(bookingRef)]);
}

function contactMatches(booking = {}, contact = '') {
  const key = normalize(contact);
  if (!key) return false;
  const email = normalize(booking.guestSnapshot?.email || booking.buyerSnapshot?.email || booking.customer?.email);
  const phone = normalize(booking.guestSnapshot?.phone || booking.buyerSnapshot?.phone || booking.customer?.phone);
  if (email && key.includes('@') && email === key) return true;
  const submittedPhones = phoneCandidates(key);
  const storedPhones = phoneCandidates(phone);
  for (const submitted of submittedPhones) {
    if (submitted.length < 9) continue;
    if (storedPhones.has(submitted)) return true;
  }
  return false;
}

function accessCodeMatches(booking = {}, code = '') {
  const expected = normalize(accessCodeFor(booking));
  return Boolean(expected && timingSafeStringEqual(normalize(code), expected));
}

function queryAccess(req = {}) {
  return {
    contact: req.query?.contact || req.query?.email || req.query?.phone || req.body?.contact || req.body?.email || req.body?.phone || '',
    accessCode: req.query?.accessCode || req.query?.code || req.query?.token || req.body?.accessCode || req.body?.code || req.body?.token || '',
  };
}

function userCanAccess(req = {}, booking = {}) {
  const user = req.session?.user;
  if (!user) return false;
  if (['super_admin', 'admin', 'support_admin', 'finance_admin', 'operations_admin'].includes(user.role)) return true;
  if (user.companyId && user.companyId === booking.companyId) return true;
  if (user.id && user.id === booking.customerUserId) return true;
  if (user.id && user.id === booking.promoterAttribution?.promoterId) return true;
  return false;
}

function canAccessBooking(req = {}, booking = {}) {
  if (!booking?.bookingRef) return false;
  if (hasSessionAccess(req, booking.bookingRef)) return true;
  if (userCanAccess(req, booking)) return true;
  const access = queryAccess(req);
  return contactMatches(booking, access.contact) || accessCodeMatches(booking, access.accessCode);
}

function ticketUrl(booking = {}, suffix = '') {
  const code = accessCodeFor(booking);
  const query = code ? `?accessCode=${encodeURIComponent(code)}` : '';
  return `/tickets/${encodeURIComponent(booking.bookingRef || '')}${suffix}${query}`;
}

module.exports = {
  accessCodeFor,
  grantSessionAccess,
  hasSessionAccess,
  contactMatches,
  accessCodeMatches,
  queryAccess,
  canAccessBooking,
  ticketUrl,
};