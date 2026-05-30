const { fetchMarketplaceTrips: fetchCatalogTrips } = require("../../platform/catalog");

async function fetchMarketplaceTrips(limit = 80, options = {}) {
  return fetchCatalogTrips(limit, options);
}

module.exports = {
  fetchMarketplaceTrips
};
