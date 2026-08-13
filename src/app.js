const express = require('express');
const crypto = require('crypto');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const sessionConfig = require('./config/session');
const passport = require('./config/passport');
const { env } = require('./config/env');
const { getCachedPlatformConfig } = require('./services/platform/platformConfigService');
const { formatRouteLabel } = require('./utils/routeLabel');
const { mediaUrl, resolveMediaUrl } = require('./utils/mediaUrl');
const { SERVICE_REGISTRY, ACTIVE_SERVICE_TYPES, COMING_SOON_SERVICE_TYPES } = require('./config/serviceRegistry');
const { publicMarkets } = require('./config/countryMarkets');
const { attachUser } = require('./middlewares/auth');
const { attachReferral } = require('./middlewares/referral');
const { csrfToken } = require('./middlewares/csrf');
const flashMiddleware = require('./middlewares/flash');
const publicPerformance = require('./middlewares/publicPerformance');
const searchIndexing = require('./middlewares/searchIndexing');
const dashboardMutationState = require('./middlewares/dashboardMutationState');
const platformMonitoring = require('./middlewares/platformMonitoring');
const notFound = require('./middlewares/notFound');
const errorHandler = require('./middlewares/errorHandler');

const app = express();
const PUBLIC_MARKETS = publicMarkets();
app.disable('x-powered-by');

function cspOrigin(value) {
  try { return new URL(String(value || '').replace('{s}', 'a').replace('{z}', '0').replace('{x}', '0').replace('{y}', '0')).origin; }
  catch (_) { return ''; }
}
const configuredMapTileOrigin = cspOrigin(env.maps?.tileUrl);

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('view cache', env.isProduction);

app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  const startedAt = process.hrtime.bigint();
  res.setHeader('X-Request-ID', req.id);
  res.locals.requestId = req.id;
  res.locals.cspNonce = crypto.randomBytes(18).toString('base64');
  const originalEnd = res.end;
  res.end = function timedEnd(...args) {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    if (!res.headersSent) res.setHeader('Server-Timing', `app;dur=${durationMs.toFixed(1)}`);
    if (env.performance.logSlowRequests && durationMs >= env.performance.slowRequestThresholdMs) {
      require('./config/logger').warn('Slow request', {
        requestId: req.id,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Math.round(durationMs),
        role: req.session?.user?.role || 'guest',
      });
    }
    return originalEnd.apply(this, args);
  };
  next();
});

const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`, 'https://cdn.jsdelivr.net', 'https://unpkg.com', 'https://cdnjs.cloudflare.com'],
  scriptSrcAttr: ["'none'"],
  styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
  fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com'],
  imgSrc: ["'self'", 'data:', 'https://res.cloudinary.com', 'https://*.cloudinary.com', 'https://cdn.jsdelivr.net', 'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org', ...(configuredMapTileOrigin ? [configuredMapTileOrigin] : [])],
  connectSrc: ["'self'"],
  frameSrc: ["'none'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  manifestSrc: ["'self'"],
};
if (env.isProduction) cspDirectives.upgradeInsecureRequests = [];
app.use(helmet({
  contentSecurityPolicy: { directives: cspDirectives },
  crossOriginEmbedderPolicy: false,
}));
app.use((req, res, next) => {
  if (!env.isProduction || req.secure || req.headers['x-forwarded-proto'] === 'https') return next();
  const publicOrigin = new URL(env.appUrl).origin;
  return res.redirect(308, `${publicOrigin}${req.originalUrl}`);
});
app.use((req, res, next) => {
  if (!env.isProduction) return next();
  const requestHost = String(req.get('host') || '').split(':')[0].trim().toLowerCase();
  if (requestHost !== 'classictrip.org') return next();
  return res.redirect(308, `https://www.classictrip.org${req.originalUrl}`);
});

