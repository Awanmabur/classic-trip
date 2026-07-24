const ROLE_DASHBOARDS = {
  admin: {
    roleKey: 'admin',
    label: 'Super Admin',
    consoleName: 'Super Admin Console',
    route: '/admin',
    title: 'Super Admin Dashboard',
    subtitle: 'Manage partners, bookings, payments, commissions, promotions, support, operations, finance, and settings in one place.',
    profileName: 'Super Admin',
    profileMeta: 'Full platform access',
    avatar: 'SA',
    statusLabel: 'Admin',
    statusIcon: 'fa-user-shield',
    createLabel: 'Create',
    groups: [
      { label: 'Command Center', items: [
        { page: 'overview', label: 'Overview', icon: 'fa-chart-line' },
        { page: 'analytics', label: 'Analytics', icon: 'fa-chart-pie' },
        { page: 'system', label: 'System Health', icon: 'fa-server' },
      ] },
      { label: 'Marketplace', items: [
        { page: 'bookings', label: 'Bookings', icon: 'fa-ticket' },
        { page: 'partners', label: 'Partners / Companies', icon: 'fa-building' },
        { page: 'listings', label: 'Listings & Inventory', icon: 'fa-layer-group' },
        { page: 'routes', label: 'Routes', icon: 'fa-route' },
        { page: 'vehicles', label: 'Vehicles', icon: 'fa-bus-simple' },
        { page: 'schedules', label: 'Schedules', icon: 'fa-calendar-days' },
        { page: 'customers', label: 'Customers', icon: 'fa-users' },
        { page: 'promoters', label: 'Promoters', icon: 'fa-bullhorn' },
      ] },
      { label: 'Service Categories', items: [
        { page: 'bus-dashboard', label: 'Bus Providers', icon: 'fa-bus-simple' },
        { page: 'hotel-dashboard', label: 'Hotel Providers', icon: 'fa-hotel' },
      ] },
      { label: 'Money and Risk', items: [
        { page: 'payments', label: 'Payments & Split Fees', icon: 'fa-wallet' },
        { page: 'refunds', label: 'Refunds', icon: 'fa-rotate-left' },
        { page: 'kyc', label: 'KYC / Verification', icon: 'fa-id-card' },
        { page: 'audit', label: 'Audit Logs', icon: 'fa-clipboard-list' },
      ] },
      { label: 'Growth and Support', items: [
        { page: 'support', label: 'Support & Disputes', icon: 'fa-headset' },
        { page: 'ads', label: 'Ads & Promotions', icon: 'fa-rectangle-ad' },
        { page: 'notifications', label: 'Notifications', icon: 'fa-bell' },
        { page: 'reports', label: 'Reports', icon: 'fa-file-lines' },
        { page: 'admins', label: 'Admins & Roles', icon: 'fa-user-shield' },
        { page: 'settings', label: 'Settings', icon: 'fa-gear' },
      ] },
    ],
  },
  company: {
    roleKey: 'company',
    label: 'Company Dashboard',
    consoleName: 'Partner Company Console',
    route: '/company/dashboard',
    title: 'Partner Company Dashboard',
    subtitle: 'One company account is locked to one companyType. The same admin dashboard shell is reused, but the aside menu and data are generated for that service only.',
    profileName: 'Company partner',
    profileMeta: 'Partner account',
    avatar: 'CP',
    statusLabel: 'Verified',
    statusIcon: 'fa-building-circle-check',
    createLabel: 'Create',
    groups: [
      { label: 'Control', items: [
        { page: 'overview', label: 'Overview', icon: 'fa-chart-line' },
        { page: 'company-profile', label: 'Company Profile', icon: 'fa-building-circle-check' },
        { page: 'staff', label: 'Staff & Roles', icon: 'fa-user-tie' },
      ] },
      { label: 'Work', items: [
        { page: 'listings', label: 'Services', icon: 'fa-layer-group' },
        { page: 'bookings', label: 'Bookings', icon: 'fa-ticket' },
        { page: 'support', label: 'Support', icon: 'fa-headset' },
        { page: 'reviews', label: 'Reviews', icon: 'fa-star' },
      ] },
      { label: 'Money', items: [
        { page: 'revenue', label: 'Revenue', icon: 'fa-money-bill-wave' },
        { page: 'settlement', label: 'Settlement', icon: 'fa-wallet' },
        { page: 'payouts', label: 'Payouts', icon: 'fa-money-bill-transfer' },
        { page: 'reports', label: 'Reports', icon: 'fa-chart-pie' },
      ] },
    ],
  },
  customer: {
    roleKey: 'customer',
    label: 'Customer',
    consoleName: 'Customer Dashboard',
    route: '/account',
    title: 'Customer Dashboard',
    subtitle: 'Manage bookings, tickets, saved trips, receipts, refunds, support, reviews, wallet, and profile.',
    profileName: 'Traveler',
    profileMeta: 'Customer account',
    avatar: 'CU',
    statusLabel: 'Verified',
    statusIcon: 'fa-user-check',
    createLabel: 'Book Trip',
    groups: [
      { label: 'Trips', items: [
        { page: 'overview', label: 'Overview', icon: 'fa-chart-line' },
        { page: 'bookings', label: 'My Bookings', icon: 'fa-ticket' },
        { page: 'ticket', label: 'Current Ticket', icon: 'fa-qrcode' },
        { page: 'saved', label: 'Saved Trips', icon: 'fa-heart' },
        { page: 'passengers', label: 'Saved Passengers', icon: 'fa-user-group' },
      ] },
      { label: 'Account', items: [
        { page: 'receipts', label: 'Receipts', icon: 'fa-receipt' },
        { page: 'refunds', label: 'Refunds', icon: 'fa-rotate-left' },
        { page: 'support', label: 'Support', icon: 'fa-headset' },
        { page: 'reviews', label: 'Reviews', icon: 'fa-star' },
        { page: 'wallet', label: 'Wallet', icon: 'fa-wallet' },
        { page: 'notifications', label: 'Notifications', icon: 'fa-bell' },
        { page: 'profile', label: 'Profile', icon: 'fa-user-gear' },
        { page: 'security', label: 'Security', icon: 'fa-shield-halved' },
      ] },
    ],
  },
  employee: {
    roleKey: 'employee',
    label: 'Company Staff',
    consoleName: 'Staff Operations Console',
    route: '/employee/dashboard',
    title: 'Company Staff Dashboard',
    subtitle: 'Work dashboard for ticket checkers, booking agents, hotel receptionists, finance staff, and route managers.',
    profileName: 'Company staff',
    profileMeta: 'Employee workspace',
    avatar: 'CE',
    statusLabel: 'On Shift',
    statusIcon: 'fa-user-check',
    createLabel: 'Create',
    groups: [
      { label: 'Shift Work', items: [
        { page: 'overview', label: 'Overview', icon: 'fa-chart-line' },
        { page: 'checkin', label: 'Ticket Check-in', icon: 'fa-qrcode' },
        { page: 'bookings', label: 'Bookings', icon: 'fa-ticket' },
        { page: 'schedule', label: 'Schedules', icon: 'fa-calendar-days' },
      ] },
      { label: 'Operations', items: [
        { page: 'driver-ops', label: 'Driver Ops', icon: 'fa-route' },
        { page: 'driver-manifest', label: 'Driver Manifest', icon: 'fa-list-check' },
        { page: 'driver-incidents', label: 'Incidents', icon: 'fa-triangle-exclamation' },
        { page: 'inventory', label: 'Service Inventory', icon: 'fa-chair' },
        { page: 'customers', label: 'Customers', icon: 'fa-users' },
      ] },
      { label: 'Back Office', items: [
        { page: 'payments', label: 'Payments', icon: 'fa-wallet' },
        { page: 'refunds', label: 'Refund Requests', icon: 'fa-rotate-left' },
        { page: 'support', label: 'Support Tasks', icon: 'fa-headset' },
        { page: 'handover', label: 'Shift Handover', icon: 'fa-clipboard-list' },
        { page: 'reports', label: 'My Reports', icon: 'fa-file-lines' },
        { page: 'profile', label: 'My Profile', icon: 'fa-user-gear' },
      ] },
    ],
  },
  driver: {
    roleKey: 'driver',
    label: 'Driver',
    consoleName: 'Driver Console',
    route: '/driver/dashboard',
    title: 'Driver Dashboard',
    subtitle: 'View assigned trips, manifests, seat maps, check-in support, incidents, and trip status updates.',
    profileName: 'Driver',
    profileMeta: 'Assigned trips and manifests',
    avatar: 'DR',
    statusLabel: 'On Route',
    statusIcon: 'fa-route',
    createLabel: 'Log Update',
    groups: [
      { label: 'Driver Work', items: [
        { page: 'overview', label: 'Overview', icon: 'fa-chart-line' },
        { page: 'driver-ops', label: 'Assigned Trips', icon: 'fa-route' },
        { page: 'driver-manifest', label: 'Manifest', icon: 'fa-list-check' },
        { page: 'driver-incidents', label: 'Incidents', icon: 'fa-triangle-exclamation' },
        { page: 'checkin', label: 'Check-in Assist', icon: 'fa-qrcode' },
        { page: 'schedule', label: 'Schedules', icon: 'fa-calendar-days' },
      ] },
      { label: 'Reference', items: [
        { page: 'inventory', label: 'Seat Map', icon: 'fa-chair' },
        { page: 'support', label: 'Support Tasks', icon: 'fa-headset' },
        { page: 'handover', label: 'Shift Handover', icon: 'fa-clipboard-list' },
        { page: 'profile', label: 'My Profile', icon: 'fa-user-gear' },
      ] },
    ],
  },
  promoter: {
    roleKey: 'promoter',
    label: 'Promoter / Agent',
    consoleName: 'Promoter Dashboard',
    route: '/promoter/dashboard',
    title: 'Promoter Dashboard',
    subtitle: 'Manage referral links, commissions, withdrawals, shared listings, performance, payout history, offline sales, and support.',
    profileName: 'Promoter',
    profileMeta: 'Referral and agent network',
    avatar: 'PR',
    statusLabel: 'Verified',
    statusIcon: 'fa-user-check',
    createLabel: 'Create Link',
    groups: [
      { label: 'Growth', items: [
        { page: 'overview', label: 'Overview', icon: 'fa-chart-line' },
        { page: 'links', label: 'Referral Links', icon: 'fa-link' },
        { page: 'share', label: 'Share Listings', icon: 'fa-share-nodes' },
        { page: 'bus-dashboard', label: 'Bus Campaigns', icon: 'fa-bus-simple' },
        { page: 'hotel-dashboard', label: 'Hotel Campaigns', icon: 'fa-hotel' },
        { page: 'campaigns', label: 'Campaigns', icon: 'fa-bullhorn' },
        { page: 'performance', label: 'Performance', icon: 'fa-chart-pie' },
      ] },
      { label: 'Agent Sales', items: [
        { page: 'offline-sales', label: 'Offline Sales', icon: 'fa-cash-register' },
        { page: 'bookings', label: 'Referral Bookings', icon: 'fa-ticket' },
        { page: 'fraud', label: 'Traffic Review', icon: 'fa-shield-halved' },
      ] },
      { label: 'Money and Support', items: [
        { page: 'commissions', label: 'Commissions', icon: 'fa-coins' },
        { page: 'withdrawals', label: 'Withdrawals', icon: 'fa-wallet' },
        { page: 'payouts', label: 'Payout History', icon: 'fa-money-bill-transfer' },
        { page: 'support', label: 'Support', icon: 'fa-headset' },
        { page: 'profile', label: 'Profile', icon: 'fa-user-gear' },
      ] },
    ],
  },
  support: {
    roleKey: 'support', label: 'Support', consoleName: 'Support Console', route: '/support/dashboard', title: 'Support Dashboard', subtitle: 'Manage assigned cases, correspondence, refunds, reschedules, internal notes, and escalation queues.', profileName: 'Support agent', profileMeta: 'Customer operations', avatar: 'SU', statusLabel: 'Support', statusIcon: 'fa-headset', createLabel: 'New Case',
    groups: [
      { label: 'Support Work', items: [
        { page: 'overview', label: 'Overview', icon: 'fa-chart-line' },
        { page: 'support', label: 'Support Tasks', icon: 'fa-headset' },
        { page: 'refunds', label: 'Refund Requests', icon: 'fa-rotate-left' },
        { page: 'customers', label: 'Customers', icon: 'fa-users' },
        { page: 'bookings', label: 'Booking Lookup', icon: 'fa-ticket' },
      ] },
      { label: 'Operations', items: [
        { page: 'handover', label: 'Shift Handover', icon: 'fa-clipboard-list' },
        { page: 'reports', label: 'Support Reports', icon: 'fa-file-lines' },
        { page: 'profile', label: 'My Profile', icon: 'fa-user-gear' },
      ] },
    ],
  },
  finance: {
    roleKey: 'finance', label: 'Finance', consoleName: 'Finance Console', route: '/finance/dashboard', title: 'Finance Dashboard', subtitle: 'Review payments, refunds, ledger entries, settlement, payouts, reconciliation, and finance risk.', profileName: 'Finance officer', profileMeta: 'Money movement controls', avatar: 'FI', statusLabel: 'Finance', statusIcon: 'fa-wallet', createLabel: 'New Review',
    groups: [
      { label: 'Finance Work', items: [
        { page: 'overview', label: 'Overview', icon: 'fa-chart-line' },
        { page: 'payments', label: 'Payments', icon: 'fa-wallet' },
        { page: 'refunds', label: 'Refund Requests', icon: 'fa-rotate-left' },
        { page: 'reports', label: 'Finance Reports', icon: 'fa-file-lines' },
        { page: 'support', label: 'Finance Support', icon: 'fa-headset' },
        { page: 'handover', label: 'Shift Handover', icon: 'fa-clipboard-list' },
      ] },
    ],
  },
  operations: {
    roleKey: 'operations', label: 'Operations', consoleName: 'Operations Console', route: '/operations/dashboard', title: 'Operations Dashboard', subtitle: 'Coordinate schedules, manifests, availability, incidents, check-ins, and daily operational reporting.', profileName: 'Operations lead', profileMeta: 'Daily service control', avatar: 'OP', statusLabel: 'Operations', statusIcon: 'fa-clipboard-list', createLabel: 'New Update',
    groups: [
      { label: 'Operations Work', items: [
        { page: 'overview', label: 'Overview', icon: 'fa-chart-line' },
        { page: 'schedule', label: 'Schedules', icon: 'fa-calendar-days' },
        { page: 'driver-ops', label: 'Driver Ops', icon: 'fa-route' },
        { page: 'driver-manifest', label: 'Manifest', icon: 'fa-list-check' },
        { page: 'inventory', label: 'Service Inventory', icon: 'fa-chair' },
        { page: 'driver-incidents', label: 'Incidents', icon: 'fa-triangle-exclamation' },
        { page: 'checkin', label: 'Check-ins', icon: 'fa-qrcode' },
        { page: 'reports', label: 'Operations Reports', icon: 'fa-file-lines' },
      ] },
    ],
  },
  content: {
    roleKey: 'content', label: 'Content Admin', consoleName: 'Content Console', route: '/content/dashboard', title: 'Content Dashboard', subtitle: 'Review marketplace content, listings, service categories, campaigns, media, blogs, and SEO content.', profileName: 'Content admin', profileMeta: 'Marketplace content controls', avatar: 'CO', statusLabel: 'Content', statusIcon: 'fa-pen-to-square', createLabel: 'Create Content',
    groups: [
      { label: 'Content Work', items: [
        { page: 'overview', label: 'Overview', icon: 'fa-chart-line' },
        { page: 'listings', label: 'Listings', icon: 'fa-layer-group' },
        { page: 'ads', label: 'Ads & Promotions', icon: 'fa-rectangle-ad' },
        { page: 'notifications', label: 'Notifications', icon: 'fa-bell' },
        { page: 'reports', label: 'Content Reports', icon: 'fa-file-lines' },
      ] },
    ],
  },

};

const ROLE_ALIASES = {
  super_admin: 'admin',
  admin: 'admin',
  company_admin: 'company',
  company_employee: 'employee',
  customer: 'customer',
  promoter: 'promoter',
  driver: 'driver',
  support_admin: 'support',
  finance_admin: 'finance',
  operations_admin: 'operations',
  content_admin: 'content',
  support_agent: 'support',
  finance_agent: 'finance',
  operations_agent: 'operations',
};

function getDashboardRole(role) {
  return ROLE_DASHBOARDS[role] ? role : ROLE_ALIASES[role] || role || 'customer';
}

function getDashboardMenu(role) {
  return ROLE_DASHBOARDS[getDashboardRole(role)] || ROLE_DASHBOARDS.customer;
}

function allDashboardMenus() {
  return ROLE_DASHBOARDS;
}

module.exports = { ROLE_DASHBOARDS, ROLE_ALIASES, getDashboardRole, getDashboardMenu, allDashboardMenus };
