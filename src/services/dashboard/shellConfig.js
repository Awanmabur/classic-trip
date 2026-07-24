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
        { page: 'listings', label: 'Bus Listings (Public)', icon: 'fa-layer-group' },
        { page: 'routes', label: 'Routes & Stops', icon: 'fa-route' },
        { page: 'vehicles', label: 'Vehicles & Seat Templates', icon: 'fa-bus-simple' },
        { page: 'seat-maps', label: 'Live Departure Seat Maps', icon: 'fa-chair' },
        { page: 'schedules', label: 'Departures & Fares', icon: 'fa-calendar-days' },
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
        { page: 'listings', label: 'Hotel Listings (Public)', icon: 'fa-hotel' },
        { page: 'hotel-rooms', label: 'Properties, Rooms & Inventory', icon: 'fa-bed' },
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
  }
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
  { key: 'support', role: 'support_admin', label: 'Support', href: '/support/dashboard' },
  { key: 'finance', role: 'finance_admin', label: 'Finance', href: '/finance/dashboard' },
  { key: 'operations', role: 'operations_admin', label: 'Operations', href: '/operations/dashboard' },
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
  let groups = (config.groups || []).map((group) => ({
    ...group,
    items: (group.items || [])
      .filter((item) => !visiblePages.size || visiblePages.has(item.page))
      .map((item) => ({ ...item })),
  })).filter((group) => group.items.length);
  if (!groups.some((group) => (group.items || []).some((item) => item.page === 'setup-guide'))) {
    groups = groups.map((group, index) => index === 0 ? {
      ...group,
      items: [
        ...(group.items || []).slice(0, 1),
        { page: 'setup-guide', label: 'Setup & Workflow Guide', icon: 'fa-diagram-project' },
        ...(group.items || []).slice(1),
      ],
    } : group);
  }
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


const EMPLOYEE_PAGE_PERMISSIONS = {
  overview: [],
  bookings: ['booking.view', 'booking.create_manual'],
  checkin: ['checkin.scan', 'checkin.manage'],
  schedule: ['schedule.update', 'schedule.delay_notice', 'manifest.view'],
  'driver-ops': ['manifest.view'],
  'driver-manifest': ['manifest.view'],
  'driver-incidents': ['manifest.view'],
  inventory: ['inventory.update', 'manifest.view'],
  customers: ['customer.note', 'booking.view'],
  payments: ['payment.record'],
  refunds: ['refund.request'],
  support: ['support.manage', 'support.note'],
  handover: ['handover.create'],
  reports: ['reports.view'],
  profile: ['profile.update'],
  notifications: [],
};

function employeePageAllowed(page, permissions = []) {
  const key = String(page || 'overview').trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(EMPLOYEE_PAGE_PERMISSIONS, key)) return false;
  const granted = new Set(permissions || []);
  if (granted.has('*')) return true;
  const required = EMPLOYEE_PAGE_PERMISSIONS[key];
  return required.length === 0 || required.some((permission) => granted.has(permission));
}

function filterEmployeeMenuByPermissions(menu, permissions = []) {
  return {
    ...menu,
    groups: (menu.groups || []).map((group) => ({
      ...group,
      items: (group.items || []).filter((item) => employeePageAllowed(item.page, permissions)),
    })).filter((group) => group.items.length),
  };
}

function menuHref(roleKey, page) {
  const servicePages = new Set(SERVICE_DASHBOARDS.map((item) => item.key));
  if (roleKey === 'company') {
    const companyRoutes = {
      overview: '/company/dashboard',
      'setup-guide': '/company/dashboard/setup-guide',
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

function injectWorkflowGuideItem(menu) {
  if (menu.roleKey === 'company') return menu;
  const alreadyHas = (menu.groups || []).some((group) => (group.items || []).some((item) => item.page === 'workflow-guide'));
  if (alreadyHas) return menu;
  const guideItem = { page: 'workflow-guide', label: 'How This Dashboard Works', icon: 'fa-circle-question', href: '#workflow-guide' };
  const groups = (menu.groups || []).map((group, index) => {
    if (index !== 0) return group;
    const items = [...(group.items || [])];
    const overviewIndex = items.findIndex((item) => item.page === 'overview');
    items.splice(overviewIndex >= 0 ? overviewIndex + 1 : 0, 0, guideItem);
    return { ...group, items };
  });
  return { ...menu, groups };
}

function injectNotificationsItem(menu) {
  const notifItem = { page: 'notifications', label: 'Notifications', icon: 'fa-bell', href: '#notifications' };
  const alreadyHas = (menu.groups || []).some(function(g) { return (g.items || []).some(function(i) { return i.page === 'notifications'; }); });
  if (alreadyHas) return menu;
  const groups = (menu.groups || []).map(function(group, index) {
    if (index === 0) return Object.assign({}, group, { items: (group.items || []).concat([notifItem]) });
    return group;
  });
  return Object.assign({}, menu, { groups: groups });
}

function buildDashboardShell(requestedRole, options = {}) {
  const user = options.user || {};
  let menu = cloneMenu(getDashboardMenu(requestedRole));
  if (menu.roleKey === 'company' && options.serviceProfile) {
    menu = applyCompanyServiceProfile(menu, options.serviceProfile, options.company || {});
  }
  if (menu.roleKey === 'employee' && options.serviceProfile) {
    menu = applyEmployeeServiceProfile(menu, options.serviceProfile);
    menu = filterEmployeeMenuByPermissions(menu, options.permissions || []);
  }
  menu = injectWorkflowGuideItem(menu);
  menu = injectNotificationsItem(menu);
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
    permissions: options.permissions || [],
  };
}

module.exports = { buildDashboardShell, employeePageAllowed, EMPLOYEE_PAGE_PERMISSIONS, filterEmployeeMenuByPermissions };
