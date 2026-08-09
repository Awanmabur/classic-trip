const PRIVATE_PREFIXES = [
  '/admin', '/company', '/employee', '/driver', '/customer', '/account',
  '/promoter/dashboard', '/booking', '/book/', '/bookings/', '/tickets', '/saved',
  '/invite/', '/reset-password/', '/verify-email/', '/auth/', '/onboarding/',
  '/flights/orders/', '/taxi/rides/', '/api/', '/uploads/',
];
const PRIVATE_EXACT = new Set([
  '/login', '/register', '/forgot-password', '/reset-password', '/verify-email',
  '/verify-phone', '/health', '/ready',
]);

function isPrivateIndexPath(pathname = '') {
  const path = String(pathname || '');
  if (PRIVATE_EXACT.has(path)) return true;
  return PRIVATE_PREFIXES.some((prefix) => path === prefix.replace(/\/$/, '') || path.startsWith(prefix));
}

function searchIndexing(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (isPrivateIndexPath(req.path)) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    } else if (req.path === '/search') {
      // Faceted search remains useful to users and crawlers for link discovery, but should not create an index of query combinations.
      res.setHeader('X-Robots-Tag', 'noindex, follow, max-image-preview:large');
    }
  }
  return next();
}

module.exports = searchIndexing;
module.exports.isPrivateIndexPath = isPrivateIndexPath;
