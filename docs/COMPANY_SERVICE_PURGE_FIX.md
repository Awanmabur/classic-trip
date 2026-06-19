# Company Service Purge Fix

This pass enforces the rule that one company account can operate only one service category in its company dashboard.

## Fixed

- Bus company dashboards no longer receive a mixed Bus + Hotel service profile because `persistentStore.buildCompanyServiceProfile()` now locks the dashboard to `company.companyType` first.
- Company Admin pages now render service-specific content, not only service-specific sidebar items.
- Bus companies no longer see hotel-only controls such as Add Room, Hotel Rooms, Room Types, Room Units, Room Night Inventory, Room Visual Map, and Hotel Manifests.
- Hotel companies no longer see bus-only controls such as Driver Requests, Seat Maps, Bus Routes/Seats tabs, and Bus Manifests.
- Super Admin remains the only role that can view all service dashboards.

## Rule

Company Admin dashboard behavior is now:

- `companyType: bus` -> bus inventory, routes, vehicles, seat maps, schedules, passenger manifests, ticket check-ins, bus revenue, bus settlement.
- `companyType: hotel` -> properties, room types, room units, room-night inventory, guest manifests, hotel check-ins, hotel revenue, hotel settlement.
- Other company types follow their own primary service profile.

The existing Super Admin dashboard shell is still reused. Only content, menus, data, and actions are filtered.
