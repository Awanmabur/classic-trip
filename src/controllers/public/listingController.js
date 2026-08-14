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
const hotelInventoryService = require('../../services/hotel/hotelInventoryService');
const seoService = require('../../services/seo/seoService');
const { resolveMediaUrl, mediaUrl } = require('../../utils/mediaUrl');
const logger = require('../../config/logger');

function normalize(value) { return String(value || '').toLowerCase().trim(); }
function seoText(value, max = 160) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function listingSeo(context = {}) {
  const listing = context.listing || {};
  const company = context.company || {};
  const publicPath = listing.url || seoService.publicListingPath(listing);
  const canonicalUrl = seoService.absoluteUrl(publicPath);
  const title = `${listing.title || listing.name || 'Travel service'} | Classic Trip`;
  const description = seoText(listing.shortDescription || listing.description || listing.sub || `${listing.typeLabel || 'Travel service'} from ${company.name || listing.companyName || 'a verified Classic Trip partner'}${listing.routeLabel ? ` on ${listing.routeLabel}` : ''}. Check live availability and book securely.`, 165);
  const image = resolveMediaUrl(listing.img, listing.image, listing.coverImage, listing.media, company.coverImage, company.logo);
  const price = Number(listing.priceFrom || listing.price || 0);
  const currency = String(listing.currency || '').toUpperCase();
  const provider = { '@type': 'Organization', name: company.name || listing.companyName || listing.partner || 'Classic Trip partner' };
  const schema = {
    '@type': 'Service',
    name: listing.title || listing.name || 'Classic Trip travel service',
    description,
    url: canonicalUrl,
    image: image || undefined,
    serviceType: listing.typeLabel || listing.serviceType || listing.type || 'Travel service',
    provider,
    areaServed: [listing.city, listing.country].filter(Boolean),
    offers: price > 0 ? {
      '@type': 'Offer',
      url: canonicalUrl,
      price,
      priceCurrency: currency || undefined,
      availability: listing.bookable ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    } : undefined,
    aggregateRating: Number(listing.ratingAverage || 0) > 0 && Number(listing.reviewCount || 0) > 0 ? {
      '@type': 'AggregateRating',
      ratingValue: Number(listing.ratingAverage),
      reviewCount: Number(listing.reviewCount),
    } : undefined,
  };
  return {
    title,
    description,
    canonicalPath: publicPath,
    image,
    imageAlt: listing.title || listing.name || 'Classic Trip travel service',
    schema,
    breadcrumbs: [
      { name: 'Home', url: '/' },
      { name: 'Services', url: '/services' },
      { name: listing.title || listing.name || 'Travel service', url: publicPath },
    ],
  };
}
function companySeo(company = {}) {
  const path = `/companies/${company.slug || company.id}`;
  const image = resolveMediaUrl(company.coverImage, company.logo);
  const description = seoText(company.description || `Explore verified travel services, routes and booking options from ${company.name || 'this Classic Trip partner'} on Classic Trip.`, 165);
  return {
    title: `${company.name || 'Verified travel partner'} | Classic Trip`,
    description,
    canonicalPath: path,
    image,
    imageAlt: `${company.name || 'Classic Trip partner'} profile`,
    schema: {
      '@type': 'TravelAgency',
      name: company.name || 'Classic Trip partner',
      url: seoService.absoluteUrl(path),
      description,
      image: image || undefined,
      logo: mediaUrl(company.logo) || undefined,
      telephone: company.supportContacts?.phone || undefined,
      email: company.supportContacts?.email || undefined,
      areaServed: [company.city, company.country].filter(Boolean),
      aggregateRating: Number(company.ratingAverage || 0) > 0 && Number(company.reviewCount || 0) > 0 ? {
        '@type': 'AggregateRating',
        ratingValue: Number(company.ratingAverage),
        reviewCount: Number(company.reviewCount),
      } : undefined,
    },
    breadcrumbs: [
      { name: 'Home', url: '/' },
      { name: 'Verified partners', url: '/companies' },
      { name: company.name || 'Partner', url: path },
    ],
  };
}
function scheduleVehicleClass(schedule = {}) {
  if (normalize(schedule.vehicleClass) === 'vip') return 'vip';
  if (normalize(schedule.seatMapSnapshot?.vehicleClass) === 'vip') return 'vip';
  return (schedule.seatMapSnapshot?.seats || []).some((seat) => normalize(seat.seatClass) === 'vip') ? 'vip' : 'standard';
}

