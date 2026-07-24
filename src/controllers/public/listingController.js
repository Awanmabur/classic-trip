const { calculateCustomerFees } = require('../../utils/calculateCustomerFees');
const catalogService = require('../../services/marketplace/catalogService');
const commerceRepository = require('../../repositories/domain/commerceRepository');
const qrService = require('../../services/qr/qrService');
const ticketAccessService = require('../../services/booking/ticketAccessService');
const ticketPdfService = require('../../services/pdf/ticketPdfService');
const busInventoryService = require('../../modules/bus/services/busInventoryService');
const busSearchService = require('../../modules/bus/services/busSearchService');
const busBookingDraftService = require('../../modules/bus/services/busBookingDraftService');
const { SERVICE_REGISTRY, COMING_SOON_SERVICE_TYPES } = require('../../config/serviceRegistry');

function normalize(value) { return String(value || '').toLowerCase().trim(); }

async function catalogContext(identifier, serviceType = '', selection = {}) {
  const data = await catalogService.snapshot();
  const raw = catalogService.listingFor(data, identifier, serviceType);
  if (!raw || !catalogService.isPublicListing(raw, data)) return { data, raw: null };
  const listing = catalogService.catalogItem(data, raw);
  const company = catalogService.companyFor(data, raw.companyId || raw.companySlug);
  let availability = catalogService.availability(data, listing);
  if (normalize(listing.serviceType) === 'bus') {
    const now = new Date();
    const publicDepartureStates = new Set(['published', 'boarding', 'delayed']);
    const departures = catalogService.relatedSchedulesForListing(raw, data)
      .filter((row) => publicDepartureStates.has(normalize(row.status)))
      .filter((row) => !row.departAt || new Date(row.departAt) > now)
      .sort((a, b) => new Date(a.departAt || 0) - new Date(b.departAt || 0))
      .slice(0, 180);
    const requested = departures.find((row) => catalogService.sameId(row, selection.scheduleId || '')) || departures[0] || null;
    if (requested) {
      const canonical = await busInventoryService.getAvailability({
        scheduleId: catalogService.entityId(requested),
        originStopId: selection.originStopId,
        destinationStopId: selection.destinationStopId,
        holdId: selection.holdId,
      });
      const schedules = departures.map((schedule) => ({
        id: catalogService.entityId(schedule),
        listingId: schedule.listingId,
        routeId: schedule.routeId,
        vehicleId: schedule.vehicleId,
        departAt: schedule.departAt,
        arriveAt: schedule.arriveAt,
        departureLabel: `${new Date(schedule.departAt).toLocaleString('en-GB', { timeZone: schedule.routeSnapshot?.timezone || 'Africa/Kampala', dateStyle: 'medium', timeStyle: 'short' })} · ${schedule.vehicleName || 'Bus'}`,
        basePrice: Number(schedule.basePrice || 0),
        currency: schedule.currency,
        status: schedule.status,
      }));
      const returnSchedules = await busSearchService.findReturnDepartures({
        companyId: raw.companyId,
        originName: canonical.journey.destinationName,
        destinationName: canonical.journey.originName,
        afterDate: canonical.schedule.arriveAt || canonical.schedule.departAt,
      });
      availability = { ...availability, ...canonical, scheduleId: catalogService.entityId(requested), schedules, returnSchedules };
      listing.priceFrom = Number(canonical.fare.baseAmountPerSeat || listing.priceFrom || 0);
      listing.currency = canonical.fare.currency || listing.currency;
      listing.from = canonical.journey.originName || listing.from;
      listing.to = canonical.journey.destinationName || listing.to;
    } else availability = { ...availability, scheduleId: '', schedules: [], seats: [], stops: [] };
  }
  const preview = catalogService.listingPreview(data, listing, availability, company);
  if (normalize(listing.serviceType) === 'bus') {
    preview.previewSeats = (availability.seats || []).slice(0, 100);
    preview.currency = availability.fare?.currency || listing.currency;
    const customerFees = calculateCustomerFees(Number(availability.fare?.baseAmountPerSeat || listing.priceFrom || 0));
    preview.serviceFee = customerFees.totalFees;
    preview.totalEstimate = customerFees.total;
  }
  return { data, raw, listing, company, availability, preview };
}

