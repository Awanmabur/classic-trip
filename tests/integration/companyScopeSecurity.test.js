const request = require('supertest');
const app = require('../../src/app');

async function login(email) {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ identity: email, password: 'Password123' });
  return agent;
}

test('company users cannot spoof another company id on scoped API routes', async () => {
  const company = await login('company@classictrip.test');
  const res = await company
    .post('/api/scanner/lookup')
    .send({ companyId: 'not-company-01', bookingRef: 'CT-UNKNOWN' });
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('company_scope_denied');
});
