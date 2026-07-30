const crypto = require('crypto');
const securityRepository = require('../../repositories/domain/securityRepository');
const { nextId } = require('../data/idService');
const redisRuntime = require('../../config/redis');
const SENSITIVE_KEYS = /password|token|secret|signature|authorization|cookie|card|cvv|pin|rawpayload|reset/i;
const localLoginFailures = new Map();
function nowIso() { return new Date().toISOString(); }
function sha256(value = '') { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }
function fingerprint(req = {}) { return sha256([req.ip || '', req.headers?.['user-agent'] || '', req.headers?.['accept-language'] || ''].join('|')).slice(0, 32); }
function sessionHash(req = {}) { return sha256(req.sessionID || req.session?.id || `${Date.now()}-${Math.random()}`).slice(0, 48); }
function maskValue(value = '') { const text = String(value ?? ''); if (!text) return ''; if (text.includes('@')) { const [name, domain] = text.split('@'); return `${name.slice(0, 2)}***@${domain}`; } if (text.length <= 4) return '***'; return `${text.slice(0, 2)}***${text.slice(-2)}`; }
function maskSensitive(value) { if (Array.isArray(value)) return value.map(maskSensitive); if (!value || typeof value !== 'object') return value; return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEYS.test(key) ? maskValue(item) : maskSensitive(item)])); }
function requestContext(req = {}) { return { ip: req.ip || '', userAgent: req.headers?.['user-agent'] || '', requestId: req.id || '' }; }
function loginFailureKey(identity = '') { return redisRuntime.key('login-failures', sha256(String(identity || '').trim().toLowerCase())); }
function localFailureCount(cacheKey) {
  const record = localLoginFailures.get(cacheKey);
  if (!record) return 0;
  if (record.expiresAt <= Date.now()) {
    localLoginFailures.delete(cacheKey);
    return 0;
  }
  return Number(record.count || 0);
}
function updateLocalFailureCount(cacheKey, result, windowMs = 15 * 60 * 1000) {
  if (result === 'success') {
    localLoginFailures.delete(cacheKey);
    return 0;
  }
  const count = localFailureCount(cacheKey) + 1;
  localLoginFailures.set(cacheKey, { count, expiresAt: Date.now() + windowMs });
  if (localLoginFailures.size > 5000) {
    for (const [key, value] of localLoginFailures) {
      if (value.expiresAt <= Date.now()) localLoginFailures.delete(key);
    }
    // Map iteration follows insertion order. If an attack fills the cache with
    // unexpired identities, evict the oldest entries so the fast fallback
    // remains strictly bounded. Redis remains the shared production guard.
    while (localLoginFailures.size > 4000) {
      localLoginFailures.delete(localLoginFailures.keys().next().value);
    }
  }
  return count;
}

