const searchService = require('../../services/search/searchService');
async function searchPage(req, res, next) {
  try {
    const { results, meta, data } = await searchService.searchWithMeta(req.query);
    res.render('pages/search', {
      seo: { title: 'Search routes and services | Classic Trip' }, query: req.query,
      categories: data.categories, corridorStats: meta.routeHighlights, searchMeta: meta,
      results, companies: data.companies,
    });
  } catch (error) { next(error); }
}
module.exports = { searchPage };
