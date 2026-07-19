function ownsBooking(booking, user = {}) {
  if (!booking) return false;
  if (booking.customerUserId) return String(booking.customerUserId) === String(user.id);
  const email = String(user.email || '').trim().toLowerCase();
  const phone = String(user.phone || '').trim();
  return Boolean(
    (email && String(booking.guestSnapshot?.email || '').toLowerCase() === email)
    || (phone && String(booking.guestSnapshot?.phone || '') === phone)
  );
}

module.exports = { ownsBooking };
