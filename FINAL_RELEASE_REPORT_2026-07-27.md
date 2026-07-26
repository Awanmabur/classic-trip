# Classic Trip 1.2.7 — Final Marketing Responsiveness Report

## Result

Public marketing pages now remain contained at narrow phone widths without changing the approved Classic Trip visual design. The Partner Commission CTA and other long action groups no longer overflow their cards.

## Pages audited and corrected

- Partner Commission
- Partners directory
- Services
- How It Works
- Promoters
- Routes
- Support / Contact
- Privacy and Terms
- Blogs and guide pages
- Public partner profiles

## Responsive behaviour

- CTA buttons wrap their labels and use automatic height.
- Phone action groups become one safe column where two long controls cannot fit.
- Section headers place actions beneath copy before horizontal overflow can occur.
- Badges and long service labels wrap within the card.
- Marketing grids use one content column on phones.
- Metric cards remain two per row on phones.
- Route rows, partner cards and public service cards keep `min-width: 0` containment.
- The footer becomes one column below 420px.
- No fixed positioning, viewport-width containers or global redesign selectors were introduced.

## PWA delivery

`marketing-responsive.css` is included in the versioned static cache. The service-worker cache is now `classic-trip-static-v1.2.7`, ensuring installed apps receive the corrected marketing styles after activation.

## Verification completed

- Marketing mobile overflow: 27/27
- Stays & Homes: 23/23
- JavaScript syntax: 523/523
- EJS templates: 126/126
- Reference UI: 174/174
- PWA installation: 44/44
- Mobile PWA: 18/18
- Orientation: 8/8
- System completion: 157/157
- Production readiness: 73/73
- Platform polish: 18/18
- Dashboard service coverage: 68/68
- Flight Agent and Local Mobility: 110/110
- Production architecture: 6610/6610
- Bus/Stay end-to-end: 57/57
- Bus/Stay architecture: 95/95
- Stay operations: 27/27
- CSRF: 44/44
- UI consistency: 16/16
- Final regression: 42/42

Dependency-backed Jest, live MongoDB transactions and external provider integrations still require the connected staging environment.
