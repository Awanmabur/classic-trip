const SERVICE_DASHBOARDS = [
  {
    key: 'bus-dashboard', label: 'Bus Dashboard', serviceType: 'bus', icon: 'fa-bus-simple', status: 'core live',
    overview: 'Bus operators manage terminals, routes, stops, vehicles, seat maps, schedules, fares, manifests, check-ins, incidents, and bus settlement from one service dashboard.',
    features: [
      'Terminal, branch, pickup, drop-off, and stop management',
      'Route creation with stops, baggage/cancellation policy, distance, duration, and active state',
      'Vehicle and compliance document management with plate, capacity, amenities, maintenance, and driver assignment',
      'Visual seat-map builder with available, held, booked, checked-in, no-show, cancelled, refunded, blocked, maintenance, reserved, and disabled states',
      'Schedule and fare publishing with company verification, active route, active vehicle, valid seat map, valid driver, price, and policy checks',
      'One-way, round-trip, multi-city, and group booking visibility',
      'Passenger manifest, printable list, CSV/Excel/PDF export, and driver/employee signature fields',
      'QR/manual check-in, duplicate scan protection, no-show, trip status, delay notice, and incident escalation',
      'Revenue, company earning, promoter commission, refunds, settlement, payout request, and route performance reports'
    ],
    modules: ['Terminals', 'Routes', 'Stops', 'Vehicles', 'Seat maps', 'Schedules', 'Fares', 'Manifests', 'Check-ins', 'Incidents', 'Settlement']
  },
  {
    key: 'hotel-dashboard', label: 'Hotel Dashboard', serviceType: 'hotel', icon: 'fa-hotel', status: 'core live',
    overview: 'Hotel partners manage properties, room types, room units, room-night inventory, pricing, availability, arrivals, in-house guests, departures, check-in/out, and hotel settlement.',
    features: [
      'Property profile, location, images, amenities, policies, tax/fees, and check-in/out times',
      'Room type and room unit management with capacity, nightly price, amenities, media, housekeeping, and maintenance state',
      'Room-night inventory calendar with available, held, booked, occupied, checked-out, maintenance, cleaning, reserved, cancelled, and refunded states',
      'Seasonal pricing, availability, room hold expiry, multi-room booking, guest details, voucher/QR, receipt, and invoice flow',
      'Arrival, departure, and in-house manifests with printable/PDF/CSV exports',
      'Hotel check-in/check-out, stay completion, support, refunds/reschedules, review replies, and settlement release rules'
    ],
    modules: ['Properties', 'Room types', 'Room units', 'Night inventory', 'Pricing', 'Arrivals', 'In-house', 'Departures', 'Housekeeping', 'Settlement']
  },
  {
    key: 'flight-dashboard', label: 'Flight Dashboard', serviceType: 'flight', icon: 'fa-plane', status: 'feature flagged',
    overview: 'Flights stay as teaser/read-only until provider integration is complete, then reuse provider admission, search, booking, payment, ticketing, refund, and support logic.',
    features: [
      'Airline/aggregator/provider approval by Super Admin',
      'Airport, airline, flight offer, segment, baggage, ancillary, and PNR/reference records',
      'Search by origin, destination, date, passengers, cabin, baggage, price, and provider',
      'Passenger details, baggage/add-ons, booking hold, provider confirmation, payment, receipt, notification, and support timeline',
      'Change/cancellation/refund workflow controlled by provider rules and support audit trail',
      'Feature flag prevents broken checkout until provider integration, webhook, and ticketing are complete'
    ],
    modules: ['Airports', 'Airlines', 'Offers', 'Segments', 'Baggage', 'Ancillaries', 'PNR', 'Refunds']
  },
  {
    key: 'train-dashboard', label: 'Train Dashboard', serviceType: 'train', icon: 'fa-train', status: 'feature flagged',
    overview: 'Train services reuse route, coach, seat, schedule, ticket, boarding QR, manifest, check-in, and settlement standards.',
    features: ['Station and route setup', 'Coach and seat map management', 'Schedule and fare publishing', 'Coach/seat availability holds', 'Ticket and boarding QR', 'Passenger manifest and check-in', 'No-show/refund/settlement reporting'],
    modules: ['Stations', 'Routes', 'Coaches', 'Seats', 'Schedules', 'Tickets', 'Boarding', 'Manifest']
  },
  {
    key: 'tour-dashboard', label: 'Tour Dashboard', serviceType: 'tour', icon: 'fa-map-location-dot', status: 'feature flagged',
    overview: 'Tour providers manage packages, tour dates, capacity, guides, pickup points, participants, vouchers, check-ins, completion, and settlement.',
    features: ['Package profile and media', 'Tour date and capacity inventory', 'Guide and pickup point assignment', 'Participant details', 'Voucher/QR issue', 'Tour check-in and completion', 'Refund/support/commission release'],
    modules: ['Packages', 'Dates', 'Capacity', 'Guides', 'Participants', 'Vouchers', 'Check-ins']
  },
  {
    key: 'car-rental-dashboard', label: 'Car Rental Dashboard', serviceType: 'car_rental', icon: 'fa-car', status: 'feature flagged',
    overview: 'Car rental partners manage rental vehicles, locations, availability calendars, driver/self-drive rules, documents, deposits, pickup/return inspection, damages, and settlement.',
    features: ['Rental fleet and location setup', 'Availability calendar', 'Driver/self-drive options', 'Customer documents and deposit tracking', 'Pickup and return workflow', 'Inspection and damages records', 'Rental completion and payout release'],
    modules: ['Vehicles', 'Locations', 'Availability', 'Documents', 'Deposits', 'Inspection', 'Damages']
  },
  {
    key: 'event-dashboard', label: 'Events Dashboard', serviceType: 'event', icon: 'fa-calendar-check', status: 'feature flagged',
    overview: 'Event organizers manage venues, event dates, ticket tiers, seat maps/general admission, QR entry, promoter links, capacity, refunds, and settlement.',
    features: ['Venue and event profile', 'Ticket tiers and pricing', 'Seat map or general admission capacity', 'QR entry scanner', 'Promoter attribution', 'Refund/cancellation rules', 'Organizer payout reporting'],
    modules: ['Venues', 'Events', 'Ticket tiers', 'Seat maps', 'QR entry', 'Promoters', 'Settlement']
  },
  {
    key: 'cargo-dashboard', label: 'Cargo Dashboard', serviceType: 'cargo', icon: 'fa-boxes-stacked', status: 'feature flagged',
    overview: 'Cargo providers manage shipments, sender/receiver records, routes, waybills, tracking, payment, delivery proof, support, and settlement.',
    features: ['Shipment creation', 'Sender and receiver details', 'Route and waybill assignment', 'Tracking updates', 'Payment and receipt', 'Delivery proof', 'Claims/support and settlement'],
    modules: ['Shipments', 'Waybills', 'Tracking', 'Payments', 'Delivery proof', 'Claims']
  },
  {
    key: 'insurance-dashboard', label: 'Insurance Dashboard', serviceType: 'insurance', icon: 'fa-shield-heart', status: 'feature flagged',
    overview: 'Insurance add-ons manage policies, coverage, premium, beneficiary, claim instructions, booking attachment, settlement, and reports.',
    features: ['Policy product setup', 'Coverage and premium rules', 'Beneficiary capture', 'Attach insurance to booking', 'Claim instructions', 'Provider settlement and reports'],
    modules: ['Policies', 'Coverage', 'Premiums', 'Beneficiaries', 'Claims', 'Reports']
  },
  {
    key: 'corporate-dashboard', label: 'Corporate Travel Dashboard', serviceType: 'corporate', icon: 'fa-briefcase', status: 'feature flagged',
    overview: 'Corporate travel accounts manage employee travelers, travel policies, approval workflow, monthly invoices, statements, and corporate settlement.',
    features: ['Corporate account setup', 'Employee travelers', 'Travel policy rules', 'Approval requests', 'Monthly invoices', 'Statements', 'Corporate reports'],
    modules: ['Accounts', 'Travelers', 'Policies', 'Approvals', 'Invoices', 'Statements']
  },
  {
    key: 'loyalty-dashboard', label: 'Loyalty Dashboard', serviceType: 'loyalty', icon: 'fa-gift', status: 'feature flagged',
    overview: 'Loyalty manages points, wallet credits, coupons, tiers, referral rewards, redemption rules, fraud controls, and customer engagement reports.',
    features: ['Points accounts', 'Wallet credits', 'Coupons and promo codes', 'Loyalty tiers', 'Referral rewards', 'Redemption rules', 'Fraud controls and reports'],
    modules: ['Points', 'Credits', 'Coupons', 'Tiers', 'Referrals', 'Redemptions']
  }
];

