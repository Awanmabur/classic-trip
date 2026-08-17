# Classic Trip v1.6.87 — Google Crawl / Indexing Readiness Audit

## Search Console incident addressed

Search Console reported 45 important Classic Trip public URLs as **Discovered – currently not indexed** with `Last crawled: N/A`. It also reported one intentional partner-login URL as excluded by `noindex` and three HTTP/non-www variants as redirect URLs.

The intentional `noindex` and canonical-host redirects are preserved. The remediation in this release focuses on reducing crawler request cost and eliminating one obsolete public slug with a known replacement.

## v1.6.87 corrections

- Public indexable marketplace landing pages `/buses`, `/stays`, `/airbnb`, `/tours`, `/car-rentals` and `/cargo` are now explicitly treated as anonymous read-only pages.
- Those same landing pages now receive the short shared CDN-cache policy already used by other public discovery surfaces instead of allocating unnecessary anonymous CSRF/session state.
- `/flights` and `/taxi` are intentionally excluded from that token-free fast path because their browser pages submit protected API actions and must keep signed anonymous CSRF protection.
- `/support` is intentionally excluded because the page contains a state-changing support form.
- `/robots.txt`, `/sitemap.xml`, and `/sitemaps/:section.xml` are now served before cookie/session/Passport/CSRF/referral middleware, minimizing crawler discovery overhead and keeping sitemap access independent of session-store health.
- The existing canonical sitemap inventory, canonical tags, structured data, robots policy, indexable page directives, and public discovery links are preserved.
- The obsolete `/companies/bebeto-coaches` URL now returns a permanent `301` redirect to the current canonical verified company profile `/companies/bebeto-coach-services` instead of a 404.
- HTTP and bare-domain requests continue to redirect to the canonical `https://www.classictrip.org` host.
- `/login?role=partner` remains intentionally `noindex` because authentication/onboarding pages should not be search-result landing pages.

## What this release does not do

- It does not add fake `lastmod` timestamps merely to trigger crawling.
- It does not use Google's Indexing API for ordinary travel pages; that API is not intended for normal web pages.
- It does not remove `noindex` from login/private pages.
- It does not weaken CSRF/session security on pages that submit protected actions.
- It cannot guarantee Google indexing; Search Console and Google crawl scheduling remain the source of truth after deployment.

## Post-deploy Search Console actions

1. Resubmit `https://www.classictrip.org/sitemap.xml` in Search Console Sitemaps.
2. Use URL Inspection → **Test live URL** on the homepage, `/buses`, `/blogs`, one blog article, one company page, and one bus listing.
3. If each live test says indexing is allowed and the page is fetchable, use **Request indexing** for those representative high-value URLs only.
4. Do not request a fix for `/login?role=partner`; its `noindex` is intentional.
5. Do not request a fix for `http://classictrip.org/`, `https://classictrip.org/`, or `http://www.classictrip.org/`; those are intentional canonical-host redirects.
6. Monitor Search Console Crawl Stats and Page Indexing over the following days/weeks; focus on whether `Last crawled` changes from `N/A` and whether important URLs move to Crawled/Indexed states.

## Validation completed

- SEO/AI discovery: **22/22**
- Public performance: **21/21**
- Public layout/content: **22/22**
- Cold Home warmup: **9/9**
- Fast runtime/UI: **15/15**
- Runtime/network: **15/15**
- Unit regression contracts: **9/9**
- Backend end-to-end: **20/20**
- Launch security: **20/20**
- Log redaction: **8/8**
- Release consistency: **11/11**
- Production cleanup: **17/17**
- Lockfile integrity: **17/17**
- Secret hygiene: **5/5**
- JavaScript syntax: **640/640**
- EJS validation: **133/133**
- Production architecture: **7,153/7,153**
- Complete `check:go-live`: passed

Dependency-backed `npm test` and `npm audit` should still be run locally after `npm ci` on the extracted archive.
