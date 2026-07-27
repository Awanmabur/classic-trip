const searchService = require('../../services/search/searchService');
async function searchPage(req, res, next) {
  try {
    const query = { ...req.query };
    if (['stay','stays','home','homes','accommodation','accommodations'].includes(String(query.serviceType || query.type || '').trim().toLowerCase())) query.serviceType = 'hotel';
    const { results, meta, data } = await searchService.searchWithMeta(query);
    res.render('pages/search', {
      seo: { title: 'Search buses, stays, Airbnb-style homes, flights, rides, tours, car rentals and cargo | Classic Trip' }, query,
      categories: data.categories, corridorStats: meta.routeHighlights, searchMeta: meta,
      results, companies: data.companies,
    });
  } catch (error) { next(error); }
}
module.exports = { searchPage };