function scheduleCatalogPreview(data = {}, schedule = {}) {
  const route = (data.routes || []).find((row) => catalogService.sameId(row, schedule.routeId)) || {};
  const stops = (data.routeStops || [])
    .filter((row) => catalogService.sameId(row.routeId, schedule.routeId) && normalize(row.status) !== 'archived')
    .sort((a, b) => Number(a.stopOrder || 0) - Number(b.stopOrder || 0))
    .map((stop) => ({
      id: catalogService.entityId(stop),
      branchId: stop.branchId || '',
      name: stop.name || stop.stopName || 'Stop',
      stopType: stop.stopType || '',
      stopOrder: Number(stop.stopOrder || 0),
      pickupAllowed: stop.pickupAllowed !== false,
      dropoffAllowed: stop.dropoffAllowed !== false,
      publicInstructions: stop.publicInstructions || '',
    }));
  const originStopId = String(schedule.originStopId || route.originStopId || stops[0]?.id || '');
  const destinationStopId = String(schedule.destinationStopId || route.destinationStopId || stops[stops.length - 1]?.id || '');
  const origin = stops.find((stop) => String(stop.id) === originStopId) || stops[0] || {};
  const destination = stops.find((stop) => String(stop.id) === destinationStopId) || stops[stops.length - 1] || {};
  return {
    id: catalogService.entityId(schedule),
    listingId: schedule.listingId,
    routeId: schedule.routeId,
    vehicleId: schedule.vehicleId,
    vehicleClass: scheduleVehicleClass(schedule),
    departAt: schedule.departAt,
    arriveAt: schedule.arriveAt,
    departureLabel: `${new Date(schedule.departAt).toLocaleString('en-GB', { timeZone: schedule.routeSnapshot?.timezone || 'Africa/Kampala', dateStyle: 'medium', timeStyle: 'short' })} · ${schedule.vehicleName || 'Bus'}`,
    basePrice: Number(schedule.basePrice || 0),
    currency: schedule.currency,
    status: schedule.status,
    stops,
    journey: {
      originStopId: origin.id || originStopId,
      originBranchId: origin.branchId || '',
      originName: origin.name || route.origin || '',
      destinationStopId: destination.id || destinationStopId,
      destinationBranchId: destination.branchId || '',
      destinationName: destination.name || route.destination || '',
    },
  };
}

async function publicListingContext(identifier, serviceType = '') {
  // Listing details and checkout need one listing, not the entire marketplace.
  // The scoped snapshot removes the global 5k-listing/50k-inventory cold load
  // from current-fare and payment-page requests.
  const data = await catalogService.snapshotForListing(identifier, serviceType)
    || await catalogService.snapshot();
  const raw = catalogService.listingFor(data, identifier, serviceType);
  if (!raw || !catalogService.isPublicListing(raw, data)) return { data, raw: null, listing: null };
  return { data, raw, listing: catalogService.catalogItem(data, raw) };
}

