#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  csrfToken,
  requireCsrfToken,
} = require('../src/middlewares/csrf');

const root = path.resolve(__dirname, '..');
let checks = 0;
function check(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}

function invoke(middleware, req, res) {
  let nextCalled = false;
  let nextError = null;
  middleware(req, res, (error) => {
    nextCalled = true;
    nextError = error || null;
  });
  return { nextCalled, nextError };
}

function responseStub() {
  return {
    locals: {},
    cookies: [],
    cookie(name, value, options) {
      this.cookies.push({ name, value, options });
    },
  };
}

const previousNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'development';
try {
  const session = {};
  const getReq = {
    method: 'GET',
    path: '/company/listings',
    headers: {},
    session,
    body: {},
    secure: false,
  };
  const getRes = responseStub();
  const getResult = invoke(csrfToken, getReq, getRes);
  check(getResult.nextCalled && !getResult.nextError, 'GET request must seed CSRF and continue');
  check(Boolean(session.csrfToken), 'GET request must seed a session CSRF token');
  check(typeof getReq.csrfToken === 'function' && getReq.csrfToken() === session.csrfToken, 'req.csrfToken must expose the current token');
  check(getRes.locals.csrfToken === session.csrfToken, 'CSRF token must be available to templates');

  const multipartReq = {
    method: 'POST',
    path: '/company/listings',
    headers: {
      'content-type': 'multipart/form-data; boundary=classic-trip-test',
      host: 'localhost:5000',
      origin: 'http://localhost:5000',
    },
    session,
    body: {}, // Multer has not parsed the form yet.
    secure: false,
  };
  const multipartRes = responseStub();
  const deferred = invoke(csrfToken, multipartReq, multipartRes);
  check(deferred.nextCalled && !deferred.nextError, 'Global CSRF middleware must defer multipart verification until Multer parses the form');
  check(multipartReq.csrfValidationDeferred === true, 'Multipart request must be explicitly marked as deferred');


  const crossOriginReq = {
    ...multipartReq,
    headers: {
      ...multipartReq.headers,
      origin: 'https://attacker.example',
    },
    body: {},
  };
  const crossOrigin = invoke(csrfToken, crossOriginReq, responseStub());
  check(crossOrigin.nextCalled && crossOrigin.nextError?.status === 403, 'Cross-origin multipart submission must be rejected before file parsing');

  const originlessReq = {
    ...multipartReq,
    headers: {
      'content-type': 'multipart/form-data; boundary=classic-trip-test',
      host: 'localhost:5000',
    },
    body: {},
  };
  const originless = invoke(csrfToken, originlessReq, responseStub());
  check(originless.nextCalled && !originless.nextError, 'Origin-less multipart requests must defer to the parsed cryptographic token');
  check(originlessReq.csrfValidationDeferred === true, 'Origin-less multipart requests must be marked for route-level verification');
  originlessReq.body = { _csrf: session.csrfToken };
  const originlessVerified = invoke(requireCsrfToken, originlessReq, responseStub());
  check(originlessVerified.nextCalled && !originlessVerified.nextError, 'Origin-less multipart requests with a valid parsed token must pass');

  const headerReq = {
    ...multipartReq,
    headers: {
      'content-type': 'multipart/form-data; boundary=classic-trip-test',
      host: 'localhost:5000',
      'x-csrf-token': session.csrfToken,
    },
    body: {},
  };
  const headerResult = invoke(csrfToken, headerReq, responseStub());
  check(headerResult.nextCalled && !headerResult.nextError, 'Multipart upload with a valid explicit CSRF header must pass preflight verification');
  check(headerReq.csrfValidationComplete === true, 'Header-verified multipart request must be marked complete');
  const headerRouteResult = invoke(requireCsrfToken, headerReq, responseStub());
  check(headerRouteResult.nextCalled && !headerRouteResult.nextError, 'Route verifier must not reject a multipart request already verified by header');

  multipartReq.body = { _csrf: session.csrfToken, serviceType: 'bus' }; // Simulate Multer parsing fields.
  const verified = invoke(requireCsrfToken, multipartReq, multipartRes);
  check(verified.nextCalled && !verified.nextError, 'Route-level multipart CSRF verification must accept the parsed hidden token');

  const missingReq = {
    ...multipartReq,
    body: { serviceType: 'bus' },
  };
  const missing = invoke(requireCsrfToken, missingReq, responseStub());
  check(missing.nextCalled && missing.nextError?.status === 403, 'Multipart request without a parsed token must be rejected');
  check(missing.nextError?.code === 'invalid_csrf_token', 'CSRF rejection must expose a stable internal error code');

  const normalReq = {
    method: 'POST',
    path: '/company/settings',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    session,
    body: { _csrf: session.csrfToken },
    secure: false,
  };
  const normal = invoke(csrfToken, normalReq, responseStub());
  check(normal.nextCalled && !normal.nextError, 'Non-multipart form CSRF verification must remain active globally');
} finally {
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
}

