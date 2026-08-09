const express = require('express');
const homeController = require('../../controllers/public/homeController');
const searchController = require('../../controllers/public/searchController');
const listingController = require('../../controllers/public/listingController');
const hotelBookingController = require('../../controllers/public/hotelBookingController');
const bookingPaymentController = require('../../controllers/public/bookingPaymentController');
const blogController = require('../../controllers/public/blogController');
const supportController = require('../../controllers/public/supportController');
const invitationController = require('../../controllers/public/invitationController');
const partnerController = require('../../controllers/public/partnerController');
const seoController = require('../../controllers/public/seoController');
const travelController = require('../../controllers/public/travelController');
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
const { mongoose } = require('../../config/db');
const { safePaymentRedirect } = require('../../utils/paymentRedirect');

const router = express.Router();

router.get('/robots.txt', seoController.robots);
router.get('/sitemap.xml', seoController.sitemap);
router.get('/sitemaps/:section.xml', seoController.sitemapSection);
router.get('/llms.txt', seoController.llms);
router.get('/llms-full.txt', seoController.llmsFull);
router.get('/ai-index.json', seoController.aiIndex);
router.get('/:key.txt', seoController.indexNowKey);

function serviceLanding({ serviceType, canonicalPath, title, description, label, query = {}, schemaName = '' }) {
  return (req, res, next) => {
    req.searchLanding = {
      serviceType,
      label,
      query,
      seo: {
        title,
        description,
        canonicalPath,
        robots: 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1',
        schema: { '@type': 'CollectionPage', name: schemaName || label || title, description },
      },
    };
    return searchController.searchPage(req, res, next);
  };
}

router.get('/', homeController.renderHome);
router.get('/search', searchController.searchPage);
router.get('/buses', serviceLanding({ serviceType: 'bus', canonicalPath: '/buses', label: 'Buses', title: 'Bus Tickets & Routes Across East Africa | Classic Trip', description: 'Find bus routes, live departures, stop-based fares and seat availability from verified operators across East Africa.' }));
router.get('/stays', serviceLanding({ serviceType: 'hotel', canonicalPath: '/stays', label: 'Stays', title: 'Hotels, Apartments & Stays in East Africa | Classic Trip', description: 'Find verified hotels, apartments, villas, private rooms and other stays with dated availability and secure booking across East Africa.' }));
router.get('/airbnb', serviceLanding({ serviceType: 'hotel', canonicalPath: '/airbnb', label: 'Airbnb-style homes', query: { stayType: 'airbnb' }, title: 'Homes, Apartments & Private Stays in East Africa | Classic Trip', description: 'Discover entire homes, apartments, villas and private-room stays across East Africa with secure Classic Trip booking.' }));
router.get('/tours', serviceLanding({ serviceType: 'tour', canonicalPath: '/tours', label: 'Tours', title: 'Tours, Safaris & Experiences in East Africa | Classic Trip', description: 'Find safaris, guided tours, cultural experiences, nature trips and activities from verified partners across East Africa.' }));
router.get('/car-rentals', serviceLanding({ serviceType: 'car_rental', canonicalPath: '/car-rentals', label: 'Car rentals', title: 'Car Rentals Across East Africa | Classic Trip', description: 'Compare verified car rentals with dated availability, self-drive and driver options across East Africa.' }));
router.get('/cargo', serviceLanding({ serviceType: 'cargo', canonicalPath: '/cargo', label: 'Cargo', title: 'Cargo, Parcel & Freight Services in East Africa | Classic Trip', description: 'Find verified parcel, document and freight pickup and delivery services across East Africa.' }));
router.get('/flights', travelController.flightPage);
router.get('/flights/orders/:reference', travelController.flightOrderPage);
router.get('/taxi', travelController.taxiPage);
router.get('/taxi/rides/:reference', travelController.taxiRidePage);
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
    if (booking.checkoutUrl && booking.paymentStatus !== 'successful') return res.redirect(safePaymentRedirect(booking.checkoutUrl, `/tickets?bookingRef=${encodeURIComponent(booking.bookingRef)}`));
    return res.redirect(`/booking/success/${booking.bookingRef}`);
  } catch (error) {
    return next(error);
  }
});
router.post('/bookings/hotel', paymentLimiter, hotelBookingRules, validateRequest, hotelBookingController.create);
router.post('/bookings/:bookingRef/payment/retry', paymentLimiter, bookingPaymentController.retry);
router.get('/booking/payment/callback', listingController.paymentCallback);
router.get('/booking/success/:bookingRef', listingController.bookingSuccess);
router.get('/tickets', ticketLimiter, listingController.ticketLookupPage);
router.get('/tickets/:bookingRef.pdf', ticketLimiter, listingController.ticketPdf);
router.get('/tickets/:bookingRef', ticketLimiter, listingController.ticketPage);
router.get('/blogs', blogController.index);
router.get('/blogs/:slug', blogController.show);
router.get('/support', (req, res) => res.render('pages/support', {
  submitted: req.query.submitted === '1',
  seo: { title: 'Classic Trip Support | Booking, Payment & Travel Help', description: 'Get help with Classic Trip bookings, payments, tickets, refunds, buses, stays, flights, local rides, tours, car rentals and cargo.', canonicalPath: '/support', schema: { '@type': 'ContactPage', name: 'Classic Trip Support' }, breadcrumbs: [{ name: 'Home', url: '/' }, { name: 'Support', url: '/support' }] },
}));
router.post('/support', publicWriteLimiter, supportRules, validateRequest, supportController.create);
router.get('/how-it-works', (req, res) => res.render('pages/how-it-works', {
  seo: { title: 'How Classic Trip Works | Search, Book & Travel', description: 'Learn how to search live travel inventory, choose routes or stays, pay securely and receive booking documents on Classic Trip.', canonicalPath: '/how-it-works', schema: { '@type': 'WebPage', name: 'How Classic Trip works' }, breadcrumbs: [{ name: 'Home', url: '/' }, { name: 'How it works', url: '/how-it-works' }] },
}));
router.get('/terms', (req, res) => res.render('pages/terms', {
  seo: { title: 'Terms & Conditions | Classic Trip', description: 'Classic Trip terms covering bookings, payments, refunds, cancellations, marketplace use and partner obligations.', canonicalPath: '/terms', schema: { '@type': 'WebPage', name: 'Classic Trip Terms & Conditions' }, breadcrumbs: [{ name: 'Home', url: '/' }, { name: 'Terms', url: '/terms' }] },
}));
router.get('/privacy', (req, res) => res.render('pages/privacy', {
  seo: { title: 'Privacy Policy | Classic Trip', description: 'Learn how Classic Trip collects, uses, secures and manages personal data, booking information and account information.', canonicalPath: '/privacy', schema: { '@type': 'WebPage', name: 'Classic Trip Privacy Policy' }, breadcrumbs: [{ name: 'Home', url: '/' }, { name: 'Privacy', url: '/privacy' }] },
}));

router.get('/health', (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.json({ ok: true, app: 'Classic Trip', requestId: req.id, time: new Date().toISOString() });
});
router.get('/ready', (req, res) => {
  const databaseReady = mongoose.connection.readyState === 1;
  res.set('Cache-Control', 'no-store');
  return res.status(databaseReady ? 200 : 503).json({
    ok: databaseReady,
    app: 'Classic Trip',
    database: databaseReady ? 'ready' : 'unavailable',
    requestId: req.id,
    time: new Date().toISOString(),
  });
});

module.exports = router;
