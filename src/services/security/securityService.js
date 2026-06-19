const crypto = require('crypto');
const store = require('../data/persistentStore');
const repositories = require('../../repositories');

const SENSITIVE_KEYS = /password|token|secret|signature|authorization|cookie|card|cvv|pin|rawpayload|reset/i;

function nowIso() {
  return new Date().toISOString();
}

function nextId(prefix, rows = []) {
  let index = rows.length + 1;
  let id = `${prefix}-${index}`;
  while (rows.some((row) => row.id === id)) {
    index += 1;
    id = `${prefix}-${index}`;
  }
  return id;
}

async function persist(entity, row) {
  if (repositories[entity]) await repositories[entity].upsert(row);
  return row;
}

function sha256(value = '') {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function fingerprint(req = {}) {
  return sha256([req.ip || '', req.headers?.['user-agent'] || '', req.headers?.['accept-language'] || ''].join('|')).slice(0, 32);
}

function sessionHash(req = {}) {
  return sha256(req.sessionID || req.session?.id || `${Date.now()}-${Math.random()}`).slice(0, 48);
}

function maskValue(value = '') {
  const text = String(value ?? '');
  if (!text) return '';
  if (text.includes('@')) {
    const [name, domain] = text.split('@');
    return `${name.slice(0, 2)}***@${domain}`;
  }
  if (text.length <= 4) return '***';
  return `${text.slice(0, 2)}***${text.slice(-2)}`;
}

function maskSensitive(value) {
  if (Array.isArray(value)) return value.map(maskSensitive);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SENSITIVE_KEYS.test(key) ? maskValue(item) : maskSensitive(item),
  ]));
}

function requestContext(req = {}) {
  return {
    ip: req.ip || '',
    userAgent: req.headers?.['user-agent'] || '',
    requestId: req.headers?.['x-request-id'] || '',
  };
}

