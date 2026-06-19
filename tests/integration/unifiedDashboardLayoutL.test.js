const request = require('supertest');
const app = require('../../src/app');
const { getDashboardMenu, allDashboardMenus } = require('../../src/config/dashboardMenus');

async function login(email) {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ identity: email, password: 'Password123' }).expect(302);
  return agent;
}

function expectUnifiedShell(html, roleLabel) {
  expect(html).toContain('dashboardShellSidebar');
  expect(html).toContain('dashboardShellTopbar');
  expect(html).toContain('data-config-driven="true"');
  expect(html).toContain('dashboardMenuSearch');
  expect(html).toContain('navGroup');
  expect(html).toContain('notificationBadge');
  expect(html).toContain('dashboardGlobalSearch');
  expect(html).toContain('breadcrumbs');
  expect(html).toContain(roleLabel);
}

describe('Master section L - unified dashboard layout', () => {
  test('L is end-to-end: dashboards share one config-driven sidebar/topbar shell with required controls', async () => {
    const menus = allDashboardMenus();
    expect(Object.keys(menus)).toEqual(expect.arrayContaining(['admin', 'company', 'driver', 'employee', 'customer', 'promoter', 'support', 'finance', 'operations']));
    expect(getDashboardMenu('admin').groups[0].items[0].page).toBe('overview');
    expect(getDashboardMenu('company').groups.some((group) => group.items.some((item) => item.page === 'payouts'))).toBe(true);
    expect(getDashboardMenu('driver').groups.some((group) => group.items.some((item) => item.page === 'driver-manifest'))).toBe(true);
    expect(getDashboardMenu('support').groups.some((group) => group.items.some((item) => item.page === 'support'))).toBe(true);
    expect(getDashboardMenu('finance').groups.some((group) => group.items.some((item) => item.page === 'payments'))).toBe(true);
    expect(getDashboardMenu('operations').groups.some((group) => group.items.some((item) => item.page === 'driver-incidents'))).toBe(true);

    const admin = await login('admin@classictrip.test');
    const adminPage = await admin.get('/admin').expect(200);
    expectUnifiedShell(adminPage.text, 'Super Admin');
    expect(adminPage.text).toContain('dashboardRoleSwitcher');
    expect(adminPage.text).toContain('Company Workspace');
    expect(adminPage.text).toContain('Operations');
    expect(adminPage.text).toContain('Reports');

    const company = await login('company@classictrip.test');
    const companyPage = await company.get('/company/dashboard').expect(200);
    expectUnifiedShell(companyPage.text, 'Bus Operations');
    expect(companyPage.text).toContain('dashboardCompanySelector');
    expect(companyPage.text).toContain('Staff & Roles');

    const employee = await login('employee@classictrip.test');
    const employeePage = await employee.get('/employee/dashboard').expect(200);
    expectUnifiedShell(employeePage.text, 'Company Staff');
    expect(employeePage.text).toContain('Ticket Check-in');

    const driverPage = await employee.get('/driver/dashboard').expect(200);
    expectUnifiedShell(driverPage.text, 'Driver');
    expect(driverPage.text).toContain('Assigned Trips');

    const supportPage = await admin.get('/support/dashboard').expect(200);
    expectUnifiedShell(supportPage.text, 'Support');
    expect(supportPage.text).toContain('Booking Lookup');

    const financePage = await admin.get('/finance/dashboard').expect(200);
    expectUnifiedShell(financePage.text, 'Finance');
    expect(financePage.text).toContain('Finance Reports');

    const operationsPage = await admin.get('/operations/dashboard').expect(200);
    expectUnifiedShell(operationsPage.text, 'Operations');
    expect(operationsPage.text).toContain('Operations Reports');

    const customer = await login('amina@classictrip.test');
    const customerPage = await customer.get('/account').expect(200);
    expectUnifiedShell(customerPage.text, 'Customer');
    expect(customerPage.text).toContain('Saved Trips');

    const promoter = await login('samuel@classictrip.test');
    const promoterPage = await promoter.get('/promoter/dashboard').expect(200);
    expectUnifiedShell(promoterPage.text, 'Promoter / Agent');
    expect(promoterPage.text).toContain('Offline Sales');
  });
});
