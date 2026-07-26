# Classic Trip 1.2.5 — Installed-App Orientation Stability

## Change

The installed Classic Trip PWA now opens and remains in portrait-primary orientation on supported browsers.

- `site.webmanifest` now declares `portrait-primary` instead of `any`.
- The installed app uses the Screen Orientation API when available.
- The lock is re-applied when the app resumes or receives an orientation-change event.
- Unsupported browsers safely fall back to the manifest and the phone's system rotation setting.
- The normal website remains governed by the browser and operating system.
- The single Classic Trip splash screen remains unchanged.

## Verification

Run:

```bash
npm run check:orientation-lock
```