// Internet scanners routinely probe WordPress/PHP endpoints such as
// /xmlrpc.php. Reject them before body parsing, sessions, monitoring and CSRF
// middleware so bot noise cannot consume Redis/Mongo capacity or generate
// misleading CSRF warnings.
const HOSTILE_PROBE_PATHS = new Set(['/xmlrpc.php', '/wp-login.php', '/wp-config.php', '/.env']);
app.use((req, res, next) => {
  const pathname = String(req.path || '').toLowerCase();
  if (!HOSTILE_PROBE_PATHS.has(pathname) && !pathname.startsWith('/wp-admin') && !pathname.startsWith('/.git/')) return next();
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.status(404).type('text/plain').send('Not Found');
});
app.get('/site.webmanifest', (req, res) => {
  res.type('application/manifest+json');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  return res.sendFile(path.join(__dirname, '..', 'public', 'site.webmanifest'));
});
app.get('/sw.js', (req, res) => {
  res.type('application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  return res.sendFile(path.join(__dirname, '..', 'public', 'sw.js'));
});
app.use(compression({ threshold: 1024, level: 6 }));
app.use(express.static(path.join(__dirname, '..', 'public'), {
  maxAge: env.isProduction ? '30d' : 0,
  immutable: env.isProduction,
  setHeaders(res, filePath) {
    if (/\.(?:webmanifest)$/i.test(filePath)) res.setHeader('Content-Type', 'application/manifest+json');
  },
}));
app.use(express.urlencoded({ extended: true, limit: '2mb', verify: (req, res, buf) => { req.rawBody = buf?.toString('utf8') || ''; } }));
app.use(express.json({ limit: '2mb', verify: (req, res, buf) => { req.rawBody = buf?.toString('utf8') || ''; } }));
app.use(cookieParser());
app.use(sessionConfig());
app.use(passport.initialize());
app.use(passport.session());
app.use(attachUser);
app.use(attachReferral);
app.use(platformMonitoring);
app.use(csrfToken);
app.use(flashMiddleware);
app.use(publicPerformance);
app.use(searchIndexing);
app.use(dashboardMutationState);
app.use((req, res, next) => {
  res.locals.appName = env.appName;
  res.locals.currentPath = req.path;
  res.locals.query = req.query;
  res.locals.seoConfig = env.seo;
  res.locals.supportContacts = env.support;
  res.locals.siteUrl = env.seo.siteUrl;
  res.locals.platformMfaEnabled = env.platformMfaEnabled;
  const platformConfig = getCachedPlatformConfig();
  res.locals.platformConfig = platformConfig;
  res.locals.serviceCatalog = SERVICE_REGISTRY;
  res.locals.activeServiceTypes = ACTIVE_SERVICE_TYPES;
  res.locals.comingSoonServiceTypes = COMING_SOON_SERVICE_TYPES;
  res.locals.countryMarkets = PUBLIC_MARKETS;
  res.locals.money = (amount, currency = platformConfig.defaultCurrency) => `${String(currency || platformConfig.defaultCurrency).toUpperCase()} ${Math.round(Number(amount) || 0).toLocaleString('en-GB')}`;
  res.locals.routeDisplay = (origin, destination, fallback = '') => formatRouteLabel(origin, destination, fallback);
  res.locals.mediaUrl = mediaUrl;
  res.locals.resolveMediaUrl = resolveMediaUrl;
  // Escapes `<` so JSON embedded inside <script> tags (via <%- %>) can't be broken out of
  // with a `</script>` payload in user-controlled data.
  res.locals.toScriptJson = (value) => JSON.stringify(value === undefined ? null : value).replace(/</g, '\\u003c');
  next();
});


app.use('/', require('./routes/web/public'));
app.use('/', require('./routes/web/auth'));
app.use('/', require('./routes/web/customer'));
app.use('/', require('./routes/web/company'));
app.use('/', require('./modules/flight/routes/partnerFlightRoutes'));
app.use('/', require('./modules/flight/routes/adminFlightRoutes'));
app.use('/', require('./modules/taxi/routes/partnerTaxiRoutes'));
app.use('/', require('./modules/taxi/routes/adminTaxiRoutes'));
app.use('/', require('./routes/web/employee'));
app.use('/', require('./routes/web/promoter'));
app.use('/', require('./routes/web/admin'));

app.use('/api/search', require('./routes/api/search'));
app.use('/api/listings', require('./routes/api/listings'));
app.use('/api/v1/listings', require('./routes/api/listings'));
app.use('/api/v1/places', require('./routes/api/places'));
app.use('/api/v1/bus', require('./modules/bus/routes/publicBusRoutes'));
app.use('/api/v1/flights', require('./modules/flight/routes/publicFlightRoutes'));
app.use('/api/v1/taxi', require('./modules/taxi/routes/publicTaxiRoutes'));
app.use('/api/v1/taxi/driver', require('./modules/taxi/routes/driverTaxiRoutes'));
app.use('/api/bookings', require('./routes/api/bookings'));
app.use('/api/payments', require('./routes/api/payments'));
app.use('/api/dashboards', require('./routes/api/dashboards'));
app.use('/api/notifications', require('./routes/api/notifications'));
app.use('/api/scanner', require('./routes/api/scanner'));
app.use('/api/webhooks', require('./routes/api/webhooks'));
app.use('/api/uploads', require('./routes/api/uploads'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
