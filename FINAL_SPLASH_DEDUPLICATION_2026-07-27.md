# Classic Trip 1.2.8 — Single Native Splash Report

## Correction

The installed PWA previously displayed two launch layers: the browser/operating-system native splash, followed by a JavaScript splash rendered by the application. The JavaScript splash has been removed completely.

Classic Trip now uses one native installed-app splash only. The manifest keeps the clean home-screen label `Classic Trip` and uses the full installed-app name `Classic Trip — Move, stay and fly with confidence.` so supported browsers can present the brand and slogan with the app icon.

## Preserved behaviour

- PWA installation prompt and manual installation guidance remain available.
- Portrait orientation remains enforced for installed-app launches.
- Approved UI, mobile navigation, Stays & Homes, Bus, Flight Agents and Local Mobility remain unchanged.
- Private pages remain excluded from static service-worker caching.

## Verification

Run:

```bash
npm run check:single-splash
npm run check:mobile-pwa
npm run check:pwa-install
npm run verify
```
