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
const { SERVICE_REGISTRY, ACTIVE_SERVICE_TYPES, COMING_SOON_SERVICE_TYPES } = require('./config/serviceRegistry');
const { attachUser } = require('./middlewares/auth');
const { attachReferral } = require('./middlewares/referral');
const { csrfToken } = require('./middlewares/csrf');
const flashMiddleware = require('./middlewares/flash');
const notFound = require('./middlewares/notFound');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(18).toString('base64');
  next();
});

const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`, 'https://cdn.jsdelivr.net', 'https://unpkg.com', 'https://cdnjs.cloudflare.com'],
  scriptSrcAttr: ["'none'"],
  styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
  fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com'],
  imgSrc: ["'self'", 'data:', 'https://res.cloudinary.com', 'https://*.cloudinary.com'],
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
app.use(compression());
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: env.isProduction ? '1d' : 0 }));
app.use(express.urlencoded({ extended: true, limit: '2mb', verify: (req, res, buf) => { req.rawBody = buf?.toString('utf8') || ''; } }));
app.use(express.json({ limit: '2mb', verify: (req, res, buf) => { req.rawBody = buf?.toString('utf8') || ''; } }));
app.use(cookieParser());
app.use(sessionConfig());
app.use(passport.initialize());
app.use(passport.session());
app.use(attachUser);
app.use(attachReferral);
app.use(csrfToken);
app.use(flashMiddleware);
app.use((req, res, next) => {
  res.locals.appName = env.appName;
  res.locals.currentPath = req.path;
  res.locals.query = req.query;
  res.locals.seoConfig = env.seo;
  res.locals.siteUrl = env.seo.siteUrl;
  res.locals.platformMfaEnabled = env.platformMfaEnabled;
  const platformConfig = getCachedPlatformConfig();
  res.locals.platformConfig = platformConfig;
  res.locals.serviceCatalog = SERVICE_REGISTRY;
  res.locals.activeServiceTypes = ACTIVE_SERVICE_TYPES;
  res.locals.comingSoonServiceTypes = COMING_SOON_SERVICE_TYPES;
  res.locals.money = (amount, currency = platformConfig.defaultCurrency) => `${currency} ${Math.round(Number(amount) || 0).toLocaleString()}`;
  // Escapes `<` so JSON embedded inside <script> tags (via <%- %>) can't be broken out of
  // with a `</script>` payload in user-controlled data.
  res.locals.toScriptJson = (value) => JSON.stringify(value === undefined ? null : value).replace(/</g, '\\u003c');
  next();
});


app.use('/', require('./routes/web/public'));
app.use('/', require('./routes/web/auth'));
app.use('/', require('./routes/web/customer'));
app.use('/', require('./routes/web/company'));
app.use('/', require('./routes/web/employee'));
app.use('/', require('./routes/web/promoter'));
app.use('/', require('./routes/web/admin'));

app.use('/api/search', require('./routes/api/search'));
app.use('/api/listings', require('./routes/api/listings'));
app.use('/api/v1/bus', require('./modules/bus/routes/publicBusRoutes'));
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