async function recordAudit({ action, actorId = '', actorRole = '', entityType = '', entityId = '', beforeSummary = null, afterSummary = null, status = 'success', reason = '', metadata = {}, req = null }) {
  const user = req?.session?.user || {}; const ctx = requestContext(req || {});
  const audit = { id: await nextId('audit'), actorId: actorId || user.id || 'system', actorName: user.fullName || '', actorEmail: user.email || '', actorRole: actorRole || user.role || '', action, entityType, entityId, target: entityId, beforeSummary: maskSensitive(beforeSummary), afterSummary: maskSensitive(afterSummary), metadata: { ...maskSensitive(metadata), reason }, ip: ctx.ip, userAgent: ctx.userAgent, status, createdAt: nowIso(), updatedAt: nowIso() };
  await securityRepository.auditLogs.save(audit, { id: audit.id }); return audit;
}
async function recordSecurityEvent({ eventType, severity = 'low', actorId = '', actorRole = '', entityType = '', entityId = '', status = 'recorded', reason = '', metadata = {}, req = null }) {
  const ctx = requestContext(req || {}); const event = { id: await nextId('security-event'), eventType, severity, actorId, actorRole, entityType, entityId, status, reason, ...ctx, metadata: maskSensitive(metadata), createdAt: nowIso(), updatedAt: nowIso() };
  await securityRepository.securityEvents.save(event, { id: event.id });
  await recordAudit({ action: `security.${eventType}`, actorId, actorRole, entityType: entityType || 'security_event', entityId: entityId || event.id, status, reason, metadata: { severity, ...maskSensitive(metadata) }, req }); return event;
}
async function recentFailedLoginCountLive(identity, windowMs) {
  if (!identity) return 0;
  const client = redisRuntime.activeClient();
  const cacheKey = loginFailureKey(identity);
  const localCount = localFailureCount(cacheKey);
  if (client) {
    try {
      const cached = await client.get(cacheKey);
      if (cached !== null) return Math.max(localCount, Number(cached || 0));
    } catch (_) {}
  }
  // Production requires Redis. The bounded process-local guard keeps login fast
  // and protected during a transient Redis outage without putting MongoDB back
  // on the password-verification critical path.
  return localCount;
}
async function recordLoginAttempt({ user = null, identity = '', result = 'failure', reason = '', req = null }) {
  const ctx = requestContext(req || {});
  const deviceFingerprint = fingerprint(req || {});
  const timestamp = nowIso();
  const redisClient = redisRuntime.activeClient();
  const counterKey = loginFailureKey(identity || user?.email || user?.phone || '');
  updateLocalFailureCount(counterKey, result);
  if (redisClient) {
    try {
      if (result === 'failure') {
        const hits = await redisClient.incr(counterKey);
        if (hits === 1) await redisClient.pExpire(counterKey, 15 * 60 * 1000);
      } else if (result === 'success') {
        await redisClient.del(counterKey);
      }
    } catch (_) {}
  }
  let deviceSession = null;
  let deviceWrite = Promise.resolve(null);

  if (result === 'success' && user?.id) {
    const hash = sessionHash(req || {});
    deviceSession = await securityRepository.deviceSessions.findOne({ sessionHash: hash, userId: user.id });
    if (!deviceSession) {
      deviceSession = {
        id: await nextId('device-session'), userId: user.id, role: user.role || '', sessionHash: hash,
        deviceFingerprint, ip: ctx.ip, userAgent: ctx.userAgent, firstSeenAt: timestamp,
        lastSeenAt: timestamp, status: 'active', metadata: {}, createdAt: timestamp, updatedAt: timestamp,
      };
    } else {
      Object.assign(deviceSession, { lastSeenAt: timestamp, status: 'active', updatedAt: timestamp });
    }
    deviceWrite = securityRepository.deviceSessions.save(deviceSession, { sessionHash: hash });
  }

  const row = {
    id: await nextId('login-audit'), userId: user?.id || '',
    identity: maskValue(identity || user?.email || user?.phone || ''), role: user?.role || '',
    result, reason, ...ctx, deviceFingerprint, deviceSessionId: deviceSession?.id || '',
    riskScore: result === 'success' ? 0 : 20, metadata: {}, createdAt: timestamp, updatedAt: timestamp,
  };

  await Promise.all([
    deviceWrite,
    securityRepository.loginAudits.save(row, { id: row.id }),
    recordAudit({
      action: result === 'success' ? 'auth.login.success' : 'auth.login.failure',
      actorId: user?.id || 'anonymous', actorRole: user?.role || '', entityType: 'user',
      entityId: user?.id || '', status: result, reason,
      metadata: { identity: row.identity, deviceSessionId: row.deviceSessionId }, req,
    }),
  ]);
  return row;
}

