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
const notFound = require('./middlewares/notFound');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(sessionConfig());
app.use(passport.initialize());
app.use(passport.session());
app.use(attachUser);
app.use(attachReferral);
app.use(csrfToken);
app.use((req, res, next) => {
  res.locals.appName = env.appName;
  res.locals.currentPath = req.path;
  res.locals.query = req.query;
  res.locals.money = (amount, currency = 'UGX') => `${currency} ${Math.round(Number(amount) || 0).toLocaleString()}`;
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
app.use('/api/bookings', require('./routes/api/bookings'));
app.use('/api/payments', require('./routes/api/payments'));
app.use('/api/dashboards', require('./routes/api/dashboards'));
app.use('/api/scanner', require('./routes/api/scanner'));
app.use('/api/webhooks', require('./routes/api/webhooks'));
app.use('/api/uploads', require('./routes/api/uploads'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
