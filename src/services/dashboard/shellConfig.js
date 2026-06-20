const { getDashboardMenu } = require('../../config/dashboardMenus');
const { SERVICE_DASHBOARDS } = require('../../config/dashboardFeatures');


const COMPANY_SERVICE_MENU_CONFIG = {
  bus: {
    createLabel: 'Create Departure',
    groups: [
      { label: 'Company', items: [
        { page: 'overview', label: 'Overview', icon: 'fa-chart-line' },
        { page: 'company-profile', label: 'Company Profile', icon: 'fa-building-circle-check' },
        { page: 'staff', label: 'Staff & Driver Requests', icon: 'fa-user-tie' },
      ] },
      { label: 'Bus Setup', items: [
        { page: 'listings', label: 'Bus Listings', icon: 'fa-layer-group' },
        { page: 'routes', label: 'Routes & Stops', icon: 'fa-route' },
        { page: 'vehicles', label: 'Buses / Vehicles', icon: 'fa-bus-simple' },
        { page: 'seat-maps', label: 'Seat Maps', icon: 'fa-chair' },
        { page: 'schedules', label: 'Schedules & Fares', icon: 'fa-calendar-days' },
      ] },
      { label: 'Bus Daily Work', items: [
        { page: 'bookings', label: 'Bus Bookings', icon: 'fa-ticket' },
        { page: 'manifests', label: 'Passenger Manifests', icon: 'fa-file-lines' },
        { page: 'checkins', label: 'Boarding Check-ins', icon: 'fa-qrcode' },
        { page: 'support', label: 'Support Cases', icon: 'fa-headset' },
        { page: 'reviews', label: 'Reviews', icon: 'fa-star' },
      ] },
      { label: 'Bus Finance', items: [
        { page: 'revenue', label: 'Revenue', icon: 'fa-money-bill-wave' },
        { page: 'settlement', label: 'Settlement', icon: 'fa-wallet' },
        { page: 'reports', label: 'Reports', icon: 'fa-chart-pie' },
      ] },
    ],
  },
  hotel: {
    createLabel: 'Add Room Inventory',
    groups: [
      { label: 'Company', items: [
        { page: 'overview', label: 'Overview', icon: 'fa-chart-line' },
        { page: 'company-profile', label: 'Company Profile', icon: 'fa-building-circle-check' },
        { page: 'staff', label: 'Hotel Staff', icon: 'fa-user-tie' },
      ] },
      { label: 'Hotel Setup', items: [
        { page: 'listings', label: 'Hotel Properties', icon: 'fa-hotel' },
        { page: 'hotel-rooms', label: 'Rooms & Inventory', icon: 'fa-bed' },
      ] },
      { label: 'Hotel Daily Work', items: [
        { page: 'bookings', label: 'Hotel Bookings', icon: 'fa-ticket' },
        { page: 'manifests', label: 'Arrivals / Departures', icon: 'fa-file-lines' },
        { page: 'checkins', label: 'Guest Check-ins', icon: 'fa-qrcode' },
        { page: 'support', label: 'Support Cases', icon: 'fa-headset' },
        { page: 'reviews', label: 'Reviews', icon: 'fa-star' },
      ] },
      { label: 'Hotel Finance', items: [
        { page: 'revenue', label: 'Revenue', icon: 'fa-money-bill-wave' },
        { page: 'settlement', label: 'Settlement', icon: 'fa-wallet' },
        { page: 'reports', label: 'Reports', icon: 'fa-chart-pie' },
      ] },
    ],
  },
  flight: {
    createLabel: 'Create Flight Offer',
    groups: [
      { label: 'Provider', items: [
        { page: 'overview', label: 'Overview', icon: 'fa-chart-line' },
        { page: 'company-profile', label: 'Provider Profile', icon: 'fa-building-circle-check' },
        { page: 'staff', label: 'Staff', icon: 'fa-user-tie' },
      ] },
      { label: 'Flight Setup', items: [
        { page: 'listings', label: 'Flight Offers', icon: 'fa-plane' },
        { page: 'routes', label: 'Airports & Routes', icon: 'fa-route' },
        { page: 'vehicles', label: 'Aircraft / Fleet', icon: 'fa-plane-departure' },
        { page: 'seat-maps', label: 'Seat Maps', icon: 'fa-chair' },
        { page: 'schedules', label: 'Flight Schedules', icon: 'fa-calendar-days' },
      ] },
      { label: 'Flight Work', items: [
        { page: 'bookings', label: 'PNR Bookings', icon: 'fa-ticket' },
        { page: 'manifests', label: 'Passenger Manifests', icon: 'fa-file-lines' },
        { page: 'checkins', label: 'Boarding / Check-in', icon: 'fa-qrcode' },
        { page: 'support', label: 'Changes / Support', icon: 'fa-headset' },
        { page: 'reviews', label: 'Reviews', icon: 'fa-star' },
      ] },
      { label: 'Flight Finance', items: [
        { page: 'revenue', label: 'Revenue', icon: 'fa-money-bill-wave' },
        { page: 'settlement', label: 'Settlement', icon: 'fa-wallet' },
        { page: 'reports', label: 'Reports', icon: 'fa-chart-pie' },
      ] },
    ],
  },
  train: {
    createLabel: 'Create Train Departure',
    groups: [
      { label: 'Provider', items: [
        { page: 'overview', label: 'Overview', icon: 'fa-chart-line' },
        { page: 'company-profile', label: 'Provider Profile', icon: 'fa-building-circle-check' },
        { page: 'staff', label: 'Staff', icon: 'fa-user-tie' },
      ] },
      { label: 'Train Setup', items: [
        { page: 'listings', label: 'Train Services', icon: 'fa-train' },
        { page: 'routes', label: 'Stations & Routes', icon: 'fa-route' },
        { page: 'vehicles', label: 'Coaches / Fleet', icon: 'fa-train-subway' },
        { page: 'seat-maps', label: 'Coach Seat Maps', icon: 'fa-chair' },
        { page: 'schedules', label: 'Schedules & Fares', icon: 'fa-calendar-days' },
      ] },
      { label: 'Train Work', items: [
        { page: 'bookings', label: 'Train Bookings', icon: 'fa-ticket' },
        { page: 'manifests', label: 'Passenger Manifests', icon: 'fa-file-lines' },
        { page: 'checkins', label: 'Boarding Check-ins', icon: 'fa-qrcode' },
        { page: 'support', label: 'Support Cases', icon: 'fa-headset' },
        { page: 'reviews', label: 'Reviews', icon: 'fa-star' },
      ] },
      { label: 'Train Finance', items: [
        { page: 'revenue', label: 'Revenue', icon: 'fa-money-bill-wave' },
        { page: 'settlement', label: 'Settlement', icon: 'fa-wallet' },
        { page: 'reports', label: 'Reports', icon: 'fa-chart-pie' },
      ] },
    ],
  },
  tour: {
    createLabel: 'Create Tour Date',
    groups: [
      { label: 'Operator', items: [
        { page: 'overview', label: 'Overview', icon: 'fa-chart-line' },
        { page: 'company-profile', label: 'Operator Profile', icon: 'fa-building-circle-check' },
        { page: 'staff', label: 'Staff & Guides', icon: 'fa-user-tie' },
      ] },
      { label: 'Tour Setup', items: [
        { page: 'listings', label: 'Tour Packages', icon: 'fa-map-location-dot' },
        { page: 'schedules', label: 'Tour Dates & Capacity', icon: 'fa-calendar-days' },
      ] },
      { label: 'Tour Work', items: [
        { page: 'bookings', label: 'Participants / Bookings', icon: 'fa-ticket' },
        { page: 'manifests', label: 'Participant Lists', icon: 'fa-file-lines' },
        { page: 'checkins', label: 'Voucher / QR Check-ins', icon: 'fa-qrcode' },
        { page: 'support', label: 'Support Cases', icon: 'fa-headset' },
        { page: 'reviews', label: 'Reviews', icon: 'fa-star' },
      ] },
      { label: 'Tour Finance', items: [
        { page: 'revenue', label: 'Revenue', icon: 'fa-money-bill-wave' },
        { page: 'settlement', label: 'Settlement', icon: 'fa-wallet' },
        { page: 'reports', label: 'Reports', icon: 'fa-chart-pie' },
      ] },
    ],
  },
  car_rental: {
    createLabel: 'Add Rental Vehicle',
    groups: [
      { label: 'Provider', items: [
        { page: 'overview', label: 'Overview', icon: 'fa-chart-line' },
        { page: 'company-profile', label: 'Provider Profile', icon: 'fa-building-circle-check' },
        { page: 'staff', label: 'Staff', icon: 'fa-user-tie' },
      ] },
      { label: 'Rental Setup', items: [
        { page: 'listings', label: 'Rental Listings', icon: 'fa-car' },
        { page: 'vehicles', label: 'Rental Vehicles', icon: 'fa-car-side' },
        { page: 'schedules', label: 'Availability Calendar', icon: 'fa-calendar-days' },
      ] },
      { label: 'Rental Work', items: [
        { page: 'bookings', label: 'Rental Bookings', icon: 'fa-ticket' },
        { page: 'manifests', label: 'Pickup / Return Lists', icon: 'fa-file-lines' },
        { page: 'checkins', label: 'Pickup / Return', icon: 'fa-qrcode' },
        { page: 'support', label: 'Support Cases', icon: 'fa-headset' },
        { page: 'reviews', label: 'Reviews', icon: 'fa-star' },
      ] },
      { label: 'Rental Finance', items: [
        { page: 'revenue', label: 'Revenue', icon: 'fa-money-bill-wave' },
        { page: 'settlement', label: 'Settlement', icon: 'fa-wallet' },
        { page: 'reports', label: 'Reports', icon: 'fa-chart-pie' },
      ] },
    ],
  },
  event: {
    createLabel: 'Create Event',
    groups: [
      { label: 'Organizer', items: [
        { page: 'overview', label: 'Overview', icon: 'fa-chart-line' },
        { page: 'company-profile', label: 'Organizer Profile', icon: 'fa-building-circle-check' },
        { page: 'staff', label: 'Staff', icon: 'fa-user-tie' },
      ] },
      { label: 'Event Setup', items: [
        { page: 'listings', label: 'Events & Venues', icon: 'fa-calendar-check' },
        { page: 'seat-maps', label: 'Seat Map / Capacity', icon: 'fa-chair' },
        { page: 'schedules', label: 'Event Dates', icon: 'fa-calendar-days' },
      ] },
      { label: 'Event Work', items: [
        { page: 'bookings', label: 'Ticket Sales', icon: 'fa-ticket' },
        { page: 'manifests', label: 'Entry Lists', icon: 'fa-file-lines' },
        { page: 'checkins', label: 'QR Entry', icon: 'fa-qrcode' },
        { page: 'support', label: 'Support Cases', icon: 'fa-headset' },
        { page: 'reviews', label: 'Reviews', icon: 'fa-star' },
      ] },
      { label: 'Event Finance', items: [
        { page: 'revenue', label: 'Revenue', icon: 'fa-money-bill-wave' },
        { page: 'settlement', label: 'Settlement', icon: 'fa-wallet' },
        { page: 'reports', label: 'Reports', icon: 'fa-chart-pie' },
      ] },
    ],
  },
  cargo: {
    createLabel: 'Create Shipment',
    groups: [
      { label: 'Provider', items: [
        { page: 'overview', label: 'Overview', icon: 'fa-chart-line' },
        { page: 'company-profile', label: 'Provider Profile', icon: 'fa-building-circle-check' },
        { page: 'staff', label: 'Staff', icon: 'fa-user-tie' },
      ] },
      { label: 'Cargo Setup', items: [
        { page: 'listings', label: 'Cargo Services', icon: 'fa-boxes-stacked' },
        { page: 'routes', label: 'Cargo Routes', icon: 'fa-route' },
        { page: 'vehicles', label: 'Fleet', icon: 'fa-truck' },
        { page: 'schedules', label: 'Dispatch Schedules', icon: 'fa-calendar-days' },
      ] },
      { label: 'Cargo Work', items: [
        { page: 'bookings', label: 'Shipments / Waybills', icon: 'fa-ticket' },
        { page: 'manifests', label: 'Cargo Manifests', icon: 'fa-file-lines' },
        { page: 'checkins', label: 'Tracking / Delivery Proof', icon: 'fa-qrcode' },
        { page: 'support', label: 'Claims / Support', icon: 'fa-headset' },
      ] },
      { label: 'Cargo Finance', items: [
        { page: 'revenue', label: 'Revenue', icon: 'fa-money-bill-wave' },
        { page: 'settlement', label: 'Settlement', icon: 'fa-wallet' },
        { page: 'reports', label: 'Reports', icon: 'fa-chart-pie' },
      ] },
    ],
  },
  insurance: {
    createLabel: 'Add Insurance Product',
    groups: [
      { label: 'Provider', items: [
        { page: 'overview', label: 'Overview', icon: 'fa-chart-line' },
        { page: 'company-profile', label: 'Provider Profile', icon: 'fa-building-circle-check' },
        { page: 'staff', label: 'Staff', icon: 'fa-user-tie' },
      ] },
      { label: 'Insurance Setup', items: [
        { page: 'listings', label: 'Products & Coverage', icon: 'fa-shield-heart' },
      ] },
      { label: 'Insurance Work', items: [
        { page: 'bookings', label: 'Policies Sold', icon: 'fa-ticket' },
        { page: 'support', label: 'Claims / Support', icon: 'fa-headset' },
        { page: 'reviews', label: 'Reviews', icon: 'fa-star' },
      ] },
      { label: 'Insurance Finance', items: [
        { page: 'revenue', label: 'Premiums / Revenue', icon: 'fa-money-bill-wave' },
        { page: 'settlement', label: 'Settlement', icon: 'fa-wallet' },
        { page: 'reports', label: 'Reports', icon: 'fa-chart-pie' },
      ] },
    ],
  },
  corporate: {
    createLabel: 'Create Approval Request',
    groups: [
      { label: 'Corporate Account', items: [
        { page: 'overview', label: 'Overview', icon: 'fa-chart-line' },
        { page: 'company-profile', label: 'Corporate Profile', icon: 'fa-building-circle-check' },
        { page: 'staff', label: 'Travel Managers', icon: 'fa-user-tie' },
      ] },
      { label: 'Travel Management', items: [
        { page: 'listings', label: 'Travel Policies', icon: 'fa-briefcase' },
        { page: 'bookings', label: 'Employee Trips', icon: 'fa-ticket' },
        { page: 'support', label: 'Approvals / Support', icon: 'fa-headset' },
        { page: 'reports', label: 'Statements & Reports', icon: 'fa-chart-pie' },
      ] },
      { label: 'Corporate Billing', items: [
        { page: 'revenue', label: 'Invoices', icon: 'fa-money-bill-wave' },
        { page: 'settlement', label: 'Settlement', icon: 'fa-wallet' },
      ] },
    ],
  },
  loyalty: {
    createLabel: 'Create Loyalty Rule',
    groups: [
      { label: 'Partner', items: [
        { page: 'overview', label: 'Overview', icon: 'fa-chart-line' },
        { page: 'company-profile', label: 'Partner Profile', icon: 'fa-building-circle-check' },
        { page: 'staff', label: 'Staff', icon: 'fa-user-tie' },
      ] },
      { label: 'Loyalty Setup', items: [
        { page: 'listings', label: 'Points / Coupons', icon: 'fa-gift' },
      ] },
      { label: 'Loyalty Work', items: [
        { page: 'bookings', label: 'Redemptions', icon: 'fa-ticket' },
        { page: 'support', label: 'Support Cases', icon: 'fa-headset' },
        { page: 'reports', label: 'Reports', icon: 'fa-chart-pie' },
      ] },
      { label: 'Loyalty Finance', items: [
        { page: 'revenue', label: 'Credit Liability', icon: 'fa-money-bill-wave' },
        { page: 'settlement', label: 'Settlement', icon: 'fa-wallet' },
      ] },
    ],
  },
  partner: {
    createLabel: 'Create',
    groups: [
      { label: 'Company', items: [
        { page: 'overview', label: 'Overview', icon: 'fa-chart-line' },
        { page: 'company-profile', label: 'Company Profile', icon: 'fa-building-circle-check' },
        { page: 'staff', label: 'Staff', icon: 'fa-user-tie' },
      ] },
      { label: 'Work', items: [
        { page: 'listings', label: 'Services', icon: 'fa-layer-group' },
        { page: 'bookings', label: 'Bookings', icon: 'fa-ticket' },
        { page: 'support', label: 'Support Cases', icon: 'fa-headset' },
        { page: 'reviews', label: 'Reviews', icon: 'fa-star' },
        { page: 'revenue', label: 'Revenue', icon: 'fa-money-bill-wave' },
        { page: 'settlement', label: 'Settlement', icon: 'fa-wallet' },
        { page: 'reports', label: 'Reports', icon: 'fa-chart-pie' },
      ] },
    ],
  },
};

