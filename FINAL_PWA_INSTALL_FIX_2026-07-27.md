# Classic Trip PWA Installation Fix — 27 July 2026

## Root causes corrected

1. Phone access through `http://<computer-ip>:5000` is not a secure browser context. Mobile browsers block service workers and native PWA installation on that address.
2. The previous install card waited for `beforeinstallprompt`, which some browsers delay or do not expose.
3. A dismissed prompt was hidden for seven days.
4. When the native install event arrived after a fallback card had opened, the visible card did not update to the native Install state.
5. The service worker and manifest could be cached for one day by the general static-file policy.
6. Several standalone authentication pages did not load the PWA manifest, installer script and scoped installer styles.

## Implemented corrections

- The install card now appears even before the native browser event.
- Native Android/Chromium installation is used as soon as `beforeinstallprompt` becomes available.
- iPhone/iPad users receive Safari Add to Home Screen instructions.
- Android browsers without a native event receive browser-menu installation steps.
- Insecure local-network HTTP access shows an explicit HTTPS requirement instead of failing silently.
- The Profile-menu install action always reopens the installer and clears an earlier dismissal.
- Dismissal is limited to 24 hours instead of seven days.
- The visible card updates when browser installability changes.
- Service-worker registration uses `updateViaCache: none`.
- `/sw.js` is served with `Service-Worker-Allowed: /` and no-cache headers.
- `/site.webmanifest` is served with the correct manifest MIME type and no-cache headers.
- The service-worker cache was bumped to `classic-trip-static-v1.2.3`.
- A dedicated scoped `/css/pwa.css` is loaded on public, dashboard and authentication pages.
- Maskable icons remain padded so the Classic Trip logo is not cropped.

## Important mobile development rule

A phone cannot install the PWA when it opens the computer through a normal HTTP LAN address such as:

`http://192.168.x.x:5000`

Use one of these instead:

- the production HTTPS domain;
- a trusted HTTPS development tunnel;
- localhost on the same device where the browser is running.

The application now explains this inside the install card.

## Verification

- PWA installation audit: 44/44
- Mobile navigation and PWA: 18/18
- Mobile button/statistics: 10/10
- Reference UI: 174/174
- Final regression: 42/42
- JavaScript syntax: 520/520
- EJS templates: 126/126