async function catalogContext(identifier, serviceType = '', selection = {}, prefetched = {}) {
  const data = prefetched.data || await catalogService.snapshotForListing(identifier, serviceType) || await catalogService.snapshot();
  const raw = prefetched.raw || catalogService.listingFor(data, identifier, serviceType);
  if (!raw || !catalogService.isPublicListing(raw, data)) return { data, raw: null };
  const selectedRouteId = String(selection.routeId || '').trim();
  const selectedRoute = selectedRouteId
    ? (data.routes || []).find((row) => catalogService.sameId(row, selectedRouteId)) || null
    : null;
  const listing = catalogService.catalogItem(data, raw, selectedRoute);
  const company = catalogService.companyFor(data, raw.companyId || raw.companySlug);
  let availability = {
    ...catalogService.availability(data, listing),
    selectedRouteId,
    routes: Array.isArray(listing.routes) ? listing.routes : [],
  };
  if (normalize(listing.serviceType) === 'bus') {
    const now = new Date();
    const publicDepartureStates = new Set(['published', 'boarding', 'delayed']);
    const departures = catalogService.relatedSchedulesForListing(raw, data)
      .filter((row) => publicDepartureStates.has(normalize(row.status)))
      .filter((row) => !row.departAt || new Date(row.departAt) > now)
      .sort((a, b) => new Date(a.departAt || 0) - new Date(b.departAt || 0))
      .slice(0, 180);
    const requestedScheduleId = String(selection.scheduleId || '').trim();
    const requested = requestedScheduleId
      ? departures.find((row) => catalogService.sameId(row, requestedScheduleId)) || null
      : null;
    if (requested) {
      const canonical = await busInventoryService.getAvailability({
        scheduleId: catalogService.entityId(requested),
        originStopId: selection.originStopId,
        destinationStopId: selection.destinationStopId,
        holdId: selection.holdId,
        seatNumbers: selection.compactAvailability ? (selection.selectedSeats || selection.selected || '') : [],
      });
      const schedules = departures.map((schedule) => scheduleCatalogPreview(data, schedule));
      const returnSchedules = selection.includeReturnSchedules === false ? [] : await busSearchService.findReturnDepartures({
        companyId: raw.companyId,
        originName: canonical.journey.destinationName,
        destinationName: canonical.journey.originName,
        originBranchId: canonical.journey.destinationBranchId,
        destinationBranchId: canonical.journey.originBranchId,
      });
      availability = { ...availability, ...canonical, scheduleId: catalogService.entityId(requested), schedules, returnSchedules };
      listing.priceFrom = Number(canonical.fare.baseAmountPerSeat || listing.priceFrom || 0);
      listing.currency = canonical.fare.currency || listing.currency;
      listing.from = canonical.journey.originName || listing.from;
      listing.to = canonical.journey.destinationName || listing.to;
    } else {
      const schedules = departures.map((schedule) => scheduleCatalogPreview(data, schedule));
      availability = { ...availability, scheduleId: '', schedule: null, schedules, returnSchedules: [], seats: [], stops: [], journey: {}, fare: null };
    }
  } else if (normalize(listing.serviceType) === 'hotel') {
    const checkIn = selection.checkIn || selection.checkInDate;
    const checkOut = selection.checkOut || selection.checkOutDate;
    if (checkIn && checkOut) {
      const datedAvailability = await hotelInventoryService.availabilityForRange(listing.id, checkIn, checkOut);
      availability = { ...availability, ...datedAvailability, listing };
    }
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
    res.render('pages/services', { seo: { title: 'Travel Services Across East Africa | Classic Trip', description: 'Explore buses, stays, flights, local rides, tours, car rentals and cargo services from verified Classic Trip partners.', canonicalPath: '/services', schema: { '@type': 'CollectionPage', name: 'Classic Trip travel services' }, breadcrumbs: [{ name: 'Home', url: '/' }, { name: 'Services', url: '/services' }] }, grouped, stats: grouped.map((row) => row.stats), comingSoon });
  } catch (error) { next(error); }
}

async function routesPage(req, res, next) {
  try {
    const data = await catalogService.discoverySnapshot();
    const q = normalize(req.query.q); const corridor = normalize(req.query.corridor); const origin = normalize(req.query.origin); const destination = normalize(req.query.destination);
    const publicListings = data.listings.filter((row) => catalogService.isPublicListing(row, data));
    let routes = data.routes.filter((row) => (!row.status || ['active', 'published'].includes(normalize(row.status))) && publicListings.some((listing) => catalogService.sameId(catalogService.entityId(listing), row.listingId))).map((row) => catalogService.publicRoute(data, row));
    if (q) routes = routes.filter((route) => normalize(`${route.origin} ${route.destination} ${route.corridor} ${route.listing?.partner} ${route.listing?.title}`).includes(q));
    if (corridor) routes = routes.filter((route) => normalize(route.corridor) === corridor);
    if (origin) routes = routes.filter((route) => normalize(route.origin).includes(origin));
    if (destination) routes = routes.filter((route) => normalize(route.destination).includes(destination));
    const listings = data.listings.filter((row) => catalogService.isPublicListing(row, data)).map((row) => catalogService.catalogItem(data, row));
    const routeSearchOptions = catalogService.searchOptions(data, listings).bus;
    res.render('pages/routes', { seo: { title: 'Bus & Travel Routes Across East Africa | Classic Trip', description: 'Browse active Classic Trip routes and corridors across East Africa, with upcoming departures, partner services and live availability.', canonicalPath: '/routes', schema: { '@type': 'CollectionPage', name: 'Classic Trip routes' }, breadcrumbs: [{ name: 'Home', url: '/' }, { name: 'Routes', url: '/routes' }] }, routes, query: req.query, corridorStats: catalogService.routeHighlights(listings), routeSearchOptions });
  } catch (error) { next(error); }
}

