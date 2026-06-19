# Hotel Room Calendar and Stay Operations Pass

This pass continues the hotel dashboard implementation after bus production hardening.

## Implemented

- Added a visual hotel room-night calendar in the Hotel Rooms dashboard page.
- Added calendar controls for search, status, start date, and date-window size.
- Added a room-night status legend for available, held/reserved, booked/occupied, cleaning, maintenance, and checked-out states.
- Calendar rows are grouped by room unit and columns are date nights.
- Calendar cells open the existing view modal with room-night details.
- Missing room-night cells open the room-night inventory creation modal.
- Added operational summary cards for arrivals, in-house stays, and housekeeping queue.
- Improved hotel check-in/check-out logic so room-night rows and room units are updated together.
- Guest check-in moves room unit status to occupied.
- Guest check-out moves room unit status to cleaning and housekeeping status to dirty.
- Persisted affected room-night and room-unit updates when MongoDB is connected.
- Added dashboard validation coverage for the room calendar and stay state updates.

## Still next

- Add drag/bulk room-night selection on the calendar.
- Add dedicated housekeeping task board with assigned staff and task state.
- Add stay settlement release after check-out/completion.
- Add stronger hotel revenue and statement drilldowns.