const routeFiles = [
  'src/routes/web/company.js',
  'src/routes/web/admin.js',
  'src/routes/api/uploads.js',
];
for (const relative of routeFiles) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  check(source.includes("require('../../middlewares/csrf')"), `${relative} must import multipart CSRF verification`);
  const chunks = source.split('router.post(').slice(1).map((chunk) => `router.post(${chunk.split(/\nrouter\.(?:post|get|put|patch|delete)\(/)[0]}`);
  const uploadRoutes = chunks.filter((chunk) => /upload\.(?:single|fields|array)\(/.test(chunk));
  check(uploadRoutes.length > 0, `${relative} must contain the expected upload route(s)`);
  for (const route of uploadRoutes) {
    const uploadIndex = route.search(/upload\.(?:single|fields|array)\(/);
    const csrfIndex = route.indexOf('requireCsrfToken');
    check(csrfIndex > uploadIndex, `${relative} upload route must validate CSRF after Multer parses multipart fields`);
  }
}

const companyRoutes = fs.readFileSync(path.join(root, 'src/routes/web/company.js'), 'utf8');
const createListing = companyRoutes.match(/router\.post\('\/company\/listings',[\s\S]*?listingController\.create\);/)?.[0] || '';
check(Boolean(createListing), 'Bus/company listing create route must exist');
check(createListing.indexOf("upload.single('imageFile')") < createListing.indexOf('requireCsrfToken'), 'Listing upload must run before route-level CSRF verification');
check(createListing.indexOf('requireCsrfToken') < createListing.indexOf("requireCompanyOwnService('serviceType')"), 'Company service validation must run after Multer and CSRF so serviceType is available and trusted');

const workspace = fs.readFileSync(path.join(root, 'public/js/dashboard-workspace.js'), 'utf8');
check(/id="crudForm"[\s\S]{0,220}name="_csrf" value="\$\{csrfToken\}"/.test(workspace), 'Dynamic CRUD upload form must include the CSRF hidden field');
check(/enctype="multipart\/form-data"/.test(workspace), 'Dynamic listing form must use multipart encoding when a file field exists');
check(/ClassicTripCsrf\?\.token\(\)/.test(workspace), 'Dynamic dashboard forms must prefer the live CSRF helper over stale bootstrap data');
const csrfClient = fs.readFileSync(path.join(root, 'public/js/csrf.js'), 'utf8');
check(/XSRF-TOKEN/.test(csrfClient), 'Browser CSRF helper must read the server-refreshed token cookie');
check(/input\.value = value/.test(csrfClient), 'Browser CSRF helper must refresh existing hidden token fields');
check(/addEventListener\('formdata'/.test(csrfClient), 'Browser CSRF helper must update the final native multipart payload');

console.log(`Multipart CSRF verification passed: ${checks}/${checks}`);
