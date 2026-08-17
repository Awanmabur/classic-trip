# Classic Trip v1.6.87

Google crawl/indexing readiness release.

- Makes `/buses`, `/stays`, `/airbnb`, `/tours`, `/car-rentals` and `/cargo` anonymous read-only/cacheable discovery pages.
- Serves robots and sitemap endpoints before session/CSRF middleware.
- Permanently redirects legacy `/companies/bebeto-coaches` to `/companies/bebeto-coach-services`.
- Preserves intentional login `noindex`, canonical host redirects, structured data, canonicals and sitemap inventory.
- Keeps CSRF protection on Flights, Taxi, Support and booking/listing flows that submit protected actions.
- Preserves all v1.6.86 dashboard/availability improvements and v1.6.85 amenity/notification fixes.
