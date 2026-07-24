// Guest/public booking, hotel-booking, and cart creation endpoints spread the raw request body
// into service functions that also serve trusted internal callers (offline sales, admin/company
// manual bookings) which legitimately set customerUserId themselves after resolving a real
// customer record. Those internal callers never put customerUserId in a payload built from
// unauthenticated client input, so the fix belongs at this trust boundary, not in the shared
// service functions: strip any client-supplied identity claim before it ever reaches them. The
// caller's own session id (resolved separately, downstream) is the only legitimate source of
// customer identity on these public paths.
function stripClientSuppliedIdentity(body = {}) {
  const { customerUserId, userId, ...safeBody } = body;
  return safeBody;
}

module.exports = { stripClientSuppliedIdentity };
