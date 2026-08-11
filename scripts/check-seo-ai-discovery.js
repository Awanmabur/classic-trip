'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const failures = [];
let passed = 0;
function check(name, ok) { if (ok) { passed += 1; console.log(`✓ ${name}`); } else { failures.push(name); console.error(`✗ ${name}`); } }

const seo = read('src/services/seo/seoService.js');
const controller = read('src/controllers/public/seoController.js');
const routes = read('src/routes/web/public.js');
const search = read('src/controllers/public/searchController.js');
const head = read('src/views/partials/site-head.ejs');
const home = read('src/views/pages/home.ejs');
const app = read('src/app.js');
const indexing = read('src/middlewares/searchIndexing.js');
const listingController = read('src/controllers/public/listingController.js');
const blogController = read('src/controllers/public/blogController.js');
const render = read('render.yaml');

check('release includes v1.6.38 SEO work', pkg.version === '1.6.48');
check('clean service landing routes exist', ['/buses','/stays','/airbnb','/tours','/car-rentals','/cargo'].every((route) => routes.includes(`router.get('${route}'`)));
check('service landing routes render instead of redirecting to faceted search', !/router\.get\('\/stays'[\s\S]{0,240}res\.redirect/.test(routes) && /serviceLanding/.test(routes));
check('faceted search is noindex follow', /robots: 'noindex,follow/.test(search) && /req\.path === '\/search'/.test(indexing));
check('private transactional paths receive X-Robots-Tag noindex', /X-Robots-Tag/.test(indexing) && /noindex, nofollow, noarchive/.test(indexing) && /searchIndexing/.test(app));
check('sitemap index and child sitemap endpoints exist', /sitemapIndexXml/.test(seo) && /sitemapSectionXml/.test(seo) && /sitemaps\/:section\.xml/.test(routes) && /sitemapindex/.test(seo));
check('sitemap contains canonical clean service pages and excludes search query URLs', /path: '\/buses'/.test(seo) && /path: '\/stays'/.test(seo) && !/search\?serviceType/.test(seo));
check('sitemap lastmod is only emitted when a real timestamp exists', /if \(url\.lastmod\)/.test(seo) && /if \(!value\) return ''/.test(seo));
check('OpenAI search crawlers are explicitly allowed independently from training', /OAI-SearchBot/.test(seo) && /ChatGPT-User/.test(seo) && /GPTBot', env\.seo\.allowAiTraining/.test(seo));
check('Anthropic search/user crawlers are independent from ClaudeBot training crawler', /Claude-SearchBot/.test(seo) && /Claude-User/.test(seo) && /ClaudeBot', env\.seo\.allowAiTraining/.test(seo));
check('AI-readable summary, full catalog and JSON catalog endpoints exist', /llms\.txt/.test(routes) && /llms-full\.txt/.test(routes) && /ai-index\.json/.test(routes) && /aiPublicCatalog/.test(seo));
check('shared head includes canonical, strong robots, OG/Twitter image metadata, sitemap and AI discovery links', /rel="canonical"/.test(head) && /max-snippet:-1/.test(head) && /og:image:alt/.test(head) && /twitter:image:alt/.test(head) && /rel="sitemap"/.test(head) && /ai-index\.json/.test(head));
check('shared structured data supports organization, website, page schemas and breadcrumbs', /TravelAgency/.test(head) && /WebSite/.test(head) && /BreadcrumbList/.test(head) && /suppliedSchemas/.test(head));
check('listing pages emit Service/Offer structured data and canonical public URLs', /function listingSeo/.test(listingController) && /'@type': 'Service'/.test(listingController) && /'@type': 'Offer'/.test(listingController) && /canonicalPath: publicPath/.test(listingController));
check('company pages emit TravelAgency structured data', /function companySeo/.test(listingController) && /'@type': 'TravelAgency'/.test(listingController));
check('blog posts emit BlogPosting structured data', /'@type': 'BlogPosting'/.test(blogController) && /datePublished/.test(blogController));
check('home has full canonical/social/AI metadata and service ItemList schema', /og:site_name/.test(home) && /ai-index\.json/.test(home) && /ItemList/.test(home) && /\/buses/.test(home));
check('Render exposes AI search, verification and IndexNow production configuration', /SEO_ALLOW_AI_SEARCH/.test(render) && /SEO_ALLOW_AI_TRAINING/.test(render) && /GOOGLE_SITE_VERIFICATION/.test(render) && /BING_SITE_VERIFICATION/.test(render) && /INDEXNOW_KEY/.test(render));
check('IndexNow submission remains wired to canonical sitemap URL inventory', /seo:submit-indexnow/.test(read('package.json')) && /buildSitemapUrls/.test(read('scripts/submit-indexnow.js')));

if (failures.length) {
  console.error(`SEO/AI discovery validation failed (${failures.length}/${passed + failures.length}).`);
  process.exit(1);
}
console.log(`SEO/AI discovery validation passed (${passed}/${passed}).`);
