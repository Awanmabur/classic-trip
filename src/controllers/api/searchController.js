const searchService = require('../../services/search/searchService');
function index(req, res) {
  const { results, meta } = searchService.searchWithMeta(req.query);
  res.json({ data: results, meta, query: req.query });
}
module.exports = { index };
