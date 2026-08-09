const searchService = require('../../services/search/searchService');
const catalogService = require('../../services/marketplace/catalogService');
const seoService = require('../../services/seo/seoService');

function normalizedServiceType(value = '') {
  const key = String(value || '').trim().toLowerCase();
  return ['stay', 'stays', 'home', 'homes', 'accommodation', 'accommodations'].includes(key) ? 'hotel' : key;
}

function listingUrl(listing = {}) {
  if (listing.url) return seoService.absoluteUrl(listing.url);
  return seoService.absoluteUrl(seoService.publicListingPath(listing));
}

async function searchPage(req, res, next) {
  try {
    const landing = req.searchLanding || null;
    const query = { ...req.query, ...(landing?.query || {}) };
    if (landing?.serviceType) query.serviceType = landing.serviceType;
    query.serviceType = normalizedServiceType(query.serviceType || query.type);
    const { results, meta, data } = await searchService.searchWithMeta(query);

    const defaultSeo = {
      title: 'Search buses, stays, flights, rides, tours, car rentals and cargo | Classic Trip',
      description: 'Search live Classic Trip travel inventory across East Africa by route, destination, service, date, availability and partner.',
      canonicalPath: '/search',
      robots: 'noindex,follow,max-image-preview:large,max-snippet:-1',
    };
    const seo = { ...defaultSeo, ...(landing?.seo || {}) };
    if (landing) {
      const itemList = {
        '@type': 'ItemList',
        name: seo.title,
        numberOfItems: results.length,
        itemListElement: results.slice(0, 24).map((listing, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          url: listingUrl(listing),
          name: listing.title || listing.name || 'Classic Trip travel service',
        })),
      };
      seo.schema = [
        { '@type': 'CollectionPage', name: seo.title, description: seo.description, url: seoService.absoluteUrl(seo.canonicalPath) },
        itemList,
      ];
      seo.breadcrumbs = [
        { name: 'Home', url: '/' },
        { name: landing.label || 'Travel services', url: seo.canonicalPath },
      ];
    }

    return res.render('pages/search', {
      seo,
      query,
      categories: data.categories,
      corridorStats: meta.routeHighlights,
      searchMeta: meta,
      results,
      companies: data.companies,
      searchLanding: landing,
      searchOptions: catalogService.searchOptions(data),
    });
  } catch (error) { return next(error); }
}

module.exports = { searchPage };