const EMPLOYEE_SERVICE_MENU_CONFIG = {
  bus: {
    createLabel: 'Create Booking',
    groups: [
      { label: 'Bus Shift', items: [
        { page: 'overview', label: 'Overview', icon: 'fa-chart-line' },
        { page: 'checkin', label: 'Ticket Check-in', icon: 'fa-qrcode' },
        { page: 'bookings', label: 'Bus Bookings', icon: 'fa-ticket' },
        { page: 'schedule', label: 'Assigned Schedules', icon: 'fa-calendar-days' },
      ] },
      { label: 'Bus Work', items: [
        { page: 'inventory', label: 'Seat Map', icon: 'fa-chair' },
        { page: 'driver-manifest', label: 'Passenger Manifest', icon: 'fa-list-check' },
        { page: 'driver-ops', label: 'Trip Status', icon: 'fa-route' },
        { page: 'driver-incidents', label: 'Incidents', icon: 'fa-triangle-exclamation' },
        { page: 'customers', label: 'Passenger List', icon: 'fa-users' },
      ] },
      { label: 'Back Office', items: [
        { page: 'payments', label: 'Ticket Payments', icon: 'fa-wallet' },
        { page: 'refunds', label: 'Refund Requests', icon: 'fa-rotate-left' },
        { page: 'support', label: 'Support Tasks', icon: 'fa-headset' },
        { page: 'handover', label: 'Shift Handover', icon: 'fa-clipboard-list' },
        { page: 'reports', label: 'My Reports', icon: 'fa-file-lines' },
        { page: 'profile', label: 'My Profile', icon: 'fa-user-gear' },
      ] },
    ],
  },
  hotel: {
    createLabel: 'Create Booking',
    groups: [
      { label: 'Hotel Shift', items: [
        { page: 'overview', label: 'Overview', icon: 'fa-chart-line' },
        { page: 'checkin', label: 'Guest Check-in', icon: 'fa-qrcode' },
        { page: 'bookings', label: 'Hotel Bookings', icon: 'fa-ticket' },
        { page: 'schedule', label: 'Arrivals / Departures', icon: 'fa-calendar-days' },
      ] },
      { label: 'Hotel Work', items: [
        { page: 'inventory', label: 'Room Inventory', icon: 'fa-bed' },
        { page: 'customers', label: 'Guest List', icon: 'fa-users' },
      ] },
      { label: 'Back Office', items: [
        { page: 'payments', label: 'Guest Payments', icon: 'fa-wallet' },
        { page: 'refunds', label: 'Refund Requests', icon: 'fa-rotate-left' },
        { page: 'support', label: 'Support Tasks', icon: 'fa-headset' },
        { page: 'handover', label: 'Shift Handover', icon: 'fa-clipboard-list' },
        { page: 'reports', label: 'My Reports', icon: 'fa-file-lines' },
        { page: 'profile', label: 'My Profile', icon: 'fa-user-gear' },
      ] },
    ],
  },
  cargo: {
    createLabel: 'Create Booking',
    groups: [
      { label: 'Cargo Shift', items: [
        { page: 'overview', label: 'Overview', icon: 'fa-chart-line' },
        { page: 'bookings', label: 'Shipments / Waybills', icon: 'fa-ticket' },
        { page: 'schedule', label: 'Dispatch Schedule', icon: 'fa-calendar-days' },
        { page: 'inventory', label: 'Tracking / Delivery Proof', icon: 'fa-boxes-stacked' },
      ] },
      { label: 'Back Office', items: [
        { page: 'payments', label: 'Payments', icon: 'fa-wallet' },
        { page: 'support', label: 'Claims / Support', icon: 'fa-headset' },
        { page: 'handover', label: 'Shift Handover', icon: 'fa-clipboard-list' },
        { page: 'reports', label: 'My Reports', icon: 'fa-file-lines' },
        { page: 'profile', label: 'My Profile', icon: 'fa-user-gear' },
      ] },
    ],
  },
  default: {
    createLabel: 'Create Booking',
    groups: [
      { label: 'Shift Work', items: [
        { page: 'overview', label: 'Overview', icon: 'fa-chart-line' },
        { page: 'bookings', label: 'Assigned Bookings', icon: 'fa-ticket' },
        { page: 'schedule', label: 'Assigned Work', icon: 'fa-calendar-days' },
        { page: 'inventory', label: 'Service Inventory', icon: 'fa-layer-group' },
      ] },
      { label: 'Back Office', items: [
        { page: 'payments', label: 'Payments', icon: 'fa-wallet' },
        { page: 'support', label: 'Support Tasks', icon: 'fa-headset' },
        { page: 'handover', label: 'Shift Handover', icon: 'fa-clipboard-list' },
        { page: 'reports', label: 'My Reports', icon: 'fa-file-lines' },
        { page: 'profile', label: 'My Profile', icon: 'fa-user-gear' },
      ] },
    ],
  },
};

