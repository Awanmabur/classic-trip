const { env } = require('../../config/env');
const seoService = require('../../services/seo/seoService');

function cache(res, seconds = 600) {
  res.setHeader('Cache-Control', `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${Math.max(seconds, 3600)}`);
}

function robots(req, res) {
  cache(res, 3600);
  res.type('text/plain; charset=utf-8').send(seoService.robotsTxt());
}

function sitemap(req, res) {
  cache(res, 900);
  res.type('application/xml; charset=utf-8').send(seoService.sitemapIndexXml());
}

async function sitemapSection(req, res, next) {
  try {
    if (!seoService.SITEMAP_SECTIONS.includes(req.params.section)) return next();
    cache(res, 900);
    return res.type('application/xml; charset=utf-8').send(await seoService.sitemapSectionXml(req.params.section));
  } catch (error) { return next(error); }
}

async function llms(req, res, next) {
  try { cache(res, 900); res.type('text/plain; charset=utf-8').send(await seoService.llmsTxt()); } catch (error) { next(error); }
}

async function llmsFull(req, res, next) {
  try { cache(res, 600); res.type('text/plain; charset=utf-8').send(await seoService.llmsFullTxt()); } catch (error) { next(error); }
}

async function aiIndex(req, res, next) {
  try {
    cache(res, 600);
    res.setHeader('X-Robots-Tag', 'index, follow');
    return res.json(await seoService.aiIndex());
  } catch (error) { return next(error); }
}

function indexNowKey(req, res, next) {
  if (!env.seo.indexNowKey || req.params.key !== env.seo.indexNowKey) return next();
  cache(res, 3600);
  return res.type('text/plain; charset=utf-8').send(env.seo.indexNowKey);
}

module.exports = { robots, sitemap, sitemapSection, llms, llmsFull, aiIndex, indexNowKey };