async function companiesPage(req, res, next) {
  try {
    const data = await catalogService.discoverySnapshot();
    const companies = data.companies
      .map((row) => catalogService.publicCompany(data, row))
      .filter((company) => normalize(company.verificationStatus) === 'verified' && company.activeListingsCount > 0);
    res.render('pages/companies', { seo: { title: 'Verified travel partners across East Africa | Classic Trip', description: 'Discover verified bus operators, accommodation providers, accredited flight agents and approved mobility partners on Classic Trip.', canonicalPath: '/companies', schema: { '@type': 'CollectionPage', name: 'Classic Trip verified partners' } }, companies, stats: { verified: companies.length, bookable: companies.reduce((total, company) => total + Number(company.bookableListingsCount || 0), 0), campaigns: companies.reduce((total, company) => total + Number(company.campaignCount || 0), 0) } });
  } catch (error) { next(error); }
}

async function companyProfile(req, res, next) {
  try {
    const data = await catalogService.discoverySnapshot();
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
    return res.render('pages/company-profile', { seo: companySeo(company), company, listings, routes, campaigns });
  } catch (error) { return next(error); }
}

async function promotersPage(req, res, next) {
  try {
    const data = await catalogService.discoverySnapshot();
    const listings = data.listings.filter((row) => catalogService.isPublicListing(row, data)).map((row) => catalogService.catalogItem(data, row));
    const topListings = listings.filter((row) => row.bookable).sort((a, b) => b.ratingAverage - a.ratingAverage).slice(0, 9);
    const campaigns = data.campaigns
      .filter((campaign) => normalize(campaign.status) === 'active' && listings.some((listing) => catalogService.sameId(listing.id, campaign.listingId)))
      .map((campaign) => ({ id: catalogService.entityId(campaign), name: campaign.name || '', placement: campaign.placement || '', listing: listings.find((listing) => catalogService.sameId(listing.id, campaign.listingId)) || null }));
    res.render('pages/promoters', { seo: { title: 'Classic Trip Promoters & Travel Deals', description: 'Discover promotable Classic Trip travel services, active campaigns and verified booking opportunities across East Africa.', canonicalPath: '/promoters', schema: { '@type': 'CollectionPage', name: 'Classic Trip promoters and campaigns' }, breadcrumbs: [{ name: 'Home', url: '/' }, { name: 'Promoters', url: '/promoters' }] }, topListings, campaigns, stats: { promotableListings: topListings.length, activeCampaigns: campaigns.length } });
  } catch (error) { next(error); }
}

async function listingDetails(req, res, next) {
  try {
    // Bus preview pages need routes, fare snapshots and upcoming departures, not
    // the booking-only seat-row collections. Reuse the same lightweight public
    // discovery snapshot that powers Home/Search; the selected-departure API
    // remains authoritative for live seats and exact journey pricing.
    let prefetched = {};
    if (normalize(req.params.serviceType) === 'bus') {
      const data = await catalogService.discoverySnapshotForListing(req.params.slug, req.params.serviceType);
      const raw = data ? catalogService.listingFor(data, req.params.slug, req.params.serviceType) : null;
      if (data && raw) prefetched = { data, raw };
    }
    const context = await catalogContext(req.params.slug, req.params.serviceType, req.query, prefetched); if (!context.listing) return next();
    if (req.query.ref) await catalogService.recordReferralClick(req.query.ref, context.listing.id, req);
    return res.render('pages/listing-details', { seo: listingSeo(context), listing: context.listing, company: context.company, availability: context.availability, preview: context.preview, referralCode: req.query.ref || req.cookies?.ct_ref || '' });
  } catch (error) { return next(error); }
}

async function prepareBookingForm(req, res, next) {
  const checkoutStartedAt = Date.now();
  try {
    // Checkout preparation needs only the published listing identity. Avoid loading
    // full seat availability and return-search data here because holdSeats performs
    // the authoritative inventory read inside the secure hold flow.
    const discovery = await catalogService.discoverySnapshotForListing(req.params.slug, req.params.serviceType);
    const rawListing = discovery ? catalogService.listingFor(discovery, req.params.slug, req.params.serviceType) : null;
    const listing = rawListing && catalogService.isPublicListing(rawListing, discovery)
      ? catalogService.catalogItem(discovery, rawListing)
      : null;
    const context = listing ? { data: discovery, raw: rawListing, listing } : await publicListingContext(req.params.slug, req.params.serviceType);
    if (!context.listing) return next();
    if (normalize(context.listing.serviceType) !== 'bus') {
      return res.status(400).json({ error: 'Secure checkout preparation is currently required only for bus bookings.' });
    }
    const listingResolvedAt = Date.now();
    const draft = await busBookingDraftService.createDraft(req, { listing: context.listing, payload: req.body || {} });
    const finishedAt = Date.now();
    if (finishedAt - checkoutStartedAt >= 1200) logger.warn('Bus checkout prepare timing', {
      requestId: req.id || '', listing: context.listing.slug || context.listing.id,
      listingMs: listingResolvedAt - checkoutStartedAt, holdAndDraftMs: finishedAt - listingResolvedAt, totalMs: finishedAt - checkoutStartedAt,
    });
    return res.status(draft.reused ? 200 : 201).json(draft);
  } catch (error) { return next(error); }
}

