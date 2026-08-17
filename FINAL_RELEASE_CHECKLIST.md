# Classic Trip v1.6.87 — Release Checklist

1. Preserve your local `.env` and `.git`, then extract v1.6.87 over the source tree.
2. Run `npm ci`.
3. Run `npm test`; target: **115/115 or higher, 0 failures**.
4. Run `npm audit --omit=dev --audit-level=moderate` and confirm zero launch-blocking vulnerabilities.
5. Run `npm run check:seo` and confirm **22/22**.
6. Run `npm run check:public-performance` and confirm **21/21**.
7. Run `npm run check:public-layout-content` and confirm **22/22**.
8. Run `npm run check:go-live`.
9. Run `npm run check` and `npm run check:production`.
10. Deploy to Render and confirm `/robots.txt`, `/sitemap.xml`, `/sitemaps/static.xml`, `/buses`, `/blogs`, one company profile and one listing return normally.
11. Confirm `/companies/bebeto-coaches` permanently redirects to `/companies/bebeto-coach-services`.
12. In Search Console, resubmit `https://www.classictrip.org/sitemap.xml`.
13. Use URL Inspection → Test live URL on `/`, `/buses`, `/blogs`, one blog article, one company profile and one bus listing.
14. Request indexing only for the representative high-value public URLs whose live tests succeed.
15. Leave `/login?role=partner` as `noindex` and leave HTTP/non-www canonical redirects unchanged.
16. Monitor Page Indexing and Crawl Stats until important URLs receive an actual crawl date; indexing is ultimately controlled by Google.
17. Rotate and purge the historical MongoDB credential from Git history if that separate repository-security action is still outstanding.
