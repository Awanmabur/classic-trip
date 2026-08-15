# Classic Trip v1.6.86

This release targets the company-dashboard and bus-availability latency observed in production on 15 August 2026.

- Removes broad Overview fallback from Setup Guide.
- Makes company Overview, Revenue, Reports and Manifests page-specific and lighter.
- Makes company Archive service-aware instead of scanning unrelated hotel/flight/taxi/bus collections.
- Adds a schedule/segment/seat compound index for live bus availability.
- Removes unnecessary Mongo sorting from the availability critical path.
- Preserves atomic live seat claims, secure holds, v1.6.85 amenity visibility, notification contrast and Pesapal handoff behavior.
