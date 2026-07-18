const store = require('../../services/data/persistentStore');
const qrService = require('../../services/qr/qrService');
const bookingService = require('../../services/booking/bookingService');
const ticketAccessService = require('../../services/booking/ticketAccessService');
const ticketPdfService = require('../../services/pdf/ticketPdfService');
const futureServiceArchitecture = require('../../services/release/futureServiceArchitecture');

function normalize(value) {
  return String(value || '').toLowerCase().trim();
}

function servicesPage(req, res) {
  const grouped = store.state.categories.map((category) => ({
    ...category,
    stats: store.serviceStats().find((item) => item.key === category.key),
    listings: store.searchListings({ serviceType: category.key }).slice(0, 12),
  }));
  res.render('pages/services', { seo: { title: 'All services | Classic Trip' }, grouped, stats: store.serviceStats() });
}

function routesPage(req, res) {
  const q = normalize(req.query.q);
  const corridor = normalize(req.query.corridor);
  const origin = normalize(req.query.origin);
  const destination = normalize(req.query.destination);
  let routes = store.state.routes.map(store.publicRoute);
  if (q) {
    routes = routes.filter((route) => normalize(`${route.origin} ${route.destination} ${route.corridor} ${route.listing?.partner} ${route.listing?.title}`).includes(q));
  }
  if (corridor) routes = routes.filter((route) => normalize(route.corridor) === corridor);
  if (origin) routes = routes.filter((route) => normalize(route.origin).includes(origin));
  if (destination) routes = routes.filter((route) => normalize(route.destination).includes(destination));
  res.render('pages/routes', { seo: { title: 'All routes | Classic Trip' }, routes, query: req.query, corridorStats: store.corridorStats() });
}

function companiesPage(req, res) {
  const companies = store.state.companies.map(store.publicCompany);
  res.render('pages/companies', {
    seo: { title: 'Partner companies | Classic Trip' },
    companies,
    stats: {
      verified: companies.filter((company) => company.verificationStatus === 'verified').length,
      bookable: companies.reduce((total, company) => total + company.bookableListingsCount, 0),
      campaigns: companies.reduce((total, company) => total + company.campaignCount, 0),
    },
  });
}

function companyProfile(req, res, next) {
  const company = store.findCompany(req.params.slug || req.params.companySlug || 'classic-express');
  if (!company) return next();
  const listings = store.listingsForCompany(company.id);
  const routes = listings.flatMap((listing) => store.routesForListing(listing.id).map((route) => ({ ...route, listing })));
  return res.render('pages/company-profile', {
    seo: { title: `${company.name} profile | Classic Trip` },
    company: store.publicCompany(company),
    listings,
    routes,
    campaigns: store.state.promotionCampaigns.filter((campaign) => campaign.companyId === company.id),
    promoterLinks: store.state.promoterLinks.map(store.publicPromoterLink).filter((link) => link.listing?.companyId === company.id).slice(0, 6),
  });
}

function promotersPage(req, res) {
  const promoter = store.state.users.find((user) => user.role === 'promoter');
  const links = store.state.promoterLinks.map(store.publicPromoterLink);
  const topListings = store.searchListings({ bookable: true, sort: 'recommended' }).slice(0, 9);
  const campaigns = store.state.promotionCampaigns.map(store.publicCampaign);
  const clicks = links.reduce((total, link) => total + link.clicks, 0);
  const conversions = links.reduce((total, link) => total + link.conversions, 0);
  res.render('pages/promoters', {
    seo: { title: 'Promoters | Classic Trip' },
    promoter,
    links,
    topListings,
    campaigns,
    stats: {
      clicks,
      conversions,
      conversionRate: clicks ? Math.round((conversions / clicks) * 1000) / 10 : 0,
      pendingCommission: store.state.wallets.find((wallet) => wallet.ownerType === 'promoter')?.pendingBalance || 0,
      availableCommission: store.state.wallets.find((wallet) => wallet.ownerType === 'promoter')?.availableBalance || 0,
    },
  });
}

