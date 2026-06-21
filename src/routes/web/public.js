const express = require('express');
const homeController = require('../../controllers/public/homeController');
const searchController = require('../../controllers/public/searchController');
const listingController = require('../../controllers/public/listingController');
const hotelBookingController = require('../../controllers/public/hotelBookingController');
const blogController = require('../../controllers/public/blogController');
const supportController = require('../../controllers/public/supportController');
const partnerController = require('../../controllers/public/partnerController');
const invitationController = require('../../controllers/public/invitationController');
const billingController = require('../../controllers/public/billingController');
const cartController = require('../../controllers/public/cartController');
const futureServiceController = require('../../controllers/public/futureServiceController');
const bookingService = require('../../services/booking/bookingService');
const store = require('../../services/data/persistentStore');
const { jobStatus } = require('../../jobs/scheduler');
const { bookingRules } = require('../../validators/bookingValidator');
const { supportRules } = require('../../validators/supportValidator');
const { companyRules } = require('../../validators/companyValidator');
const { onboardingRules, checkoutRules } = require('../../validators/billingValidator');
const { validateRequest } = require('../../middlewares/validate');
const { paymentLimiter } = require('../../middlewares/rateLimit');

const router = express.Router();

router.get('/', homeController.renderHome);
router.get('/search', searchController.searchPage);
router.get('/services', listingController.servicesPage);
router.get('/routes', listingController.routesPage);
router.get('/companies', listingController.companiesPage);
router.get('/promoters', listingController.promotersPage);
router.get('/promoter-program', listingController.promotersPage);
router.get('/pricing', billingController.renderPlans);
router.get('/future-services', futureServiceController.index);
router.get('/future-services.json', futureServiceController.json);
router.get('/future-services/:serviceType', futureServiceController.show);
router.get('/partner/onboarding', billingController.renderOnboarding);
router.post('/partner/onboarding', paymentLimiter, onboardingRules, validateRequest, billingController.createOnboarding);
router.get('/invite/:token', invitationController.show);
router.post('/invite/:token', invitationController.accept);
router.post('/invite/:token/reject', invitationController.reject);
router.get('/billing/checkout/:orderRef', billingController.renderCheckout);
router.post('/billing/checkout/:orderRef/pay', paymentLimiter, checkoutRules, validateRequest, billingController.payOrder);
router.get('/billing/success/:orderRef', billingController.renderSuccess);
router.get('/companies/:slug', listingController.companyProfile);
router.get('/partner/:slug', listingController.companyProfile);
router.get('/listings/:serviceType/:slug', listingController.listingDetails);
router.get('/book/:serviceType/:slug', listingController.bookingForm);
router.post('/cart', paymentLimiter, cartController.create);
router.get('/cart/:cartRef', cartController.renderCart);
router.get('/cart/:cartRef/recovery', cartController.renderRecovery);
router.post('/cart/:cartRef/items', paymentLimiter, cartController.addItem);
router.post('/cart/:cartRef/validate', paymentLimiter, cartController.validate);
router.post('/cart/:cartRef/checkout', paymentLimiter, cartController.checkout);
router.post('/cart/:cartRef/recover', paymentLimiter, cartController.recover);
router.post('/bookings/guest', paymentLimiter, bookingRules, validateRequest, async (req, res, next) => {
  try {
    const booking = await bookingService.createGuestBooking(req.body, req);
    res.redirect(`/booking/success/${booking.bookingRef}`);
  } catch (error) {
    next(error);
  }
});
router.post('/bookings/hotel', paymentLimiter, hotelBookingController.create);
router.get('/booking/success/:bookingRef', listingController.bookingSuccess);
router.get('/tickets', listingController.ticketLookupPage);
router.get('/tickets/:bookingRef.pdf', listingController.ticketPdf);
router.get('/tickets/:bookingRef', listingController.ticketPage);
router.get('/blogs', blogController.index);
router.get('/blogs/:slug', blogController.show);
router.get('/support', (req, res) => res.render('pages/support', {
  seo: { title: 'Contact Support | Classic Trip', description: 'Get help with your booking, refund, or any Classic Trip question. Our support team responds within 24 hours.' },
}));
router.post('/support', supportRules, validateRequest, supportController.create);
router.post('/partner-requests', companyRules, validateRequest, partnerController.create);
router.get('/how-it-works', (req, res) => res.render('pages/how-it-works', {
  seo: { title: 'How Classic Trip Works | Travel Marketplace East Africa', description: 'Learn how to search, book, pay, and receive tickets on Classic Trip. For passengers, partners, and promoters.' },
}));
router.get('/terms', (req, res) => res.render('pages/terms', {
  seo: { title: 'Terms & Conditions | Classic Trip', description: 'Classic Trip terms of service covering bookings, payments, refunds, cancellations, and partner obligations.' },
}));
router.get('/privacy', (req, res) => res.render('pages/privacy', {
  seo: { title: 'Privacy Policy | Classic Trip', description: 'How Classic Trip collects, uses, and protects your personal data. Your rights and our data practices.' },
}));

router.get('/health', (req, res) => res.json({
  ok: true,
  app: 'Classic Trip',
  time: new Date().toISOString(),
  store: {
    listings: store.state.listings.length,
    bookings: store.state.bookings.length,
    wallets: store.state.wallets.length,
    walletTransactions: store.state.walletTransactions.length,
    refunds: store.state.refundRequests.length,
    campaigns: store.state.promotionCampaigns.length,
    subscriptionOrders: Array.isArray(store.state.subscriptionOrders) ? store.state.subscriptionOrders.length : 0,
    subscriptions: Array.isArray(store.state.subscriptions) ? store.state.subscriptions.length : 0,
  },
  jobs: jobStatus(),
}));

module.exports = router;
