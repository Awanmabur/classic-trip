const { env } = require('../../config/env');
const contentRepository = require('../../repositories/domain/contentRepository');

const PRIVATE_DISALLOWS = [
  '/admin',
  '/company',
  '/employee',
  '/driver',
  '/account',
  '/customer',
  '/promoter/dashboard',
  '/api',
  '/uploads',
  '/health',
  '/ready',
];

const STATIC_PUBLIC_URLS = [
  { path: '/', priority: '1.0', changefreq: 'daily' },
  { path: '/buses', priority: '0.9', changefreq: 'daily' },
  { path: '/stays', priority: '0.9', changefreq: 'daily' },
  { path: '/airbnb', priority: '0.8', changefreq: 'daily' },
  { path: '/flights', priority: '0.9', changefreq: 'daily' },
  { path: '/taxi', priority: '0.9', changefreq: 'daily' },
  { path: '/tours', priority: '0.8', changefreq: 'daily' },
  { path: '/car-rentals', priority: '0.8', changefreq: 'daily' },
  { path: '/cargo', priority: '0.8', changefreq: 'daily' },
  { path: '/services', priority: '0.9', changefreq: 'weekly' },
  { path: '/routes', priority: '0.8', changefreq: 'daily' },
  { path: '/companies', priority: '0.8', changefreq: 'weekly' },
  { path: '/promoters', priority: '0.7', changefreq: 'weekly' },
  { path: '/partner-commission', priority: '0.7', changefreq: 'weekly' },
  { path: '/blogs', priority: '0.7', changefreq: 'weekly' },
  { path: '/support', priority: '0.5', changefreq: 'monthly' },
  { path: '/how-it-works', priority: '0.6', changefreq: 'monthly' },
  { path: '/terms', priority: '0.4', changefreq: 'monthly' },
  { path: '/privacy', priority: '0.4', changefreq: 'monthly' },
];

const SITEMAP_SECTIONS = ['static', 'listings', 'companies', 'blogs'];
const PUBLIC_STATUS_EXCLUSIONS = ['archived', 'deleted', 'draft', 'inactive', 'disabled', 'pending'];

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
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function statusAllowsPublic(row = {}) {
  const status = String(row.status || row.visibility || 'active').toLowerCase();
  return !PUBLIC_STATUS_EXCLUSIONS.includes(status);
}

function publicListingPath(listing = {}) {
  const type = String(listing.serviceType || listing.type || '').toLowerCase();
  const publicType = type === 'hotel' ? 'stays' : slug(type);
  return `/listings/${publicType}/${slug(listing.slug || listing.id)}`;
}

function addUnique(target, seen, entry = {}) {
  if (!entry.path && !entry.url) return;
  const loc = absoluteUrl(entry.url || entry.path);
  try { if (new URL(loc).host !== new URL(siteUrl()).host) return; } catch (_) { return; }
  if (seen.has(loc)) return;
  seen.add(loc);
  target.push({
    loc,
    lastmod: isoDate(entry.lastmod || entry.updatedAt || entry.publishedAt || entry.createdAt),
    changefreq: entry.changefreq || 'weekly',
    priority: entry.priority || '0.6',
  });
}