function listingDetails(req, res, next) {
  const listing = store.findListing(req.params.slug, req.params.serviceType);
  if (!listing) return next();
  if (req.query.ref) store.recordReferralClick(req.query.ref, listing.id, req);
  const company = store.findCompany(listing.companySlug || listing.companyId);
  const availability = store.getAvailability(listing.id);
  const preview = store.listingPreview(listing, availability, company);
  return res.render('pages/listing-details', { seo: { title: `${listing.title} | Classic Trip` }, listing, company, availability, preview, referralCode: req.query.ref || req.cookies?.ct_ref || '' });
}

function bookingForm(req, res, next) {
  const listing = store.findListing(req.params.slug, req.params.serviceType);
  if (!listing) return next();
  const futureModule = futureServiceArchitecture.findModule(listing.serviceType);
  if (futureModule && listing.bookable === false) {
    return res.status(409).render('pages/future-service-detail', {
      seo: { title: `${futureModule.label} coming soon | Classic Trip` },
      module: futureModule,
    });
  }
  const availability = store.getAvailability(listing.id);
  const company = store.findCompany(listing.companySlug || listing.companyId);
  const preview = store.listingPreview(listing, availability, company);
  const rawAddons = req.query.addons || req.query.addon || [];
  const selectedAddonIds = (Array.isArray(rawAddons) ? rawAddons : [rawAddons])
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim())
    .filter(Boolean);
  return res.render('pages/booking-form', {
    seo: { title: `Book ${listing.title} | Classic Trip` },
    listing,
    availability,
    preview,
    referralCode: req.query.ref || req.cookies?.ct_ref || '',
    holdId: req.query.holdId || '',
    selectedOption: req.query.selected || req.query.roomId || '',
    selectedSeats: req.query.selectedSeats || req.query.selected || '',
    selectedScheduleId: req.query.scheduleId || '',
    returnScheduleId: req.query.returnScheduleId || '',
    returnSeats: req.query.returnSeats || '',
    passengerCount: req.query.passengerCount || '',
    selectedAddonIds,
  });
}

function attachTicketLinks(booking = {}) {
  if (!booking?.bookingRef) return booking;
  booking.publicTicketUrl = ticketAccessService.ticketUrl(booking);
  booking.publicTicketPdfUrl = ticketAccessService.ticketUrl(booking, '.pdf');
  return booking;
}

function ticketLookupRedirect(bookingRef = '') {
  const query = bookingRef ? `?bookingRef=${encodeURIComponent(bookingRef)}` : '';
  return `/tickets${query}`;
}

function bookingFromPaymentCallback(req = {}) {
  const query = req.query || {};
  const directRef = query.bookingRef || '';
  if (directRef) {
    const booking = store.findBooking(directRef);
    if (booking) return booking;
  }
  const merchantRef = query.OrderMerchantReference || query.order_merchant_reference || query.merchantReference || query.merchant_reference || query.reference || '';
  if (merchantRef) {
    const directBooking = store.findBooking(merchantRef);
    if (directBooking) return directBooking;
    const cart = (store.state.carts || []).find((item) => item.cartRef === merchantRef || item.id === merchantRef);
    if (cart?.bookingRef) {
      const cartBooking = store.findBooking(cart.bookingRef);
      if (cartBooking) return cartBooking;
    }
  }
  const cartRef = query.cartRef || query.cart_ref || '';
  if (cartRef) {
    const cart = (store.state.carts || []).find((item) => item.cartRef === cartRef || item.id === cartRef);
    if (cart?.bookingRef) {
      const booking = store.findBooking(cart.bookingRef);
      if (booking) return booking;
    }
  }
  const trackingId = query.OrderTrackingId || query.order_tracking_id || query.orderTrackingId || query.providerReference || '';
  if (trackingId) {
    const payment = (store.state.payments || []).find((row) => row.providerReference === trackingId || row.id === trackingId);
    if (payment?.bookingRef) return store.findBooking(payment.bookingRef);
  }
  return null;
}

