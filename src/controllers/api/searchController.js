const searchService = require('../../services/search/searchService');
async function index(req, res, next) {
  try { const { results, meta } = await searchService.searchWithMeta(req.query); res.json({ data: results, meta, query: req.query }); }
  catch (error) { next(error); }
}
module.exports = { index };