async function closeDeviceSession(req = {}) {
  const user = req.session?.user; if (!user?.id) return null; const hash = sessionHash(req); const session = await securityRepository.deviceSessions.findOne({ userId: user.id, sessionHash: hash, status: 'active' }); if (!session) return null;
  Object.assign(session, { status: 'revoked', revokedAt: nowIso(), updatedAt: nowIso() }); await securityRepository.deviceSessions.save(session, { sessionHash: hash }); await recordAudit({ action: 'auth.logout', actorId: user.id, actorRole: user.role, entityType: 'device_session', entityId: session.id, req }); return session;
}
async function claimIdempotencyKey({ key, scope, entityType = '', entityId = '', payload = {}, metadata = {} }) {
  const cleanKey = String(key || '').trim(); if (!cleanKey) { const error = new Error('Idempotency key is required'); error.status = 409; throw error; }
  const payloadHash = sha256(JSON.stringify(maskSensitive(payload || {}))); const existing = await securityRepository.idempotencyKeys.findOne({ key: cleanKey, scope });
  if (existing) {
    Object.assign(existing, { lastSeenAt: nowIso(), status: existing.payloadHash === payloadHash ? 'replayed' : 'failed', updatedAt: nowIso() }); await securityRepository.idempotencyKeys.save(existing, { key: cleanKey, scope });
    if (existing.payloadHash !== payloadHash) { const error = new Error('Idempotency key payload mismatch'); error.status = 409; throw error; }
    return { record: existing, replayed: true };
  }
  const record = { id: await nextId('idem'), key: cleanKey, scope, entityType, entityId, payloadHash, responseHash: '', status: 'started', firstSeenAt: nowIso(), lastSeenAt: nowIso(), expiresAt: new Date(Date.now() + 86400000).toISOString(), metadata: maskSensitive(metadata), createdAt: nowIso(), updatedAt: nowIso() };
  await securityRepository.idempotencyKeys.save(record, { key: cleanKey, scope }); return { record, replayed: false };
}
async function completeIdempotency(record, response = {}) { if (!record) return null; Object.assign(record, { status: 'completed', responseHash: sha256(JSON.stringify(maskSensitive(response || {}))), updatedAt: nowIso() }); await securityRepository.idempotencyKeys.save(record, { key: record.key, scope: record.scope }); return record; }
async function assertStateTransition({ entity, entityType, entityId, field = 'status', to, allowed = {}, actorId = '', reason = '', req = null }) {
  const from = entity?.[field] || ''; const allowedTargets = allowed[from] || [];
  if (allowedTargets.length && !allowedTargets.includes(to)) { await recordSecurityEvent({ eventType: 'invalid_state_transition', severity: 'high', actorId, actorRole: req?.session?.user?.role || '', entityType, entityId, status: 'blocked', reason: `${from}->${to}`, metadata: { field, from, to, allowedTargets }, req }); const error = new Error(`Invalid ${entityType} ${field} transition from ${from} to ${to}`); error.status = 409; throw error; }
  await recordAudit({ action: `${entityType}.${field}.transition`, actorId, actorRole: req?.session?.user?.role || '', entityType, entityId, beforeSummary: { [field]: from }, afterSummary: { [field]: to }, reason, req }); return true;
}
function rowsToReport(type, rows) {
  if (type === 'loginAudits') return rows.map((row) => [row.id, row.userId || row.identity, row.role || '', row.result, row.reason || '', row.ip || '', row.createdAt || '']);
  if (type === 'deviceSessions') return rows.map((row) => [row.id, row.userId, row.role || '', row.deviceFingerprint || '', row.status, row.firstSeenAt || '', row.lastSeenAt || '']);
  if (type === 'idempotencyKeyRecords') return rows.map((row) => [row.id, row.scope, maskValue(row.key), row.entityType || '', row.entityId || '', row.status, row.lastSeenAt || '']);
  return rows.map((row) => [row.id, row.eventType, row.severity, row.actorId || '', row.entityType || '', row.entityId || '', row.status, row.reason || '', row.createdAt || '']);
}
function collectionForReport(type) { return type === 'loginAudits' ? securityRepository.loginAudits : type === 'deviceSessions' ? securityRepository.deviceSessions : type === 'idempotencyKeyRecords' ? securityRepository.idempotencyKeys : securityRepository.securityEvents; }
async function reportRowsLive(type = 'securityEvents') { return rowsToReport(type, await collectionForReport(type).list({}, { sort: { createdAt: -1 }, limit: 10000 })); }
module.exports = { sha256, fingerprint, maskSensitive, recordAudit, recordSecurityEvent, recordLoginAttempt, recentFailedLoginCount: recentFailedLoginCountLive, recentFailedLoginCountLive, closeDeviceSession, claimIdempotencyKey, completeIdempotency, assertStateTransition, reportRows: reportRowsLive, reportRowsLive };