async function bookingForm(req, res, next) {
  try {
    res.set('Cache-Control', 'no-store, max-age=0');
    res.set('Pragma', 'no-cache');
    // Bus checkout is entered immediately after the lightweight marketplace flow.
    // Reuse that Redis-backed discovery snapshot instead of opening a fresh scoped
    // Atlas snapshot just to render the passenger form.
    let publicContext;
    if (normalize(req.params.serviceType) === 'bus') {
      const data = await catalogService.discoverySnapshotForListing(req.params.slug, req.params.serviceType);
      const raw = data ? catalogService.listingFor(data, req.params.slug, req.params.serviceType) : null;
      publicContext = raw && catalogService.isPublicListing(raw, data)
        ? { data, raw, listing: catalogService.catalogItem(data, raw) }
        : await publicListingContext(req.params.slug, req.params.serviceType);
    } else {
      publicContext = await publicListingContext(req.params.slug, req.params.serviceType);
    }
    if (!publicContext.listing) return next();
    const normalizedServiceType = normalize(publicContext.listing.serviceType);
    if (normalizedServiceType === 'flight') return res.redirect(303, `/flights?listingId=${encodeURIComponent(publicContext.listing.id)}`);
    if (normalizedServiceType === 'local_transport') return res.redirect(303, `/taxi?listingId=${encodeURIComponent(publicContext.listing.id)}`);

    let source = req.query || {};
    let bookingDraftId = '';
    let context;
    let returnAvailability = null;
    if (normalizedServiceType === 'bus') {
      const legacyDraftId = String(req.query.draft || '').trim();
      if (legacyDraftId) {
        await busBookingDraftService.resolveDraft(req, { draftId: legacyDraftId, listing: publicContext.listing });
        return res.redirect(303, `/book/bus/${encodeURIComponent(publicContext.listing.slug)}`);
      }
      const draft = busBookingDraftService.peekDraft(req, { draftId: '', listing: publicContext.listing });
      bookingDraftId = draft.id;
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
      const draftAvailability = busBookingDraftService.checkoutAvailability(draft, 'outbound');
      const draftReturnAvailability = draft.return ? busBookingDraftService.checkoutAvailability(draft, 'return') : null;
      if (draftAvailability) {
        const company = catalogService.companyFor(publicContext.data, publicContext.raw.companyId || publicContext.raw.companySlug);
        const listing = publicContext.listing;
        listing.priceFrom = Number(draftAvailability.fare?.baseAmountPerSeat || listing.priceFrom || 0);
        listing.currency = draftAvailability.fare?.currency || listing.currency;
        listing.from = draftAvailability.journey?.originName || listing.from;
        listing.to = draftAvailability.journey?.destinationName || listing.to;
        const availability = {
          ...draftAvailability,
          selectedRouteId: draftAvailability.schedule?.routeId || '',
          routes: Array.isArray(listing.routes) ? listing.routes : [],
          returnSchedules: [],
        };
        const preview = catalogService.listingPreview(publicContext.data, listing, availability, company);
        preview.previewSeats = availability.seats || [];
        preview.currency = availability.fare?.currency || listing.currency;
        context = { ...publicContext, listing, company, availability, preview };
        returnAvailability = draftReturnAvailability;
      } else {
        // Compatibility for a draft created by a pre-v1.6.81 process.
        const contextPromise = catalogContext(req.params.slug, req.params.serviceType, { ...source, includeReturnSchedules: false, compactAvailability: true }, publicContext);
        const returnAvailabilityPromise = source.returnScheduleId
          ? busInventoryService.getAvailability({
            scheduleId: source.returnScheduleId,
            originStopId: source.returnOriginStopId,
            destinationStopId: source.returnDestinationStopId,
            holdId: source.returnHoldId,
            seatNumbers: source.returnSeats || '',
          })
          : Promise.resolve(null);
        [context, returnAvailability] = await Promise.all([contextPromise, returnAvailabilityPromise]);
      }
      if (!context.listing) return next();
    } else {
      context = await catalogContext(req.params.slug, req.params.serviceType, source, publicContext);
      if (!context.listing) return next();
    }

    const rawAddons = source.addons || source.addon || [];
    const selectedAddonIds = (Array.isArray(rawAddons) ? rawAddons : [rawAddons]).flatMap((value) => String(value || '').split(',')).map((value) => value.trim()).filter(Boolean);
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
  } catch (error) {
    if (['booking_draft_expired', 'booking_draft_required'].includes(String(error?.code || ''))) {
      if (req.flash) req.flash('warning', 'Your secure seat hold expired. Please choose the journey and seats again.');
      const serviceType = encodeURIComponent(String(req.params.serviceType || 'bus'));
      const slug = encodeURIComponent(String(req.params.slug || ''));
      const ref = String(req.query?.ref || req.cookies?.ct_ref || '').trim();
      return res.redirect(303, `/listings/${serviceType}/${slug}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`);
    }
    return next(error);
  }
}