async function servicesPage(req, res, next) {
  try {
    const { data, results } = await catalogService.search({});
    const grouped = data.categories.map((category) => {
      const rows = results.filter((item) => item.serviceType === category.key);
      return { ...category, stats: { ...category, count: rows.length, available: rows.reduce((sum, row) => sum + Number(row.remainingInventory || 0), 0) }, listings: rows.slice(0, 12) };
    });
    const comingSoon = COMING_SOON_SERVICE_TYPES.map((key) => SERVICE_REGISTRY[key]);
    res.render('pages/services', { seo: { title: 'All services | Classic Trip' }, grouped, stats: grouped.map((row) => row.stats), comingSoon });
  } catch (error) { next(error); }
}

async function routesPage(req, res, next) {
  try {
    const data = await catalogService.snapshot();
    const q = normalize(req.query.q); const corridor = normalize(req.query.corridor); const origin = normalize(req.query.origin); const destination = normalize(req.query.destination);
    const publicListings = data.listings.filter((row) => catalogService.isPublicListing(row, data));
    let routes = data.routes.filter((row) => (!row.status || ['active', 'published'].includes(normalize(row.status))) && publicListings.some((listing) => catalogService.sameId(catalogService.entityId(listing), row.listingId))).map((row) => catalogService.publicRoute(data, row));
    if (q) routes = routes.filter((route) => normalize(`${route.origin} ${route.destination} ${route.corridor} ${route.listing?.partner} ${route.listing?.title}`).includes(q));
    if (corridor) routes = routes.filter((route) => normalize(route.corridor) === corridor);
    if (origin) routes = routes.filter((route) => normalize(route.origin).includes(origin));
    if (destination) routes = routes.filter((route) => normalize(route.destination).includes(destination));
    const listings = data.listings.filter((row) => catalogService.isPublicListing(row, data)).map((row) => catalogService.catalogItem(data, row));
    res.render('pages/routes', { seo: { title: 'All routes | Classic Trip' }, routes, query: req.query, corridorStats: catalogService.routeHighlights(listings) });
  } catch (error) { next(error); }
}

async function companiesPage(req, res, next) {
  try {
    const data = await catalogService.snapshot();
    const companies = data.companies
      .map((row) => catalogService.publicCompany(data, row))
      .filter((company) => normalize(company.verificationStatus) === 'verified' && company.activeListingsCount > 0);
    res.render('pages/companies', { seo: { title: 'Partner companies | Classic Trip' }, companies, stats: { verified: companies.length, bookable: companies.reduce((total, company) => total + Number(company.bookableListingsCount || 0), 0), campaigns: companies.reduce((total, company) => total + Number(company.campaignCount || 0), 0) } });
  } catch (error) { next(error); }
}

async function companyProfile(req, res, next) {
  try {
    const data = await catalogService.snapshot();
    const companyRow = catalogService.companyFor(data, req.params.slug || req.params.companySlug || '');
    if (!companyRow) return next();
    const company = catalogService.publicCompany(data, companyRow);
    if (normalize(company.verificationStatus) !== 'verified') return next();
    const listings = data.listings.filter((row) => catalogService.sameId(row.companyId, company.id) && catalogService.isPublicListing(row, data)).map((row) => catalogService.catalogItem(data, row));
    if (!listings.length) return next();
    const routes = data.routes.filter((route) => (!route.status || ['active', 'published'].includes(normalize(route.status))) && listings.some((listing) => catalogService.sameId(listing.id, route.listingId))).map((row) => catalogService.publicRoute(data, row));
    const campaigns = data.campaigns
      .filter((campaign) => normalize(campaign.status) === 'active' && catalogService.sameId(campaign.companyId, company.id) && listings.some((listing) => catalogService.sameId(listing.id, campaign.listingId)))
      .map((campaign) => ({ id: catalogService.entityId(campaign), name: campaign.name || '', placement: campaign.placement || '', listingId: campaign.listingId || '' }));
    return res.render('pages/company-profile', { seo: { title: `${company.name} profile | Classic Trip` }, company, listings, routes, campaigns });
  } catch (error) { return next(error); }
}

