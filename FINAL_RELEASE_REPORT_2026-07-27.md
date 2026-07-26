# Classic Trip 1.2.1 — Final Mobile Navigation and Install Report

## Scope

This release preserves the approved Classic Trip UI and completes the requested phone navigation and installable-app behaviour without changing the existing page composition, cards, colours, banners, forms or dashboard structure.

## Completed work

### Phone navigation

- Bottom navigation hides during active scrolling and returns after 650 ms of scroll inactivity.
- Bottom navigation hides while the phone keyboard/form focus is active.
- Opening the Profile drawer hides the bottom navigation.
- Drawers include safe-area bottom padding and scroll padding, keeping the last action visible.
- The top phone Tickets action is removed; Tickets remains available through the bottom bar and menu.

### Authentication and public actions

- The home-page Start button opens `/login`.
- Anonymous drawer users receive **Sign in to start**.
- Login, Signup and Partner remain in one clean three-column row on phones.
- The duplicate authentication `<main>` opening was removed.
- Blue and primary buttons retain readable text on hover, focus and active states.
- Public, authentication and dashboard stat/KPI grids remain two per row on phones.

### Installable app

- Added service-worker registration on public, authentication and dashboard shells.
- Added an eligibility-aware install prompt with logo, name, slogan, Install and Not now actions.
- Added iOS Add to Home Screen guidance.
- Added an Install Classic Trip action to available profile/menu drawers.
- Added a brief session-only installed-app launch splash.
- Added separate `any` and padded `maskable` icons plus an Apple touch icon.
- Added manifest shortcuts for Search, My bookings and Local taxi.
- Static assets use versioned stale-while-revalidate caching.
- Private HTML, account, booking, payment and dashboard responses are not cached by the service worker.

## Verification completed

- JavaScript syntax: 518/518
- EJS templates: 126/126
- Mobile navigation/PWA release gate: 18/18
- Reference UI merge: 174/174
- Spacing, stacking and flash: 19/19
- Final Super Admin/flash/copy audit: 20/20
- Production finalisation: 30/30
- System completion: 157/157
- Production readiness: 73/73
- Platform polish: 18/18
- Platform layout/Admin: 18/18
- Dashboard service coverage: 68/68
- Flight Agent/Local Mobility: 110/110
- Production architecture: 6610/6610
- Bus workflow: 28/28
- Bus forms: 45/45
- Smart Bus forms: 30/30
- Smart publishing: 19/19
- Driver assignment: 15/15
- Driver UI/accessibility: 23/23
- Driver materialisation: 5/5
- Staff/driver workflow: 50/50
- Partner ownership: 19/19
- Route security, CSRF, tenant/entity relationships and dashboard smoke checks: passed
- Bus/Hotel end-to-end: 57/57
- Bus/Hotel architecture: 95/95
- Hotel operations: 27/27
- Final UI consistency: 16/16
- Final regression: 42/42

## Connected-environment requirement

Dependency installation was unavailable in the artifact environment. Before production deployment, run the complete commands below and test real MongoDB transactions, payments/refunds, flight suppliers, routing/GPS, messaging, real devices, load, DAST and independent penetration testing.