function ticketIsReady(booking = {}) {
  const validStatuses = ['confirmed', 'booked', 'in_progress', 'completed', 'checked_in', 'checked_out', 'rescheduled', 'partially_checked_in'];
  return String(booking.paymentStatus || '').toLowerCase() === 'successful'
    && validStatuses.includes(String(booking.bookingStatus || '').toLowerCase());
}
function attachTicketLinks(booking = {}) { if (booking?.bookingRef) { booking.publicTicketUrl = ticketAccessService.ticketUrl(booking); if (ticketIsReady(booking)) booking.publicTicketPdfUrl = ticketAccessService.ticketUrl(booking, '.pdf'); else delete booking.publicTicketPdfUrl; } return booking; }
function ticketLookupRedirect(bookingRef = '') { return `/tickets${bookingRef ? `?bookingRef=${encodeURIComponent(bookingRef)}` : ''}`; }
function domainBookingUrl(booking = {}, lookupCode = '') {
  const ref = encodeURIComponent(booking.bookingRef || booking.id || '');
  const code = lookupCode ? `?lookupCode=${encodeURIComponent(lookupCode)}` : '';
  if (booking.serviceType === 'flight') return `/flights/orders/${ref}${code}`;
  if (booking.serviceType === 'local_transport') return `/taxi/rides/${ref}${code}`;
  return '';
}
async function findBooking(bookingRef) { return bookingRef ? commerceRepository.bookings.findOne({ bookingRef }) : null; }
async function findListingById(listingId) { const data = await catalogService.snapshotForListing(listingId) || await catalogService.snapshot(); const raw = catalogService.listingFor(data, listingId); return raw ? catalogService.catalogItem(data, raw) : null; }

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
    if (booking && !ticketAccessService.canAccessBooking(req, booking)) booking = null;
    const ticketReady = booking ? ticketIsReady(booking) : false;
    if (booking) {
      ticketAccessService.grantSessionAccess(req, booking.bookingRef);
      attachTicketLinks(booking);
    }
    const listing = booking ? await findListingById(booking.listingId) : null; const qrDataUrl = booking && ticketReady ? await qrService.toDataUrl(booking.qrCodeValue) : '';
    res.render('pages/ticket-lookup', { seo: { title: 'Find ticket | Classic Trip' }, query: req.query, lookupAttempted: Boolean(bookingRef), booking, listing, qrDataUrl, ticketReady });
  } catch (error) { next(error); }
}

async function bookingSuccess(req, res, next) {
  try {
    const booking = await findBooking(req.params.bookingRef); if (!booking) return next();
    if (!ticketAccessService.canAccessBooking(req, booking)) return res.redirect(ticketLookupRedirect(booking.bookingRef));
    if (!ticketIsReady(booking)) return res.redirect(ticketLookupRedirect(booking.bookingRef));
    const domainUrl = domainBookingUrl(booking, req.query?.lookupCode || req.query?.accessCode || req.query?.code || '');
    if (domainUrl) return res.redirect(303, domainUrl);
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
  const domainUrl = domainBookingUrl(confirmed);
  return res.redirect(domainUrl || `/booking/success/${encodeURIComponent(confirmed.bookingRef)}`);
}

module.exports = { servicesPage, routesPage, companiesPage, companyProfile, promotersPage, listingDetails, prepareBookingForm, bookingForm, ticketPage, ticketPdf, ticketLookupPage, bookingSuccess, paymentCallback };