const ROLE_SWITCH_TARGETS = [
  { key: 'admin', role: 'super_admin', label: 'Super Admin', href: '/admin' },
  { key: 'company', role: 'company_admin', label: 'Company Workspace', href: '/company/dashboard' },
  { key: 'driver', role: 'driver', label: 'Driver', href: '/driver/dashboard' },
  { key: 'employee', role: 'company_employee', label: 'Company Staff', href: '/employee/dashboard' },
  { key: 'customer', role: 'customer', label: 'Customer', href: '/account' },
  { key: 'promoter', role: 'promoter', label: 'Promoter / Agent', href: '/promoter/dashboard' },
  { key: 'support', role: 'support_agent', label: 'Support', href: '/support/dashboard' },
  { key: 'finance', role: 'finance_agent', label: 'Finance', href: '/finance/dashboard' },
  { key: 'operations', role: 'operations_agent', label: 'Operations', href: '/operations/dashboard' },
];

function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'CT';
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'CT';
}

function roleSetFor(user = {}, requestedRole) {
  const explicit = Array.isArray(user.roles) ? user.roles : [];
  const base = user.role ? [user.role] : [];
  const combined = Array.from(new Set([...explicit, ...base]));
  if (combined.includes('super_admin')) return ROLE_SWITCH_TARGETS.map((target) => target.role);
  if (!combined.length && requestedRole) combined.push(requestedRole);
  return combined;
}

