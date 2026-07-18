const { env } = require('../../config/env');
const seoService = require('../../services/seo/seoService');

function robots(req, res) {
  res.type('text/plain; charset=utf-8').send(seoService.robotsTxt());
}

function sitemap(req, res) {
  res.type('application/xml; charset=utf-8').send(seoService.sitemapXml());
}

function llms(req, res) {
  res.type('text/plain; charset=utf-8').send(seoService.llmsTxt());
}

function indexNowKey(req, res, next) {
  if (!env.seo.indexNowKey || req.params.key !== env.seo.indexNowKey) return next();
  return res.type('text/plain; charset=utf-8').send(env.seo.indexNowKey);
}

module.exports = { robots, sitemap, llms, indexNowKey };
