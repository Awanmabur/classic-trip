const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const sessionConfig = require('./config/session');
const passport = require('./config/passport');
const { env } = require('./config/env');
const { attachUser } = require('./middlewares/auth');
const { attachReferral } = require('./middlewares/referral');
const { csrfToken } = require('./middlewares/csrf');
const flashMiddleware = require('./middlewares/flash');
const notFound = require('./middlewares/notFound');
const errorHandler = require('./middlewares/errorHandler');
const store = require('./services/data/persistentStore');
const { mongoose } = require('./config/db');
const logger = require('./config/logger');

const app = express();

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.urlencoded({ extended: true, verify: (req, res, buf) => { req.rawBody = buf?.toString('utf8') || ''; } }));
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf?.toString('utf8') || ''; } }));
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
  res.locals.money = (amount, currency = 'UGX') => `${currency} ${Math.round(Number(amount) || 0).toLocaleString()}`;
  next();
});

app.use(async (req, res, next) => {
  try {
    const shouldRefresh = req.method === 'GET' && (/^\/(admin|company|employee|promoter|customer|tickets|api)/.test(req.path) || req.path === '/');
    if (shouldRefresh) await store.refreshFromDatabase({ mongoose, logger, minIntervalMs: 5000 });
    next();
  } catch (error) {
    next(error);
  }
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
app.use('/api/bookings', require('./routes/api/bookings'));
app.use('/api/payments', require('./routes/api/payments'));
app.use('/api/dashboards', require('./routes/api/dashboards'));
app.use('/api/scanner', require('./routes/api/scanner'));
app.use('/api/webhooks', require('./routes/api/webhooks'));
app.use('/api/uploads', require('./routes/api/uploads'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