async function ticketPage(req, res, next) {
  const booking = store.findBooking(req.params.bookingRef);
  if (!booking) return next();
  if (!ticketAccessService.canAccessBooking(req, booking)) return res.redirect(ticketLookupRedirect(booking.bookingRef));
  attachTicketLinks(booking);
  const listing = store.findListing(booking.listingId);
  const qrDataUrl = await qrService.toDataUrl(booking.qrCodeValue);
  const ticketLegs = await Promise.all((booking.ticketLegs || []).map(async (leg, index) => ({
    ...leg,
    passenger: (booking.passengers || [])[Number(leg.passengerIndex || index)] || {},
    qrDataUrl: await qrService.toDataUrl(store.qrPublicValueForLeg(booking.bookingRef, leg) || booking.qrCodeValue),
  })));
  return res.render('pages/ticket', { seo: { title: `${booking.bookingRef} ticket | Classic Trip` }, booking, listing, qrDataUrl, ticketLegs });
}

async function ticketPdf(req, res, next) {
  try {
    const booking = store.findBooking(req.params.bookingRef);
    if (!booking) return next();
    if (!ticketAccessService.canAccessBooking(req, booking)) return res.status(403).send('Ticket access requires the booking contact, access code, or an authorized account.');
    attachTicketLinks(booking);
    const listing = store.findListing(booking.listingId);
    const buffer = await ticketPdfService.buildTicketPdfBuffer(booking, listing);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${booking.bookingRef}.pdf"`);
    res.setHeader('Content-Length', buffer.length);
    return res.send(buffer);
  } catch (error) {
    return next(error);
  }
}

async function ticketLookupPage(req, res) {
  const bookingRef = req.query.bookingRef || '';
  const contact = req.query.contact || '';
  const accessCode = req.query.accessCode || req.query.code || '';
  const booking = bookingRef ? bookingService.lookupBooking(bookingRef, contact, accessCode) : null;
  if (booking) attachTicketLinks(booking);
  const listing = booking ? store.findListing(booking.listingId) : null;
  const qrDataUrl = booking ? await qrService.toDataUrl(booking.qrCodeValue) : '';
  res.render('pages/ticket-lookup', {
    seo: { title: 'Find ticket | Classic Trip' },
    query: req.query,
    lookupAttempted: Boolean(bookingRef),
    booking,
    listing,
    qrDataUrl,
  });
}

async function bookingSuccess(req, res, next) {
  const booking = store.findBooking(req.params.bookingRef);
  if (!booking) return next();
  if (!ticketAccessService.canAccessBooking(req, booking)) return res.redirect(ticketLookupRedirect(booking.bookingRef));
  attachTicketLinks(booking);
  const listing = store.findListing(booking.listingId);
  const qrDataUrl = await qrService.toDataUrl(booking.qrCodeValue);
  return res.render('pages/booking-success', { seo: { title: 'Booking confirmed | Classic Trip' }, booking, listing, qrDataUrl });
}

async function paymentCallback(req, res) {
  const booking = bookingFromPaymentCallback(req);
  if (!booking) return res.redirect('/tickets');
  if (booking.paymentStatus !== 'successful') {
    try {
      // Actively re-verify with the provider (e.g. Pesapal GetTransactionStatus) instead of
      // trusting the redirect query params, in case the async webhook hasn't landed yet.
      const webhookService = require('../../services/payment/webhookService');
      await webhookService.processPaymentWebhook(req.query, req.headers);
    } catch (error) {
      // Not verified/confirmed yet - fall through and deny session access below.
    }
  }
  const confirmed = store.findBooking(booking.bookingRef) || booking;
  if (confirmed.paymentStatus !== 'successful') return res.redirect(ticketLookupRedirect(confirmed.bookingRef));
  ticketAccessService.grantSessionAccess(req, confirmed.bookingRef);
  return res.redirect(`/booking/success/${encodeURIComponent(confirmed.bookingRef)}`);
}

module.exports = { servicesPage, routesPage, companiesPage, companyProfile, promotersPage, listingDetails, bookingForm, ticketPage, ticketPdf, ticketLookupPage, bookingSuccess, paymentCallback };
