// Resolves the authenticated principal directly and rejects missing tenant scope; replaces unsafe patterns such as
// `req.session?.user?.id || 'user-customer-001'` scattered across customer controllers/services.
// Using a default customer id whenever the session id was unset meant any
// authenticated customer with a missing/corrupted session id silently got read/write access to
// that other customer's bookings, wallet, and saved trips instead of an error.
function resolveCustomerId(req) {
  const user = req.session?.user;
  if (!user?.id || !['customer', 'super_admin'].includes(user.role)) {
    const error = new Error('Your account is not recognized as a customer. Please log in again.');
    error.status = 403;
    throw error;
  }
  return user.id;
}

module.exports = { resolveCustomerId };
