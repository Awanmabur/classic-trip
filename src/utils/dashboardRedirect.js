const ROLE_DASHBOARD_MAP = {
  super_admin: '/admin',
  admin: '/operations/dashboard',
  finance_admin: '/finance/dashboard',
  support_admin: '/support/dashboard',
  operations_admin: '/operations/dashboard',
  content_admin: '/content/dashboard',
  company_admin: '/company/dashboard',
  company_employee: '/employee/dashboard',
  driver: '/driver/dashboard',
  promoter: '/promoter/dashboard',
  customer: '/account',
};

function redirectForRole(role) {
  return ROLE_DASHBOARD_MAP[role] || '/account';
}

module.exports = { redirectForRole };
