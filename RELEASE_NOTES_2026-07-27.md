# Release Notes — Classic Trip 1.2.8

## Marketing-page mobile overflow correction

- Corrected the Partner Commission **Ready to join Classic Trip?** CTA so its buttons remain inside the card on phones.
- Added one scoped responsive contract for public marketing pages only. The approved Classic Trip UI, colours, cards and navigation remain unchanged.
- Applied the contract to Partner Commission, Partners, Services, How It Works, Promoters, Routes, Support, Privacy, Terms, Blogs and public partner profiles.
- Long CTA labels can wrap without being clipped by fixed button heights.
- Marketing action groups collapse safely before they exceed the card width.
- Long badges, headings, descriptions and route rows stay inside their containers.
- Marketing grids collapse to one column on phones while metric/stat cards remain two per row.
- The footer becomes one column only on very small phones, preventing long partner/support links from widening the page.
- Added `npm run check:marketing-mobile` with a permanent 27-point regression gate.
- Added the new stylesheet to the PWA static cache and bumped the service-worker cache to 1.2.8 so installed apps receive the correction.

## Retained platform capabilities

Stays & Homes, Bus, Flight Agents, Local Mobility, PWA installation, the single native splash, portrait orientation, mobile navigation, dashboards, security controls and the approved reference UI remain intact.

## Duplicate splash removed

- Removed the JavaScript launch splash that appeared after the phone/browser native PWA splash.
- Installed launches now show one native splash only.
- The manifest full name carries the Classic Trip name and slogan while the home-screen label remains `Classic Trip`.
- Updated the static cache to `classic-trip-static-v1.2.8`.
