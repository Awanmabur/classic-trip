'use strict';

const commerceRepository = require('../../repositories/domain/commerceRepository');
const bookingPaymentService = require('../../services/payment/bookingPaymentService');
const ticketAccessService = require('../../services/booking/ticketAccessService');
const { safePaymentRedirect } = require('../../utils/paymentRedirect');
const logger = require('../../config/logger');

const HANDOFF_TTL_MS = 10 * 60 * 1000;

function strictPesapalCheckoutUrl(value = '') {
  const safe = safePaymentRedirect(value, '');
  if (!safe) return '';
  try {
    const parsed = new URL(safe);
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' || !(host === 'pesapal.com' || host.endsWith('.pesapal.com'))) return '';
    return parsed.toString();
  } catch (_) {
    return '';
  }
}

function stageHandoff(req, bookingRef, checkoutUrl, provider = 'pesapal') {
  const normalizedProvider = String(provider || 'pesapal').trim().toLowerCase().replace(/-/g, '_');
  const safeUrl = normalizedProvider === 'pesapal' ? strictPesapalCheckoutUrl(checkoutUrl) : safePaymentRedirect(checkoutUrl, '');
  if (!safeUrl) return '';
  if (req?.session) {
    req.session.paymentHandoff = {
      bookingRef: String(bookingRef || '').trim().slice(0, 180),
      checkoutUrl: safeUrl,
      provider: normalizedProvider,
      expiresAt: Date.now() + HANDOFF_TTL_MS,
    };
  }
  return `/booking/payment/handoff/${encodeURIComponent(String(bookingRef || '').trim())}`;
}

async function persistSession(req) {
  if (!req?.session || typeof req.session.save !== 'function') return;
  await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
}

async function openCheckout(req, res, bookingRef, checkoutUrl, provider = 'pesapal', fallback = '') {
  const target = stageHandoff(req, bookingRef, checkoutUrl, provider);
  if (!target) return res.redirect(303, fallback || ticketStatusUrl(bookingRef, 'unavailable'));
  await persistSession(req);
  return res.redirect(303, target);
}

async function handoff(req, res, next) {
  try {
    const bookingRef = String(req.params.bookingRef || '').trim().slice(0, 180);
    if (!bookingRef) return res.redirect(303, '/tickets');
    const staged = req.session?.paymentHandoff;
    let checkoutUrl = '';
    let provider = 'pesapal';
    if (staged && staged.bookingRef === bookingRef && Number(staged.expiresAt || 0) > Date.now()) {
      provider = String(staged.provider || 'pesapal').trim().toLowerCase().replace(/-/g, '_');
      checkoutUrl = provider === 'pesapal' ? strictPesapalCheckoutUrl(staged.checkoutUrl) : safePaymentRedirect(staged.checkoutUrl, '');
    }
    if (!checkoutUrl) {
      const booking = await commerceRepository.bookings.findOne({ bookingRef });
      if (!booking) return res.redirect(303, ticketStatusUrl(bookingRef, 'unavailable'));
      if (!ticketAccessService.canAccessBooking(req, booking)) return res.status(403).send('Payment access requires the booking contact, access code, or an authorized account.');
      provider = String(booking.paymentProvider || 'pesapal').trim().toLowerCase().replace(/-/g, '_');
      checkoutUrl = provider === 'pesapal' ? strictPesapalCheckoutUrl(booking.checkoutUrl) : safePaymentRedirect(booking.checkoutUrl, '');
      if (!checkoutUrl) return res.redirect(303, ticketStatusUrl(bookingRef, 'unavailable'));
      stageHandoff(req, bookingRef, checkoutUrl, provider);
    }
    res.set('Cache-Control', 'no-store, private');
    logger.info('Payment handoff opened', {
      bookingRef,
      provider,
      checkoutHost: (() => { try { return new URL(checkoutUrl).hostname; } catch (_) { return ''; } })(),
    });
    return res.render('pages/payment-handoff', {
      seo: { title: 'Secure payment | Classic Trip', robots: 'noindex,nofollow' },
      bookingRef,
      checkoutUrl,
      provider,
    });
  } catch (error) {
    return next(error);
  }
}

function ticketStatusUrl(bookingRef, result = '') {
  const query = new URLSearchParams({ bookingRef });
  if (result) query.set('paymentRetry', result);
  return `/tickets?${query.toString()}`;
}

async function retry(req, res, next) {
  let booking;
  try {
    const bookingRef = String(req.params.bookingRef || '').trim().slice(0, 180);
    booking = await commerceRepository.bookings.findOne({ bookingRef });
    if (!booking) return res.status(404).send('Booking was not found');
    if (!ticketAccessService.canAccessBooking(req, booking)) {
      return res.status(403).send('Payment retry requires the booking contact, access code, or an authorized account.');
    }

    ticketAccessService.grantSessionAccess(req, booking.bookingRef);
    const result = await bookingPaymentService.initiate(booking.bookingRef, {
      provider: req.body?.provider || booking.paymentProvider || undefined,
    }, {
      accessGranted: true,
      bookingRef: booking.bookingRef,
      idempotencyKey: req.headers['idempotency-key'] || `public-retry-${booking.bookingRef}`,
      actorType: req.session?.user ? 'customer' : 'guest',
      ...(req.session?.user || {}),
    });

    if (result.alreadyPaid) return res.redirect(303, `/booking/success/${encodeURIComponent(booking.bookingRef)}`);
    if (result.checkoutUrl) {
      return openCheckout(req, res, booking.bookingRef, result.checkoutUrl, result.payment?.provider || booking.paymentProvider || 'pesapal', ticketStatusUrl(booking.bookingRef, 'unavailable'));
    }
    return res.redirect(303, ticketStatusUrl(booking.bookingRef, result.payment?.status === 'failed' ? 'declined' : 'pending'));
  } catch (error) {
    if (booking && Number(error.status || 500) >= 500) {
      ticketAccessService.grantSessionAccess(req, booking.bookingRef);
      return res.redirect(303, ticketStatusUrl(booking.bookingRef, 'unavailable'));
    }
    return next(error);
  }
}

module.exports = { retry, ticketStatusUrl, handoff, openCheckout, stageHandoff, strictPesapalCheckoutUrl };