function cloneMenu(menu = {}) {
  return {
    ...menu,
    groups: (menu.groups || []).map((group) => ({
      ...group,
      items: (group.items || []).map((item) => ({ ...item })),
    })),
  };
}

function applyCompanyServiceProfile(menu, serviceProfile = {}, company = {}) {
  const serviceType = serviceProfile.primaryServiceType || 'partner';
  const config = COMPANY_SERVICE_MENU_CONFIG[serviceType] || COMPANY_SERVICE_MENU_CONFIG.partner;
  const visiblePages = new Set(serviceProfile.visiblePages || []);
  const groups = (config.groups || []).map((group) => ({
    ...group,
    items: (group.items || [])
      .filter((item) => !visiblePages.size || visiblePages.has(item.page))
      .map((item) => ({ ...item })),
  })).filter((group) => group.items.length);
  const pageMeta = serviceProfile.pageMeta || {};
  const title = pageMeta.overview?.[0] || `${serviceProfile.dashboardLabel || 'Company'} Dashboard`;
  const subtitle = pageMeta.overview?.[1] || menu.subtitle;
  return {
    ...menu,
    groups,
    label: serviceProfile.dashboardLabel || menu.label,
    consoleName: serviceProfile.consoleName || menu.consoleName,
    title,
    subtitle,
    profileName: company.name || menu.profileName,
    profileMeta: serviceProfile.primaryLabel ? `${serviceProfile.primaryLabel} partner` : menu.profileMeta,
    statusLabel: company.verificationStatus === 'verified' ? 'Verified' : company.verificationStatus || menu.statusLabel,
    createLabel: config.createLabel || menu.createLabel,
  };
}

