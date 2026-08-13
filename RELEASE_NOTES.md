# Classic Trip v1.6.68 — Production Final

## Marketplace cards and bars

- Every Home marketplace service section now starts with **6 cards** in Card view.
- Bar view remains intentionally compact at **4 bars**.
- Card and Bar visible counts are independent, so switching views does not carry a 6-card count into Bar view.
- Every live marketplace section keeps its **More** action at the bottom-right; promoted services and blogs use the same placement.
- Existing v1.6.62/v1.6.65 badge sizing, booking URL cleanup, Redis recovery and public-discovery speed architecture are preserved.

## Country-route filtering

- Home Country routes now performs a real bus filter rather than only highlighting a card.
- A company matches when **any published route** in its route list matches the selected corridor.
- Reverse pairs such as Uganda ⇄ Kenya and Kenya ⇄ Uganda are normalized as the same corridor.
- `/search?serviceType=bus&corridor=...` now applies the same server-side corridor filtering.

## Bus amenities from Vehicles & Seat Templates

- Public bus amenities now come from the unique amenities on vehicles actually assigned to live/published departures for that listing.
- Duplicate amenity labels are removed before rendering.
- Public discovery reads only the projected vehicle fields `id`, `listingId`, `amenities`, and `status`; it does not load seat maps, seat rows, registration data, room units or room nights.
- Existing dashboard mutation invalidation refreshes the marketplace cache after vehicle edits.

## Public UI cleanup

- Removed the noisy/shaded global texture and decorative page background from public marketplace/marketing surfaces.
- The listing-preview context line (partner · route · departure) now spans the full preview width, including on phone screens.
- Home no longer ships a separate duplicate footer. One canonical footer markup is shared by Home and normal public pages.
- Footer links are grouped under aligned **Explore**, **Bookings & account**, **Partners**, and **Help & legal** headings.
- Footer includes WhatsApp, email and phone icons, plus optional Facebook, Instagram, X, TikTok, YouTube and LinkedIn icons when official URLs are configured.

## Blog preview

- Blog hero media no longer uses a forced minimum height; the image is full container width and the media container follows the image/content height.
- Blog preview now loads **4 related guides** and displays them in a four-column desktop row with responsive 2-column/1-column fallbacks.

## Production notes

- Version: **1.6.68**
- No database migration or reseed is required.
- No dependency versions changed from v1.6.65.
- Optional footer profile variables are documented in `.env.example`.


## v1.6.68 corrections
- Keep listing preview Partner / Share / Close controls at the top-right opposite the service badge.
- Bound tall preview images without changing the approved sheet layout.
- Remove remaining public market-page haze/shadow wrappers.
- Make country-to-country bus filters resolve terminal countries for existing and new routes.
- Allow local `.env` during release checks while keeping it ignored and excluded from release archives.
## v1.6.68 — Blog preview sizing correction
- Restored the established desktop blog-preview split layout (copy left, image right).
- Removed the fixed/minimum desktop header height so the preview card height follows its content.
- Hero images are now cropped inside the media column and cannot make the preview taller than its content.
- Mobile keeps the established stacked layout with a bounded hero media height.
- The four-related-guides desktop row remains unchanged.