async function promotersPage(req, res, next) {
  try {
    const data = await catalogService.snapshot();
    const listings = data.listings.filter((row) => catalogService.isPublicListing(row, data)).map((row) => catalogService.catalogItem(data, row));
    const topListings = listings.filter((row) => row.bookable).sort((a, b) => b.ratingAverage - a.ratingAverage).slice(0, 9);
    const campaigns = data.campaigns
      .filter((campaign) => normalize(campaign.status) === 'active' && listings.some((listing) => catalogService.sameId(listing.id, campaign.listingId)))
      .map((campaign) => ({ id: catalogService.entityId(campaign), name: campaign.name || '', placement: campaign.placement || '', listing: listings.find((listing) => catalogService.sameId(listing.id, campaign.listingId)) || null }));
    res.render('pages/promoters', { seo: { title: 'Promoters | Classic Trip' }, topListings, campaigns, stats: { promotableListings: topListings.length, activeCampaigns: campaigns.length } });
  } catch (error) { next(error); }
}

async function listingDetails(req, res, next) {
  try {
    const context = await catalogContext(req.params.slug, req.params.serviceType, req.query); if (!context.listing) return next();
    if (req.query.ref) await catalogService.recordReferralClick(req.query.ref, context.listing.id, req);
    return res.render('pages/listing-details', { seo: { title: `${context.listing.title} | Classic Trip` }, listing: context.listing, company: context.company, availability: context.availability, preview: context.preview, referralCode: req.query.ref || req.cookies?.ct_ref || '' });
  } catch (error) { return next(error); }
}

async function prepareBookingForm(req, res, next) {
  try {
    const context = await catalogContext(req.params.slug, req.params.serviceType, {
      scheduleId: req.body?.scheduleId,
      originStopId: req.body?.originStopId,
      destinationStopId: req.body?.destinationStopId,
    });
    if (!context.listing) return next();
    if (normalize(context.listing.serviceType) !== 'bus') {
      return res.status(400).json({ error: 'Secure checkout preparation is currently required only for bus bookings.' });
    }
    const draft = await busBookingDraftService.createDraft(req, { listing: context.listing, payload: req.body || {} });
    return res.status(201).json(draft);
  } catch (error) { return next(error); }
}

async function bookingForm(req, res, next) {
  try {
    res.set('Cache-Control', 'no-store, max-age=0');
    res.set('Pragma', 'no-cache');
    let context = await catalogContext(req.params.slug, req.params.serviceType, {}); if (!context.listing) return next();

    let source = req.query || {};
    let bookingDraftId = '';
    if (normalize(context.listing.serviceType) === 'bus') {
      bookingDraftId = String(req.query.draft || '').trim();
      if (!bookingDraftId) return res.redirect(303, `/listings/bus/${encodeURIComponent(context.listing.slug)}`);
      const draft = await busBookingDraftService.resolveDraft(req, { draftId: bookingDraftId, listing: context.listing });
      source = {
        ref: draft.referralCode,
        addons: draft.addonIds,
        holdId: draft.outbound.holdId,
        scheduleId: draft.outbound.scheduleId,
        selected: draft.outbound.selectedSeats.join(','),
        selectedSeats: draft.outbound.selectedSeats.join(','),
        originStopId: draft.outbound.originStopId,
        destinationStopId: draft.outbound.destinationStopId,
        passengerCount: draft.passengerCount,
        returnScheduleId: draft.return?.scheduleId || '',
        returnSeats: draft.return?.selectedSeats?.join(',') || '',
        returnHoldId: draft.return?.holdId || '',
        returnOriginStopId: draft.return?.originStopId || '',
        returnDestinationStopId: draft.return?.destinationStopId || '',
      };
      context = await catalogContext(req.params.slug, req.params.serviceType, source);
      if (!context.listing) return next();
    }

    const rawAddons = source.addons || source.addon || [];
    const selectedAddonIds = (Array.isArray(rawAddons) ? rawAddons : [rawAddons]).flatMap((value) => String(value || '').split(',')).map((value) => value.trim()).filter(Boolean);
    let returnAvailability = null;
    if (normalize(context.listing.serviceType) === 'bus' && source.returnScheduleId) {
      returnAvailability = await busInventoryService.getAvailability({
        scheduleId: source.returnScheduleId,
        originStopId: source.returnOriginStopId,
        destinationStopId: source.returnDestinationStopId,
        holdId: source.returnHoldId,
      });
    }
    return res.render('pages/booking-form', {
      seo: { title: `Book ${context.listing.title} | Classic Trip` },
      listing: context.listing,
      availability: context.availability,
      returnAvailability,
      preview: context.preview,
      bookingDraftId,
      referralCode: source.ref || req.cookies?.ct_ref || '',
      holdId: source.holdId || '',
      selectedOption: source.selected || source.roomTypeId || '',
      selectedSeats: source.selectedSeats || source.selected || '',
      selectedScheduleId: source.scheduleId || '',
      selectedCheckIn: source.checkIn || source.checkInDate || '',
      selectedCheckOut: source.checkOut || source.checkOutDate || '',
      selectedRoomCount: source.roomCount || source.rooms || 1,
      selectedAdults: source.adults || 1,
      selectedChildren: source.children || 0,
      returnScheduleId: source.returnScheduleId || '',
      returnSeats: source.returnSeats || '',
      returnHoldId: source.returnHoldId || '',
      returnOriginStopId: source.returnOriginStopId || returnAvailability?.journey?.originStopId || '',
      returnDestinationStopId: source.returnDestinationStopId || returnAvailability?.journey?.destinationStopId || '',
      passengerCount: source.passengerCount || '',
      selectedAddonIds,
      selectedOriginStopId: source.originStopId || context.availability?.journey?.originStopId || '',
      selectedDestinationStopId: source.destinationStopId || context.availability?.journey?.destinationStopId || '',
    });
  } catch (error) { return next(error); }
}