function applyEmployeeServiceProfile(menu, serviceProfile = {}) {
  const serviceType = serviceProfile.primaryServiceType || 'default';
  const config = EMPLOYEE_SERVICE_MENU_CONFIG[serviceType] || EMPLOYEE_SERVICE_MENU_CONFIG.default;
  return {
    ...menu,
    groups: (config.groups || []).map((group) => ({ ...group, items: (group.items || []).map((item) => ({ ...item })) })),
    subtitle: `${serviceProfile.primaryLabel || 'Service'} staff tools scoped to assigned company, branch, schedule, property, and permissions.`,
    createLabel: config.createLabel || menu.createLabel,
  };
}

function menuHref(roleKey, page) {
  const servicePages = new Set(SERVICE_DASHBOARDS.map((item) => item.key));
  if (roleKey === 'company') {
    const companyRoutes = {
      overview: '/company/dashboard',
      'company-profile': '/company/profile',
      staff: '/company/employees',
      listings: '/company/listings',
      routes: '/company/routes',
      vehicles: '/company/vehicles',
      'seat-maps': '/company/seat-maps',
      schedules: '/company/schedules',
      'hotel-rooms': '/company/rooms',
      bookings: '/company/bookings',
      manifests: '/company/dashboard/manifests',
      checkins: '/company/checkins',
      support: '/company/support',
      reviews: '/company/dashboard/reviews',
      revenue: '/company/revenue',
      settlement: '/company/settlement',
      payouts: '/company/payouts',
      reports: '/company/reports',
      'bus-dashboard': '/company/bus-dashboard',
      'hotel-dashboard': '/company/hotel-dashboard',
      'flight-dashboard': '/company/flight-dashboard',
      'train-dashboard': '/company/train-dashboard',
      'tour-dashboard': '/company/tour-dashboard',
      'car-rental-dashboard': '/company/car-rental-dashboard',
      'event-dashboard': '/company/event-dashboard',
      'cargo-dashboard': '/company/cargo-dashboard',
      'insurance-dashboard': '/company/insurance-dashboard',
      'corporate-dashboard': '/company/corporate-dashboard',
      'loyalty-dashboard': '/company/loyalty-dashboard',
    };
    return companyRoutes[page] || `/company/dashboard/${page}`;
  }
  if (roleKey === 'admin') return page === 'overview' ? '/admin' : `/admin/${page}`;
  if (roleKey === 'customer') return page === 'overview' ? '/account' : `/account/${page}`;
  if (roleKey === 'promoter') return page === 'overview' ? '/promoter/dashboard' : `/promoter/${page}`;
  if (roleKey === 'employee') return page === 'overview' ? '/employee/dashboard' : `/employee/dashboard/${page}`;
  if (roleKey === 'driver') return page === 'overview' ? '/driver/dashboard' : `/driver/dashboard/${page}`;
  if (roleKey === 'support') return page === 'overview' ? '/support/dashboard' : `/support/dashboard/${page}`;
  if (roleKey === 'finance') return page === 'overview' ? '/finance/dashboard' : `/finance/dashboard/${page}`;
  if (roleKey === 'operations') return page === 'overview' ? '/operations/dashboard' : `/operations/dashboard/${page}`;
  if (servicePages.has(page)) return `/${roleKey}/dashboard/${page}`;
  return `#${page}`;
}

