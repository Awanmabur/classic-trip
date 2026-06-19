# Bus dashboard layout reorganization fix

This pass restores organization after the previous modal/page-balance changes made the Bus Company dashboard feel cluttered.

## Fixed

- Restored clean sidebar spacing and grouping while still allowing long labels to wrap.
- Kept `Passenger Manifests` readable in the aside without cropping.
- Rebuilt the Passenger Manifests dashboard section as a full-width operational page for bus companies.
- Added manifest summary cards for schedules, booked seats, held seats, and print-ready manifests.
- Rebuilt the Seat Maps dashboard section into a clear two-part layout: summary/table first, visual seat preview second.
- Seat Maps now use `dashboardData.seatMaps` instead of generic inventory rows.
- Manifest rows now include proper row metadata so row-click view modals show manifest-specific details.
- Added curated modal detail groups for `seat_map` and `manifest` records.
- Updated dashboard validation to recognize the restored v17 organized sidebar fix.

## Preserved

- Same shared Super Admin dashboard shell.
- Same role/service scoping.
- Same Company Admin companyType lock.
- Logout remains a POST action.
- Bus companies do not see hotel features.
- Hotel companies do not see bus features.
