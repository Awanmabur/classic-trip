// Resolves the authenticated principal directly and rejects missing tenant scope; replaces unsafe patterns such as
// `req.session?.user?.id || 'user-promoter-001'` scattered across promoter controllers/services.
// Using a default promoter id whenever the session id was unset meant any
// authenticated promoter with a missing/corrupted session id silently got read/write access to
// that other promoter's links, commissions, and withdrawals instead of an error.
function resolvePromoterId(req) {
  const user = req.session?.user;
  if (!user?.id || !['promoter', 'super_admin'].includes(user.role)) {
    const error = new Error('Your account is not recognized as a promoter. Please log in again.');
    error.status = 403;
    throw error;
  }
  return user.id;
}

module.exports = { resolvePromoterId };
