const ROLE_DASHBOARD_ROOTS = Object.freeze({
  support: '/support/dashboard',
  finance: '/finance/dashboard',
  operations: '/operations/dashboard',
  content: '/content/dashboard',
});

function normalizeRedirectArgs(statusOrPath, maybePath) {
  if (typeof statusOrPath === 'number') return { status: statusOrPath, path: maybePath };
  return { status: null, path: statusOrPath };
}

function rewriteAdminRedirect(roleKey) {
  const safeRoot = ROLE_DASHBOARD_ROOTS[roleKey];
  if (!safeRoot) throw new Error(`Unsupported specialized admin redirect role: ${roleKey}`);
  return function roleRedirectIsolation(req, res, next) {
    const redirect = res.redirect.bind(res);
    res.redirect = function isolatedRedirect(statusOrPath, maybePath) {
      const args = normalizeRedirectArgs(statusOrPath, maybePath);
      const destination = String(args.path || '');
      const safeDestination = destination.startsWith('/admin') ? safeRoot : destination;
      return args.status ? redirect(args.status, safeDestination) : redirect(safeDestination);
    };
    next();
  };
}

module.exports = { rewriteAdminRedirect, ROLE_DASHBOARD_ROOTS };
