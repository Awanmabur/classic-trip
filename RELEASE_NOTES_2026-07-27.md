# Release Notes — Classic Trip 1.2.1

## Final mobile navigation and PWA update

- Preserved the approved Classic Trip public, authentication and dashboard UI.
- Made the phone/tablet bottom navigation disappear during active scrolling and return after scrolling stops.
- Hid the bottom navigation while a form control is active so it does not compete with the phone keyboard.
- Hid the bottom navigation while the Profile drawer is open and added safe bottom spacing so the last drawer action remains visible.
- Changed the public **Start** action to open the Sign in page.
- Removed the top Tickets action on phones while retaining ticket access in the bottom navigation and Profile drawer.
- Kept Login, Signup and Partner in one three-column row on phones.
- Kept KPI/stat cards two per row on phones, including narrow dashboard and authentication layouts.
- Protected blue and primary button text colours on hover, focus and active states.
- Added an installable PWA experience for supported phones and computers.
- Added padded maskable icons and an Apple touch icon so the complete logo remains visible.
- Added a clean install prompt with the Classic Trip logo, name and slogan.
- Added a brief session-only splash when the installed app launches.
- Added versioned static-asset caching while excluding account, booking, payment and dashboard HTML from service-worker caches.
- Removed a duplicate `<main>` opening from the standalone authentication page.
- Added `npm run check:mobile-pwa` to the release verification chain.

See `FINAL_RELEASE_REPORT_2026-07-27.md` for verification results and deployment commands.
