const searchService = require('../../services/search/searchService');
const store = require('../../services/data/demoStore');

function searchPage(req, res) {
  const { results, meta } = searchService.searchWithMeta(req.query);
  res.render('pages/search', {
    seo: { title: 'Search routes and services | Classic Trip' },
    query: req.query,
    categories: store.state.categories,
    corridorStats: store.corridorStats(),
    searchMeta: meta,
    results,
    companies: store.state.companies,
  });
}

module.exports = { searchPage };
