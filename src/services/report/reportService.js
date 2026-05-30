const store = require('../data/demoStore');

function escapeCsv(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(headers, rows) {
  return [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');
}

function dashboardRows(scope, type, context = {}) {
  if (scope === 'admin') return store.dashboardData('admin')[type] || [];
  if (scope === 'company') return store.dashboardData('company', { companyId: context.companyId || 'company-01' })[type] || [];
  if (scope === 'employee') return store.dashboardData('employee', { companyId: context.companyId || 'company-01', employeeId: context.employeeId || 'user-employee-001' })[type] || [];
  if (scope === 'promoter') return store.dashboardData('promoter', { promoterId: context.promoterId || 'user-promoter-001' })[type] || [];
  if (scope === 'customer') return store.dashboardData('customer', { customerId: context.customerId || 'user-customer-001' })[type] || [];
  return [];
}

const TYPE_ALIASES = {
  checkin: 'checkins',
  'check-in': 'checkins',
  sales: 'payments',
  finance: 'payouts',
  handover: 'handovers',
  exception: 'refunds',
  exceptions: 'refunds',
};

const HEADERS = {
  bookings: ['Booking', 'Service', 'Customer', 'Date', 'Status', 'Amount', 'Extra'],
  payments: ['Transaction', 'Booking', 'Customer paid', 'Company earning', 'Platform fee', 'Promoter', 'Status'],
  payouts: ['Transaction', 'Booking', 'Customer paid', 'Company earning', 'Platform fee', 'Promoter', 'Status'],
  listings: ['Listing', 'Type', 'Route or location', 'Inventory', 'Price from', 'Status'],
  routes: ['Route', 'Listing', 'Boarding points', 'Dropoff points', 'Corridor', 'Status'],
  vehicles: ['Vehicle', 'Type', 'Plate or code', 'Seats', 'Layout', 'Status'],
  schedules: ['Schedule', 'Route', 'Time', 'Vehicle', 'Booked', 'Status'],
  inventory: ['Inventory', 'Linked listing', 'Total', 'Booked', 'Held', 'Blocked', 'Status'],
  refunds: ['Refund', 'Booking', 'Customer', 'Reason', 'Amount', 'Status'],
  promotions: ['Campaign', 'Listing', 'Placement', 'Budget', 'Clicks', 'Bookings', 'Status'],
  staff: ['Staff', 'Role', 'Branch', 'Permissions', 'Last login', 'Status'],
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

function generateCsvReport(scope, type, context = {}) {
  const requested = String(type || 'bookings').replace(/\.csv$/i, '');
  const key = TYPE_ALIASES[requested] || requested;
  const rows = normalizeRows(dashboardRows(scope, key, context));
  const headers = HEADERS[key] || rows[0]?.map((_, index) => `Column ${index + 1}`) || ['Value'];
  return {
    filename: `${scope}-${requested}-${new Date().toISOString().slice(0, 10)}.csv`,
    contentType: 'text/csv; charset=utf-8',
    csv: toCsv(headers, rows),
  };
}

module.exports = { generateCsvReport };