async function sitemapEntries(section) {
  const urls = [];
  const seen = new Set();

  if (section === 'static') {
    STATIC_PUBLIC_URLS.forEach((entry) => addUnique(urls, seen, entry));
    (env.seo.publicSitemapExtraUrls || []).forEach((url) => addUnique(urls, seen, { url, priority: '0.5', changefreq: 'weekly' }));
    return urls;
  }

  if (section === 'listings') {
    const listings = await contentRepository.listings.list(
      { status: { $nin: PUBLIC_STATUS_EXCLUSIONS } },
      { limit: 50000 },
    );
    listings.filter((listing) => statusAllowsPublic(listing) && (listing.slug || listing.id) && (listing.serviceType || listing.type)).forEach((listing) => {
      addUnique(urls, seen, {
        path: publicListingPath(listing),
        priority: listing.bookable === false ? '0.6' : '0.9',
        changefreq: 'daily',
        updatedAt: listing.updatedAt || listing.publishedAt || listing.createdAt,
      });
    });
    return urls;
  }

  if (section === 'companies') {
    const companies = await contentRepository.companies.list(
      { status: { $nin: ['archived', 'deleted', 'inactive', 'disabled'] } },
      { limit: 10000 },
    );
    companies.filter((company) => statusAllowsPublic(company) && String(company.verificationStatus || '').toLowerCase() === 'verified' && (company.slug || company.id || company.name)).forEach((company) => {
      addUnique(urls, seen, {
        path: `/companies/${slug(company.slug || company.id || company.name)}`,
        priority: '0.8',
        changefreq: 'weekly',
        updatedAt: company.updatedAt || company.createdAt,
      });
    });
    return urls;
  }

  if (section === 'blogs') {
    const blogs = await contentRepository.blogs.list(
      { status: 'published' },
      { limit: 10000 },
    );
    blogs.filter((blog) => statusAllowsPublic(blog) && (blog.slug || blog.id)).forEach((blog) => {
      addUnique(urls, seen, {
        path: `/blogs/${slug(blog.slug || blog.id)}`,
        priority: '0.7',
        changefreq: 'monthly',
        updatedAt: blog.updatedAt || blog.publishedAt || blog.createdAt,
      });
    });
    return urls;
  }

  return [];
}

async function buildSitemapUrls() {
  const groups = await Promise.all(SITEMAP_SECTIONS.map((section) => sitemapEntries(section)));
  const urls = [];
  const seen = new Set();
  groups.flat().forEach((entry) => {
    if (!seen.has(entry.loc)) {
      seen.add(entry.loc);
      urls.push(entry);
    }
  });
  return urls;
}

function urlsetXml(urls = []) {
  const rows = urls.map((url) => {
    const fields = [
      '  <url>',
      `    <loc>${escapeXml(url.loc)}</loc>`,
    ];
    if (url.lastmod) fields.push(`    <lastmod>${escapeXml(url.lastmod)}</lastmod>`);
    if (url.changefreq) fields.push(`    <changefreq>${escapeXml(url.changefreq)}</changefreq>`);
    if (url.priority) fields.push(`    <priority>${escapeXml(url.priority)}</priority>`);
    fields.push('  </url>');
    return fields.join('\n');
  });
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...rows, '</urlset>', ''].join('\n');
}

function sitemapIndexXml() {
  const rows = SITEMAP_SECTIONS.map((section) => [
    '  <sitemap>',
    `    <loc>${escapeXml(absoluteUrl(`/sitemaps/${section}.xml`))}</loc>`,
    '  </sitemap>',
  ].join('\n'));
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...rows, '</sitemapindex>', ''].join('\n');
}

async function sitemapSectionXml(section) {
  if (!SITEMAP_SECTIONS.includes(section)) return '';
  return urlsetXml(await sitemapEntries(section));
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
    // AI search / user-directed retrieval crawlers are distinct from model-training crawlers.
    crawlSection('OAI-SearchBot', env.seo.allowAiSearch),
    crawlSection('ChatGPT-User', env.seo.allowAiSearch),
    crawlSection('PerplexityBot', env.seo.allowAiSearch),
    crawlSection('Claude-SearchBot', env.seo.allowAiSearch),
    crawlSection('Claude-User', env.seo.allowAiSearch),
    // Training crawlers remain independently controllable.
    crawlSection('GPTBot', env.seo.allowAiTraining),
    crawlSection('ClaudeBot', env.seo.allowAiTraining),
    crawlSection('CCBot', env.seo.allowAiTraining),
    crawlSection('Google-Extended', env.seo.allowAiTraining),
    crawlSection('Applebot-Extended', env.seo.allowAiTraining),
  ];
  return [
    ...sections.flatMap((section) => [...section, '']),
    `Sitemap: ${absoluteUrl('/sitemap.xml')}`,
    '',
  ].join('\n');
}

