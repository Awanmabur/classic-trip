const request = require('supertest');
const app = require('../../src/app');
const store = require('../../src/services/data/persistentStore');

async function login(email) {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ identity: email, password: 'Password123' }).expect(302);
  return agent;
}

function tomorrowDateOnly() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

test('POST /company/schedule-rules creates a rule, and pause/resume/cancel routes update its status', async () => {
  const agent = await login('company@classictrip.test');
  const route = store.state.routes.find((item) => item.companyId === 'company-01');
  const vehicle = store.state.vehicles.find((item) => item.companyId === 'company-01' && item.status !== 'archived');
  expect(route).toBeTruthy();
  expect(vehicle).toBeTruthy();

  await agent.post('/company/schedule-rules').type('form').send({
    routeId: route.id,
    vehicleId: vehicle.id,
    departureTime: '07:00',
    startDate: tomorrowDateOnly(),
    basePrice: '35000',
  }).expect(302);

  const rule = store.state.scheduleRules.find((item) => item.companyId === 'company-01' && item.routeId === route.id && item.departureTime === '07:00');
  expect(rule).toBeTruthy();
  expect(rule.status).toBe('active');

  await agent.post(`/company/schedule-rules/${rule.id}/pause`).type('form').send({}).expect(302);
  expect(store.state.scheduleRules.find((item) => item.id === rule.id).status).toBe('paused');

  await agent.post(`/company/schedule-rules/${rule.id}/resume`).type('form').send({}).expect(302);
  expect(store.state.scheduleRules.find((item) => item.id === rule.id).status).toBe('active');

  await agent.post(`/company/schedule-rules/${rule.id}/cancel`).type('form').send({}).expect(302);
  expect(store.state.scheduleRules.find((item) => item.id === rule.id).status).toBe('cancelled');
});
