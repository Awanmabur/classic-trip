# Bus/Hotel Page Balance, Modal Detail, and Field Fix

This pass fixes dashboard usability before continuing feature expansion.

## Fixed

- Sidebar labels now wrap instead of being cut off, so long items such as Passenger Manifests show fully.
- Shared dashboard modals are wider and use balanced grid density.
- View modals no longer dump raw backend data or show too little information.
- View modal details now use:
  - curated core fields,
  - supplemental operational/status/date/commercial/policy fields,
  - a capped fallback layout for records without curated mappings.
- Creation and edit forms now use proper select/multi-select controls for values that should come from existing data.

## Improved form inputs

- Route boarding/drop-off points use existing branches/terminals as multi-selects.
- Route operating days use multi-selects.
- Vehicle amenities use multi-selects.
- Vehicle compliance/maintenance notes were added.
- Schedule boarding start time, fare class, status, driver, and blocked seats are selectable where data exists.
- Hotel amenities use multi-selects.
- Hotel country is selectable.
- Hotel room type includes bed type, amenities, policies, capacity, base price, and inventory fields.
- Booking seat/room selection continues to use selectable seats/room units where available.

## Rules preserved

- Same shared admin dashboard shell.
- Company Admin remains scoped by companyType.
- Bus companies do not see hotel actions.
- Hotel companies do not see bus actions.
- Logout remains a POST action, not a page.
