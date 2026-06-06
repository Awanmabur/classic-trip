const store = require('../../services/data/demoStore');
const qrService = require('../../services/qr/qrService');
const bookingService = require('../../services/booking/bookingService');
const ticketPdfService = require('../../services/pdf/ticketPdfService');

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
    selectedScheduleId: req.query.scheduleId || '',
    selectedAddonIds,
  });
}

async function ticketPage(req, res, next) {
  const booking = store.findBooking(req.params.bookingRef);
  if (!booking) return next();
  const listing = store.findListing(booking.listingId);
  const qrDataUrl = await qrService.toDataUrl(booking.qrCodeValue);
  return res.render('pages/ticket', { seo: { title: `${booking.bookingRef} ticket | Classic Trip` }, booking, listing, qrDataUrl });
}

async function ticketPdf(req, res, next) {
  try {
    const booking = store.findBooking(req.params.bookingRef);
    if (!booking) return next();
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
  const booking = bookingRef ? bookingService.lookupBooking(bookingRef, contact) : null;
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
  const listing = store.findListing(booking.listingId);
  const qrDataUrl = await qrService.toDataUrl(booking.qrCodeValue);
  return res.render('pages/booking-success', { seo: { title: 'Booking confirmed | Classic Trip' }, booking, listing, qrDataUrl });
}

module.exports = { servicesPage, routesPage, companiesPage, companyProfile, promotersPage, listingDetails, bookingForm, ticketPage, ticketPdf, ticketLookupPage, bookingSuccess };