function ticketIsReady(booking = {}) { return String(booking.paymentStatus || '').toLowerCase() === 'successful' && !['cancelled','refunded','failed','expired'].includes(String(booking.bookingStatus || '').toLowerCase()); }
function attachTicketLinks(booking = {}) { if (booking?.bookingRef) { booking.publicTicketUrl = ticketAccessService.ticketUrl(booking); if (ticketIsReady(booking)) booking.publicTicketPdfUrl = ticketAccessService.ticketUrl(booking, '.pdf'); else delete booking.publicTicketPdfUrl; } return booking; }
function ticketLookupRedirect(bookingRef = '') { return `/tickets${bookingRef ? `?bookingRef=${encodeURIComponent(bookingRef)}` : ''}`; }
async function findBooking(bookingRef) { return bookingRef ? commerceRepository.bookings.findOne({ bookingRef }) : null; }
async function findListingById(listingId) { const data = await catalogService.snapshot(); const raw = catalogService.listingFor(data, listingId); return raw ? catalogService.catalogItem(data, raw) : null; }

async function bookingFromPaymentCallback(req = {}) {
  const query = req.query || {};
  for (const ref of [query.bookingRef, query.OrderMerchantReference, query.order_merchant_reference, query.merchantReference, query.merchant_reference, query.reference]) { const booking = await findBooking(ref); if (booking) return booking; }
  const cartRef = query.cartRef || query.cart_ref || query.OrderMerchantReference || query.order_merchant_reference;
  if (cartRef) { const cart = await commerceRepository.carts.findOne({ $or: [{ cartRef }, { id: cartRef }] }); if (cart?.bookingRef) { const booking = await findBooking(cart.bookingRef); if (booking) return booking; } }
  const trackingId = query.OrderTrackingId || query.order_tracking_id || query.orderTrackingId || query.providerReference;
  if (trackingId) { const payment = await commerceRepository.payments.findOne({ $or: [{ providerReference: trackingId }, { id: trackingId }] }); if (payment?.bookingRef) return findBooking(payment.bookingRef); }
  return null;
}

async function ticketPage(req, res, next) {
  try {
    const booking = await findBooking(req.params.bookingRef); if (!booking) return next();
    if (!ticketAccessService.canAccessBooking(req, booking)) return res.redirect(ticketLookupRedirect(booking.bookingRef));
    const ticketReady = ticketIsReady(booking);
    attachTicketLinks(booking); const listing = await findListingById(booking.listingId); const qrDataUrl = ticketReady ? await qrService.toDataUrl(booking.qrCodeValue) : '';
    const ticketLegs = await Promise.all((booking.ticketLegs || []).map(async (leg, index) => ({ ...leg, passenger: (booking.passengers || [])[Number(leg.passengerIndex || index)] || {}, qrDataUrl: ticketReady ? await qrService.toDataUrl(leg.qrCodeValue || leg.qrToken || leg.qrTokenPreview || booking.qrCodeValue) : '' })));
    return res.render('pages/ticket', { seo: { title: `${booking.bookingRef} ${ticketReady ? 'ticket' : 'booking status'} | Classic Trip` }, booking, listing, qrDataUrl, ticketLegs, ticketReady });
  } catch (error) { return next(error); }
}

