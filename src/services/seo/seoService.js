const { env } = require('../../config/env');
const contentRepository = require('../../repositories/domain/contentRepository');

const PRIVATE_DISALLOWS = [
  '/admin',
  '/company',
  '/employee',
  '/driver',
  '/account',
  '/promoter/dashboard',
  '/api',
  '/cart',
  '/booking',
  '/tickets/',
  '/uploads',
];

const STATIC_PUBLIC_URLS = [
  { path: '/', priority: '1.0', changefreq: 'daily' },
  { path: '/search', priority: '0.9', changefreq: 'daily' },
  { path: '/services', priority: '0.9', changefreq: 'weekly' },
  { path: '/routes', priority: '0.8', changefreq: 'daily' },
  { path: '/companies', priority: '0.8', changefreq: 'weekly' },
  { path: '/promoters', priority: '0.7', changefreq: 'weekly' },
  { path: '/promoter-program', priority: '0.7', changefreq: 'weekly' },
  { path: '/partner-commission', priority: '0.7', changefreq: 'weekly' },
  { path: '/blogs', priority: '0.6', changefreq: 'weekly' },
  { path: '/support', priority: '0.5', changefreq: 'monthly' },
  { path: '/how-it-works', priority: '0.6', changefreq: 'monthly' },
  { path: '/terms', priority: '0.4', changefreq: 'monthly' },
  { path: '/privacy', priority: '0.4', changefreq: 'monthly' },
  { path: '/tickets', priority: '0.4', changefreq: 'monthly' },
];

function siteUrl() {
  return String(env.seo.siteUrl || env.appUrl || 'http://localhost:5000').replace(/\/+$/, '');
}

function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function slug(value = '') {
  return encodeURIComponent(String(value || '').trim()).replace(/%2F/gi, '-');
}

function absoluteUrl(path = '/') {
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedPath = `/${String(path || '/').replace(/^\/+/, '')}`;
  return `${siteUrl()}${normalizedPath === '/?' ? '/' : normalizedPath}`;
}

function isoDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function statusAllowsPublic(row = {}) {
  const status = String(row.status || row.visibility || 'active').toLowerCase();
  return !['archived', 'deleted', 'draft', 'inactive', 'disabled', 'pending'].includes(status);
}

function addUnique(target, seen, entry = {}) {
  if (!entry.path && !entry.url) return;
  const loc = absoluteUrl(entry.url || entry.path);
  if (seen.has(loc)) return;
  seen.add(loc);
  target.push({
    loc,
    lastmod: isoDate(entry.lastmod || entry.updatedAt || entry.createdAt),
    changefreq: entry.changefreq || 'weekly',
    priority: entry.priority || '0.6',
  });
}

async function dynamicUrls() {
  const entries = [];
  const [categories, listings, companies, blogs] = await Promise.all([
    contentRepository.categories.list({}, { limit: 2000 }),
    contentRepository.listings.list({ status: { $nin: ['archived', 'deleted', 'draft', 'inactive', 'disabled', 'pending'] } }, { limit: 50000 }),
    contentRepository.companies.list({ status: { $nin: ['archived', 'deleted', 'inactive', 'disabled'] } }, { limit: 10000 }),
    contentRepository.blogs.list({ status: { $nin: ['archived', 'deleted', 'draft', 'inactive', 'disabled', 'pending'] } }, { limit: 10000 }),
  ]);

  categories.filter((category) => statusAllowsPublic(category) && (category.key || category.slug)).forEach((category) => {
    const key = slug(category.key || category.slug);
    entries.push({ path: `/search?serviceType=${key}`, priority: '0.8', changefreq: 'daily', updatedAt: category.updatedAt });
  });

  listings.filter((listing) => statusAllowsPublic(listing) && (listing.slug || listing.id) && (listing.serviceType || listing.type)).forEach((listing) => {
    entries.push({ path: `/listings/${slug(listing.serviceType || listing.type)}/${slug(listing.slug || listing.id)}`, priority: listing.bookable === false ? '0.6' : '0.9', changefreq: 'daily', updatedAt: listing.updatedAt || listing.createdAt });
  });

  companies.filter((company) => statusAllowsPublic(company) && (company.slug || company.id || company.name)).forEach((company) => {
    entries.push({ path: `/companies/${slug(company.slug || company.id || company.name)}`, priority: company.verificationStatus === 'verified' ? '0.8' : '0.6', changefreq: 'weekly', updatedAt: company.updatedAt || company.createdAt });
  });

  blogs.filter((blog) => statusAllowsPublic(blog) && (blog.slug || blog.id)).forEach((blog) => {
    entries.push({ path: `/blogs/${slug(blog.slug || blog.id)}`, priority: '0.6', changefreq: 'monthly', updatedAt: blog.updatedAt || blog.publishedAt || blog.createdAt });
  });

  (env.seo.publicSitemapExtraUrls || []).forEach((url) => entries.push({ url, priority: '0.5', changefreq: 'weekly' }));
  return entries;
}

