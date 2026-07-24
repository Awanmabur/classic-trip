'use strict';

const { normalizePermissions, REQUIRED_DRIVER_PERMISSIONS } = require('../../config/accessControl');

const OPERATIONAL_DRIVER_VERIFICATION_STATUSES = new Set(['verified', 'company_verified']);

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function userIdentity(user = {}) {
  return String(user.id || user._id || '');
}

function isDriverAccountOperational(user = {}) {
  return normalize(user.role) === 'driver'
    && normalize(user.status) === 'active'
    && OPERATIONAL_DRIVER_VERIFICATION_STATUSES.has(normalize(user.verificationStatus));
}

function isDriverConfigured(employee = {}, user = {}) {
  const permissions = normalizePermissions(employee.permissions || []);
  const serviceCategories = Array.isArray(employee.serviceCategories) ? employee.serviceCategories : [];
  const accountIsDriver = normalize(user.role) === 'driver';
  const membershipIsDriver = /driver/i.test(String(employee.roleTitle || ''))
    || serviceCategories.some((category) => normalize(category) === 'driver')
    || REQUIRED_DRIVER_PERMISSIONS.every((permission) => permissions.includes(permission));
  return accountIsDriver && membershipIsDriver;
}


function documentReference(document = {}) {
  return String(document.documentReference || document.reference || document.url || document.secureUrl || '').trim();
}

function evaluatePartnerDriverActivation(employee = {}, user = {}) {
  const reasons = [];
  const documents = Array.isArray(employee.documents) ? employee.documents : [];
  const licenseDocument = documents.find((document) => {
    const type = normalize(document.documentType || document.type);
    return (!type || type === 'driver_license' || type === 'licence' || type === 'license') && documentReference(document);
  });

  if (!employee || !String(employee.id || '').trim()) reasons.push('driver membership is missing');
  if (!isDriverConfigured(employee, user)) reasons.push('employee role is not configured as Driver');
  if (normalize(user.role) !== 'driver') reasons.push('linked account role is not Driver');
  if (!user.passwordHash || !employee.acceptedAt) reasons.push('driver must accept the invitation and finish account setup');
  if (['blocked', 'suspended'].includes(normalize(user.status))) reasons.push('linked driver account is blocked or suspended');
  if (!String(employee.licenseNumber || '').trim()) reasons.push('driver licence number is missing');
  if (!licenseDocument) reasons.push('driver licence document or reference is missing');
  if (employee.licenseExpiresAt && new Date(employee.licenseExpiresAt).getTime() <= Date.now()) reasons.push('driver licence has expired');

  return {
    ready: reasons.length === 0,
    accountSetupComplete: Boolean(user.passwordHash && employee.acceptedAt && normalize(user.role) === 'driver'),
    reasons,
    employeeId: String(employee.id || ''),
    userId: userIdentity(user) || String(employee.userId || ''),
    licenseDocumentReference: licenseDocument ? documentReference(licenseDocument) : '',
  };
}

function evaluateDriverEligibility(employee = {}, user = {}) {
  const reasons = [];
  const permissions = new Set(normalizePermissions(employee.permissions || []));

  if (!employee || !String(employee.id || '').trim()) reasons.push('driver membership is missing');
  if (!isDriverConfigured(employee, user)) reasons.push('employee role is not configured as Driver');
  if (normalize(employee.status) !== 'active') reasons.push('company membership is not active');
  if (normalize(employee.safetyStatus) !== 'cleared') reasons.push('safety clearance is not approved');
  if (!String(employee.licenseNumber || '').trim()) reasons.push('approved licence number is missing');
  if (normalize(user.role) !== 'driver') reasons.push('linked account role is not Driver');
  if (normalize(user.status) !== 'active') reasons.push('linked driver account is not active');
  if (!OPERATIONAL_DRIVER_VERIFICATION_STATUSES.has(normalize(user.verificationStatus))) reasons.push('partner or platform verification is incomplete');

  const missingPermissions = REQUIRED_DRIVER_PERMISSIONS.filter((permission) => !permissions.has(permission));
  if (missingPermissions.length) reasons.push(`required permissions are missing: ${missingPermissions.join(', ')}`);

  return {
    eligible: reasons.length === 0,
    reasons,
    employeeId: String(employee.id || ''),
    userId: userIdentity(user) || String(employee.userId || ''),
    label: String(user.fullName || user.name || user.email || employee.roleTitle || employee.id || 'Driver'),
    licenseNumber: String(employee.licenseNumber || ''),
    approvalSource: normalize(user.verificationStatus) === 'company_verified' ? 'partner_admin' : 'platform',
  };
}


function evaluateDriverAssignment(employee = {}, user = {}) {
  const eligibility = evaluateDriverEligibility(employee, user);
  return {
    assignable: eligibility.eligible,
    eligible: eligibility.eligible,
    operational: eligibility.eligible,
    reasons: eligibility.reasons,
    warnings: [],
    employeeId: eligibility.employeeId,
    userId: eligibility.userId,
    label: eligibility.label,
    employeeStatus: normalize(employee.status) || 'unknown',
    userStatus: normalize(user.status) || 'not_linked',
    verificationStatus: normalize(user.verificationStatus) || 'not_verified',
    safetyStatus: normalize(employee.safetyStatus) || 'not_submitted',
  };
}


module.exports = {
  OPERATIONAL_DRIVER_VERIFICATION_STATUSES,
  evaluateDriverAssignment,
  evaluateDriverEligibility,
  evaluatePartnerDriverActivation,
  isDriverAccountOperational,
  isDriverConfigured,
  userIdentity,
};
