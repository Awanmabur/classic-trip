const { env } = require('../../config/env');
const seoService = require('../../services/seo/seoService');

function robots(req, res) {
  res.type('text/plain; charset=utf-8').send(seoService.robotsTxt());
}

async function sitemap(req, res, next) {
  try { res.type('application/xml; charset=utf-8').send(await seoService.sitemapXml()); } catch (error) { next(error); }
}

async function llms(req, res, next) {
  try { res.type('text/plain; charset=utf-8').send(await seoService.llmsTxt()); } catch (error) { next(error); }
}

function indexNowKey(req, res, next) {
  if (!env.seo.indexNowKey || req.params.key !== env.seo.indexNowKey) return next();
  return res.type('text/plain; charset=utf-8').send(env.seo.indexNowKey);
}

module.exports = { robots, sitemap, llms, indexNowKey };