async function buildSitemapUrls() {
  const urls = [];
  const seen = new Set();
  STATIC_PUBLIC_URLS.forEach((entry) => addUnique(urls, seen, entry));
  (await dynamicUrls()).forEach((entry) => addUnique(urls, seen, entry));
  return urls.slice(0, 50000);
}

async function sitemapXml() {
  const urls = await buildSitemapUrls();
  const rows = urls.map((url) => [
    '  <url>',
    `    <loc>${escapeXml(url.loc)}</loc>`,
    `    <lastmod>${escapeXml(url.lastmod)}</lastmod>`,
    `    <changefreq>${escapeXml(url.changefreq)}</changefreq>`,
    `    <priority>${escapeXml(url.priority)}</priority>`,
    '  </url>',
  ].join('\n'));
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...rows, '</urlset>', ''].join('\n');
}

function crawlSection(agent, allowed = true) {
  const lines = [`User-agent: ${agent}`];
  if (!allowed) {
    lines.push('Disallow: /');
    return lines;
  }
  lines.push('Allow: /');
  PRIVATE_DISALLOWS.forEach((path) => lines.push(`Disallow: ${path}`));
  return lines;
}

function robotsTxt() {
  const sections = [
    crawlSection('*', true),
    crawlSection('Googlebot', true),
    crawlSection('Bingbot', true),
    crawlSection('OAI-SearchBot', env.seo.allowAiSearch),
    crawlSection('ChatGPT-User', env.seo.allowAiSearch),
    crawlSection('GPTBot', env.seo.allowAiTraining),
    crawlSection('CCBot', env.seo.allowAiTraining),
    crawlSection('Google-Extended', env.seo.allowAiTraining),
    crawlSection('Applebot-Extended', env.seo.allowAiTraining),
  ];
  return [...sections.flatMap((section) => [...section, '']), `Sitemap: ${absoluteUrl('/sitemap.xml')}`, ''].join('\n');
}

async function llmsTxt() {
  const urls = await buildSitemapUrls();
  const catalog = urls
    .filter((url) => /\/(listings|companies|blogs)\//.test(url.loc))
    .slice(0, 80)
    .map((url) => `- ${url.loc}`);
  return [
    '# Classic Trip',
    '',
    `${env.seo.defaultDescription}`,
    '',
    '## Primary Public URLs',
    `- ${absoluteUrl('/')}`,
    `- ${absoluteUrl('/search')}`,
    `- ${absoluteUrl('/services')}`,
    `- ${absoluteUrl('/routes')}`,
    `- ${absoluteUrl('/companies')}`,
    `- ${absoluteUrl('/partner-commission')}`,
    `- ${absoluteUrl('/support')}`,
    '',
    '## Marketplace Catalog URLs',
    ...(catalog.length ? catalog : ['- Catalog URLs appear here when listings, companies, and posts are published.']),
    '',
    '## Crawl Notes',
    '- Public marketplace, listing, partner, blog, pricing, support, terms, and privacy pages are intended for indexing.',
    '- Dashboards, carts, checkout sessions, tickets, upload paths, and API routes are private or transactional and should not be indexed.',
    '- Sitemap: ' + absoluteUrl('/sitemap.xml'),
    '- Robots: ' + absoluteUrl('/robots.txt'),
    '',
  ].join('\n');
}

module.exports = {
  siteUrl,
  absoluteUrl,
  buildSitemapUrls,
  sitemapXml,
  robotsTxt,
  llmsTxt,
};
