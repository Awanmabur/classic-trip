# Classic Trip v1.6.11 Release Notes

## Speed root repair

- Public catalog pages no longer hydrate every compatibility Seat record or future RoomNightInventory record before rendering.
- Listing/catalog snapshots remain warm longer and refresh in the background.
- Identical current-fare/seat-availability requests are deduplicated and cached briefly.
- Preview controllers reuse already-loaded listing and departure records for live inventory reads.
- Dashboard independent database reads now run concurrently.
- Dashboard snapshots and projections remain warm longer during normal navigation.
- Local development static assets use a short browser cache instead of being refetched on every page.
- Rolling-departure batches pause longer so interactive requests receive priority.

## Mobile navigation

- Phone bottom navigation has a 34px outer radius and 22px item radius.
- Five equal navigation columns, shared page width, safe-area spacing, and floating-dock behavior are preserved.

## Compatibility

- Built on the safer v1.6.10/v1.6.7 repair line.
- No model migration or index rebuild is required.
- Service-worker cache version: `classic-trip-static-v1.6.11`.

See `SPEED_ROOT_REPAIR_ROUNDED_BOTTOM_NAV_REPORT_v1.6.11.md` for the full technical report and verification results.
