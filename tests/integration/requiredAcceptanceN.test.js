const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../../src/app');
const acceptanceMatrix = require('../acceptance/masterAcceptanceMatrix');

const root = path.resolve(__dirname, '../..');

async function login(email) {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ identity: email, password: 'Password123' }).expect(302);
  return agent;
}

describe('Master section N - Required acceptance tests', () => {
  test('N acceptance matrix covers every master-doc acceptance criterion with executable evidence files', () => {
    expect(acceptanceMatrix).toHaveLength(21);
    const ids = acceptanceMatrix.map((item) => item.id);
    expect(new Set(ids).size).toBe(21);
    expect(ids).toEqual(Array.from({ length: 21 }, (_, index) => `N-${String(index + 1).padStart(2, '0')}`));

    const requiredPhrases = [
      'Super Admin creates lead',
      'Company accepts invite',
      'Super Admin verifies company',
      'Super Admin invites driver',
      'Company creates route',
      'Customer books one-way bus ticket',
      'Customer books round-trip',
      'multiple seats/tickets',
      'Customer books hotel room',
      'hold expires',
      'Booked seat appears',
      'manifest page prints',
      'Payment webhook success',
      'QR scan checks in',
      'manifest updates after check-in',
      'Refund reverses',
      'Promoter referral link attributes',
      'Support correspondence appears',
      'Suspended or unverified company',
      'Unified dashboard sidebar',
      'Future services',
    ];

    for (const phrase of requiredPhrases) {
      expect(acceptanceMatrix.some((item) => item.criterion.includes(phrase))).toBe(true);
    }

    for (const item of acceptanceMatrix) {
      expect(item.criterion).toBeTruthy();
      expect(item.section).toBeTruthy();
      expect(item.backend.length).toBeGreaterThan(0);
      expect(item.frontend.length).toBeGreaterThan(0);
      expect(item.evidence.length).toBeGreaterThan(0);
      for (const relativeFile of item.evidence) {
        const fullPath = path.join(root, relativeFile);
        expect(fs.existsSync(fullPath)).toBe(true);
        const body = fs.readFileSync(fullPath, 'utf8');
        expect(body).toMatch(/describe\(|test\(|it\(/);
        expect(body).toMatch(/expect\(/);
      }
    }
  });

  test('N has a backend-to-frontend smoke path for each dashboard role and required public surfaces', async () => {
    const dashboardChecks = [
      ['admin@classictrip.test', '/admin', 'dashboard'],
      ['company@classictrip.test', '/company/dashboard', 'dashboard'],
      ['employee@classictrip.test', '/employee/dashboard', 'dashboard'],
      ['amina@classictrip.test', '/account', 'dashboard'],
      ['samuel@classictrip.test', '/promoter/dashboard', 'dashboard'],
      ['employee@classictrip.test', '/support/dashboard', 'dashboard'],
      ['admin@classictrip.test', '/finance/dashboard', 'dashboard'],
      ['employee@classictrip.test', '/operations/dashboard', 'dashboard'],
    ];

    for (const [email, route, expectedText] of dashboardChecks) {
      const agent = await login(email);
      const res = await agent.get(route).expect(200);
      expect(res.text.toLowerCase()).toContain(expectedText);
      expect(res.text).toContain('dashboardSidebar');
      expect(res.text).toContain('dashboardShellTopbar');
    }

    const publicChecks = [
      ['/partner/onboarding', 'Partner'],
      ['/future-services', 'Future services'],
    ];
    for (const [route, expectedText] of publicChecks) {
      const res = await request(app).get(route).expect(200);
      expect(res.text).toContain(expectedText);
    }
  });

  test('N exposes acceptance evidence through npm scripts and a machine-readable matrix', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(packageJson.scripts['test:acceptance']).toBe('jest --runInBand tests/integration/requiredAcceptanceN.test.js --silent');
    expect(packageJson.scripts['acceptance:matrix']).toBe('node scripts/acceptance-matrix.js');
    expect(fs.existsSync(path.join(root, 'scripts/acceptance-matrix.js'))).toBe(true);

    const sectionsCovered = new Set(acceptanceMatrix.flatMap((item) => item.section.split('/')));
    for (const section of 'ABCDEFGHIJKLM'.split('')) {
      expect(sectionsCovered.has(section)).toBe(true);
    }
  });
});
