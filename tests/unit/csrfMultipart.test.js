'use strict';

const { csrfToken, requireCsrfToken } = require('../../src/middlewares/csrf');

function resStub() {
  return { locals: {}, cookie: jest.fn() };
}

function run(middleware, req, res = resStub()) {
  return new Promise((resolve) => middleware(req, res, (error) => resolve({ error, res })));
}

describe('multipart CSRF lifecycle', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });

  afterAll(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  test('defers native same-origin multipart forms until Multer parses _csrf', async () => {
    const session = { csrfToken: 'a'.repeat(64) };
    const req = {
      method: 'POST',
      path: '/company/listings',
      session,
      secure: false,
      body: {},
      headers: {
        host: 'localhost:5000',
        origin: 'http://localhost:5000',
        'content-type': 'multipart/form-data; boundary=test',
      },
    };

    expect((await run(csrfToken, req)).error).toBeUndefined();
    expect(req.csrfValidationDeferred).toBe(true);

    req.body = { _csrf: session.csrfToken, serviceType: 'bus' };
    expect((await run(requireCsrfToken, req)).error).toBeUndefined();
  });

  test('rejects cross-origin multipart before upload parsing', async () => {
    const req = {
      method: 'POST',
      path: '/company/listings',
      session: { csrfToken: 'a'.repeat(64) },
      secure: false,
      body: {},
      headers: {
        host: 'localhost:5000',
        origin: 'https://attacker.example',
        'content-type': 'multipart/form-data; boundary=test',
      },
    };

    const { error } = await run(csrfToken, req);
    expect(error).toMatchObject({ status: 403, code: 'invalid_csrf_token' });
  });

  test('accepts origin-less multipart only after the parsed token is verified', async () => {
    const session = { csrfToken: 'a'.repeat(64) };
    const req = {
      method: 'POST',
      path: '/company/bus-services',
      session,
      secure: false,
      body: {},
      headers: {
        host: 'localhost:5000',
        'content-type': 'multipart/form-data; boundary=test',
      },
    };

    expect((await run(csrfToken, req)).error).toBeUndefined();
    expect(req.csrfValidationDeferred).toBe(true);

    req.body = { _csrf: session.csrfToken };
    expect((await run(requireCsrfToken, req)).error).toBeUndefined();
  });

  test('normalizes default HTTPS ports when checking multipart origin', async () => {
    const req = {
      method: 'POST',
      path: '/company/bus-services',
      session: { csrfToken: 'a'.repeat(64) },
      secure: true,
      body: {},
      headers: {
        host: 'classic-trip.example:443',
        origin: 'https://classic-trip.example',
        'content-type': 'multipart/form-data; boundary=test',
      },
    };

    expect((await run(csrfToken, req)).error).toBeUndefined();
    expect(req.csrfValidationDeferred).toBe(true);
  });

  test('rejects multipart when parsed hidden token is missing', async () => {
    const session = { csrfToken: 'a'.repeat(64) };
    const req = {
      method: 'POST',
      path: '/company/listings',
      session,
      secure: false,
      body: {},
      headers: {
        host: 'localhost:5000',
        origin: 'http://localhost:5000',
        'content-type': 'multipart/form-data; boundary=test',
      },
    };

    await run(csrfToken, req);
    req.body = { serviceType: 'bus' };
    const { error } = await run(requireCsrfToken, req);
    expect(error).toMatchObject({ status: 403, code: 'invalid_csrf_token' });
  });
});
