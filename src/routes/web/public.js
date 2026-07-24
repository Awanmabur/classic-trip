const express = require('express');
const homeController = require('../../controllers/public/homeController');
const searchController = require('../../controllers/public/searchController');
const listingController = require('../../controllers/public/listingController');
const hotelBookingController = require('../../controllers/public/hotelBookingController');
const blogController = require('../../controllers/public/blogController');
const supportController = require('../../controllers/public/supportController');
const invitationController = require('../../controllers/public/invitationController');
const partnerController = require('../../controllers/public/partnerController');
const seoController = require('../../controllers/public/seoController');
const bookingService = require('../../services/booking/bookingService');
const hotelService = require('../../services/hotel/hotelService');
const busBookingService = require('../../modules/bus/services/busBookingService');
const busBookingDraftService = require('../../modules/bus/services/busBookingDraftService');
const busRepository = require('../../modules/bus/repositories/busRepository');
const ticketAccessService = require('../../services/booking/ticketAccessService');
const { stripClientSuppliedIdentity } = require('../../utils/sanitizePublicPayload');
const { bookingRules, hotelBookingRules } = require('../../validators/bookingValidator');
const { supportRules } = require('../../validators/supportValidator');
const { companyRules } = require('../../validators/companyValidator');
const { partnerOnboardingRules } = require('../../validators/partnerValidator');
const { validateRequest } = require('../../middlewares/validate');
const { invitationPasswordRules } = require('../../validators/authValidator');
const { paymentLimiter, ticketLimiter, authLimiter, publicWriteLimiter } = require('../../middlewares/rateLimit');

const router = express.Router();

router.get('/robots.txt', seoController.robots);
router.get('/sitemap.xml', seoController.sitemap);
router.get('/llms.txt', seoController.llms);
router.get('/:key.txt', seoController.indexNowKey);

router.get('/', homeController.renderHome);
router.get('/search', searchController.searchPage);
router.get('/services', listingController.servicesPage);
router.get('/routes', listingController.routesPage);
router.get('/companies', listingController.companiesPage);
router.get('/promoters', listingController.promotersPage);
router.get('/promoter-program', listingController.promotersPage);
router.get('/partner-commission', partnerController.commissionInfo);
router.get('/partner/onboarding', (req, res) => res.redirect(303, '/register?role=partner#partner'));
router.post('/partner/onboarding', authLimiter, partnerOnboardingRules, validateRequest, partnerController.createOnboarding);
router.get('/invite/:token', invitationController.show);
router.post('/invite/:token', authLimiter, invitationPasswordRules, validateRequest, invitationController.accept);
router.post('/invite/:token/reject', authLimiter, invitationController.reject);
router.get('/companies/:slug', listingController.companyProfile);
router.get('/partner/:slug', listingController.companyProfile);
router.get('/listings/:serviceType/:slug', listingController.listingDetails);
router.post('/book/:serviceType/:slug/prepare', publicWriteLimiter, listingController.prepareBookingForm);
router.get('/book/:serviceType/:slug', listingController.bookingForm);
router.post('/bookings/guest', paymentLimiter, bookingRules, validateRequest, async (req, res, next) => {
  try {
    let payload = stripClientSuppliedIdentity(req.body);
    const listing = await busRepository.listings.findOne({ id: String(payload.listingId || '').trim() });
    if (!listing) {
      const error = new Error('Booking listing was not found');
      error.status = 404;
      throw error;
    }
    const serviceType = String(listing?.serviceType || '').toLowerCase();
    const isBus = serviceType === 'bus';
    const isHotel = serviceType === 'hotel';
    if (isBus) payload = await busBookingDraftService.applyDraftToPayload(req, payload, listing);
    const booking = isBus
      ? await busBookingService.createGuestBooking(payload, req)
      : isHotel
        ? await hotelService.createHotelBooking(payload, req)
        : await bookingService.createGuestBooking(payload, req);
    if (isBus) {
      try { await busBookingDraftService.discardDraft(req, payload.bookingDraftId); } catch (_) { /* Booking is already durable; stale draft cleanup is best effort. */ }
    }
    ticketAccessService.grantSessionAccess(req, booking.bookingRef);
    if (booking.checkoutUrl && booking.paymentStatus !== 'successful') return res.redirect(booking.checkoutUrl);
    return res.redirect(`/booking/success/${booking.bookingRef}`);
  } catch (error) {
    return next(error);
  }
});
router.post('/bookings/hotel', paymentLimiter, hotelBookingRules, validateRequest, hotelBookingController.create);
router.get('/booking/payment/callback', listingController.paymentCallback);
router.get('/booking/success/:bookingRef', listingController.bookingSuccess);
router.get('/tickets', ticketLimiter, listingController.ticketLookupPage);
router.get('/tickets/:bookingRef.pdf', ticketLimiter, listingController.ticketPdf);
router.get('/tickets/:bookingRef', ticketLimiter, listingController.ticketPage);
router.get('/blogs', blogController.index);
router.get('/blogs/:slug', blogController.show);
router.get('/support', (req, res) => res.render('pages/support', {
  seo: { title: 'Contact Support | Classic Trip', description: 'Get help with your booking, refund, or any Classic Trip question. Our support team responds within 24 hours.' },
}));
router.post('/support', publicWriteLimiter, supportRules, validateRequest, supportController.create);
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
}));

module.exports = router;

