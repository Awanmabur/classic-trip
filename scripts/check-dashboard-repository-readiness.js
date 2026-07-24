'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const repositoryPath = path.join(root, 'src/repositories/mongoRepository.js');
const repositorySource = fs.readFileSync(repositoryPath, 'utf8');
const registrySource = fs.readFileSync(path.join(root, 'src/repositories/index.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(root, 'src/services/dashboard/mongoDashboardService.js'), 'utf8');
const snapshotSource = fs.readFileSync(path.join(root, 'src/services/dashboard/dashboardSnapshotService.js'), 'utf8');

function loadRepositoryWithState(readyState) {
  const fakeMongoose = {
    connection: { readyState },
    model() { return {}; },
  };
  const sandbox = {
    module: { exports: {} },
    exports: {},
    require(request) {
      if (request === '../config/db') return { mongoose: fakeMongoose };
      throw new Error(`Unexpected dependency in repository readiness check: ${request}`);
    },
  };
  vm.runInNewContext(repositorySource, sandbox, { filename: repositoryPath });
  const repository = new sandbox.module.exports.MongoRepository({ entity: 'companies', modelName: 'Company' });
  return { repository, exports: sandbox.module.exports };
}

let connectedContract = false;
let disconnectedContract = false;
try {
  const connected = loadRepositoryWithState(1);
  connectedContract = connected.repository.isReady() === true && connected.repository.assertReady() === connected.repository;

  const disconnected = loadRepositoryWithState(0);
  try {
    disconnected.repository.assertReady();
  } catch (error) {
    disconnectedContract = error.status === 503
      && error.code === 'mongodb_unavailable'
      && /database connection is temporarily unavailable/i.test(error.publicMessage || '');
  }
} catch (error) {
  console.error(error.stack || error.message);
}

const checks = [
  ['MongoRepository implements isReady()', /isReady\(\)\s*\{\s*return mongoReady\(\);\s*\}/s.test(repositorySource)],
  ['MongoRepository implements assertReady()', /assertReady\(\)\s*\{\s*requireMongo\(this\.entity\);/s.test(repositorySource)],
  ['connected repository passes the runtime readiness contract', connectedContract],
  ['disconnected repository returns a typed HTTP 503 error', disconnectedContract],
  ['repository registry exports readyRepository()', /function readyRepository\(entity\)/.test(registrySource) && /repository\.isReady\(\)/.test(registrySource) && /readyRepository,/.test(registrySource)],
  ['dashboard entity reads use readyRepository()', /repositories\.readyRepository\(entity\)/.test(dashboardSource)],
  ['dashboard snapshots use readyRepository()', (snapshotSource.match(/repositories\.readyRepository\(entity\)/g) || []).length >= 2],
  ['dashboard no longer probes an undefined optional isReady method', !/repo(?:sitory)?\?\.isReady\?\./.test(dashboardSource + snapshotSource)],
];

const failed = checks.filter(([, passed]) => !passed);
for (const [label, passed] of checks) console.log(`${passed ? 'PASS' : 'FAIL'} ${label}`);
if (failed.length) process.exit(1);
console.log(`Dashboard repository readiness checks passed (${checks.length}/${checks.length}).`);
