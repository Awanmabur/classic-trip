const catalogService = require('../marketplace/catalogService');
async function search(query) { return (await catalogService.search(query)).results; }
async function searchWithMeta(query = {}) { return catalogService.searchWithMeta(query); }
async function recommendations({ serviceType, city, limit = 8 } = {}) { return (await search({ serviceType, city, sort: 'recommended' })).slice(0, limit); }
module.exports = { search, searchWithMeta, recommendations };