async function ticketPdf(req, res, next) {
  try {
    const booking = await findBooking(req.params.bookingRef); if (!booking) return next();
    if (!ticketAccessService.canAccessBooking(req, booking)) return res.status(403).send('Ticket access requires the booking contact, access code, or an authorized account.');
    if (!ticketIsReady(booking)) return res.status(409).send('The ticket or hotel voucher will be available only after payment is confirmed.');
    attachTicketLinks(booking); const listing = await findListingById(booking.listingId); const buffer = await ticketPdfService.buildTicketPdfBuffer(booking, listing);
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${booking.bookingRef}.pdf"`); res.setHeader('Content-Length', buffer.length); return res.send(buffer);
  } catch (error) { return next(error); }
}

async function ticketLookupPage(req, res, next) {
  try {
    const bookingRef = req.query.bookingRef || ''; const contact = req.query.contact || ''; const accessCode = req.query.accessCode || req.query.code || '';
    let booking = await findBooking(bookingRef);
    if (booking && !(ticketAccessService.contactMatches(booking, contact) || ticketAccessService.accessCodeMatches(booking, accessCode) || ticketAccessService.userCanAccess?.(req, booking))) booking = null;
    const ticketReady = booking ? ticketIsReady(booking) : false;
    if (booking) attachTicketLinks(booking);
    const listing = booking ? await findListingById(booking.listingId) : null; const qrDataUrl = booking && ticketReady ? await qrService.toDataUrl(booking.qrCodeValue) : '';
    res.render('pages/ticket-lookup', { seo: { title: 'Find ticket | Classic Trip' }, query: req.query, lookupAttempted: Boolean(bookingRef), booking, listing, qrDataUrl, ticketReady });
  } catch (error) { next(error); }
}

async function bookingSuccess(req, res, next) {
  try {
    const booking = await findBooking(req.params.bookingRef); if (!booking) return next();
    if (!ticketAccessService.canAccessBooking(req, booking)) return res.redirect(ticketLookupRedirect(booking.bookingRef));
    if (!ticketIsReady(booking)) return res.redirect(ticketLookupRedirect(booking.bookingRef));
    attachTicketLinks(booking); const listing = await findListingById(booking.listingId); const qrDataUrl = await qrService.toDataUrl(booking.qrCodeValue);
    return res.render('pages/booking-success', { seo: { title: 'Booking confirmed | Classic Trip' }, booking, listing, qrDataUrl });
  } catch (error) { return next(error); }
}

async function paymentCallback(req, res) {
  const booking = await bookingFromPaymentCallback(req);
  if (!booking) return res.redirect('/tickets');

  // A browser redirect is not a trusted payment webhook. Only Pesapal returns may be
  // reconciled here because the integration independently queries Pesapal's transaction
  // status using the provider tracking id. Every other provider must confirm payment on
  // the signed server-to-server webhook endpoint.
  const query = req.query || {};
  const providerReference = query.OrderTrackingId || query.order_tracking_id || query.orderTrackingId || '';
  if (booking.paymentStatus !== 'successful' && providerReference) {
    try {
      await require('../../services/payment/webhookService').processPaymentWebhook({ ...query, provider: 'pesapal' }, {});
    } catch (error) {
      // Keep the booking pending. The signed webhook/reconciliation process remains the
      // authority and the traveler can safely retrieve the booking after it completes.
    }
  }

  const confirmed = await findBooking(booking.bookingRef) || booking;
  if (confirmed.paymentStatus !== 'successful') return res.redirect(ticketLookupRedirect(confirmed.bookingRef));
  ticketAccessService.grantSessionAccess(req, confirmed.bookingRef);
  return res.redirect(`/booking/success/${encodeURIComponent(confirmed.bookingRef)}`);
}

module.exports = { servicesPage, routesPage, companiesPage, companyProfile, promotersPage, listingDetails, prepareBookingForm, bookingForm, ticketPage, ticketPdf, ticketLookupPage, bookingSuccess, paymentCallback };
