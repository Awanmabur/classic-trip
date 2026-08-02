# Classic Trip 1.4.7 — Top-Gap Fill, Opaque Travel Surfaces and Stable Service Tabs

Release date: 2 August 2026

## Changes in this release

Only the three requested areas were changed:

1. Top navigation gap
   - The 12 px spacing remains.
   - The spacing is now body padding, so the page's own background paints it instead of exposing a black or empty strip.
   - Installed PWAs also include the device safe-area inset.

2. Dark-mode travel and PWA containers
   - Flight and Local Taxi hero cards, booking panels, controls, offers, maps, suggestions and related nested containers use opaque dark surfaces.
   - The PWA installation popup, close button and instruction box use opaque dark surfaces.
   - Light-mode surfaces and unrelated platform pages are unchanged.

3. Stable service selector
   - Selecting Bus, Stays, Flights, Local taxi, Tours, Car rental or Cargo still displays that service's real input panel.
   - Automatic `scrollIntoView()` was removed, so clicking a service no longer shifts the hero container or its content left/right.
   - Horizontal tab swiping remains native and contained inside the tab row.

## Verification

- Surface stability checks: 11/11
- Authentication and service-search checks: 22/22
- JavaScript syntax: 558/558
- EJS templates: 128/128
- PWA checks: 42/42
- Flight and Local Taxi workflow checks: 110/110
- Reference UI integrity: 179/179
- Production architecture: 6,774/6,774
- Production finalization: 29/29
- Final regression: 42/42
- Release cleanup: 23/23

Run the dependency-backed checks after `npm ci`:

```bash
npm run release:check
npm start
```