function plainText(value = '', max = 220) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

async function aiPublicCatalog({ listingLimit = 500, companyLimit = 200, blogLimit = 200 } = {}) {
  const [listings, companies, blogs] = await Promise.all([
    contentRepository.listings.list({ status: { $nin: PUBLIC_STATUS_EXCLUSIONS } }, { sort: { updatedAt: -1 }, limit: listingLimit }),
    contentRepository.companies.list({ status: { $nin: ['archived', 'deleted', 'inactive', 'disabled'] }, verificationStatus: 'verified' }, { sort: { updatedAt: -1 }, limit: companyLimit }),
    contentRepository.blogs.list({ status: 'published' }, { sort: { publishedAt: -1, updatedAt: -1 }, limit: blogLimit }),
  ]);
  const companyMap = new Map(companies.map((company) => [String(company.id || company._id || ''), company]));
  return {
    listings: listings.filter(statusAllowsPublic).map((listing) => {
      const company = companyMap.get(String(listing.companyId || ''));
      return {
        title: plainText(listing.title || listing.name || 'Travel service', 140),
        url: absoluteUrl(publicListingPath(listing)),
        serviceType: String(listing.serviceType || listing.type || '').toLowerCase(),
        description: plainText(listing.shortDescription || listing.description || '', 260),
        provider: plainText(company?.name || listing.companyName || '', 120),
        location: plainText(listing.location || listing.city || listing.routeLabel || '', 140),
        priceFrom: Number(listing.priceFrom || listing.price || 0) || null,
        currency: String(listing.currency || company?.operatingCurrency || '').toUpperCase(),
        updatedAt: listing.updatedAt || listing.publishedAt || listing.createdAt || null,
      };
    }),
    companies: companies.map((company) => ({
      name: plainText(company.name || company.legalName || 'Travel partner', 140),
      url: absoluteUrl(`/companies/${slug(company.slug || company.id || company.name)}`),
      description: plainText(company.description || '', 260),
      country: plainText(company.country || '', 80),
      city: plainText(company.city || '', 80),
      verified: String(company.verificationStatus || '').toLowerCase() === 'verified',
      updatedAt: company.updatedAt || company.createdAt || null,
    })),
    blogs: blogs.map((blog) => ({
      title: plainText(blog.title || 'Classic Trip guide', 160),
      url: absoluteUrl(`/blogs/${slug(blog.slug || blog.id)}`),
      excerpt: plainText(blog.excerpt || blog.body || '', 280),
      publishedAt: blog.publishedAt || blog.createdAt || null,
      updatedAt: blog.updatedAt || null,
    })),
  };
}

async function aiIndex() {
  const catalog = await aiPublicCatalog({ listingLimit: 250, companyLimit: 120, blogLimit: 120 });
  return {
    name: 'Classic Trip',
    description: env.seo.defaultDescription,
    canonicalUrl: absoluteUrl('/'),
    generatedAt: new Date().toISOString(),
    discovery: {
      robots: absoluteUrl('/robots.txt'),
      sitemap: absoluteUrl('/sitemap.xml'),
      llms: absoluteUrl('/llms.txt'),
      llmsFull: absoluteUrl('/llms-full.txt'),
    },
    services: [
      { name: 'Buses', url: absoluteUrl('/buses') },
      { name: 'Stays', url: absoluteUrl('/stays') },
      { name: 'Airbnb-style homes', url: absoluteUrl('/airbnb') },
      { name: 'Flights', url: absoluteUrl('/flights') },
      { name: 'Local taxi and boda', url: absoluteUrl('/taxi') },
      { name: 'Tours', url: absoluteUrl('/tours') },
      { name: 'Car rentals', url: absoluteUrl('/car-rentals') },
      { name: 'Cargo', url: absoluteUrl('/cargo') },
    ],
    catalog,
  };
}

