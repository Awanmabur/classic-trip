const mongoDashboardService = require('../dashboard/mongoDashboardService');
const securityService = require('../security/securityService');

// See manifestService.js's neutralizeFormula — same CSV formula-injection risk applies here,
// since these rows can include user-controlled fields (customer/passenger names, notes).
function neutralizeFormula(text) {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function escapeCsv(value) {
  const text = neutralizeFormula(String(value ?? ''));
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(headers, rows) {
  return [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');
}

async function dashboardRows(scope, type, context = {}) {
  if (type === 'loginAudits') return securityService.reportRowsLive('loginAudits');
  if (type === 'securityEvents') return securityService.reportRowsLive('securityEvents');
  if (type === 'deviceSessions') return securityService.reportRowsLive('deviceSessions');
  if (type === 'idempotencyKeyRecords') return securityService.reportRowsLive('idempotencyKeyRecords');
  const dashboard = await mongoDashboardService.roleDashboard(scope, context);
  return dashboard[type] || [];
}

const TYPE_ALIASES = {
  checkin: 'checkins',
  'check-in': 'checkins',
  sales: 'payments',
  finance: 'payouts',
  revenueDrilldown: 'revenueDrilldown',
  'revenue-drilldown': 'revenueDrilldown',
  settlementLedger: 'settlementLedger',
  'settlement-ledger': 'settlementLedger',
  settlementBatches: 'settlementBatches',
  'settlement-batches-company': 'settlementBatches',
  financeStatements: 'financeStatements',
  'finance-statements-company': 'financeStatements',
  handover: 'handovers',
  exception: 'refunds',
  exceptions: 'refunds',
  branch: 'branches',
  policy: 'policies',
  driver: 'drivers',
  'driver-assignment': 'driverAssignments',
  'driver-assignments': 'driverAssignments',
  'driver-incidents': 'driverIncidents',
  'trip-status': 'tripStatusUpdates',
  'trip-status-updates': 'tripStatusUpdates',
  'route-stop': 'routeStops',
  'route-stops': 'routeStops',
  'hotel-property': 'hotelProperties',
  'hotel-properties': 'hotelProperties',
  'room-type': 'roomTypes',
  'room-types': 'roomTypes',
  'room-unit': 'roomUnits',
  'room-units': 'roomUnits',
  'room-night': 'roomNightInventory',
  'room-nights': 'roomNightInventory',
  'room-night-inventory': 'roomNightInventory',
  'hotel-arrival': 'hotelArrivals',
  'hotel-arrivals': 'hotelArrivals',
  'hotel-departure': 'hotelDepartures',
  'hotel-departures': 'hotelDepartures',
  'hotel-in-house': 'hotelInHouse',
  'in-house-guests': 'hotelInHouse',
  cart: 'carts',
  carts: 'carts',
  'cart-checkout': 'cartCheckouts',
  'cart-checkouts': 'cartCheckouts',
  'checkout-attempts': 'cartCheckouts',
  'ticket-scan': 'ticketScans',
  'ticket-scans': 'ticketScans',
  'ticket-leg': 'ticketLegs',
  'ticket-legs': 'ticketLegs',
  correspondence: 'correspondence',
  messages: 'correspondence',
  'delivery-attempt': 'deliveryAttempts',
  'delivery-attempts': 'deliveryAttempts',
  timeline: 'timeline',
  'booking-timeline': 'timeline',
  reschedule: 'reschedules',
  reschedules: 'reschedules',
  'reschedule-requests': 'reschedules',
  'payment-intent': 'paymentIntents',
  'payment-intents': 'paymentIntents',
  'receipt-invoice': 'receiptInvoices',
  'receipt-invoices': 'receiptInvoices',
  'tax-fee': 'taxFees',
  'tax-fees': 'taxFees',
  'finance-statement': 'financeStatements',
  'finance-statements': 'financeStatements',
  'finance-risk': 'financeRisk',
  'risk-reviews': 'financeRisk',
  settlement: 'settlements',
  settlements: 'settlements',
  'settlement-batches': 'settlements',
  ledger: 'ledger',
  'wallet-ledger': 'ledger',
  'payout-request': 'payoutRequests',
  'payout-requests': 'payoutRequests',
  'payout-batch': 'payoutBatches',
  'payout-batches': 'payoutBatches',
  reconciliation: 'reconciliation',
  reconciliations: 'reconciliation',
  'referral-click': 'referralClicks',
  'referral-clicks': 'referralClicks',
  'attribution-session': 'attributionSessions',
  'attribution-sessions': 'attributionSessions',
  'campaign-conversion': 'campaignConversions',
  'campaign-conversions': 'campaignConversions',
  'agent-profile': 'agentProfiles',
  'agent-profiles': 'agentProfiles',
  'fraud-signal': 'fraudSignals',
  'fraud-signals': 'fraudSignals',
  'referral-card': 'referralCards',
  'referral-cards': 'referralCards',
  'agent-sale': 'agentSales',
  'agent-sales': 'agentSales',
  'offline-sale': 'offlineSales',
  'offline-sales': 'offlineSales',
  'login-audit': 'loginAudits',
  'login-audits': 'loginAudits',
  'security-event': 'securityEvents',
  'security-events': 'securityEvents',
  'device-session': 'deviceSessions',
  'device-sessions': 'deviceSessions',
  'idempotency-key': 'idempotencyKeyRecords',
  'idempotency-keys': 'idempotencyKeyRecords',
  'idempotency-records': 'idempotencyKeyRecords',
};

const HEADERS = {
  bookings: ['Booking', 'Service', 'Customer', 'Date', 'Status', 'Amount', 'Extra'],
  payments: ['Transaction', 'Booking', 'Customer paid', 'Company earning', 'Platform fee', 'Promoter', 'Status'],
  payouts: ['Transaction', 'Booking', 'Customer paid', 'Company earning', 'Platform fee', 'Promoter', 'Status'],
  revenueDrilldown: ['Transaction', 'Booking', 'Service', 'Gross', 'Company earning', 'Platform fee', 'Promoter commission', 'Refund debit', 'Net payable', 'Status'],
  settlementBatches: ['Batch', 'Period start', 'Period end', 'Gross', 'Payable', 'Rows', 'Status'],
  settlementLedger: ['Transaction', 'Reference', 'Type', 'Direction', 'Amount', 'Batch', 'Payout', 'Status'],
  listings: ['Listing', 'Type', 'Route or location', 'Inventory', 'Price from', 'Status'],
  routes: ['Route', 'Listing', 'Boarding points', 'Dropoff points', 'Corridor', 'Status'],
  routeStops: ['Route', 'Stop', 'Type', 'Order', 'Offset minutes', 'Status'],
  vehicles: ['Vehicle', 'Type', 'Plate or code', 'Seats', 'Layout', 'Status'],
  schedules: ['Schedule', 'Route', 'Time', 'Vehicle', 'Booked', 'Status'],
  inventory: ['Inventory', 'Linked listing', 'Total', 'Booked', 'Held', 'Blocked', 'Status'],
  refunds: ['Refund', 'Booking', 'Customer', 'Reason', 'Amount', 'Status'],
  promotions: ['Campaign', 'Listing', 'Placement', 'Budget', 'Clicks', 'Bookings', 'Status'],
  staff: ['Staff', 'Role', 'Branch', 'Permissions', 'Last login', 'Status'],
  branches: ['Branch', 'Type', 'Location', 'Services', 'Operating hours', 'Status'],
  policies: ['Policy', 'Type', 'Service', 'Visibility', 'Summary', 'Status'],
  drivers: ['Driver', 'License', 'Safety status', 'Permissions', 'Branch or fleet', 'Status'],
  'driver-assignments': ['Driver', 'Vehicle', 'Schedule', 'Assignment type', 'Safety status', 'Status'],
  driverAssignments: ['Driver', 'Vehicle', 'Schedule', 'Assignment type', 'Safety status', 'Status'],
  driverIncidents: ['Incident', 'Schedule or booking', 'Category', 'Severity', 'Title', 'Status'],
  tripStatusUpdates: ['Schedule', 'Status', 'Location', 'Note', 'Actor', 'Updated'],
  hotelProperties: ['Property', 'Listing', 'Location', 'Check-in / out', 'Amenities', 'Status'],
  roomTypes: ['Room type', 'Property', 'Capacity', 'Base price', 'Units', 'Status'],
  roomUnits: ['Room unit', 'Room type', 'Property', 'Floor / wing', 'Housekeeping', 'Status'],
  roomNightInventory: ['Date', 'Room unit', 'Room type', 'Status', 'Booking', 'Guest', 'Price'],
  hotelArrivals: ['Booking', 'Guest', 'Hotel', 'Rooms', 'Check-in', 'Check-out', 'Status'],
  hotelDepartures: ['Booking', 'Guest', 'Hotel', 'Rooms', 'Check-in', 'Check-out', 'Status'],
  hotelInHouse: ['Booking', 'Guest', 'Hotel', 'Rooms', 'Check-in', 'Check-out', 'Status'],
  carts: ['Cart', 'Items', 'Customer', 'Total', 'Booking', 'Status'],
  cartCheckouts: ['Attempt', 'Cart', 'Booking', 'Provider ref', 'Failure/payment', 'Status'],
  ticketScans: ['Scan', 'Booking', 'Ticket', 'Schedule', 'Type', 'Result', 'State', 'Scanned at', 'Actor', 'Location'],
  ticketLegs: ['Ticket', 'Booking', 'Passenger', 'Leg', 'Schedule', 'Seat/room', 'Status', 'Check-in', 'QR preview', 'Used at'],
  correspondence: ['Message', 'Linked item', 'Subject', 'Visibility', 'Channels', 'Status', 'Date'],
  deliveryAttempts: ['Attempt', 'Message/notification', 'Booking/reference', 'Channel', 'Status', 'Provider', 'Attempted'],
  timeline: ['Booking', 'Type', 'Event', 'Actor', 'Status', 'Date'],
  reschedules: ['Request', 'Booking', 'Preferred date/schedule', 'Reason', 'Status', 'Updated'],
  paymentIntents: ['Intent', 'Booking/cart', 'Provider', 'Amount', 'Status', 'Provider reference', 'Created'],
  receiptInvoices: ['Document', 'Type', 'Booking', 'Customer', 'Total', 'Status', 'Issued'],
  taxFees: ['Record', 'Booking', 'Subtotal', 'Service fee', 'Tax', 'Provider fee', 'Total fees', 'Status'],
  financeStatements: ['Statement', 'Owner', 'Period start', 'Period end', 'Gross', 'Closing balance', 'Status'],
  financeRisk: ['Review', 'Target', 'Owner', 'Amount', 'Risk score', 'Status', 'Flags'],
  settlements: ['Batch', 'Period start', 'Period end', 'Gross', 'Payable', 'Status'],
  ledger: ['Transaction', 'Owner', 'Type', 'Direction', 'Amount', 'Status'],
  payoutRequests: ['Request', 'Transaction', 'Owner', 'Amount', 'Method', 'Batch', 'Risk', 'Status'],
  payoutBatches: ['Batch', 'Provider reference', 'Requests', 'Amount', 'Status', 'Created'],
  reconciliation: ['Report', 'Settlement', 'Period start', 'Period end', 'Gross payments', 'Variance', 'Status'],
  referralClicks: ['Click', 'Code', 'Promoter', 'Listing', 'IP', 'Created'],
  attributionSessions: ['Session', 'Code', 'Promoter', 'Listing', 'Status', 'Booking', 'Created'],
  campaignConversions: ['Conversion', 'Campaign', 'Promoter', 'Booking', 'Amount', 'Commission', 'Status'],
  agentProfiles: ['Profile', 'User', 'Agent code', 'Office', 'Location', 'Offline sales', 'Status'],
  fraudSignals: ['Signal', 'Promoter/Agent', 'Booking', 'Type', 'Severity', 'Score', 'Status'],
  referralCards: ['Link', 'Promoter', 'Code', 'Listing', 'QR card', 'Status'],
  agentSales: ['Sale', 'Booking', 'Customer', 'Listing', 'Payment method', 'Amount', 'Status'],
  offlineSales: ['Sale', 'Booking', 'Customer', 'Listing', 'Payment method', 'Amount', 'Status'],
  loginAudits: ['Audit', 'User/Identity', 'Role', 'Result', 'Reason', 'IP', 'Created'],
  securityEvents: ['Event', 'Type', 'Severity', 'Actor', 'Entity type', 'Entity', 'Status', 'Reason', 'Created'],
  deviceSessions: ['Session', 'User', 'Role', 'Device fingerprint', 'Status', 'First seen', 'Last seen'],
  idempotencyKeyRecords: ['Record', 'Scope', 'Key', 'Entity type', 'Entity', 'Status', 'Last seen'],
  support: ['Case', 'Owner', 'Subject', 'Priority', 'Status', 'Opened'],
  checkins: ['Booking', 'Customer', 'Service', 'Seat or room', 'Checked at', 'Status'],
  customers: ['Customer', 'Contact', 'Bookings', 'Latest service', 'Spent', 'Status'],
  handovers: ['Shift', 'Staff', 'Note', 'Status'],
  commissions: ['Commission', 'Booking', 'Ticket value', 'Rate', 'Earned', 'Status'],
  withdrawals: ['Transaction', 'Type', 'Owner', 'Date', 'Amount', 'Status'],
};

function normalizeRows(rows) {
  return rows.map((row) => (Array.isArray(row) ? row.filter((cell) => typeof cell !== 'object') : Object.values(row)));
}

async function generateCsvReport(scope, type, context = {}) {
  const requested = String(type || 'bookings').replace(/\.csv$/i, '');
  const key = TYPE_ALIASES[requested] || requested;
  const rows = normalizeRows(await dashboardRows(scope, key, context));
  const headers = HEADERS[key] || rows[0]?.map((_, index) => `Column ${index + 1}`) || ['Value'];
  return {
    filename: `${scope}-${requested}-${new Date().toISOString().slice(0, 10)}.csv`,
    contentType: 'text/csv; charset=utf-8',
    csv: toCsv(headers, rows),
  };
}

module.exports = { generateCsvReport };