async function recordSecurityEvent({ eventType, severity = 'low', actorId = '', actorRole = '', entityType = '', entityId = '', status = 'recorded', reason = '', metadata = {}, req = null }) {
  if (!Array.isArray(store.state.securityEvents)) store.state.securityEvents = [];
  const ctx = requestContext(req || {});
  const event = {
    id: nextId('security-event', store.state.securityEvents),
    eventType,
    severity,
    actorId,
    actorRole,
    entityType,
    entityId,
    status,
    reason,
    ...ctx,
    metadata: maskSensitive(metadata),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  store.state.securityEvents.unshift(event);
  await persist('securityEvents', event);
  await recordAudit({
    action: `security.${eventType}`,
    actorId,
    actorRole,
    entityType: entityType || 'security_event',
    entityId: entityId || event.id,
    status,
    reason,
    metadata: { severity, ...maskSensitive(metadata) },
    req,
  });
  return event;
}

async function recordAudit({ action, actorId = '', actorRole = '', entityType = '', entityId = '', beforeSummary = null, afterSummary = null, status = 'success', reason = '', metadata = {}, req = null }) {
  if (!Array.isArray(store.state.auditLogs)) store.state.auditLogs = [];
  const user = req?.session?.user || {};
  const ctx = requestContext(req || {});
  const audit = {
    id: nextId('audit', store.state.auditLogs),
    actorId: actorId || user.id || 'system',
    actorName: user.fullName || '',
    actorEmail: user.email || '',
    actorRole: actorRole || user.role || '',
    action,
    entityType,
    entityId,
    target: entityId,
    beforeSummary: maskSensitive(beforeSummary),
    afterSummary: maskSensitive(afterSummary),
    metadata: { ...maskSensitive(metadata), reason },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    status,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  store.state.auditLogs.unshift(audit);
  await persist('auditLogs', audit);
  return audit;
}

async function recordLoginAttempt({ user = null, identity = '', result = 'failure', reason = '', req = null }) {
  if (!Array.isArray(store.state.loginAudits)) store.state.loginAudits = [];
  const ctx = requestContext(req || {});
  const deviceFingerprint = fingerprint(req || {});
  let deviceSession = null;
  if (result === 'success' && user?.id) {
    if (!Array.isArray(store.state.deviceSessions)) store.state.deviceSessions = [];
    const hash = sessionHash(req || {});
    deviceSession = store.state.deviceSessions.find((item) => item.sessionHash === hash && item.userId === user.id);
    if (!deviceSession) {
      deviceSession = {
        id: nextId('device-session', store.state.deviceSessions),
        userId: user.id,
        role: user.role || '',
        sessionHash: hash,
        deviceFingerprint,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        firstSeenAt: nowIso(),
        lastSeenAt: nowIso(),
        status: 'active',
        metadata: {},
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      store.state.deviceSessions.unshift(deviceSession);
    } else {
      deviceSession.lastSeenAt = nowIso();
      deviceSession.status = 'active';
      deviceSession.updatedAt = nowIso();
    }
    await persist('deviceSessions', deviceSession);
  }
  const row = {
    id: nextId('login-audit', store.state.loginAudits),
    userId: user?.id || '',
    identity: maskValue(identity || user?.email || user?.phone || ''),
    role: user?.role || '',
    result,
    reason,
    ...ctx,
    deviceFingerprint,
    deviceSessionId: deviceSession?.id || '',
    riskScore: result === 'success' ? 0 : 20,
    metadata: {},
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  store.state.loginAudits.unshift(row);
  await persist('loginAudits', row);
  await recordAudit({
    action: result === 'success' ? 'auth.login.success' : 'auth.login.failure',
    actorId: user?.id || 'anonymous',
    actorRole: user?.role || '',
    entityType: 'user',
    entityId: user?.id || '',
    status: result,
    reason,
    metadata: { identity: row.identity, deviceSessionId: row.deviceSessionId },
    req,
  });
  return row;
}

async function closeDeviceSession(req = {}) {
  const user = req.session?.user;
  if (!user?.id || !Array.isArray(store.state.deviceSessions)) return null;
  const hash = sessionHash(req);
  const session = store.state.deviceSessions.find((item) => item.userId === user.id && item.sessionHash === hash && item.status === 'active');
  if (!session) return null;
  session.status = 'revoked';
  session.revokedAt = nowIso();
  session.updatedAt = nowIso();
  await persist('deviceSessions', session);
  await recordAudit({ action: 'auth.logout', actorId: user.id, actorRole: user.role, entityType: 'device_session', entityId: session.id, req });
  return session;
}

async function claimIdempotencyKey({ key, scope, entityType = '', entityId = '', payload = {}, metadata = {} }) {
  if (!Array.isArray(store.state.idempotencyKeyRecords)) store.state.idempotencyKeyRecords = [];
  const cleanKey = String(key || '').trim();
  if (!cleanKey) {
    const error = new Error('Idempotency key is required');
    error.status = 409;
    throw error;
  }
  const payloadHash = sha256(JSON.stringify(maskSensitive(payload || {})));
  const existing = store.state.idempotencyKeyRecords.find((item) => item.key === cleanKey && item.scope === scope);
  if (existing) {
    existing.lastSeenAt = nowIso();
    existing.status = existing.payloadHash === payloadHash ? 'replayed' : 'failed';
    existing.updatedAt = nowIso();
    await persist('idempotencyKeyRecords', existing);
    if (existing.payloadHash !== payloadHash) {
      const error = new Error('Idempotency key payload mismatch');
      error.status = 409;
      throw error;
    }
    return { record: existing, replayed: true };
  }
  const record = {
    id: nextId('idem', store.state.idempotencyKeyRecords),
    key: cleanKey,
    scope,
    entityType,
    entityId,
    payloadHash,
    responseHash: '',
    status: 'started',
    firstSeenAt: nowIso(),
    lastSeenAt: nowIso(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    metadata: maskSensitive(metadata),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  store.state.idempotencyKeyRecords.unshift(record);
  await persist('idempotencyKeyRecords', record);
  return { record, replayed: false };
}

async function completeIdempotency(record, response = {}) {
  if (!record) return null;
  record.status = 'completed';
  record.responseHash = sha256(JSON.stringify(maskSensitive(response || {})));
  record.updatedAt = nowIso();
  await persist('idempotencyKeyRecords', record);
  return record;
}

async function assertStateTransition({ entity, entityType, entityId, field = 'status', to, allowed = {}, actorId = '', reason = '', req = null }) {
  const from = entity?.[field] || '';
  const allowedTargets = allowed[from] || [];
  if (allowedTargets.length && !allowedTargets.includes(to)) {
    await recordSecurityEvent({
      eventType: 'invalid_state_transition',
      severity: 'high',
      actorId,
      actorRole: req?.session?.user?.role || '',
      entityType,
      entityId,
      status: 'blocked',
      reason: `${from}->${to}`,
      metadata: { field, from, to, allowedTargets },
      req,
    });
    const error = new Error(`Invalid ${entityType} ${field} transition from ${from} to ${to}`);
    error.status = 409;
    throw error;
  }
  await recordAudit({
    action: `${entityType}.${field}.transition`,
    actorId,
    actorRole: req?.session?.user?.role || '',
    entityType,
    entityId,
    beforeSummary: { [field]: from },
    afterSummary: { [field]: to },
    reason,
    req,
  });
  return true;
}

function reportRows(type = 'securityEvents') {
  if (type === 'loginAudits') return (store.state.loginAudits || []).map((row) => [row.id, row.userId || row.identity, row.role || '', row.result, row.reason || '', row.ip || '', row.createdAt || '']);
  if (type === 'deviceSessions') return (store.state.deviceSessions || []).map((row) => [row.id, row.userId, row.role || '', row.deviceFingerprint || '', row.status, row.firstSeenAt || '', row.lastSeenAt || '']);
  if (type === 'idempotencyKeyRecords') return (store.state.idempotencyKeyRecords || []).map((row) => [row.id, row.scope, maskValue(row.key), row.entityType || '', row.entityId || '', row.status, row.lastSeenAt || '']);
  return (store.state.securityEvents || []).map((row) => [row.id, row.eventType, row.severity, row.actorId || '', row.entityType || '', row.entityId || '', row.status, row.reason || '', row.createdAt || '']);
}

module.exports = {
  sha256,
  fingerprint,
  maskSensitive,
  recordAudit,
  recordSecurityEvent,
  recordLoginAttempt,
  closeDeviceSession,
  claimIdempotencyKey,
  completeIdempotency,
  assertStateTransition,
  reportRows,
};