async function llmsTxt() {
  return [
    '# Classic Trip',
    '',
    env.seo.defaultDescription,
    '',
    '## Main public pages',
    `- [Home](${absoluteUrl('/')})`,
    `- [Buses](${absoluteUrl('/buses')})`,
    `- [Stays](${absoluteUrl('/stays')})`,
    `- [Flights](${absoluteUrl('/flights')})`,
    `- [Local taxi and boda](${absoluteUrl('/taxi')})`,
    `- [Tours](${absoluteUrl('/tours')})`,
    `- [Car rentals](${absoluteUrl('/car-rentals')})`,
    `- [Cargo](${absoluteUrl('/cargo')})`,
    `- [Verified partners](${absoluteUrl('/companies')})`,
    `- [Travel guides](${absoluteUrl('/blogs')})`,
    '',
    '## Machine-readable discovery',
    `- Sitemap index: ${absoluteUrl('/sitemap.xml')}`,
    `- AI catalog JSON: ${absoluteUrl('/ai-index.json')}`,
    `- Full public reference: ${absoluteUrl('/llms-full.txt')}`,
    `- Robots policy: ${absoluteUrl('/robots.txt')}`,
    '',
    '## Scope and trust',
    '- Public listing, company, service and editorial pages may be crawled, summarized, cited and linked.',
    '- Dashboards, checkout, booking status, tickets, private tracking, API and upload paths are transactional/private and are not intended for indexing.',
    '- Prices and availability displayed to customers are validated against backend marketplace inventory.',
    '',
  ].join('\n');
}

async function llmsFullTxt() {
  const catalog = await aiPublicCatalog();
  const listingLines = catalog.listings.map((item) => {
    const details = [item.serviceType, item.provider, item.location, item.priceFrom ? `${item.currency || ''} ${item.priceFrom}`.trim() : '', item.description].filter(Boolean).join(' · ');
    return `- [${item.title}](${item.url})${details ? ` — ${details}` : ''}`;
  });
  const companyLines = catalog.companies.map((item) => `- [${item.name}](${item.url})${item.description ? ` — ${item.description}` : ''}`);
  const blogLines = catalog.blogs.map((item) => `- [${item.title}](${item.url})${item.excerpt ? ` — ${item.excerpt}` : ''}`);
  return [
    '# Classic Trip — Full Public Reference',
    '',
    env.seo.defaultDescription,
    '',
    '## Platform scope',
    '- East Africa travel marketplace for buses, stays including entire homes and private stays, flights, safe local mobility, tours, car rentals and cargo.',
    '- Public prices, availability and booking conditions are validated by the backend.',
    '- Public catalog and editorial pages may be indexed and cited; transactional/private paths are excluded.',
    '',
    '## Public listings',
    ...(listingLines.length ? listingLines : ['- No published listings are currently available.']),
    '',
    '## Verified partners',
    ...(companyLines.length ? companyLines : ['- No verified public partners are currently available.']),
    '',
    '## Travel guides',
    ...(blogLines.length ? blogLines : ['- No published guides are currently available.']),
    '',
    '## Discovery endpoints',
    `- Canonical site: ${absoluteUrl('/')}`,
    `- Sitemap index: ${absoluteUrl('/sitemap.xml')}`,
    `- AI catalog JSON: ${absoluteUrl('/ai-index.json')}`,
    `- Robots policy: ${absoluteUrl('/robots.txt')}`,
    '',
  ].join('\n');
}

module.exports = {
  SITEMAP_SECTIONS,
  siteUrl,
  absoluteUrl,
  publicListingPath,
  buildSitemapUrls,
  sitemapIndexXml,
  sitemapSectionXml,
  robotsTxt,
  aiPublicCatalog,
  aiIndex,
  llmsTxt,
  llmsFullTxt,
};