function attachMenuHrefs(menu) {
  return {
    ...menu,
    groups: (menu.groups || []).map((group) => ({
      ...group,
      items: (group.items || []).map((item) => ({ ...item, href: item.href || menuHref(menu.roleKey, item.page) })),
    })),
  };
}

function buildDashboardShell(requestedRole, options = {}) {
  const user = options.user || {};
  let menu = cloneMenu(getDashboardMenu(requestedRole));
  if (menu.roleKey === 'company' && options.serviceProfile) {
    menu = applyCompanyServiceProfile(menu, options.serviceProfile, options.company || {});
  }
  if (menu.roleKey === 'employee' && options.serviceProfile) {
    menu = applyEmployeeServiceProfile(menu, options.serviceProfile);
  }
  menu = attachMenuHrefs(menu);
  const preferMenuIdentity = menu.roleKey === 'company' && menu.profileName;
  const userName = preferMenuIdentity ? menu.profileName : (user.fullName || user.name || menu.profileName);
  const roles = roleSetFor(user, requestedRole);
  const roleSwitcher = ROLE_SWITCH_TARGETS
    .filter((target) => roles.includes(target.role) || target.key === menu.roleKey)
    .map((target) => ({ ...target, active: target.key === menu.roleKey }));
  const companies = options.companies || [];
  const notificationCount = Number(options.notificationCount ?? options.notifications?.length ?? 0) || 0;

  return {
    ...menu,
    currentRole: menu.roleKey,
    userName,
    profileName: userName,
    profileMeta: preferMenuIdentity ? (menu.profileMeta || user.email) : (user.email || menu.profileMeta),
    avatar: initials(userName || menu.profileName || menu.label),
    notificationCount,
    roleSwitcher,
    companies,
    currentCompanyId: user.companyId || options.companyId || '',
    breadcrumbs: options.breadcrumbs || [menu.consoleName || menu.label],
    activePage: options.activePage || 'overview',
  };
}

module.exports = { buildDashboardShell };
