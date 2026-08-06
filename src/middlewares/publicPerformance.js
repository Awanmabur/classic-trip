const SAFE_METHODS = new Set(['GET', 'HEAD']);

const CACHEABLE_PUBLIC_PATHS = [
  /^\/$/,
  /^\/search$/,
  /^\/services$/,
  /^\/routes$/,
  /^\/companies(?:\/[^/]+)?$/,
  /^\/partner\/[^/]+$/,
  /^\/promoters$/,
  /^\/promoter-program$/,
  /^\/partner-commission$/,
  /^\/blogs(?:\/[^/]+)?$/,
  /^\/how-it-works$/,
  /^\/privacy$/,
  /^\/terms$/,
  /^\/listings\/[^/]+\/[^/]+$/,
];

function isCacheablePublicPath(pathname = '') {
  return CACHEABLE_PUBLIC_PATHS.some((pattern) => pattern.test(String(pathname || '')));
}

function publicPerformance(req, res, next) {
  if (!SAFE_METHODS.has(String(req.method || '').toUpperCase())) return next();
  if (!isCacheablePublicPath(req.path)) return next();
  if (req.session?.user || req.session?.csrfToken || req.session?.referralCode) return next();
  if (Array.isArray(req.session?.flashMessages) && req.session.flashMessages.length) return next();
  if (req.query?.ref) return next();

  const isListingDetail = /^\/listings\/[^/]+\/[^/]+$/.test(String(req.path || ''));
  if (isListingDetail) {
    // Listing pages carry a per-browser CSRF cookie for the prepare/payment form.
    // Keep them in the browser cache (and prefetch cache), never a shared CDN cache.
    res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=120, stale-if-error=600');
  } else {
    // Shared caches may reuse anonymous marketing HTML briefly while stale-while-
    // revalidate keeps navigation responsive through short database/network dips.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400');
    res.setHeader('CDN-Cache-Control', 'public, max-age=60, stale-while-revalidate=300, stale-if-error=86400');
  }
  res.vary('Accept-Encoding');
  return next();
}

module.exports = publicPerformance;
module.exports.isCacheablePublicPath = isCacheablePublicPath;
