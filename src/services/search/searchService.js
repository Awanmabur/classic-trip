const store = require('../data/demoStore');

function search(query) {
  return store.searchListings(query);
}

function searchWithMeta(query = {}) {
  const results = search(query);
  const marketplace = store.marketplaceInfo(results);
  return {
    results,
    meta: {
      total: results.length,
      marketplace,
      typeStats: marketplace.typeStats,
      routeHighlights: marketplace.routeHighlights,
      query,
    },
  };
}

function recommendations({ serviceType, city, limit = 8 } = {}) {
  return store.searchListings({ serviceType, city, sort: 'recommended' }).slice(0, limit);
}

module.exports = { search, searchWithMeta, recommendations };
