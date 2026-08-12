# Classic Trip v1.6.51 — Final Media / Cloudinary / PDFKit Audit

## Scope

This release addresses two launch defects: the deprecated `jpeg-exif@1.1.4` install warning and unreliable image rendering across blogs, bus/operator listings and other public media surfaces.

## Dependency correction

- `pdfkit` is now `^0.19.1`.
- The lockfile resolves PDFKit 0.19.1.
- `jpeg-exif` is absent from `package.json` and `package-lock.json`.
- The obsolete PDFKit-only `crypto-js` lock entry is removed.
- Lockfile reachability/integrity passes 17/17 checks.

## Media architecture

1. Partner/admin uploads continue through `src/services/media/uploadService.js` and Cloudinary when configured.
2. Public image selection uses `src/utils/mediaUrl.js`, preferring `secureUrl`, then a valid `url`, then later candidates.
3. Seven bundled launch blog images have stable `/media/blog/:slug` routes.
4. Six bundled launch bus/operator images have stable `/media/operator/:key` routes.
5. Stable media routes are same-origin, no-store/no-cache and not service-worker precached.
6. Blog Create/Edit accepts validated JPEG/PNG/WebP uploads and stores the returned Cloudinary media metadata.
7. `migrate:seeded-media` can move existing bundled launch media to Cloudinary without overwriting custom media.
8. `doctor:media` reports configuration and bundled assets without exposing credentials; `doctor:media:db` additionally inspects persisted seeded records.

## Public rendering audited

- Homepage listing cards
- Listing card partial and listing detail page
- Saved listings
- Marketplace catalog projections
- Company directory logos/covers
- Company public profile
- Blog homepage cards, directory and article pages
- Seeded operator/bus listing media

## Regression results

- v1.6.51 media/Cloudinary/PDFKit: 18/18
- v1.6.50 Create/Edit parity: 21/21
- v1.6.49 edit/activation: 22/22
- v1.6.45 blog images: 8/8
- v1.6.44 homepage/blog/bus/departures: 16/16
- v1.6.43 blog/partner accounts: 13/13
- lockfile integrity: 17/17
- final release consistency: 11/11
- dashboard completeness: 52/52
- Bus form contracts: 45/45
- production readiness: 76/76
- JavaScript syntax: 638/638
- EJS syntax: 131/131
- route security passed
- multipart CSRF: 44/44
- browser CSRF: 4/4
- architecture/security passed

## Runtime validation note

The artifact container could not complete a fresh `npm ci` because the container execution layer terminated npm installation attempts. The source tree and lockfile were therefore validated with dependency-free syntax, lockfile reachability/integrity and release gates. Run `npm ci` on the target machine before launch; the v1.6.51 lockfile contains no `jpeg-exif` entry.

## Existing database sequence

```bash
npm ci
npm run check:v1651-media-cloudinary-pdfkit
npm run seed:launch-content
npm run doctor:media
npm start
```

If Cloudinary is configured and the launch seed media should also live in Cloudinary:

```bash
npm run migrate:seeded-media:dry
npm run migrate:seeded-media
npm run doctor:media:db
```
