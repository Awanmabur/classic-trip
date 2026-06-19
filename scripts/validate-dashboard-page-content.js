const fs = require('fs');
const path = require('path');
const { ROLE_DASHBOARDS } = require('../src/config/dashboardMenus');
const { buildDashboardShell } = require('../src/services/dashboard/shellConfig');

const viewPath = path.join(__dirname, '..', 'src', 'views', 'dashboards', 'admin', 'index.ejs');
const view = fs.readFileSync(viewPath, 'utf8');
const staticSectionIds = new Set([...view.matchAll(/<section class="section(?: [^"]*)?" id="([^"]+)"/g)].map((match) => match[1]));
const aliases = {
  checkin: 'checkins',
  scanner: 'checkins',
  schedule: 'schedules',
  assigned: 'schedules',
  inventory: 'seat-maps',
  rooms: 'hotel-rooms',
  roomCalendar: 'hotel-rooms',
  'room-calendar': 'hotel-rooms',
  'hotel-properties': 'hotel-rooms',
  'room-types': 'hotel-rooms',
  'room-units': 'hotel-rooms',
  housekeeping: 'hotel-rooms',
  'driver-manifest': 'manifests',
  'driver-ops': 'schedules',
  'driver-incidents': 'support',
  incidents: 'support',
  customers: 'bookings',
  passengers: 'manifests',
  guests: 'manifests',
  payments: 'revenue',
  wallet: 'settlement',
  payouts: 'settlement',
  profile: 'company-profile',
  handover: 'reports',
};

function resolve(page) {
  return aliases[page] || page;
}

const sampleProfiles = [
  { role: 'company', serviceProfile: { primaryServiceType: 'bus', supportsBus: true, supportsTransport: true, visiblePages: ['overview','company-profile','staff','listings','routes','vehicles','seat-maps','schedules','bookings','manifests','checkins','support','reviews','revenue','settlement','reports'] } },
  { role: 'company', serviceProfile: { primaryServiceType: 'hotel', supportsHotel: true, visiblePages: ['overview','company-profile','staff','listings','hotel-rooms','bookings','manifests','checkins','support','reviews','revenue','settlement','reports'] } },
  { role: 'employee', serviceProfile: { primaryServiceType: 'bus', primaryLabel: 'Bus', supportsBus: true } },
  { role: 'employee', serviceProfile: { primaryServiceType: 'hotel', primaryLabel: 'Hotel', supportsHotel: true } },
  { role: 'driver', serviceProfile: { primaryServiceType: 'bus', primaryLabel: 'Bus', supportsBus: true } },
  { role: 'support' },
  { role: 'finance' },
  { role: 'operations' },
];

const failures = [];
for (const sample of sampleProfiles) {
  const shell = buildDashboardShell(sample.role, { serviceProfile: sample.serviceProfile || {}, company: { name: 'Sample Company' } });
  for (const group of shell.groups || []) {
    for (const item of group.items || []) {
      const resolved = resolve(item.page);
      if (!staticSectionIds.has(resolved)) {
        failures.push(`${sample.role}:${item.page} resolves to missing section ${resolved}`);
      }
    }
  }
}

if (!view.includes('resolveDashboardPage')) failures.push('Dashboard view missing resolveDashboardPage alias guard.');
if (!view.includes("inventory: companySupportsHotel ? 'hotel-rooms' : (companySupportsBus ? 'seat-maps' : 'listings')")) failures.push('Dashboard view missing service-aware inventory alias.');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Dashboard page content mapping validation passed.');
