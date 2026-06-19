const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../../src/app');
const repositories = require('../../src/repositories');
const masterDocCoverage = require('../../src/services/implementation/masterDocCoverageService');

const root = path.resolve(__dirname, '../..');

async function login(email) {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ identity: email, password: 'Password123' }).expect(302);
  return agent;
}

describe('Master Document A-N implementation audit', () => {
  test('every A-N section has files, collections, repositories, frontend evidence and tests', () => {
    const audit = masterDocCoverage.audit();
    expect(audit.complete).toBe(true);
    expect(audit.status).toBe('implemented');
    expect(audit.sections.map((section) => section.id)).toEqual('ABCDEFGHIJKLMN'.split(''));

    for (const section of audit.sections) {
      expect(section.requirements.length).toBeGreaterThan(0);
      expect(section.missing).toEqual([]);
      expect(section.evidence.files.every((item) => item.ok)).toBe(true);
      expect(section.evidence.tests.every((item) => item.ok)).toBe(true);
      expect(section.evidence.collections.every((item) => item.ok)).toBe(true);
      expect(section.evidence.collections.every((item) => item.repository || section.id === 'N')).toBe(true);
      expect(section.evidence.models.every((item) => item.ok)).toBe(true);
    }
  });

  test('repository registry now covers every production model file, not only the demo core models', () => {
    const modelNames = fs.readdirSync(path.join(root, 'src/models'))
      .filter((file) => file.endsWith('.js') && file !== '_helpers.js')
      .map((file) => path.basename(file, '.js'));
    const mappedModels = new Set(Object.values(repositories.entityModelMap));
    const missing = modelNames.filter((model) => !mappedModels.has(model));
    expect(missing).toEqual([]);
  });

  test('Super Admin can view the live A-N implementation audit as page, JSON and CSV', async () => {
    const admin = await login('admin@classictrip.test');
    const page = await admin.get('/admin/master-implementation').expect(200);
    expect(page.text).toContain('Master Document A-N Implementation Audit');
    expect(page.text).toContain('Implemented sections: 14/14');
    expect(page.text).toContain('A. Super Admin controlled partner and driver onboarding');
    expect(page.text).toContain('N. Required acceptance tests');

    const json = await admin.get('/admin/master-implementation.json').expect(200);
    expect(json.body.complete).toBe(true);
    expect(json.body.sections).toHaveLength(14);
    expect(json.body.sections.find((section) => section.id === 'K').requirements.join(' ')).toContain('feature flags');

    const csv = await admin.get('/admin/master-implementation.csv').expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('Section,Title,Status');
    expect(csv.text).toContain('implemented');
  });
});