const ROLE_DASHBOARD_FEATURES = {
  admin: {
    label: 'Super Admin',
    features: ['Lead/session/agreement pipeline', 'Secure provider invitations', 'Company/driver/provider verification', 'All service dashboards', 'Bookings and inventory monitoring', 'Payments, ledger, settlements, payouts, refunds', 'Promoters/agents and sponsored listings', 'Support, disputes, fraud/risk, reports, settings, and audit logs']
  },
  company: {
    label: 'Company Admin',
    features: ['Company profile, branches, policies, and payout identity', 'One company account is locked to one companyType/service category', 'Bus companies see only bus operations; hotel companies see only hotel operations; every other provider sees only its own service modules', 'All bookings, inventory, manifests, check-ins, support, reviews, revenue, settlement, and reports are scoped to companyId and companyType']
  },
  employee: {
    label: 'Company Employee',
    features: ['Assigned schedules and check-in scanner', 'Ticket lookup and manual check-in', 'Customer list, manifests, seat/room map, support notes, handover, and reports within assigned company/branch/permission scope']
  },
  driver: {
    label: 'Driver',
    features: ['Assigned trips only', 'Route, vehicle, stops, passenger manifest, seat map, check-in support, incidents, delay/cancel escalation, trip status, and messages']
  },
  customer: {
    label: 'Customer',
    features: ['Upcoming trips/stays', 'Past bookings', 'Tickets and QR codes', 'Receipts/invoices', 'Refunds/reschedules', 'Support messages', 'Saved passengers/listings', 'Reviews, loyalty, wallet, profile, and security']
  },
  promoter: {
    label: 'Promoter / Agent',
    features: ['Referral links/codes', 'QR referral cards', 'Campaigns', 'Clicks/conversions/bookings', 'Pending/available commission', 'Withdrawals', 'Offline sales', 'Traffic/fraud review, reports, and support']
  },
  support: {
    label: 'Support',
    features: ['Assigned cases', 'Booking/ticket lookup', 'Customer-visible messages', 'Internal notes', 'Refunds/reschedules', 'Escalations', 'Delivery attempts, handover, and support reports']
  },
  finance: {
    label: 'Finance',
    features: ['Payments', 'Payment webhooks/idempotency', 'Ledger', 'Commission records', 'Wallets', 'Refund debits', 'Settlement batches', 'Payout requests/batches', 'Reconciliation, statements, and finance risk review']
  },
  operations: {
    label: 'Operations',
    features: ['Daily schedule control', 'Availability', 'Manifests', 'Check-ins', 'No-shows', 'Driver operations', 'Incidents', 'Support escalations, completion rules, and operational reports']
  }
};

function featureDashboardFor(page) {
  return SERVICE_DASHBOARDS.find((item) => item.key === page || item.serviceType === page) || null;
}

module.exports = { SERVICE_DASHBOARDS, ROLE_DASHBOARD_FEATURES, featureDashboardFor };
