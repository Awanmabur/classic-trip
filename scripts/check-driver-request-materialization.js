'use strict';

const Module = require('module');
const path = require('path');

let passed = 0;
function check(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  passed += 1;
}

function matches(row, filter = {}) {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') return expected.some((item) => matches(row, item));
    const actual = row[key];
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      if ('$nin' in expected) return !expected.$nin.includes(actual);
      if ('$regex' in expected) return expected.$regex.test(String(actual || ''));
    }
    return String(actual ?? '') === String(expected ?? '');
  });
}

function collection(rows) {
  return {
    async findOne(filter = {}) { return rows.find((row) => matches(row, filter)) || null; },
    async save(row, filter = {}) {
      const index = rows.findIndex((item) => matches(item, filter));
      if (index >= 0) rows[index] = row;
      else rows.push(row);
      return row;
    },
    async list(filter = {}) { return rows.filter((row) => matches(row, filter)); },
    async count(filter = {}) { return rows.filter((row) => matches(row, filter)).length; },
  };
}

async function main() {
  const employees = [{
    id: 'driver-membership-1', companyId: 'company-1', userId: 'driver-user-1',
    roleTitle: 'Driver', serviceCategories: ['driver', 'bus'],
    permissions: ['manifest.view', 'checkin.assist', 'trip.status.update', 'incident.create'],
    licenseNumber: 'DL-1', safetyStatus: 'cleared', status: 'active', acceptedAt: new Date().toISOString(),
  }];
  const users = [{
    id: 'driver-user-1', companyId: 'company-1', role: 'driver', status: 'active',
    verificationStatus: 'company_verified', passwordHash: 'stored-hash', fullName: 'Verified Driver',
  }];
  const repository = {
    employees: collection(employees), users: collection(users),
    async audit() { return null; },
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    const parentFile = String(parent?.filename || '');
    if (parentFile.endsWith(path.join('bus', 'services', 'busDepartureService.js'))) {
      if (request === '../repositories/busRepository') return repository;
      if (request === './busSetupService') return {};
    }
    return originalLoad.apply(this, arguments);
  };

  try {
    const servicePath = path.join(process.cwd(), 'src/modules/bus/services/busDepartureService.js');
    delete require.cache[require.resolve(servicePath)];
    const service = require(servicePath);

    let rejectedCandidate = false;
    try { await service.resolveDriver('company-1', 'request:request-1'); } catch (error) {
      rejectedCandidate = /active, verified driver/i.test(String(error.message || ''));
    }
    check(rejectedCandidate, 'A saved request must not be assignable before invitation acceptance and verification.');

    const resolved = await service.resolveDriver('company-1', 'driver-membership-1');
    check(resolved.employee.id === 'driver-membership-1', 'The canonical active driver membership must resolve.');
    check(resolved.user.id === 'driver-user-1', 'The linked dedicated driver account must resolve.');
    check(resolved.assignment.assignable === true, 'A fully verified driver must be assignable.');

    employees[0].safetyStatus = 'pending';
    let blockedUnsafe = false;
    try { await service.resolveDriver('company-1', 'driver-membership-1'); } catch (error) {
      blockedUnsafe = /safety clearance/i.test(String(error.message || ''));
    }
    check(blockedUnsafe, 'A driver without cleared safety status must be blocked.');
  } finally {
    Module._load = originalLoad;
  }

  console.log(`Strict driver assignment source verification passed (${passed}/${passed}).`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
