'use strict';

// Only service dashboards backed by complete production booking and inventory flows ship.
const SERVICE_DASHBOARDS = [
  {
    key: 'bus-dashboard',
    label: 'Bus Dashboard',
    serviceType: 'bus',
    icon: 'fa-bus-simple',
    status: 'production',
    overview: 'Manage terminals, routes, ordered stops, compliant vehicles, published seat-map versions, fares, dated departures, live inventory, manifests, check-ins, incidents, and settlement.',
    features: [
      'Terminal, branch, pickup, drop-off, and ordered stop management',
      'Canonical route, segment, vehicle, seat-map, fare, driver, and dated-departure relationships',
      'Versioned seat maps and persisted live departure inventory',
      'Strict publication readiness with a future published dated departure',
      'Passenger manifests, QR/manual check-in, no-show, trip status, and incident records',
      'Database-backed payments, refunds, commission, settlement, payout, support, and audit records',
    ],
    modules: ['Terminals', 'Routes', 'Stops', 'Vehicles', 'Seat maps', 'Fares', 'Departures', 'Manifests', 'Check-ins', 'Settlement'],
  },
  {
    key: 'hotel-dashboard',
    label: 'Hotel Dashboard',
    serviceType: 'hotel',
    icon: 'fa-hotel',
    status: 'production',
    overview: 'Manage properties, room types, room units, dated room-night inventory, bookings, arrivals, in-house guests, departures, housekeeping, and settlement.',
    features: [
      'Property, room type, room unit, policy, media, and compliance records',
      'Persisted room-night inventory with availability and maintenance states',
      'Server-authoritative pricing, booking, payment, receipt, and notification flows',
      'Arrival, in-house, departure, check-in, check-out, and housekeeping operations',
      'Database-backed refunds, support, reviews, settlement, payout, and reports',
    ],
    modules: ['Properties', 'Room types', 'Room units', 'Night inventory', 'Pricing', 'Arrivals', 'In-house', 'Departures', 'Housekeeping', 'Settlement'],
  },
];

const ROLE_DASHBOARD_FEATURES = {
  admin: {
    label: 'Super Admin',
    features: ['Company and driver verification', 'Bus and hotel operations oversight', 'Bookings and inventory monitoring', 'Payments, ledger, settlements, payouts, and refunds', 'Promoters, support, risk, reports, settings, and audit logs'],
  },
  company: {
    label: 'Company Admin',
    features: ['Company profile, branches, policies, contacts, and payout identity', 'One company account is locked to its approved service category', 'All operational records are scoped to companyId and the company service type'],
  },
  employee: {
    label: 'Company Employee',
    features: ['Assigned bookings, schedules, check-ins, customer support, payments, and handover records within explicit permissions'],
  },
  driver: {
    label: 'Driver',
    features: ['Assigned bus departures, route and stop details, manifests, check-in support, incidents, and trip status updates'],
  },
  customer: {
    label: 'Customer',
    features: ['Bookings, tickets, receipts, refund/reschedule requests, support messages, saved records, profile, and security'],
  },
  promoter: {
    label: 'Promoter / Agent',
    features: ['Referral links, tracked clicks, attributed bookings, commissions, withdrawals, offline sales, reports, and support'],
  },
  support: {
    label: 'Support',
    features: ['Assigned cases, booking lookup, correspondence, internal notes, refunds, reschedules, delivery attempts, escalation, and reports'],
  },
  finance: {
    label: 'Finance',
    features: ['Payments, verified provider callbacks, ledger, commission, wallets, refund debits, settlements, payouts, reconciliation, and statements'],
  },
  operations: {
    label: 'Operations',
    features: ['Dated departures, room-night availability, manifests, check-ins, no-shows, incidents, completion, and operational reports'],
  },
  content: {
    label: 'Content Admin',
    features: ['Listing content review, media moderation, campaigns, blog/SEO content, and content reports'],
  },
};

function featureDashboardFor(page) {
  return SERVICE_DASHBOARDS.find((item) => item.key === page || item.serviceType === page) || null;
}

module.exports = { SERVICE_DASHBOARDS, ROLE_DASHBOARD_FEATURES, featureDashboardFor };
